const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { parseFreeText } = require('../services/fileParser');

// GET /api/products — lista tutti i prodotti
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*,
        COUNT(pav.id) FILTER (WHERE pav.value IS NOT NULL AND pav.value != '') AS attributi_compilati,
        (SELECT COUNT(*) FROM attribute_definitions WHERE source NOT IN ('SKIP','MANUAL')) AS attributi_auto
      FROM products p
      LEFT JOIN product_attribute_values pav ON pav.product_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/editing — sessioni editing attive (heartbeat < 90s)
router.get('/editing', (req, res) => {
  const editingMap = req.app.locals.editingMap;
  const threshold = Date.now() - 90_000;
  const active = [];
  for (const [productId, session] of editingMap.entries()) {
    if (session.updatedAt >= threshold) {
      active.push({ productId, userId: session.userId, nome: session.nome, updatedAt: session.updatedAt });
    }
  }
  res.json(active);
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Prodotto non trovato' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/:id/heartbeat — registra che l'utente sta editando questo prodotto
router.post('/:id/heartbeat', (req, res) => {
  const productId = parseInt(req.params.id);
  if (isNaN(productId)) return res.status(400).json({ error: 'ID non valido' });
  req.app.locals.editingMap.set(productId, {
    userId:    req.session.userId,
    nome:      req.session.nome || req.session.email || 'Utente',
    updatedAt: Date.now()
  });
  res.json({ ok: true });
});

// =============================================
// PATCH /api/products/:id/description
// Aggiunge/aggiorna la descrizione di un prodotto esistente.
// Usato dal tab "Aggiungi descrizione" della dashboard.
// =============================================
router.patch('/:id/description', async (req, res) => {
  try {
    const { id } = req.params;
    const { testo } = req.body;

    if (!testo || !testo.trim()) {
      return res.status(400).json({ error: 'Il testo della descrizione è obbligatorio' });
    }

    // Verifica che il prodotto esista
    const existing = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }

    // Estrai autore e tecnica dal testo (se non già presenti)
    const parsed = parseFreeText(testo.trim());
    const parsedProduct = parsed[0] || {};

    const product = existing.rows[0];

    // Aggiorna: descrizione_raw sempre, autore/tecnica solo se vuoti nel DB
    const newAutore = product.autore || parsedProduct.autore || null;
    const newTecnica = product.tecnica || parsedProduct.tecnica || 'Stampa su tela';

    await query(`
      UPDATE products SET
        descrizione_raw = $1,
        autore = $2,
        tecnica = $3
      WHERE id = $4
    `, [testo.trim(), newAutore, newTecnica, id]);

    const updated = await query('SELECT * FROM products WHERE id = $1', [id]);
    res.json({ success: true, product: updated.rows[0] });

  } catch (err) {
    console.error('Errore aggiornamento descrizione:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// PATCH /api/products/:id/variants
// Salva EAN, URL immagini e ASIN Amazon per le 3 varianti
// =============================================
router.patch('/:id/variants', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ean_max, ean_media, ean_mini,
      immagine_max, immagine_media, immagine_mini,
      immagine_max_2, immagine_max_3, immagine_max_4,
      immagine_media_2, immagine_media_3, immagine_media_4,
      immagine_mini_2, immagine_mini_3, immagine_mini_4,
      asin_padre, asin_max, asin_media, asin_mini,
    } = req.body;

    const existing = await query('SELECT id FROM products WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Prodotto non trovato' });

    // Validazione ASIN: deve essere esattamente 10 caratteri alfanumerici (B0xxxxxxxx)
    const asinFields = { asin_padre, asin_max, asin_media, asin_mini };
    for (const [key, val] of Object.entries(asinFields)) {
      if (val && val.trim() && !/^[A-Z0-9]{10}$/i.test(val.trim())) {
        return res.status(400).json({ error: `${key}: formato ASIN non valido (deve essere 10 caratteri alfanumerici, es. B0XXXXXXXXX)` });
      }
    }

    await query(`
      UPDATE products SET
        ean_max = $1, ean_media = $2, ean_mini = $3,
        immagine_max = $4, immagine_media = $5, immagine_mini = $6,
        immagine_max_2 = $7, immagine_max_3 = $8, immagine_max_4 = $9,
        immagine_media_2 = $10, immagine_media_3 = $11, immagine_media_4 = $12,
        immagine_mini_2 = $13, immagine_mini_3 = $14, immagine_mini_4 = $15,
        asin_padre = $16, asin_max = $17, asin_media = $18, asin_mini = $19
      WHERE id = $20
    `, [
      ean_max || null, ean_media || null, ean_mini || null,
      immagine_max || null, immagine_media || null, immagine_mini || null,
      immagine_max_2 || null, immagine_max_3 || null, immagine_max_4 || null,
      immagine_media_2 || null, immagine_media_3 || null, immagine_media_4 || null,
      immagine_mini_2 || null, immagine_mini_3 || null, immagine_mini_4 || null,
      asin_padre ? asin_padre.trim().toUpperCase() : null,
      asin_max   ? asin_max.trim().toUpperCase()   : null,
      asin_media ? asin_media.trim().toUpperCase() : null,
      asin_mini  ? asin_mini.trim().toUpperCase()  : null,
      id
    ]);

    const updated = await query('SELECT * FROM products WHERE id = $1', [id]);
    res.json({ success: true, product: updated.rows[0] });
  } catch (err) {
    console.error('Errore salvataggio varianti:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// POST /api/products/import-asins
// Importa ASIN dal Report Inventario Amazon (.txt TSV).
// Body JSON: { entries: [{ sku, asin }, ...] }
// Logica: sku-max → asin_max | sku-media → asin_media | sku-mini → asin_mini
// Controlla duplicati: salta se l'ASIN è già lo stesso.
// =============================================
router.post('/import-asins', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'Nessuna entry fornita' });
    }

    const results = { updated: 0, skipped: 0, not_found: 0, errors: 0, details: [] };

    for (const entry of entries) {
      const { sku, asin } = entry;
      if (!sku || !asin) continue;

      // Determina la colonna ASIN e lo SKU padre dal suffisso
      let colonna = null;
      let skuPadre = null;
      if (/-max$/i.test(sku) || /_max$/i.test(sku)) {
        colonna = 'asin_max';
        skuPadre = sku.replace(/[-_]max$/i, '');
      } else if (/-media$/i.test(sku) || /_media$/i.test(sku)) {
        colonna = 'asin_media';
        skuPadre = sku.replace(/[-_]media$/i, '');
      } else if (/-mini$/i.test(sku) || /_mini$/i.test(sku)) {
        colonna = 'asin_mini';
        skuPadre = sku.replace(/[-_]mini$/i, '');
      } else {
        // Nessun suffisso variante → è lo SKU padre, quindi → asin_padre
        colonna = 'asin_padre';
        skuPadre = sku;
      }

      // Cerca il prodotto per sku_padre (case-insensitive)
      const productRes = await query(
        `SELECT id, sku_padre, asin_padre, asin_max, asin_media, asin_mini FROM products WHERE LOWER(sku_padre) = LOWER($1)`,
        [skuPadre]
      );

      if (productRes.rows.length === 0) {
        results.not_found++;
        results.details.push({ sku, asin, status: 'not_found', msg: `SKU padre non trovato: "${skuPadre}"` });
        continue;
      }

      const product = productRes.rows[0];
      const currentAsin = product[colonna];

      // Skip se già presente e identico
      if (currentAsin && currentAsin.toUpperCase() === asin.toUpperCase()) {
        results.skipped++;
        results.details.push({ sku, asin, status: 'skipped', msg: 'Già presente' });
        continue;
      }

      // Aggiorna
      await query(`UPDATE products SET ${colonna} = $1 WHERE id = $2`, [asin.toUpperCase(), product.id]);
      results.updated++;
      results.details.push({
        sku, asin, status: 'updated',
        msg: currentAsin ? `Aggiornato: ${currentAsin} → ${asin.toUpperCase()}` : `Nuovo ASIN inserito`
      });
    }

    res.json(results);
  } catch (err) {
    console.error('Errore import ASIN:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM product_attribute_values WHERE product_id = $1', [req.params.id]);
    await query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
