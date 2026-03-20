#!/usr/bin/env node
/**
 * scripts/fix-funzioni-speciali.js
 *
 * Normalizza il campo "Funzioni speciali" per tutti i prodotti.
 * Amazon accetta SOLO questi valori (controlled vocabulary):
 *   "Pronto da appendere" | "Leggero" | "Impermeabile" |
 *   "Resistente agli strappi" | "Senza cornice" | "Con telaio in legno"
 *
 * Tutti i valori non in questa lista vengono ignorati da Amazon
 * (es. "Ritocchi acrilici a mano", "Ganci montati", "Finitura protettiva", ecc.)
 *
 * Questo script normalizza tutti i prodotti al valore standard:
 *   "Pronto da appendere, Con telaio in legno, Leggero, Resistente agli strappi"
 *
 * Uso:
 *   node scripts/fix-funzioni-speciali.js            ← fix tutti
 *   node scripts/fix-funzioni-speciali.js --dry-run  ← mostra senza salvare
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

// Valore target corretto secondo Amazon controlled vocabulary
const TARGET_VALUE = 'Pronto da appendere, Con telaio in legno, Leggero, Resistente agli strappi';

// Valori Amazon accettati (controlled vocabulary)
const VALID_VALUES = [
  'Pronto da appendere',
  'Con telaio in legno',
  'Leggero',
  'Impermeabile',
  'Resistente agli strappi',
  'Senza cornice',
];

/**
 * Controlla se un valore è conforme (contiene solo valori della lista accettata)
 * e include OBBLIGATORIAMENTE "Pronto da appendere" e "Con telaio in legno"
 */
function isConform(value) {
  if (!value) return false;
  const parts = value.split(',').map(p => p.trim());
  const allValid = parts.every(p => VALID_VALUES.includes(p));
  const hasPronto = parts.includes('Pronto da appendere');
  const hasTelaio = parts.includes('Con telaio in legno');
  return allValid && hasPronto && hasTelaio;
}

async function main() {
  console.log('\n🔧 FIX FUNZIONI SPECIALI — Normalizzazione valori Amazon');
  if (DRY_RUN) console.log('   🔍 DRY RUN — nessun salvataggio');
  console.log('='.repeat(60));
  console.log(`   Target: "${TARGET_VALUE}"`);
  console.log('='.repeat(60));

  // Recupera attribute_id per "Funzioni speciali"
  const attrRes = await pool.query(
    `SELECT id FROM attribute_definitions WHERE nome_attributo = 'Funzioni speciali' LIMIT 1`
  );
  if (!attrRes.rows[0]) {
    console.error('❌ Attributo "Funzioni speciali" non trovato nel DB');
    process.exit(1);
  }
  const funzioniAttrId = attrRes.rows[0].id;

  // Recupera tutti i valori attuali
  const res = await pool.query(`
    SELECT pav.id AS val_id, pav.product_id, p.titolo_opera, pav.value
    FROM product_attribute_values pav
    JOIN products p ON p.id = pav.product_id
    WHERE pav.attribute_id = $1
    ORDER BY p.id
  `, [funzioniAttrId]);

  let fixed = 0, skipped = 0, errors = 0;

  for (const row of res.rows) {
    const isOK = isConform(row.value);

    if (isOK) {
      skipped++;
      console.log(`✅ id:${row.product_id} — ${row.titolo_opera} (già conforme)`);
      continue;
    }

    console.log(`\n⚠️  id:${row.product_id} — ${row.titolo_opera}`);
    console.log(`   ATTUALE:  "${row.value}"`);
    console.log(`   TARGET:   "${TARGET_VALUE}"`);

    if (!DRY_RUN) {
      try {
        await pool.query(
          `UPDATE product_attribute_values SET value = $1, updated_at = NOW() WHERE id = $2`,
          [TARGET_VALUE, row.val_id]
        );
        console.log(`   ✅ Aggiornato`);
        fixed++;
      } catch (e) {
        console.error(`   ❌ ERRORE: ${e.message}`);
        errors++;
      }
    } else {
      fixed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(DRY_RUN ? '🔍 DRY RUN COMPLETATO (nessuna modifica)' : '✅  FIX COMPLETATO');
  console.log('='.repeat(60));
  console.log(`📊  Totale prodotti:    ${res.rows.length}`);
  console.log(`✅  Già conformi:       ${skipped}`);
  console.log(`🔧  ${DRY_RUN ? 'Da fixare' : 'Fixati'}:          ${fixed}`);
  console.log(`❌  Errori:             ${errors}`);

  await pool.end();
}

main().catch(e => { console.error('\n❌ Errore fatale:', e.message); process.exit(1); });
