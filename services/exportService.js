/**
 * Export Service — Compila il template WALL_ART.xlsm con i dati del prodotto
 * e ritorna un buffer pronto per il download.
 *
 * Struttura righe output:
 *   Row 7 (DATA_START_ROW)     → Parent SKU
 *   Row 8                      → Child variante Grande (misura_max)
 *   Row 9                      → Child variante Media  (misura_media) — se presente
 *   Row 10                     → Child variante Mini   (misura_mini)  — se presente
 *
 * Valori chiave Amazon:
 *   Tipo di prodotto       = "WALL_ART"
 *   Livello di parentela   = "Articolo parent" / "Bambino"
 *   Variation theme        = "SIZE/ORIENTATION"
 *   Canale di gestione     = "DEFAULT"
 */
const xlsx = require('xlsx');
const path = require('path');
const { query } = require('../database/db');
const { getProductListing, extractDimensions } = require('./attributeService');

const TEMPLATE_PATH = path.join(__dirname, '../WALL_ART.xlsm');
const DATA_START_ROW = 7; // indice 0-based della prima riga dati nel foglio Modello

// ─── Lookup peso per dimensioni (kg) — copia locale per evitare import ciclici ─────
const WEIGHT_LOOKUP = {
  '50_70': 1.5, '50_75': 1.6, '50_80': 1.7, '50_85': 1.8,
  '70_100': 2.9, '70_105': 3.1, '70_110': 3.2, '70_120': 3.5,
  '90_130': 4.9, '90_135': 5.0, '90_145': 5.4, '90_150': 5.6,
};

function lookupWeight(text) {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const a = Math.round(parseFloat(m[1].replace(',', '.')));
  const b = Math.round(parseFloat(m[2].replace(',', '.')));
  if (isNaN(a) || isNaN(b)) return null;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return WEIGHT_LOOKUP[`${min}_${max}`] || null;
}

// ─── Mapping: nome_attributo DB → colonna XLSM ───────────────────────────────
// Solo attributi che non variano per variante (dimensioni/peso/prezzo gestiti a parte)
const ATTR_COL = {
  "Nome dell'articolo":                                         6,
  "Nome del marchio":                                           7,
  "Nome del modello":                                           19,
  "Produttore":                                                 20,
  "Immagine principale":                                        21,
  "Immagine 2":                                                 22,
  "Immagine 3":                                                 23,
  "Immagine 4":                                                 24,
  "Immagine 5":                                                 25,
  "Immagine 6":                                                 26,
  "Immagine 7":                                                 27,
  "Immagine 8":                                                 28,
  "Immagine 9":                                                 29,
  "Descrizione del prodotto":                                   37,
  "Punto elenco 1":                                             38,
  "Punto elenco 2":                                             39,
  "Punto elenco 3":                                             40,
  "Punto elenco 4":                                             41,
  "Punto elenco 5":                                             42,
  // "Chiavi di ricerca" NON è in questa mappa — viene splittata su 5 colonne (43-47) da splitKeywords()
  "Funzioni speciali":                                          48,
  "Stile":                                                      53,
  "Descrizione della fascia di età":                            54,
  "Materiale":                                                  55,
  "Numero di articoli":                                         60,
  "Personaggio rappresentato":                                  62,
  "Colore":                                                     64,
  "Forma dell'articolo":                                        73,
  "Tema":                                                       74,
  "Tipo di telaio":                                             81,
  "Edizione":                                                   83,
  "Supporti di stampa":                                         87,
  "Tipo di vernice":                                            102,
  "È personalizzabile?":                                        105,
  "Orientamento":                                               123,
  "Tipo di confezione":                                         124,
  "Motivo":                                                     125,
  "Tipo di montaggio":                                          126,
  "Tipo di finitura":                                           127,
  "Conteggio di unità":                                         128,
  "Tipo di conteggio unità":                                    129,
  "Usi consigliati per il prodotto":                            142,
  "È fragile?":                                                 147,
  "Materiale della base":                                       153,
  "Famiglia di colori":                                         154,
  "È incorniciato":                                             161,
  "Tipo di stanza":                                             167,
  "Stagioni":                                                   172,
  "Utilizzo in ambienti interni ed esterni":                    177,
  "Tema animali":                                               179,
  "forma decorazione da parete":                                184,
  "Numero di confezioni":                                       187,
  "Prezzo al pubblico consigliato (IVA inclusa)":               192,
  "Codice fiscale del prodotto":                                193,
  "L'offerta può essere inviata tramite messaggio regalo":       196,
  "È disponibile in confezione regalo":                         197,
  "Prezzo minimo pubblicizzato":                                 222,
  "Altezza imballaggio":                                        234,
  "Peso imballaggio":                                           236,
  "Paese/Regione di origine":                                   274,
  "Questo prodotto è soggetto a restrizioni di età per l'acquirente?": 298,
  "E-mail o indirizzo elettronico della persona responsabile":  299,
  "Attestazione di sicurezza GPSR":                             319,
  "E-mail o indirizzo elettronico del produttore":              320,
  "Prodotto OEM originale":                                     332,
};

