#!/usr/bin/env node
/**
 * normalize-images.js
 *
 * Copia e rinomina tutte le immagini da:
 *   /Users/matteo/Desktop/SIVIGLIA/IMMAGINI/
 *
 * verso la cartella piatta:
 *   /Users/matteo/Desktop/SIVIGLIA/IMMAGINI/NORMALIZZATE/
 *
 * Nomenclatura output:
 *   {slug}__principale.jpg
 *   {slug}__dettaglio_N.jpg
 *   {slug}__{dim}_frontale.png
 *   {slug}__{dim}_laterale.png    (anche .jpg se il sorgente è jpg)
 *   {slug}__{dim}_proporzione.jpg
 *   {slug}__descrizione.txt       (convertito da .pages via textutil)
 *
 * NOTA: Le dimensioni sono lasciate invariate (altezza×base, come le consegna il cliente).
 *       Il tool le invertirà poi tramite swapDimensions() in fileParser.js.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const BASE_DIR        = '/Users/matteo/Desktop/SIVIGLIA/IMMAGINI';
const MISURE_SCALA_DIR = path.join(BASE_DIR, 'MISURE SCALA');
const OUTPUT_DIR      = path.join(BASE_DIR, 'NORMALIZZATE');
const CONTAINERS      = ['1', '2', 'fuori_luogo_1', 'fuori_luogo_4'];

// ──────────────────────────────────────────────
// PATTERN DI CLASSIFICAZIONE
// ──────────────────────────────────────────────

// Frontale: context / soggiorno / letto (word-boundary!) / cintext / contex / i.context / i.n context
const FRONTALE_RE = /\b(context|soggiorno|cintext|contex)\b|i\.\s*n?\s*context|\bletto\b/i;

// Laterale: lato / di lato / latot
const LATERALE_RE = /\b(di\s+lato|lato|latot)\b/i;

// Dettaglio: part / partt / det / close up
const DETTAGLIO_RE = /\b(part\d*|partt\d*|det|close\s*up)\b/i;

// File da ignorare completamente
const IGNORA_RE = /^(IMG_|image0|quadro\s+moderno)/i;

// ──────────────────────────────────────────────
// STATISTICHE
// ──────────────────────────────────────────────
const stats = {
  MAIN: 0, DETTAGLIO: 0,
  VAR_FRONTALE: 0, VAR_LATERALE: 0,
  PROPORZIONE: 0, DESCRIZIONE: 0,
  IGNORA: 0, NON_CLASSIFICATO: 0, ERRORI: 0
};
const nonClassificati = [];

// ──────────────────────────────────────────────
// UTILITY
// ──────────────────────────────────────────────

/**
 * Genera uno slug da un nome opera.
 * es. "Balletto Teatrale" → "balletto-teatrale"
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // rimuove diacritici (è→e, à→a, …)
    .replace(/[''`]/g, '')              // rimuove apostrofi
    .replace(/[^a-z0-9]+/g, '-')       // non-alfanumerici → trattino
    .replace(/^-+|-+$/g, '');           // trim trattini iniziali/finali
}

/**
 * Estrae la prima occorrenza di una dimensione "NxM" da una stringa.
 * Ritorna es. "50x75" oppure null.
 */
function extractDim(str) {
  const m = str.match(/(\d+)[xX](\d+)/);
  return m ? `${m[1]}x${m[2]}` : null;
}

/**
 * Confronto bidirezionale tra due dimensioni (ignora l'ordine dei valori).
 * "50x70" == "70x50"
 */
function dimMatch(a, b) {
  if (!a || !b) return false;
  const [a1, a2] = a.split(/x/i).map(Number);
  const [b1, b2] = b.split(/x/i).map(Number);
  return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);
}

/**
 * Copia src nella cartella OUTPUT con il nome destName.
 * Se il file esiste già aggiunge un suffisso numerico per evitare sovrascritture.
 * Ritorna il nome effettivo usato.
 */
