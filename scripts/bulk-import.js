#!/usr/bin/env node
/**
 * bulk-import.js
 *
 * Importa MASSIVAMENTE tutte le immagini dalla cartella NORMALIZZATE
 * verso Cloudinary e aggiorna il database con gli URL.
 *
 * Logica:
 *  - Per ogni slug trovato in NORMALIZZATE cerca il prodotto nel DB tramite titolo
 *  - ⚠️  SALTA i prodotti che hanno già un ASIN (già pubblicati su Amazon)
 *  - Carica su Cloudinary: principale, frontale/laterale per variante, proporzione
 *  - Aggiorna il DB con URL immagini + descrizione_raw (se mancante)
 *
 * Uso:
 *   node scripts/bulk-import.js            ← esegue tutto
 *   node scripts/bulk-import.js --dry-run  ← mostra cosa farebbe (nessun upload)
 *   node scripts/bulk-import.js --slug bacio-al-molo  ← solo un'opera
 *
 * Mappa file → colonne DB:
 *   {slug}__principale.jpg          → immagine_max / immagine_media / immagine_mini
 *   {slug}__{dim}_frontale.png      → immagine_{size}_2  (frontale lifestyle)
 *   {slug}__{dim}_laterale.png      → immagine_{size}_4  (di lato — colonna dedicata)
 *   {slug}__{dim}_proporzione.jpg   → immagine_{size}_3  (scala proporzione)
 *   {slug}__dettaglio_1.jpg         → dettaglio_1  (immagine dettaglio per parent)
 *   {slug}__dettaglio_2.jpg         → dettaglio_2  (immagine dettaglio per parent)
 *   {slug}__dettaglio_3.jpg         → dettaglio_3  (immagine dettaglio per parent)
 *   {slug}__descrizione.txt         → descrizione_raw (solo se campo vuoto/corto)
 *
 * NOTA dimensioni: NORMALIZZATE usa height×base (es. "90x135", come consegna il cliente).
 *                  Il DB usa base×altezza (es. "135x90", dopo swapDimensions).
 *                  Il matching è bidirezionale tramite dimMatch().
 */

'use strict';

require('dotenv').config();

const fs     = require('fs');
const path   = require('path');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const sharp  = require('sharp');

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const NORMALIZZATE_DIR  = '/Users/matteo/Desktop/SIVIGLIA/IMMAGINI/NORMALIZZATE';
const CLOUDINARY_FOLDER = 'sivigliart';
const DELAY_MS          = 700;   // ms tra un upload e l'altro (rate limit Cloudinary)

// ──────────────────────────────────────────────
// CLI ARGS
// ──────────────────────────────────────────────
const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const SCAN_ONLY   = args.includes('--scan-only');  // solo scan locale, no DB/Cloudinary
const SLUG_FILTER = (() => {
  const i = args.indexOf('--slug');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

// ──────────────────────────────────────────────
// DATABASE (lazy — creato solo quando serve, mai in SCAN_ONLY)
// ──────────────────────────────────────────────
let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
        ? { rejectUnauthorized: false }
        : false,
      max: 5,
      connectionTimeoutMillis: 20000,
    });
  }
  return _pool;
}

