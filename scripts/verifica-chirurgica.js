#!/usr/bin/env node
/**
 * scripts/verifica-chirurgica.js
 * Verifica dettagliata di ogni prodotto con warning:
 * - Titoli zona gialla (181-200 char): mostra testo completo + conteggio char
 * - Bullet 5 > 220 char: mostra testo + punto di taglio
 * - Chiavi sotto 1100 byte: mostra quanti byte mancano + anteprima
 * - Titolo id:4 a 200 char: mostra se rientra nel limite
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

const SEO_ROOMS = [
  'quadri moderni soggiorno e camera da letto',
  'quadri moderni soggiorno e ufficio',
  'quadri moderni camera da letto e studio',
  'decorazioni parete salotto e ingresso',
  'quadri moderni ufficio e studio',
  'decorazioni parete sala da pranzo e corridoio',
];

async function main() {
  const productsRes = await pool.query(`SELECT id, titolo_opera FROM products ORDER BY id`);
  const products = productsRes.rows;

  const ATTRS = [
    "Nome dell'articolo",
    'Chiavi di ricerca',
    'Punto elenco 1', 'Punto elenco 2', 'Punto elenco 3',
    'Punto elenco 4', 'Punto elenco 5',
    'Descrizione del prodotto',
    'Stile', 'Tema', 'Tipo di stanza', 'Famiglia di colori',
    'Colore', 'Personaggio rappresentato', 'Tema animali',
    'Funzioni speciali', 'Stagioni', 'Edizione',
  ];

  const valsRes = await pool.query(`
    SELECT pav.product_id, ad.nome_attributo, pav.value
    FROM product_attribute_values pav
    JOIN attribute_definitions ad ON ad.id = pav.attribute_id
    WHERE ad.nome_attributo = ANY($1)
    ORDER BY pav.product_id
  `, [ATTRS]);

  const attrMap = {};
  valsRes.rows.forEach(row => {
    if (!attrMap[row.product_id]) attrMap[row.product_id] = {};
    attrMap[row.product_id][row.nome_attributo] = row.value;
  });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         VERIFICA CHIRURGICA — TUTTI I 50 PRODOTTI            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let titoliZonaGialla = 0, titoliOK = 0, titoliCorti = 0;
  let chiaviFuoriRange = 0, chiaviOK = 0;
  let bullet5Lunghi = 0, bullet5OK = 0;
  let totalProblems = 0;

  products.forEach(product => {
    const attrs = attrMap[product.id] || {};
    const t  = attrs["Nome dell'articolo"] || '';
    const k  = attrs['Chiavi di ricerca'] || '';
    const b5 = attrs['Punto elenco 5'] || '';
    const b1 = attrs['Punto elenco 1'] || '';
    const b2 = attrs['Punto elenco 2'] || '';
    const b3 = attrs['Punto elenco 3'] || '';
    const b4 = attrs['Punto elenco 4'] || '';
    const d  = attrs['Descrizione del prodotto'] || '';

    const kBytes = Buffer.byteLength(k, 'utf8');
    const problems = [];

    // ── TITOLO ───────────────────────────────────────────────────────────
    let titoloStatus = '';
    if (!t) {
      titoloStatus = '❌ MANCANTE';
      problems.push('titolo mancante');
    } else if (t.length > 200) {
      titoloStatus = `❌ TROPPO LUNGO (${t.length})`;
      problems.push('titolo > 200');
    } else if (t.length > 180) {
      titoloStatus = `⚠️  ZONA GIALLA (${t.length}/200)`;
      titoliZonaGialla++;
      problems.push('titolo zona gialla');
    } else if (t.length < 120) {
      titoloStatus = `⚠️  TROPPO CORTO (${t.length})`;
      titoliCorti++;
      problems.push('titolo corto');
    } else {
      titoloStatus = `✅ OK (${t.length} car.)`;
      titoliOK++;
    }

    // SEO room nel titolo
    const hasSeoRoom = SEO_ROOMS.some(r => t.toLowerCase().includes(r));
    const seoRoomStatus = hasSeoRoom ? '✅' : '❌ NO ROOM';
    const titoloBrand = t.toLowerCase().includes('sivigliart') ? '❌ BRAND!' : '✅';
    const titoloStart = t.toLowerCase().startsWith('quadro') ? '✅' : `❌ INIZIA: "${t.slice(0,15)}"`;

    // ── CHIAVI ───────────────────────────────────────────────────────────
    let chiaviStatus = '';
    if (!k) {
      chiaviStatus = '❌ MANCANTI';
      problems.push('chiavi mancanti');
    } else if (kBytes > 1250) {
      chiaviStatus = `❌ TROPPO LUNGHE (${kBytes} byte)`;
      chiaviFuoriRange++;
      problems.push('chiavi > 1250 byte');
    } else if (kBytes < 800) {
      chiaviStatus = `❌ TROPPO CORTE (${kBytes} byte)`;
      chiaviFuoriRange++;
      problems.push('chiavi < 800 byte');
    } else if (kBytes < 1100) {
      chiaviStatus = `⚠️  SOTTO TARGET (${kBytes}/1200 byte, mancano ${1100 - kBytes})`;
      chiaviFuoriRange++;
      problems.push('chiavi < 1100 byte');
    } else {
      chiaviStatus = `✅ OK (${kBytes} byte)`;
      chiaviOK++;
    }
    const chiaviVirgole = k.includes(',') ? '⚠️  VIRGOLE' : '✅';
    const chiaviEn = /\bwall art\b|\bcanvas\b|\bhome decor\b|\bgift\b/i.test(k) ? '⚠️  EN' : '✅';
    const chiaviPrime20 = k.slice(0, 120).replace(/\n/g, ' ');

    // ── BULLET 5 ──────────────────────────────────────────────────────────
    let b5Status = '';
    if (!b5) {
      b5Status = '❌ MANCANTE';
      problems.push('bullet5 mancante');
    } else if (b5.length > 220) {
      b5Status = `⚠️  LUNGO (${b5.length}/220 car.)`;
      bullet5Lunghi++;
      problems.push('bullet5 > 220');
    } else {
      b5Status = `✅ OK (${b5.length} car.)`;
      bullet5OK++;
    }
    const b5IdeaRegalo = b5.toUpperCase().includes('IDEA REGALO') ? '✅' : '❌ NO IDEA REGALO';
    const b5Reso = b5.includes('Reso entro 14 giorni') ? '✅' : '⚠️  NO RESO 14GG';

    // ── ALTRI BULLET ─────────────────────────────────────────────────────
    const b1Status = !b1 ? '❌ MANCANTE' : (b1.toUpperCase().includes('STAMPA SU TELA CANVAS') ? `✅ OK (${b1.length})` : `⚠️  NO STAMPA TELA (${b1.length})`);
    const b2Status = !b2 ? '❌ MANCANTE' : (b2.toUpperCase().includes('ARTE ') ? `✅ OK (${b2.length})` : `⚠️  NO "ARTE" (${b2.length})`);
    const b3Status = !b3 ? '❌ MANCANTE' : (b3.toUpperCase().includes('DECORAZIONE PARETE') ? `✅ OK (${b3.length})` : `⚠️  NO "DEC.PARETE" (${b3.length})`);
    const b4Status = !b4 ? '❌ MANCANTE' : (b4.toUpperCase().includes('PRONTO DA APPENDERE') ? `✅ OK (${b4.length})` : `⚠️  NO "PRONTO DA APP." (${b4.length})`);
    const b4Fissativo = b4.toLowerCase().includes('fissativo laccato') ? '✅ laccato' : (b4.toLowerCase().includes('fissativo') ? `⚠️  fissativo ERRATO: "${b4.toLowerCase().match(/fissativo\s+\w+/)?.[0]}"` : '⚠️  no fissativo');

    // ── DESCRIZIONE ───────────────────────────────────────────────────────
    let descStatus = '';
    if (!d) {
      descStatus = '❌ MANCANTE';
      problems.push('descrizione mancante');
    } else if (d.length < 200) {
      descStatus = `⚠️  CORTA (${d.length})`;
    } else if (d.length > 2000) {
      descStatus = `❌ LUNGA (${d.length})`;
      problems.push('descrizione > 2000');
    } else {
      descStatus = `✅ OK (${d.length} car.)`;
    }
    const descHTML = /<[a-z]/i.test(d) ? '❌ HTML!' : '✅';
    const descIntro = d.includes("Quadro che riproduce") ? '✅' : '⚠️  NO INTRO';
    const descDipinto = /\bdipinto\b/i.test(d) ? '⚠️  "dipinto" trovato' : '✅';

    // ── ALTRI ATTRIBUTI ───────────────────────────────────────────────────
    const familiaColori = attrs['Famiglia di colori'] || '—';
    const validFamiglie = ['Bianco', 'Bianco e nero', 'Caldi', 'Freddi', 'Luminosi', 'Neutro', 'Pastelli', 'Scala di grigi', 'Tonalità della terra', 'Toni gioiello'];
    const famColoriStatus = validFamiglie.includes(familiaColori) ? `✅ "${familiaColori}"` : `⚠️  VALORE NON VALIDO: "${familiaColori}"`;

    const stagioni = attrs['Stagioni'] || '—';
    const validStagioni = ['Tutte le stagioni', 'Primavera', 'Estate', 'Autunno', 'Inverno'];
    const stagioniStatus = validStagioni.includes(stagioni) ? `✅ "${stagioni}"` : `⚠️  VALORE NON VALIDO: "${stagioni}"`;

    const funzioniSpec = attrs['Funzioni speciali'] || '—';
    const funzioniStatus = funzioniSpec.includes('Pronto da appendere') && funzioniSpec.includes('Con telaio in legno')
      ? `✅ "${funzioniSpec}"`
      : `⚠️  INCOMPLETO: "${funzioniSpec}"`;

    const tipoStanza = attrs['Tipo di stanza'] || '—';
    const tipoStanzaStatus = tipoStanza.toLowerCase().startsWith('soggiorno') ? `✅ "${tipoStanza}"` : `⚠️  NON INIZIA CON SOGGIORNO: "${tipoStanza}"`;

    totalProblems += problems.length;

    // ── STAMPA PRODOTTO ───────────────────────────────────────────────────
    const hasAnyWarning = problems.length > 0
      || titoloStatus.includes('⚠️')
      || chiaviStatus.includes('⚠️') || chiaviStatus.includes('❌')
      || b5Status.includes('⚠️')
      || b5Reso.includes('⚠️')
      || b4Fissativo.includes('⚠️')
      || descIntro.includes('⚠️')
      || descDipinto.includes('⚠️')
      || famColoriStatus.includes('⚠️')
      || stagioniStatus.includes('⚠️')
      || funzioniStatus.includes('⚠️')
      || tipoStanzaStatus.includes('⚠️');

    console.log(`────────────────────────────────────────────────────────────────`);
    console.log(`[ID:${String(product.id).padEnd(3)}] ${product.titolo_opera}`);
    console.log(`  TITOLO    ${titoloStatus} | SEO: ${seoRoomStatus} | Start: ${titoloStart} | Brand: ${titoloBrand}`);
    if (t) console.log(`           "${t}"`);
    console.log(`  CHIAVI    ${chiaviStatus} | Virgole: ${chiaviVirgole} | EN: ${chiaviEn}`);
    if (k) console.log(`           "${chiaviPrime20}..."`);
    console.log(`  BULLET1   ${b1Status}`);
    console.log(`  BULLET2   ${b2Status}`);
    console.log(`  BULLET3   ${b3Status}`);
    console.log(`  BULLET4   ${b4Status} | Fissativo: ${b4Fissativo}`);
    console.log(`  BULLET5   ${b5Status} | IdeaRegalo: ${b5IdeaRegalo} | Reso14gg: ${b5Reso}`);
    if (b5 && b5.length > 200) console.log(`           "${b5}"`);
    console.log(`  DESCRIZ.  ${descStatus} | HTML: ${descHTML} | Intro: ${descIntro} | Dipinto: ${descDipinto}`);
    console.log(`  FAM.COL.  ${famColoriStatus}`);
    console.log(`  STAGIONI  ${stagioniStatus}`);
    console.log(`  FUNZIONI  ${funzioniStatus}`);
    console.log(`  STANZA    ${tipoStanzaStatus}`);
  });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    RIEPILOGO FINALE                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Prodotti analizzati:    ${products.length}`);
  console.log(`  Titoli OK (120-180):    ${titoliOK}`);
  console.log(`  Titoli zona gialla:     ${titoliZonaGialla} (181-200, validi per Amazon)`);
  console.log(`  Titoli corti:           ${titoliCorti}`);
  console.log(`  Chiavi OK (1100-1250):  ${chiaviOK}`);
  console.log(`  Chiavi fuori range:     ${chiaviFuoriRange}`);
  console.log(`  Bullet 5 OK:            ${bullet5OK}`);
  console.log(`  Bullet 5 > 220:         ${bullet5Lunghi} (warning interno, non violano Amazon)`);
  console.log('');

  await pool.end();
}

main().catch(e => { console.error('Errore fatale:', e.message); process.exit(1); });