function copyToOutput(src, destName) {
  const ext  = path.extname(destName);
  const base = destName.slice(0, -ext.length);
  let destPath = path.join(OUTPUT_DIR, destName);
  let counter  = 1;
  while (fs.existsSync(destPath)) {
    destPath = path.join(OUTPUT_DIR, `${base}_dup${counter}${ext}`);
    counter++;
  }
  fs.copyFileSync(src, destPath);
  return path.basename(destPath);
}

/**
 * Converte .pages → .txt tramite textutil di macOS.
 * Salva direttamente in OUTPUT_DIR con il destName indicato.
 * Ritorna true se ok, false se errore.
 */
function convertPagesToTxt(src, destName) {
  const destPath = path.join(OUTPUT_DIR, destName);
  // Se esiste già, non sovrascrivere (aggiungi suffisso)
  let outPath = destPath;
  if (fs.existsSync(destPath)) {
    const base = destName.slice(0, -4); // rimuovi .txt
    let c = 1;
    while (fs.existsSync(outPath)) {
      outPath = path.join(OUTPUT_DIR, `${base}_dup${c}.txt`);
      c++;
    }
  }
  try {
    execSync(`textutil -convert txt "${src}" -output "${outPath}"`, {
      timeout: 30000,
      stdio: 'pipe'
    });
    return fs.existsSync(outPath) ? path.basename(outPath) : null;
  } catch (err) {
    console.error(`    ⚠️  textutil fallito per: ${path.basename(src)} — ${err.message}`);
    return null;
  }
}

/**
 * Carica le immagini di MISURE SCALA in un dizionario:
 *   { "50x70": "/path/50x70prop.jpg", … }
 */
function loadMisureScala() {
  const map = {};
  if (!fs.existsSync(MISURE_SCALA_DIR)) {
    console.warn('⚠️  MISURE SCALA non trovata:', MISURE_SCALA_DIR);
    return map;
  }
  for (const f of fs.readdirSync(MISURE_SCALA_DIR)) {
    const dim = extractDim(f);
    if (dim) {
      map[dim.toLowerCase()] = path.join(MISURE_SCALA_DIR, f);
    }
  }
  return map;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

// Crea cartella output se non esiste
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`📂 Cartella output creata: ${OUTPUT_DIR}\n`);
} else {
  console.log(`📂 Cartella output esistente: ${OUTPUT_DIR}\n`);
}

const misureScalaMap = loadMisureScala();
console.log(`📐 MISURE SCALA caricate: ${Object.keys(misureScalaMap).length} dimensioni`);
console.log(`   (${Object.keys(misureScalaMap).join(', ')})\n`);
console.log('='.repeat(70));

let totalOpere = 0;

