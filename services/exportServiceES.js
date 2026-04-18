/**
 * Export Service ES — Compila il template WALL_ART_ES.xlsm con i dati del prodotto
 * e ritorna un buffer pronto per il download su Amazon.es.
 *
 * Struttura righe output:
 *   Row 5 (DATA_START_ROW)     → Parent SKU
 *   Row 6                      → Child variante Grande (misura_max)
 *   Row 7                      → Child variante Media  (misura_media) — se presente
 *   Row 8                      → Child variante Mini   (misura_mini)  — se presente
 *
 * Differenze rispetto ai template IT/FR/DE:
 *   - DATA_START_ROW = 5 (IT: 7, FR: 6, DE: 5) — il template ES ha 5 righe di intestazione
 *   - Foglio "Plantilla" (IT: "Modello", FR: "Modèle", DE: "Vorlage")
 *   - Valori in spagnolo: Principal./Niños, Sí/No, Nuevo, Unidad, Centímetros, Kilogramos
 *   - 295 colonne totali; sezione "Oferta" dalla col 147, "Oferta (Vender en Amazon)" dalla col 173
 *   - Immagine principale a col 21 (come IT/FR, a differenza di DE col 20)
 *   - Prezzo Amazon = prezzo DB + €20
 *   - marketplace_id = A1RKKUPIHCS9HS (ES)
 *
 * Categoria: Hogar y cocina > Obras de arte y material decorativo > Pósteres y grabados
 */
const xlsx = require('xlsx');
const path = require('path');
const { query } = require('../database/db');
const { getProductListing, getProductListingES, extractDimensions } = require('./attributeService');
const { translateEnumValue } = require('./enumTranslations');

const TEMPLATE_PATH = path.join(__dirname, '../WALL_ART_ES.xlsm');
const DATA_START_ROW = 5; // indice 0-based — il template ES ha 5 righe header

// ─── Browse node Spagna — Pósteres y grabados ────────────────────────────────
// Hogar y cocina > Obras de arte y material decorativo > Pósteres y grabados
const BROWSE_NODE_ES = '14304083031';

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

