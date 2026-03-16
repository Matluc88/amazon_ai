/**
 * Script: rigenera-keyword.js
 * 
 * Rigenera le "Chiavi di ricerca" (Search Terms) di tutti i prodotti compilati
 * usando Claude AI con il prompt aggiornato che punta a 1100-1200 byte su 5 slot.
 * 
 * Problema rilevato: i listing esistenti hanno in media solo 379 byte su 1250 disponibili
 * (30% dello spazio keyword utilizzato). Il prompt aggiornato richiede 150+ parole e
 * riempie correttamente i 5 slot.
 * 
 * Uso:
 *   node scripts/rigenera-keyword.js           → tutti i prodotti
 *   node scripts/rigenera-keyword.js --dry-run → mostra cosa farebbe senza salvare
 *   node scripts/rigenera-keyword.js --id 4,12,28 → solo i prodotti con quegli ID
 * 
 * Rate limiting: 1 prodotto ogni 3 secondi per evitare rate limit Claude API.
 */

require('dotenv').config();
const { query } = require('../database/db');
const { regenerateSingleAttribute } = require('../services/anthropicService');
const { saveAiValues } = require('../services/attributeService');

const DELAY_MS = 3000; // pausa tra chiamate AI

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const idArg = args.find(a => a.startsWith('--id'));
let filterIds = null;
if (idArg) {
  const idStr = idArg.split('=')[1] || args[args.indexOf(idArg) + 1];
  filterIds = idStr ? idStr.split(',').map(Number).filter(n => !isNaN(n)) : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== RIGENERAZIONE KEYWORD DI MASSA ===');
  if (isDryRun) console.log('⚠️  DRY-RUN — nessuna scrittura nel DB');
  
  // Carica prodotti da rigenerare
  let result;
  if (filterIds && filterIds.length > 0) {
    result = await query(
      'SELECT * FROM products WHERE id = ANY($1) ORDER BY id',
      [filterIds]
    );
    console.log('Prodotti selezionati per ID:', filterIds.join(', '));
  } else {
    result = await query(`
      SELECT p.* FROM products p
      WHERE EXISTS (
        SELECT 1 FROM product_attribute_values pav
        WHERE pav.product_id = p.id AND pav.value IS NOT NULL AND pav.value <> ''
      )
      ORDER BY p.id
    `);
  }
  
  const products = result.rows;
  console.log('Prodotti da elaborare:', products.length);
  console.log('Tempo stimato:', Math.round(products.length * DELAY_MS / 1000 / 60), 'minuti\n');

  let ok = 0, errors = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const sku = product.sku_padre || product.sku_max || `ID-${product.id}`;
    process.stdout.write(`[${i + 1}/${products.length}] ${sku} ... `);

    try {
      // Recupera valore attuale delle keyword
      const attrRes = await query(
        `SELECT pav.value FROM product_attribute_values pav
         JOIN attribute_definitions ad ON ad.id = pav.attribute_id
         WHERE pav.product_id = $1 AND ad.nome_attributo = 'Chiavi di ricerca'`,
        [product.id]
      );
      const currentKeywords = attrRes.rows[0]?.value || '';

      if (!isDryRun) {
        // Chiama AI per rigenerare solo le keyword
        const result = await regenerateSingleAttribute(
          product,
          'Chiavi di ricerca',
          currentKeywords,
          [] // no seed keywords aggiuntive
        );

        if (result['Chiavi di ricerca']) {
          await saveAiValues(product.id, { 'Chiavi di ricerca': result['Chiavi di ricerca'] });
          const bytes = Buffer.byteLength(result['Chiavi di ricerca'], 'utf8');
          console.log(`✅ ${bytes} byte`);
        } else {
          console.log('⚠️ AI non ha restituito keyword');
          errors++;
          continue;
        }
      } else {
        // Dry run: mostra solo byte attuali
        const bytes = currentKeywords ? Buffer.byteLength(currentKeywords, 'utf8') : 0;
        console.log(`[dry-run] attuale: ${bytes} byte`);
      }

      ok++;
    } catch (e) {
      console.log(`❌ ERRORE: ${e.message}`);
      errors++;
    }

    // Rate limiting
    if (i < products.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n=== COMPLETATO ===`);
  console.log(`Successi: ${ok} | Errori: ${errors}`);
  console.log('Ora ri-esporta il XLSM dall\'app per vedere i 5 slot keyword pieni.');
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Errore fatale:', e);
  process.exit(1);
});
