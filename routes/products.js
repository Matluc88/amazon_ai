const express = require('express');
const router = express.Router();
const db = require('../database/db');

// GET /api/products — tutti i prodotti con info listing
router.get('/', (req, res) => {
  try {
    const products = db.prepare(`
      SELECT 
        p.*,
        al.id as listing_id,
        al.titolo as listing_titolo,
        al.updated_at as listing_updated_at
      FROM products p
      LEFT JOIN amazon_listings al ON al.product_id = p.id
      ORDER BY p.created_at DESC
    `).all();

    res.json(products);
  } catch (error) {
    console.error('Errore get products:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/:id — singolo prodotto
router.get('/:id', (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }
    res.json(product);
  } catch (error) {
    console.error('Errore get product:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/products/:id — elimina prodotto e listing associato
router.delete('/:id', (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }

    db.prepare('DELETE FROM amazon_listings WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);

    res.json({ success: true, message: 'Prodotto eliminato con successo' });
  } catch (error) {
    console.error('Errore delete product:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
