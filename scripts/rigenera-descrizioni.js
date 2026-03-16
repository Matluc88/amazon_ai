#!/usr/bin/env node
/**
 * rigenera-descrizioni.js
 *
 * Rigenera il campo "Descrizione del prodotto" (attribute_id=7) per tutti i prodotti
 * usando la nuova struttura che inizia con "Quadro che riproduce..." invece di
 * "Stampa su tela che riproduce..." — Vision AI attiva se disponibile immagine.
 *
 * Uso:
 *   node scripts/rigenera-descrizioni.js              ← tutti i prodotti
 *   node scripts/rigenera-descrizioni.js --id 42      ← solo il prodotto con id=42
 *   node scripts/rigenera-descrizioni.js --limit 10   ← solo i primi N prodotti
 *   node scripts/rigenera-descrizioni.js --dry-run    ← mostra senza salvare
 *
 * Elabora in batch da 5 prodotti con pausa di 3 secondi tra batch.
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { regenerateSingleAttribute } = require('../services/anthropicService');

// ─── COSTANTI DB ─────────────────────────────────────────────────────────────
const ATTRIBUTE_ID_DESCRIZIONE = 7;  // "Descrizione del prodotto" in attribute_definitions

// ─── CLI ARGS ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ID_FILTER = (() => {
  const i = args.indexOf('--id');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const LIMIT = (() => {
  const i = args.indexOf('--limit');
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

async function dbQuery(sql, params) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n📝  RIGENERA DESCRIZIONI — Struttura "Quadro che riproduce..." con Vision AI');
  if (DRY_RUN)   console.log('    🔍 DRY RUN — nessun salvataggio nel DB');
  if (ID_FILTER) console.log(`    🔎 Filtro id: ${ID_FILTER}`);
  if (LIMIT)     console.log(`    📦 Limite: ${LIMIT} prodotti`);
  console.log('='.repeat(60));

  if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL non trovato'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY non trovato'); process.exit(1); }

  // ─── Carica prodotti + descrizione attuale ────────────────────────────────
  const whereClause = ID_FILTER ? `WHERE p.id = ${ID_FILTER}` : '';

  const res = await dbQuery(
    `SELECT p.id,
            p.titolo_opera,
            p.autore,
            p.descrizione_raw,
            p.dimensioni,
            p.tecnica,
            p.misura_max,    p.misura_media,    p.misura_mini,
            p.prezzo_max,    p.prezzo_media,    p.prezzo_mini,
            p.sku_max,       p.sku_media,       p.sku_mini,
            p.immagine_max,  p.immagine_media,  p.immagine_mini,
            p.immagine_max_2,
            pav.value AS desc_attuale
     FROM products p
     LEFT JOIN product_attribute_values pav
           ON pav.product_id = p.id
          AND pav.attribute_id = $1
     ${whereClause}
     ORDER BY p.id`,
    [ATTRIBUTE_ID_DESCRIZIONE]
  );

  let products = res.rows;
  if (products.length === 0) { console.log('⚠️  Nessun prodotto trovato.'); await pool.end(); return; }
  if (LIMIT) products = products.slice(0, LIMIT);

  console.log(`\n📦 Prodotti da processare: ${products.length}`);
  console.log('='.repeat(60));

  const stats = { total: products.length, ok: 0, errors: 0 };
  const BATCH_SIZE = 5;
  const BATCH_PAUSE_MS = 3000;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const numLabel = `[${i + 1}/${products.length}]`;

    if (i > 0 && i % BATCH_SIZE === 0) {
      console.log(`\n⏸️  Pausa ${BATCH_PAUSE_MS / 1000}s tra batch...\n`);
      await sleep(BATCH_PAUSE_MS);
    }

    const descAttuale = product.desc_attuale || '';
    console.log(`\n${numLabel} id:${product.id} — ${product.titolo_opera || '(senza titolo opera)'}`);
    if (descAttuale) {
      // Mostra solo i primi 80 caratteri dell'attuale
      console.log(`  📋 Attuale: "${descAttuale.slice(0, 80)}..."`);
    } else {
      console.log(`  📋 Attuale: (vuota)`);
    }

    try {
      const result = await regenerateSingleAttribute(
        product,
        'Descrizione del prodotto',
        descAttuale,
        []
      );

      const nuovaDesc = result['Descrizione del prodotto'];

      if (!nuovaDesc || typeof nuovaDesc !== 'string' || nuovaDesc.trim().length < 50) {
        console.log(`  ❌ Descrizione generata non valida (${(nuovaDesc || '').length} car.)`);
        stats.errors++;
        continue;
      }

      const descPulita = nuovaDesc.trim();
      const iniziaConQuadro = descPulita.startsWith('Quadro');
      const lunghezza = descPulita.length;

      console.log(`  ✅ Nuova: "${descPulita.slice(0, 100)}..."`);
      console.log(`     ${iniziaConQuadro ? '✅ Inizia con "Quadro"' : '⚠️  NON inizia con "Quadro"!'} | ${lunghezza} car.`);

      if (!DRY_RUN) {
        await dbQuery(
          `INSERT INTO product_attribute_values (product_id, attribute_id, value, compiled_by, updated_at)
           VALUES ($1, $2, $3, 'script:rigenera-descrizioni', NOW())
           ON CONFLICT (product_id, attribute_id)
           DO UPDATE SET value = $3, compiled_by = 'script:rigenera-descrizioni', updated_at = NOW()`,
          [product.id, ATTRIBUTE_ID_DESCRIZIONE, descPulita]
        );
        console.log(`  💾 Salvato nel DB`);
      } else {
        console.log(`  [DRY] Nessun salvataggio`);
      }

      stats.ok++;

    } catch (err) {
      console.error(`  ❌ ERRORE id:${product.id}: ${err.message}`);
      stats.errors++;
      await sleep(2000);
    }
  }

  // ─── Report finale ────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('✅  RIGENERA DESCRIZIONI COMPLETATO');
  console.log('='.repeat(60));
  console.log(`📊  Prodotti processati:      ${stats.total}`);
  console.log(`✅  Descrizioni rigenerate:   ${stats.ok}`);
  console.log(`❌  Errori:                   ${stats.errors}`);

  if (!DRY_RUN && stats.ok > 0) {
    console.log(`\n🎉 ${stats.ok}/${stats.total} descrizioni aggiornate con "Quadro che riproduce..."!`);
  } else if (DRY_RUN) {
    console.log('\n🔍 DRY RUN completato — nessun dato modificato.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
