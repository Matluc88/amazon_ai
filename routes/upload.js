const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseFile } = require('../services/fileParser');
const { query } = require('../database/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `upload_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv', '.txt', '.pages'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.numbers') {
      return cb(new Error('File .numbers non supportato. Esporta come Excel da Numbers: File → Esporta in → Excel'));
    }
    if (!allowed.includes(ext)) {
      return cb(new Error(`Formato non supportato: ${ext}. Usa .xlsx, .csv, .txt o .pages`));
    }
    cb(null, true);
  }
});

// =============================================
// POST /api/upload/catalog
// Importa catalogo Sivigliart (XLSX/CSV con varianti)
// UPSERT su sku_max: aggiorna misure/prezzi/SKU senza toccare la descrizione
// =============================================
router.post('/catalog', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
    filePath = req.file.path;

    const { isCatalog, products } = parseFile(filePath);

    if (!products || products.length === 0) {
      return res.status(400).json({ error: 'Nessun prodotto trovato nel file' });
    }

    if (!isCatalog) {
      return res.status(400).json({
        error: 'Il file non sembra un catalogo Sivigliart. Controlla che contenga le colonne Titolo, Misura, Prezzo, SKU varianti.'
      });
    }

    let inserted = 0;
    let updated = 0;

    for (const p of products) {
      if (!p.sku_max) continue; // Salta prodotti senza SKU max

      // Verifica se esiste già
      const existing = await query(
        'SELECT id FROM products WHERE sku_max = $1',
        [p.sku_max]
      );

      if (existing.rows.length > 0) {
        // AGGIORNA — solo misure/prezzi/SKU, NON toccare descrizione_raw
        await query(`
          UPDATE products SET
            titolo_opera = $1,
            dimensioni = $2,
            tecnica = $3,
            prezzo = $4,
            sku_padre = $5,
            misura_max = $6, prezzo_max = $7, sku_max = $8,
            misura_media = $9, prezzo_media = $10, sku_media = $11,
            misura_mini = $12, prezzo_mini = $13, sku_mini = $14
          WHERE sku_max = $8
        `, [
          p.titolo_opera,
          p.dimensioni,
          p.tecnica || 'Stampa su tela',
          p.prezzo,
          p.sku_padre,
          p.misura_max, p.prezzo_max, p.sku_max,
          p.misura_media, p.prezzo_media, p.sku_media,
          p.misura_mini, p.prezzo_mini, p.sku_mini
        ]);
        updated++;
      } else {
        // INSERISCE — nuovo prodotto
        await query(`
          INSERT INTO products (
            titolo_opera, autore, dimensioni, tecnica,
            descrizione_raw, prezzo, quantita, created_by,
            sku_padre,
            misura_max, prezzo_max, sku_max,
            misura_media, prezzo_media, sku_media,
            misura_mini, prezzo_mini, sku_mini
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9,
            $10, $11, $12,
            $13, $14, $15,
            $16, $17, $18
          )
        `, [
          p.titolo_opera, p.autore || null, p.dimensioni, p.tecnica || 'Stampa su tela',
          null, p.prezzo, 1, req.session?.userId || null,
          p.sku_padre,
          p.misura_max, p.prezzo_max, p.sku_max,
          p.misura_media, p.prezzo_media, p.sku_media,
          p.misura_mini, p.prezzo_mini, p.sku_mini
        ]);
        inserted++;
      }
    }

    res.json({
      success: true,
      inserted,
      updated,
      total: products.length,
      message: `✅ Catalogo importato: ${inserted} nuovi prodotti, ${updated} aggiornati`
    });

  } catch (err) {
    console.error('Errore upload catalogo:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
});

// =============================================
// POST /api/upload
// Upload testo libero o file tabellare generico (1 prodotto)
// =============================================
router.post('/', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
    filePath = req.file.path;

    const { isCatalog, products } = parseFile(filePath);

    if (!products || products.length === 0) {
      return res.status(400).json({ error: 'Nessun prodotto trovato nel file' });
    }

    // Se è stato caricato un catalogo per errore su questo endpoint, avvisa
    if (isCatalog) {
      return res.status(400).json({
        error: 'Questo file sembra un catalogo con varianti. Usa il tab "Catalogo XLSX/CSV" per importarlo.'
      });
    }

    const inserted = [];
    for (const p of products) {
      const result = await query(
        `INSERT INTO products (titolo_opera, autore, dimensioni, tecnica, descrizione_raw, prezzo, quantita, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [p.titolo_opera, p.autore || null, p.dimensioni || null, p.tecnica || null,
         p.descrizione_raw || null, p.prezzo || null, p.quantita || 1, req.session?.userId || null]
      );
      inserted.push(result.rows[0]);
    }

    res.json({
      success: true,
      count: inserted.length,
      products: inserted,
      message: `${inserted.length} prodotto${inserted.length !== 1 ? 'i' : ''} importato${inserted.length !== 1 ? 'i' : ''}!`
    });
  } catch (err) {
    console.error('Errore upload:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
});

module.exports = router;
