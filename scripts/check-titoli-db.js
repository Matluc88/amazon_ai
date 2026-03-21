#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function main() {
  const res = await pool.query(`
    SELECT
      p.id,
      p.titolo_opera,
      pav.value AS titolo_listing,
      pav.compiled_by,
      pav.updated_at,
      ad.source AS attr_source
    FROM products p
    JOIN product_attribute_values pav ON pav.product_id = p.id
    JOIN attribute_definitions ad ON ad.id = pav.attribute_id
    WHERE ad.nome_attributo = 'Nome dell''articolo'
    ORDER BY p.id
  `);

  console.log(`\nTitoli in DB (product_attribute_values) — totale: ${res.rows.length}\n`);
  res.rows.forEach(row => {
    const len = row.titolo_listing?.length || 0;
    const startOK = row.titolo_listing?.toLowerCase().startsWith('quadro') ? '✅' : '❌';
    const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 19) : '—';
    console.log(`id:${String(row.id).padEnd(3)} | ${String(row.compiled_by).padEnd(28)} | ${updatedAt} | ${startOK} ${len}c`);
    console.log(`         "${row.titolo_listing?.slice(0, 100)}${len > 100 ? '...' : ''}"`);
  });

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
