require('dotenv').config({ path: '/Users/matteo/Desktop/AMAZON_AI/.env' });
const { query } = require('/Users/matteo/Desktop/AMAZON_AI/database/db');

(async () => {
  try {
    const r = await query(`
      SELECT p.id, p.titolo_opera, p.sku_padre,
             p.asin_max, p.asin_media, p.asin_mini,
             (SELECT COUNT(*) FROM product_attribute_values_fr fr WHERE fr.product_id=p.id) AS n_fr
      FROM products p
      WHERE (p.asin_max IS NOT NULL AND p.asin_max <> '')
         OR (p.asin_media IS NOT NULL AND p.asin_media <> '')
         OR (p.asin_mini IS NOT NULL AND p.asin_mini <> '')
      ORDER BY n_fr DESC, p.id ASC
      LIMIT 5
    `);
    for (const row of r.rows) {
      console.log(`#${row.id} ${row.titolo_opera} (SKU: ${row.sku_padre}) — FR rows: ${row.n_fr}`);
      if (row.asin_max)   console.log(`   ASIN max:   ${row.asin_max}`);
      if (row.asin_media) console.log(`   ASIN media: ${row.asin_media}`);
      if (row.asin_mini)  console.log(`   ASIN mini:  ${row.asin_mini}`);
    }
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
})();
