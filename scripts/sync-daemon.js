// Daemon locale che processa la coda sync_requests.
//
// Usato per integrazioni che vengono BLOCCATE se chiamate direttamente dal
// server Render (es. WooCommerce protetto da SG Security di SiteGround).
// L'IP del Mac è whitelistato dal sito, quindi il daemon chiama WC da qui.
//
// Flusso:
//   1. Il bottone sulla dashboard (Render) scrive una riga in sync_requests
//      con status='pending'
//   2. Questo daemon fa polling ogni POLL_INTERVAL_MS secondi, vede le richieste
//      pending, le esegue, aggiorna lo stato
//   3. La dashboard fa polling su /sync/status/:id e aggiorna la UI quando
//      lo stato passa a 'ok' o 'error'
//
// Uso:
//   node scripts/sync-daemon.js
//
// Oppure in background via launchd (vedi scripts/com.sivigliart.sync-daemon.plist)

require('dotenv').config();
const { query, pool } = require('../database/db');
const { fetchLastDays: fetchWc } = require('../services/woocommerceService');
const { saveWooCommerceData } = require('../routes/metrics');

const POLL_INTERVAL_MS = 10_000; // 10 secondi
const DAEMON_VERSION = '1.0.0';

let running = true;

async function processRequest(req) {
  const { id, platform, days } = req;
  console.log(`[${new Date().toISOString()}] 🔄 Processo richiesta #${id} platform=${platform} days=${days}`);

  // Marca come running
  await query(
    `UPDATE sync_requests SET status = 'running', picked_at = NOW() WHERE id = $1`,
    [id]
  );

  try {
    let saved = 0;
    if (platform === 'woocommerce') {
      const data = await fetchWc(days || 7);
      saved = await saveWooCommerceData(data);
    } else {
      throw new Error(`Platform non gestita dal daemon: ${platform}`);
    }

    await query(
      `UPDATE sync_requests
          SET status = 'ok', finished_at = NOW(), rows_synced = $1
        WHERE id = $2`,
      [saved, id]
    );
    console.log(`[${new Date().toISOString()}] ✅ #${id} OK — ${saved} righe`);
  } catch (err) {
    await query(
      `UPDATE sync_requests
          SET status = 'error', finished_at = NOW(), error_message = $1
        WHERE id = $2`,
      [String(err.message).slice(0, 1000), id]
    );
    console.error(`[${new Date().toISOString()}] ❌ #${id} FAILED: ${err.message}`);
  }
}

async function loop() {
  while (running) {
    try {
      // Prende la prima richiesta pending per una piattaforma supportata
      const r = await query(
        `SELECT id, platform, days
           FROM sync_requests
          WHERE status = 'pending'
            AND platform IN ('woocommerce')
       ORDER BY requested_at ASC
          LIMIT 1`
      );
      if (r.rows.length > 0) {
        await processRequest(r.rows[0]);
        continue; // Rientra subito per processare altre richieste in coda
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ⚠️  Polling error: ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function shutdown(signal) {
  console.log(`\n[${new Date().toISOString()}] 📴 Ricevuto ${signal}, arresto daemon...`);
  running = false;
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[${new Date().toISOString()}] 🚀 Sync daemon v${DAEMON_VERSION} avviato`);
console.log(`   Polling ogni ${POLL_INTERVAL_MS / 1000}s sulla tabella sync_requests`);
console.log(`   Platform supportate: woocommerce`);
console.log(`   Premi Ctrl+C per fermare`);

loop().catch((err) => {
  console.error('💥 Errore fatale:', err);
  process.exit(1);
});
