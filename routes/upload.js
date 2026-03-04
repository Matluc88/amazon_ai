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

router.post('/', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
    filePath = req.file.path;

    const products = parseFile(filePath);
    if (!products.length) {
      return res.status(400).json({ error: 'Nessun prodotto trovato nel file' });
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

    res.json({ success: true, count: inserted.length, products: inserted });
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
