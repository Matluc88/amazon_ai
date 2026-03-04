const express = require('express');
const router = express.Router();
const { query } = require('../database/db');

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
