/**
 * Export Service FR — Compila il template WALL_ART_FR.xlsm con i dati del prodotto
 * e ritorna un buffer pronto per il download su Amazon.fr.
 *
 * Struttura righe output:
 *   Row 6 (DATA_START_ROW)     → Parent SKU
 *   Row 7                      → Child variante Grande (misura_max)
 *   Row 8                      → Child variante Media  (misura_media) — se presente
 *   Row 9                      → Child variante Mini   (misura_mini)  — se presente
 *
 * Differenze rispetto al template IT:
 *   - DATA_START_ROW = 6 (IT: 7) — il template FR ha una riga di intestazione in meno
 *   - Valori in francese: Oui/Non, Neuf, Parent/Enfant, Centimètres, Kilogrammes, Unité
 *   - Sezione offerta spostata di +2 colonne (cols 191+ vs 189+ IT)
 *   - Prezzo Amazon = prezzo DB + €20 (IT: +€10)
 *   - marketplace_id = A13V1IB3VIYZZH (FR)
 *
 * Categoria: Cuisine et Maison > Tableaux, posters et arts décoratifs > Tableaux > Impressions sur toile
 */
const xlsx = require('xlsx');
const path = require('path');
const { query } = require('../database/db');
const { getProductListing, getProductListingFR, extractDimensions } = require('./attributeService');

const TEMPLATE_PATH = path.join(__dirname, '../WALL_ART_FR.xlsm');
const DATA_START_ROW = 6; // indice 0-based — il template FR ha 6 righe header (vs 7 del template IT)

// ─── Browse node Francia — Impressions sur toile ─────────────────────────────
// Cuisine et Maison > Tableaux, posters et arts décoratifs > Tableaux > Impressions sur toile
// Nota: verificare il nodo corretto in Seller Central FR se necessario
const BROWSE_NODE_FR = '69052031'; // Tableaux/Impressions sur toile — amazon.fr

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

