/**
 * Export Service DE — Compila il template WALL_ART_DE.xlsm con i dati del prodotto
 * e ritorna un buffer pronto per il download su Amazon.de.
 *
 * Struttura righe output:
 *   Row 5 (DATA_START_ROW)     → Parent SKU
 *   Row 6                      → Child variante Grande (misura_max)
 *   Row 7                      → Child variante Media  (misura_media) — se presente
 *   Row 8                      → Child variante Mini   (misura_mini)  — se presente
 *
 * Differenze rispetto al template IT/FR:
 *   - DATA_START_ROW = 5 (IT: 7, FR: 6) — il template DE ha 5 righe di intestazione
 *   - Foglio "Vorlage" (IT: "Modello", FR: "Modèle")
 *   - Valori in tedesco: Eltern/Kind, Ja/Nein, Neu, Einheit, Zentimeter, Kilogramm
 *   - Colonne completamente diverse: offerta a col 146+, prezzo a col 178
 *   - Immagine principale a col 20 (IT/FR: 21)
 *   - Prezzo Amazon = prezzo DB + €20
 *   - marketplace_id = A1PA6795UKMFR9 (DE)
 *
 * Categoria: Küche, Haushalt & Wohnen > Bilder, Poster, Kunstdrucke & Skulpturen > Poster & Kunstdrucke
 */
const xlsx = require('xlsx');
const path = require('path');
const { query } = require('../database/db');
const { getProductListing, getProductListingDE, extractDimensions } = require('./attributeService');

const TEMPLATE_PATH = path.join(__dirname, '../WALL_ART_DE.xlsm');
const DATA_START_ROW = 5; // indice 0-based — il template DE ha 5 righe header (vs 7 IT, 6 FR)

// ─── Browse node Germania — Poster & Kunstdrucke ────────────────────────────
// Küche, Haushalt & Wohnen > Bilder, Poster, Kunstdrucke & Skulpturen > Poster & Kunstdrucke
const BROWSE_NODE_DE = '372854011';

// ─── Lookup peso per dimensioni (kg) ─────────────────────────────────────────
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