for (const container of CONTAINERS) {
  const containerPath = path.join(BASE_DIR, container);
  if (!fs.existsSync(containerPath)) {
    console.log(`⚠️  Container non trovato: ${container}`);
    continue;
  }

  const subfolders = fs.readdirSync(containerPath).sort();

  for (const subfolder of subfolders) {
    const subPath = path.join(containerPath, subfolder);
    // Salta se non è una directory
    if (!fs.statSync(subPath).isDirectory()) continue;

    // ── Estrai dimensione cartella e nome opera ──────────────────────────
    // Formati attesi:
    //   "100x150 Nome Opera AMAZON"
    //   "100X150 I Serpenti alle Spalle AMAZON"
    //   "100x150 O Cangatto Appeso x Amazon"   (x prima di Amazon)
    //   "100x150 Giovani Sposi amazon"          (amazon lowercase)

    const folderDim = extractDim(subfolder);
    if (!folderDim) {
      console.log(`\n⚠️  Cartella senza dimensione riconoscibile: ${subfolder} — SALTATA`);
      continue;
    }

    // Nome opera = rimuovi dimensione iniziale + "AMAZON" finale (con eventuale "x" prima)
    const nomeRaw = subfolder
      .replace(/^\d+[xX]\d+\s+/, '')                  // rimuovi "100x150 "
      .replace(/\s+[xX]?\s*AMAZON\s*$/i, '')           // rimuovi " AMAZON" / " x AMAZON"
      .trim();

    if (!nomeRaw) {
      console.log(`\n⚠️  Nome opera vuoto per: ${subfolder} — SALTATA`);
      continue;
    }

    const slug = toSlug(nomeRaw);
    totalOpere++;

    console.log(`\n📁 [${container}] ${nomeRaw}  (dim cartella: ${folderDim})`);
    console.log(`   slug: ${slug}`);

    const files = fs.readdirSync(subPath).sort();
    let dettaglioCount = 0;
    const varDimsFound = new Set(); // dimensioni varianti trovate (per cercare proporzione)

    for (const file of files) {
      const filePath  = path.join(subPath, file);
      const ext       = path.extname(file).toLowerCase();
      const nameNoExt = file.slice(0, -ext.length);

      // ── IGNORA ────────────────────────────────────────────────────────
      if (IGNORA_RE.test(file)) {
        console.log(`  ⏭️  IGNORA: ${file}`);
        stats.IGNORA++;
        continue;
      }

      // ── DESCRIZIONE (.pages) ──────────────────────────────────────────
      if (ext === '.pages') {
        const destName = `${slug}__descrizione.txt`;
        const result   = convertPagesToTxt(filePath, destName);
        if (result) {
          console.log(`  📄 DESCRIZIONE: ${file} → ${result}`);
          stats.DESCRIZIONE++;
        } else {
          stats.ERRORI++;
        }
        continue;
      }

      // ── PNG ───────────────────────────────────────────────────────────
      if (ext === '.png') {
        const fileDim = extractDim(file);

        // Se la dim del file coincide con la cartella → PNG della misura principale, raro, ignora
        if (fileDim && dimMatch(fileDim, folderDim)) {
          console.log(`  ⏭️  PNG dim=cartella IGNORA: ${file}`);
          stats.IGNORA++;
          continue;
        }

        const dim = fileDim || 'nodim';

        if (FRONTALE_RE.test(nameNoExt)) {
          if (fileDim) varDimsFound.add(fileDim.toLowerCase());
          const destName = `${slug}__${dim}_frontale.png`;
          const saved    = copyToOutput(filePath, destName);
          console.log(`  🖼️  VAR_FRONTALE [${dim}]: ${file} → ${saved}`);
          stats.VAR_FRONTALE++;

        } else if (LATERALE_RE.test(nameNoExt)) {
          if (fileDim) varDimsFound.add(fileDim.toLowerCase());
          const destName = `${slug}__${dim}_laterale.png`;
          const saved    = copyToOutput(filePath, destName);
          console.log(`  🖼️  VAR_LATERALE [${dim}]: ${file} → ${saved}`);
          stats.VAR_LATERALE++;

        } else {
          console.log(`  ❓ PNG non classificato: ${file}`);
          nonClassificati.push({ container, subfolder, file });
          stats.NON_CLASSIFICATO++;
        }
        continue;
      }

      // ── JPG / JPEG ────────────────────────────────────────────────────
      if (ext === '.jpg' || ext === '.jpeg') {
        const fileDim = extractDim(file);

        // Dettaglio prima di tutto
        if (DETTAGLIO_RE.test(nameNoExt)) {
          dettaglioCount++;
          const destName = `${slug}__dettaglio_${dettaglioCount}.jpg`;
          const saved    = copyToOutput(filePath, destName);
          console.log(`  🖼️  DETTAGLIO [${dettaglioCount}]: ${file} → ${saved}`);
          stats.DETTAGLIO++;
          continue;
        }

        // Frontale JPG (caso raro, es. "in context.jpeg")
        if (FRONTALE_RE.test(nameNoExt)) {
          const dim = fileDim || 'nodim';
          if (fileDim) varDimsFound.add(fileDim.toLowerCase());
          const destName = `${slug}__${dim}_frontale.jpg`;
          const saved    = copyToOutput(filePath, destName);
          console.log(`  🖼️  VAR_FRONTALE JPG [${dim}]: ${file} → ${saved}`);
          stats.VAR_FRONTALE++;
          continue;
        }

        // Laterale JPG (es. "a volte è così di lato.jpeg")
        if (LATERALE_RE.test(nameNoExt)) {
          const dim = fileDim || 'nodim';
          if (fileDim) varDimsFound.add(fileDim.toLowerCase());
          const destName = `${slug}__${dim}_laterale.jpg`;
          const saved    = copyToOutput(filePath, destName);
          console.log(`  🖼️  VAR_LATERALE JPG [${dim}]: ${file} → ${saved}`);
          stats.VAR_LATERALE++;
          continue;
        }

        // MAIN (immagine principale del prodotto)
        const mainDestName = `${slug}__principale.jpg`;
        if (!fs.existsSync(path.join(OUTPUT_DIR, mainDestName))) {
          const saved = copyToOutput(filePath, mainDestName);
          console.log(`  🖼️  MAIN: ${file} → ${saved}`);
          stats.MAIN++;
        } else {
          // Principale già esistente → diventa dettaglio extra
          dettaglioCount++;
          const destName = `${slug}__dettaglio_${dettaglioCount}.jpg`;
          const saved    = copyToOutput(filePath, destName);
          console.log(`  🖼️  MAIN→DETTAGLIO (principale già esiste): ${file} → ${saved}`);
          stats.DETTAGLIO++;
        }
        continue;
      }

      // ── Tutto il resto ────────────────────────────────────────────────
      console.log(`  ❓ Formato non gestito: ${file}`);
      nonClassificati.push({ container, subfolder, file });
      stats.NON_CLASSIFICATO++;
    }

    // ── PROPORZIONE: cerca in MISURE SCALA per ogni dim variante trovata ─
    for (const varDim of varDimsFound) {
      let scalaSrc = null;
      // Confronto bidirezionale
      for (const [scalaDim, scalaPath] of Object.entries(misureScalaMap)) {
        if (dimMatch(varDim, scalaDim)) {
          scalaSrc = scalaPath;
          break;
        }
      }

      if (scalaSrc) {
        const destName = `${slug}__${varDim}_proporzione.jpg`;
        const saved    = copyToOutput(scalaSrc, destName);
        console.log(`  📐 PROPORZIONE [${varDim}]: ${path.basename(scalaSrc)} → ${saved}`);
        stats.PROPORZIONE++;
      } else {
        console.log(`  ⚠️  Nessuna PROPORZIONE in MISURE SCALA per dim: ${varDim}`);
      }
    }
  }
}