// ─── Mapping: nome_attributo DB (italiano) → colonna XLSM francese ───────────
// Le colonne 0–187 sono IDENTICHE al template italiano.
// La sezione offerta (189+) è spostata di +2 colonne nel template francese.
const ATTR_COL_FR = {
  // ── Identità listing / Informazioni generali ──────────────────────────────
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
  // ── Informazioni dettagliate prodotto ─────────────────────────────────────
  "Descrizione del prodotto":                                   37,
  "Punto elenco 1":                                             38,
  "Punto elenco 2":                                             39,
  "Punto elenco 3":                                             40,
  "Punto elenco 4":                                             41,
  "Punto elenco 5":                                             42,
  // "Chiavi di ricerca" → splittata su 5 colonne (43-47) da splitKeywordsTo5Slots()
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
  // ── Colonne spostate di +1 rispetto a IT (185-190) ───────────────────────
  "Numero di confezioni":                                       188, // IT: 187
  // ── Offerta — colonne spostate di +2 rispetto a IT ───────────────────────
  "Prezzo al pubblico consigliato (IVA inclusa)":               194, // IT: 192
  "Codice fiscale del prodotto":                                195, // IT: 193
  "L'offerta può essere inviata tramite messaggio regalo":       198, // IT: 196
  "È disponibile in confezione regalo":                         199, // IT: 197
  "Prezzo minimo pubblicizzato":                                224, // IT: 222
  // ── Logistica — colonne spostate di +2 rispetto a IT ─────────────────────
  "Altezza imballaggio":                                        236, // IT: 234
  "Peso imballaggio":                                           238, // IT: 236
  // ── Sicurezza / Conformità — colonne spostate di +2 ─────────────────────
  "Paese/Regione di origine":                                   276, // IT: 274
  "Questo prodotto è soggetto a restrizioni di età per l'acquirente?": 300, // IT: 298
  "E-mail o indirizzo elettronico della persona responsabile":  301, // IT: 299
  "Attestazione di sicurezza GPSR":                             321, // IT: 319
  "E-mail o indirizzo elettronico del produttore":              322, // IT: 320
  "Prodotto OEM originale":                                     334, // IT: 332
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

// ─── Split keyword su 5 slot (cols 43-47, max 250 byte UTF-8 ciascuno) ────────
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

// ─── Costruzione riga dati (FR) ───────────────────────────────────────────────
function buildRowFR(sheet, rowIdx, product, attrs, variant) {
  const { isParent, sku, taglia, dims, peso, prezzo, immagine, immagine2, immagine3, immagine4, asin } = variant;

  // ── Colonne strutturali ──────────────────────────────────────────────────
  setCellValue(sheet, 0, rowIdx, sku || '');
  setCellValue(sheet, 1, rowIdx, 'WALL_ART');
  // Col 2 (action listing) → vuota = default "Créer ou remplacer"

  // ID prodotto: ASIN se disponibile, altrimenti Esenzione GTIN
  if (asin) {
    setCellValue(sheet, 8, rowIdx, 'ASIN');
    setCellValue(sheet, 9, rowIdx, asin);
  } else {
    setCellValue(sheet, 8, rowIdx, 'Esenzione GTIN'); // campo comune EU
  }

  // Browse node FR — Impressions sur toile
  setCellValue(sheet, 10, rowIdx, BROWSE_NODE_FR);
  // Livello di aggregazione = Unité (singolo pezzo)
  setCellValue(sheet, 15, rowIdx, 'Unité');
  // Batterie non necessarie
  setCellValue(sheet, 277, rowIdx, 'Non');
  setCellValue(sheet, 278, rowIdx, 'Non');

  if (isParent) {
    setCellValue(sheet, 3, rowIdx, 'Parent');
    setCellValue(sheet, 5, rowIdx, 'SIZE/ORIENTATION');
    setCellValue(sheet, 191, rowIdx, 'Oui'); // skip_offer: parent non acquistabile (FR: col 191 vs IT: 189)
  } else {
    setCellValue(sheet, 3, rowIdx, 'Enfant');
    setCellValue(sheet, 4, rowIdx, product.sku_padre || '');
    setCellValue(sheet, 5, rowIdx, 'SIZE/ORIENTATION');
    setCellValue(sheet, 66, rowIdx, taglia || '');
    // Condizione articolo
    setCellValue(sheet, 192, rowIdx, 'Nouveau');           // IT: 190 — valore corretto FR: "Nouveau" (non "Neuf")
    // Offerta
    setCellValue(sheet, 217, rowIdx, 'DEFAULT');           // canale gestione FBM (FR: col 217 vs IT: 215)
    setCellValue(sheet, 218, rowIdx, 100);                 // quantità (FR: 218 vs IT: 216)
    setCellValue(sheet, 219, rowIdx, 7);                   // tempo di gestione 7 giorni (FR: 219 vs IT: 217)
    if (prezzo) setCellValue(sheet, 222, rowIdx, Number(prezzo) + 20); // prezzo vendita FR = prezzo DB + €20
    if (prezzo) setCellValue(sheet, 194, rowIdx, Number(prezzo) + 60); // Prix catalogue TTC = prezzo vendita + €40 (= prezzo DB + €60)
    setCellValue(sheet, 231, rowIdx, 'studio');            // gruppo spedizione (FR: 231 vs IT: 229)
  }

  // ── Attributi DB → colonne FR ─────────────────────────────────────────────
  const INVALID_VALUES = new Set(['N/D', 'n/d']);
  for (const [nome, col] of Object.entries(ATTR_COL_FR)) {
    const val = attrs[nome];
    if (val === undefined || val === '') continue;
    if (INVALID_VALUES.has(String(val).trim())) continue;
    if (nome === 'Prezzo al pubblico consigliato (IVA inclusa)' && (val === '0' || val === 0 || val === '' || !val)) continue;
    setCellValue(sheet, col, rowIdx, val);
  }

  // ── Chiavi di ricerca → 5 slot (cols 43-47) ──────────────────────────────
  const kwSlots = splitKeywordsTo5Slots(attrs['Chiavi di ricerca'] || '');
  kwSlots.forEach((slot, i) => {
    setCellValue(sheet, 43 + i, rowIdx, slot);
  });

  // ── Defaults fissi Amazon.fr — obbligatori per "Impressions sur toile" ────
  // Valori validati dal foglio "Valeurs valides" del template WALL_ART_FR.xlsm.
  // Sovrascrivono eventuali valori italiani dal DB. Fissi per parent + child.
  // ── Brand & Manufacturer — fissi per tutti i prodotti ────────────────────
  setCellValue(sheet, 7,   rowIdx, 'SivigliArt');               // Marque (Brand) — col H
  setCellValue(sheet, 20,  rowIdx, 'SivigliArt');               // Fabricant (Manufacturer) — col U

  // ── Orientation — calcolata dalle dimensioni (Portrait / Paysage) ─────────
  if (dims && dims.lunghezza && dims.larghezza) {
    const orient = Number(dims.lunghezza) > Number(dims.larghezza) ? 'Paysage' : 'Portrait';
    setCellValue(sheet, 123, rowIdx, orient);                   // Orientation — col DT
  }

  setCellValue(sheet, 87,  rowIdx, 'Tissu');                    // Document papier — "Tissu" = tessuto/canvas (valori: Tissu, Papier cartonné, Papier photo brillant, Papier (ordinaire)...)
  setCellValue(sheet, 105, rowIdx, 'Non');                      // Personnalisable ? (Oui / Non)
  setCellValue(sheet, 147, rowIdx, 'Non');                      // Article fragile ? (Oui / Non)
  setCellValue(sheet, 161, rowIdx, 'Non');                      // Est encadré — canvas su telaio, non cornice (Oui / Non)
  setCellValue(sheet, 177, rowIdx, 'Intérieur');                // Utilisation extérieure ou intérieure (Extérieure / Intérieur)
  setCellValue(sheet, 184, rowIdx, 'Reproduction d\'art');      // Forme d'art mural (Affiche, Décoration murale, Peinture, Reproduction d'art, Tapisserie...)
  setCellValue(sheet, 192, rowIdx, 'Nouveau');                  // État de l'article — "Nouveau" è il valore corretto FR (non "Neuf")
  setCellValue(sheet, 198, rowIdx, 'Non');                      // Message cadeau disponible (Oui / Non)
  setCellValue(sheet, 199, rowIdx, 'Non');                      // Emballage cadeau disponible ? (Oui / Non)
  setCellValue(sheet, 276, rowIdx, 'Italie');                   // Pays d'origine — nome completo in francese (non "IT")
  setCellValue(sheet, 300, rowIdx, 'Non');                      // Restrictions d'âge acheteurs (Oui / Non)
  setCellValue(sheet, 301, rowIdx, 'sivigliart@outlook.it');    // Adresse personne responsable (GPSR)
  setCellValue(sheet, 321, rowIdx, 'Oui');                      // Attestation sécurité GPSR (Oui / Non)
  setCellValue(sheet, 322, rowIdx, 'sivigliart@outlook.it');    // E-mail produttore (GPSR)
  setCellValue(sheet, 334, rowIdx, 'Non');                      // Est un produit d'origine équipementier (Oui / Non)
  // ─────────────────────────────────────────────────────────────────────────

  // ── Dimensioni variante ──────────────────────────────────────────────────
  if (dims) {
    // Dimensioni articolo (stesse posizioni del template IT)
    setCellValue(sheet, 180, rowIdx, Number(dims.lunghezza));
    setCellValue(sheet, 181, rowIdx, 'Centimètres');           // IT: 'Centimetri'
    setCellValue(sheet, 182, rowIdx, Number(dims.larghezza));
    setCellValue(sheet, 183, rowIdx, 'Centimètres');
    // Imballaggio — lunghezza e larghezza (FR: 232/233 e 234/235 vs IT: 230/231 e 232/233)
    setCellValue(sheet, 232, rowIdx, Number(dims.lunghezza));
    setCellValue(sheet, 233, rowIdx, 'Centimètres');
    setCellValue(sheet, 234, rowIdx, Number(dims.larghezza));
    setCellValue(sheet, 235, rowIdx, 'Centimètres');
    // Altezza imballaggio: fissa 3 cm (FR: 236/237 vs IT: 234/235)
    setCellValue(sheet, 236, rowIdx, 3);
    setCellValue(sheet, 237, rowIdx, 'Centimètres');
  }

  // ── Peso variante ────────────────────────────────────────────────────────
  if (peso !== null && peso !== undefined) {
    // Peso articolo (FR: 298/299 vs IT: 296/297)
    setCellValue(sheet, 298, rowIdx, Number(peso));
    setCellValue(sheet, 299, rowIdx, 'Kilogrammes');           // IT: 'Chilogrammi'
    // Peso imballaggio = peso + 0.3 kg (FR: 238/239 vs IT: 236/237)
    setCellValue(sheet, 238, rowIdx, Math.round((Number(peso) + 0.3) * 10) / 10);
    setCellValue(sheet, 239, rowIdx, 'Kilogrammes');
  }

  // ── Immagini variante child ───────────────────────────────────────────────
  // Stessa logica del template IT — le posizioni immagine 21-29 sono identiche
  if (!isParent) {
    for (let c = 21; c <= 29; c++) setCellValue(sheet, c, rowIdx, '');
    const mainImgChild = attrs['Immagine principale'] || immagine || immagine2 || null;
    if (mainImgChild) setCellValue(sheet, 21, rowIdx, mainImgChild);
    if (immagine4)    setCellValue(sheet, 22, rowIdx, immagine4);
    if (immagine3)    setCellValue(sheet, 23, rowIdx, immagine3);
    const det1 = attrs['Immagine 2'] || product.dettaglio_1 || '';
    const det2 = attrs['Immagine 3'] || product.dettaglio_2 || '';
    const det3 = attrs['Immagine 4'] || product.dettaglio_3 || '';
    if (det1) setCellValue(sheet, 24, rowIdx, det1);
    if (det2) setCellValue(sheet, 25, rowIdx, det2);
    if (det3) setCellValue(sheet, 26, rowIdx, det3);
    if (attrs['Immagine 5']) setCellValue(sheet, 27, rowIdx, attrs['Immagine 5']);
    if (attrs['Immagine 6']) setCellValue(sheet, 28, rowIdx, attrs['Immagine 6']);
    if (attrs['Immagine 7']) setCellValue(sheet, 29, rowIdx, attrs['Immagine 7']);
  }

  // ── Fallback immagini parent ──────────────────────────────────────────────
  if (isParent) {
    if (!attrs['Immagine principale'] && product.immagine_max)
      setCellValue(sheet, 21, rowIdx, product.immagine_max);
    if (!attrs['Immagine 2'] && product.dettaglio_1)
      setCellValue(sheet, 22, rowIdx, product.dettaglio_1);
    if (!attrs['Immagine 3'] && product.dettaglio_2)
      setCellValue(sheet, 23, rowIdx, product.dettaglio_2);
    if (!attrs['Immagine 4'] && product.dettaglio_3)
      setCellValue(sheet, 24, rowIdx, product.dettaglio_3);
  }
}

// ─── Helper: carica attributi FR con fallback a IT ────────────────────────────
async function loadAttrsFR(productId, product) {
  // 1. Carica listing francese (testo AI: titolo, bullets, keywords, ecc.)
  const attrsFR = await getProductListingFR(productId);
  const hasFR = Object.keys(attrsFR).some(k => attrsFR[k] && attrsFR[k].length > 0);

  if (hasFR) {
    // 2. Inietta le immagini dalla tabella IT (sono identiche per tutti i mercati)
    //    La tabella FR contiene solo contenuto testuale AI, non le immagini.
    const sections = await getProductListing(productId, product);
    for (const items of Object.values(sections)) {
      for (const item of items) {
        if (item.nome && item.nome.startsWith('Immagine') && item.value) {
          attrsFR[item.nome] = item.value; // es. "Immagine principale" → cura_principale.jpg
        }
      }
    }
    return attrsFR;
  }

  // 3. Fallback: usa il listing italiano completo (prodotti non ancora tradotti)
  console.warn(`[exportFR] Prodotto #${productId} — nessun listing FR trovato, uso fallback IT`);
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

// ─── Funzione: export singolo prodotto → FR ───────────────────────────────────
async function exportProductToXlsmFR(productId) {
  const productResult = await query('SELECT * FROM products WHERE id = $1', [productId]);
  const product = productResult.rows[0];
  if (!product) throw new Error(`Prodotto #${productId} non trovato`);

  const attrs = await loadAttrsFR(productId, product);

  let wb;
  try {
    wb = xlsx.readFile(TEMPLATE_PATH);
  } catch {
    throw new Error('Template WALL_ART_FR.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Modèle'];
  if (!sheet) throw new Error('Foglio "Modèle" non trovato nel template FR');

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
    buildRowFR(sheet, DATA_START_ROW + i, product, attrs, variant);
  });

  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, DATA_START_ROW + rows.length - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });
  const skuLabel = product.sku_padre || `prodotto-${productId}`;
  const filename = `WALL_ART_FR_${skuLabel.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsm`;

  return { buffer, filename };
}

// ─── Funzione: export tutti/selezionati prodotti → FR ────────────────────────
async function exportAllProductsToXlsmFR(productIds = null) {
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
    throw new Error('Template WALL_ART_FR.xlsm non trovato nella root del progetto');
  }
  const sheet = wb.Sheets['Modèle'];
  if (!sheet) throw new Error('Foglio "Modèle" non trovato nel template FR');

  clearDataRows(sheet);

  let currentRow = DATA_START_ROW;

  for (const product of products) {
    const attrs = await loadAttrsFR(product.id, product);

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
      buildRowFR(sheet, currentRow + i, product, attrs, variant);
    });
    currentRow += rows.length;
  }

  const currentRange = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  currentRange.e.r = Math.max(currentRange.e.r, currentRow - 1);
  sheet['!ref'] = xlsx.utils.encode_range(currentRange);

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsm' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `WALL_ART_FR_ALL_${today}.xlsm`;

  return { buffer, filename, count: products.length };
}

module.exports = { exportProductToXlsmFR, exportAllProductsToXlsmFR };