// ─── Mapping: nome_attributo DB (italiano) → colonna XLSM tedesca ────────────
// Il template DE ha una struttura colonne molto diversa da IT/FR.
// Immagini shift -1, offerta molto prima, dimensioni a col 135+.
const ATTR_COL_DE = {
  // ── Identità listing / Informazioni generali ──────────────────────────────
  "Nome dell'articolo":                                         6,
  "Nome del marchio":                                           7,
  "Modellname":                                                 18,
  "Produttore":                                                 19,
  "Immagine principale":                                        20,
  "Immagine 2":                                                 21,
  "Immagine 3":                                                 22,
  "Immagine 4":                                                 23,
  "Immagine 5":                                                 24,
  "Immagine 6":                                                 25,
  "Immagine 7":                                                 26,
  "Immagine 8":                                                 27,
  "Immagine 9":                                                 28,
  // ── Informazioni dettagliate prodotto ─────────────────────────────────────
  "Descrizione del prodotto":                                   36,
  "Punto elenco 1":                                             37,
  "Punto elenco 2":                                             38,
  "Punto elenco 3":                                             39,
  "Punto elenco 4":                                             40,
  "Punto elenco 5":                                             41,
  // "Chiavi di ricerca" → splittata su 5 colonne (42-46) da splitKeywordsTo5Slots()
  "Funzioni speciali":                                          47,
  "Stile":                                                      52,
  "Descrizione della fascia di età":                            53,
  "Materiale":                                                  54,
  "Numero di articoli":                                         59,
  "Personaggio rappresentato":                                  60,
  "Colore":                                                     61,
  "Forma dell'articolo":                                        64,
  "Tema":                                                       65,
  "Tipo di telaio":                                             72,
  "Edizione":                                                   74,
  "Supporti di stampa":                                         75,
  "Tipo di vernice":                                            90,
  "È personalizzabile?":                                        92,
  "Orientamento":                                               94,
  "Tipo di confezione":                                         95,
  "Motivo":                                                     96,
  "Tipo di montaggio":                                          97,
  "Tipo di finitura":                                           98,
  "Conteggio di unità":                                         99,
  "Tipo di conteggio unità":                                    100,
  "Usi consigliati per il prodotto":                            109,
  "È fragile?":                                                 114,
  "Materiale della base":                                       115,
  "Famiglia di colori":                                         116,
  "È incorniciato":                                             121,
  "Tipo di stanza":                                             122,
  "Stagioni":                                                   127,
  "Utilizzo in ambienti interni ed esterni":                    132,
  "Tema animali":                                               134,
  "forma decorazione da parete":                                139,
  // ── Offerta ───────────────────────────────────────────────────────────────
  "Numero di confezioni":                                       143,
  "Prezzo al pubblico consigliato (IVA inclusa)":               149,
  "Codice fiscale del prodotto":                                150,
  "L'offerta può essere inviata tramite messaggio regalo":      153,
  "È disponibile in confezione regalo":                         154,
  "Prezzo minimo pubblicizzato":                                155,
  // ── Logistica ─────────────────────────────────────────────────────────────
  "Altezza imballaggio":                                        192,
  "Peso imballaggio":                                           194,
  // ── Sicurezza / Conformità ────────────────────────────────────────────────
  "Paese/Regione di origine":                                   232,
  "Questo prodotto è soggetto a restrizioni di età per l'acquirente?": 256,
  "E-mail o indirizzo elettronico della persona responsabile":  267,
  "Attestazione di sicurezza GPSR":                             287,
  "E-mail o indirizzo elettronico del produttore":              288,
  "Prodotto OEM originale":                                     300,
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

// ─── Split keyword su 5 slot (cols 42-46, max 250 byte UTF-8 ciascuno) ────────
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
    if (Buffer.byteLength(candidate, 'utf8') <= MAX_BYTES) {
      current = candidate;
    } else {
      slots[slotIdx] = current;
      slotIdx++;
      if (slotIdx >= NUM_SLOTS) break;
      current = Buffer.byteLength(word, 'utf8') <= MAX_BYTES ? word : word.substring(0, MAX_BYTES);
    }
  }
  if (slotIdx < NUM_SLOTS && current) {
    slots[slotIdx] = current;
  }
  return slots;
}

