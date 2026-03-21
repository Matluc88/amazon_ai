/**
 * Servizio per la compilazione degli attributi Amazon
 * Gestisce le sorgenti: AI | FIXED | AUTO | MANUAL | SKIP
 */
const { query } = require('../database/db');
// Import lazy per evitare dipendenza circolare
let _verifyOrientationWithAI = null;
function getVerifyOrientation() {
  if (!_verifyOrientationWithAI) {
    _verifyOrientationWithAI = require('./anthropicService').verifyOrientationWithAI;
  }
  return _verifyOrientationWithAI;
}

/**
 * Lookup table dimensioni → peso (kg) per stampe su tela Sivigliart.
 * Le chiavi sono normalizzate come "minDim_maxDim" (es. "50_70").
 * Usata per compilare automaticamente "Peso dell'articolo".
 */
const WEIGHT_LOOKUP = {
  '50_70':  '1.5',
  '50_75':  '1.6',
  '50_80':  '1.7',
  '50_85':  '1.8',
  '70_100': '2.9',
  '70_105': '3.1',
  '70_110': '3.2',
  '70_120': '3.5',
  '90_130': '4.9',
  '90_135': '5.0',
  '90_145': '5.4',
  '90_150': '5.6',
  '100_70': '2.9',  // alias → normalizzato sotto
  '130_90': '4.9',  // alias → normalizzato sotto
};

/**
 * Calcola il peso in kg dato un testo con dimensioni (es. "70x100 cm", "130x90").
 * Normalizza sempre min×max per la lookup.
 * @returns {string|null} peso come stringa decimale con punto (es. "2.9"), o null se non trovato
 */
function lookupWeight(text) {
  if (!text) return null;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!match) return null;
  const a = Math.round(parseFloat(match[1].replace(',', '.')));
  const b = Math.round(parseFloat(match[2].replace(',', '.')));
  if (isNaN(a) || isNaN(b)) return null;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return WEIGHT_LOOKUP[`${min}_${max}`] || null;
}

/**
 * Estrae le dimensioni dal testo grezzo
 * Es: "90x135 cm", "130x90", "130 x 90 cm" → { larghezza, lunghezza, orientamento }
 */
function extractDimensions(text) {
  if (!text) return null;

  // Pattern: NxM cm, N x M cm, N×M cm, NxM (cm opzionale)
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?/i);
  if (!match) return null;

  const a = parseFloat(match[1].replace(',', '.'));
  const b = parseFloat(match[2].replace(',', '.'));
  if (isNaN(a) || isNaN(b) || a === 0 || b === 0) return null;

  const larghezza = Math.min(a, b);  // bordo più corto
  const lunghezza = Math.max(a, b);  // bordo più lungo
  // Le misure sono ora base × altezza: a=base, b=altezza
  // Orizzontale se base > altezza, Verticale se altezza > base
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
 *
 * AUTO gestiti:
 * - SKU                                    → product.sku_padre
 * - Prezzo al pubblico consigliato          → product.prezzo_max
 * - Lunghezza/Larghezza bordo articolo      → estratti da misura_max (o descrizione_raw)
 * - Orientamento                            → calcolato dalle dimensioni
 * - Lunghezza/Larghezza imballaggio         → stesse del prodotto grande
 */
