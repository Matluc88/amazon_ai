#!/usr/bin/env node
/**
 * scripts/fix-chiavi-lunghezza.js
 *
 * Tronca le Chiavi di ricerca che superano 1200 byte UTF-8 (limite Amazon = 1250 byte × 5 slot).
 * Tronca all'ultimo spazio prima del limite per non spezzare parole.
 *
 * Uso:
 *   node scripts/fix-chiavi-lunghezza.js            ← fix tutti i prodotti > 1200 byte
 *   node scripts/fix-chiavi-lunghezza.js --dry-run  ← mostra senza salvare
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15000,
});

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_BYTES = 1200; // limite sicuro (Amazon max = 1250, margine di 50)

/**
 * Tronca una stringa al limite di byte UTF-8 specificato, tagliando all'ultimo spazio.
 */
function truncateToBytes(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;

  // Tronca al maxBytes, poi cerca l'ultimo spazio per non spezzare parole
  let truncated = buf.slice(0, maxBytes).toString('utf8');
  // Il toString potrebbe aver creato carattere UTF-8 spezzato — lo pulisce
  truncated = truncated.replace(/[^\x00-\x7F\u0080-\uFFFF]*$/, '');

  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxBytes * 0.7) {
    truncated = truncated.slice(0, lastSpace).trim();
  } else {
    truncated = truncated.trim();
  }
  return truncated;
}

async function main() {
  console.log('\n✂️  FIX CHIAVI DI RICERCA — Troncatura a 1200 byte UTF-8');
  if (DRY_RUN) console.log('   🔍 DRY RUN — nessun salvataggio');
  console.log('='.repeat(55));

  // Recupera attribute_id per "Chiavi di ricerca"
  const attrRes = await pool.query(
    `SELECT id FROM attribute_definitions WHERE nome_attributo = 'Chiavi di ricerca' AND source = 'AI' LIMIT 1`
  );
  if (!attrRes.rows[0]) { console.error('❌ Attributo non trovato'); process.exit(1); }
  const chiaveAttrId = attrRes.rows[0].id;

  // Recupera tutte le chiavi di ricerca
  const res = await pool.query(`
    SELECT pav.id AS val_id, pav.product_id, p.titolo_opera, pav.value
    FROM product_attribute_values pav
    JOIN products p ON p.id = pav.product_id
    WHERE pav.attribute_id = $1
    ORDER BY p.id
  `, [chiaveAttrId]);

  let fixed = 0, skipped = 0, errors = 0;

  for (const row of res.rows) {
    const currentBytes = Buffer.byteLength(row.value, 'utf8');
    if (currentBytes <= MAX_BYTES) {
      skipped++;
      continue;
    }

    const truncated = truncateToBytes(row.value, MAX_BYTES);
    const newBytes = Buffer.byteLength(truncated, 'utf8');

    console.log(`\nid:${row.product_id} — ${row.titolo_opera}`);
    console.log(`   ${currentBytes} byte → ${newBytes} byte (rimossi ${currentBytes - newBytes} byte)`);

    if (!DRY_RUN) {
      try {
        await pool.query(
          `UPDATE product_attribute_values SET value = $1, updated_at = NOW() WHERE id = $2`,
          [truncated, row.val_id]
        );
        fixed++;
      } catch (e) {
        console.error(`   ❌ ERRORE: ${e.message}`);
        errors++;
      }
    } else {
      fixed++;
    }
  }

  console.log('\n' + '='.repeat(55));
  console.log('✅  FIX COMPLETATO');
  console.log('='.repeat(55));
  console.log(`📊  Totale prodotti:    ${res.rows.length}`);
  console.log(`✂️   Troncati:          ${fixed}`);
  console.log(`✅  Già OK (skippati): ${skipped}`);
  console.log(`❌  Errori:            ${errors}`);

  await pool.end();
}

main().catch(e => { console.error('\n❌ Errore fatale:', e.message); process.exit(1); });
