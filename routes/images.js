/**
 * Route: POST /api/images/upload
 *
 * Riceve un file immagine (multipart/form-data),
 * lo carica su Cloudinary e restituisce l'URL pubblico.
 *
 * Body form-data:
 *   image   {File}    - File immagine (jpg/png/webp, max 10MB)
 *   folder  {string}  - Sottocartella Cloudinary (opzionale, default: 'amazon-ai')
 *   name    {string}  - Nome file pubblico (opzionale, default: timestamp)
 */
const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');
const { uploadImage, isConfigured } = require('../services/cloudinaryService');

const router = express.Router();

// Multer in memoria (nessun file su disco) — max 25 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif|bmp|tiff)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo file non supportato. Usa JPG, PNG o WebP.'));
    }
  },
});

// POST /api/images/upload
router.post('/upload', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // Gestione esplicita MulterError (es. file troppo grande)
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File troppo grande. Dimensione massima consentita: 25 MB.' });
      }
      return res.status(400).json({ error: err.message || 'Errore upload file' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({
        error: 'Cloudinary non configurato. Aggiungi CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET nelle variabili d\'ambiente.',
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file ricevuto' });
    }

    const folder    = req.body.folder || 'amazon-ai';
    const publicId  = (req.body.name || Date.now().toString())
      .replace(/\.[^.]+$/, '')          // rimuovi estensione se presente
      .replace(/[^a-zA-Z0-9_-]/g, '_'); // sanitize

    // Comprimi se il file supera 9 MB (limite Cloudinary free plan: 10 MB)
    const CLOUDINARY_MAX = 9 * 1024 * 1024; // 9 MB margine sicurezza
    let imageBuffer = req.file.buffer;
    if (imageBuffer.length > CLOUDINARY_MAX) {
      imageBuffer = await sharp(imageBuffer)
        .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      // Secondo passaggio se ancora troppo grande
      if (imageBuffer.length > CLOUDINARY_MAX) {
        imageBuffer = await sharp(imageBuffer).jpeg({ quality: 70 }).toBuffer();
      }
      console.log(`[images] Compressa: ${req.file.size} → ${imageBuffer.length} byte`);
    }

    const url = await uploadImage(imageBuffer, publicId, folder);

    res.json({ url });
  } catch (err) {
    console.error('[images] Upload error:', err.message);
    res.status(500).json({ error: err.message || 'Errore durante l\'upload' });
  }
});

module.exports = router;
