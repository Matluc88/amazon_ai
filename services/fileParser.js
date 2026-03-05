/**
 * Parser file prodotti — supporta:
 * - Catalogo Sivigliart (.xlsx/.csv): 3 righe per prodotto con varianti
 * - Testo libero (.txt, .pages): 1 prodotto per file
 * - Tabellare generico (.xlsx, .csv)
 */
const xlsx = require('xlsx');
const { parse } = require('csv-parse/sync');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// =============================================
// CATALOGO SIVIGLIART — Parser varianti
// =============================================

/**
 * Genera lo SKU padre dallo SKU max rimuovendo il suffisso -max / _max
 */
function generateSkuPadre(skuMax) {
  if (!skuMax) return '';
  return skuMax.replace(/[-_](max|grande|xl|l)$/i, '').trim();
}

/**
 * Rileva se le righe grezze (array di array) sono nel formato catalogo Sivigliart.
 * Cerca una riga header con "titolo" e "misura" tra le prime 5 righe.
 * @param {any[][]} rawRows
 * @returns {{ headerIdx: number, titoloIdx: number, misuraIdx: number, prezzoIdx: number, skuVariantiIdx: number } | null}
 */
function detectSivigliartFormat(rawRows) {
  for (let i = 0; i < Math.min(rawRows.length, 6); i++) {
    const row = (rawRows[i] || []).map(c => String(c || '').toLowerCase().trim());
    const titoloIdx = row.indexOf('titolo');
    const misuraIdx = row.findIndex(h => h.includes('misura'));
    const prezzoIdx = row.findIndex(h => h.includes('prezzo'));
    const skuVariantiIdx = row.findIndex(h => h.includes('sku') && h.includes('variant'));

    if (titoloIdx >= 0 && misuraIdx >= 0) {
      return { headerIdx: i, titoloIdx, misuraIdx, prezzoIdx, skuVariantiIdx };
    }
  }
  return null;
}

/**
 * Parsa il catalogo Sivigliart (formato 3 righe per prodotto con varianti).
 * @param {any[][]} rawRows - righe grezze (array di array)
 * @param {{ headerIdx, titoloIdx, misuraIdx, prezzoIdx, skuVariantiIdx }} meta
 * @returns {object[]} array di prodotti con campi varianti
 */
function parseSivigliartRows(rawRows, meta) {
  const { headerIdx, titoloIdx, misuraIdx, prezzoIdx, skuVariantiIdx } = meta;
  const products = [];
  let current = null;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const titolo = String(row[titoloIdx] || '').trim();
    const misura = String(row[misuraIdx] || '').trim();
    const prezzo = prezzoIdx >= 0 ? String(row[prezzoIdx] || '').trim() : '';
    const skuVariante = skuVariantiIdx >= 0
      ? String(row[skuVariantiIdx] || '').trim().toLowerCase().replace(/\s+/g, '-')
      : '';

    if (!misura) continue; // Riga vuota

    if (titolo) {
      // Nuovo prodotto — taglia grande (max)
      current = {
        titolo_opera: titolo,
        autore: '',
        dimensioni: misura,           // dimensioni = misura grande (per compatibilità listing AI)
        tecnica: 'Stampa su tela',
        descrizione_raw: null,        // verrà aggiunta dall'utente separatamente
        prezzo: parseFloat(prezzo.replace(',', '.')) || null,
        quantita: 1,
        // Varianti
        sku_padre: generateSkuPadre(skuVariante),
        misura_max: misura,
        prezzo_max: parseFloat(prezzo.replace(',', '.')) || null,
        sku_max: skuVariante,
        misura_media: null, prezzo_media: null, sku_media: null,
        misura_mini: null, prezzo_mini: null, sku_mini: null,
      };
      products.push(current);
    } else if (current) {
      // Riga variante della stessa opera
      if (!current.misura_media) {
        current.misura_media = misura;
        current.prezzo_media = parseFloat(prezzo.replace(',', '.')) || null;
        current.sku_media = skuVariante;
      } else if (!current.misura_mini) {
        current.misura_mini = misura;
        current.prezzo_mini = parseFloat(prezzo.replace(',', '.')) || null;
        current.sku_mini = skuVariante;
      }
    }
  }

  return products;
}

