#!/usr/bin/env node
/**
 * test-nuovi-titoli.js
 *
 * Test DRY-RUN: genera VERI titoli con il nuovo prompt SEO conversion-oriented
 * su 5 prodotti campione. NON salva nulla nel database.
 *
 * Output: titolo generato + lunghezza + verifica checklist
 *
 * Uso:
 *   node scripts/test-nuovi-titoli.js           ← 5 prodotti random
 *   node scripts/test-nuovi-titoli.js --limit 3 ← solo 3 prodotti
 */
'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { regenerateSingleAttribute } = require('../services/anthropicService');

const args  = process.argv.slice(2);
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : 5;
})();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false } : false,
  max: 3,
  connectionTimeoutMillis: 20000,
});

async function dbQuery(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function checkTitle(title) {
  const t = title.toLowerCase();
  const checks = {
    '✔ contiene "stampa su tela"': t.includes('stampa su tela') || t.includes('stampa tela'),
    '✔ contiene tipo (moderno/astratto/paesaggio/mare/amore/su tela)':
      t.includes('moderno') || t.includes('astratto') || t.includes('paesaggio') ||
      t.includes('mare') || t.includes('amore') || t.includes('romantico') || t.includes('su tela'),
    '✔ contiene stanza (soggiorno/camera/ufficio/studio)':
      t.includes('soggiorno') || t.includes('camera') || t.includes('ufficio') || t.includes('studio'),
    '✔ lunghezza 80-110 char': title.length >= 70 && title.length <= 120,
    '✔ ideale 85-105 char': title.length >= 85 && title.length <= 105,
    '✗ ASSENZA "dai colori"': !t.includes('dai colori'),
    '✗ ASSENZA "sivigliart"': !t.includes('sivigliart'),
    '✗ ASSENZA "arte di"': !t.includes('arte di'),
  };
  return checks;
}

async function main() {
  console.log('\n🧪  TEST NUOVI TITOLI — DRY RUN (nessun salvataggio)');
  console.log(`   Campione: ${LIMIT} prodotti`);
  console.log('='.repeat(65));

  // Prendi prodotti con descrizione_raw non vuota
  const products = (await dbQuery(`
    SELECT * FROM products
    WHERE descrizione_raw IS NOT NULL AND descrizione_raw != ''
    ORDER BY RANDOM()
    LIMIT $1
  `, [LIMIT])).rows;

  if (products.length === 0) {
    console.log('   ⚠️  Nessun prodotto con descrizione trovato.');
    await pool.end();
    return;
  }

  console.log(`   Prodotti selezionati: ${products.length}\n`);

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`\n─── [${i + 1}/${products.length}] id:${p.id} — ${p.titolo_opera || '(nessun titolo opera)'}`);
    console.log(`    SKU: ${p.sku_max || '—'} | Misure: ${p.misura_max || '—'}`);
    console.log(`    Autore: ${p.autore || '—'}`);

    try {
      const result = await regenerateSingleAttribute(p, "Nome dell'articolo", '', [], '');
      const newTitle = result["Nome dell'articolo"];

      if (!newTitle) {
        console.log('    ❌ Claude non ha restituito un titolo');
        continue;
      }

      console.log(`\n    📌 TITOLO GENERATO (${newTitle.length} car.):`);
      console.log(`    "${newTitle}"`);

      // Verifica checklist
      const checks = checkTitle(newTitle);
      console.log('\n    📋 CHECKLIST:');
      for (const [label, ok] of Object.entries(checks)) {
        const icon = ok ? '  ✅' : '  ❌';
        // Per i controlli "assenza" l'ok è true se il termine è assente (corretto)
        console.log(`${icon} ${label}`);
      }

      // Valutazione complessiva
      const allOk = Object.values(checks).every(Boolean);
      console.log(`\n    ${allOk ? '🎯 PERFETTO' : '⚠️  DA RIVEDERE'}`);

    } catch (err) {
      console.error(`    ❌ ERRORE: ${err.message}`);
    }

    if (i < products.length - 1) {
      process.stdout.write('    ⏸️  Attendo 3s...');
      await sleep(3000);
      process.stdout.write('\r                    \r');
    }
  }

  console.log('\n' + '='.repeat(65));
  console.log('✅  Test completato — nessun dato salvato nel database');
  console.log('   Se i titoli sono corretti, esegui:');
  console.log('   node scripts/rigenera-solo-titoli.js --limit 10');
  console.log('='.repeat(65) + '\n');

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
