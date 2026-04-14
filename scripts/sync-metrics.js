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
const { upsertAdsRows } = require('../routes/metrics');

async function runPlatform(name, fetcher, days) {
  const log = await query(
    `INSERT INTO metrics_sync_log (platform, date_from, date_to, status)
     VALUES ($1, (NOW() - ($2 || ' days')::interval)::date, NOW()::date, 'running')
     RETURNING id`,
    [name, String(days)]
  );
  const logId = log.rows[0].id;
  try {
    const rows = await fetcher(days);
    const saved = await upsertAdsRows(rows);
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

  // Google Ads e GA4 verranno aggiunti qui nelle prossime fasi.

  console.log('📊 Risultati:', JSON.stringify(results, null, 2));
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('💥 sync-metrics fatal:', err);
  process.exit(1);
});