// ─── Helper celle ──────────────────────────────────────────────────────────────
function setCellValue(sheet, col, row, value) {
  const ref = xlsx.utils.encode_cell({ r: row, c: col });
  if (value === '' || value === null || value === undefined) {
    delete sheet[ref];
    return;
  }
  const isNumber = typeof value === 'number' ||
    (typeof value === 'string' && value !== '' && !isNaN(value) &&
     !value.includes(' ') && !value.includes('x') && !value.includes('@'));
  if (isNumber && typeof value !== 'string') {
    sheet[ref] = { v: Number(value), t: 'n' };
  } else {
    sheet[ref] = { v: String(value), t: 's' };
  }
}

function clearDataRows(sheet) {
  const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  for (let r = DATA_START_ROW; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      delete sheet[xlsx.utils.encode_cell({ r, c })];
    }
  }
}

// ─── Split keyword su 5 slot Amazon (cols 43-47, max 250 byte UTF-8 ciascuno) ─
/**
 * Prende la stringa "Chiavi di ricerca" (parole separate da spazi) e la
 * distribuisce su fino a 5 slot da 250 byte, rispettando i confini di parola.
 * Restituisce un array di 5 stringhe (vuote se non necessarie).
 */
function splitKeywordsTo5Slots(keywordsStr) {
  const MAX_BYTES = 250;
  const NUM_SLOTS = 5;
  const slots = Array(NUM_SLOTS).fill('');
  if (!keywordsStr) return slots;

  const words = keywordsStr.trim().split(/\s+/);
  let slotIdx = 0;
  let current = '';

  for (const word of words) {
    if (slotIdx >= NUM_SLOTS) break;
    const candidate = current ? current + ' ' + word : word;
    // Controllo byte UTF-8
    if (Buffer.byteLength(candidate, 'utf8') <= MAX_BYTES) {
      current = candidate;
    } else {
      // Salva slot corrente e vai al prossimo
      slots[slotIdx] = current;
      slotIdx++;
      if (slotIdx >= NUM_SLOTS) break;
      // Inizia il nuovo slot con la parola corrente (se entra da sola)
      current = Buffer.byteLength(word, 'utf8') <= MAX_BYTES ? word : word.substring(0, MAX_BYTES);
    }
  }
  // Salva l'ultimo slot in lavorazione
  if (slotIdx < NUM_SLOTS && current) {
    slots[slotIdx] = current;
  }
  return slots;
}

// ─── Costruzione riga dati ─────────────────────────────────────────────────────
/**
 * Scrive una riga (parent o child) nel foglio.
 *
 * @param {object} sheet      - Foglio xlsx
 * @param {number} rowIdx     - Indice riga 0-based
 * @param {object} product    - Riga prodotto dal DB
 * @param {object} attrs      - Mappa nome_attributo → valore compilato
 * @param {object} variant    - Dati specifici della variante
 *   - sku          {string}  SKU della variante / padre
 *   - taglia       {string}  Etichetta taglia (solo child)
 *   - dims         {object}  { lunghezza, larghezza } in cm (solo child)
 *   - peso         {number}  Peso in kg (solo child)
 *   - prezzo       {number}  Prezzo di vendita (solo child)
 *   - immagine     {string}  URL immagine variante (solo child)
 *   - isParent     {boolean}
 */
