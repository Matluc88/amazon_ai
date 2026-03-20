/**
 * Cerebro Service — Helium 10 Cerebro multi-ASIN integration
 *
 * Gestisce:
 * 1. Parsing del CSV Cerebro (formato multi-ASIN con colonne in italiano)
 * 2. Import nel database con pre-filtro automatico
 * 3. Recupero keyword per il prompt AI (divise per tier: titolo / bullet / backend)
 */
const { query } = require('../database/db');

// ─── Filtri automatici al momento dell'import ─────────────────────────────────
const MIN_VOLUME = 300;      // volume di ricerca minimo
const MIN_WORDS  = 2;        // numero minimo di parole nella keyword

// ─── Mapping colonne CSV → campi DB ──────────────────────────────────────────
// Supporta sia il formato "nicchia" (file senza ASIN) che "multi-ASIN"
const COL_MAP = {
  keyword:             ['frase chiave'],
  search_volume:       ['volume di ricerca'],
  cerebro_iq:          ['punteggio qi cerebro', 'cerebro iq score'],
  volume_trend:        ['trend volume di ricerca'],
  competing_products:  ['prodotti concorrenti'],
  cpr:                 ['cpr'],
  title_density:       ['densità del titolo'],
};

// ─── CSV Parser minimale (gestisce quoted fields con virgole interne) ─────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Rimuove BOM UTF-8 e normalizza a minuscolo per il mapping colonne.
 */
function normalizeHeader(h) {
  return h.replace(/^\uFEFF/, '').toLowerCase().trim().replace(/"/g, '');
}

/**
 * Pulisce un valore numerico dal formato italiano:
 * ">100.000" → null (troppo generico)
 * "40.592" → 40592 (rimuove separatore migliaia)
 * "n/a", "-" → null
 */
function parseItalianNumber(val) {
  if (!val || val === '-' || val.toLowerCase() === 'n/a' || val === '') return null;
  // Rimuovi il prefisso ">" per valori come ">100.000"
  const clean = String(val).replace(/^>/, '').replace(/\./g, '').replace(/,/g, '.').trim();
  const n = parseInt(clean, 10);
  return isNaN(n) ? null : n;
}

/**
 * Rileva se una keyword è prevalentemente in inglese.
 * Semplice euristica: se il volume è 0 e non contiene caratteri italiani tipici,
 * oppure se contiene parole inglesi comuni per il settore.
 */
function isEnglishKeyword(keyword, volume) {
  if (volume && volume > 0) return false; // ha traffico → tienila
  const italianChars = /[àèìòùáéíóúâêîôûäëïöü]/i;
  if (italianChars.test(keyword)) return false; // ha caratteri italiani → tienila
  // Parole tipicamente inglesi nel settore wall art
  const englishWords = /\b(wall|art|canvas|print|painting|decor|home|gift|room|bedroom|living|modern|vintage|abstract|poster|frame)\b/i;
  return englishWords.test(keyword);
}

/**
 * Parsa il contenuto di un file CSV Cerebro multi-ASIN.
 * Applica i pre-filtri automatici (volume >= 300, parole >= 2, no keyword inglesi).
 *
 * @param {string|Buffer} csvContent - Contenuto del file CSV
 * @returns {{ keywords: Array, skipped: number, total: number }}
 */
function parseCerebroCSV(csvContent) {
  const text = Buffer.isBuffer(csvContent) ? csvContent.toString('utf8') : csvContent;
  // Normalizza line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length < 2) return { keywords: [], skipped: 0, total: 0 };

  // Parse header
  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map(normalizeHeader);

  // Trova indici colonne
  const colIdx = {};
  for (const [field, aliases] of Object.entries(COL_MAP)) {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) { colIdx[field] = idx; break; }
    }
  }

  if (colIdx.keyword === undefined) {
    throw new Error('Colonna "Frase chiave" non trovata. Assicurati di usare il formato CSV Cerebro Helium 10.');
  }

  const keywords = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = parseCSVLine(line);

    const keyword = cells[colIdx.keyword] || '';
    if (!keyword || keyword === '-') { skipped++; continue; }

    const volume   = colIdx.search_volume  !== undefined ? parseItalianNumber(cells[colIdx.search_volume])  : null;
    const iq       = colIdx.cerebro_iq     !== undefined ? parseItalianNumber(cells[colIdx.cerebro_iq])     : null;
    const trend    = colIdx.volume_trend   !== undefined ? parseItalianNumber(cells[colIdx.volume_trend])   : null;
    const compProd = colIdx.competing_products !== undefined ? (cells[colIdx.competing_products] || null) : null;
    const cpr      = colIdx.cpr            !== undefined ? parseItalianNumber(cells[colIdx.cpr])            : null;
    const density  = colIdx.title_density  !== undefined ? parseItalianNumber(cells[colIdx.title_density])  : null;

    // ── Pre-filtri automatici ────────────────────────────────────────────────
    // 1. Volume minimo
    if (volume !== null && volume < MIN_VOLUME) { skipped++; continue; }
    // 2. Numero minimo di parole
    const wordCount = keyword.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS) { skipped++; continue; }
    // 3. Keyword inglesi con volume 0
    if (isEnglishKeyword(keyword, volume)) { skipped++; continue; }

    keywords.push({ keyword: keyword.toLowerCase().trim(), search_volume: volume, cerebro_iq: iq, volume_trend: trend, competing_products: compProd, cpr, title_density: density });
  }

  return { keywords, skipped, total: lines.length - 1 };
}