// ─── Mapping: nome_attributo DB (italiano) → colonna XLSM spagnola ───────────
// Colonne verificate dal foglio "Plantilla" del template WALL_ART_ES.xlsm.
// Rispetto a DE, la maggior parte delle colonne è shiftata di +1 nella prima metà
// (perché DE aveva "Immagine principale" a col 20, ES a col 21); il blocco Oferta
// si riallinea a partire da col 173 (channel_code).
const ATTR_COL_ES = {
  // ── Identità listing / Informazioni generali ──────────────────────────────
  "Nome dell'articolo":                                         6,
  "Nome del marchio":                                           7,
  "Nome del modello":                                           18,
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
  "Prezzo minimo pubblicizzato":                                179,
  // ── Logistica ─────────────────────────────────────────────────────────────
  "Altezza imballaggio":                                        191,
  "Peso imballaggio":                                           193,
  // ── Sicurezza / Conformità ────────────────────────────────────────────────
  "Paese/Regione di origine":                                   231,
  "Questo prodotto è soggetto a restrizioni di età per l'acquirente?": 255,
  "E-mail o indirizzo elettronico della persona responsabile":  256,
  "Attestazione di sicurezza GPSR":                             276,
  "E-mail o indirizzo elettronico del produttore":              277,
  "Prodotto OEM originale":                                     289,
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

// ─── Costruzione riga dati (ES) ───────────────────────────────────────────────
function buildRowES(sheet, rowIdx, product, attrs, variant) {
  const { isParent, sku, taglia, dims, peso, prezzo, immagine, immagine2, immagine3, immagine4, asin } = variant;

  // ── Colonne strutturali ──────────────────────────────────────────────────
  setCellValue(sheet, 0, rowIdx, sku || '');
  setCellValue(sheet, 1, rowIdx, 'WALL_ART');
  // Col 2 (Acción de listing) → vuota = default "Crear o reemplazar"

  // ID prodotto: ASIN se disponibile, altrimenti Exención de GTIN
  if (asin) {
    setCellValue(sheet, 8, rowIdx, 'ASIN');
    setCellValue(sheet, 9, rowIdx, asin);
  } else {
    setCellValue(sheet, 8, rowIdx, 'Exención de GTIN');
  }

  // Browse node ES — Pósteres y grabados (col 10 = K)
  setCellValue(sheet, 10, rowIdx, BROWSE_NODE_ES);
  // Nivel de paquete = Unidad (singolo pezzo, col 15 = P)
  setCellValue(sheet, 15, rowIdx, 'Unidad');
  // Baterías no necesarias (col 232 HY, 233 HZ)
  setCellValue(sheet, 232, rowIdx, 'No');
  setCellValue(sheet, 233, rowIdx, 'No');

  if (isParent) {
    setCellValue(sheet, 3, rowIdx, 'Principal.');                // Nivel de relación (col D) — valore esatto da Valores válidos (con punto)
    setCellValue(sheet, 5, rowIdx, 'SIZE/ORIENTATION');           // Nombre del tema de variación (col F)
    setCellValue(sheet, 146, rowIdx, 'Sí');                       // Saltar oferta (col EQ): parent non acquistabile
  } else {
    setCellValue(sheet, 3, rowIdx, 'Niños');                      // Nivel de relación (col D) — valore esatto da Valores válidos
    setCellValue(sheet, 4, rowIdx, product.sku_padre || '');      // SKU principal
    setCellValue(sheet, 5, rowIdx, 'SIZE/ORIENTATION');
    setCellValue(sheet, 62, rowIdx, taglia || '');                // Tamaño (col BK)
    // Estado del producto
    setCellValue(sheet, 147, rowIdx, 'Nuevo');                    // Estado del producto (col ER)
    // Oferta (ES) - Vender en Amazon
    setCellValue(sheet, 172, rowIdx, 'DEFAULT');                  // fulfillment_channel_code (col FQ)
    setCellValue(sheet, 173, rowIdx, 100);                        // Cantidad (col FR)
    setCellValue(sheet, 174, rowIdx, 7);                          // Tiempo de tramitación 7 giorni (col FS)
    if (prezzo) setCellValue(sheet, 177, rowIdx, Number(prezzo) + 20);  // Tu precio EUR (col FV) = prezzo DB + €20
    if (prezzo) setCellValue(sheet, 149, rowIdx, Number(prezzo) + 60);  // Precio de venta recomendado PVPR (col ET) = prezzo vendita + €40
    setCellValue(sheet, 186, rowIdx, 'studio');                   // Plantilla de envío (col GE)
  }

  // ── Attributi DB → colonne ES ─────────────────────────────────────────────
  const INVALID_VALUES = new Set(['N/D', 'n/d']);
  for (const [nome, col] of Object.entries(ATTR_COL_ES)) {
    let val = attrs[nome];
    if (val === undefined || val === '') continue;
    if (INVALID_VALUES.has(String(val).trim())) continue;
    if (nome === 'Prezzo al pubblico consigliato (IVA inclusa)' && (val === '0' || val === 0 || val === '' || !val)) continue;
    // Traduci i valori enum IT → ES (Colore, Tema, Tipo di stanza, Famiglia di
    // colori, Stagioni, Funzioni speciali, ecc.). Non-enum restano invariati.
    val = translateEnumValue(nome, val, 'es');
    if (!val || INVALID_VALUES.has(String(val).trim())) continue;
    setCellValue(sheet, col, rowIdx, val);
  }

  // ── Chiavi di ricerca → 5 slot (cols 42-46) ──────────────────────────────
  const kwSlots = splitKeywordsTo5Slots(attrs['Chiavi di ricerca'] || '');
  kwSlots.forEach((slot, i) => {
    setCellValue(sheet, 42 + i, rowIdx, slot);
  });

  // ── Defaults fissi Amazon.es — obbligatori per "Pósteres y grabados" ──────
  // Valori validati dal foglio "Valores válidos" del template WALL_ART_ES.xlsm.
  // Sovrascrivono eventuali valori italiani dal DB. Fissi per parent + child.
  // ── Brand & Manufacturer — fissi per tutti i prodotti ────────────────────
  setCellValue(sheet, 7,   rowIdx, 'SivigliArt');               // Marca (Brand) — col H
  setCellValue(sheet, 19,  rowIdx, 'SivigliArt');               // Fabricante (Manufacturer) — col T

  // ── Orientación — calcolata dalle dimensioni (Paisaje / Retrato / Redondo) ─
  if (dims && dims.lunghezza && dims.larghezza) {
    const orient = Number(dims.lunghezza) > Number(dims.larghezza)
      ? 'Paisaje'
      : Number(dims.lunghezza) < Number(dims.larghezza)
        ? 'Retrato'
        : 'Redondo';
    setCellValue(sheet, 94, rowIdx, orient);                    // Orientación (col CP)
  }

  setCellValue(sheet, 75,  rowIdx, 'Tela');                     // Papel Impresión — "Tela" = canvas/tessuto
  setCellValue(sheet, 92,  rowIdx, 'No');                       // ¿Es personalizable? (Sí / No)
  setCellValue(sheet, 114, rowIdx, 'No');                       // ¿Es frágil? (Sí / No)
  setCellValue(sheet, 121, rowIdx, 'No');                       // ¿Está enmarcado? — canvas su telaio, non cornice (Sí / No)
  setCellValue(sheet, 132, rowIdx, 'Interior');                 // Uso interior y exterior
  setCellValue(sheet, 139, rowIdx, 'Impresión de Arte');        // Forma de arte mural (Valores válidos ES)
  setCellValue(sheet, 147, rowIdx, 'Nuevo');                    // Estado del producto
  setCellValue(sheet, 153, rowIdx, 'No');                       // La oferta puede ser un mensaje de regalo (Sí / No)
  setCellValue(sheet, 154, rowIdx, 'No');                       // ¿Está disponible el papel de regalo? (Sí / No)
  setCellValue(sheet, 231, rowIdx, 'Italia');                   // País de origen — nome in spagnolo
  setCellValue(sheet, 255, rowIdx, 'No');                       // Restricciones de edad (Sí / No)
  setCellValue(sheet, 256, rowIdx, 'sivigliart@outlook.it');    // E-mail persona responsable (DSA)
  setCellValue(sheet, 276, rowIdx, 'Sí');                       // Certificación de seguridad GPSR (Sí / No)
  setCellValue(sheet, 277, rowIdx, 'sivigliart@outlook.it');    // E-mail del fabricante (GPSR)
  setCellValue(sheet, 289, rowIdx, 'No');                       // ¿Es producto de fuente OEM? (Sí / No)
  // ─────────────────────────────────────────────────────────────────────────

  // ── Dimensioni variante ──────────────────────────────────────────────────
  if (dims) {
    // Dimensioni articolo (col 135-138 = EF-EI)
    setCellValue(sheet, 135, rowIdx, Number(dims.lunghezza));
    setCellValue(sheet, 136, rowIdx, 'Centímetros');
    setCellValue(sheet, 137, rowIdx, Number(dims.larghezza));
    setCellValue(sheet, 138, rowIdx, 'Centímetros');
    // Imballaggio — lunghezza e larghezza (col 187-190 = GF-GI)
    setCellValue(sheet, 187, rowIdx, Number(dims.lunghezza));
    setCellValue(sheet, 188, rowIdx, 'Centímetros');
    setCellValue(sheet, 189, rowIdx, Number(dims.larghezza));
    setCellValue(sheet, 190, rowIdx, 'Centímetros');
    // Altura paquete: fissa 3 cm (col 191-192 = GJ-GK)
    setCellValue(sheet, 191, rowIdx, 3);
    setCellValue(sheet, 192, rowIdx, 'Centímetros');
  }

  // ── Peso variante ────────────────────────────────────────────────────────
  if (peso !== null && peso !== undefined) {
    // Peso artículo (col 253-254 = IT-IU)
    setCellValue(sheet, 253, rowIdx, Number(peso));
    setCellValue(sheet, 254, rowIdx, 'Kilogramos');
    // Peso paquete = peso + 0.3 kg (col 193-194 = GL-GM)
    setCellValue(sheet, 193, rowIdx, Math.round((Number(peso) + 0.3) * 10) / 10);
    setCellValue(sheet, 194, rowIdx, 'Kilogramos');
  }

  // ── Immagini variante child ───────────────────────────────────────────────
  // Nel template ES le immagini sono a col 20-28 (come DE, shift -1 rispetto al nome umano).
  // Attenzione: nel mapping ATTR_COL_ES "Immagine principale" è mappata a col 20
  // (che è l'indice 0-based della 21esima colonna → col U "URL de la imagen principal").
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

// ─── Helper: carica attributi ES con fallback a IT ────────────────────────────
async function loadAttrsES(productId, product) {
  // 1. Carica listing spagnolo (testo AI: titolo, bullets, keywords, ecc.)
  const attrsES = await getProductListingES(productId);
  const hasES = Object.keys(attrsES).some(k => attrsES[k] && attrsES[k].length > 0);

  if (hasES) {
    // 2. Inietta le immagini dalla tabella IT (sono identiche per tutti i mercati)
    const sections = await getProductListing(productId, product);
    for (const items of Object.values(sections)) {
      for (const item of items) {
        if (item.nome && item.nome.startsWith('Immagine') && item.value) {
          attrsES[item.nome] = item.value;
        }
      }
    }
    return attrsES;
  }

  // 3. Fallback: usa il listing italiano completo (prodotti non ancora tradotti)
  console.warn(`[exportES] Prodotto #${productId} — nessun listing ES trovato, uso fallback IT`);
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

// ─── Funzione: export singolo prodotto → ES ───────────────────────────────────
async function exportProductToXlsmES(productId) {
  const productResult = await query('SELECT * FROM products WHERE id = $1', [productId]);
  const product = productResult.rows[0];
  if (!product) throw new Error(`Prodotto #${productId} non trovato`);

  const attrs = await loadAttrsES(productId, product);

  let wb;
  try {
    wb = xlsx.readFile(TEMPLATE_PATH);
  } catch {
    throw new Error('Template WALL_ART_ES.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Plantilla'];
  if (!sheet) throw new Error('Foglio "Plantilla" non trovato nel template ES');

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
    buildRowES(sheet, DATA_START_ROW + i, product, attrs, variant);
  });

  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, DATA_START_ROW + rows.length - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });
  const skuLabel = product.sku_padre || `prodotto-${productId}`;
  const filename = `WALL_ART_ES_${skuLabel.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsm`;

  return { buffer, filename };
}

// ─── Funzione: export tutti/selezionati prodotti → ES ────────────────────────
async function exportAllProductsToXlsmES(productIds = null) {
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
    throw new Error('Template WALL_ART_ES.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Plantilla'];
  if (!sheet) throw new Error('Foglio "Plantilla" non trovato nel template ES');

  clearDataRows(sheet);

  let currentRow = DATA_START_ROW;

  for (const product of products) {
    const attrs = await loadAttrsES(product.id, product);

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
      buildRowES(sheet, currentRow + i, product, attrs, variant);
    });
    currentRow += rows.length;
  }

  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, currentRow - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `WALL_ART_ES_ALL_${today}.xlsm`;

  return { buffer, filename, count: products.length };
}

module.exports = { exportProductToXlsmES, exportAllProductsToXlsmES };
