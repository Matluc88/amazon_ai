/**
 * Keyword Mining Service — powered by Claude AI
 *
 * L'API autocomplete di Amazon.it richiede cookie di sessione e fingerprinting
 * del browser; restituisce suggestions:[] per qualsiasi richiesta server-side.
 * Usiamo Claude per generare keyword SEO pertinenti — risultati migliori e
 * sempre disponibili.
 */
const { query } = require('../database/db');
const { generateKeywordsWithAI } = require('./anthropicService');

// TTL cache: 7 giorni (le keyword cambiano poco per lo stesso prodotto)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Chiave cache univoca per prodotto (non per seed)
const CACHE_KEY_PREFIX = 'ai_keywords_product_';

/**
 * Controlla la cache PostgreSQL per un prodotto
 */
async function getCachedKeywords(productId) {
  try {
    const seed = `${CACHE_KEY_PREFIX}${productId}`;
    const result = await query(
      'SELECT results_json, updated_at FROM amazon_suggest_cache WHERE seed = $1',
      [seed]
    );
    const row = result.rows[0];
    if (!row) return null;

    const updatedAt = new Date(row.updated_at).getTime();
    if (Date.now() - updatedAt > CACHE_TTL_MS) return null; // scaduta

    return JSON.parse(row.results_json);
  } catch {
    return null;
  }
}

/**
 * Salva i risultati nella cache PostgreSQL
 */
async function saveKeywordsCache(productId, keywords) {
  try {
    const seed = `${CACHE_KEY_PREFIX}${productId}`;
    await query(`
      INSERT INTO amazon_suggest_cache (seed, results_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (seed)
      DO UPDATE SET results_json = EXCLUDED.results_json, updated_at = NOW()
    `, [seed, JSON.stringify(keywords)]);
  } catch (err) {
    console.warn(`[Keywords] Errore salvataggio cache prodotto ${productId}: ${err.message}`);
  }
}

/**
 * Funzione principale: genera e restituisce le keyword per un prodotto.
 * Usa la cache se disponibile e non scaduta.
 */
async function getKeywordsForProduct(productId, product = null) {
  if (!product) {
    const result = await query('SELECT * FROM products WHERE id = $1', [productId]);
    product = result.rows[0];
    if (!product) throw new Error('Prodotto non trovato');
  }

  // Controlla cache
  const cached = await getCachedKeywords(productId);
  if (cached) {
    console.log(`[Keywords] Cache hit per prodotto ${productId} (${cached.length} keyword)`);
    return { keywords: cached, seeds_used: 0, total: cached.length, source: 'cache' };
  }

  // Genera con Claude
  console.log(`[Keywords] Generazione AI per: "${product.titolo_opera}"`);
  const keywords = await generateKeywordsWithAI(product);

  // Salva in cache
  await saveKeywordsCache(productId, keywords);

  console.log(`[Keywords] Generate ${keywords.length} keyword per prodotto ${productId}`);
  return { keywords, seeds_used: 1, total: keywords.length, source: 'ai' };
}

module.exports = { getKeywordsForProduct };
