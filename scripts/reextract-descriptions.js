#!/usr/bin/env node
/**
 * reextract-descriptions.js
 *
 * Ri-estrae le descrizioni dai file .pages con il metodo CORRETTO:
 *   osascript → export DOCX → textutil -convert txt
 *
 * Il metodo precedente (strings su binario .iwa) produceva testo corrotto.
 * Questo script sovrascrive i file __descrizione.txt con testo pulito e
 * aggiorna descrizione_raw nel DB per i prodotti senza ASIN.
 *
 * Uso:
 *   node scripts/reextract-descriptions.js            ← tutto
 *   node scripts/reextract-descriptions.js --dry-run  ← mostra senza scrivere
 *   node scripts/reextract-descriptions.js --no-db    ← solo file, no DB update
 *   node scripts/reextract-descriptions.js --slug bacio-al-molo
 */

'use strict';

require('dotenv').config();

const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { execSync, spawnSync } = require('child_process');
const { Pool }  = require('pg');

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const BASE_DIR       = '/Users/matteo/Desktop/SIVIGLIA/IMMAGINI';
const OUTPUT_DIR     = path.join(BASE_DIR, 'NORMALIZZATE');
const CONTAINERS     = ['1', '2', 'fuori_luogo_1', 'fuori_luogo_4'];
const TEMP_DOCX      = path.join(os.tmpdir(), 'siviglia_export_tmp.docx');

// ──────────────────────────────────────────────
// CLI ARGS
// ──────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const NO_DB      = args.includes('--no-db');
const SLUG_FILTER = (() => {
  const i = args.indexOf('--slug');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

// ──────────────────────────────────────────────
// DB (lazy)
// ──────────────────────────────────────────────
let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
      max: 3,
      connectionTimeoutMillis: 20000,
    });
  }
  return _pool;
}
async function dbQuery(sql, params) {
  const c = await getPool().connect();
  try { return await c.query(sql, params); } finally { c.release(); }
}
async function closePool() { if (_pool) { await _pool.end(); _pool = null; } }

// ──────────────────────────────────────────────
// UTILITY
// ──────────────────────────────────────────────
function toSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractDim(str) {
  const m = str.match(/(\d+)[xX](\d+)/);
  return m ? `${m[1]}x${m[2]}` : null;
}

/**
 * Pulisce il testo estratto da textutil:
 * - Rimuove il BOM e caratteri di controllo Unicode (U+200F ecc.)
 * - Rimuove righe vuote eccessive
 * - Trim globale
 */
function cleanText(raw) {
  return raw
    .replace(/\u200f/g, '')   // RIGHT-TO-LEFT MARK (inserito da Pages)
    .replace(/\u200e/g, '')   // LEFT-TO-RIGHT MARK
    .replace(/\ufeff/g, '')   // BOM
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')  // max 2 righe vuote consecutive
    .trim();
}

