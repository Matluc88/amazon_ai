#!/usr/bin/env node
/**
 * rigenera-titoli.js
 *
 * Rigenera il campo "Nome dell'articolo" (attribute_id=1) per tutti i prodotti
 * usando la nuova struttura "Quadro {tipo} ..." (tipo scelto da Claude
 * dall'analisi dell'opera — Vision AI se disponibile immagine Cloudinary).
 *
 * Uso:
 *   node scripts/rigenera-titoli.js              ← tutti i prodotti
 *   node scripts/rigenera-titoli.js --id 42      ← solo il prodotto con id=42
 *   node scripts/rigenera-titoli.js --limit 10   ← solo i primi N prodotti
 *   node scripts/rigenera-titoli.js --dry-run    ← mostra cosa genererebbe senza salvare
 *
 * Elabora in batch da 5 prodotti con pausa di 3 secondi tra batch.
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { regenerateSingleAttribute } = require('../services/anthropicService');

// ─── COSTANTI DB ─────────────────────────────────────────────────────────────
const ATTRIBUTE_ID_TITOLO = 1;  // "Nome dell'articolo" in attribute_definitions

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

// ─── UTILITY ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🎨  RIGENERA TITOLI — Struttura "Quadro {tipo}" con Vision AI');
  if (DRY_RUN)   console.log('    🔍 DRY RUN — nessun salvataggio nel DB');
  if (ID_FILTER) console.log(`    🔎 Filtro id: ${ID_FILTER}`);
  if (LIMIT)     console.log(`    📦 Limite: ${LIMIT} prodotti`);
  console.log('='.repeat(60));

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL non trovato in .env');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY non trovato in .env');
    process.exit(1);
  }

  // ─── Carica prodotti dal DB ────────────────────────────────────────────────
  const whereClause = ID_FILTER ? `WHERE p.id = $1` : '';
  const queryParams = ID_FILTER ? [ID_FILTER] : [];

  // Join con product_attribute_values per avere il titolo attuale
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
            pav.value AS titolo_attuale
     FROM products p
     LEFT JOIN product_attribute_values pav
           ON pav.product_id = p.id
          AND pav.attribute_id = $${queryParams.length + 1}
     ${whereClause.replace('$1', `$${queryParams.length + 2}`)}
     ORDER BY p.id`,
    [...queryParams, ATTRIBUTE_ID_TITOLO, ...(ID_FILTER ? [ID_FILTER] : [])]
  );

  let products = res.rows;

  if (products.length === 0) {
    console.log('⚠️  Nessun prodotto trovato.');
    await pool.end();
    return;
  }

  if (LIMIT) {
    products = products.slice(0, LIMIT);
  }

  console.log(`\n📦 Prodotti da processare: ${products.length}`);
  console.log('='.repeat(60));

  // ─── Statistiche ──────────────────────────────────────────────────────────
  const stats = { total: products.length, ok: 0, errors: 0 };

  const BATCH_SIZE = 5;
  const BATCH_PAUSE_MS = 3000;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const numLabel = `[${i + 1}/${products.length}]`;

    // Pausa tra batch
    if (i > 0 && i % BATCH_SIZE === 0) {
      console.log(`\n⏸️  Pausa ${BATCH_PAUSE_MS / 1000}s tra batch...\n`);
      await sleep(BATCH_PAUSE_MS);
    }

    const titoloAttuale = product.titolo_attuale || '';
    console.log(`\n${numLabel} id:${product.id} — ${product.titolo_opera || '(senza titolo opera)'}`);
    if (titoloAttuale) {
      console.log(`  📋 Attuale: "${titoloAttuale.slice(0, 90)}"`);
    } else {
      console.log(`  📋 Attuale: (vuoto)`);
    }

    try {
      const result = await regenerateSingleAttribute(
        product,
        "Nome dell'articolo",
        titoloAttuale,
        []  // nessuna keyword extra — no keyword stuffing nel titolo
      );

      const nuovoTitolo = result["Nome dell'articolo"];

      if (!nuovoTitolo || typeof nuovoTitolo !== 'string' || nuovoTitolo.trim().length < 20) {
        console.log(`  ❌ Titolo generato non valido: "${nuovoTitolo}"`);
        stats.errors++;
        continue;
      }

      const titoloPulito = nuovoTitolo.trim();
      const iniziaConQuadro = titoloPulito.startsWith('Quadro');
      const lunghezza = titoloPulito.length;

      console.log(`  ✅ Nuovo: "${titoloPulito.slice(0, 100)}"`);
      console.log(`     ${iniziaConQuadro ? '✅ "Quadro"' : '⚠️  NON inizia con "Quadro"!'} | ${lunghezza} car.`);

      if (!DRY_RUN) {
        // UPSERT: aggiorna se esiste, inserisce se non esiste
        await dbQuery(
          `INSERT INTO product_attribute_values (product_id, attribute_id, value, compiled_by, updated_at)
           VALUES ($1, $2, $3, 'script:rigenera-titoli', NOW())
           ON CONFLICT (product_id, attribute_id)
           DO UPDATE SET value = $3, compiled_by = 'script:rigenera-titoli', updated_at = NOW()`,
          [product.id, ATTRIBUTE_ID_TITOLO, titoloPulito]
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
  console.log('✅  RIGENERA TITOLI COMPLETATO');
  console.log('='.repeat(60));
  console.log(`📊  Prodotti processati:  ${stats.total}`);
  console.log(`✅  Titoli rigenerati:    ${stats.ok}`);
  console.log(`❌  Errori:              ${stats.errors}`);

  if (!DRY_RUN && stats.ok > 0) {
    console.log(`\n🎉 ${stats.ok}/${stats.total} titoli aggiornati con la struttura "Quadro {tipo}"!`);
  } else if (DRY_RUN) {
    console.log('\n🔍 DRY RUN completato — nessun dato modificato.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
