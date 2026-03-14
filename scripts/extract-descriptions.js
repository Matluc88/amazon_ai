#!/usr/bin/env node
/**
 * extract-descriptions.js
 *
 * Estrae le descrizioni dai file .pages nelle cartelle SIVIGLIA
 * e le salva come {slug}__descrizione.txt nella cartella NORMALIZZATE.
 *
 * Strategia: usa osascript (AppleScript) per esportare i .pages via Pages app.
 * Se fallisce, usa estrazione Python3 dal binario .iwa (testo frammentato ma leggibile).
 *
 * Prerequisiti: macOS con Pages installato (per export pulito).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const BASE_DIR   = '/Users/matteo/Desktop/SIVIGLIA/IMMAGINI';
const OUTPUT_DIR = path.join(BASE_DIR, 'NORMALIZZATE');
const CONTAINERS = ['1', '2', 'fuori_luogo_1', 'fuori_luogo_4'];

// ──────────────────────────────────────────────
// UTILITY
// ──────────────────────────────────────────────
function toSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractDim(str) {
  const m = str.match(/(\d+)[xX](\d+)/);
  return m ? `${m[1]}x${m[2]}` : null;
}

// ──────────────────────────────────────────────
// ESTRAZIONE TESTO DA .pages
// ──────────────────────────────────────────────

/**
 * Estrazione testo da .pages:
 * 1. Unzip del binario .iwa dal ZIP
 * 2. `strings -n 5` per estrarre sequenze ASCII/UTF-8 leggibili
 * 3. Python3 per filtrare metadata e unire frammenti di frase
 */
const PYTHON_FILTER = `
import sys, re

# Leggi l'output grezzo di "strings" dal binario .iwa
raw = sys.stdin.read()

# Trova sequenze che INIZIANO con una lettera (incluse quelle accentate italiane)
# e contengono almeno 10 caratteri leggibili consecutivi.
# Questo ignora frammenti che iniziano con caratteri binari/speciali.
pattern = r'[A-Za-z\\u00C0-\\u024F][A-Za-z\\u00C0-\\u024F0-9 .,;:!?()\\'\\"/\\-]{9,}'
matches = re.findall(pattern, raw)

# Filtri per metadati iWork / locale
skip = re.compile(
    r'(Application/|ISOb|HP_ENVY|it_IT|latn|'
    r'\\bEUR\\b|\\bCNY\\b|\\bNaN\\b|CFPF|iso-a4|dd/MM|HH:|yy-|'
    r'Standard TOC|trimestre|avanti Cristo|'
    r'gregorian|gennaio|febbraio|marzo|aprile|maggio|giugno|'
    r'luglio|agosto|settembre|ottobre|novembre|dicembre|'
    r'domenica|luned|marted|mercoled|gioved|venerd|sabato|'
    r'NSFont|NSColor|NSM|NSSh|UIKit|CFBund|'
    r'iWork|com\\.apple|protobuf|http)',
    re.I
)

def is_text(s):
    if len(s) < 10: return False
    letters = sum(1 for c in s if c.isalpha())
    return letters / len(s) >= 0.55  # almeno 55% lettere

filtered = [m.strip() for m in matches if is_text(m) and not skip.search(m)]

# Rimuovi duplicati preservando ordine
seen = set()
unique = []
for s in filtered:
    if s and s not in seen:
        seen.add(s)
        unique.append(s)

# Output: ogni frammento su riga separata (no-merge per evitare join errati)
# Il tool AI (Claude) ricostruirà il significato dal testo parziale.
header = '# DESCRIZIONE ESTRATTA AUTOMATICAMENTE DAL FILE .pages\\n# (testo parziale da binario iWork — usare come riferimento per la generazione AI)\\n\\n'
print(header + '\\n'.join(unique))
`.trim();

function extractViaPython3(src) {
  try {
    // Step 1: estrai stringhe leggibili con `strings -n 5`
    const stringsOut = execSync(
      `unzip -p "${src}" "Index/Document.iwa" 2>/dev/null | strings -n 5`,
      { timeout: 10000, encoding: 'utf8' }
    );
    if (!stringsOut || stringsOut.trim().length < 10) return null;

    // Step 2: filtra e unisci con Python3
    const result = spawnSync('python3', ['-c', PYTHON_FILTER], {
      input: stringsOut,
      timeout: 15000,
      encoding: 'utf8'
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 80) {
      return result.stdout.trim();
    }
  } catch {}
  return null;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
  console.error(`❌ Cartella NORMALIZZATE non trovata: ${OUTPUT_DIR}`);
  console.error('   Esegui prima: node scripts/normalize-images.js');
  process.exit(1);
}

let totOk = 0, totFallback = 0, totFalliti = 0;
const falliti = [];

console.log('📄 ESTRAZIONE DESCRIZIONI .pages\n' + '='.repeat(50));

for (const container of CONTAINERS) {
  const containerPath = path.join(BASE_DIR, container);
  if (!fs.existsSync(containerPath)) continue;

  for (const subfolder of fs.readdirSync(containerPath).sort()) {
    const subPath = path.join(containerPath, subfolder);
    if (!fs.statSync(subPath).isDirectory()) continue;

    const folderDim = extractDim(subfolder);
    if (!folderDim) continue;

    const nomeRaw = subfolder
      .replace(/^\d+[xX]\d+\s+/, '')
      .replace(/\s+[xX]?\s*AMAZON\s*$/i, '')
      .trim();
    if (!nomeRaw) continue;

    const slug = toSlug(nomeRaw);

    // Cerca file .pages nella cartella
    const files = fs.readdirSync(subPath);
    const pagesFiles = files.filter(f => path.extname(f).toLowerCase() === '.pages');

    for (const pagesFile of pagesFiles) {
      const srcPath  = path.join(subPath, pagesFile);
      const destName = `${slug}__descrizione.txt`;
      const destPath = path.join(OUTPUT_DIR, destName);

      // Skip se già esiste
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 50) {
        console.log(`  ✅ GIÀ PRESENTE: ${destName}`);
        totOk++;
        continue;
      }

      process.stdout.write(`  📄 [${container}] ${nomeRaw}: `);

      // Estrazione Python3 dal .iwa (metodo primario)
      const extracted = extractViaPython3(srcPath);
      if (extracted) {
        fs.writeFileSync(destPath, extracted, 'utf8');
        console.log(`✅ Python3 OK (${extracted.length} chars) → ${destName}`);
        totOk++;
        continue;
      }

      // Nulla ha funzionato
      console.log(`❌ FALLITO`);
      falliti.push({ container, subfolder, file: pagesFile });
      totFalliti++;
    }
  }
}

console.log('\n' + '='.repeat(50));
console.log('✅  ESTRAZIONE COMPLETATA');
console.log('='.repeat(50));
console.log(`📄  Estratte OK:       ${totOk}`);
console.log(`⚠️   Parziali:          ${totFallback}`);
console.log(`❌  Falliti:           ${totFalliti}`);

if (falliti.length > 0) {
  console.log('\n❌ FILE NON ESTRATTI:');
  falliti.forEach(f => console.log(`   [${f.container}] ${f.subfolder} → ${f.file}`));
}

console.log(`\n📂  Output: ${OUTPUT_DIR}`);