/**
 * Importa le keyword parsate nel database, associandole a un cluster.
 * Usa UPSERT per evitare duplicati (stesso cluster + stessa keyword).
 *
 * @param {number} clusterId    - ID del cluster Cerebro
 * @param {Array}  keywords     - Array di keyword parsate da parseCerebroCSV
 * @param {string} sourceFile   - Nome del file sorgente
 * @returns {{ imported: number, updated: number }}
 */
async function importKeywordsToCluster(clusterId, keywords, sourceFile = null) {
  let imported = 0;
  let updated  = 0;

  for (const kw of keywords) {
    const res = await query(`
      INSERT INTO cerebro_keywords
        (cluster_id, keyword, search_volume, cerebro_iq, volume_trend,
         competing_products, cpr, title_density, status, imported_at, source_file)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), $9)
      ON CONFLICT (cluster_id, keyword)
      DO UPDATE SET
        search_volume     = EXCLUDED.search_volume,
        cerebro_iq        = EXCLUDED.cerebro_iq,
        volume_trend      = EXCLUDED.volume_trend,
        competing_products= EXCLUDED.competing_products,
        cpr               = EXCLUDED.cpr,
        title_density     = EXCLUDED.title_density,
        imported_at       = NOW(),
        source_file       = EXCLUDED.source_file
      RETURNING (xmax = 0) AS is_new
    `, [
      clusterId,
      kw.keyword,
      kw.search_volume,
      kw.cerebro_iq,
      kw.volume_trend,
      kw.competing_products,
      kw.cpr,
      kw.title_density,
      sourceFile,
    ]);

    if (res.rows[0]?.is_new) imported++;
    else updated++;
  }

  return { imported, updated };
}

/**
 * Recupera le keyword approvate di un cluster, divise per tier,
 * e le formatta come sezione pronta per l'injection nel prompt Claude.
 *
 * @param {number|null} clusterId - ID cluster Cerebro (null = no keyword Cerebro)
 * @returns {string} Sezione del prompt con le keyword Cerebro (stringa vuota se nessun cluster)
 */