async function compileFixedAndAuto(productId, product) {
  const attrs = await loadAttributeDefinitions();

  // Estrai dimensioni: priorità a misura_max (es. "130x90"), poi descrizione_raw
  const dimsSource = product.misura_max || product.descrizione_raw || '';
  const dims = extractDimensions(dimsSource);

  // ─── Verifica orientamento con AI Vision ────────────────────────────────
  // Se il prodotto ha un'immagine, usa Claude Haiku per verificare l'orientamento
  // reale dall'immagine — evita errori quando le dimensioni nel DB sono invertite.
  let orientamentoFinale = dims ? dims.orientamento : null;
  const imageUrlForOrientation = product.immagine_max || product.immagine_media || product.immagine_mini || null;
  if (imageUrlForOrientation && typeof imageUrlForOrientation === 'string' && imageUrlForOrientation.startsWith('http')) {
    try {
      const aiOri = await getVerifyOrientation()(imageUrlForOrientation);
      if (aiOri) {
        if (aiOri !== orientamentoFinale) {
          console.warn(`[AUTO] ⚠️ Orientamento corretto da AI per prodotto ${productId}: dimensioni→${orientamentoFinale}, immagine→${aiOri}`);
        } else {
          console.log(`[AUTO] ✓ Orientamento confermato da AI per prodotto ${productId}: ${aiOri}`);
        }
        orientamentoFinale = aiOri;
      }
    } catch (e) {
      console.warn(`[AUTO] verifica orientamento AI fallita per ${productId}:`, e.message);
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  const compiled = [];

  for (const attr of attrs) {
    let value = null;
    let compiledBy = null;
    const nome = attr.nome_attributo;

    if (attr.source === 'FIXED') {
      value = attr.fixed_value || '';
      compiledBy = 'FIXED';

    } else if (attr.source === 'AUTO') {
      // Dimensioni articolo
      if (dims) {
        if (nome.includes('più lungo')) {
          value = dims.lunghezza; compiledBy = 'AUTO';
        } else if (nome.includes('più corto')) {
          value = dims.larghezza; compiledBy = 'AUTO';
        } else if (nome === 'Orientamento') {
          value = orientamentoFinale; compiledBy = 'AUTO';
        } else if (nome === 'Lunghezza imballaggio') {
          value = dims.lunghezza; compiledBy = 'AUTO';
        } else if (nome === 'Larghezza imballaggio') {
          value = dims.larghezza; compiledBy = 'AUTO';
        } else if (nome.startsWith("Dimensioni dell'articolo")) {
          // Campo display combinato: "lunghezza x larghezza cm" (es. "135 x 90 cm")
          value = `${dims.lunghezza} x ${dims.larghezza} cm`; compiledBy = 'AUTO';
        }
      }

      // Peso dell'articolo (lookup tabella fissa dimensioni→kg)
      if (nome === "Peso dell'articolo") {
        const pesoSource = product.misura_max || product.descrizione_raw || '';
        const peso = lookupWeight(pesoSource);
        if (peso) { value = peso; compiledBy = 'AUTO'; }
      }

      // SKU padre del prodotto
      if (nome === 'SKU' && product.sku_padre) {
        value = product.sku_padre; compiledBy = 'AUTO';
      }

      // Prezzo al pubblico consigliato: non compilare — campo lasciato vuoto per policy Amazon
      // (scrivere 0 causa visualizzazione "€0" nel listing → impatto negativo SEO e conversione)
    }

    if (value !== null) {
      await upsertAttributeValue(productId, attr.id, value, compiledBy);
      compiled.push({ nome, value, compiledBy });
    }
  }

  return compiled;
}

// Nomi degli attributi per cui applichiamo la normalizzazione + trim a 250 byte UTF-8
const BYTE_TRIM_FIELDS = new Set([
  'Chiavi di ricerca', 'Chiavi ricerca',
  'Chiavi ricerca 1', 'Chiavi ricerca 2', 'Chiavi ricerca 3',
]);

/**
 * Taglia una stringa al massimo di maxBytes byte UTF-8,
 * senza spezzare caratteri multi-byte.
 * Buffer.from().toString('utf8') gestisce automaticamente le sequenze incomplete.
 */
function trimToBytes(str, maxBytes = 1250) {
  if (!str) return str;
  return Buffer.from(str, 'utf8').slice(0, maxBytes).toString('utf8').trimEnd();
}

/**
 * Normalizza una stringa per i campi Search Terms di Amazon:
 * - Rimuove punteggiatura, emoji, simboli (regex Unicode-safe con flag /u)
 * - Converte in minuscolo
 * - Dedup con Set (O(n))
 * - Taglia a 1250 byte UTF-8 (5 slot × 250 — lo split avviene nell'export XLSM)
 *
 * NOTE: Non aggiunge più core terms forzati (quadro, stampa, tela...) perché
 * sono già nel titolo/bullet e Amazon li indicizza da lì. I search terms
 * devono contenere SOLO parole complementari non presenti nel titolo/bullet.
 */
function normalizeSearchTerms(str) {
  if (!str) return str;

  // Unicode-safe: mantiene lettere (inclusi accenti), numeri e spazi
  const words = str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  // Dedup con Set (O(n))
  const seen = new Set();
  const unique = words.filter(w => (seen.has(w) ? false : (seen.add(w), true)));

  // Trim a 1250 byte (5 slot × 250) — lo split in export avviene in splitKeywordsTo5Slots()
  return trimToBytes(unique.join(' '), 1250);
}

/**
 * Salva (insert or update) un valore attributo.
 * Per i campi "Chiavi di ricerca" applica automaticamente
 * normalizeSearchTerms (normalizzazione + dedup + core terms + trim 250 byte UTF-8).
 */
async function upsertAttributeValue(productId, attributeId, value, compiledBy) {
  // Recupera il nome attributo per sapere se normalizzare
  if (value && value.length > 0) {
    const attrRes = await query('SELECT nome_attributo FROM attribute_definitions WHERE id = $1', [attributeId]);
    const nome = attrRes.rows[0]?.nome_attributo || '';
    if (BYTE_TRIM_FIELDS.has(nome)) {
      value = normalizeSearchTerms(value);
    }
  }

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
 * attributi con valori, raggruppati per sezione.
 *
 * @param {number} productId
 * @param {object|null} product  — riga prodotto dal DB (opzionale).
 *   Se fornito, i campi AUTO vengono calcolati come fallback di display
 *   anche se non sono ancora stati scritti in product_attribute_values
 *   (es. nuovi attributi aggiunti dopo la prima generazione).
 */
async function getProductListing(productId, product = null) {
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

  // Calcola dimensioni una sola volta (usato dal fallback AUTO)
  const dims = product
    ? extractDimensions(product.misura_max || product.descrizione_raw || '')
    : null;

  /**
   * Fallback per attributi AUTO non ancora scritti nel DB.
   * Replica la logica di compileFixedAndAuto senza scrivere nulla.
   */
    function autoFallback(nome) {
      if (!product) return '';
      if (nome === 'SKU') return product.sku_padre || '';
      // Prezzo al pubblico consigliato: non compilare — campo lasciato vuoto
      if (nome === "Peso dell'articolo") {
        const pesoSource = product.misura_max || product.descrizione_raw || '';
        return lookupWeight(pesoSource) || '';
      }
      if (dims) {
        if (nome.includes('più lungo'))              return dims.lunghezza;
        if (nome.includes('più corto'))              return dims.larghezza;
        if (nome === 'Orientamento')                 return dims.orientamento;
        if (nome === 'Lunghezza imballaggio')        return dims.lunghezza;
        if (nome === 'Larghezza imballaggio')        return dims.larghezza;
        if (nome.startsWith("Dimensioni dell'articolo")) return `${dims.lunghezza} x ${dims.larghezza} cm`;
      }
      return '';
    }

  // Campi AI facoltativi per cui mostrare "N/D" se il valore non è ancora stato generato
  const ND_FALLBACK_FIELDS = new Set(['Personaggio rappresentato', 'Tema animali']);

  // Raggruppa per sezione
  const sections = {};
  for (const row of result.rows) {
    if (!sections[row.sezione]) sections[row.sezione] = [];

    // Priorità: FIXED usa sempre il fixedValue (ignora vecchi valori AI nel DB)
    //           AI/MANUAL: valore salvato → fallback AUTO → fallback N/D → ''
    const displayValue = row.source === 'FIXED'
      ? (row.fixed_value || '')
      : (row.value
          || (row.source === 'AUTO' ? autoFallback(row.nome_attributo) : '')
          || (ND_FALLBACK_FIELDS.has(row.nome_attributo) ? 'N/D' : '')
          || '');

    sections[row.sezione].push({
      id: row.id,
      nome: row.nome_attributo,
      priorita: row.priorita,
      source: row.source,
      ordine: row.ordine,
      value: displayValue,
      compiled_by: row.compiled_by || row.source,
      is_compiled: !!displayValue
    });
  }

  return sections;
}

/**
 * Salva tutti i valori AI in francese (tabella product_attribute_values_fr).
 * aiValues: { nomeAttributo: valore, ... }
 */
async function saveAiValuesFR(productId, aiValues) {
  for (const [nome, value] of Object.entries(aiValues)) {
    if (value !== undefined && value !== null && value !== '') {
      await query(`
        INSERT INTO product_attribute_values_fr (product_id, nome_attributo, value, compiled_by, updated_at)
        VALUES ($1, $2, $3, 'AI', NOW())
        ON CONFLICT (product_id, nome_attributo)
        DO UPDATE SET value = EXCLUDED.value, compiled_by = 'AI', updated_at = NOW()
      `, [productId, nome, String(value)]);
    }
  }
}

/**
 * Carica il listing FR di un prodotto dalla tabella product_attribute_values_fr.
 * Ritorna un oggetto piatto { nome_attributo: value }.
 * Ritorna {} se non esiste ancora contenuto FR per il prodotto.
 */
async function getProductListingFR(productId) {
  const result = await query(`
    SELECT nome_attributo, value
    FROM product_attribute_values_fr
    WHERE product_id = $1
  `, [productId]);

  const attrs = {};
  for (const row of result.rows) {
    attrs[row.nome_attributo] = row.value;
  }
  return attrs;
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
  saveAiValuesFR,
  getProductListing,
  getProductListingFR,
  updateAttributeManually,
  getCachedKeywords,
  extractDimensions
};