/**
 * Parsa un file XLSX come catalogo Sivigliart o tabellare generico.
 * Ritorna { isCatalog: boolean, products: [] }
 */
function parseXlsxOrCsv(filePath, ext) {
  let rawRows;

  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Rileva separatore
    const firstLine = content.split('\n')[0] || '';
    let separator = ',';
    if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) separator = ';';

    rawRows = parse(content, {
      delimiter: separator,
      skip_empty_lines: false,
      trim: true,
      bom: true,
      relax_column_count: true,
    });
  } else {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  }

  // Prova a rilevare il formato Sivigliart
  const meta = detectSivigliartFormat(rawRows);
  if (meta) {
    const products = parseSivigliartRows(rawRows, meta);
    if (products.length > 0) return { isCatalog: true, products };
  }

  // Fallback: formato tabellare generico (prima riga = headers)
  // Trova la prima riga che sembra un header con valori
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 3); i++) {
    const row = rawRows[i] || [];
    const nonEmpty = row.filter(c => String(c || '').trim()).length;
    if (nonEmpty >= 2) { headerIdx = i; break; }
  }

  const headers = (rawRows[headerIdx] || []).map(c => String(c || '').trim());
  const dataRows = rawRows.slice(headerIdx + 1).map(row => {
    const record = {};
    headers.forEach((h, idx) => { record[h] = String(row[idx] || '').trim(); });
    return normalizeRecord(record);
  }).filter(r => r.titolo_opera);

  return { isCatalog: false, products: dataRows };
}

// =============================================
// TESTO LIBERO
// =============================================

/**
 * Parsa testo libero come un singolo prodotto.
 */
function parseFreeText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) throw new Error('Il file è vuoto');

  // Prima riga breve (<120 car.) = titolo
  let titleIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length < 120) { titleIdx = i; break; }
  }

  const titolo_opera = lines[titleIdx];
  const restText = lines.slice(titleIdx + 1).join('\n');

  // Estrai autore
  let autore = '';
  const autoreMatch = restText.match(
    /(?:artista[:\s]+|dell[''\u2019]artista[:\s]+|di\s+|autore[:\s]+|pittore[:\s]+)([A-ZÀÈÌÒÙ][a-zàèìòù]+(?:[\s-]+[A-ZÀÈÌÒÙ][a-zàèìòù]+)*)/i
  );
  if (autoreMatch) autore = autoreMatch[1].trim();

  // Estrai dimensioni
  let dimensioni = '';
  const dimMatch = restText.match(/(\d+\s*[xX×]\s*\d+(?:\s*[xX×]\s*\d+)?\s*cm)/i);
  if (dimMatch) dimensioni = dimMatch[1].trim();

  // Estrai tecnica
  let tecnica = 'Stampa su tela';
  const tecnicaPatterns = [
    /stampa\s+(?:digitale|fotografica|artistica)/i,
    /stampa\s+su\s+tela/i,
    /olio\s+su\s+tela/i,
    /acquerello/i,
    /litografia/i,
    /serigrafia/i,
    /stampa/i,
  ];
  for (const pat of tecnicaPatterns) {
    const m = restText.match(pat);
    if (m) { tecnica = m[0].trim(); break; }
  }

  // Estrai prezzo
  let prezzo = null;
  const prezzoMatch = restText.match(/(?:prezzo[:\s€]*|€\s*)(\d+(?:[.,]\d{1,2})?)/i);
  if (prezzoMatch) prezzo = parseFloat(prezzoMatch[1].replace(',', '.')) || null;

  return [{
    titolo_opera,
    autore,
    dimensioni,
    tecnica,
    descrizione_raw: rawText.trim(),
    prezzo,
    quantita: 1
  }];
}

