/**
 * Script bulk insert ASIN Amazon
 * Uso: node scripts/load-asins.js
 *
 * Legge la mappa SKU→ASIN hard-coded, trova ogni prodotto per sku_padre
 * e aggiorna le 4 colonne ASIN (padre, max, media, mini).
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ============================================================
// DATI: mappa SKU base → { padre, max, media, mini }
// SKU base = sku_padre nel DB (es. "cura", "bacio-molo", ...)
// ============================================================
const ASIN_DATA = [
  { sku: 'cura',          padre: 'B0GS72NY4P', max: 'B0GS7756YD', media: 'B0GS75C16W', mini: 'B0GS74DBJ5' },
  { sku: 'bacio-molo',    padre: 'B0GS6YL2VN', max: 'B0GS7H2V4P', media: 'B0GS77V1H5', mini: 'B0GS73FFTB' },
  { sku: 'imma-rif',      padre: 'B0GS72HK5V', max: 'B0GS74KN85', media: 'B0GS717P1Z', mini: 'B0GS73X243' },
  { sku: 'futuro',        padre: 'B0GS76W9F5', max: 'B0GS7B37L9', media: 'B0GS6YM8WF', mini: 'B0GS79SV6N' },
  { sku: 'contro-past',   padre: 'B0GS74JM3R', max: 'B0GS72PLYD', media: 'B0GS7BTJ83', mini: 'B0GS6ZTBBR' },
  { sku: 'estate',        padre: 'B0GS7DFZ5K', max: 'B0GS74K1W5', media: 'B0GS74HBBL', mini: 'B0GS72P72Y' },
  { sku: 'serp-spalle',   padre: 'B0GS72B8L4', max: 'B0GS7B47K1', media: 'B0GS7442C3', mini: 'B0GS75775G' },
  { sku: 'donne-batt',    padre: 'B0GS76YBJ7', max: 'B0GS72FY6X', media: 'B0GS76974M', mini: 'B0GS776124' },
  { sku: 'hypno',         padre: 'B0GS721FQK', max: 'B0GS715YTJ', media: 'B0GS6WXH72', mini: 'B0GS72H9HD' },
  { sku: 'love-stories',  padre: 'B0GS5XMDTP', max: 'B0GS4G9656', media: 'B0GS4357G3', mini: 'B0GS4LCTX7' },
  { sku: 'primi-passi',   padre: 'B0GS6RXTWR', max: 'B0GS6N7NZ4', media: 'B0GS6N9LZ7', mini: 'B0GS6W6KV1' },
];

async function main() {
  const client = await pool.connect();
  console.log('\n🚀 Inizio caricamento ASIN...\n');

  let ok = 0, notFound = 0;

  try {
    for (const entry of ASIN_DATA) {
      // Cerca il prodotto per sku_padre (exact match case-insensitive)
      const res = await client.query(
        `SELECT id, titolo_opera FROM products WHERE LOWER(sku_padre) = LOWER($1) LIMIT 1`,
        [entry.sku]
      );

      if (res.rows.length === 0) {
        console.log(`❌ NON TROVATO: sku_padre = "${entry.sku}"`);
        notFound++;
        continue;
      }

      const { id, titolo_opera } = res.rows[0];

      await client.query(
        `UPDATE products SET
           asin_padre = $1,
           asin_max   = $2,
           asin_media = $3,
           asin_mini  = $4
         WHERE id = $5`,
        [
          entry.padre.toUpperCase(),
          entry.max.toUpperCase(),
          entry.media.toUpperCase(),
          entry.mini.toUpperCase(),
          id,
        ]
      );

      console.log(`✅ [${entry.sku}] ${titolo_opera}`);
      console.log(`   Padre: ${entry.padre}  Max: ${entry.max}  Media: ${entry.media}  Mini: ${entry.mini}`);
      ok++;
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\n📊 Risultato: ${ok} aggiornati, ${notFound} non trovati`);
  if (notFound > 0) {
    console.log('\n⚠️  Per i prodotti non trovati, verifica che sku_padre nel DB corrisponda esattamente.');
    console.log('   Puoi controllare con: SELECT id, sku_padre, titolo_opera FROM products ORDER BY sku_padre;\n');
  } else {
    console.log('\n🎉 Tutti gli ASIN caricati con successo!\n');
  }
}

main().catch(err => {
  console.error('Errore fatale:', err.message);
  process.exit(1);
});