function buildRow(sheet, rowIdx, product, attrs, variant) {
  const { isParent, sku, taglia, dims, peso, prezzo, immagine, immagine2, immagine3 } = variant;

  // ── Colonne strutturali ──────────────────────────────────
  setCellValue(sheet, 0, rowIdx, sku || '');
  setCellValue(sheet, 1, rowIdx, 'WALL_ART');
  // Col 2 (azione) → vuota = default "Crea o sostituisci"
  setCellValue(sheet, 8,  rowIdx, 'Esenzione GTIN'); // Tipo ID di prodotto (no EAN)
  setCellValue(sheet, 10, rowIdx, '20690426031');     // Nodo navigazione: Casa e cucina > Arte > Poster e stampe
  setCellValue(sheet, 15, rowIdx, 'Unità');           // Livello di aggregazione: singolo pezzo
  setCellValue(sheet, 275, rowIdx, 'No');             // Le batterie sono necessarie?
  setCellValue(sheet, 276, rowIdx, 'No');             // Le batterie sono incluse?

  if (isParent) {
    setCellValue(sheet, 3, rowIdx, 'Articolo parent');
    setCellValue(sheet, 5, rowIdx, 'SIZE/ORIENTATION');
    setCellValue(sheet, 189, rowIdx, 'Sì'); // skip_offer: parent non è acquistabile
  } else {
    setCellValue(sheet, 3, rowIdx, 'Bambino');
    setCellValue(sheet, 4, rowIdx, product.sku_padre || '');
    setCellValue(sheet, 66, rowIdx, taglia || '');
    // Condizione articolo
    setCellValue(sheet, 190, rowIdx, 'Nuovo');
    // Offerta
    setCellValue(sheet, 215, rowIdx, 'DEFAULT');    // canale gestione = FBM Italia
    setCellValue(sheet, 216, rowIdx, 100);           // quantità
    setCellValue(sheet, 217, rowIdx, 7);             // tempo di gestione = 7 giorni
    if (prezzo) setCellValue(sheet, 220, rowIdx, Number(prezzo) + 10); // prezzo Amazon = prezzo DB + €10
    setCellValue(sheet, 229, rowIdx, 'studio');      // gruppo spedizione venditore
  }

  // ── Attributi DB → colonne ───────────────────────────────
  for (const [nome, col] of Object.entries(ATTR_COL)) {
    const val = attrs[nome];
    if (val !== undefined && val !== '') {
      setCellValue(sheet, col, rowIdx, val);
    }
  }

  // ── Chiavi di ricerca → 5 slot (cols 43-47, max 250 byte ciascuno) ──────────
  const kwSlots = splitKeywordsTo5Slots(attrs['Chiavi di ricerca'] || '');
  kwSlots.forEach((slot, i) => {
    setCellValue(sheet, 43 + i, rowIdx, slot); // cols 43, 44, 45, 46, 47
  });

  // ── Dimensioni variante (sovrascrivono AUTO del parent) ──
  if (dims) {
    setCellValue(sheet, 180, rowIdx, Number(dims.lunghezza));  // lunghezza bordo
    setCellValue(sheet, 181, rowIdx, 'Centimetri');
    setCellValue(sheet, 182, rowIdx, Number(dims.larghezza));  // larghezza bordo
    setCellValue(sheet, 183, rowIdx, 'Centimetri');
    // Imballaggio: stesse dimensioni dell'articolo
    setCellValue(sheet, 230, rowIdx, Number(dims.lunghezza));
    setCellValue(sheet, 231, rowIdx, 'Centimetri');
    setCellValue(sheet, 232, rowIdx, Number(dims.larghezza));
    setCellValue(sheet, 233, rowIdx, 'Centimetri');
    // Altezza imballaggio: fissa 3 cm (spessore tela su telaio)
    setCellValue(sheet, 234, rowIdx, 3);
    setCellValue(sheet, 235, rowIdx, 'Centimetri');
  }

  // ── Peso variante + peso imballaggio ─────────────────────
  if (peso !== null && peso !== undefined) {
    setCellValue(sheet, 296, rowIdx, Number(peso));              // peso articolo
    setCellValue(sheet, 297, rowIdx, 'Chilogrammi');
    setCellValue(sheet, 236, rowIdx, Number(peso) + 0.3);       // peso imballaggio = peso + 0.3 kg cartone
    setCellValue(sheet, 237, rowIdx, 'Chilogrammi');             // unità peso imballaggio
  }

  // ── Immagini variante (principale=frontale, col22=laterale, col23=proporzione) ───
  if (!isParent) {
    if (immagine)    setCellValue(sheet, 21, rowIdx, immagine);       // frontale (principale)
    if (immagine2)   setCellValue(sheet, 22, rowIdx, immagine2);      // laterale
    if (immagine3)   setCellValue(sheet, 23, rowIdx, immagine3);      // proporzione
  }
}

