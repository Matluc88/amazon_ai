#!/usr/bin/env node
/**
 * scripts/rigenera-con-cerebro.js
 *
 * Script completo che:
 * 1. Auto-approva le keyword Cerebro del cluster con assegnazione automatica del tier
 * 2. Associa il cluster Cerebro a tutti i prodotti del DB
 * 3. Rigenera TUTTI i listing dei prodotti con le keyword Cerebro nel prompt Claude
 *
 * Uso:
 *   node scripts/rigenera-con-cerebro.js                   ← tutti i prodotti, cluster id=1
 *   node scripts/rigenera-con-cerebro.js --cluster 2       ← usa cluster id=2
 *   node scripts/rigenera-con-cerebro.js --id 42           ← solo prodotto id=42
 *   node scripts/rigenera-con-cerebro.js --limit 5         ← solo i primi 5 prodotti
 *   node scripts/rigenera-con-cerebro.js --skip-approve    ← salta step approvazione keyword
 *   node scripts/rigenera-con-cerebro.js --dry-run         ← nessun salvataggio nel DB
 *
 * Tier auto-assegnazione:
 *   🥇 title   → volume >= 3.000 E title_density >= 3
 *   🥈 bullet  → volume >= 1.000
 *   🧠 backend → tutto il resto
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { generateAllAiAttributes } = require('../services/anthropicService');
const { getCerebroPromptSection }  = require('../services/cerebroService');
const { getProductListing }        = require('../services/attributeService');

// ─── CLI ARGS ────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const SKIP_APPROVE = args.includes('--skip-approve');

const CLUSTER_ID = (() => {
  const i = args.indexOf('--cluster');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : 1;
})();
const ID_FILTER = (() => {
  const i = args.indexOf('--id');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const FROM_ID = (() => {
  const i = args.indexOf('--from-id');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();

// ─── DATABASE ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  connectionTimeoutMillis: 20000,
});

async function dbQuery(sql, params) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── STEP 1: Auto-approva keyword con tier ───────────────────────────────────
async function approveKeywords(clusterId) {
  console.log(`\n🔬 STEP 1 — Auto-approvazione keyword (cluster id: ${clusterId})`);
  console.log('─'.repeat(55));

  // Conta keyword pending
  const pending = await dbQuery(
    `SELECT COUNT(*) FROM cerebro_keywords WHERE cluster_id = $1 AND status = 'pending'`,
    [clusterId]
  );
  const pendingCount = parseInt(pending.rows[0].count);

  if (pendingCount === 0) {
    console.log('   ✅ Nessuna keyword pending — già tutte approvate/rifiutate.');
    return;
  }

  console.log(`   📊 Keyword pending da approvare: ${pendingCount}`);

  // Tier auto-assegnazione:
  //   title   → volume >= 3000 AND title_density >= 3
  //   bullet  → volume >= 1000
  //   backend → tutto il resto (volume < 1000 o density bassa)
  if (!DRY_RUN) {
    // Tier TITLE
    const titleRes = await dbQuery(`
      UPDATE cerebro_keywords
      SET status = 'approved', tier = 'title'
      WHERE cluster_id = $1 AND status = 'pending'
        AND search_volume >= 3000 AND title_density >= 3
      RETURNING keyword, search_volume, title_density
    `, [clusterId]);

    // Tier BULLET
    const bulletRes = await dbQuery(`
      UPDATE cerebro_keywords
      SET status = 'approved', tier = 'bullet'
      WHERE cluster_id = $1 AND status = 'pending'
        AND search_volume >= 1000
      RETURNING keyword, search_volume
    `, [clusterId]);

    // Tier BACKEND (tutto il resto ancora pending)
    const backendRes = await dbQuery(`
      UPDATE cerebro_keywords
      SET status = 'approved', tier = 'backend'
      WHERE cluster_id = $1 AND status = 'pending'
      RETURNING keyword, search_volume
    `, [clusterId]);

    console.log(`   🥇 Tier TITOLO:   ${titleRes.rowCount} keyword`);
    if (titleRes.rowCount > 0) {
      titleRes.rows.slice(0, 5).forEach(r =>
        console.log(`       - "${r.keyword}" (vol:${r.search_volume?.toLocaleString('it-IT')}, density:${r.title_density})`));
      if (titleRes.rowCount > 5) console.log(`       ... +${titleRes.rowCount - 5} altre`);
    }

    console.log(`   🥈 Tier BULLET:   ${bulletRes.rowCount} keyword`);
    if (bulletRes.rowCount > 0) {
      bulletRes.rows.slice(0, 5).forEach(r =>
        console.log(`       - "${r.keyword}" (vol:${r.search_volume?.toLocaleString('it-IT')})`));
      if (bulletRes.rowCount > 5) console.log(`       ... +${bulletRes.rowCount - 5} altre`);
    }

    console.log(`   🧠 Tier BACKEND:  ${backendRes.rowCount} keyword`);
  } else {
    // DRY RUN: solo mostra cosa farebbe
    const preview = await dbQuery(`
      SELECT keyword, search_volume, title_density,
        CASE
          WHEN search_volume >= 3000 AND title_density >= 3 THEN 'title'
          WHEN search_volume >= 1000 THEN 'bullet'
          ELSE 'backend'
        END AS auto_tier
      FROM cerebro_keywords
      WHERE cluster_id = $1 AND status = 'pending'
      ORDER BY search_volume DESC NULLS LAST
      LIMIT 10
    `, [clusterId]);
    console.log('   [DRY] Esempio assegnazione tier:');
    preview.rows.forEach(r =>
      console.log(`       ${r.auto_tier === 'title' ? '🥇' : r.auto_tier === 'bullet' ? '🥈' : '🧠'} "${r.keyword}" → ${r.auto_tier}`));
  }

  console.log('   ✅ Keyword approvate!');
}

// ─── STEP 2: Associa cluster a tutti i prodotti ───────────────────────────────
async function associateClusterToAllProducts(clusterId) {
  console.log(`\n🔗 STEP 2 — Associazione cluster ${clusterId} a tutti i prodotti`);
  console.log('─'.repeat(55));

  const countRes = await dbQuery(`SELECT COUNT(*) FROM products`, []);
  const total = parseInt(countRes.rows[0].count);

  if (!DRY_RUN) {
    await dbQuery(
      `UPDATE products SET cerebro_cluster_id = $1 WHERE cerebro_cluster_id IS NULL OR cerebro_cluster_id != $1`,
      [clusterId]
    );
    console.log(`   ✅ ${total} prodotti associati al cluster id:${clusterId}`);
  } else {
    console.log(`   [DRY] Associerebbe ${total} prodotti al cluster id:${clusterId}`);
  }
}

// ─── STEP 3: Rigenera tutti i listing ─────────────────────────────────────────
async function rigeneraListings(clusterId) {
  console.log(`\n🤖 STEP 3 — Rigenerazione listing con keyword Cerebro`);
  console.log('─'.repeat(55));

  // Costruisci query prodotti
  let sql = `SELECT p.* FROM products p`;
  const params = [];
  if (ID_FILTER) {
    sql += ` WHERE p.id = $1`;
    params.push(ID_FILTER);
  } else if (FROM_ID) {
    sql += ` WHERE p.id >= $1`;
    params.push(FROM_ID);
  }
  sql += ` ORDER BY p.id ASC`;

  let products = (await dbQuery(sql, params)).rows;

  if (products.length === 0) {
    console.log('   ⚠️  Nessun prodotto trovato.');
    return { ok: 0, errors: 0, total: 0 };
  }

  if (LIMIT) products = products.slice(0, LIMIT);

  console.log(`   📦 Prodotti da rigenerare: ${products.length}\n`);

  // Pre-carica la sezione Cerebro (uguale per tutti i prodotti dello stesso cluster)
  const cerebroSection = await getCerebroPromptSection(clusterId);
  if (!cerebroSection) {
    console.log('   ⚠️  Nessuna keyword Cerebro approvata trovata per il cluster.');
    console.log('   Assicurati che le keyword siano approvate (STEP 1).');
  } else {
    const lineCount = cerebroSection.split('\n').length;
    console.log(`   🔬 Sezione Cerebro pronta (${lineCount} righe di context per Claude)\n`);
  }

  const stats = { total: products.length, ok: 0, errors: 0 };
  const BATCH_SIZE = 3;
  const BATCH_PAUSE_MS = 5000;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const numLabel = `[${String(i + 1).padStart(3)}/${products.length}]`;

    // Pausa tra batch
    if (i > 0 && i % BATCH_SIZE === 0) {
      console.log(`   ⏸️  Pausa ${BATCH_PAUSE_MS / 1000}s tra batch...\n`);
      await sleep(BATCH_PAUSE_MS);
    }

    console.log(`\n${numLabel} id:${product.id} — ${product.titolo_opera || '(senza titolo)'}`);

    try {
      if (DRY_RUN) {
        console.log(`   [DRY] Verrebbe rigenerato con cluster Cerebro id:${clusterId}`);
        stats.ok++;
        continue;
      }

      // Carica keyword mining esistenti
      let keywords = [];
      try {
        const kwRes = await dbQuery(
          `SELECT results_json FROM amazon_suggest_cache WHERE seed = $1`,
          [`ai_keywords_product_${product.id}`]
        );
        if (kwRes.rows[0]) keywords = JSON.parse(kwRes.rows[0].results_json);
      } catch (_) { /* opzionale */ }

      // Rigenera tutti gli attributi AI
      // generateAllAiAttributes ritorna { "Nome dell'articolo": "...", "Punto elenco 1": "...", ... }
      const aiValues = await generateAllAiAttributes(product, keywords, cerebroSection);

      // ─── Solo i campi SEO-critical (quelli che beneficiano delle keyword Cerebro) ───
      const SEO_FIELDS = new Set([
        "Nome dell'articolo",
        "Descrizione del prodotto",
        "Punto elenco 1",
        "Punto elenco 2",
        "Punto elenco 3",
        "Punto elenco 4",
        "Punto elenco 5",
        "Chiavi di ricerca",
      ]);

      // Carica la mappa nome → attribute_id (una sola volta per prodotto)
      const attrDefsRes = await dbQuery(
        `SELECT id, nome_attributo FROM attribute_definitions WHERE source = 'AI'`, []
      );
      const nameToId = {};
      for (const row of attrDefsRes.rows) nameToId[row.nome_attributo] = row.id;

      // Salva nel DB — solo attributi SEO
      let saved = 0;
      for (const [nome, valore] of Object.entries(aiValues)) {
        if (!SEO_FIELDS.has(nome)) continue;            // salta metadata non SEO
        const attrId = nameToId[nome];
        if (!attrId) continue;                          // attributo non trovato in DB
        if (valore === undefined || valore === null) continue;
        await dbQuery(`
          INSERT INTO product_attribute_values (product_id, attribute_id, value, compiled_by, updated_at)
          VALUES ($1, $2, $3, 'script:cerebro', NOW())
          ON CONFLICT (product_id, attribute_id)
          DO UPDATE SET value = $3, compiled_by = 'script:cerebro', updated_at = NOW()
        `, [product.id, attrId, String(valore)]);
        saved++;
      }

      console.log(`   ✅ Listing rigenerato (${saved} attributi salvati)`);
      stats.ok++;

    } catch (err) {
      console.error(`   ❌ ERRORE: ${err.message}`);
      stats.errors++;
      await sleep(3000); // pausa aggiuntiva in caso di errore
    }
  }

  return stats;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔬 RIGENERA CON CEREBRO — Pipeline completa');
  if (DRY_RUN)      console.log('    🔍 DRY RUN — nessun salvataggio nel DB');
  if (SKIP_APPROVE) console.log('    ⏭️  Skip approvazione keyword');
  if (ID_FILTER)    console.log(`    🔎 Filtro prodotto id: ${ID_FILTER}`);
  if (LIMIT)        console.log(`    📦 Limite: ${LIMIT} prodotti`);
  console.log(`    📦 Cluster Cerebro id: ${CLUSTER_ID}`);
  console.log('='.repeat(55));

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL non trovato in .env');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY non trovato in .env');
    process.exit(1);
  }

  // Verifica cluster esiste
  const clusterCheck = await dbQuery(
    `SELECT id, name FROM cerebro_clusters WHERE id = $1`, [CLUSTER_ID]
  );
  if (clusterCheck.rows.length === 0) {
    console.error(`❌ Cluster id:${CLUSTER_ID} non trovato nel database.`);
    console.error('   Esegui prima: node scripts/import-cerebro.js');
    process.exit(1);
  }
  console.log(`\n✅ Cluster trovato: "${clusterCheck.rows[0].name}"`);

  // STEP 1: Approva keyword
  if (!SKIP_APPROVE) {
    await approveKeywords(CLUSTER_ID);
  } else {
    console.log('\n⏭️  STEP 1 saltato (--skip-approve)');
  }

  // STEP 2: Associa cluster a tutti i prodotti
  await associateClusterToAllProducts(CLUSTER_ID);

  // STEP 3: Rigenera listing
  const stats = await rigeneraListings(CLUSTER_ID);

  // ─── Report finale ──────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(55));
  console.log('✅  PIPELINE COMPLETATA');
  console.log('='.repeat(55));
  console.log(`📊  Prodotti processati: ${stats.total}`);
  console.log(`✅  Rigenerati OK:       ${stats.ok}`);
  console.log(`❌  Errori:             ${stats.errors}`);

  if (!DRY_RUN && stats.ok > 0) {
    console.log(`\n🎉 ${stats.ok} listing rigenerati con keyword Cerebro!`);
    console.log('   Vai su /cerebro per curare i tier, o direttamente su /listing per verificare.\n');
  }

  await pool.end();
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
