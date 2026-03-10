const express = require('express');
const router  = express.Router();
const { exportProductToXlsm, exportAllProductsToXlsm } = require('../services/exportService');

/**
 * GET /api/export/all
 * Genera e scarica un unico WALL_ART.xlsm con TUTTI i prodotti che hanno listing compilato.
 */
router.get('/all', async (req, res) => {
  try {
    const { buffer, filename, count } = await exportAllProductsToXlsm();

    res.setHeader('Content-Type',
      'application/vnd.ms-excel.sheet.macroEnabled.12');
    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Product-Count', count);
    res.end(buffer);
  } catch (err) {
    console.error('❌ Export ALL error:', err.message);
    res.status(500).json({ error: err.message || 'Errore durante l\'export' });
  }
});

/**
 * GET /api/export/:productId
 * Genera e scarica il file WALL_ART.xlsm compilato con i dati del prodotto.
 */
router.get('/:productId', async (req, res) => {
  const productId = parseInt(req.params.productId);
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'ID prodotto non valido' });
  }

  try {
    const { buffer, filename } = await exportProductToXlsm(productId);

    res.setHeader('Content-Type',
      'application/vnd.ms-excel.sheet.macroEnabled.12');
    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error('❌ Export error:', err.message);
    res.status(500).json({ error: err.message || 'Errore durante l\'export' });
  }
});

module.exports = router;
