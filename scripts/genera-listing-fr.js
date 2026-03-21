/**
 * genera-listing-fr.js
 *
 * Script bulk: genera listing in francese per tutti i prodotti con listing IT compilato,
 * usando Claude AI (generateAllAiAttributesFR) e salva in product_attribute_values_fr.
 *
 * Uso:
 *   node scripts/genera-listing-fr.js              → genera solo i prodotti senza listing FR
 *   node scripts/genera-listing-fr.js --force      → rigenera tutti (sovrascrive)
 *   node scripts/genera-listing-fr.js --id 42      → solo prodotto con id=42
 *   node scripts/genera-listing-fr.js --id 42,43   → solo prodotti 42 e 43
 *
 * Rate limit: 1 prodotto ogni 5 secondi per evitare throttling API Anthropic.
 */

require('dotenv').config();
const { query } = require('../database/db');
const { generateAllAiAttributesFR } = require('../services/anthropicService');
const { saveAiValuesFR, getProductListingFR } = require('../services/attributeService');

const DELAY_MS = 5000; // 5 secondi tra un prodotto e l'altro

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const forceMode = args.includes('--force');

  // Parsing --id 42 o --id 42,43
  let filterIds = null;
  const idIdx = args.indexOf('--id');
  if (idIdx !== -1 && args[idIdx + 1]) {
    filterIds = args[idIdx + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  }

  console.log('🇫🇷 Generazione listing FR — avvio');
  console.log(`   Modalità: ${forceMode ? 'FORCE (rigenera tutto)' : 'INCREMENTALE (salta esistenti)'}`);
  if (filterIds) console.log(`   Filtro ID: ${filterIds.join(', ')}`);
  console.log('');

  // Carica prodotti con listing IT compilato
  let productsResult;
  if (filterIds && filterIds.length > 0) {
    productsResult = await query(
      `SELECT p.* FROM products p WHERE p.id = ANY($1) ORDER BY p.id ASC`,
      [filterIds]
    );
  } else {
    productsResult = await query(`
      SELECT p.*
      FROM products p
      WHERE EXISTS (
        SELECT 1 FROM product_attribute_values pa
        WHERE pa.product_id = p.id AND pa.value IS NOT NULL AND pa.value <> ''
      )
      ORDER BY p.id ASC
    `);
  }

  const products = productsResult.rows;
  console.log(`📦 Prodotti da processare: ${products.length}`);
  console.log('');

  let success = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const label = `[${i + 1}/${products.length}] ${product.sku_padre || product.titolo_opera || `ID:${product.id}`}`;

    // Controlla se già esiste listing FR (skip in modalità incrementale)
    if (!forceMode) {
      const existingFR = await getProductListingFR(product.id);
      const hasContent = Object.keys(existingFR).some(k =>
        existingFR[k] && existingFR[k].length > 0
      );
      if (hasContent) {
        console.log(`⏭️  ${label} — FR già presente, skip`);
        skipped++;
        continue;
      }
    }

    try {
      console.log(`🤖 ${label} — generazione in corso...`);
      const aiValues = await generateAllAiAttributesFR(product, [], '');
      await saveAiValuesFR(product.id, aiValues);

      const titolo = aiValues["Nome dell'articolo"] || aiValues['Titolo'] || '';
      console.log(`✅ ${label} — OK`);
      if (titolo) console.log(`   Titolo: ${titolo.substring(0, 80)}...`);

      success++;
    } catch (err) {
      console.error(`❌ ${label} — ERRORE: ${err.message}`);
      errors++;
    }

    // Rate limit: aspetta tra un prodotto e l'altro (non dopo l'ultimo)
    if (i < products.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log('');
  console.log('─────────────────────────────────────────');
  console.log(`✅ Generati:  ${success}`);
  console.log(`⏭️  Saltati:   ${skipped}`);
  console.log(`❌ Errori:    ${errors}`);
  console.log(`📦 Totale:    ${products.length}`);
  console.log('─────────────────────────────────────────');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
