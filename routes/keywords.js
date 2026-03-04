const express = require('express');
const router = express.Router();
const { getKeywordsForProduct } = require('../services/keywordService');
const db = require('../database/db');

// POST /api/keywords/mine/:productId — avvia mining con caching
router.post('/mine/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }

    const result = await getKeywordsForProduct(productId);

    res.json({
      success: true,
      product_id: productId,
      keywords: result.keywords,
      seeds_used: result.seeds_used,
      total: result.total
    });

  } catch (error) {
    console.error('Errore keyword mining:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/keywords/:productId — restituisce keywords dalla cache
router.get('/:productId', (req, res) => {
  try {
    // Raccoglie tutte le keyword cachate per i seed del prodotto
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
    if (!product) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }

    const { buildSeeds } = require('../services/keywordService');
    const seeds = buildSeeds(product);

    const allKeywords = new Set();
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    for (const seed of seeds) {
      const row = db.prepare('SELECT results_json, updated_at FROM amazon_suggest_cache WHERE seed = ?').get(seed);
      if (!row) continue;

      const updatedAt = new Date(row.updated_at).getTime();
      if (Date.now() - updatedAt > CACHE_TTL_MS) continue;

      try {
        const results = JSON.parse(row.results_json);
        results.forEach(k => allKeywords.add(k.toLowerCase().trim()));
      } catch {}
    }

    res.json({
      product_id: parseInt(req.params.productId),
      keywords: Array.from(allKeywords),
      total: allKeywords.size,
      from_cache: true
    });

  } catch (error) {
    console.error('Errore get keywords:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
