#!/usr/bin/env node
/**
 * scripts/rigenera-solo-titoli.js
 *
 * Rigenera SOLO il campo "Nome dell'articolo" (titolo Amazon) per tutti i prodotti.
 * Usa il nuovo template con frasi SEO Cerebro incorporate (es. "Quadri Moderni Soggiorno e Camera da Letto").
 *
 * Uso:
 *   node scripts/rigenera-solo-titoli.js                 ← tutti i prodotti
 *   node scripts/rigenera-solo-titoli.js --from-id 31    ← riprende da id:31
 *   node scripts/rigenera-solo-titoli.js --id 42         ← solo prodotto id:42
 *   node scripts/rigenera-solo-titoli.js --dry-run       ← mostra titoli senza salvare
 */
'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { regenerateSingleAttribute } = require('../services/anthropicService');

// ─── CLI ARGS ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const ID_FILTER = (() => {
  const i = args.indexOf('--id');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const FROM_ID = (() => {
  const i = args.indexOf('--from-id');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();

// ─── DATABASE ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  connectionTimeoutMillis: 20000,
});

async function dbQuery(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🏷️  RIGENERA SOLO TITOLI — con keyword SEO incorporate');
  if (DRY_RUN) console.log('   🔍 DRY RUN — nessun salvataggio');
  if (ID_FILTER) console.log(`   🔎 Solo prodotto id: ${ID_FILTER}`);
  if (FROM_ID)   console.log(`   ▶️  Da id: ${FROM_ID}`);
  console.log('='.repeat(55));

  // Recupera attribute_id per "Nome dell'articolo"
  const nomeArticolo = "Nome dell'articolo";
  const attrRes = await dbQuery(
    `SELECT id FROM attribute_definitions WHERE nome_attributo = $1 AND source = 'AI' LIMIT 1`,
    [nomeArticolo]
  );
  if (!attrRes.rows[0]) {
    console.error(`❌ Attributo "${nomeArticolo}" non trovato in attribute_definitions`);
    process.exit(1);
  }
  const titleAttrId = attrRes.rows[0].id;
  console.log(`   ✅ Attribute id per "${nomeArticolo}": ${titleAttrId}\n`);

  // Query prodotti
  let sql = `SELECT p.* FROM products p`;
  const params = [];
  if (ID_FILTER) {
    sql += ` WHERE p.id = $1`;
    params.push(ID_FILTER);
  } else if (FROM_ID) {
    sql += ` WHERE p.id >= $1`;
    params.push(FROM_ID);
  }
  sql += ` ORDER BY p.id ASC`;

  const products = (await dbQuery(sql, params)).rows;
  if (products.length === 0) {
    console.log('   ⚠️  Nessun prodotto trovato.');
    await pool.end();
    return;
  }

  console.log(`   📦 Prodotti da aggiornare: ${products.length}\n`);

  const stats = { total: products.length, ok: 0, errors: 0 };
  const BATCH_SIZE = 3;
  const BATCH_PAUSE_MS = 4000;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const numLabel = `[${String(i + 1).padStart(3)}/${products.length}]`;

    if (i > 0 && i % BATCH_SIZE === 0) {
      console.log(`   ⏸️  Pausa ${BATCH_PAUSE_MS / 1000}s...\n`);
      await sleep(BATCH_PAUSE_MS);
    }

    console.log(`\n${numLabel} id:${product.id} — ${product.titolo_opera || '(senza titolo)'}`);

    try {
      if (DRY_RUN) {
        console.log(`   [DRY] Verrebbe rigenerato il titolo`);
        stats.ok++;
        continue;
      }

      // Recupera titolo attuale
      const currentRes = await dbQuery(
        `SELECT pav.value FROM product_attribute_values pav WHERE pav.product_id = $1 AND pav.attribute_id = $2`,
        [product.id, titleAttrId]
      );
      const currentTitle = currentRes.rows[0]?.value || '';

      // Rigenera solo il titolo
      const result = await regenerateSingleAttribute(product, nomeArticolo, currentTitle, [], '');
      const newTitle = result[nomeArticolo];

      if (!newTitle) {
        console.log(`   ⚠️  Claude non ha restituito un titolo valido`);
        stats.errors++;
        continue;
      }

      // Verifica presenza frase SEO nel titolo
      const titleLower = newTitle.toLowerCase();
      const hasSEO = titleLower.includes('quadri moderni') || titleLower.includes('decorazioni parete');
      const seoCheck = hasSEO ? '✅ SEO ok' : '⚠️  no kw SEO';

      console.log(`   ${seoCheck} — "${newTitle.slice(0, 90)}..." (${newTitle.length} car.)`);

      // Salva nel DB
      await dbQuery(`
        INSERT INTO product_attribute_values (product_id, attribute_id, value, compiled_by, updated_at)
        VALUES ($1, $2, $3, 'script:titoli-seo', NOW())
        ON CONFLICT (product_id, attribute_id)
        DO UPDATE SET value = $3, compiled_by = 'script:titoli-seo', updated_at = NOW()
      `, [product.id, titleAttrId, newTitle]);

      stats.ok++;

    } catch (err) {
      console.error(`   ❌ ERRORE: ${err.message}`);
      stats.errors++;
      await sleep(3000);
    }
  }

  // Report finale
  console.log('\n' + '='.repeat(55));
  console.log('✅  TITOLI RIGENERATI');
  console.log('='.repeat(55));
  console.log(`📊  Prodotti: ${stats.total}`);
  console.log(`✅  OK:       ${stats.ok}`);
  console.log(`❌  Errori:   ${stats.errors}`);

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