async function getCerebroPromptSection(clusterId) {
  if (!clusterId) return '';

  // Recupera nome cluster + keyword approvate ordinate per volume desc
  const res = await query(`
    SELECT
      k.keyword, k.search_volume, k.cerebro_iq, k.title_density, k.tier,
      c.name AS cluster_name
    FROM cerebro_keywords k
    JOIN cerebro_clusters c ON c.id = k.cluster_id
    WHERE k.cluster_id = $1 AND k.status = 'approved'
    ORDER BY k.search_volume DESC NULLS LAST
    LIMIT 120
  `, [clusterId]);

  if (res.rows.length === 0) return '';

  const clusterName = res.rows[0].cluster_name;
  const titleKws   = res.rows.filter(r => r.tier === 'title');
  const bulletKws  = res.rows.filter(r => r.tier === 'bullet');
  const backendKws = res.rows.filter(r => r.tier === 'backend');

  const fmtKw = r => {
    const vol  = r.search_volume ? ` (vol: ${r.search_volume.toLocaleString('it-IT')})` : '';
    const iq   = r.cerebro_iq    ? `, IQ: ${r.cerebro_iq}` : '';
    const dens = r.title_density !== null && r.title_density !== undefined
      ? `, density: ${r.title_density}/5` : '';
    return `- "${r.keyword}"${vol}${iq}${dens}`;
  };

  const lines = [
    `KEYWORD REALI DA HELIUM 10 CEREBRO (cluster: "${clusterName}"):`,
    `Queste keyword provengono da un'analisi competitiva reale dei top seller Amazon.it nella nicchia di riferimento.`,
    ``,
  ];

  if (titleKws.length > 0) {
    lines.push(`🥇 KEYWORD PER IL TITOLO (priorità alta — volume alto, title density alta):`);
    titleKws.slice(0, 5).forEach(r => lines.push(fmtKw(r)));
    lines.push('');
  }

  if (bulletKws.length > 0) {
    lines.push(`🥈 KEYWORD PER I BULLET POINTS (priorità media):`);
    bulletKws.slice(0, 10).forEach(r => lines.push(fmtKw(r)));
    lines.push('');
  }

  if (backendKws.length > 0) {
    lines.push(`🧠 KEYWORD PER LE CHIAVI DI RICERCA BACKEND (priorità di completamento):`);
    backendKws.slice(0, 30).forEach(r => lines.push(fmtKw(r)));
    lines.push('');
  }

  lines.push(`⚠️ REGOLE D'USO DELLE KEYWORD CEREBRO:`);
  lines.push(`IMPORTANTE: Queste keyword provengono da Helium 10 Cerebro — sono le keyword REALI con cui i clienti cercano quadri e stampe su Amazon.it nella nicchia wall art. Sono keyword DI CATEGORIA (valgono per tutti i quadri), NON solo per soggetti specifici.`);
  lines.push(``);
  lines.push(`1. USO OBBLIGATORIO NEL BACKEND: Le keyword tier BACKEND devono essere TUTTE incluse nelle Chiavi di ricerca (search terms backend). Queste keyword sono già validate con volumi reali — inseriscile anche se sembrano generiche (es. "quadri moderni soggiorno", "stampa su tela", "quadri camera da letto"). Sono esattamente come i clienti cercano qualsiasi quadro su Amazon.`);
  lines.push(`2. TITOLO: Incorpora almeno 1-2 keyword Cerebro tier TITLE nel titolo in modo naturale (es. "Quadro Moderno per Soggiorno" integra "quadro moderno soggiorno"). La struttura template è flessibile — adattala per includere queste keyword ad altissimo volume.`);
  lines.push(`3. BULLET POINTS: Integra le keyword Cerebro tier BULLET nei punti elenco dove è naturale (es. "ideale come quadri soggiorno, quadri cucina o decorazione camera da letto").`);
  lines.push(`4. NO KEYWORD SPECIFICHE FUORI SOGGETTO: L'unica eccezione sono keyword che implicano un soggetto NON presente nell'opera (es. "albero della vita" per un ritratto, "quadro mare" per un'opera urbana). Queste sì, evitale.`);
  lines.push(`5. NATURALEZZA: Integra le keyword in modo leggibile. Il testo deve sembrare scritto per un cliente reale.`);
  lines.push(`6. BACKEND NON HA LIMITI DI DUPLICATI CON CEREBRO: La regola "zero duplicati" del backend NON si applica alle keyword Cerebro — queste DEVONO essere inserite anche se alcune parole simili compaiono nel titolo.`);

  return lines.join('\n');
}

/**
 * Recupera le keyword approvate di un cluster FR, divise per tier,
 * e le formatta come sezione pronta per l'injection nel prompt Claude (versione francese).
 *
 * @param {number|null} clusterId - ID cluster Cerebro FR (null = no keyword Cerebro)
 * @returns {string} Sezione del prompt con le keyword Cerebro (stringa vuota se nessun cluster)
 */
