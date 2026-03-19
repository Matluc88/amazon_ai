/**
 * scripts/import-cerebro.js
 *
 * Importa un file CSV Helium 10 Cerebro nel database, creando o aggiornando
 * il cluster associato.
 *
 * Uso:
 *   node scripts/import-cerebro.js [percorso-csv] [nome-cluster]
 *
 * Esempi:
 *   node scripts/import-cerebro.js
 *   node scripts/import-cerebro.js /percorso/al/file.csv "Nome Cluster"
 *
 * Se non vengono passati argomenti usa il path e il nome di default qui sotto.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { query } = require('../database/db');
const { parseCerebroCSV, importKeywordsToCluster } = require('../services/cerebroService');

// ─── Configurazione di default ────────────────────────────────────────────────
const DEFAULT_CSV_PATH   = '/Users/matteo/Desktop/report/keywords/IT_AMAZON_cerebro__2026-03-19.csv';
const DEFAULT_CLUSTER_NAME = 'Wall Art IT — Cerebro 2026-03-19';
const DEFAULT_CLUSTER_DESC = 'Ricerca Helium 10 Cerebro multi-ASIN sui top seller quadri/stampe Amazon.it (19 marzo 2026)';

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath     = process.argv[2] || DEFAULT_CSV_PATH;
  const clusterName = process.argv[3] || DEFAULT_CLUSTER_NAME;

  console.log('\n🔬 IMPORT CEREBRO CSV → Database');
  console.log('═'.repeat(50));
  console.log(`📁 CSV:     ${csvPath}`);
  console.log(`📦 Cluster: ${clusterName}`);
  console.log('─'.repeat(50));

  // 1. Controlla che il file esista
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File non trovato: ${csvPath}`);
    process.exit(1);
  }

  // 2. Crea o recupera il cluster
  let clusterId;
  try {
    const existing = await query(
      `SELECT id FROM cerebro_clusters WHERE name = $1`,
      [clusterName]
    );
    if (existing.rows.length > 0) {
      clusterId = existing.rows[0].id;
      console.log(`\n♻️  Cluster esistente trovato (id: ${clusterId}) — le keyword verranno aggiornate.`);
    } else {
      const ins = await query(
        `INSERT INTO cerebro_clusters (name, description, created_at)
         VALUES ($1, $2, NOW())
         RETURNING id`,
        [clusterName, DEFAULT_CLUSTER_DESC]
      );
      clusterId = ins.rows[0].id;
      console.log(`\n✅ Cluster creato (id: ${clusterId})`);
    }
  } catch (err) {
    console.error('❌ Errore creazione/recupero cluster:', err.message);
    process.exit(1);
  }

  // 3. Leggi e parsa il CSV
  let parsed;
  try {
    const csvContent = fs.readFileSync(csvPath);
    parsed = parseCerebroCSV(csvContent);
  } catch (err) {
    console.error('❌ Errore parsing CSV:', err.message);
    process.exit(1);
  }

  const fileName = path.basename(csvPath);
  console.log(`\n📊 Parsing completato:`);
  console.log(`   Totale righe CSV:   ${parsed.total}`);
  console.log(`   Keyword filtrate:   ${parsed.skipped} (volume < 300, parola singola, o inglesi)`);
  console.log(`   Keyword da importare: ${parsed.keywords.length}`);

  if (parsed.keywords.length === 0) {
    console.log('\n⚠️  Nessuna keyword da importare dopo i filtri.');
    console.log('   Controlla che il CSV non sia vuoto e che le colonne siano nel formato Cerebro Helium 10.');
    process.exit(0);
  }

  // 4. Mostra top 10 keyword per volume
  console.log('\n📋 Top 10 keyword per volume:');
  const top10 = [...parsed.keywords]
    .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
    .slice(0, 10);
  top10.forEach((kw, i) => {
    const vol  = kw.search_volume ? kw.search_volume.toLocaleString('it-IT') : 'n/d';
    const iq   = kw.cerebro_iq   ? ` IQ:${kw.cerebro_iq}` : '';
    const dens = kw.title_density !== null && kw.title_density !== undefined ? ` density:${kw.title_density}` : '';
    console.log(`   ${String(i + 1).padStart(2)}. "${kw.keyword}" — vol: ${vol}${iq}${dens}`);
  });

  // 5. Importa nel DB
  console.log('\n⏳ Importazione nel database...');
  let result;
  try {
    result = await importKeywordsToCluster(clusterId, parsed.keywords, fileName);
  } catch (err) {
    console.error('❌ Errore durante l\'importazione:', err.message);
    process.exit(1);
  }

  // 6. Aggiorna statistiche cluster
  try {
    await query(
      `UPDATE cerebro_clusters
       SET updated_at = NOW()
       WHERE id = $1`,
      [clusterId]
    );
  } catch (_) { /* non critico */ }

  // 7. Riepilogo finale
  console.log('\n✅ Importazione completata!');
  console.log('─'.repeat(50));
  console.log(`   Cluster id:     ${clusterId}`);
  console.log(`   Nuove keyword:  ${result.imported}`);
  console.log(`   Aggiornate:     ${result.updated}`);
  console.log(`   Totale cluster: ${result.imported + result.updated}`);
  console.log('\n📌 Le keyword sono in stato "pending" — approva quelle utili su /cerebro');
  console.log('   oppure usa il bulk-approve sul tier corretto.\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Errore imprevisto:', err);
  process.exit(1);
});
