/**
 * Keyword Mining Service — Amazon.it Autocomplete
 * Usa PostgreSQL per la cache (sostituisce SQLite)
 */
const { query } = require('../database/db');

// TTL cache: 24 ore
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Delay tra chiamate Amazon per evitare rate limiting
const RATE_LIMIT_DELAY = 400;
// Marketplace ID Amazon.it
const AMAZON_IT_MID = 'A1F83G8C2ARO7P';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Genera seed keyword contestuali per una stampa su tela
 */
function buildSeeds(product) {
  const seeds = new Set();

  const baseSeeds = [
    'stampa su tela',
    'stampa su tela moderna',
    'quadro su tela',
    'quadri moderni soggiorno',
    'stampa su tela decorazione',
    'quadro moderno arredamento'
  ];
  baseSeeds.forEach(s => seeds.add(s));

  const titolo = (product.titolo_opera || '').toLowerCase();
  const desc = (product.descrizione_raw || '').toLowerCase();
  const combinedText = titolo + ' ' + desc;

  // Dall'autore
  if (product.autore) {
    const cognome = product.autore.split(' ').slice(-1)[0];
    if (cognome.length > 3) {
      seeds.add(`stampa su tela ${cognome.toLowerCase()}`);
      seeds.add(`quadro ${cognome.toLowerCase()}`);
    }
  }

  // Temi/soggetti
  const themes = [
    { match: /coppi[ae]|innamorat|romantic|amore/i, seeds: ['stampa su tela coppia', 'quadro romantico', 'quadro coppia soggiorno'] },
    { match: /music|sax|jazz|chitarr|pianofort/i, seeds: ['stampa su tela musica', 'quadro musicale', 'quadro jazz'] },
    { match: /astratt|abstract/i, seeds: ['stampa su tela astratta', 'quadro astratto moderno', 'quadri astratti colorati'] },
    { match: /fiore|floreale|botanico|pianta/i, seeds: ['stampa su tela fiori', 'quadro botanico', 'quadro floreale'] },
    { match: /paesagg|natura|mare|montagna|bosco/i, seeds: ['stampa su tela paesaggio', 'quadro paesaggio naturale'] },
    { match: /città|skyline|urban|architettura/i, seeds: ['stampa su tela città', 'quadro skyline', 'quadro urbano'] },
    { match: /animale|cane|gatto|cavallo|leone/i, seeds: ['stampa su tela animali', 'quadro animali'] },
    { match: /bambino|famiglia|maternità/i, seeds: ['quadro bambini', 'stampa su tela famiglia'] },
  ];
  themes.forEach(t => { if (t.match.test(combinedText)) t.seeds.forEach(s => seeds.add(s)); });

  // Ambienti
  const rooms = [
    { match: /soggiorno|divano|salotto/i, seeds: ['quadro soggiorno grande', 'stampa su tela soggiorno', 'quadri moderni parete soggiorno'] },
    { match: /camera|letto|capezzale/i, seeds: ['quadro camera da letto', 'stampa su tela camera', 'quadro sopra il letto'] },
    { match: /cucina/i, seeds: ['quadro cucina moderna', 'stampa su tela cucina'] },
    { match: /ufficio|studio/i, seeds: ['quadro ufficio', 'stampa su tela ufficio'] },
  ];
  rooms.forEach(r => { if (r.match.test(combinedText)) r.seeds.forEach(s => seeds.add(s)); });

  // Stile
  if (/modern|contemporaneo|minimal/i.test(combinedText)) {
    seeds.add('stampa su tela moderna contemporanea');
    seeds.add('quadro moderno minimal');
  }
  if (/colorat|vivace|allegr|solare/i.test(combinedText)) {
    seeds.add('stampa su tela colorata');
    seeds.add('quadro colorato vivace');
  }

  // Dimensioni
  if (product.dimensioni) {
    const dimMatch = (product.dimensioni || product.descrizione_raw || '').match(/(\d+)\s*[xX×]\s*(\d+)/);
    if (dimMatch) {
      const [, w, h] = dimMatch;
      seeds.add(`stampa su tela ${w}x${h}`);
      const area = parseInt(w) * parseInt(h);
      if (area > 5000) seeds.add('stampa su tela grande');
      else if (area < 2000) seeds.add('stampa su tela piccola');
    }
  }

  return Array.from(seeds);
}

/**
 * Chiama l'autocomplete di Amazon.it
 */
async function fetchAmazonSuggest(seed) {
  try {
    const encoded = encodeURIComponent(seed);
    const url = `https://completion.amazon.it/api/2017/suggestions?mid=${AMAZON_IT_MID}&alias=aps&prefix=${encoded}&limit=11&fresh=1&b2b=0&ds=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        'Referer': 'https://www.amazon.it/',
        'Origin': 'https://www.amazon.it'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      console.warn(`[Keywords] Amazon HTTP ${response.status} per: "${seed}"`);
      return [];
    }

    const data = await response.json();
    if (data && Array.isArray(data.suggestions)) {
      return data.suggestions.map(s => s.value || '').filter(v => v.length > 2).slice(0, 11);
    }
    return [];
  } catch (err) {
    console.warn(`[Keywords] Errore fetch "${seed}": ${err.message}`);
    return [];
  }
}

/**
 * Controlla la cache PostgreSQL per un seed
 */
async function getCachedSeed(seed) {
  try {
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
async function saveSeedCache(seed, results) {
  try {
    await query(`
      INSERT INTO amazon_suggest_cache (seed, results_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (seed)
      DO UPDATE SET results_json = EXCLUDED.results_json, updated_at = NOW()
    `, [seed, JSON.stringify(results)]);
  } catch (err) {
    console.warn(`[Keywords] Errore salvataggio cache "${seed}": ${err.message}`);
  }
}

/**
 * Funzione principale: genera e restituisce le keyword per un prodotto
 */
async function getKeywordsForProduct(productId, product = null) {
  if (!product) {
    const result = await query('SELECT * FROM products WHERE id = $1', [productId]);
    product = result.rows[0];
    if (!product) throw new Error('Prodotto non trovato');
  }

  const seeds = buildSeeds(product);
  const allKeywords = new Set();
  const keywordFrequency = {};

  console.log(`[Keywords] Mining ${seeds.length} seeds per: "${product.titolo_opera}"`);

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    let results = await getCachedSeed(seed);

    if (results === null) {
      if (i > 0) await sleep(RATE_LIMIT_DELAY);
      results = await fetchAmazonSuggest(seed);
      await saveSeedCache(seed, results);
      console.log(`[Keywords] "${seed}" → ${results.length} risultati (API)`);
    } else {
      console.log(`[Keywords] "${seed}" → ${results.length} risultati (cache)`);
    }

    for (const kw of results) {
      const normalized = kw.toLowerCase().trim();
      if (normalized.length > 3) {
        allKeywords.add(normalized);
        keywordFrequency[normalized] = (keywordFrequency[normalized] || 0) + 1;
      }
    }
  }

  const sorted = Array.from(allKeywords).sort((a, b) => {
    const diff = (keywordFrequency[b] || 0) - (keywordFrequency[a] || 0);
    return diff !== 0 ? diff : a.localeCompare(b, 'it');
  });

  return {
    keywords: sorted,
    seeds_used: seeds.length,
    total: sorted.length
  };
}

module.exports = { buildSeeds, fetchAmazonSuggest, getKeywordsForProduct };