// ──────────────────────────────────────────────
// ESTRAZIONE: osascript → .docx → textutil
// ──────────────────────────────────────────────
function extractTextFromPages(pagesPath) {
  // 1. Rimuovi temp file precedente
  if (fs.existsSync(TEMP_DOCX)) fs.unlinkSync(TEMP_DOCX);

  // 2. Esporta con Pages.app via osascript
  const escapedSrc = pagesPath.replace(/"/g, '\\"');
  const escapedDst = TEMP_DOCX.replace(/"/g, '\\"');

  const script = `
set f to POSIX file "${escapedSrc}"
set o to POSIX file "${escapedDst}"
tell application "Pages"
  set d to open f
  export d to o as Microsoft Word
  close d saving no
end tell
`.trim();

  const result = spawnSync('osascript', ['-e', script], {
    timeout: 30000,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`osascript fallito: ${result.stderr || result.stdout || 'errore sconosciuto'}`);
  }

  if (!fs.existsSync(TEMP_DOCX)) {
    throw new Error('File DOCX non creato da Pages');
  }

  // 3. Converti DOCX → testo con textutil
  const txtResult = spawnSync('textutil', ['-convert', 'txt', '-stdout', TEMP_DOCX], {
    timeout: 10000,
    encoding: 'utf8',
  });

  if (txtResult.status !== 0) {
    throw new Error(`textutil fallito: ${txtResult.stderr}`);
  }

  const clean = cleanText(txtResult.stdout);
  if (clean.length < 30) {
    throw new Error(`Testo estratto troppo breve (${clean.length} chars)`);
  }

  return clean;
}

// ──────────────────────────────────────────────
// SCAN CARTELLE → elenco { slug, pagesPath }
// ──────────────────────────────────────────────
function scanPagesFiles() {
  const results = [];

  for (const container of CONTAINERS) {
    const containerPath = path.join(BASE_DIR, container);
    if (!fs.existsSync(containerPath)) continue;

    for (const subfolder of fs.readdirSync(containerPath).sort()) {
      const subPath = path.join(containerPath, subfolder);
      if (!fs.statSync(subPath).isDirectory()) continue;

      const folderDim = extractDim(subfolder);
      if (!folderDim) continue;

      const nomeRaw = subfolder
        .replace(/^\d+[xX]\d+\s+/, '')
        .replace(/\s+[xX]?\s*AMAZON\s*$/i, '')
        .trim();
      if (!nomeRaw) continue;

      const slug = toSlug(nomeRaw);

      const files = fs.readdirSync(subPath);
      const pagesFiles = files.filter(f => path.extname(f).toLowerCase() === '.pages');

      for (const pagesFile of pagesFiles) {
        results.push({
          slug,
          nomeRaw,
          container,
          pagesPath: path.join(subPath, pagesFile),
        });
        break; // basta il primo .pages per cartella
      }
    }
  }

  // De-duplica per slug (tieni solo il primo trovato)
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.slug)) return false;
    seen.add(r.slug);
    return true;
  });
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
async function main() {
  console.log('\n📄 RE-ESTRAZIONE DESCRIZIONI (osascript → DOCX → textutil)');
  if (DRY_RUN) console.log('   🔍 DRY RUN — nessuna scrittura');
  if (NO_DB)   console.log('   🔍 NO-DB — solo file, nessun aggiornamento DB');
  if (SLUG_FILTER) console.log(`   🔎 Filtro slug: ${SLUG_FILTER}`);
  console.log('='.repeat(60));

  // 1. Controlla Pages.app disponibile
  try {
    execSync('osascript -e \'tell application "Pages" to version\'', { timeout: 5000 });
    console.log('✅ Pages.app disponibile\n');
  } catch {
    console.error('❌ Pages.app non disponibile o non risponde.');
    console.error('   Assicurati che Pages sia installato e apri almeno un documento manualmente una volta.');
    process.exit(1);
  }

  // 2. Scansiona file .pages
  let entries = scanPagesFiles();
  if (SLUG_FILTER) {
    entries = entries.filter(e => e.slug === SLUG_FILTER);
    if (entries.length === 0) {
      console.error(`❌ Slug "${SLUG_FILTER}" non trovato.`);
      process.exit(1);
    }
  }
  console.log(`📂 Trovati ${entries.length} file .pages\n`);

  // 3. Carica prodotti DB (per skip ASIN e update)
  let allProducts = [];
  if (!NO_DB && !DRY_RUN && process.env.DATABASE_URL) {
    console.log('🗄️  Caricamento prodotti dal DB...');
    const res = await dbQuery(`
      SELECT id, titolo_opera, asin_padre, asin_max, asin_media, asin_mini, descrizione_raw
      FROM products ORDER BY id
    `);
    allProducts = res.rows.map(p => ({
      ...p,
      _slug: toSlug(p.titolo_opera || ''),
    }));
    console.log(`   ${allProducts.length} prodotti in DB\n`);
  }

  // 4. Elabora ciascun file
  const stats = { ok: 0, skip_asin: 0, skip_dry: 0, errors: 0, db_updated: 0 };

  for (const entry of entries) {
    const { slug, nomeRaw, pagesPath } = entry;
    const destPath = path.join(OUTPUT_DIR, `${slug}__descrizione.txt`);

    process.stdout.write(`📄 [${slug}] ${nomeRaw}: `);

    // Trova prodotto nel DB
    const product = allProducts.find(p => p._slug === slug);

    // Skip se ha ASIN (già pubblicato, non rigeneriamo)
    if (product) {
      const hasAsin = product.asin_padre || product.asin_max || product.asin_media || product.asin_mini;
      if (hasAsin) {
        console.log(`⏭️  SKIP (ha ASIN)`);
        stats.skip_asin++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log(`[DRY] → ${path.basename(destPath)}`);
      stats.skip_dry++;
      continue;
    }

    // Estrai testo
    try {
      const testo = extractTextFromPages(pagesPath);
      console.log(`✅ ${testo.length} chars`);

      // Salva file .txt
      fs.writeFileSync(destPath, testo, 'utf8');

      // Aggiorna DB se possibile
      if (!NO_DB && product && testo.length >= 50) {
        await dbQuery(
          'UPDATE products SET descrizione_raw = $1 WHERE id = $2',
          [testo, product.id]
        );
        console.log(`   💾 DB aggiornato [id:${product.id}]`);
        stats.db_updated++;
      } else if (!NO_DB && !product) {
        console.log(`   ⚠️  Prodotto non trovato in DB (solo file salvato)`);
      }

      stats.ok++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      stats.errors++;
    }

    // Piccola pausa tra i file (Pages.app ha bisogno di tempo)
    await new Promise(r => setTimeout(r, 800));
  }

  // 5. Cleanup temp file
  if (fs.existsSync(TEMP_DOCX)) fs.unlinkSync(TEMP_DOCX);

  // 6. Report finale
  console.log('\n' + '='.repeat(60));
  console.log('✅  RE-ESTRAZIONE COMPLETATA');
  console.log('='.repeat(60));
  console.log(`📄  Estratte OK:        ${stats.ok}`);
  console.log(`💾  DB aggiornati:      ${stats.db_updated}`);
  console.log(`⏭️   Skip (ASIN):        ${stats.skip_asin}`);
  console.log(`❌  Errori:             ${stats.errors}`);

  if (stats.db_updated > 0) {
    console.log('\n🎉 Rigenera i listing AI dalla dashboard (tab Descrizione → "🔄 Rigenera tutto")');
    console.log('   o esegui una rigenerazione bulk con node scripts/bulk-regenerate.js');
  }

  await closePool();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
