const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { query } = require('../database/db');
const { parseCerebroCSV, importKeywordsToCluster } = require('../services/cerebroService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // max 20MB
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(csv|txt)$/i)) {
      return cb(new Error('Solo file CSV accettati'));
    }
    cb(null, true);
  },
});

// ─── CLUSTERS ─────────────────────────────────────────────────────────────────

// GET /api/cerebro/clusters — lista tutti i cluster con statistiche
router.get('/clusters', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        c.*,
        COUNT(k.id)                                       AS total_keywords,
        COUNT(k.id) FILTER (WHERE k.status = 'approved') AS approved_keywords,
        COUNT(k.id) FILTER (WHERE k.status = 'pending')  AS pending_keywords,
        COUNT(k.id) FILTER (WHERE k.tier = 'title')      AS title_keywords,
        COUNT(k.id) FILTER (WHERE k.tier = 'bullet')     AS bullet_keywords,
        COUNT(k.id) FILTER (WHERE k.tier = 'backend')    AS backend_keywords
      FROM cerebro_clusters c
      LEFT JOIN cerebro_keywords k ON k.cluster_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[Cerebro] Errore get clusters:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cerebro/clusters — crea un nuovo cluster
router.post('/clusters', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome cluster obbligatorio' });

    const result = await query(
      `INSERT INTO cerebro_clusters (name, description) VALUES ($1, $2) RETURNING *`,
      [name.trim(), description?.trim() || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Cerebro] Errore crea cluster:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cerebro/clusters/:id — aggiorna nome/descrizione cluster
router.patch('/clusters/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome obbligatorio' });

    const result = await query(
      `UPDATE cerebro_clusters SET name = $1, description = $2 WHERE id = $3 RETURNING *`,
      [name.trim(), description?.trim() || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Cluster non trovato' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cerebro/clusters/:id — elimina cluster (e tutte le sue keyword)
router.delete('/clusters/:id', async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM cerebro_clusters WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Cluster non trovato' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CSV UPLOAD ────────────────────────────────────────────────────────────────

// POST /api/cerebro/upload — carica e importa un CSV Cerebro
router.post('/upload', upload.single('csv'), async (req, res) => {
  try {
    const { cluster_id } = req.body;
    if (!cluster_id) return res.status(400).json({ error: 'cluster_id obbligatorio' });
    if (!req.file)   return res.status(400).json({ error: 'File CSV mancante' });

    // Verifica che il cluster esista
    const clusterRes = await query('SELECT id FROM cerebro_clusters WHERE id = $1', [cluster_id]);
    if (!clusterRes.rows[0]) return res.status(404).json({ error: 'Cluster non trovato' });

    // Parsa il CSV
    const { keywords, skipped, total } = parseCerebroCSV(req.file.buffer);

    if (keywords.length === 0) {
      return res.status(400).json({
        error: `Nessuna keyword valida trovata nel CSV (${total} righe analizzate, ${skipped} escluse per filtri). Verifica che il file sia in formato Cerebro Helium 10 e che volume ≥ 300.`,
      });
    }

    // Importa nel DB
    const { imported, updated } = await importKeywordsToCluster(
      parseInt(cluster_id),
      keywords,
      req.file.originalname
    );

    res.json({
      success: true,
      imported,
      updated,
      skipped,
      total,
      message: `✅ ${imported} nuove keyword importate, ${updated} aggiornate, ${skipped} escluse dai filtri automatici.`,
    });
  } catch (err) {
    console.error('[Cerebro] Errore upload CSV:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── KEYWORDS ─────────────────────────────────────────────────────────────────

// GET /api/cerebro/keywords/:clusterId — keyword del cluster con filtri
router.get('/keywords/:clusterId', async (req, res) => {
  try {
    const { status, tier, sort = 'volume', order = 'desc', limit = 500, offset = 0 } = req.query;

    let where = 'WHERE k.cluster_id = $1';
    const params = [req.params.clusterId];

    if (status && status !== 'all') {
      params.push(status);
      where += ` AND k.status = $${params.length}`;
    }
    if (tier && tier !== 'all') {
      if (tier === 'none') {
        where += ` AND k.tier IS NULL`;
      } else {
        params.push(tier);
        where += ` AND k.tier = $${params.length}`;
      }
    }

    const sortCol = {
      volume:  'k.search_volume',
      iq:      'k.cerebro_iq',
      density: 'k.title_density',
      trend:   'k.volume_trend',
      keyword: 'k.keyword',
    }[sort] || 'k.search_volume';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    params.push(parseInt(limit), parseInt(offset));

    const result = await query(`
      SELECT k.*
      FROM cerebro_keywords k
      ${where}
      ORDER BY ${sortCol} ${sortDir} NULLS LAST, k.keyword ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Conta totale per pagination
    const countRes = await query(`
      SELECT COUNT(*) FROM cerebro_keywords k ${where}
    `, params.slice(0, params.length - 2));

    res.json({ keywords: result.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) {
    console.error('[Cerebro] Errore get keywords:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cerebro/keywords/:id — aggiorna status e/o tier di una keyword
router.patch('/keywords/:id', async (req, res) => {
  try {
    const { status, tier } = req.body;

    const valid_status = ['pending', 'approved', 'rejected'];
    const valid_tier   = ['title', 'bullet', 'backend', null];

    if (status !== undefined && !valid_status.includes(status)) {
      return res.status(400).json({ error: `Status non valido. Usa: ${valid_status.join(', ')}` });
    }
    if (tier !== undefined && !valid_tier.includes(tier)) {
      return res.status(400).json({ error: `Tier non valido. Usa: title, bullet, backend o null` });
    }

    const updates  = [];
    const params   = [];

    if (status !== undefined) { params.push(status); updates.push(`status = $${params.length}`); }
    if (tier    !== undefined) { params.push(tier);   updates.push(`tier   = $${params.length}`); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });

    params.push(req.params.id);
    const result = await query(
      `UPDATE cerebro_keywords SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Keyword non trovata' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cerebro/keywords/bulk — aggiornamento massivo
router.patch('/keywords/bulk', async (req, res) => {
  try {
    const { ids, status, tier } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids deve essere un array non vuoto' });
    }

    const updates = [];
    const params  = [ids];

    if (status !== undefined) { params.push(status); updates.push(`status = $${params.length}`); }
    if (tier    !== undefined) { params.push(tier);   updates.push(`tier   = $${params.length}`); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });

    const result = await query(
      `UPDATE cerebro_keywords SET ${updates.join(', ')} WHERE id = ANY($1) RETURNING id`,
      params
    );
    res.json({ success: true, updated: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cerebro/keywords/bulk — elimina keyword massivamente
router.delete('/keywords/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids deve essere un array non vuoto' });
    }
    await query(`DELETE FROM cerebro_keywords WHERE id = ANY($1)`, [ids]);
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ASSOCIAZIONE PRODOTTO ─────────────────────────────────────────────────────

// PATCH /api/cerebro/products/:productId/cluster — associa un cluster a un prodotto
router.patch('/products/:productId/cluster', async (req, res) => {
  try {
    const { cluster_id } = req.body; // null per dissociare
    const result = await query(
      `UPDATE products SET cerebro_cluster_id = $1 WHERE id = $2 RETURNING id, cerebro_cluster_id`,
      [cluster_id || null, req.params.productId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Prodotto non trovato' });
    res.json({ success: true, cerebro_cluster_id: result.rows[0].cerebro_cluster_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
