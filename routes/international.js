const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { query } = require('../database/db');

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const VALID_COUNTRIES = ['FR', 'DE', 'ES', 'IT'];

// ─── PARSING ─────────────────────────────────────────────────

function parseAmazonReport(content) {
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase().replace(/-/g, '_'));
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split('\t');
    const rec = {};
    headers.forEach((h, idx) => { rec[h] = (cols[idx] || '').trim(); });
    records.push(rec);
  }
  return records;
}

function parseDate(str) {
  if (!str) return null;
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (match) return new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}Z`);
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function toNum(str) {
  const n = parseFloat(String(str || '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function toInt(str) {
  const n = parseInt(String(str || ''), 10);
  return isNaN(n) ? null : n;
}

// ─── PARENT/CHILD DETECTION ───────────────────────────────────
/**
 * Rileva automaticamente relazioni parent/child tramite prefix-matching degli SKU.
 * Un'offerta A è PARENT di B se seller_sku(B) inizia con seller_sku(A) + separatore (-/_/spazio).
 * L'algoritmo usa lastIndexOf per trovare il separatore più a destra, garantendo
 * il parent più specifico (più lungo). Scalabile a N varianti senza hardcode.
 */
async function detectAndLinkParents(country) {
  // Reset relazioni esistenti per il paese
  await query(
    'UPDATE international_offers SET is_parent = false, parent_sku = NULL WHERE country = $1',
    [country]
  );

  const result = await query(
    `SELECT id, seller_sku, quantity, price, status
     FROM international_offers
     WHERE country = $1 AND seller_sku IS NOT NULL AND seller_sku != ''`,
    [country]
  );
  const offers = result.rows;
  if (offers.length < 2) return { parents: 0, linked: 0 };

  const separators = ['-', '_', ' '];

  // Mappa sku_lowercase → offerta originale per lookup O(1)
  const skuMap = new Map();
  for (const o of offers) {
    skuMap.set(o.seller_sku.toLowerCase(), o);
  }

  const childToParent = {}; // child_id → parent_sku (case originale)
  const parentIds = new Set();

  for (const offer of offers) {
    const sku = offer.seller_sku;
    let bestParentSku = null;
    let bestParentLen = 0;

    // Cerca il parent migliore togliendo l'ultimo segmento con separatore
    for (const sep of separators) {
      const lastSepIdx = sku.lastIndexOf(sep);
      if (lastSepIdx <= 0) continue; // nessun separatore o all'inizio
      const candidateLower = sku.substring(0, lastSepIdx).toLowerCase();
      const candidateOffer = skuMap.get(candidateLower);
      if (candidateOffer && candidateOffer.id !== offer.id && candidateLower.length > bestParentLen) {
        bestParentSku = candidateOffer.seller_sku;
        bestParentLen = candidateLower.length;
      }
    }

    if (bestParentSku) {
      childToParent[offer.id] = bestParentSku;
      const parentOffer = skuMap.get(bestParentSku.toLowerCase());
      if (parentOffer) parentIds.add(parentOffer.id);
    }
  }

  // Batch update is_parent
  for (const parentId of parentIds) {
    await query('UPDATE international_offers SET is_parent = true WHERE id = $1', [parentId]);
  }

  // Batch update parent_sku per i child
  for (const [childId, parentSku] of Object.entries(childToParent)) {
    await query(
      'UPDATE international_offers SET parent_sku = $1 WHERE id = $2',
      [parentSku, childId]
    );
  }

  return { parents: parentIds.size, linked: Object.keys(childToParent).length };
}

// ─── POST /api/international/upload ──────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  const filePath = req.file ? req.file.path : null;
  try {
    const country = (req.body.country || '').toUpperCase();
    if (!VALID_COUNTRIES.includes(country)) {
      return res.status(400).json({ error: 'Paese non valido. Usa FR, DE, ES o IT.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato.' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const records = parseAmazonReport(content);

    if (records.length === 0) {
      return res.status(400).json({ error: 'Nessun record trovato nel file.' });
    }

    // Cancella dati esistenti per il paese (sostituzione completa)
    await query('DELETE FROM international_offers WHERE country = $1', [country]);

    let imported = 0;
    for (const r of records) {
      const itemName = r['item_name'] || r['item-name'] || '';
      if (!itemName) continue;

      await query(`
        INSERT INTO international_offers
          (country, item_name, listing_id, seller_sku, price, quantity, open_date,
           product_id_type, item_note, item_condition, will_ship_internationally,
           expedited_shipping, product_id, pending_quantity, fulfillment_channel,
           merchant_shipping_group, status, minimum_order_quantity, sell_remainder)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `, [
        country, itemName,
        r['listing_id'] || null, r['seller_sku'] || null,
        toNum(r['price']), toInt(r['quantity']), parseDate(r['open_date']),
        r['product_id_type'] || null, r['item_note'] || null, r['item_condition'] || null,
        r['will_ship_internationally'] || null, r['expedited_shipping'] || null,
        r['product_id'] || null, toInt(r['pending_quantity']),
        r['fulfillment_channel'] || null, r['merchant_shipping_group'] || null,
        r['status'] || null, toInt(r['minimum_order_quantity']), r['sell_remainder'] || null,
      ]);
      imported++;
    }

    // Rileva e collega parent/child automaticamente
    const linkResult = await detectAndLinkParents(country);

    res.json({
      success: true, country, imported, total: records.length,
      parents: linkResult.parents, linked: linkResult.linked,
    });
  } catch (err) {
    console.error('Errore upload international:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath) { try { fs.unlinkSync(filePath); } catch (_) {} }
  }
});

// ─── POST /api/international/relink ──────────────────────────
// Ricalcola relazioni parent/child per tutti i paesi (o uno specifico)
router.post('/relink', async (req, res) => {
  try {
    const { country } = req.body;
    const countries = country
      ? [country.toUpperCase()].filter(c => VALID_COUNTRIES.includes(c))
      : VALID_COUNTRIES;

    const results = {};
    for (const c of countries) {
      const check = await query(
        'SELECT COUNT(*) FROM international_offers WHERE country = $1', [c]
      );
      if (parseInt(check.rows[0].count) > 0) {
        results[c] = await detectAndLinkParents(c);
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    console.error('Errore relink:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/international/offers/:id/set-parent ──────────
// Imposta manualmente il parent_sku di un'offerta (accoppiamento da UI)
router.patch('/offers/:id/set-parent', async (req, res) => {
  try {
    const { id } = req.params;
    const { parent_sku } = req.body;

    const offerRes = await query('SELECT * FROM international_offers WHERE id = $1', [id]);
    if (!offerRes.rows[0]) return res.status(404).json({ error: 'Offerta non trovata.' });
    const offer = offerRes.rows[0];

    if (!parent_sku) {
      // Rimuovi il collegamento
      await query('UPDATE international_offers SET parent_sku = NULL WHERE id = $1', [id]);
      return res.json({ success: true, message: 'Collegamento rimosso.' });
    }

    // Verifica che il parent esista nello stesso paese
    const parentRes = await query(
      'SELECT id FROM international_offers WHERE LOWER(seller_sku) = LOWER($1) AND country = $2',
      [parent_sku, offer.country]
    );
    if (parentRes.rows.length === 0) {
      return res.status(404).json({
        error: `Parent SKU "${parent_sku}" non trovato per ${offer.country}.`
      });
    }

    await query('UPDATE international_offers SET parent_sku = $1 WHERE id = $2', [parent_sku, id]);
    // Marca il parent come tale
    await query(
      'UPDATE international_offers SET is_parent = true WHERE LOWER(seller_sku) = LOWER($1) AND country = $2',
      [parent_sku, offer.country]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Errore set-parent:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/international/dashboard ────────────────────────
// Statistiche aggregate per paese — ESCLUSI i parent (is_parent IS TRUE)
router.get('/dashboard', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        country,
        COUNT(*) FILTER (WHERE is_parent IS NOT TRUE)
          AS totale,
        COUNT(*) FILTER (WHERE LOWER(status) = 'active'   AND is_parent IS NOT TRUE)
          AS attivi,
        COUNT(*) FILTER (WHERE LOWER(status) = 'inactive' AND is_parent IS NOT TRUE)
          AS inattivi,
        ROUND(AVG(price)   FILTER (WHERE is_parent IS NOT TRUE)::numeric, 2)
          AS prezzo_medio,
        MIN(price)         FILTER (WHERE is_parent IS NOT TRUE)
          AS prezzo_min,
        MAX(price)         FILTER (WHERE is_parent IS NOT TRUE)
          AS prezzo_max,
        SUM(quantity)      FILTER (WHERE is_parent IS NOT TRUE)
          AS quantita_totale,
        ROUND(SUM(price * quantity) FILTER (WHERE is_parent IS NOT TRUE)::numeric, 2)
          AS valore_stock,
        MAX(uploaded_at)   AS ultimo_aggiornamento
      FROM international_offers
      GROUP BY country
      ORDER BY country
    `);

    const byCountry = {};
    for (const row of result.rows) {
      byCountry[row.country] = row;
    }
    res.json({ success: true, data: byCountry });
  } catch (err) {
    console.error('Errore dashboard international:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/international/offers ───────────────────────────
// Restituisce offerte flat con is_parent/parent_sku; il frontend raggruppa.
// Ordina: per country, poi raggruppate per parent (COALESCE(parent_sku, seller_sku)),
// poi parent prima dei child (is_parent DESC).
router.get('/offers', async (req, res) => {
  try {
    const { country, status, page = 1, limit = 500 } = req.query;
    const params = [];
    const where = [];

    if (country && VALID_COUNTRIES.includes(country.toUpperCase())) {
      params.push(country.toUpperCase());
      where.push(`country = $${params.length}`);
    }
    // Quando si filtra per status, includo SEMPRE i parent (per mostrare il gruppo)
    if (status && status !== 'all') {
      params.push(status);
      where.push(`(is_parent = true OR LOWER(status) = LOWER($${params.length}))`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const countResult = await query(
      `SELECT COUNT(*) FROM international_offers ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit));
    params.push(offset);
    const dataResult = await query(`
      SELECT * FROM international_offers
      ${whereClause}
      ORDER BY
        country,
        COALESCE(parent_sku, seller_sku) NULLS LAST,
        is_parent DESC,
        status DESC,
        item_name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, total, page: parseInt(page), data: dataResult.rows });
  } catch (err) {
    console.error('Errore offers international:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/international/export ──────────────────────────
// Esporta offerte selezionate (esclude i parent row)
router.post('/export', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Nessun ID selezionato.' });
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await query(
      `SELECT * FROM international_offers
       WHERE id IN (${placeholders}) AND is_parent IS NOT TRUE
       ORDER BY country, item_name`,
      ids
    );
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Nessuna offerta trovata.' });
    }

    const COUNTRY_NAMES = { FR: 'Francia', DE: 'Germania', ES: 'Spagna', IT: 'Italia' };
    const wsData = [
      ['Paese', 'item-name', 'listing-id', 'seller-sku', 'price', 'quantity',
       'open-date', 'product-id-type', 'item-note', 'item-condition',
       'will-ship-internationally', 'expedited-shipping', 'product-id',
       'pending-quantity', 'fulfillment-channel', 'merchant-shipping-group',
       'status', 'Minimum order quantity', 'Sell remainder'],
      ...rows.map(r => [
        COUNTRY_NAMES[r.country] || r.country,
        r.item_name || '', r.listing_id || '', r.seller_sku || '',
        r.price != null ? Number(r.price) : '',
        r.quantity != null ? Number(r.quantity) : '',
        r.open_date ? new Date(r.open_date).toLocaleDateString('it-IT') : '',
        r.product_id_type || '', r.item_note || '', r.item_condition || '',
        r.will_ship_internationally || '', r.expedited_shipping || '',
        r.product_id || '',
        r.pending_quantity != null ? Number(r.pending_quantity) : '',
        r.fulfillment_channel || '', r.merchant_shipping_group || '',
        r.status || '',
        r.minimum_order_quantity != null ? Number(r.minimum_order_quantity) : '',
        r.sell_remainder || '',
      ])
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 10 }, { wch: 60 }, { wch: 15 }, { wch: 20 }, { wch: 8 },
      { wch: 8 }, { wch: 18 }, { wch: 8 }, { wch: 20 }, { wch: 10 },
      { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 18 },
      { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 8 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Offerte EU');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="offerte-eu-${timestamp}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('Errore export international:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/international/country/:country ───────────────
router.delete('/country/:country', async (req, res) => {
  try {
    const country = (req.params.country || '').toUpperCase();
    if (!VALID_COUNTRIES.includes(country)) {
      return res.status(400).json({ error: 'Paese non valido.' });
    }
    const result = await query(
      'DELETE FROM international_offers WHERE country = $1', [country]
    );
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) {
    console.error('Errore delete international:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