// ─── Costruzione riga dati (DE) ───────────────────────────────────────────────
function buildRowDE(sheet, rowIdx, product, attrs, variant) {
  const { isParent, sku, taglia, dims, peso, prezzo, immagine, immagine2, immagine3, immagine4, asin } = variant;

  // ── Colonne strutturali ──────────────────────────────────────────────────
  setCellValue(sheet, 0, rowIdx, sku || '');
  setCellValue(sheet, 1, rowIdx, 'WALL_ART');
  // Col 2 (Angebotsaktion) → vuota = default "Erstellen oder Ersetzen"

  // ID prodotto: ASIN se disponibile, altrimenti GTIN-Freistellung
  if (asin) {
    setCellValue(sheet, 8, rowIdx, 'ASIN');
    setCellValue(sheet, 9, rowIdx, asin);
  } else {
    setCellValue(sheet, 8, rowIdx, 'GTIN-Freistellung');
  }

  // Browse node DE — Poster & Kunstdrucke
  setCellValue(sheet, 10, rowIdx, BROWSE_NODE_DE);
  // Paketebene = Einheit (singolo pezzo)
  setCellValue(sheet, 15, rowIdx, 'Einheit');
  // Batterie non necessarie
  setCellValue(sheet, 233, rowIdx, 'Nein');
  setCellValue(sheet, 234, rowIdx, 'Nein');

  if (isParent) {
    setCellValue(sheet, 3, rowIdx, 'Eltern');
    setCellValue(sheet, 5, rowIdx, 'SIZE/ORIENTATION');
    setCellValue(sheet, 146, rowIdx, 'Ja'); // Angebot überspringen: parent non acquistabile
  } else {
    setCellValue(sheet, 3, rowIdx, 'Kind');
    setCellValue(sheet, 4, rowIdx, product.sku_padre || '');
    setCellValue(sheet, 5, rowIdx, 'SIZE/ORIENTATION');
    setCellValue(sheet, 62, rowIdx, taglia || '');        // Größe (taglia)
    // Artikelzustand
    setCellValue(sheet, 147, rowIdx, 'Neu');
    // Offerta
    setCellValue(sheet, 173, rowIdx, 'DEFAULT');           // Fulfillment-Channel-Code (DE)
    setCellValue(sheet, 174, rowIdx, 100);                 // Menge (quantità)
    setCellValue(sheet, 175, rowIdx, 7);                   // Bearbeitungszeit 7 giorni
    if (prezzo) setCellValue(sheet, 178, rowIdx, Number(prezzo) + 20);  // Ihr Preis EUR = prezzo DB + €20
    if (prezzo) setCellValue(sheet, 149, rowIdx, Number(prezzo) + 60);  // Listenpreis mit Steuern = prezzo vendita + €40 (= DB + €60)
    setCellValue(sheet, 187, rowIdx, 'studio');            // Versandvorlage (gruppo spedizione)
  }

  // ── Attributi DB → colonne DE ─────────────────────────────────────────────
  const INVALID_VALUES = new Set(['N/D', 'n/d']);
  for (const [nome, col] of Object.entries(ATTR_COL_DE)) {
    const val = attrs[nome];
    if (val === undefined || val === '') continue;
    if (INVALID_VALUES.has(String(val).trim())) continue;
    if (nome === 'Prezzo al pubblico consigliato (IVA inclusa)' && (val === '0' || val === 0 || val === '' || !val)) continue;
    setCellValue(sheet, col, rowIdx, val);
  }

  // ── Chiavi di ricerca → 5 slot (cols 42-46) ──────────────────────────────
  const kwSlots = splitKeywordsTo5Slots(attrs['Chiavi di ricerca'] || '');
  kwSlots.forEach((slot, i) => {
    setCellValue(sheet, 42 + i, rowIdx, slot);
  });

  // ── Defaults fissi Amazon.de — obbligatori per "Poster & Kunstdrucke" ─────
  // Valori validati dal foglio "Gültige Werte" del template WALL_ART_DE.xlsm.
  // Sovrascrivono eventuali valori italiani dal DB. Fissi per parent + child.
  // ── Brand & Manufacturer — fissi per tutti i prodotti ────────────────────
  setCellValue(sheet, 7,   rowIdx, 'SivigliArt');               // Markenname (Brand)
  setCellValue(sheet, 19,  rowIdx, 'SivigliArt');               // Hersteller (Manufacturer)

  // ── Ausrichtung — calcolata dalle dimensioni (Hochformat / Querformat) ───
  if (dims && dims.lunghezza && dims.larghezza) {
    const orient = Number(dims.lunghezza) > Number(dims.larghezza) ? 'Querformat' : 'Hochformat';
    setCellValue(sheet, 94, rowIdx, orient);                     // Ausrichtung
  }

  setCellValue(sheet, 75,  rowIdx, 'Stoff');                    // Druckmaterial — "Stoff" = tessuto/canvas
  setCellValue(sheet, 92,  rowIdx, 'Nein');                     // Anpassbar? (Ja / Nein)
  setCellValue(sheet, 114, rowIdx, 'Nein');                     // Ist der Artikel zerbrechlich? (Ja / Nein)
  setCellValue(sheet, 121, rowIdx, 'Nein');                     // Ist gerahmt — canvas su telaio, non cornice (Ja / Nein)
  setCellValue(sheet, 132, rowIdx, 'Innenbereich');             // Verwendung im Innen- und Außenbereich
  setCellValue(sheet, 139, rowIdx, 'Kunstdruck');               // Wand Dekoration Form
  setCellValue(sheet, 147, rowIdx, 'Neu');                      // Artikelzustand
  setCellValue(sheet, 153, rowIdx, 'Nein');                     // Geschenknachricht (Ja / Nein)
  setCellValue(sheet, 154, rowIdx, 'Nein');                     // Geschenkverpackung (Ja / Nein)
  setCellValue(sheet, 232, rowIdx, 'Italien');                  // Ursprungsland
  setCellValue(sheet, 256, rowIdx, 'Nein');                     // Altersbeschränkungen (Ja / Nein)
  setCellValue(sheet, 267, rowIdx, 'sivigliart@outlook.it');    // E-Mail zuständige Person (GPSR)
  setCellValue(sheet, 287, rowIdx, 'Ja');                       // GPSR-Sicherheitsbescheinigung (Ja / Nein)
  setCellValue(sheet, 288, rowIdx, 'sivigliart@outlook.it');    // E-Mail Hersteller (GPSR)
  setCellValue(sheet, 300, rowIdx, 'Nein');                     // Ist ein OEM-Produkt (Ja / Nein)
  // ─────────────────────────────────────────────────────────────────────────

  // ── Dimensioni variante ──────────────────────────────────────────────────
  if (dims) {
    // Dimensioni articolo (col 135-138)
    setCellValue(sheet, 135, rowIdx, Number(dims.lunghezza));
    setCellValue(sheet, 136, rowIdx, 'Zentimeter');
    setCellValue(sheet, 137, rowIdx, Number(dims.larghezza));
    setCellValue(sheet, 138, rowIdx, 'Zentimeter');
    // Imballaggio — lunghezza e larghezza (col 188-191)
    setCellValue(sheet, 188, rowIdx, Number(dims.lunghezza));
    setCellValue(sheet, 189, rowIdx, 'Zentimeter');
    setCellValue(sheet, 190, rowIdx, Number(dims.larghezza));
    setCellValue(sheet, 191, rowIdx, 'Zentimeter');
    // Altezza imballaggio: fissa 3 cm (col 192-193)
    setCellValue(sheet, 192, rowIdx, 3);
    setCellValue(sheet, 193, rowIdx, 'Zentimeter');
  }

  // ── Peso variante ────────────────────────────────────────────────────────
  if (peso !== null && peso !== undefined) {
    // Peso articolo (col 254-255)
    setCellValue(sheet, 254, rowIdx, Number(peso));
    setCellValue(sheet, 255, rowIdx, 'Kilogramm');
    // Peso imballaggio = peso + 0.3 kg (col 194-195)
    setCellValue(sheet, 194, rowIdx, Math.round((Number(peso) + 0.3) * 10) / 10);
    setCellValue(sheet, 195, rowIdx, 'Kilogramm');
  }

  // ── Immagini variante child ───────────────────────────────────────────────
  // Nel template DE le immagini sono a col 20-28 (shift -1 rispetto a IT/FR)
  if (!isParent) {
    for (let c = 20; c <= 28; c++) setCellValue(sheet, c, rowIdx, '');
    const mainImgChild = attrs['Immagine principale'] || immagine || immagine2 || null;
    if (mainImgChild) setCellValue(sheet, 20, rowIdx, mainImgChild);
    if (immagine4)    setCellValue(sheet, 21, rowIdx, immagine4);
    if (immagine3)    setCellValue(sheet, 22, rowIdx, immagine3);
    const det1 = attrs['Immagine 2'] || product.dettaglio_1 || '';
    const det2 = attrs['Immagine 3'] || product.dettaglio_2 || '';
    const det3 = attrs['Immagine 4'] || product.dettaglio_3 || '';
    if (det1) setCellValue(sheet, 23, rowIdx, det1);
    if (det2) setCellValue(sheet, 24, rowIdx, det2);
    if (det3) setCellValue(sheet, 25, rowIdx, det3);
    if (attrs['Immagine 5']) setCellValue(sheet, 26, rowIdx, attrs['Immagine 5']);
    if (attrs['Immagine 6']) setCellValue(sheet, 27, rowIdx, attrs['Immagine 6']);
    if (attrs['Immagine 7']) setCellValue(sheet, 28, rowIdx, attrs['Immagine 7']);
  }

  // ── Fallback immagini parent ──────────────────────────────────────────────
  if (isParent) {
    if (!attrs['Immagine principale'] && product.immagine_max)
      setCellValue(sheet, 20, rowIdx, product.immagine_max);
    if (!attrs['Immagine 2'] && product.dettaglio_1)
      setCellValue(sheet, 21, rowIdx, product.dettaglio_1);
    if (!attrs['Immagine 3'] && product.dettaglio_2)
      setCellValue(sheet, 22, rowIdx, product.dettaglio_2);
    if (!attrs['Immagine 4'] && product.dettaglio_3)
      setCellValue(sheet, 23, rowIdx, product.dettaglio_3);
  }
}