// =============================================
// NORMALIZZAZIONE RECORD GENERICO
// =============================================
function normalizeRecord(record) {
  const fieldMap = {
    'titolo_opera': ['titolo_opera', 'titolo opera', 'titolo', 'nome opera', 'nome_opera'],
    'autore': ['autore', 'artista', 'pittore', 'artist'],
    'dimensioni': ['dimensioni', 'dimensione', 'misure', 'size', 'formato'],
    'tecnica': ['tecnica', 'technique', 'tipo stampa', 'tipo_stampa', 'materiale'],
    'descrizione_raw': ['descrizione_raw', 'descrizione raw', 'descrizione', 'description', 'testo', 'note'],
    'prezzo': ['prezzo', 'price', 'costo', 'cost', 'prezzo_vendita'],
    'quantita': ['quantita', 'quantità', 'qty', 'quantity', 'stock']
  };

  const normalized = {};
  for (const [targetKey, aliases] of Object.entries(fieldMap)) {
    for (const alias of aliases) {
      const found = Object.keys(record).find(k => k.trim().toLowerCase() === alias.toLowerCase());
      if (found !== undefined) {
        normalized[targetKey] = record[found] !== undefined ? String(record[found]).trim() : '';
        break;
      }
    }
    if (normalized[targetKey] === undefined) normalized[targetKey] = '';
  }

  normalized.prezzo = normalized.prezzo ? parseFloat(normalized.prezzo.replace(',', '.')) || null : null;
  normalized.quantita = normalized.quantita ? parseInt(normalized.quantita) || 1 : 1;
  return normalized;
}

// =============================================
// PARSER TXT
// =============================================
function parseTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const firstLine = content.split('\n')[0] || '';
  const hasStructure = firstLine.includes('\t') || firstLine.includes('|') || firstLine.includes(';');

  if (hasStructure) {
    let separator = '\t';
    if (firstLine.includes('|')) separator = '|';
    else if (firstLine.includes(';')) separator = ';';

    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('Il file TXT deve avere almeno intestazione + una riga dati');

    const headers = firstLine.split(separator).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(separator).map(v => v.trim());
      const record = {};
      headers.forEach((h, idx) => { record[h] = values[idx] || ''; });
      rows.push(normalizeRecord(record));
    }
    return { isCatalog: false, products: rows.filter(r => r.titolo_opera) };
  }

  return { isCatalog: false, products: parseFreeText(content) };
}

// =============================================
// PARSER PAGES
// =============================================
function parsePages(filePath) {
  const tempTxt = filePath + '_converted.txt';
  try {
    execSync('which textutil', { stdio: 'ignore' });
    execSync(`textutil -convert txt "${filePath}" -output "${tempTxt}"`, { timeout: 30000, stdio: 'pipe' });
    if (!fs.existsSync(tempTxt)) throw new Error('Conversione .pages fallita.');
    const rawText = fs.readFileSync(tempTxt, 'utf-8');
    fs.unlinkSync(tempTxt);
    return { isCatalog: false, products: parseFreeText(rawText) };
  } catch (err) {
    if (fs.existsSync(tempTxt)) { try { fs.unlinkSync(tempTxt); } catch {} }
    throw err;
  }
}

// =============================================
// FUNZIONE PRINCIPALE
// =============================================
/**
 * Parsa un file e ritorna { isCatalog: boolean, products: [] }
 * - isCatalog = true → prodotti hanno campi varianti (sku_max, misura_max, ecc.)
 * - isCatalog = false → prodotti standard (descrizione_raw, autore, ecc.)
 */
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.xlsx':
    case '.xls':
    case '.csv':
      return parseXlsxOrCsv(filePath, ext);
    case '.txt':
      return parseTxt(filePath);
    case '.pages':
      return parsePages(filePath);
    default:
      throw new Error(`Formato non supportato: ${ext}. Usa .xlsx, .csv, .txt o .pages`);
  }
}

module.exports = { parseFile, parseFreeText, generateSkuPadre };
