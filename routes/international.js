const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { query } = require('../database/db');

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const VALID_COUNTRIES = ['FR', 'DE', 'ES', 'IT'];

/**
 * Parsa una riga di report Amazon (TSV tab-separated)
 * Header atteso: item-name \t listing-id \t seller-sku \t price \t quantity \t open-date \t ...
 */
function parseAmazonReport(content) {
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = headerLine.split('\t').map(h => h.trim().toLowerCase().replace(/-/g, '_'));

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split('\t');
    const rec = {};
    headers.forEach((h, idx) => {
      rec[h] = (cols[idx] || '').trim();
    });
    records.push(rec);
  }
  return records;
}

function parseDate(str) {
  if (!str) return null;
  // Formato: "20/06/2024 13:25:37 MEST"
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (match) {
    return new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}Z`);
  }
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

// ─── POST /api/international/upload ──────────────────────────
// Body: country (FR/DE/ES/IT), file (multipart)
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
      if (!itemName) continue; // salta righe vuote

      await query(`
        INSERT INTO international_offers
          (country, item_name, listing_id, seller_sku, price, quantity, open_date,
           product_id_type, item_note, item_condition, will_ship_internationally,
           expedited_shipping, product_id, pending_quantity, fulfillment_channel,
           merchant_shipping_group, status, minimum_order_quantity, sell_remainder)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `, [
        country,
        itemName,
        r['listing_id'] || null,
        r['seller_sku'] || null,
        toNum(r['price']),
        toInt(r['quantity']),
        parseDate(r['open_date']),
        r['product_id_type'] || null,
        r['item_note'] || null,
        r['item_condition'] || null,
        r['will_ship_internationally'] || null,
        r['expedited_shipping'] || null,
        r['product_id'] || null,
        toInt(r['pending_quantity']),
        r['fulfillment_channel'] || null,
        r['merchant_shipping_group'] || null,
        r['status'] || null,
        toInt(r['minimum_order_quantity']),
        r['sell_remainder'] || null,
      ]);
      imported++;
    }

    res.json({ success: true, country, imported, total: records.length });
  } catch (err) {
    console.error('Errore upload international:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
});

// ─── GET /api/international/dashboard ────────────────────────
// Restituisce statistiche aggregate per paese
router.get('/dashboard', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        country,
        COUNT(*)                                          AS totale,
        COUNT(*) FILTER (WHERE LOWER(status) = 'active') AS attivi,
        COUNT(*) FILTER (WHERE LOWER(status) = 'inactive') AS inattivi,
        ROUND(AVG(price)::numeric, 2)                    AS prezzo_medio,
        MIN(price)                                        AS prezzo_min,
        MAX(price)                                        AS prezzo_max,
        SUM(quantity)                                     AS quantita_totale,
        ROUND(SUM(price * quantity)::numeric, 2)          AS valore_stock,
        MAX(uploaded_at)                                  AS ultimo_aggiornamento
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
// Query params: country, status, page, limit
router.get('/offers', async (req, res) => {
  try {
    const { country, status, page = 1, limit = 100 } = req.query;
    const params = [];
    const where = [];

    if (country && VALID_COUNTRIES.includes(country.toUpperCase())) {
      params.push(country.toUpperCase());
      where.push(`country = $${params.length}`);
    }
    if (status && status !== 'all') {
      params.push(status);
      where.push(`LOWER(status) = LOWER($${params.length})`);
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
      ORDER BY country, status DESC, item_name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, total, page: parseInt(page), data: dataResult.rows });
  } catch (err) {
    console.error('Errore offers international:', err);
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
