#!/usr/bin/env node
/**
 * scripts/audit-seo-completo.js
 * Audit SEO completo: titolo, chiavi di ricerca, bullet, descrizione
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

const ATTRS = [
  "Nome dell'articolo",
  'Chiavi di ricerca',
  'Punto elenco 1',
  'Punto elenco 2',
  'Punto elenco 3',
  'Punto elenco 4',
  'Punto elenco 5',
  'Descrizione del prodotto',
];

const SEO_ROOMS = [
  'quadri moderni soggiorno',
  'decorazioni parete',
  'quadri moderni camera da letto',
  'quadri moderni ufficio e studio',
];

async function main() {
  // Recupera tutti i prodotti con i loro attributi
  const productsRes = await pool.query(`SELECT id, titolo_opera FROM products ORDER BY id`);
  const products = productsRes.rows;

  // Recupera tutti i valori attributi in una sola query
  const valsRes = await pool.query(`
    SELECT pav.product_id, ad.nome_attributo, pav.value
    FROM product_attribute_values pav
    JOIN attribute_definitions ad ON ad.id = pav.attribute_id
    WHERE ad.nome_attributo = ANY($1)
    ORDER BY pav.product_id
  `, [ATTRS]);

  // Costruisce mappa product_id → { nome_attributo: value }
  const attrMap = {};
  valsRes.rows.forEach(row => {
    if (!attrMap[row.product_id]) attrMap[row.product_id] = {};
    attrMap[row.product_id][row.nome_attributo] = row.value;
  });

  const issues = [];
  const stats = { ok: 0, warn: 0, err: 0, total: products.length };
  const chiaviByteDist = { under800: 0, under1100: 0, ok1100_1250: 0, over1250: 0 };

  products.forEach(product => {
    const attrs = attrMap[product.id] || {};
    const prod_issues = [];

    const t  = attrs["Nome dell'articolo"] || '';
    const k  = attrs['Chiavi di ricerca'] || '';
    const b1 = attrs['Punto elenco 1'] || '';
    const b2 = attrs['Punto elenco 2'] || '';
    const b3 = attrs['Punto elenco 3'] || '';
    const b4 = attrs['Punto elenco 4'] || '';
    const b5 = attrs['Punto elenco 5'] || '';
    const d  = attrs['Descrizione del prodotto'] || '';

    // ── TITOLO ────────────────────────────────────────────
    if (!t) {
      prod_issues.push('❌ TITOLO mancante');
    } else {
      if (t.length > 200) prod_issues.push(`❌ TITOLO troppo lungo: ${t.length} car.`);
      else if (t.length > 180) prod_issues.push(`⚠️  TITOLO zona gialla: ${t.length} car.`);
      else if (t.length < 120) prod_issues.push(`⚠️  TITOLO troppo corto: ${t.length} car.`);
      if (!t.toLowerCase().startsWith('quadro')) prod_issues.push(`❌ TITOLO non inizia con "Quadro": "${t.slice(0, 30)}..."`);
      if (!SEO_ROOMS.some(kw => t.toLowerCase().includes(kw))) prod_issues.push('❌ TITOLO senza frase SEO stanze');
      if (t.toLowerCase().includes('sivigliart')) prod_issues.push('❌ TITOLO contiene brand "sivigliart"');
    }

    // ── CHIAVI DI RICERCA ─────────────────────────────────
    if (!k) {
      prod_issues.push('❌ CHIAVI mancanti');
    } else {
      const bytes = Buffer.byteLength(k, 'utf8');
      if (bytes < 800) { prod_issues.push(`❌ CHIAVI troppo corte: ${bytes} byte (min 1100)`); chiaviByteDist.under800++; }
      else if (bytes < 1100) { prod_issues.push(`⚠️  CHIAVI sotto target: ${bytes} byte (target 1100-1200)`); chiaviByteDist.under1100++; }
      else if (bytes > 1250) { prod_issues.push(`❌ CHIAVI troppo lunghe: ${bytes} byte (max 1250)`); chiaviByteDist.over1250++; }
      else chiaviByteDist.ok1100_1250++;
      if (k.includes(',')) prod_issues.push('⚠️  CHIAVI contengono virgole (deve essere solo spazi)');
      if (/\bwall art\b|\bcanvas\b|\bhome decor\b|\bgift\b/i.test(k)) prod_issues.push('⚠️  CHIAVI contengono parole inglesi');
      if (k.toLowerCase().includes('sivigliart')) prod_issues.push('❌ CHIAVI contengono brand "sivigliart"');
    }

    // ── BULLET POINTS ─────────────────────────────────────
    if (!b1) prod_issues.push('❌ BULLET 1 mancante');
    else if (!b1.toUpperCase().includes('STAMPA SU TELA CANVAS')) prod_issues.push(`⚠️  BULLET 1 senza "STAMPA SU TELA CANVAS": "${b1.slice(0, 50)}..."`);

    if (!b2) prod_issues.push('❌ BULLET 2 mancante');
    else if (!b2.toUpperCase().includes('ARTE ')) prod_issues.push(`⚠️  BULLET 2 non inizia con "ARTE –": "${b2.slice(0, 50)}..."`);

    if (!b3) prod_issues.push('❌ BULLET 3 mancante');
    else if (!b3.toUpperCase().includes('DECORAZIONE PARETE')) prod_issues.push(`⚠️  BULLET 3 senza "DECORAZIONE PARETE": "${b3.slice(0, 50)}..."`);

    if (!b4) prod_issues.push('❌ BULLET 4 mancante');
    else if (!b4.toUpperCase().includes('PRONTO DA APPENDERE')) prod_issues.push(`⚠️  BULLET 4 senza "PRONTO DA APPENDERE": "${b4.slice(0, 50)}..."`);

    if (!b5) prod_issues.push('❌ BULLET 5 mancante');
    else if (!b5.toUpperCase().includes('IDEA REGALO')) prod_issues.push(`⚠️  BULLET 5 senza "IDEA REGALO": "${b5.slice(0, 50)}..."`);

    // Lunghezze bullet (max 220)
    [b1, b2, b3, b4, b5].forEach((b, i) => {
      if (b && b.length > 220) prod_issues.push(`⚠️  BULLET ${i + 1} troppo lungo: ${b.length} car. (max 220)`);
    });

    // HTML nei bullet
    [b1, b2, b3, b4, b5].forEach((b, i) => {
      if (b && /<[a-z]/i.test(b)) prod_issues.push(`❌ BULLET ${i + 1} contiene HTML`);
    });

    // ── DESCRIZIONE ───────────────────────────────────────
    if (!d) {
      prod_issues.push('❌ DESCRIZIONE mancante');
    } else {
      if (d.length < 200) prod_issues.push(`⚠️  DESCRIZIONE troppo corta: ${d.length} car. (min 200)`);
      if (d.length > 2000) prod_issues.push(`❌ DESCRIZIONE troppo lunga: ${d.length} car. (max 2000)`);
      if (/<[a-z]/i.test(d)) prod_issues.push('❌ DESCRIZIONE contiene tag HTML');
      if (!d.includes("Quadro che riproduce")) prod_issues.push('⚠️  DESCRIZIONE manca frase intro "Quadro che riproduce..."');
    }

    if (prod_issues.length === 0) {
      stats.ok++;
    } else {
      const hasErr = prod_issues.some(i => i.startsWith('❌'));
      hasErr ? stats.err++ : stats.warn++;
      issues.push({ id: product.id, opera: product.titolo_opera, issues: prod_issues });
    }
  });

  // ── OUTPUT ────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log('     AUDIT SEO COMPLETO — TUTTI GLI ATTRIBUTI');
  console.log('════════════════════════════════════════════════════════');
  console.log(`Prodotti analizzati: ${stats.total}`);
  console.log(`✅ Perfetti:         ${stats.ok}`);
  console.log(`⚠️  Solo warning:    ${stats.warn}`);
  console.log(`❌ Con errori:       ${stats.err}`);

  console.log('\n--- Distribuzione byte Chiavi di ricerca ---');
  console.log(`  ❌ Sotto 800 byte:       ${chiaviByteDist.under800}`);
  console.log(`  ⚠️  800–1099 byte:       ${chiaviByteDist.under1100}`);
  console.log(`  ✅ 1100–1250 byte (OK):  ${chiaviByteDist.ok1100_1250}`);
  console.log(`  ❌ Oltre 1250 byte:      ${chiaviByteDist.over1250}`);

  if (issues.length > 0) {
    console.log('\n════════════════════════════════════════════════════════');
    console.log('                  DETTAGLIO PROBLEMI');
    console.log('════════════════════════════════════════════════════════');
    issues.forEach(p => {
      console.log(`\nid:${p.id} — ${p.opera}`);
      p.issues.forEach(i => console.log(`   ${i}`));
    });
  }

  console.log('\n════════════════════════════════════════════════════════\n');
  await pool.end();
}

main().catch(e => { console.error('Errore fatale:', e.message); process.exit(1); });
