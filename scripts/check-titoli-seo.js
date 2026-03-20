#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const seoPhrases = [
  'quadri moderni soggiorno',
  'decorazioni parete',
  'quadri moderni camera da letto',
  'quadri moderni ufficio e studio',
];

async function main() {
  const nomeArticolo = "Nome dell'articolo";
  const r = await pool.query(
    `SELECT p.id, p.titolo_opera, pav.value AS titolo
     FROM products p
     JOIN product_attribute_values pav ON pav.product_id = p.id
     JOIN attribute_definitions ad ON ad.id = pav.attribute_id
     WHERE ad.nome_attributo = $1
     ORDER BY p.id`,
    [nomeArticolo]
  );

  console.log('=== VERIFICA KEYWORD SEO NEI TITOLI ===');
  console.log('Frasi cercate: ' + seoPhrases.join(' | '));
  console.log('');

  let ok = 0, fail = 0;
  r.rows.forEach(row => {
    const t = (row.titolo || '').toLowerCase();
    const found = seoPhrases.filter(p => t.includes(p));
    const check = found.length > 0 ? '✅' : '❌';
    if (found.length > 0) ok++; else fail++;
    const kwFound = found.length > 0 ? found.join(', ') : 'NESSUNA KW SEO';
    console.log(`${check} id:${row.id} [${kwFound}]`);
    console.log(`   ${(row.titolo || '').slice(0, 100)}`);
  });

  console.log('');
  console.log(`RIEPILOGO: ${ok}/50 titoli con keyword SEO ✅, ${fail} senza ❌`);
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
