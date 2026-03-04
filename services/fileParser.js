const xlsx = require('xlsx');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

/**
 * Normalizza le chiavi del record per gestire varianti nei nomi colonne
 */
function normalizeRecord(record) {
  const fieldMap = {
    'titolo_opera': ['titolo_opera', 'titolo opera', 'titolo', 'nome opera', 'nome_opera'],
    'autore': ['autore', 'artista', 'pittore', 'artist'],
    'dimensioni': ['dimensioni', 'dimensione', 'misure', 'size', 'formato'],
    'tecnica': ['tecnica', 'technique', 'tipo stampa', 'tipo_stampa', 'materiale'],
    'descrizione_raw': ['descrizione_raw', 'descrizione raw', 'descrizione', 'description', 'testo', 'note'],
    'prezzo': ['prezzo', 'price', 'costo', 'cost', 'prezzo_vendita'],
    'quantita': ['quantita', 'quantità', 'qty', 'quantity', 'stock', 'disponibilita', 'disponibilità']
  };

  const normalized = {};

  for (const [targetKey, aliases] of Object.entries(fieldMap)) {
    for (const alias of aliases) {
      const found = Object.keys(record).find(
        k => k.trim().toLowerCase() === alias.toLowerCase()
      );
      if (found !== undefined) {
        normalized[targetKey] = record[found] !== undefined && record[found] !== null
          ? String(record[found]).trim()
          : '';
        break;
      }
    }
    if (normalized[targetKey] === undefined) {
      normalized[targetKey] = '';
    }
  }

  // Conversione tipi
  normalized.prezzo = normalized.prezzo ? parseFloat(normalized.prezzo.replace(',', '.')) || null : null;
  normalized.quantita = normalized.quantita ? parseInt(normalized.quantita) || 1 : 1;

  return normalized;
}

/**
 * Parsa file XLSX o XLS
 */
function parseXlsx(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map(normalizeRecord).filter(r => r.titolo_opera);
}

/**
 * Parsa file CSV
 */
function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true
  });
  return rows.map(normalizeRecord).filter(r => r.titolo_opera);
}

/**
 * Parsa file TXT (tab-separato o pipe-separato)
 */
function parseTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  if (lines.length < 2) {
    throw new Error('Il file TXT deve contenere almeno una riga di intestazione e una di dati');
  }

  // Detect separatore: tab, pipe o punto e virgola
  const firstLine = lines[0];
  let separator = '\t';
  if (firstLine.includes('|')) separator = '|';
  else if (firstLine.includes(';')) separator = ';';

  const headers = firstLine.split(separator).map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(separator).map(v => v.trim());
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] || '';
    });
    rows.push(normalizeRecord(record));
  }

  return rows.filter(r => r.titolo_opera);
}

/**
 * Funzione principale: parsa qualsiasi file supportato
 */
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.xlsx':
    case '.xls':
      return parseXlsx(filePath);
    case '.csv':
      return parseCsv(filePath);
    case '.txt':
      return parseTxt(filePath);
    default:
      throw new Error(`Formato file non supportato: ${ext}. Usa .xlsx, .csv o .txt`);
  }
}

module.exports = { parseFile };
