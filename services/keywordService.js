const db = require('../database/db');

// TTL cache: 24 ore in millisecondi
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Delay tra chiamate Amazon (ms) per evitare rate limiting
const RATE_LIMIT_DELAY = 400;

// Marketplace ID di Amazon.it
const AMAZON_IT_MID = 'A1F83G8C2ARO7P';

/**
 * Delay helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Genera seed keyword contestuali per una stampa su tela
 * basandosi sui dati del prodotto
 */
function buildSeeds(product) {
  const seeds = new Set();

  // Seed base fissi per stampe su tela
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

  // Dall'autore
  if (product.autore) {
    const autore = product.autore.split(' ').slice(-1)[0]; // cognome
    if (autore.length > 3) {
      seeds.add(`stampa su tela ${autore.toLowerCase()}`);
      seeds.add(`quadro ${autore.toLowerCase()}`);
    }
  }

  // Dai temi/soggetti nella descrizione
  const themeKeywords = [
    { match: /coppi[ae]|innamorat|romantic|amore/i, seeds: ['stampa su tela coppia', 'quadro romantico', 'quadro coppia soggiorno'] },
    { match: /music|sax|jazz|chitarr|pianofort/i, seeds: ['stampa su tela musica', 'quadro musicale', 'quadro jazz'] },
    { match: /astratt|abstract/i, seeds: ['stampa su tela astratta', 'quadro astratto moderno', 'quadri astratti colorati'] },
    { match: /fiore|floreale|botanico|pianta/i, seeds: ['stampa su tela fiori', 'quadro botanico', 'quadro floreale'] },
    { match: /paesagg|natura|mare|montagna|bosco/i, seeds: ['stampa su tela paesaggio', 'quadro paesaggio naturale'] },
    { match: /città|skyline|urban|architettura/i, seeds: ['stampa su tela città', 'quadro skyline', 'quadro urbano'] },
    { match: /animale|cane|gatto|cavallo|leone/i, seeds: ['stampa su tela animali', 'quadro animali'] },
    { match: /bambino|famiglia|maternità/i, seeds: ['quadro bambini', 'stampa su tela famiglia'] },
  ];

  const combinedText = titolo + ' ' + desc;
  for (const theme of themeKeywords) {
    if (theme.match.test(combinedText)) {
      theme.seeds.forEach(s => seeds.add(s));
    }
  }

  // Dagli ambienti menzionati
  const roomKeywords = [
    { match: /soggiorno|divano|salotto/i, seeds: ['quadro soggiorno grande', 'stampa su tela soggiorno', 'quadri moderni parete soggiorno'] },
    { match: /camera|letto|capezzale|dormitorio/i, seeds: ['quadro camera da letto', 'stampa su tela camera', 'quadro sopra il letto'] },
    { match: /cucina/i, seeds: ['quadro cucina moderna', 'stampa su tela cucina'] },
    { match: /ufficio|studio/i, seeds: ['quadro ufficio', 'stampa su tela ufficio'] },
  ];

  for (const room of roomKeywords) {
    if (room.match.test(combinedText)) {
      room.seeds.forEach(s => seeds.add(s));
    }
  }

  // Stile
  if (/modern|contemporaneo|minimal/i.test(combinedText)) {
    seeds.add('stampa su tela moderna contemporanea');
    seeds.add('quadro moderno minimal');
  }
  if (/colorat|vivace|allegr|solare/i.test(combinedText)) {
    seeds.add('stampa su tela colorata');
    seeds.add('quadro colorato vivace');
  }

  // Dalle dimensioni
  if (product.dimensioni) {
    const dimMatch = product.dimensioni.match(/(\d+)\s*[xX×]\s*(\d+)/);
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
 * Chiama l'endpoint autocomplete di Amazon.it
 * Ritorna array di suggerimenti, [] in caso di errore
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
      console.warn(`[Keywords] Amazon suggest HTTP ${response.status} per seed: "${seed}"`);
      return [];
    }

    const data = await response.json();

    // Struttura risposta: { suggestions: [{ value: "..." }, ...] }
    if (data && Array.isArray(data.suggestions)) {
      return data.suggestions
        .map(s => s.value || '')
        .filter(v => v.length > 2)
        .slice(0, 11);
    }

    return [];
  } catch (err) {
    console.warn(`[Keywords] Errore fetch per seed "${seed}": ${err.message}`);
    return [];
  }
}

/**
 * Controlla la cache per un seed
 * Ritorna i risultati se validi (non scaduti), null altrimenti
 */
function getCachedSeed(seed) {
  try {
    const row = db.prepare('SELECT results_json, updated_at FROM amazon_suggest_cache WHERE seed = ?').get(seed);
    if (!row) return null;

    const updatedAt = new Date(row.updated_at).getTime();
    const now = Date.now();

    if (now - updatedAt > CACHE_TTL_MS) {
      return null; // scaduta
    }

    return JSON.parse(row.results_json);
  } catch {
    return null;
  }
}

/**
 * Salva i risultati in cache
 */
function saveSeedCache(seed, results) {
  try {
    const existing = db.prepare('SELECT id FROM amazon_suggest_cache WHERE seed = ?').get(seed);
    if (existing) {
      db.prepare(`
        UPDATE amazon_suggest_cache SET results_json = @results_json, updated_at = CURRENT_TIMESTAMP WHERE seed = @seed
      `).run({ results_json: JSON.stringify(results), seed });
    } else {
      db.prepare(`
        INSERT INTO amazon_suggest_cache (seed, results_json) VALUES (@seed, @results_json)
      `).run({ seed, results_json: JSON.stringify(results) });
    }
  } catch (err) {
    console.warn(`[Keywords] Errore salvataggio cache per seed "${seed}": ${err.message}`);
  }
}

/**
 * Funzione principale: genera e restituisce tutte le keyword per un prodotto
 * Con caching, rate limiting, deduplicazione
 */
async function getKeywordsForProduct(productId) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Prodotto non trovato');

  const seeds = buildSeeds(product);
  const allKeywords = new Set();
  const keywordFrequency = {};

  console.log(`[Keywords] Mining ${seeds.length} seeds per prodotto "${product.titolo_opera}"`);

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];

    // Controlla cache
    let results = getCachedSeed(seed);

    if (results === null) {
      // Non in cache o scaduta → chiama Amazon
      if (i > 0) await sleep(RATE_LIMIT_DELAY); // rate limit
      results = await fetchAmazonSuggest(seed);
      saveSeedCache(seed, results);
      console.log(`[Keywords] Seed "${seed}" → ${results.length} suggerimenti (API)`);
    } else {
      console.log(`[Keywords] Seed "${seed}" → ${results.length} suggerimenti (cache)`);
    }

    // Conta frequenza per ordinamento
    for (const kw of results) {
      const normalized = kw.toLowerCase().trim();
      if (normalized.length > 3) {
        allKeywords.add(normalized);
        keywordFrequency[normalized] = (keywordFrequency[normalized] || 0) + 1;
      }
    }
  }

  // Ordina per frequenza (più comune prima) poi alfabetico
  const sorted = Array.from(allKeywords).sort((a, b) => {
    const freqDiff = (keywordFrequency[b] || 0) - (keywordFrequency[a] || 0);
    if (freqDiff !== 0) return freqDiff;
    return a.localeCompare(b, 'it');
  });

  return {
    keywords: sorted,
    seeds_used: seeds.length,
    total: sorted.length
  };
}

module.exports = {
  buildSeeds,
  fetchAmazonSuggest,
  getKeywordsForProduct
};
