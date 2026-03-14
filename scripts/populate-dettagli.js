#!/usr/bin/env node
/**
 * populate-dettagli.js
 *
 * Recupera gli URL delle immagini dettaglio già caricate su Cloudinary
 * (durante il bulk-import) e le salva nelle colonne dettaglio_1/2/3 del DB.
 *
 * Le immagini hanno public_id del tipo:  sivigliart/{slug}__dettaglio_N
 *
 * Uso:
 *   node scripts/populate-dettagli.js            ← esegue tutto
 *   node scripts/populate-dettagli.js --dry-run  ← mostra cosa farebbe
 *   node scripts/populate-dettagli.js --slug bacio-al-molo
 */

'use strict';

require('dotenv').config();

const { Pool }    = require('pg');
const cloudinary  = require('cloudinary').v2;

const CLOUDINARY_FOLDER = 'sivigliart';
const DELAY_MS          = 300;

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const SLUG_FILTER = (() => {
  const i = args.indexOf('--slug');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

// ── DB ────────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
});

async function dbQuery(sql, params) {
  const client = await pool.connect();
  try   { return await client.query(sql, params); }
  finally { client.release(); }
}

// ── Cloudinary ────────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── slug helper (stessa logica del bulk-import) ───────────────────────────────
function toSlug(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Carica TUTTE le immagini dettaglio da Cloudinary ──────────────────────────
async function fetchAllDettagli() {
  const allResources = [];
  let nextCursor = null;

  do {
    const opts = {
      type:        'upload',
      prefix:      `${CLOUDINARY_FOLDER}/`,
      max_results: 500,
    };
    if (nextCursor) opts.next_cursor = nextCursor;

    const res = await cloudinary.api.resources(opts);
    for (const r of res.resources) {
      // Filtra solo quelli che contengono "__dettaglio_"
      if (r.public_id.includes('__dettaglio_')) {
        allResources.push({
          public_id:   r.public_id,
          secure_url:  r.secure_url,
        });
      }
    }
    nextCursor = res.next_cursor || null;
  } while (nextCursor);

  return allResources;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔍  POPULATE DETTAGLI — Cloudinary → DB');
  if (DRY_RUN)     console.log('    🔍 DRY RUN — nessun aggiornamento DB');
  if (SLUG_FILTER) console.log(`    🔎 Filtro slug: ${SLUG_FILTER}`);
  console.log('='.repeat(60));

  // 1. Carica prodotti dal DB
  console.log('\n🗄️  Caricamento prodotti dal DB...');
  const productsRes = await dbQuery(`
    SELECT id, titolo_opera, dettaglio_1, dettaglio_2, dettaglio_3
    FROM products ORDER BY id
  `);
  const products = productsRes.rows.map(p => ({
    ...p,
    _slug: toSlug(p.titolo_opera || ''),
  }));
  console.log(`   ${products.length} prodotti in DB`);

  // 2. Recupera tutte le immagini dettaglio da Cloudinary
  console.log('\n☁️  Recupero immagini dettaglio da Cloudinary...');
  const dettagliCloud = await fetchAllDettagli();
  console.log(`   ${dettagliCloud.length} immagini dettaglio trovate su Cloudinary`);

  // 3. Costruisci mappa slug → { 1: url, 2: url, 3: url }
  const slugDettagliMap = {};
  for (const r of dettagliCloud) {
    // public_id: "sivigliart/bacio-al-molo__dettaglio_1"
    const filename = r.public_id.replace(`${CLOUDINARY_FOLDER}/`, '');
    const m = filename.match(/^(.+)__dettaglio_(\d+)(_dup\d+)?$/);
    if (!m) continue;
    const slug = m[1];
    const n    = parseInt(m[2]);
    if (n < 1 || n > 3) continue; // Teniamo solo 1-3
    if (m[3]) continue;           // Salta i _dup

    if (!slugDettagliMap[slug]) slugDettagliMap[slug] = {};
    // Salva solo se non c'è già (priorità al primo trovato)
    if (!slugDettagliMap[slug][n]) {
      slugDettagliMap[slug][n] = r.secure_url;
    }
  }

  console.log(`   ${Object.keys(slugDettagliMap).length} opere con dettagli su Cloudinary`);

  // 4. Aggiorna DB
  let updated = 0, skipped = 0, notFound = 0;

  const toProcess = products.filter(p => {
    if (SLUG_FILTER) return p._slug === SLUG_FILTER;
    return true;
  });

  for (const product of toProcess) {
    const dettagli = slugDettagliMap[product._slug];
    if (!dettagli) {
      if (SLUG_FILTER) console.log(`  ⚠️  Nessun dettaglio trovato per slug "${product._slug}"`);
      notFound++;
      continue;
    }

    // Controlla quali colonne vanno aggiornate
    const updates = {};
    if (dettagli[1] && !product.dettaglio_1) updates.dettaglio_1 = dettagli[1];
    if (dettagli[2] && !product.dettaglio_2) updates.dettaglio_2 = dettagli[2];
    if (dettagli[3] && !product.dettaglio_3) updates.dettaglio_3 = dettagli[3];

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      console.log(`  ⏭️  [${product.id}] ${product.titolo_opera} — già completo`);
      skipped++;
      continue;
    }

    console.log(`  ✅ [${product.id}] ${product.titolo_opera}`);
    keys.forEach(k => console.log(`      ${k} → ${updates[k].slice(0, 70)}...`));

    if (!DRY_RUN) {
      const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await dbQuery(
        `UPDATE products SET ${setClause} WHERE id = $1`,
        [product.id, ...keys.map(k => updates[k])]
      );
    }

    updated++;
    await sleep(DELAY_MS);
  }

  // Report
  console.log('\n' + '='.repeat(60));
  console.log('✅  COMPLETATO');
  console.log(`📊  Aggiornati:      ${updated}`);
  console.log(`⏭️   Già completi:    ${skipped}`);
  console.log(`⚠️   Senza dettagli: ${notFound}`);
  if (DRY_RUN) console.log('\n   (DRY RUN — nessuna modifica applicata)');

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
