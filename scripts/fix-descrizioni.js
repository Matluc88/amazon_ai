/**
 * Script one-shot: rigenera "Descrizione del prodotto" per tutti i prodotti esistenti.
 * Le misure sono ora in formato base×altezza nel DB, ma le descrizioni vecchie
 * potrebbero riportare altezza×base (generate prima dello swap).
 *
 * Esecuzione: node scripts/fix-descrizioni.js
 */
require('dotenv').config();

const { query } = require('../database/db');
const { regenerateSingleAttribute } = require('../services/anthropicService');
const { upsertAttributeValue, getCachedKeywords } = require('../services/attributeService');

const NOME_ATTRIBUTO = 'Descrizione del prodotto';
const DELAY_MS = 2000; // pausa tra le chiamate per non saturare l'API

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🔄 Avvio rigenerazione "Descrizione del prodotto" per tutti i prodotti...\n');

  // 1. Ottieni l'attribute_id di "Descrizione del prodotto"
  const attrRes = await query(
    `SELECT id FROM attribute_definitions WHERE nome_attributo = $1`,
    [NOME_ATTRIBUTO]
  );
  if (attrRes.rows.length === 0) {
    console.error(`❌ Attributo "${NOME_ATTRIBUTO}" non trovato nel DB!`);
    process.exit(1);
  }
  const attributeId = attrRes.rows[0].id;
  console.log(`✅ Attribute ID per "${NOME_ATTRIBUTO}": ${attributeId}\n`);

  // 2. Carica tutti i prodotti
  const prodRes = await query(`SELECT * FROM products ORDER BY id ASC`);
  const products = prodRes.rows;
  console.log(`📦 Prodotti trovati: ${products.length}\n`);

  let ok = 0;
  let err = 0;

  for (const product of products) {
    process.stdout.write(`[${product.id}] ${product.titolo_opera} ... `);
    try {
      // Valore attuale della descrizione (se esiste)
      const curRes = await query(
        `SELECT value FROM product_attribute_values WHERE product_id = $1 AND attribute_id = $2`,
        [product.id, attributeId]
      );
      const currentValue = curRes.rows[0]?.value || '';

      // Keywords in cache
      const keywords = await getCachedKeywords(product.id);

      // Chiamata Claude
      const result = await regenerateSingleAttribute(product, NOME_ATTRIBUTO, currentValue, keywords);
      const newValue = result[NOME_ATTRIBUTO] || '';

      if (!newValue) {
        console.log('⚠️  Claude non ha restituito valore');
        err++;
      } else {
        await upsertAttributeValue(product.id, attributeId, newValue, 'AI');
        console.log(`✅ OK (${newValue.length} car.)`);
        ok++;
      }
    } catch (e) {
      console.log(`❌ ERRORE: ${e.message}`);
      err++;
    }

    // Pausa tra le chiamate
    await sleep(DELAY_MS);
  }

  console.log(`\n🏁 Completato: ${ok} OK, ${err} errori su ${products.length} prodotti.`);
  process.exit(0);
}

main().catch(e => {
  console.error('Errore fatale:', e);
  process.exit(1);
});