// ─── Helper: carica attributi DE con fallback a IT ────────────────────────────
async function loadAttrsDE(productId, product) {
  // 1. Carica listing tedesco (testo AI: titolo, bullets, keywords, ecc.)
  const attrsDE = await getProductListingDE(productId);
  const hasDE = Object.keys(attrsDE).some(k => attrsDE[k] && attrsDE[k].length > 0);

  if (hasDE) {
    // 2. Inietta le immagini dalla tabella IT (sono identiche per tutti i mercati)
    const sections = await getProductListing(productId, product);
    for (const items of Object.values(sections)) {
      for (const item of items) {
        if (item.nome && item.nome.startsWith('Immagine') && item.value) {
          attrsDE[item.nome] = item.value;
        }
      }
    }
    return attrsDE;
  }

  // 3. Fallback: usa il listing italiano completo (prodotti non ancora tradotti)
  console.warn(`[exportDE] Prodotto #${productId} — nessun listing DE trovato, uso fallback IT`);
  const sections = await getProductListing(productId, product);
  const attrsIT = {};
  for (const items of Object.values(sections)) {
    for (const item of items) {
      if (item.value !== undefined && item.value !== '') {
        attrsIT[item.nome] = item.value;
      }
    }
  }
  return attrsIT;
}

// ─── Funzione: export singolo prodotto → DE ───────────────────────────────────
async function exportProductToXlsmDE(productId) {
  const productResult = await query('SELECT * FROM products WHERE id = $1', [productId]);
  const product = productResult.rows[0];
  if (!product) throw new Error(`Prodotto #${productId} non trovato`);

  const attrs = await loadAttrsDE(productId, product);

  let wb;
  try {
    wb = xlsx.readFile(TEMPLATE_PATH);
  } catch {
    throw new Error('Template WALL_ART_DE.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Vorlage'];
  if (!sheet) throw new Error('Foglio "Vorlage" non trovato nel template DE');

  clearDataRows(sheet);

  const rows = [];
  const hasVariants = !!(product.sku_max || product.sku_padre);

  if (hasVariants) {
    const parentDims = extractDimensions(product.misura_max || product.misura_media || product.misura_mini || '');
    const parentPeso = lookupWeight(product.misura_max || product.misura_media || product.misura_mini || '');
    rows.push({
      sku: product.sku_padre || product.titolo_opera?.substring(0, 40) || `SKU-${productId}`,
      asin: product.asin_padre || null,
      taglia: null, dims: parentDims, peso: parentPeso, prezzo: null, immagine: null, isParent: true,
    });

    const childVariants = [
      { sku: product.sku_max,   asin: product.asin_max,   misura: product.misura_max,   prezzo: product.prezzo_max,   immagine: product.immagine_max,   immagine2: product.immagine_max_2,   immagine3: product.immagine_max_3,   immagine4: product.immagine_max_4 },
      { sku: product.sku_media, asin: product.asin_media, misura: product.misura_media, prezzo: product.prezzo_media, immagine: product.immagine_media, immagine2: product.immagine_media_2, immagine3: product.immagine_media_3, immagine4: product.immagine_media_4 },
      { sku: product.sku_mini,  asin: product.asin_mini,  misura: product.misura_mini,  prezzo: product.prezzo_mini,  immagine: product.immagine_mini,  immagine2: product.immagine_mini_2,  immagine3: product.immagine_mini_3,  immagine4: product.immagine_mini_4 },
    ].filter(v => v.sku && v.misura);

    for (const cv of childVariants) {
      const dims = extractDimensions(cv.misura);
      const peso = lookupWeight(cv.misura);
      const taglia = dims ? `${dims.lunghezza} x ${dims.larghezza} cm` : cv.misura;
      rows.push({ sku: cv.sku, asin: cv.asin || null, taglia, dims, peso, prezzo: cv.prezzo, immagine: cv.immagine, immagine2: cv.immagine2, immagine3: cv.immagine3, immagine4: cv.immagine4, isParent: false });
    }
  } else {
    const dims = extractDimensions(product.dimensioni || product.descrizione_raw || '');
    const peso = lookupWeight(product.dimensioni || product.descrizione_raw || '');
    rows.push({
      sku: product.titolo_opera?.substring(0, 40) || `PROD-${productId}`,
      asin: product.asin_max || product.asin_padre || null,
      taglia: null, dims, peso, prezzo: product.prezzo, immagine: null, isParent: false,
    });
  }

  rows.forEach((variant, i) => {
    buildRowDE(sheet, DATA_START_ROW + i, product, attrs, variant);
  });

  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, DATA_START_ROW + rows.length - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });
  const skuLabel = product.sku_padre || `prodotto-${productId}`;
  const filename = `WALL_ART_DE_${skuLabel.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsm`;

  return { buffer, filename };
}

