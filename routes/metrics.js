const express = require('express');
const { query } = require('../database/db');
const { fetchLastDays } = require('../services/metaAdsService');

const router = express.Router();

/**
 * Parsing periodo: ?from=YYYY-MM-DD&to=YYYY-MM-DD oppure ?range=today|yesterday|7d|30d|90d
 */
function resolveRange(req) {
  const { from, to, range } = req.query;
  if (from && to) return { from, to };
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const end = new Date(today);
  const start = new Date(today);
  switch (range) {
    case 'today':
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '90d':
      start.setDate(start.getDate() - 89);
      break;
    case '30d':
    default:
      start.setDate(start.getDate() - 29);
      break;
  }
  return { from: fmt(start), to: fmt(end) };
}

/**
 * GET /api/metrics/summary
 * Totali del periodo raggruppati per piattaforma.
 */
router.get('/summary', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT platform,
              SUM(spend)       AS spend,
              SUM(impressions) AS impressions,
              SUM(clicks)      AS clicks,
              SUM(conversions) AS conversions,
              SUM(revenue)     AS revenue
         FROM metrics_ads_daily
        WHERE date BETWEEN $1 AND $2
     GROUP BY platform
     ORDER BY platform`,
      [from, to]
    );
    res.json({ from, to, platforms: r.rows });
  } catch (err) {
    console.error('metrics/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/daily
 * Serie temporale giornaliera (spesa / click / impression) per grafico.
 */
router.get('/daily', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT date,
              platform,
              SUM(spend)       AS spend,
              SUM(impressions) AS impressions,
              SUM(clicks)      AS clicks,
              SUM(conversions) AS conversions,
              SUM(revenue)     AS revenue
         FROM metrics_ads_daily
        WHERE date BETWEEN $1 AND $2
     GROUP BY date, platform
     ORDER BY date ASC`,
      [from, to]
    );
    res.json({ from, to, rows: r.rows });
  } catch (err) {
    console.error('metrics/daily error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/campaigns
 * Lista campagne aggregate sul periodo, ordinabili/filtrabili lato client.
 */
router.get('/campaigns', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const platform = req.query.platform || null;
    const params = [from, to];
    let whereExtra = '';
    if (platform) {
      params.push(platform);
      whereExtra = ` AND platform = $3`;
    }
    const r = await query(
      `SELECT platform,
              campaign_id,
              MAX(campaign_name) AS campaign_name,
              SUM(spend)         AS spend,
              SUM(impressions)   AS impressions,
              SUM(clicks)        AS clicks,
              SUM(conversions)   AS conversions,
              SUM(revenue)       AS revenue
         FROM metrics_ads_daily
        WHERE date BETWEEN $1 AND $2 ${whereExtra}
     GROUP BY platform, campaign_id
     ORDER BY spend DESC`,
      params
    );
    res.json({ from, to, campaigns: r.rows });
  } catch (err) {
    console.error('metrics/campaigns error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/sync-log
 * Ultimi sync eseguiti (per mostrare stato/errore in UI).
 */
router.get('/sync-log', async (_req, res) => {
  try {
    const r = await query(
      `SELECT platform, started_at, finished_at, date_from, date_to, rows_synced, status, error_message
         FROM metrics_sync_log
     ORDER BY started_at DESC
        LIMIT 20`
    );
    res.json({ logs: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/metrics/sync/meta
 * Trigger manuale sync Meta (utile per test dalla UI).
 * Body: { days?: number }
 */
router.post('/sync/meta', async (req, res) => {
  try {
    const days = Number(req.body.days) || 7;
    const rows = await fetchLastDays(days);
    const saved = await upsertAdsRows(rows);
    res.json({ ok: true, fetched: rows.length, saved });
  } catch (err) {
    console.error('metrics/sync/meta error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function upsertAdsRows(rows) {
  let count = 0;
  for (const r of rows) {
    await query(
      `INSERT INTO metrics_ads_daily
         (date, platform, account_id, campaign_id, campaign_name,
          spend, impressions, clicks, conversions, revenue, currency, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
       ON CONFLICT (date, platform, campaign_id) DO UPDATE SET
         account_id    = EXCLUDED.account_id,
         campaign_name = EXCLUDED.campaign_name,
         spend         = EXCLUDED.spend,
         impressions   = EXCLUDED.impressions,
         clicks        = EXCLUDED.clicks,
         conversions   = EXCLUDED.conversions,
         revenue       = EXCLUDED.revenue,
         currency      = EXCLUDED.currency,
         updated_at    = NOW()`,
      [
        r.date, r.platform, r.account_id, r.campaign_id, r.campaign_name,
        r.spend, r.impressions, r.clicks, r.conversions, r.revenue, r.currency,
      ]
    );
    count++;
  }
  return count;
}

module.exports = router;
module.exports.upsertAdsRows = upsertAdsRows;
