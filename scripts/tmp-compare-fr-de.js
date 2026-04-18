require('dotenv').config({ path: '/Users/matteo/Desktop/AMAZON_AI/.env' });
const { query } = require('/Users/matteo/Desktop/AMAZON_AI/database/db');

const METAS = [
  'Colore',
  'Tema',
  'Tipo di stanza',
  'Famiglia di colori',
  'Tema animali',
  'Usi consigliati per il prodotto',
  'Funzioni speciali',
  'Personaggio rappresentato',
  'Stile',
  'Stagioni',
  'Edizione'
];

(async () => {
  try {
    // Find a product that has BOTH FR and DE saved
    const p = await query(`
      SELECT DISTINCT p.id, p.titolo_opera, p.sku_padre
      FROM products p
      INNER JOIN product_attribute_values_fr fr ON fr.product_id = p.id
      INNER JOIN product_attribute_values_de de ON de.product_id = p.id
      LIMIT 3
    `);
    if (p.rows.length === 0) {
      console.log('Nessun prodotto con entrambi FR e DE salvati.');
      console.log('Conto FR:', (await query('SELECT COUNT(*) FROM product_attribute_values_fr')).rows[0].count);
      console.log('Conto DE:', (await query('SELECT COUNT(*) FROM product_attribute_values_de')).rows[0].count);
      process.exit(0);
    }
    for (const prod of p.rows) {
      console.log(`\n═══ Prodotto #${prod.id}: ${prod.titolo_opera} (SKU: ${prod.sku_padre}) ═══`);
      for (const nome of METAS) {
        const fr = await query('SELECT value FROM product_attribute_values_fr WHERE product_id=$1 AND nome_attributo=$2', [prod.id, nome]);
        const de = await query('SELECT value FROM product_attribute_values_de WHERE product_id=$1 AND nome_attributo=$2', [prod.id, nome]);
        const it = await query(`SELECT pav.value FROM product_attribute_values pav
          JOIN attribute_definitions ad ON ad.id=pav.attribute_id
          WHERE pav.product_id=$1 AND ad.nome_attributo=$2`, [prod.id, nome]);
        console.log(`  [${nome}]`);
        console.log(`    IT: "${(it.rows[0]?.value || '—').slice(0,60)}"`);
        console.log(`    FR: "${(fr.rows[0]?.value || '—').slice(0,60)}"`);
        console.log(`    DE: "${(de.rows[0]?.value || '—').slice(0,60)}"`);
      }
    }
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