// ──────────────────────────────────────────────
// REPORT FINALE
// ──────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('✅  NORMALIZZAZIONE COMPLETATA');
console.log('='.repeat(70));
console.log(`📁  Opere elaborate:     ${totalOpere}`);
console.log(`🖼️   MAIN:               ${stats.MAIN}`);
console.log(`🖼️   DETTAGLIO:          ${stats.DETTAGLIO}`);
console.log(`🖼️   VAR_FRONTALE:       ${stats.VAR_FRONTALE}`);
console.log(`🖼️   VAR_LATERALE:       ${stats.VAR_LATERALE}`);
console.log(`📐  PROPORZIONE:         ${stats.PROPORZIONE}`);
console.log(`📄  DESCRIZIONE (.txt):  ${stats.DESCRIZIONE}`);
console.log(`⏭️   IGNORA:              ${stats.IGNORA}`);
console.log(`❓  NON CLASSIFICATI:    ${stats.NON_CLASSIFICATO}`);
console.log(`❌  ERRORI:              ${stats.ERRORI}`);
console.log(`\n📂  Output: ${OUTPUT_DIR}`);

if (nonClassificati.length > 0) {
  console.log('\n⚠️  FILE NON CLASSIFICATI:');
  for (const nc of nonClassificati) {
    console.log(`   [${nc.container}] ${nc.subfolder} → ${nc.file}`);
  }
}

const totalOut = stats.MAIN + stats.DETTAGLIO + stats.VAR_FRONTALE +
                 stats.VAR_LATERALE + stats.PROPORZIONE + stats.DESCRIZIONE;
console.log(`\n📊  Totale file copiati/convertiti: ${totalOut}`);
