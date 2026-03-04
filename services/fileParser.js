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
 * Formato testo libero: prima riga breve = titolo opera, resto = descrizione.
 * Autore, dimensioni e tecnica vengono estratti con regex.
 */
function parsePages(filePath) {
  const tempTxt = filePath + '_converted.txt';

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

    // Converti Pages → TXT tramite textutil
    execSync(`textutil -convert txt "${filePath}" -output "${tempTxt}"`, {
      timeout: 30000,
      stdio: 'pipe'
    });

    if (!fs.existsSync(tempTxt)) {
      throw new Error('La conversione del file .pages non ha prodotto output. Prova a esportarlo come Excel da Pages.');
    }

    const rawText = fs.readFileSync(tempTxt, 'utf-8');
    fs.unlinkSync(tempTxt);

    // Split in righe, rimuovi righe vuote
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
      throw new Error('Il file .pages sembra vuoto dopo la conversione.');
    }

    // Prima riga con meno di 120 caratteri = titolo opera
    let titleIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length < 120) {
        titleIdx = i;
        break;
      }
    }

    const titolo_opera = lines[titleIdx];
    const restText = lines.slice(titleIdx + 1).join('\n');

    // --- Estrai autore via regex ---
    let autore = '';
    const autoreMatch = restText.match(
      /(?:artista[:\s]+|dell[''\u2019]artista[:\s]+|di[:\s]+|autore[:\s]+|pittore[:\s]+)([A-ZÀÈÌÒÙ][a-zàèìòù]+(?:[\s-]+[A-ZÀÈÌÒÙ][a-zàèìòù]+)*)/i
    );
    if (autoreMatch) {
      autore = autoreMatch[1].trim();
    }

    // --- Estrai dimensioni via regex (es: 30x40 cm, 50 × 70 cm) ---
    let dimensioni = '';
    const dimMatch = restText.match(/(\d+\s*[xX×]\s*\d+(?:\s*[xX×]\s*\d+)?\s*cm)/i);
    if (dimMatch) {
      dimensioni = dimMatch[1].trim();
    }

    // --- Estrai tecnica ---
    let tecnica = '';
    const tecnicaPatterns = [
      /stampa\s+(?:digitale|fotografica|artistica)/i,
      /stampa\s+su\s+tela/i,
      /stampa/i,
      /olio\s+su\s+tela/i,
      /acquerello/i,
      /litografia/i,
      /serigrafia/i,
    ];
    for (const pat of tecnicaPatterns) {
      const m = restText.match(pat);
      if (m) { tecnica = m[0].trim(); break; }
    }
    if (!tecnica) tecnica = 'Stampa su tela';

    // --- Estrai prezzo opzionale ---
    let prezzo = null;
    const prezzoMatch = restText.match(/(?:prezzo[:\s€]*|€\s*)(\d+(?:[.,]\d{1,2})?)/i);
    if (prezzoMatch) {
      prezzo = parseFloat(prezzoMatch[1].replace(',', '.')) || null;
    }

    const record = {
      titolo_opera,
      autore,
      dimensioni,
      tecnica,
      descrizione_raw: restText,
      prezzo,
      quantita: 1
    };

    return [record];

  } catch (err) {
    // Cleanup in caso di errore
    if (fs.existsSync(tempTxt)) {
      try { fs.unlinkSync(tempTxt); } catch {}
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
