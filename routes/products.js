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
// Salva EAN e URL immagini per le 3 varianti
// =============================================
router.patch('/:id/variants', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ean_max, ean_media, ean_mini,
      immagine_max, immagine_media, immagine_mini,
      immagine_max_2, immagine_max_3,
      immagine_media_2, immagine_media_3,
      immagine_mini_2, immagine_mini_3,
    } = req.body;

    const existing = await query('SELECT id FROM products WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Prodotto non trovato' });

    await query(`
      UPDATE products SET
        ean_max = $1, ean_media = $2, ean_mini = $3,
        immagine_max = $4, immagine_media = $5, immagine_mini = $6,
        immagine_max_2 = $7, immagine_max_3 = $8,
        immagine_media_2 = $9, immagine_media_3 = $10,
        immagine_mini_2 = $11, immagine_mini_3 = $12
      WHERE id = $13
    `, [
      ean_max || null, ean_media || null, ean_mini || null,
      immagine_max || null, immagine_media || null, immagine_mini || null,
      immagine_max_2 || null, immagine_max_3 || null,
      immagine_media_2 || null, immagine_media_3 || null,
      immagine_mini_2 || null, immagine_mini_3 || null,
      id
    ]);

    const updated = await query('SELECT * FROM products WHERE id = $1', [id]);
    res.json({ success: true, product: updated.rows[0] });
  } catch (err) {
    console.error('Errore salvataggio varianti:', err);
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
