#!/usr/bin/env node
/**
 * Test: verifica che l'export XLSM contenga i titoli aggiornati nel DB.
 * Legge il file generato e controlla la colonna G (indice 6) delle righe dati.
 */
'use strict';
require('dotenv').config();
const { exportAllProductsToXlsm } = require('../services/exportService');
const xlsx = require('xlsx');

async function main() {
  console.log('\n🔍 TEST EXPORT — verifica titoli nel file XLSM generato\n');

  // Genera l'export (tutti i prodotti)
  const { buffer, count } = await exportAllProductsToXlsm();
  console.log(`Export generato: ${count} prodotti\n`);

  // Leggi il buffer e analizza
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets['Modello'];

  if (!sheet) {
    console.error('❌ Foglio "Modello" non trovato nel file generato');
    process.exit(1);
  }

  const DATA_START_ROW = 7; // 0-indexed
  const COL_TITOLO = 6;     // colonna G (0-indexed) = "Nome dell'articolo"
  const COL_SKU = 0;        // colonna A = SKU
  const COL_TIPO = 3;       // colonna D = tipo (Parent/Bambino)

  console.log('Colonna G (Nome articolo) nelle righe dati:\n');

  let found = 0;
  for (let r = DATA_START_ROW; r < DATA_START_ROW + 250; r++) {
    const skuCell = sheet[xlsx.utils.encode_cell({ r, c: COL_SKU })];
    const titoloCell = sheet[xlsx.utils.encode_cell({ r, c: COL_TITOLO })];
    const tipoCell = sheet[xlsx.utils.encode_cell({ r, c: COL_TIPO })];

    if (!skuCell) break; // fine righe

    const sku = skuCell.v || '';
    const titolo = titoloCell?.v || '(vuoto)';
    const tipo = tipoCell?.v || '';

    // Mostra tutte le righe (parent e child)
    const startOK = String(titolo).toLowerCase().startsWith('quadro') ? '✅' : (titolo === '(vuoto)' ? '—' : '❌');
    console.log(`Riga ${r + 1} [${tipo.padEnd(16)}] SKU: ${String(sku).padEnd(25)} | ${startOK} "${String(titolo).slice(0, 90)}"`);
    found++;
  }

  console.log(`\nTotale righe trovate: ${found}`);

  // Controlla quanti titoli iniziano con "Quadro"
  let quadroCount = 0, emptyCount = 0, wrongCount = 0;
  for (let r = DATA_START_ROW; r < DATA_START_ROW + 250; r++) {
    const cell = sheet[xlsx.utils.encode_cell({ r, c: COL_TITOLO })];
    if (!sheet[xlsx.utils.encode_cell({ r, c: COL_SKU })]) break;
    const val = cell?.v || '';
    if (!val) emptyCount++;
    else if (String(val).toLowerCase().startsWith('quadro')) quadroCount++;
    else wrongCount++;
  }

  console.log(`\n📊 Risultato:`);
  console.log(`  ✅ Titoli che iniziano con "Quadro": ${quadroCount}`);
  console.log(`  — Celle vuote (parent/no titolo):    ${emptyCount}`);
  console.log(`  ❌ Titoli errati:                    ${wrongCount}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
