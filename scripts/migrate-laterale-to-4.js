#!/usr/bin/env node
/**
 * migrate-laterale-to-4.js
 *
 * Migrazione una-tantum: sposta le immagini "laterale" da _2 a _4.
 *
 * Problema storico: il vecchio bulk-import salvava la laterale su _2 come fallback
 * quando non c'era un frontale. Ora _2 = solo frontale, _4 = solo laterale.
 *
 * Logica:
 *  - Per ogni prodotto, per ogni taglia (max/media/mini):
 *    - Se _2 contiene "_laterale" nell'URL E _4 è NULL → sposta _2 → _4, svuota _2
 *    - Se _2 contiene "_laterale" nell'URL E _4 ha già un valore → svuota solo _2 (duplicato)
 *    - Se _2 NON contiene "_laterale" → lascia stare (è un frontale legittimo)
 *    - Se _4 è già popolata → non toccare niente
 *
 * Uso:
 *   node scripts/migrate-laterale-to-4.js --dry-run   ← mostra cosa farebbe
 *   node scripts/migrate-laterale-to-4.js             ← esegue la migrazione
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function main() {
  console.log('\n🔄  MIGRAZIONE LATERALE: _2 → _4');
  if (DRY_RUN) console.log('    🔍 DRY RUN — nessuna scrittura al DB');
  console.log('='.repeat(60));

  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT id, titolo_opera,
             immagine_max_2,   immagine_max_4,
             immagine_media_2, immagine_media_4,
             immagine_mini_2,  immagine_mini_4
      FROM products
      ORDER BY id
    `);

    const products = res.rows;
    console.log(`   ${products.length} prodotti nel DB\n`);

    let moved = 0, cleared = 0, skipped = 0, alreadyOk = 0;

    for (const p of products) {
      const sizes = [
        { size: 'max',   col2: 'immagine_max_2',   col4: 'immagine_max_4',   v2: p.immagine_max_2,   v4: p.immagine_max_4 },
        { size: 'media', col2: 'immagine_media_2',  col4: 'immagine_media_4',  v2: p.immagine_media_2, v4: p.immagine_media_4 },
        { size: 'mini',  col2: 'immagine_mini_2',   col4: 'immagine_mini_4',   v2: p.immagine_mini_2,  v4: p.immagine_mini_4 },
      ];

      const updates = {};

      for (const { size, col2, col4, v2, v4 } of sizes) {
        if (!v2) continue; // _2 è vuoto → niente da fare

        const isLaterale = v2.includes('_laterale');

        if (!isLaterale) {
          // _2 contiene un frontale legittimo → non toccare
          if (v4) alreadyOk++;
          else skipped++;
          continue;
        }

        // _2 è una laterale
        if (!v4) {
          // _4 è vuoto → sposta
          console.log(`  [${p.id}] ${p.titolo_opera?.substring(0, 40)}`);
          console.log(`    ${size}: SPOSTA _2→_4: ${v2.substring(v2.lastIndexOf('/') + 1)}`);
          updates[col4] = v2;
          updates[col2] = null;
          moved++;
        } else {
          // _4 già ha un valore → svuota solo _2 (era un duplicato rimasto)
          console.log(`  [${p.id}] ${p.titolo_opera?.substring(0, 40)}`);
          console.log(`    ${size}: _4 già presente, svuoto _2 (era laterale duplicata)`);
          updates[col2] = null;
          cleared++;
        }
      }

      if (Object.keys(updates).length === 0) continue;

      if (!DRY_RUN) {
        const keys = Object.keys(updates);
        const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
        await client.query(
          `UPDATE products SET ${setClause} WHERE id = $1`,
          [p.id, ...keys.map(k => updates[k])]
        );
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅  MIGRAZIONE COMPLETATA');
    console.log('='.repeat(60));
    console.log(`📦  Spostati _2→_4 (laterale):  ${moved}`);
    console.log(`🗑️   Svuotati _2 duplicati:       ${cleared}`);
    console.log(`⏭️   Saltati (frontale legittimo): ${skipped}`);
    console.log(`✅  Già corretti (_4 popolata):   ${alreadyOk}`);

    if (DRY_RUN && (moved + cleared) > 0) {
      console.log('\n💡 Esegui senza --dry-run per applicare le modifiche.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('\n❌ Errore fatale:', err.message);
  process.exit(1);
});
