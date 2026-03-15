/**
 * Script caricamento ASIN da report Amazon "Tutte le offerte"
 *
 * Uso:
 *   node scripts/load-asins-from-report.js /path/to/Report+di+tutte+le+offerte.txt
 *
 * Il file TSV di Amazon contiene sia le righe parent (sku senza suffisso)
 * sia le righe child (sku con suffisso -max / -media / -mini).
 * Lo script raggruppa tutto per famiglia e aggiorna le 4 colonne ASIN nel DB.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Leggi path del report da argv ─────────────────────────────────────────
const reportPath = process.argv[2];
if (!reportPath) {
  console.error('❌  Uso: node scripts/load-asins-from-report.js <path-report.txt>');
  process.exit(1);
}
const absPath = path.resolve(reportPath);
if (!fs.existsSync(absPath)) {
  console.error(`❌  File non trovato: ${absPath}`);
  process.exit(1);
}

// ─── Parse TSV ─────────────────────────────────────────────────────────────
function parseTsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''); // rimuovi BOM
  const lines   = content.split('\n').filter(l => l.trim() !== '');
  const headers = lines[0].split('\t').map(h => h.trim());

  const skuIdx  = headers.indexOf('seller-sku');
  const asinIdx = headers.indexOf('asin1');

  if (skuIdx === -1 || asinIdx === -1) {
    throw new Error(`Colonne 'seller-sku' o 'asin1' non trovate nel report.\nHeaders: ${headers.join(', ')}`);
  }

  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const sku  = (cols[skuIdx]  || '').trim();
    const asin = (cols[asinIdx] || '').trim().toUpperCase();
    if (sku && asin) entries.push({ sku, asin });
  }
  return entries;
}

// ─── Raggruppa per famiglia ─────────────────────────────────────────────────
// SKU padre = sku senza suffisso -max / -media / -mini
function groupByFamily(entries) {
  const families = {}; // skuPadre → { padre, max, media, mini }

  for (const { sku, asin } of entries) {
    let base, tipo;
    if (sku.endsWith('-max')) {
      base = sku.slice(0, -4);
      tipo = 'max';
    } else if (sku.endsWith('-media')) {
      base = sku.slice(0, -6);
      tipo = 'media';
    } else if (sku.endsWith('-mini')) {
      base = sku.slice(0, -5);
      tipo = 'mini';
    } else {
      // Nessun suffisso → è il parent
      base = sku;
      tipo = 'padre';
    }

    if (!families[base]) families[base] = { padre: null, max: null, media: null, mini: null };
    families[base][tipo] = asin;
  }

  return families;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  Caricamento ASIN dal report: ${path.basename(absPath)}\n`);

  // 1. Parse
  const entries  = parseTsv(absPath);
  console.log(`📄  Righe lette dal report: ${entries.length}`);

  // 2. Raggruppa
  const families = groupByFamily(entries);
  const famList  = Object.entries(families);
  console.log(`👨‍👩‍👧‍👦  Famiglie trovate:          ${famList.length}\n`);

  // 3. Aggiorna DB
  const client = await pool.connect();
  const stats  = { ok: 0, notFound: 0, noChanges: 0 };

  try {
    for (const [skuPadre, asins] of famList) {
      // Cerca il prodotto per sku_padre (case-insensitive)
      const res = await client.query(
        `SELECT id, titolo_opera, asin_padre, asin_max, asin_media, asin_mini
         FROM products WHERE LOWER(sku_padre) = LOWER($1) LIMIT 1`,
        [skuPadre]
      );

      if (res.rows.length === 0) {
        console.log(`❌  NON TROVATO: sku_padre = "${skuPadre}"`);
        stats.notFound++;
        continue;
      }

      const prod = res.rows[0];

      // Controlla se ci sono effettivi cambiamenti
      const same =
        (prod.asin_padre || null) === (asins.padre || null) &&
        (prod.asin_max   || null) === (asins.max   || null) &&
        (prod.asin_media || null) === (asins.media || null) &&
        (prod.asin_mini  || null) === (asins.mini  || null);

      if (same) {
        console.log(`ℹ️   Già aggiornato: [${skuPadre}]`);
        stats.noChanges++;
        continue;
      }

      await client.query(
        `UPDATE products SET
           asin_padre = COALESCE($1, asin_padre),
           asin_max   = COALESCE($2, asin_max),
           asin_media = COALESCE($3, asin_media),
           asin_mini  = COALESCE($4, asin_mini)
         WHERE id = $5`,
        [asins.padre || null, asins.max || null, asins.media || null, asins.mini || null, prod.id]
      );

      console.log(`✅  [${skuPadre}] ${prod.titolo_opera || ''}`);
      if (asins.padre) console.log(`     Padre: ${asins.padre}`);
      if (asins.max)   console.log(`     Max:   ${asins.max}`);
      if (asins.media) console.log(`     Media: ${asins.media}`);
      if (asins.mini)  console.log(`     Mini:  ${asins.mini}`);
      stats.ok++;
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`
📊  Risultato
   ✅  Aggiornati:       ${stats.ok}
   ℹ️   Già completi:    ${stats.noChanges}
   ❌  Non trovati nel DB: ${stats.notFound}
`);

  if (stats.notFound > 0) {
    console.log('⚠️   Per i prodotti non trovati, verifica che sku_padre nel DB corrisponda');
    console.log('     esattamente alla SKU parent nel report (prima parte, senza suffisso).\n');
  } else {
    console.log('🎉  Tutti gli ASIN caricati con successo!\n');
  }
}

main().catch(err => {
  console.error('Errore fatale:', err.message);
  process.exit(1);
});
