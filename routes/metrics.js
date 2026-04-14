const express = require('express');
const { query } = require('../database/db');
const { fetchLastDays } = require('../services/metaAdsService');
const { fetchLastDays: fetchGoogleLastDays } = require('../services/googleAdsService');
const { fetchLastDays: fetchGa4LastDays } = require('../services/ga4Service');
const { fetchLastDays: fetchMatomoLastDays, fetchSources: fetchMatomoSources } = require('../services/matomoService');
const { fetchCatalogSnapshot } = require('../services/merchantService');
const { fetchLastDays: fetchWcLastDays } = require('../services/woocommerceService');

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

/**
 * POST /api/metrics/sync/google
 * Trigger manuale sync Google Ads.
 */
router.post('/sync/google', async (req, res) => {
  try {
    const days = Number(req.body.days) || 7;
    const rows = await fetchGoogleLastDays(days);
    const saved = await upsertAdsRows(rows);
    res.json({ ok: true, fetched: rows.length, saved });
  } catch (err) {
    console.error('metrics/sync/google error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/metrics/sync/ga4
 * Trigger manuale sync Google Analytics 4.
 */
router.post('/sync/ga4', async (req, res) => {
  try {
    const days = Number(req.body.days) || 7;
    const rows = await fetchGa4LastDays(days);
    const saved = await upsertGa4Rows(rows);
    res.json({ ok: true, fetched: rows.length, saved });
  } catch (err) {
    console.error('metrics/sync/ga4 error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/ga4/summary
 * Totali GA4 del periodo (sessioni / utenti / pageviews / conversioni / revenue).
 */
router.get('/ga4/summary', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT SUM(sessions)          AS sessions,
              SUM(users)             AS users,
              SUM(page_views)        AS page_views,
              SUM(conversions)       AS conversions,
              SUM(ecommerce_revenue) AS revenue
         FROM metrics_ga4_daily
        WHERE date BETWEEN $1 AND $2`,
      [from, to]
    );
    res.json({ from, to, totals: (r.rows[0] || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/ga4/daily
 * Serie temporale giornaliera GA4.
 */
router.get('/ga4/daily', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT date,
              SUM(sessions)          AS sessions,
              SUM(users)             AS users,
              SUM(page_views)        AS page_views,
              SUM(conversions)       AS conversions,
              SUM(ecommerce_revenue) AS revenue
         FROM metrics_ga4_daily
        WHERE date BETWEEN $1 AND $2
     GROUP BY date
     ORDER BY date ASC`,
      [from, to]
    );
    res.json({ from, to, rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/ga4/sources
 * Top sorgenti di traffico per il periodo.
 */
router.get('/ga4/sources', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT source,
              SUM(sessions)          AS sessions,
              SUM(users)             AS users,
              SUM(page_views)        AS page_views,
              SUM(conversions)       AS conversions,
              SUM(ecommerce_revenue) AS revenue
         FROM metrics_ga4_daily
        WHERE date BETWEEN $1 AND $2
     GROUP BY source
     ORDER BY sessions DESC
     LIMIT 50`,
      [from, to]
    );
    res.json({ from, to, sources: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/metrics/sync/matomo
 */
router.post('/sync/matomo', async (req, res) => {
  try {
    const days = Number(req.body.days) || 7;
    const rows = await fetchMatomoLastDays(days);
    const saved = await upsertMatomoRows(rows);
    res.json({ ok: true, fetched: rows.length, saved });
  } catch (err) {
    console.error('metrics/sync/matomo error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/matomo/summary
 */
router.get('/matomo/summary', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT SUM(sessions)          AS sessions,
              SUM(users)             AS users,
              SUM(page_views)        AS page_views,
              SUM(conversions)       AS conversions,
              SUM(ecommerce_revenue) AS revenue,
              AVG(NULLIF(bounce_rate,0))      AS bounce_rate,
              AVG(NULLIF(avg_time_on_site,0)) AS avg_time
         FROM metrics_matomo_daily
        WHERE date BETWEEN $1 AND $2`,
      [from, to]
    );
    res.json({ from, to, totals: (r.rows[0] || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/matomo/daily
 */
router.get('/matomo/daily', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT date,
              SUM(sessions)   AS sessions,
              SUM(users)      AS users,
              SUM(page_views) AS page_views
         FROM metrics_matomo_daily
        WHERE date BETWEEN $1 AND $2
     GROUP BY date
     ORDER BY date ASC`,
      [from, to]
    );
    res.json({ from, to, rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/matomo/sources
 * Top sorgenti dirette dalla Matomo API (range aggregato).
 */
router.get('/matomo/sources', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const sources = await fetchMatomoSources({ dateFrom: from, dateTo: to });
    res.json({ from, to, sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/metrics/sync/woocommerce
 * Scarica ordini ultimi N giorni e aggrega per data + prodotto.
 */
router.post('/sync/woocommerce', async (req, res) => {
  try {
    const days = Number(req.body.days) || 7;
    const data = await fetchWcLastDays(days);
    const saved = await saveWooCommerceData(data);
    res.json({ ok: true, days: data.dailyRows.length, products: data.productRows.length, saved });
  } catch (err) {
    console.error('metrics/sync/woocommerce error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/woocommerce/summary
 * Totali del periodo selezionato.
 */
router.get('/woocommerce/summary', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT SUM(orders_count)   AS orders_count,
              SUM(gross_revenue)  AS gross_revenue,
              SUM(discount_total) AS discount_total,
              SUM(shipping_total) AS shipping_total,
              SUM(tax_total)      AS tax_total,
              SUM(refund_total)   AS refund_total,
              SUM(items_sold)     AS items_sold,
              CASE WHEN SUM(orders_count) > 0
                   THEN SUM(gross_revenue) / SUM(orders_count)
                   ELSE 0 END AS avg_order_value
         FROM metrics_wc_orders_daily
        WHERE date BETWEEN $1 AND $2`,
      [from, to]
    );
    res.json({ from, to, totals: r.rows[0] || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/woocommerce/daily
 * Serie temporale giornaliera ordini + fatturato.
 */
router.get('/woocommerce/daily', async (req, res) => {
  try {
    const { from, to } = resolveRange(req);
    const r = await query(
      `SELECT date, orders_count, gross_revenue, items_sold, avg_order_value
         FROM metrics_wc_orders_daily
        WHERE date BETWEEN $1 AND $2
     ORDER BY date ASC`,
      [from, to]
    );
    res.json({ from, to, rows: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/woocommerce/top-products
 * Top prodotti venduti dalla tabella rolling.
 */
router.get('/woocommerce/top-products', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const r = await query(
      `SELECT product_id, product_name, sku, quantity_sold, revenue, orders_count
         FROM metrics_wc_products_recent
     ORDER BY revenue DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ products: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/metrics/sync/merchant
 * Scarica snapshot Merchant Center e lo salva in DB.
 */
router.post('/sync/merchant', async (_req, res) => {
  try {
    const snap = await fetchCatalogSnapshot();
    const saved = await saveMerchantSnapshot(snap);
    res.json({ ok: true, counts: snap.counts, issues: snap.issues.length, saved });
  } catch (err) {
    console.error('metrics/sync/merchant error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/merchant/summary
 * Ultimo snapshot + trend ultimi 30 giorni.
 */
router.get('/merchant/summary', async (_req, res) => {
  try {
    const latest = await query(
      `SELECT * FROM metrics_merchant_snapshot ORDER BY date DESC LIMIT 1`
    );
    const trend = await query(
      `SELECT date, total_products, approved, limited, disapproved, pending
         FROM metrics_merchant_snapshot
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
     ORDER BY date ASC`
    );
    res.json({ latest: latest.rows[0] || null, trend: trend.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/merchant/issues
 * Problemi correnti sul catalogo, aggregati per codice issue.
 */
router.get('/merchant/issues', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    // Top issues aggregate
    const byCode = await query(
      `SELECT issue_code,
              issue_description,
              issue_severity,
              COUNT(DISTINCT product_id) AS products_affected
         FROM metrics_merchant_issues
        WHERE issue_code IS NOT NULL
     GROUP BY issue_code, issue_description, issue_severity
     ORDER BY products_affected DESC
        LIMIT 20`
    );
    // Dettaglio singoli prodotti problematici
    const details = await query(
      `SELECT product_id, title, link, status, country, issue_code, issue_severity, issue_description
         FROM metrics_merchant_issues
        WHERE issue_code IS NOT NULL
     ORDER BY
       CASE issue_severity WHEN 'disapproved' THEN 1 WHEN 'demoted' THEN 2 ELSE 3 END,
       product_id
        LIMIT $1`,
      [limit]
    );
    res.json({ by_code: byCode.rows, details: details.rows });
  } catch (err) {
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

async function upsertMatomoRows(rows) {
  let count = 0;
  for (const r of rows) {
    await query(
      `INSERT INTO metrics_matomo_daily
         (date, site_id, source, sessions, users, page_views, conversions, ecommerce_revenue, bounce_rate, avg_time_on_site, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
       ON CONFLICT (date, site_id, source) DO UPDATE SET
         sessions          = EXCLUDED.sessions,
         users             = EXCLUDED.users,
         page_views        = EXCLUDED.page_views,
         conversions       = EXCLUDED.conversions,
         ecommerce_revenue = EXCLUDED.ecommerce_revenue,
         bounce_rate       = EXCLUDED.bounce_rate,
         avg_time_on_site  = EXCLUDED.avg_time_on_site,
         updated_at        = NOW()`,
      [r.date, r.site_id, r.source || '(all)', r.sessions, r.users, r.page_views, r.conversions, r.ecommerce_revenue, r.bounce_rate || 0, r.avg_time_on_site || 0]
    );
    count++;
  }
  return count;
}

async function upsertGa4Rows(rows) {
  let count = 0;
  for (const r of rows) {
    await query(
      `INSERT INTO metrics_ga4_daily
         (date, property_id, source, sessions, users, page_views, conversions, ecommerce_revenue, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
       ON CONFLICT (date, property_id, source) DO UPDATE SET
         sessions          = EXCLUDED.sessions,
         users             = EXCLUDED.users,
         page_views        = EXCLUDED.page_views,
         conversions       = EXCLUDED.conversions,
         ecommerce_revenue = EXCLUDED.ecommerce_revenue,
         updated_at        = NOW()`,
      [r.date, r.property_id, r.source, r.sessions, r.users, r.page_views, r.conversions, r.ecommerce_revenue]
    );
    count++;
  }
  return count;
}

async function saveMerchantSnapshot(snap) {
  const merchantId = process.env.MERCHANT_ACCOUNT_ID || 'unknown';
  const { counts, issues } = snap;

  // 1. Snapshot giornaliero (UPSERT sul giorno corrente)
  await query(
    `INSERT INTO metrics_merchant_snapshot
       (date, merchant_id, total_products, approved, limited, disapproved, pending, updated_at)
     VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (date, merchant_id) DO UPDATE SET
       total_products = EXCLUDED.total_products,
       approved       = EXCLUDED.approved,
       limited        = EXCLUDED.limited,
       disapproved    = EXCLUDED.disapproved,
       pending        = EXCLUDED.pending,
       updated_at     = NOW()`,
    [merchantId, counts.total, counts.approved, counts.limited, counts.disapproved, counts.pending]
  );

  // 2. Issue correnti: DELETE + INSERT (sempre stato attuale)
  await query(`DELETE FROM metrics_merchant_issues WHERE merchant_id = $1`, [merchantId]);

  let inserted = 0;
  for (const i of issues) {
    await query(
      `INSERT INTO metrics_merchant_issues
         (merchant_id, product_id, title, link, image_link, status, country,
          issue_code, issue_severity, issue_description, issue_detail, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
      [
        merchantId, i.product_id, i.title, i.link, i.image_link,
        i.status, i.country, i.issue_code, i.issue_severity,
        i.issue_description, i.issue_detail,
      ]
    );
    inserted++;
  }
  return inserted;
}

async function saveWooCommerceData({ dailyRows, productRows }) {
  // 1. UPSERT giornalieri
  for (const r of dailyRows) {
    await query(
      `INSERT INTO metrics_wc_orders_daily
         (date, shop_domain, orders_count, gross_revenue, discount_total, shipping_total,
          tax_total, refund_total, items_sold, avg_order_value, currency, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
       ON CONFLICT (date, shop_domain) DO UPDATE SET
         orders_count    = EXCLUDED.orders_count,
         gross_revenue   = EXCLUDED.gross_revenue,
         discount_total  = EXCLUDED.discount_total,
         shipping_total  = EXCLUDED.shipping_total,
         tax_total       = EXCLUDED.tax_total,
         refund_total    = EXCLUDED.refund_total,
         items_sold      = EXCLUDED.items_sold,
         avg_order_value = EXCLUDED.avg_order_value,
         currency        = EXCLUDED.currency,
         updated_at      = NOW()`,
      [
        r.date, r.shop_domain, r.orders_count, r.gross_revenue, r.discount_total,
        r.shipping_total, r.tax_total, r.refund_total, r.items_sold,
        r.avg_order_value, r.currency || 'EUR',
      ]
    );
  }

  // 2. Rolling top prodotti: DELETE + INSERT
  if (productRows.length) {
    const shopDomain = productRows[0].shop_domain;
    await query(`DELETE FROM metrics_wc_products_recent WHERE shop_domain = $1`, [shopDomain]);
    for (const p of productRows) {
      await query(
        `INSERT INTO metrics_wc_products_recent
           (shop_domain, product_id, product_name, sku, quantity_sold, revenue, orders_count, period_days, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())`,
        [p.shop_domain, p.product_id, p.product_name, p.sku, p.quantity_sold, p.revenue, p.orders_count, p.period_days]
      );
    }
  }
  return dailyRows.length;
}

module.exports = router;
module.exports.upsertAdsRows = upsertAdsRows;
module.exports.upsertGa4Rows = upsertGa4Rows;
module.exports.upsertMatomoRows = upsertMatomoRows;
module.exports.saveMerchantSnapshot = saveMerchantSnapshot;
module.exports.saveWooCommerceData = saveWooCommerceData;
