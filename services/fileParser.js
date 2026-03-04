const xlsx = require('xlsx');
const { parse } = require('csv-parse/sync');
const { parse: parseHtml } = require('node-html-parser');
const { execSync } = require('child_process');
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
 * Parsa file TXT (tab-separato, pipe-separato o punto e virgola)
 */
function parseTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  if (lines.length < 2) {
    throw new Error('Il file TXT deve contenere almeno una riga di intestazione e una di dati');
  }

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
 * Parsa file Apple Pages (.pages) tramite textutil (macOS)
 * Converte in HTML e poi estrae i dati dalla tabella
 */
function parsePages(filePath) {
  const tempHtml = filePath + '_converted.html';

  try {
    // Verifica che textutil sia disponibile (solo macOS)
    try {
      execSync('which textutil', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'Il parsing di file .pages è supportato solo su macOS con textutil installato.\n' +
        'Alternativa: apri il file in Pages → File → Esporta in → Excel (.xlsx)'
      );
    }

    // Converti Pages → HTML tramite textutil
    execSync(`textutil -convert html "${filePath}" -output "${tempHtml}"`, {
      timeout: 30000,
      stdio: 'pipe'
    });

    if (!fs.existsSync(tempHtml)) {
      throw new Error('La conversione del file .pages non ha prodotto output. Prova a esportarlo come Excel da Pages.');
    }

    const html = fs.readFileSync(tempHtml, 'utf-8');
    fs.unlinkSync(tempHtml);

    // Parsa l'HTML e cerca la tabella con più righe
    const root = parseHtml(html);
    const tables = root.querySelectorAll('table');

    if (tables.length === 0) {
      throw new Error(
        'Nessuna tabella trovata nel file Pages.\n' +
        'I dati devono essere organizzati in una tabella all\'interno del documento Pages.\n' +
        'Prima riga = intestazioni colonne (es: titolo_opera, autore, prezzo...)'
      );
    }

    // Usa la tabella con più righe
    let bestTable = tables[0];
    let maxRows = 0;
    for (const table of tables) {
      const rowCount = table.querySelectorAll('tr').length;
      if (rowCount > maxRows) {
        maxRows = rowCount;
        bestTable = table;
      }
    }

    const rows = bestTable.querySelectorAll('tr');

    if (rows.length < 2) {
      throw new Error('La tabella nel file Pages deve avere almeno 2 righe (intestazione + dati).');
    }

    // Estrai intestazioni (prima riga)
    const headerCells = rows[0].querySelectorAll('td, th');
    const headers = headerCells.map(cell => cell.text.trim()).filter(h => h);

    if (headers.length === 0) {
      throw new Error('Impossibile leggere le intestazioni della tabella dal file Pages.');
    }

    // Estrai righe dati
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td, th');
      if (cells.length === 0) continue;

      const record = {};
      headers.forEach((h, idx) => {
        record[h] = cells[idx] ? cells[idx].text.trim() : '';
      });

      const normalized = normalizeRecord(record);
      if (normalized.titolo_opera) {
        records.push(normalized);
      }
    }

    return records;

  } catch (err) {
    // Cleanup in caso di errore
    if (fs.existsSync(tempHtml)) {
      try { fs.unlinkSync(tempHtml); } catch {}
    }
    throw err;
  }
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
    case '.pages':
      return parsePages(filePath);
    default:
      throw new Error(`Formato file non supportato: ${ext}. Usa .xlsx, .csv, .txt o .pages`);
  }
}

module.exports = { parseFile };