// ─── Funzione principale ───────────────────────────────────────────────────────
async function exportProductToXlsm(productId) {
  // 1. Carica prodotto dal DB
  const productResult = await query('SELECT * FROM products WHERE id = $1', [productId]);
  const product = productResult.rows[0];
  if (!product) throw new Error(`Prodotto #${productId} non trovato`);

  // 2. Carica attributi compilati (AI + FIXED + AUTO + MANUAL)
  const sections = await getProductListing(productId, product);

  // 3. Appiattisci in mappa nome → valore
  const attrs = {};
  for (const items of Object.values(sections)) {
    for (const item of items) {
      if (item.value !== undefined && item.value !== '') {
        attrs[item.nome] = item.value;
      }
    }
  }

  // 4. Leggi il template WALL_ART.xlsm (mantiene tutte le intestazioni/formattazioni)
  let wb;
  try {
    wb = xlsx.readFile(TEMPLATE_PATH);
  } catch {
    throw new Error('Template WALL_ART.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Modello'];
  if (!sheet) throw new Error('Foglio "Modello" non trovato nel template');

  // 5. Pulisci le righe dati esistenti (riga 8+ in Excel = indice 7+ 0-based)
  clearDataRows(sheet);

  // 6. Costruisci lista varianti
  const rows = [];

  const hasVariants = !!(product.sku_max || product.sku_padre);

  if (hasVariants) {
    // ── Riga parent ───────────────────────────────────────
    rows.push({
      sku: product.sku_padre || product.titolo_opera?.substring(0, 40) || `SKU-${productId}`,
      taglia: null,
      dims: null,
      peso: null,
      prezzo: null,
      immagine: null,
      isParent: true,
    });

    // ── Righe child per ogni taglia disponibile ────────────
    const childVariants = [
      { sku: product.sku_max,   misura: product.misura_max,   prezzo: product.prezzo_max,   immagine: product.immagine_max,   immagine2: product.immagine_max_2,   immagine3: product.immagine_max_3 },
      { sku: product.sku_media, misura: product.misura_media, prezzo: product.prezzo_media, immagine: product.immagine_media, immagine2: product.immagine_media_2, immagine3: product.immagine_media_3 },
      { sku: product.sku_mini,  misura: product.misura_mini,  prezzo: product.prezzo_mini,  immagine: product.immagine_mini,  immagine2: product.immagine_mini_2,  immagine3: product.immagine_mini_3 },
    ].filter(v => v.sku && v.misura); // Salta varianti senza SKU o misura

    for (const cv of childVariants) {
      const dims = extractDimensions(cv.misura);
      const peso = lookupWeight(cv.misura);
      // Etichetta taglia: "lunghezza x larghezza cm" (formato Amazon-friendly)
      const taglia = dims ? `${dims.lunghezza} x ${dims.larghezza} cm` : cv.misura;

      rows.push({
        sku: cv.sku,
        taglia,
        dims,
        peso,
        prezzo: cv.prezzo,
        immagine: cv.immagine,
        immagine2: cv.immagine2,
        immagine3: cv.immagine3,
        isParent: false,
      });
    }
  } else {
    // Prodotto singolo senza varianti → riga unica
    const dims = extractDimensions(product.dimensioni || product.descrizione_raw || '');
    const peso = lookupWeight(product.dimensioni || product.descrizione_raw || '');
    rows.push({
      sku: product.titolo_opera?.substring(0, 40) || `PROD-${productId}`,
      taglia: null,
      dims,
      peso,
      prezzo: product.prezzo,
      immagine: null,
      isParent: false,
    });
  }

  // 7. Scrivi le righe nel foglio
  rows.forEach((variant, i) => {
    buildRow(sheet, DATA_START_ROW + i, product, attrs, variant);
  });

  // 8. Aggiorna il range del foglio
  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, DATA_START_ROW + rows.length - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  // 9. Genera buffer XLSM
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });

  const skuLabel = product.sku_padre || `prodotto-${productId}`;
  const filename = `WALL_ART_${skuLabel.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsm`;

  return { buffer, filename };
}

