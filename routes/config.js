const express = require('express');
const router = express.Router();
const { query } = require('../database/db');

// GET /api/config/attributes — tutti gli attributi con valori fissi
router.get('/attributes', async (req, res) => {
  try {
    const result = await query(`
      SELECT ad.*, afv.value AS fixed_value
      FROM attribute_definitions ad
      LEFT JOIN attribute_fixed_values afv ON afv.attribute_id = ad.id
      ORDER BY ad.ordine
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config/attributes/:id — aggiorna source e/o valore fisso
router.put('/attributes/:id', async (req, res) => {
  try {
    const { source, fixed_value } = req.body;

    if (source) {
      await query('UPDATE attribute_definitions SET source = $1 WHERE id = $2', [source, req.params.id]);
    }

    if (fixed_value !== undefined) {
      await query(`
        INSERT INTO attribute_fixed_values (attribute_id, value)
        VALUES ($1, $2)
        ON CONFLICT (attribute_id) DO UPDATE SET value = EXCLUDED.value
      `, [req.params.id, fixed_value]);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
