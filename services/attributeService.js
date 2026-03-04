/**
 * Servizio per la compilazione degli attributi Amazon
 * Gestisce le sorgenti: AI | FIXED | AUTO | MANUAL | SKIP
 */
const { query } = require('../database/db');

/**
 * Estrae le dimensioni dal testo grezzo
 * Es: "90x135 cm" → { larghezza: 90, lunghezza: 135, orientamento: 'Verticale' }
 */
function extractDimensions(text) {
  if (!text) return null;

  // Pattern: NxM cm, N x M cm, N×M cm
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*cm/i);
  if (!match) return null;

  const a = parseFloat(match[1].replace(',', '.'));
  const b = parseFloat(match[2].replace(',', '.'));

  const larghezza = Math.min(a, b);  // bordo più corto
  const lunghezza = Math.max(a, b);  // bordo più lungo
  const orientamento = a > b ? 'Orizzontale' : a < b ? 'Verticale' : 'Quadrato';

  return { larghezza: String(larghezza), lunghezza: String(lunghezza), orientamento };
}

/**
 * Carica tutte le definizioni attributi dal DB (esclusi SKIP)
 * Ritorna l'array ordinato con i valori fissi già inclusi
 */
async function loadAttributeDefinitions(includeSKIP = false) {
  const whereClause = includeSKIP ? '' : "WHERE source != 'SKIP'";
  const result = await query(`
    SELECT 
      ad.*,
      afv.value AS fixed_value
    FROM attribute_definitions ad
    LEFT JOIN attribute_fixed_values afv ON afv.attribute_id = ad.id
    ${whereClause}
    ORDER BY ad.ordine
  `);
  return result.rows;
}

/**
 * Carica tutti i valori attributi per un prodotto
 * Ritorna un oggetto { attribute_id: { value, compiled_by } }
 */
async function loadProductAttributeValues(productId) {
  const result = await query(`
    SELECT pav.*, ad.nome_attributo, ad.source, ad.sezione, ad.priorita
    FROM product_attribute_values pav
    JOIN attribute_definitions ad ON ad.id = pav.attribute_id
    WHERE pav.product_id = $1
  `, [productId]);

  const map = {};
  for (const row of result.rows) {
    map[row.attribute_id] = {
      value: row.value,
      compiled_by: row.compiled_by,
      nome_attributo: row.nome_attributo,
      source: row.source,
      sezione: row.sezione,
      priorita: row.priorita
    };
  }
  return map;
}

/**
 * Compila i valori FIXED e AUTO per un prodotto
 * Salva nel DB e ritorna i valori compilati
 */
async function compileFixedAndAuto(productId, product) {
  const attrs = await loadAttributeDefinitions();
  const dims = extractDimensions(product.descrizione_raw || '');

  const compiled = [];

  for (const attr of attrs) {
    let value = null;
    let compiledBy = null;

    if (attr.source === 'FIXED') {
      value = attr.fixed_value || '';
      compiledBy = 'FIXED';
    } else if (attr.source === 'AUTO') {
      if (dims) {
        if (attr.nome_attributo.includes('più lungo')) {
          value = dims.lunghezza;
          compiledBy = 'AUTO';
        } else if (attr.nome_attributo.includes('più corto')) {
          value = dims.larghezza;
          compiledBy = 'AUTO';
        } else if (attr.nome_attributo === 'Orientamento') {
          value = dims.orientamento;
          compiledBy = 'AUTO';
        }
      }
    }

    if (value !== null) {
      await upsertAttributeValue(productId, attr.id, value, compiledBy);
      compiled.push({ nome: attr.nome_attributo, value, compiledBy });
    }
  }

  return compiled;
}

/**
 * Salva (insert or update) un valore attributo
 */
async function upsertAttributeValue(productId, attributeId, value, compiledBy) {
  await query(`
    INSERT INTO product_attribute_values (product_id, attribute_id, value, compiled_by, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (product_id, attribute_id)
    DO UPDATE SET value = EXCLUDED.value, compiled_by = EXCLUDED.compiled_by, updated_at = NOW()
  `, [productId, attributeId, value, compiledBy]);
}

/**
 * Salva tutti i valori AI in una volta
 * aiValues: { nomeAttributo: valore, ... }
 */
async function saveAiValues(productId, aiValues) {
  // Carica mappa nome → id
  const result = await query('SELECT id, nome_attributo FROM attribute_definitions');
  const nameToId = {};
  for (const row of result.rows) {
    nameToId[row.nome_attributo] = row.id;
  }

  for (const [nome, value] of Object.entries(aiValues)) {
    const attrId = nameToId[nome];
    if (attrId && value !== undefined && value !== null) {
      await upsertAttributeValue(productId, attrId, String(value), 'AI');
    }
  }
}

/**
 * Carica il listing completo di un prodotto:
 * attributi con valori, raggruppati per sezione
 */
async function getProductListing(productId) {
  const result = await query(`
    SELECT 
      ad.id,
      ad.nome_attributo,
      ad.sezione,
      ad.priorita,
      ad.source,
      ad.ordine,
      afv.value AS fixed_value,
      pav.value,
      pav.compiled_by
    FROM attribute_definitions ad
    LEFT JOIN attribute_fixed_values afv ON afv.attribute_id = ad.id
    LEFT JOIN product_attribute_values pav ON pav.attribute_id = ad.id AND pav.product_id = $1
    WHERE ad.source != 'SKIP'
    ORDER BY ad.ordine
  `, [productId]);

  // Raggruppa per sezione
  const sections = {};
  for (const row of result.rows) {
    if (!sections[row.sezione]) sections[row.sezione] = [];
    sections[row.sezione].push({
      id: row.id,
      nome: row.nome_attributo,
      priorita: row.priorita,
      source: row.source,
      value: row.value || '',
      compiled_by: row.compiled_by || row.source,
      is_compiled: !!row.value
    });
  }

  return sections;
}

/**
 * Aggiorna un singolo attributo manualmente
 */
async function updateAttributeManually(productId, attributeId, value) {
  await upsertAttributeValue(productId, attributeId, value, 'MANUAL');
}

/**
 * Recupera le keyword in cache per un prodotto
 */
async function getCachedKeywords(productId) {
  try {
    // Ottieni le seed usate per questo prodotto (vengono memorizzate nel seed)
    // Usa semplicemente tutte le cache recenti del prodotto
    const result = await query(
      `SELECT results_json FROM amazon_suggest_cache 
       WHERE seed LIKE $1 
       ORDER BY updated_at DESC LIMIT 50`,
      [`%${productId}%`]
    );
    if (result.rows.length === 0) return [];
    const all = [];
    for (const row of result.rows) {
      try {
        const arr = JSON.parse(row.results_json);
        if (Array.isArray(arr)) all.push(...arr);
      } catch {}
    }
    return [...new Set(all)].slice(0, 30);
  } catch {
    return [];
  }
}

module.exports = {
  loadAttributeDefinitions,
  loadProductAttributeValues,
  compileFixedAndAuto,
  upsertAttributeValue,
  saveAiValues,
  getProductListing,
  updateAttributeManually,
  getCachedKeywords,
  extractDimensions
};
