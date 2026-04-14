// Script eseguito dal cron Render (o manualmente) per sincronizzare le metriche.
//
// Uso:
//   node scripts/sync-metrics.js          # ultimi 7 giorni (default)
//   node scripts/sync-metrics.js 90       # ultimi 90 giorni (backfill iniziale)
//
// Scarica insights da ogni piattaforma configurata e fa UPSERT su metrics_ads_daily.

require('dotenv').config();
const { pool, query, initDatabase } = require('../database/db');
const { fetchLastDays: fetchMeta } = require('../services/metaAdsService');
const { fetchLastDays: fetchGoogle } = require('../services/googleAdsService');
const { fetchLastDays: fetchGA4 } = require('../services/ga4Service');
const { fetchLastDays: fetchMatomo } = require('../services/matomoService');
const { fetchCatalogSnapshot } = require('../services/merchantService');
const { upsertAdsRows, upsertGa4Rows, upsertMatomoRows, saveMerchantSnapshot } = require('../routes/metrics');

async function runPlatform(name, fetcher, days, upsertFn = upsertAdsRows) {
  const log = await query(
    `INSERT INTO metrics_sync_log (platform, date_from, date_to, status)
     VALUES ($1, (NOW() - ($2 || ' days')::interval)::date, NOW()::date, 'running')
     RETURNING id`,
    [name, String(days)]
  );
  const logId = log.rows[0].id;
  try {
    const rows = await fetcher(days);
    const saved = await upsertFn(rows);
    await query(
      `UPDATE metrics_sync_log
          SET finished_at = NOW(), rows_synced = $1, status = 'ok'
        WHERE id = $2`,
      [saved, logId]
    );
    console.log(`✅ [${name}] sync OK — ${saved} righe`);
    return { platform: name, saved };
  } catch (err) {
    await query(
      `UPDATE metrics_sync_log
          SET finished_at = NOW(), status = 'error', error_message = $1
        WHERE id = $2`,
      [String(err.message).slice(0, 1000), logId]
    );
    console.error(`❌ [${name}] sync FAILED: ${err.message}`);
    return { platform: name, error: err.message };
  }
}

async function main() {
  const days = Number(process.argv[2]) || 7;
  console.log(`🔄 Sync metriche — ultimi ${days} giorni`);

  await initDatabase();

  const results = [];

  if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
    results.push(await runPlatform('meta', fetchMeta, days));
  } else {
    console.log('⏭️  Meta: skip (credenziali mancanti)');
  }

  if (process.env.GOOGLE_ADS_REFRESH_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID && process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    results.push(await runPlatform('google', fetchGoogle, days));
  } else {
    console.log('⏭️  Google Ads: skip (credenziali mancanti — manca refresh token?)');
  }

  if (process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_KEY_B64) {
    results.push(await runPlatform('ga4', fetchGA4, days, upsertGa4Rows));
  } else {
    console.log('⏭️  GA4: skip (credenziali mancanti)');
  }

  if (process.env.MATOMO_URL && process.env.MATOMO_AUTH_TOKEN) {
    results.push(await runPlatform('matomo', fetchMatomo, days, upsertMatomoRows));
  } else {
    console.log('⏭️  Matomo: skip (credenziali mancanti)');
  }

  if (process.env.MERCHANT_ACCOUNT_ID && (process.env.MERCHANT_SERVICE_ACCOUNT_KEY_B64 || process.env.GA4_SERVICE_ACCOUNT_KEY_B64)) {
    const log = await query(
      `INSERT INTO metrics_sync_log (platform, date_from, date_to, status)
       VALUES ('merchant', NOW()::date, NOW()::date, 'running') RETURNING id`
    );
    const logId = log.rows[0].id;
    try {
      const snap = await fetchCatalogSnapshot();
      const saved = await saveMerchantSnapshot(snap);
      await query(
        `UPDATE metrics_sync_log SET finished_at = NOW(), rows_synced = $1, status = 'ok' WHERE id = $2`,
        [saved, logId]
      );
      console.log(`✅ [merchant] sync OK — ${snap.counts.total} prodotti, ${snap.counts.disapproved} disapprovati, ${snap.issues.length} issue`);
      results.push({ platform: 'merchant', saved, counts: snap.counts });
    } catch (err) {
      await query(
        `UPDATE metrics_sync_log SET finished_at = NOW(), status = 'error', error_message = $1 WHERE id = $2`,
        [String(err.message).slice(0, 1000), logId]
      );
      console.error(`❌ [merchant] sync FAILED: ${err.message}`);
      results.push({ platform: 'merchant', error: err.message });
    }
  } else {
    console.log('⏭️  Merchant: skip (credenziali mancanti)');
  }

  console.log('📊 Risultati:', JSON.stringify(results, null, 2));
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('💥 sync-metrics fatal:', err);
  process.exit(1);
});
