#!/usr/bin/env node
/**
 * scripts/rigenera-chiavi-corte.js
 *
 * Rigenera le "Chiavi di ricerca" per i prodotti che hanno
 * meno di 1100 byte UTF-8 (sotto il target ottimale Amazon).
 *
 * Usa regenerateSingleAttribute con Vision AI per rigenerare
 * il campo con target 1100-1200 byte.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { regenerateSingleAttribute } = require('../services/anthropicService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15000,
});

const MIN_BYTES = 1100;

async function main() {
  console.log('\n🔑 RIGENERA CHIAVI DI RICERCA — Prodotti sotto 1100 byte');
  console.log('='.repeat(55));

  // Recupera attribute_id per "Chiavi di ricerca"
  const attrChiaviRes = await pool.query(
    `SELECT id FROM attribute_definitions WHERE nome_attributo = 'Chiavi di ricerca' AND source = 'AI' LIMIT 1`
  );
  if (!attrChiaviRes.rows[0]) {
    console.error('❌ Attributo "Chiavi di ricerca" non trovato');
    process.exit(1);
  }
  const chiaviAttrId = attrChiaviRes.rows[0].id;

  // Recupera prodotti con chiavi sotto MIN_BYTES
  const res = await pool.query(`
    SELECT
      p.id, p.titolo_opera, p.descrizione_raw, p.autore, p.tecnica,
      p.dimensioni, p.misura_max, p.misura_media, p.misura_mini,
      p.prezzo_max, p.prezzo_media, p.prezzo_mini,
      p.sku_max, p.sku_media, p.sku_mini,
      p.immagine_max, p.immagine_media, p.immagine_mini, p.immagine_max_2,
      pav.id AS val_id, pav.value AS chiavi_attuali
    FROM products p
    JOIN product_attribute_values pav ON pav.product_id = p.id AND pav.attribute_id = $1
    ORDER BY p.id
  `, [chiaviAttrId]);

  // Filtra solo quelli sotto MIN_BYTES
  const toFix = res.rows.filter(row => Buffer.byteLength(row.chiavi_attuali || '', 'utf8') < MIN_BYTES);

  if (toFix.length === 0) {
    console.log('✅ Tutti i prodotti hanno chiavi ≥ 1100 byte. Niente da fare.');
    await pool.end();
    return;
  }

  console.log(`📋 Prodotti da rigenerare: ${toFix.length}`);
  toFix.forEach(r => {
    const bytes = Buffer.byteLength(r.chiavi_attuali || '', 'utf8');
    console.log(`   id:${r.id} — ${r.titolo_opera} (${bytes} byte, mancano ${MIN_BYTES - bytes})`);
  });
  console.log('');

  let ok = 0, errors = 0;

  for (const product of toFix) {
    const bytes = Buffer.byteLength(product.chiavi_attuali || '', 'utf8');
    console.log(`\n[${ok + errors + 1}/${toFix.length}] id:${product.id} — ${product.titolo_opera} (${bytes} byte)`);

    try {
      const result = await regenerateSingleAttribute(
        product,
        'Chiavi di ricerca',
        product.chiavi_attuali || '',
        [],
        ''
      );

      const newValue = result['Chiavi di ricerca'];
      if (!newValue) throw new Error('Claude non ha restituito "Chiavi di ricerca"');

      const newBytes = Buffer.byteLength(newValue, 'utf8');
      console.log(`   Byte: ${bytes} → ${newBytes}`);

      // Salva nel DB
      await pool.query(
        `UPDATE product_attribute_values SET value = $1, compiled_by = 'script:chiavi-rigenerate', updated_at = NOW() WHERE id = $2`,
        [newValue, product.val_id]
      );

      if (newBytes >= MIN_BYTES) {
        console.log(`   ✅ OK (${newBytes} byte)`);
      } else {
        console.log(`   ⚠️  Ancora sotto target (${newBytes} byte)`);
      }

      ok++;

      // Pausa tra chiamate API
      if (ok + errors < toFix.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e) {
      console.error(`   ❌ ERRORE: ${e.message}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(55));
  console.log('✅  COMPLETATO');
  console.log(`   ✅ OK: ${ok} | ❌ Errori: ${errors}`);

  await pool.end();
}

main().catch(e => { console.error('\n❌ Errore fatale:', e.message); process.exit(1); });