async function getCerebroPromptSectionFR(clusterId) {
  if (!clusterId) return '';

  const res = await query(`
    SELECT
      k.keyword, k.search_volume, k.cerebro_iq, k.title_density, k.tier,
      c.name AS cluster_name
    FROM cerebro_keywords k
    JOIN cerebro_clusters c ON c.id = k.cluster_id
    WHERE k.cluster_id = $1 AND k.status = 'approved'
    ORDER BY k.search_volume DESC NULLS LAST
    LIMIT 120
  `, [clusterId]);

  if (res.rows.length === 0) return '';

  const clusterName = res.rows[0].cluster_name;
  const titleKws   = res.rows.filter(r => r.tier === 'title');
  const bulletKws  = res.rows.filter(r => r.tier === 'bullet');
  const backendKws = res.rows.filter(r => r.tier === 'backend');

  const fmtKw = r => {
    const vol  = r.search_volume ? ` (vol: ${r.search_volume.toLocaleString('fr-FR')})` : '';
    const iq   = r.cerebro_iq    ? `, IQ: ${r.cerebro_iq}` : '';
    const dens = r.title_density !== null && r.title_density !== undefined
      ? `, density: ${r.title_density}/5` : '';
    return `- "${r.keyword}"${vol}${iq}${dens}`;
  };

  const lines = [
    `MOTS-CLÉS RÉELS DE HELIUM 10 CEREBRO — MARCHÉ FRANÇAIS amazon.fr (cluster: "${clusterName}"):`,
    `Ces mots-clés proviennent d'une analyse concurrentielle réelle des top vendeurs Amazon.fr dans la niche tableaux/impressions sur toile.`,
    ``,
  ];

  if (titleKws.length > 0) {
    lines.push(`🥇 MOTS-CLÉS POUR LE TITRE (priorité haute — volume élevé, title density haute):`);
    titleKws.slice(0, 5).forEach(r => lines.push(fmtKw(r)));
    lines.push('');
  }

  if (bulletKws.length > 0) {
    lines.push(`🥈 MOTS-CLÉS POUR LES PUCES (priorité moyenne):`);
    bulletKws.slice(0, 10).forEach(r => lines.push(fmtKw(r)));
    lines.push('');
  }

  if (backendKws.length > 0) {
    lines.push(`🧠 MOTS-CLÉS POUR LES TERMES DE RECHERCHE BACKEND (priorité de complétion):`);
    backendKws.slice(0, 30).forEach(r => lines.push(fmtKw(r)));
    lines.push('');
  }

  lines.push(`⚠️ RÈGLES D'UTILISATION DES MOTS-CLÉS CEREBRO (Amazon.fr):`);
  lines.push(`IMPORTANT: Ces mots-clés proviennent de Helium 10 Cerebro — ce sont les mots-clés RÉELS avec lesquels les clients cherchent des tableaux et impressions sur amazon.fr. Ce sont des mots-clés DE CATÉGORIE (valables pour tous les tableaux), PAS seulement pour des sujets spécifiques.`);
  lines.push(``);
  lines.push(`1. UTILISATION OBLIGATOIRE EN BACKEND: Les mots-clés tier BACKEND doivent TOUS être inclus dans les termes de recherche. Volumes validés — insère-les même s'ils semblent génériques (ex. "tableau decoration murale", "impression sur toile", "decoration chambre"). C'est exactement comment les clients cherchent n'importe quel tableau sur Amazon.fr.`);
  lines.push(`2. TITRE: Incorpore au moins 1-2 mots-clés Cerebro tier TITLE dans le titre de façon naturelle.`);
  lines.push(`3. PUCES: Intègre les mots-clés Cerebro tier BULLET dans les puces où c'est naturel.`);
  lines.push(`4. PAS DE MOTS-CLÉS HORS SUJET: La seule exception concerne les mots-clés qui impliquent un sujet NON présent dans l'œuvre.`);
  lines.push(`5. NATUREL: Intègre les mots-clés de façon lisible. Le texte doit sembler écrit pour un vrai client.`);
  lines.push(`6. BACKEND SANS DOUBLONS STRICTS: La règle "zéro doublons" du backend NE s'applique PAS aux mots-clés Cerebro — ils DOIVENT être insérés même si des mots similaires apparaissent dans le titre.`);

  return lines.join('\n');
}

/**
 * Recupera le keyword AI generate in cache per un prodotto (per arricchirle con Cerebro).
 * Usata internamente dalla route keywords.
 */
async function getCachedAIKeywords(productId) {
  try {
    const res = await query(
      `SELECT results_json FROM amazon_suggest_cache WHERE seed = $1`,
      [`ai_keywords_product_${productId}`]
    );
    if (!res.rows[0]) return [];
    return JSON.parse(res.rows[0].results_json);
  } catch { return []; }
}

module.exports = {
  parseCerebroCSV,
  importKeywordsToCluster,
  getCerebroPromptSection,
  getCerebroPromptSectionFR,
  getCachedAIKeywords,
};