// ─── Export TUTTI i prodotti compilati (o solo quelli selezionati) ────────────
/**
 * @param {number[]|null} productIds - Se fornito, esporta solo questi ID.
 *                                     Se null/undefined, esporta tutti i prodotti compilati.
 */
async function exportAllProductsToXlsm(productIds = null) {
  // 1. Carica prodotti (filtrati o tutti)
  let result;
  if (productIds && productIds.length > 0) {
    // Esporta solo gli ID selezionati
    result = await query(
      `SELECT p.* FROM products p WHERE p.id = ANY($1) ORDER BY p.id ASC`,
      [productIds]
    );
  } else {
    // Esporta tutti i prodotti con almeno un attributo compilato
    result = await query(`
      SELECT p.*
      FROM products p
      WHERE EXISTS (
        SELECT 1 FROM product_attribute_values pa
        WHERE pa.product_id = p.id AND pa.value IS NOT NULL AND pa.value <> ''
      )
      ORDER BY p.id ASC
    `);
  }
  const products = result.rows;
  if (products.length === 0) throw new Error('Nessun prodotto con listing compilato trovato');

  // 2. Leggi il template una sola volta
  let wb;
  try {
    wb = xlsx.readFile(TEMPLATE_PATH);
  } catch {
    throw new Error('Template WALL_ART.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Modello'];
  if (!sheet) throw new Error('Foglio "Modello" non trovato nel template');

  clearDataRows(sheet);

  // 3. Itera su tutti i prodotti e accumula le righe
  let currentRow = DATA_START_ROW;

  for (const product of products) {
    // Carica attributi compilati per questo prodotto
    const sections = await getProductListing(product.id, product);
    const attrs = {};
    for (const items of Object.values(sections)) {
      for (const item of items) {
        if (item.value !== undefined && item.value !== '') {
          attrs[item.nome] = item.value;
        }
      }
    }

    // Costruisci le righe del prodotto
    const rows = [];
    const hasVariants = !!(product.sku_max || product.sku_padre);

    if (hasVariants) {
      rows.push({
        sku: product.sku_padre || product.titolo_opera?.substring(0, 40) || `SKU-${product.id}`,
        taglia: null, dims: null, peso: null, prezzo: null, immagine: null, isParent: true,
      });

      const childVariants = [
        { sku: product.sku_max,   misura: product.misura_max,   prezzo: product.prezzo_max,   immagine: product.immagine_max,   immagine2: product.immagine_max_2,   immagine3: product.immagine_max_3 },
        { sku: product.sku_media, misura: product.misura_media, prezzo: product.prezzo_media, immagine: product.immagine_media, immagine2: product.immagine_media_2, immagine3: product.immagine_media_3 },
        { sku: product.sku_mini,  misura: product.misura_mini,  prezzo: product.prezzo_mini,  immagine: product.immagine_mini,  immagine2: product.immagine_mini_2,  immagine3: product.immagine_mini_3 },
      ].filter(v => v.sku && v.misura);

      for (const cv of childVariants) {
        const dims = extractDimensions(cv.misura);
        const peso = lookupWeight(cv.misura);
        const taglia = dims ? `${dims.lunghezza} x ${dims.larghezza} cm` : cv.misura;
        rows.push({ sku: cv.sku, taglia, dims, peso, prezzo: cv.prezzo, immagine: cv.immagine, immagine2: cv.immagine2, immagine3: cv.immagine3, isParent: false });
      }
    } else {
      const dims = extractDimensions(product.dimensioni || product.descrizione_raw || '');
      const peso = lookupWeight(product.dimensioni || product.descrizione_raw || '');
      rows.push({
        sku: product.titolo_opera?.substring(0, 40) || `PROD-${product.id}`,
        taglia: null, dims, peso, prezzo: product.prezzo, immagine: null, isParent: false,
      });
    }

    // Scrivi le righe nel foglio
    rows.forEach((variant, i) => {
      buildRow(sheet, currentRow + i, product, attrs, variant);
    });
    currentRow += rows.length;
  }

  // 4. Aggiorna il range del foglio
  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, currentRow - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  // 5. Genera buffer
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `WALL_ART_ALL_${today}.xlsm`;

  return { buffer, filename, count: products.length };
}

module.exports = { exportProductToXlsm, exportAllProductsToXlsm };
