const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { parseFile } = require('../services/fileParser');

// Configurazione multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.xlsx', '.xls', '.csv', '.txt', '.pages'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else if (ext === '.numbers') {
    cb(new Error(
      'Il formato .numbers non è supportato direttamente.\n' +
      'In Apple Numbers: vai su File → Esporta in → Excel (.xlsx), poi carica il file .xlsx.'
    ), false);
  } else {
    cb(new Error(`Formato "${ext}" non supportato. Usa .xlsx, .csv, .txt o .pages`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max (Pages files can be larger)
});

// POST /api/upload
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nessun file caricato' });
  }

  const filePath = req.file.path;

  try {
    const products = parseFile(filePath);

    if (products.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        error: 'Il file non contiene prodotti validi. Verifica che il file abbia le colonne corrette (titolo_opera obbligatorio).'
      });
    }

    // Inserisci i prodotti nel database con transazione manuale
    const insertProduct = db.prepare(`
      INSERT INTO products (titolo_opera, autore, dimensioni, tecnica, descrizione_raw, prezzo, quantita)
      VALUES (@titolo_opera, @autore, @dimensioni, @tecnica, @descrizione_raw, @prezzo, @quantita)
    `);

    const insertedIds = [];

    db.exec('BEGIN TRANSACTION');
    try {
      for (const prod of products) {
        const result = insertProduct.run(prod);
        insertedIds.push(result.lastInsertRowid);
      }
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    // Rimuovi il file temporaneo
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: `${products.length} prodotto/i importato/i con successo`,
      count: products.length,
      ids: insertedIds,
      products: products.map((p, i) => ({
        id: insertedIds[i],
        titolo_opera: p.titolo_opera,
        autore: p.autore
      }))
    });

  } catch (error) {
    // Rimuovi il file in caso di errore
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    console.error('Errore upload:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