async function dbQuery(sql, params) {
  const client = await getPool().connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function closePool() {
  if (_pool) { await _pool.end(); _pool = null; }
}

// ──────────────────────────────────────────────
// CLOUDINARY
// ──────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const CLOUDINARY_MAX = 9.5 * 1024 * 1024; // 9.5 MB (limite Cloudinary free plan: 10 MB)

async function uploadToCloudinary(filePath, publicId) {
  let buffer = fs.readFileSync(filePath);
  const ext  = path.extname(filePath).toLowerCase();

  // Comprimi se supera il limite (vale per PNG grandi e JPG ad alta risoluzione)
  if (buffer.length > CLOUDINARY_MAX) {
    const origMB = (buffer.length / 1024 / 1024).toFixed(1);
    // Per PNG → converti in JPEG con qualità alta (molto più piccolo)
    // Per JPEG → riduci qualità
    if (ext === '.png') {
      buffer = await sharp(buffer)
        .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
    } else {
      buffer = await sharp(buffer)
        .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      // Secondo passaggio se ancora troppo grande
      if (buffer.length > CLOUDINARY_MAX) {
        buffer = await sharp(buffer).jpeg({ quality: 70 }).toBuffer();
      }
    }
    console.log(`    🗜️  Compresso ${origMB} MB → ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  }

  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder:        CLOUDINARY_FOLDER,
        public_id:     publicId,
        overwrite:     true,
        resource_type: 'image',
        transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    ).end(buffer);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ──────────────────────────────────────────────
// UTILITY
// ──────────────────────────────────────────────
function toSlug(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Confronto bidirezionale dimensioni: "90x135" == "135x90" == "135x90 cm" == "90x135cm"
 * Rimuove tutto ciò che non è cifra o 'x' prima di confrontare.
 */
function dimMatch(a, b) {
  if (!a || !b) return false;
  // Rimuove " cm", spazi e qualsiasi non-numerico tranne 'x'
  const normalize = s => s.toLowerCase().replace(/[^0-9x]/g, '');
  const parse     = s => normalize(s).split('x').map(Number);
  const [a1, a2]  = parse(a);
  const [b1, b2]  = parse(b);
  if (isNaN(a1) || isNaN(a2) || isNaN(b1) || isNaN(b2)) return false;
  return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);
}

// ──────────────────────────────────────────────
// SCAN NORMALIZZATE  →  mappa { slug → entry }
// ──────────────────────────────────────────────
function scanNormalizzate() {
  if (!fs.existsSync(NORMALIZZATE_DIR)) {
    console.error(`❌ Cartella NORMALIZZATE non trovata: ${NORMALIZZATE_DIR}`);
    process.exit(1);
  }

  const files   = fs.readdirSync(NORMALIZZATE_DIR).sort();
  const slugMap = {};

  for (const file of files) {
    const sepIdx = file.indexOf('__');
    if (sepIdx < 0) continue;

    const slug    = file.slice(0, sepIdx);
    const rest    = file.slice(sepIdx + 2);              // parte dopo "__"
    const ext     = path.extname(rest).toLowerCase();
    const typeStr = rest.slice(0, -ext.length);          // tipo senza estensione
    const fullPath = path.join(NORMALIZZATE_DIR, file);

    if (!slugMap[slug]) {
      slugMap[slug] = {
        slug,
        principale:  null,
        dettagli:    [],
        variants:    {},   // { "90x135": { frontale?, laterale?, proporzione? } }
        descrizione: null,
      };
    }
    const entry = slugMap[slug];

    if (typeStr === 'principale') {
      entry.principale = fullPath;
      continue;
    }
    if (typeStr === 'descrizione') {
      entry.descrizione = fullPath;
      continue;
    }
    if (/^dettaglio_\d+$/.test(typeStr)) {
      entry.dettagli.push(fullPath);
      continue;
    }
    // {dim}_{tipo}  —  es. "90x135_frontale"
    const varMatch = typeStr.match(/^(\d+x\d+)_(frontale|laterale|proporzione)$/i);
    if (varMatch) {
      const dim  = varMatch[1].toLowerCase();
      const tipo = varMatch[2].toLowerCase();
      if (!entry.variants[dim]) entry.variants[dim] = {};
      entry.variants[dim][tipo] = fullPath;
    }
  }
  return slugMap;
}

// ──────────────────────────────────────────────
// CARICA TUTTI I PRODOTTI DAL DB (con slug pre-calcolato)
// ──────────────────────────────────────────────
async function loadAllProducts() {
  const res = await dbQuery(`
    SELECT id, titolo_opera, autore, descrizione_raw,
           misura_max, misura_media, misura_mini,
           asin_padre, asin_max, asin_media, asin_mini,
           immagine_max,    immagine_media,    immagine_mini,
           immagine_max_2,  immagine_max_3,  immagine_max_4,
           immagine_media_2, immagine_media_3, immagine_media_4,
           immagine_mini_2,  immagine_mini_3,  immagine_mini_4,
           dettaglio_1, dettaglio_2, dettaglio_3
    FROM products
    ORDER BY id
  `);
  return res.rows.map(p => ({
    ...p,
    _slug: toSlug(p.titolo_opera || ''),
  }));
}

// ──────────────────────────────────────────────
// PROCESSA UN SINGOLO SLUG
// ──────────────────────────────────────────────
async function processSlug(entry, allProducts, stats) {
  const { slug, principale, dettagli, variants, descrizione } = entry;

  // Trova prodotto nel DB per slug
  const product = allProducts.find(p => p._slug === slug);

  if (!product) {
    console.log(`  ⚠️  Nessun prodotto DB per slug "${slug}" — SKIP`);
    stats.not_found++;
    return;
  }

  // ── REGOLA PRINCIPALE: salta se ha già un ASIN ───────────────────────
  const hasAsin = product.asin_padre || product.asin_max ||
                  product.asin_media  || product.asin_mini;
  if (hasAsin) {
    const asinInfo = [
      product.asin_padre && `padre:${product.asin_padre}`,
      product.asin_max   && `max:${product.asin_max}`,
    ].filter(Boolean).join(' ');
    console.log(`  ⏭️  SKIP (ha ASIN) [${product.id}] ${product.titolo_opera}  — ${asinInfo}`);
    stats.skipped_asin++;
    return;
  }

  console.log(`\n📦 [id:${product.id}] ${product.titolo_opera}`);
  console.log(`   slug: ${slug}`);

  const updates    = {};
  let   uploadCount = 0;

  // ── 1. PRINCIPALE ────────────────────────────────────────────────────
  if (principale) {
    // Carica solo se almeno una delle tre colonne principali è vuota
    const needsMain = !product.immagine_max || !product.immagine_media || !product.immagine_mini;
    if (needsMain) {
      if (!DRY_RUN) {
        try {
          const url = await uploadToCloudinary(principale, `${slug}__principale`);
          await sleep(DELAY_MS);
          if (!product.immagine_max)   updates.immagine_max   = url;
          if (!product.immagine_media) updates.immagine_media = url;
          if (!product.immagine_mini)  updates.immagine_mini  = url;
          console.log(`  ✅ principale → Cloudinary`);
        } catch (e) {
          console.error(`  ❌ Errore upload principale: ${e.message}`);
          stats.errors++;
          return;
        }
      } else {
        console.log(`  [DRY] principale → ${path.basename(principale)}`);
        if (!product.immagine_max)   updates.immagine_max   = 'DRY_URL';
        if (!product.immagine_media) updates.immagine_media = 'DRY_URL';
        if (!product.immagine_mini)  updates.immagine_mini  = 'DRY_URL';
      }
      uploadCount++;
    } else {
      console.log(`  ⏭️  principale già presente`);
    }
  } else {
    console.log(`  ⚠️  nessuna immagine principale trovata in NORMALIZZATE`);
  }

  // ── 2. VARIANTI (img2 + img3 per ogni taglia) ────────────────────────
  const sizeMap = [
    { size: 'max',   dimField: 'misura_max',   col2: 'immagine_max_2',   col3: 'immagine_max_3',   col4: 'immagine_max_4' },
    { size: 'media', dimField: 'misura_media',  col2: 'immagine_media_2', col3: 'immagine_media_3', col4: 'immagine_media_4' },
    { size: 'mini',  dimField: 'misura_mini',   col2: 'immagine_mini_2',  col3: 'immagine_mini_3',  col4: 'immagine_mini_4' },
  ];

  for (const { size, dimField, col2, col3, col4 } of sizeMap) {
    const dbDim = product[dimField];   // es. "135x90" (base×altezza nel DB)
    if (!dbDim) continue;

    // Trova la chiave dim in variants con matching bidirezionale
    const matchedDim = Object.keys(variants).find(d => dimMatch(d, dbDim));

    if (!matchedDim) {
      console.log(`  ⚠️  ${size} (${dbDim}): nessun file variante in NORMALIZZATE`);
      continue;
    }

    const varFiles = variants[matchedDim];

    // img2 → frontale lifestyle ONLY (non più fallback su laterale)
    if (varFiles.frontale && !product[col2]) {
      if (!DRY_RUN) {
        try {
          const url = await uploadToCloudinary(varFiles.frontale, `${slug}__${matchedDim}_frontale`);
          await sleep(DELAY_MS);
          updates[col2] = url;
          console.log(`  ✅ ${size} img2 (frontale, ${matchedDim}) → Cloudinary`);
        } catch (e) {
          console.error(`  ❌ Errore upload ${size} img2: ${e.message}`);
        }
      } else {
        console.log(`  [DRY] ${size} img2 (frontale, ${matchedDim}) → ${path.basename(varFiles.frontale)}`);
        updates[col2] = 'DRY_URL';
      }
      uploadCount++;
    } else if (product[col2]) {
      console.log(`  ⏭️  ${size} img2 (frontale) già presente`);
    }

    // img4 → laterale (colonna dedicata _4)
    if (varFiles.laterale && !product[col4]) {
      if (!DRY_RUN) {
        try {
          const url = await uploadToCloudinary(varFiles.laterale, `${slug}__${matchedDim}_laterale`);
          await sleep(DELAY_MS);
          updates[col4] = url;
          console.log(`  ✅ ${size} img4 (laterale, ${matchedDim}) → Cloudinary`);
        } catch (e) {
          console.error(`  ❌ Errore upload ${size} img4: ${e.message}`);
        }
      } else {
        console.log(`  [DRY] ${size} img4 (laterale, ${matchedDim}) → ${path.basename(varFiles.laterale)}`);
        updates[col4] = 'DRY_URL';
      }
      uploadCount++;
    } else if (product[col4]) {
      console.log(`  ⏭️  ${size} img4 (laterale) già presente`);
    }

    // img3 → proporzione
    if (varFiles.proporzione && !product[col3]) {
      if (!DRY_RUN) {
        try {
          const url = await uploadToCloudinary(varFiles.proporzione, `${slug}__${matchedDim}_proporzione`);
          await sleep(DELAY_MS);
          updates[col3] = url;
          console.log(`  ✅ ${size} img3 (proporzione, ${matchedDim}) → Cloudinary`);
        } catch (e) {
          console.error(`  ❌ Errore upload ${size} img3: ${e.message}`);
        }
      } else {
        console.log(`  [DRY] ${size} img3 (proporzione, ${matchedDim}) → ${path.basename(varFiles.proporzione)}`);
        updates[col3] = 'DRY_URL';
      }
      uploadCount++;
    } else if (product[col3]) {
      // silenzioso
    }
  }

  // ── 3. DETTAGLI → upload Cloudinary + salva nel DB (dettaglio_1/2/3) ─
  if (dettagli.length > 0) {
    // Ordina per nome file (garantisce dettaglio_1 < dettaglio_2 < dettaglio_3)
    const dettagliSorted = [...dettagli].sort((a, b) =>
      path.basename(a).localeCompare(path.basename(b))
    );
    for (let i = 0; i < Math.min(dettagliSorted.length, 3); i++) {
      const detPath  = dettagliSorted[i];
      const colName  = `dettaglio_${i + 1}`;
      const detName  = `${slug}__dettaglio_${i + 1}`;
      // Salta i _dup
      if (path.basename(detPath).includes('_dup')) continue;
      // Salta se già presente in DB
      if (product[colName]) {
        console.log(`  ⏭️  ${colName} già presente`);
        continue;
      }
      if (!DRY_RUN) {
        try {
          const url = await uploadToCloudinary(detPath, detName);
          await sleep(DELAY_MS);
          updates[colName] = url;
          console.log(`  ✅ ${colName} → Cloudinary`);
        } catch (e) {
          console.error(`  ❌ Errore upload ${colName}: ${e.message}`);
        }
      } else {
        console.log(`  [DRY] ${colName} → ${path.basename(detPath)}`);
        updates[colName] = 'DRY_URL';
      }
      uploadCount++;
    }
  }

  // ── 4. DESCRIZIONE → descrizione_raw (solo se mancante o troppo corta) ─
  if (descrizione) {
    const currLen = (product.descrizione_raw || '').trim().length;
    if (currLen < 100) {
      const raw = fs.readFileSync(descrizione, 'utf-8').trim();
      if (raw.length > 50) {
        updates.descrizione_raw = raw;
        console.log(`  📄 descrizione aggiornata (${raw.length} chars)`);
      }
    } else {
      console.log(`  ⏭️  descrizione già presente (${currLen} chars)`);
    }
  }

  // ── 5. UPDATE DB ──────────────────────────────────────────────────────
  const changedFields = Object.keys(updates);
  if (changedFields.length === 0) {
    console.log(`  ℹ️  Nessun aggiornamento necessario`);
    stats.no_changes++;
    return;
  }

  if (!DRY_RUN) {
    const setClause = changedFields
      .map((k, i) => `${k} = $${i + 2}`)
      .join(', ');
    await dbQuery(
      `UPDATE products SET ${setClause} WHERE id = $1`,
      [product.id, ...changedFields.map(k => updates[k])]
    );
    console.log(`  💾 DB aggiornato: ${changedFields.join(', ')} (${uploadCount} upload)`);
  } else {
    console.log(`  [DRY] DB update: ${changedFields.join(', ')}`);
  }
  stats.updated++;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
async function main() {
  console.log('\n🚀  BULK IMPORT — NORMALIZZATE → Cloudinary + DB');
  if (SCAN_ONLY)   console.log('    🔍 SCAN ONLY — solo analisi locale, nessuna connessione DB/Cloudinary');
  if (DRY_RUN)     console.log('    🔍 DRY RUN — connessione DB attiva, nessun upload');
  if (SLUG_FILTER) console.log(`    🔎 Filtro slug: ${SLUG_FILTER}`);
  console.log('='.repeat(60));

  // Scansione NORMALIZZATE (sempre locale, nessuna connessione)
  console.log(`\n📂 Scansione: ${NORMALIZZATE_DIR}`);
  const slugMap  = scanNormalizzate();
  const allSlugs = Object.keys(slugMap).sort();
  console.log(`   ${allSlugs.length} opere trovate\n`);

  // ── SCAN ONLY: stampa riepilogo file e termina ──────────────────────
  if (SCAN_ONLY) {
    const toShow = SLUG_FILTER ? allSlugs.filter(s => s === SLUG_FILTER) : allSlugs;
    for (const slug of toShow) {
      const e = slugMap[slug];
      const varDims = Object.keys(e.variants);
      console.log(`📦 ${slug}`);
      console.log(`   principale:  ${e.principale ? '✅ ' + path.basename(e.principale) : '❌ mancante'}`);
      console.log(`   dettagli:    ${e.dettagli.length} file`);
      console.log(`   varianti:    ${varDims.length > 0 ? varDims.map(d => {
        const v = e.variants[d];
        return `${d}[${[v.frontale && 'F', v.laterale && 'L', v.proporzione && 'P'].filter(Boolean).join('')}]`;
      }).join(', ') : '❌ nessuna'}`);
      console.log(`   descrizione: ${e.descrizione ? '✅' : '❌ mancante'}`);
    }
    console.log(`\n📊  Totale opere: ${toShow.length}`);
    console.log('   Usa --dry-run per testare con il DB, o senza flag per eseguire.');
    process.exit(0);   // pool mai creato in scan-only → exit diretto
  }

  // Controllo configurazione DB/Cloudinary
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL non trovato in .env');
    process.exit(1);
  }
  if (!DRY_RUN && !process.env.CLOUDINARY_CLOUD_NAME) {
    console.error('❌ Cloudinary non configurato in .env (CLOUDINARY_CLOUD_NAME mancante)');
    process.exit(1);
  }

  // Prodotti DB
  console.log('🗄️  Caricamento prodotti dal DB...');
  const allProducts = await loadAllProducts();
  console.log(`   ${allProducts.length} prodotti in DB`);

  // Statistiche
  const stats = {
    total:        0,
    updated:      0,
    skipped_asin: 0,
    not_found:    0,
    no_changes:   0,
    errors:       0,
  };

  console.log('\n' + '='.repeat(60));

  // Filtra per --slug se specificato
  const toProcess = SLUG_FILTER
    ? allSlugs.filter(s => s === SLUG_FILTER)
    : allSlugs;

  if (SLUG_FILTER && toProcess.length === 0) {
    console.error(`❌ Slug "${SLUG_FILTER}" non trovato in NORMALIZZATE`);
    console.log('\nSlug disponibili:');
    allSlugs.forEach(s => console.log(`  - ${s}`));
    await closePool();
    process.exit(1);
  }

  for (const slug of toProcess) {
    stats.total++;
    try {
      await processSlug(slugMap[slug], allProducts, stats);
    } catch (err) {
      console.error(`\n  ❌ ERRORE per "${slug}": ${err.message}`);
      stats.errors++;
    }
  }

  // Report finale
  console.log('\n' + '='.repeat(60));
  console.log('✅  BULK IMPORT COMPLETATO');
  console.log('='.repeat(60));
  console.log(`📊  Opere processate:          ${stats.total}`);
  console.log(`✅  Aggiornate:                ${stats.updated}`);
  console.log(`⏭️   Skip (hanno ASIN):         ${stats.skipped_asin}`);
  console.log(`ℹ️   Già complete (no changes): ${stats.no_changes}`);
  console.log(`⚠️   Non trovate in DB:         ${stats.not_found}`);
  console.log(`❌  Errori:                    ${stats.errors}`);

  if (!DRY_RUN && stats.updated > 0) {
    console.log(`\n🎉 ${stats.updated} opere aggiornate con immagini Cloudinary!`);
    console.log('   Ora puoi generare i listing AI dalla dashboard.');
  }

  await closePool();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
