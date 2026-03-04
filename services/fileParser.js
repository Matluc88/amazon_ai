/**
 * Parser file prodotti — supporta testo libero (.txt, .pages) e tabellare (.xlsx, .csv)
 * Per .txt e .pages: interpreta come testo libero (1 prodotto per file)
 */
const xlsx = require('xlsx');
const { parse } = require('csv-parse/sync');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Parsa testo libero come un singolo prodotto.
 * Prima riga breve (<120 car.) = titolo opera
 * Resto del testo = descrizione_raw
 * Regex per autore, dimensioni, tecnica, prezzo
 */
function parseFreText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) throw new Error('Il file è vuoto');

  // Prima riga breve = titolo
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
    descrizione_raw: rawText.trim(), // salviamo il testo completo originale
    prezzo,
    quantita: 1
  }];
}

/**
 * Normalizza le chiavi del record per file tabellari (xlsx/csv/txt strutturato)
 */
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

function parseXlsx(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map(normalizeRecord).filter(r => r.titolo_opera);
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  return rows.map(normalizeRecord).filter(r => r.titolo_opera);
}

/**
 * Parsa file TXT — se ha separatori di colonna → tabellare, altrimenti → testo libero
 */
function parseTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const firstLine = content.split('\n')[0] || '';

  // Controlla se è un file strutturato con colonne
  const hasStructure = firstLine.includes('\t') || firstLine.includes('|') || firstLine.includes(';');

  if (hasStructure) {
    // Formato tabellare
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('Il file TXT deve avere almeno intestazione + una riga dati');

    let separator = '\t';
    if (firstLine.includes('|')) separator = '|';
    else if (firstLine.includes(';')) separator = ';';

    const headers = firstLine.split(separator).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(separator).map(v => v.trim());
      const record = {};
      headers.forEach((h, idx) => { record[h] = values[idx] || ''; });
      rows.push(normalizeRecord(record));
    }
    return rows.filter(r => r.titolo_opera);
  }

  // Testo libero — un solo prodotto
  return parseFreText(content);
}

/**
 * Parsa file Apple Pages (.pages) — sempre testo libero
 */
function parsePages(filePath) {
  const tempTxt = filePath + '_converted.txt';
  try {
    try {
      execSync('which textutil', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'Il parsing di file .pages è supportato solo su macOS.\n' +
        'Alternativa: apri in Pages → File → Esporta in → Word o txt'
      );
    }

    execSync(`textutil -convert txt "${filePath}" -output "${tempTxt}"`, { timeout: 30000, stdio: 'pipe' });

    if (!fs.existsSync(tempTxt)) {
      throw new Error('Conversione .pages fallita. Prova a esportare il file come .txt da Pages.');
    }

    const rawText = fs.readFileSync(tempTxt, 'utf-8');
    fs.unlinkSync(tempTxt);

    return parseFreText(rawText);
  } catch (err) {
    if (fs.existsSync(tempTxt)) { try { fs.unlinkSync(tempTxt); } catch {} }
    throw err;
  }
}

/**
 * Funzione principale
 */
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.xlsx': case '.xls': return parseXlsx(filePath);
    case '.csv': return parseCsv(filePath);
    case '.txt': return parseTxt(filePath);
    case '.pages': return parsePages(filePath);
    default: throw new Error(`Formato non supportato: ${ext}. Usa .xlsx, .csv, .txt o .pages`);
  }
}

module.exports = { parseFile };
