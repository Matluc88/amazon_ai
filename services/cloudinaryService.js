/**
 * Cloudinary Service — Gestisce l'upload di immagini su Cloudinary
 * e restituisce URL pubblici permanenti per il template Amazon.
 *
 * Variabili d'ambiente richieste:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Carica un'immagine (buffer) su Cloudinary e ritorna l'URL pubblico HTTPS.
 *
 * @param {Buffer} fileBuffer   - Buffer del file immagine
 * @param {string} publicId     - ID pubblico (nome file senza estensione)
 * @param {string} folder       - Cartella Cloudinary (default: 'amazon-ai')
 * @returns {Promise<string>}   - URL HTTPS dell'immagine caricata
 */
function uploadImage(fileBuffer, publicId, folder = 'amazon-ai') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: 'image',
        transformation: [
          { quality: 'auto:good', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

/**
 * Verifica che le credenziali Cloudinary siano configurate.
 * @returns {boolean}
 */
function isConfigured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

module.exports = { uploadImage, isConfigured };
