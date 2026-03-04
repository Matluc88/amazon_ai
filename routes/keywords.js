const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { getKeywordsForProduct } = require('../services/keywordService');

// POST /api/keywords/mine/:productId — esegui mining
router.post('/mine/:productId', async (req, res) => {
  try {
    const prodResult = await query('SELECT * FROM products WHERE id = $1', [req.params.productId]);
    if (!prodResult.rows[0]) return res.status(404).json({ error: 'Prodotto non trovato' });

    const { keywords, seeds_used } = await getKeywordsForProduct(req.params.productId, prodResult.rows[0]);
    res.json({ success: true, keywords, seeds_used, total: keywords.length });
  } catch (err) {
    console.error('Errore mining keywords:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keywords/:productId — keyword in cache (senza nuove chiamate)
router.get('/:productId', async (req, res) => {
  try {
    const result = await query(
      `SELECT results_json FROM amazon_suggest_cache 
       WHERE seed LIKE $1 ORDER BY updated_at DESC LIMIT 50`,
      [`%${req.params.productId}%`]
    );
    const all = [];
    for (const row of result.rows) {
      try { all.push(...JSON.parse(row.results_json)); } catch {}
    }
    res.json({ keywords: [...new Set(all)].slice(0, 50) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
