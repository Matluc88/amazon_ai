const express = require('express');
const router = express.Router();
const db = require('../database/db');
const {
  generateFullListing,
  regenerateTitle,
  regenerateBulletPoints,
  regenerateDescription
} = require('../services/anthropicService');

// GET /api/listings — tutti i listing con dati prodotto
router.get('/', (req, res) => {
  try {
    const listings = db.prepare(`
      SELECT 
        al.*,
        p.titolo_opera,
        p.autore,
        p.dimensioni,
        p.tecnica,
        p.descrizione_raw,
        p.created_at as product_created_at
      FROM amazon_listings al
      JOIN products p ON p.id = al.product_id
      ORDER BY al.updated_at DESC
    `).all();

    res.json(listings);
  } catch (error) {
    console.error('Errore get listings:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/listings/:id — singolo listing con dati prodotto
router.get('/:id', (req, res) => {
  try {
    const listing = db.prepare(`
      SELECT 
        al.*,
        p.titolo_opera,
        p.autore,
        p.dimensioni,
        p.tecnica,
        p.descrizione_raw,
        p.created_at as product_created_at
      FROM amazon_listings al
      JOIN products p ON p.id = al.product_id
      WHERE al.id = ?
    `).get(req.params.id);

    if (!listing) {
      return res.status(404).json({ error: 'Listing non trovato' });
    }

    res.json(listing);
  } catch (error) {
    console.error('Errore get listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/listings/generate/:productId — genera listing completo con AI
router.post('/generate/:productId', async (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
    if (!product) {
      return res.status(404).json({ error: 'Prodotto non trovato' });
    }

    // Genera il listing con Claude
    const generated = await generateFullListing(product);

    // Controlla se esiste già un listing per questo prodotto
    const existing = db.prepare('SELECT id FROM amazon_listings WHERE product_id = ?').get(product.id);

    let listingId;

    if (existing) {
      // Aggiorna il listing esistente
      db.prepare(`
        UPDATE amazon_listings SET
          titolo = @titolo,
          descrizione = @descrizione,
          bp1 = @bp1,
          bp2 = @bp2,
          bp3 = @bp3,
          bp4 = @bp4,
          bp5 = @bp5,
          parole_chiave = @parole_chiave,
          prezzo = @prezzo,
          quantita = @quantita,
          updated_at = CURRENT_TIMESTAMP
        WHERE product_id = @product_id
      `).run({
        ...generated,
        prezzo: product.prezzo,
        quantita: product.quantita,
        product_id: product.id
      });
      listingId = existing.id;
    } else {
      // Crea nuovo listing
      const result = db.prepare(`
        INSERT INTO amazon_listings 
          (product_id, titolo, descrizione, bp1, bp2, bp3, bp4, bp5, parole_chiave, prezzo, quantita)
        VALUES 
          (@product_id, @titolo, @descrizione, @bp1, @bp2, @bp3, @bp4, @bp5, @parole_chiave, @prezzo, @quantita)
      `).run({
        product_id: product.id,
        ...generated,
        prezzo: product.prezzo,
        quantita: product.quantita
      });
      listingId = result.lastInsertRowid;
    }

    const listing = db.prepare('SELECT * FROM amazon_listings WHERE id = ?').get(listingId);
    res.json({ success: true, listing });

  } catch (error) {
    console.error('Errore generazione listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/listings/:id — aggiorna manualmente i campi
router.put('/:id', (req, res) => {
  try {
    const listing = db.prepare('SELECT * FROM amazon_listings WHERE id = ?').get(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Listing non trovato' });
    }

    const { titolo, descrizione, bp1, bp2, bp3, bp4, bp5, parole_chiave, prezzo, quantita } = req.body;

    db.prepare(`
      UPDATE amazon_listings SET
        titolo = COALESCE(@titolo, titolo),
        descrizione = COALESCE(@descrizione, descrizione),
        bp1 = COALESCE(@bp1, bp1),
        bp2 = COALESCE(@bp2, bp2),
        bp3 = COALESCE(@bp3, bp3),
        bp4 = COALESCE(@bp4, bp4),
        bp5 = COALESCE(@bp5, bp5),
        parole_chiave = COALESCE(@parole_chiave, parole_chiave),
        prezzo = COALESCE(@prezzo, prezzo),
        quantita = COALESCE(@quantita, quantita),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ titolo, descrizione, bp1, bp2, bp3, bp4, bp5, parole_chiave, prezzo, quantita, id: req.params.id });

    const updated = db.prepare('SELECT * FROM amazon_listings WHERE id = ?').get(req.params.id);
    res.json({ success: true, listing: updated });

  } catch (error) {
    console.error('Errore update listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/listings/:id/regenerate — rigenera un campo specifico
router.post('/:id/regenerate', async (req, res) => {
  try {
    const { field } = req.body;

    if (!field || !['titolo', 'bullet_points', 'descrizione'].includes(field)) {
      return res.status(400).json({
        error: 'Campo non valido. Usa: titolo, bullet_points, o descrizione'
      });
    }

    const listing = db.prepare(`
      SELECT al.*, p.* FROM amazon_listings al
      JOIN products p ON p.id = al.product_id
      WHERE al.id = ?
    `).get(req.params.id);

    if (!listing) {
      return res.status(404).json({ error: 'Listing non trovato' });
    }

    const product = {
      id: listing.product_id,
      titolo_opera: listing.titolo_opera,
      autore: listing.autore,
      dimensioni: listing.dimensioni,
      tecnica: listing.tecnica,
      descrizione_raw: listing.descrizione_raw,
      prezzo: listing.prezzo,
      quantita: listing.quantita
    };

    let generated = {};

    if (field === 'titolo') {
      generated = await regenerateTitle(product, listing);
    } else if (field === 'bullet_points') {
      generated = await regenerateBulletPoints(product, listing);
    } else if (field === 'descrizione') {
      generated = await regenerateDescription(product, listing);
    }

    // Aggiorna solo i campi rigenerati
    const updateFields = Object.keys(generated).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`
      UPDATE amazon_listings SET ${updateFields}, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...generated, id: req.params.id });

    const updated = db.prepare('SELECT * FROM amazon_listings WHERE id = ?').get(req.params.id);
    res.json({ success: true, listing: updated, regenerated: field });

  } catch (error) {
    console.error('Errore rigenerazione:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/listings/:id
router.delete('/:id', (req, res) => {
  try {
    const listing = db.prepare('SELECT * FROM amazon_listings WHERE id = ?').get(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Listing non trovato' });
    }
    db.prepare('DELETE FROM amazon_listings WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Listing eliminato' });
  } catch (error) {
    console.error('Errore delete listing:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