// ─── Funzione: export tutti/selezionati prodotti → DE ────────────────────────
async function exportAllProductsToXlsmDE(productIds = null) {
  let result;
  if (productIds && productIds.length > 0) {
    result = await query(
      `SELECT p.* FROM products p WHERE p.id = ANY($1) ORDER BY p.id ASC`,
      [productIds]
    );
  } else {
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

  let wb;
  try {
    wb = xlsx.readFile(TEMPLATE_PATH);
  } catch {
    throw new Error('Template WALL_ART_DE.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Vorlage'];
  if (!sheet) throw new Error('Foglio "Vorlage" non trovato nel template DE');

  clearDataRows(sheet);

  let currentRow = DATA_START_ROW;

  for (const product of products) {
    const attrs = await loadAttrsDE(product.id, product);

    const rows = [];
    const hasVariants = !!(product.sku_max || product.sku_padre);

    if (hasVariants) {
      const parentDims = extractDimensions(product.misura_max || product.misura_media || product.misura_mini || '');
      const parentPeso = lookupWeight(product.misura_max || product.misura_media || product.misura_mini || '');
      rows.push({
        sku: product.sku_padre || product.titolo_opera?.substring(0, 40) || `SKU-${product.id}`,
        asin: product.asin_padre || null,
        taglia: null, dims: parentDims, peso: parentPeso, prezzo: null, immagine: null, isParent: true,
      });

      const childVariants = [
        { sku: product.sku_max,   asin: product.asin_max,   misura: product.misura_max,   prezzo: product.prezzo_max,   immagine: product.immagine_max,   immagine2: product.immagine_max_2,   immagine3: product.immagine_max_3,   immagine4: product.immagine_max_4 },
        { sku: product.sku_media, asin: product.asin_media, misura: product.misura_media, prezzo: product.prezzo_media, immagine: product.immagine_media, immagine2: product.immagine_media_2, immagine3: product.immagine_media_3, immagine4: product.immagine_media_4 },
        { sku: product.sku_mini,  asin: product.asin_mini,  misura: product.misura_mini,  prezzo: product.prezzo_mini,  immagine: product.immagine_mini,  immagine2: product.immagine_mini_2,  immagine3: product.immagine_mini_3,  immagine4: product.immagine_mini_4 },
      ].filter(v => v.sku && v.misura);

      for (const cv of childVariants) {
        const dims = extractDimensions(cv.misura);
        const peso = lookupWeight(cv.misura);
        const taglia = dims ? `${dims.lunghezza} x ${dims.larghezza} cm` : cv.misura;
        rows.push({ sku: cv.sku, asin: cv.asin || null, taglia, dims, peso, prezzo: cv.prezzo, immagine: cv.immagine, immagine2: cv.immagine2, immagine3: cv.immagine3, immagine4: cv.immagine4, isParent: false });
      }
    } else {
      const dims = extractDimensions(product.dimensioni || product.descrizione_raw || '');
      const peso = lookupWeight(product.dimensioni || product.descrizione_raw || '');
      rows.push({
        sku: product.titolo_opera?.substring(0, 40) || `PROD-${product.id}`,
        taglia: null, dims, peso, prezzo: product.prezzo, immagine: null, isParent: false,
      });
    }

    rows.forEach((variant, i) => {
      buildRowDE(sheet, currentRow + i, product, attrs, variant);
    });
    currentRow += rows.length;
  }

  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, currentRow - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `WALL_ART_DE_ALL_${today}.xlsm`;

  return { buffer, filename, count: products.length };
}

module.exports = { exportProductToXlsmDE, exportAllProductsToXlsmDE };
