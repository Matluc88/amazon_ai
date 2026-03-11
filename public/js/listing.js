/* =============================================
   AMAZON AI LISTING TOOL — Listing Dinamico
   Sistema attributi: AI | FIXED | AUTO | MANUAL
   ============================================= */

let productId = null;
let currentProduct = null;
let currentSections = null;           // { sezione: [attr, ...] }
let pendingChanges = {};              // { attribute_id: new_value }
let minedKeywords = [];
let currentTab = 'identità';          // tab attivo corrente
let variantsDirty = false;            // traccia modifiche varianti

// Limiti caratteri noti (Amazon Italy) — nomi allineati al seed
const CHAR_LIMITS = {
  // identità
  "Nome dell'articolo": 200,
  // descrizione
  'Descrizione del prodotto': 2000,
  'Punto elenco 1': 500, 'Punto elenco 2': 500,
  'Punto elenco 3': 500, 'Punto elenco 4': 500,
  'Punto elenco 5': 500,
  'Chiavi di ricerca': 1250,
  // backward compat per varianti seed precedenti
  'Nome articolo': 200,
  'Descrizione prodotto': 2000,
  'Chiavi ricerca': 250,
  'Chiavi ricerca 1': 250, 'Chiavi ricerca 2': 250,
  'Chiavi ricerca 3': 250,
};

// Campi per cui il contatore mostra BYTE UTF-8 invece di caratteri
// (Amazon conta i byte, non i caratteri — importante per le vocali accentate)
const BYTE_COUNTER_FIELDS = new Set([
  'Chiavi di ricerca', 'Chiavi ricerca', 'Chiavi ricerca 1',
  'Chiavi ricerca 2', 'Chiavi ricerca 3',
]);

/**
 * Calcola la dimensione in byte UTF-8 di una stringa
 */
function getByteLength(str) {
  return new TextEncoder().encode(str).length;
}

/**
 * Normalizza i Search Terms lato client (stessa logica di normalizeSearchTerms backend).
 * Usa regex Unicode /\p{L}/u con fallback per browser datati.
 */
function normalizeSearchTermsClient(str) {
  if (!str) return str;
  const CORE = ['quadro', 'stampa', 'tela', 'decorazione', 'parete'];

  let cleaned;
  try {
    // Unicode-safe (tutti i browser moderni supportano /\p{L}/u)
    cleaned = str.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  } catch (e) {
    // Fallback: regex classica con lettere accentate italiane
    cleaned = str.toLowerCase().replace(/[^a-zàèìòùáéíóúâêîôûäëïöü0-9\s]/g, ' ');
  }

  const words = cleaned.split(/\s+/).filter(w => w.length >= 2);
  const seen = new Set();
  const unique = words.filter(w => (seen.has(w) ? false : (seen.add(w), true)));

  const missingCore = CORE.filter(t => !seen.has(t));
  const joined = [...missingCore, ...unique].join(' ');

  // Trim a 1250 byte UTF-8 (5 slot × 250 byte — lo split avviene nell'export)
  const encoder = new TextEncoder();
  if (encoder.encode(joined).length <= 1250) return joined;
  let trimmed = joined;
  while (encoder.encode(trimmed).length > 1250) {
    trimmed = trimmed.slice(0, trimmed.length - 1);
  }
  return trimmed.trimEnd();
}

// Icone sezioni
const SECTION_ICONS = {
  'Titolo e Descrizione': '📝',
  'Bullet Points': '🔵',
  'Parole chiave': '🔍',
  'SEO': '🔍',
  'Immagini': '🖼️',
  'Prezzo': '💰',
  'Logistica': '📦',
  'Dettagli tecnici': '🔧',
  'Classificazione': '🏷️',
  'Informazioni aggiuntive': 'ℹ️',
};

function getSectionIcon(name) {
  for (const [key, icon] of Object.entries(SECTION_ICONS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return '📋';
}

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  productId = params.get('id');

  if (!productId) {
    showToast('ID prodotto non trovato nell\'URL', 'error');
    setTimeout(() => window.location.href = '/', 1500);
    return;
  }

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  loadListing();
});

// =============================================
// CARICAMENTO LISTING
// =============================================
async function loadListing() {
  try {
    const res = await fetch(`/api/listings/${productId}`);
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login.html'; return; }
      const data = await res.json();
      throw new Error(data.error || 'Listing non trovato');
    }
    const data = await res.json();
    currentProduct = data.product;
    currentSections = data.sections;

    renderProductInfo(currentProduct);
    renderSections(currentSections);
    updateProgress();
    checkIfEmpty();
    setTimeout(() => initTitleBadges(), 100);
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    setTimeout(() => window.location.href = '/', 2500);
  }
}

// =============================================
// PRODUCT INFO
// =============================================
function renderProductInfo(product) {
  // Update page title
  document.getElementById('pageTitle').textContent = `📄 ${product.titolo_opera || 'Listing'}`;
  document.getElementById('pageSubtitle').textContent =
    [product.autore, product.dimensioni, product.tecnica].filter(Boolean).join(' — ') || 'Stampa artistica su tela';
  document.title = `${product.titolo_opera || 'Listing'} — Amazon AI Tool`;

  const fields = [
    { k: 'Opera', v: product.titolo_opera },
    { k: 'Autore', v: product.autore },
    { k: 'Dimensioni', v: product.dimensioni },
    { k: 'Tecnica', v: product.tecnica },
    { k: 'Descrizione', v: product.descrizione_raw },
  ].filter(f => f.v);

  // Sezione varianti SKU
  let variantiHtml = '';
  if (product.sku_max || product.misura_max) {
    variantiHtml = `
      <div class="product-info-row" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-200);">
        <span class="info-key">🏷️ Varianti:</span>
        <span class="info-val">
          <table style="font-size:12px;border-collapse:collapse;width:100%;max-width:480px;">
            <thead>
              <tr style="color:var(--gray-500);">
                <th style="text-align:left;padding:3px 8px 3px 0;">Taglia</th>
                <th style="text-align:left;padding:3px 8px;">Misura</th>
                <th style="text-align:left;padding:3px 8px;">Prezzo</th>
                <th style="text-align:left;padding:3px 8px;">SKU variante</th>
              </tr>
            </thead>
            <tbody>
              ${product.misura_max ? `<tr>
                <td style="padding:3px 8px 3px 0;font-weight:600;">Grande</td>
                <td style="padding:3px 8px;">${escHtml(product.misura_max)}</td>
                <td style="padding:3px 8px;">€${product.prezzo_max ? parseFloat(product.prezzo_max).toFixed(0) : '—'}</td>
                <td style="padding:3px 8px;font-family:monospace;">${escHtml(product.sku_max || '—')}
                  <button onclick="copyText('${escHtml(product.sku_max || '')}', this)" style="background:none;border:none;cursor:pointer;font-size:12px;" title="Copia SKU">📋</button>
                </td>
              </tr>` : ''}
              ${product.misura_media ? `<tr>
                <td style="padding:3px 8px 3px 0;font-weight:600;">Media</td>
                <td style="padding:3px 8px;">${escHtml(product.misura_media)}</td>
                <td style="padding:3px 8px;">€${product.prezzo_media ? parseFloat(product.prezzo_media).toFixed(0) : '—'}</td>
                <td style="padding:3px 8px;font-family:monospace;">${escHtml(product.sku_media || '—')}
                  <button onclick="copyText('${escHtml(product.sku_media || '')}', this)" style="background:none;border:none;cursor:pointer;font-size:12px;" title="Copia SKU">📋</button>
                </td>
              </tr>` : ''}
              ${product.misura_mini ? `<tr>
                <td style="padding:3px 8px 3px 0;font-weight:600;">Piccola</td>
                <td style="padding:3px 8px;">${escHtml(product.misura_mini)}</td>
                <td style="padding:3px 8px;">€${product.prezzo_mini ? parseFloat(product.prezzo_mini).toFixed(0) : '—'}</td>
                <td style="padding:3px 8px;font-family:monospace;">${escHtml(product.sku_mini || '—')}
                  <button onclick="copyText('${escHtml(product.sku_mini || '')}', this)" style="background:none;border:none;cursor:pointer;font-size:12px;" title="Copia SKU">📋</button>
                </td>
              </tr>` : ''}
            </tbody>
          </table>
          ${product.sku_padre ? `<div style="margin-top:8px;"><strong>SKU padre:</strong>
            <span style="font-family:monospace;background:var(--gray-100);padding:2px 6px;border-radius:4px;">${escHtml(product.sku_padre)}</span>
            <button onclick="copyText('${escHtml(product.sku_padre)}', this)" style="background:none;border:none;cursor:pointer;font-size:12px;" title="Copia">📋</button>
          </div>` : ''}
        </span>
      </div>`;
  }

  if (fields.length) {
    document.getElementById('productInfoRows').innerHTML = fields.map(f => `
      <div class="product-info-row">
        <span class="info-key">${f.k}:</span>
        <span class="info-val">${escHtml(f.v)}</span>
      </div>`).join('') + variantiHtml;
    document.getElementById('productInfoCard').style.display = 'block';
  }
}

// =============================================
// CHECK IF EMPTY
// =============================================
function checkIfEmpty() {
  if (!currentSections) return;
  const allAttrs = Object.values(currentSections).flat();

  // Il banner "Genera" si mostra solo se NESSUN attributo AI è stato compilato.
  // Gli attributi FIXED/AUTO hanno sempre un valore → non li contiamo per questa logica.
  const aiAttrs = allAttrs.filter(a => a.source === 'AI');
  const hasAiValues = aiAttrs.length === 0 || aiAttrs.some(a => a.value && a.value.trim().length > 0);

  // La tab bar si mostra se esistono attributi (inclusi FIXED)
  const hasAnyValue = allAttrs.some(a => a.value && a.value.trim().length > 0);

  if (!hasAiValues) {
    // Nessun attributo AI generato → mostra banner
    document.getElementById('generateBanner').classList.remove('d-none');
  } else {
    document.getElementById('generateBanner').classList.add('d-none');
  }

  if (hasAnyValue) {
    // Mostra tab bar e toolbar (anche solo con FIXED visibili)
    document.getElementById('listingToolbar').style.display = '';
    document.getElementById('listingTabBar').style.display = '';
    switchListingTab(currentTab);
  } else {
    document.getElementById('listingToolbar').style.display = 'none';
    document.getElementById('listingTabBar').style.display = 'none';
    document.getElementById('variantsCard').style.display = 'none';
    document.getElementById('sectionsContainer').style.display = '';
    const _pic = document.getElementById('productImagesCard');
    if (_pic) _pic.style.display = 'none';
  }
}

// =============================================
// TAB SWITCHING
// =============================================
function switchListingTab(tab) {
  currentTab = tab;

  // Aggiorna pulsanti tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const sectionsContainer = document.getElementById('sectionsContainer');
  const variantsCard     = document.getElementById('variantsCard');
  const keywordSection   = document.getElementById('keywordSection');
  const toolbar          = document.getElementById('listingToolbar');

  const picCard = document.getElementById('productImagesCard');

  if (tab === 'variazioni') {
    // Tab speciale: mostra varianti, nascondi sezioni e keyword
    sectionsContainer.style.display = 'none';
    keywordSection.style.display = 'none';
    toolbar.style.display = 'none';
    variantsCard.style.display = '';
    if (picCard) picCard.style.display = 'none';
    renderVariantsCard(currentProduct);
  } else {
    // Tab normale: mostra sezioni filtrate per tab
    variantsCard.style.display = 'none';
    sectionsContainer.style.display = '';
    toolbar.style.display = '';
    if (tab === 'descrizione') {
      // Tab descrizione: mostra anche card immagini prodotto
      renderProductImagesCard();
      if (picCard) picCard.style.display = '';
    } else {
      // Altri tab: nascondi keyword section e card immagini
      keywordSection.style.display = 'none';
      if (picCard) picCard.style.display = 'none';
    }
    applyFilter();
  }
}

// =============================================
// RENDER VARIANTS CARD
// =============================================
function renderVariantsCard(product) {
  const card = document.getElementById('variantsCard');
  if (!product) return;

  const hasVariants = product.sku_max || product.misura_max;
  if (!hasVariants) {
    card.innerHTML = `
      <div class="product-info-card" style="text-align:center;padding:40px;">
        <p style="font-size:32px;margin-bottom:12px;">⚠️</p>
        <p style="color:var(--gray-600);font-weight:600;">Questo prodotto non ha varianti configurate.</p>
        <p style="font-size:13px;color:var(--gray-400);margin-top:6px;">Importa il catalogo Sivigliart con colonne Taglia Grande/Media/Piccola per abilitare le varianti.</p>
      </div>`;
    return;
  }

  const sizes = [
    { label: 'Grande',  misura: product.misura_max,   sku: product.sku_max,   prezzo: product.prezzo_max,   eanKey: 'ean_max',   imgKey: 'immagine_max'   },
    { label: 'Media',   misura: product.misura_media, sku: product.sku_media, prezzo: product.prezzo_media, eanKey: 'ean_media', imgKey: 'immagine_media' },
    { label: 'Piccola', misura: product.misura_mini,  sku: product.sku_mini,  prezzo: product.prezzo_mini,  eanKey: 'ean_mini',  imgKey: 'immagine_mini'  },
  ].filter(s => s.misura || s.sku);

  // Riga SKU padre
  const skuPadreHtml = product.sku_padre ? `
    <div class="sku-padre-bar">
      <strong>SKU Padre:</strong>
      <span class="sku-tag">${escHtml(product.sku_padre)}</span>
      <button onclick="copyText('${escHtml(product.sku_padre)}', this)"
              style="background:none;border:none;cursor:pointer;font-size:13px;" title="Copia SKU padre">📋</button>
      <span class="badge-source FIXED" style="font-size:10px;">📌 FISSO</span>
    </div>` : '';

  const rows = [
    {
      label: 'Taglia', badge: '⚙️ AUTO', badgeCls: 'AUTO',
      cells: sizes.map(s =>
        `<span style="font-weight:600;color:var(--gray-800);">${escHtml(s.misura || '—')}</span>`)
    },
    {
      label: 'SKU variante', badge: '⚙️ AUTO', badgeCls: 'AUTO',
      cells: sizes.map(s =>
        `<span style="font-family:monospace;font-size:12px;background:var(--gray-100);padding:2px 6px;border-radius:4px;">${escHtml(s.sku || '—')}</span>` +
        (s.sku ? ` <button onclick="copyText('${escHtml(s.sku)}', this)" style="background:none;border:none;cursor:pointer;font-size:11px;vertical-align:middle;" title="Copia SKU">📋</button>` : ''))
    },
    {
      label: 'Tipo ID', badge: '📌 FISSO', badgeCls: 'FIXED',
      cells: sizes.map(() => `<span style="font-weight:600;">EAN</span>`)
    },
    {
      label: 'ID esterna (EAN)', badge: '✍️ MANUALE', badgeCls: 'MANUAL',
      cells: sizes.map(s =>
        `<input type="text" class="var-input" id="var-${s.eanKey}"
           value="${escHtml(product[s.eanKey] || '')}"
           placeholder="es. 8056715291234"
           maxlength="14"
           oninput="variantsDirty=true;" />`)
    },
    {
      label: '📷 Frontale', badge: '✍️ MANUALE', badgeCls: 'MANUAL',
      cells: sizes.map(s =>
        `<input type="file" id="varfile-${s.imgKey}-frontale" accept="image/*" style="display:none"
               onchange="handleVariantImageSelect('${s.imgKey}', '${s.label}', 'frontale', this, '${escHtml(s.misura || '')}')">
         <input type="url" class="var-input url-input" id="var-${s.imgKey}"
           value="${escHtml(product[s.imgKey] || '')}"
           placeholder="https://..."
           oninput="variantsDirty=true;" />
         <button class="var-upload-btn" id="varbtn-${s.imgKey}-frontale"
                 onclick="document.getElementById('varfile-${s.imgKey}-frontale').click()"
                 title="Carica immagine frontale">
           📤
         </button>`)
    },
    {
      label: '📷 Laterale', badge: '✍️ MANUALE', badgeCls: 'MANUAL',
      cells: sizes.map(s =>
        `<input type="file" id="varfile-${s.imgKey}_2-laterale" accept="image/*" style="display:none"
               onchange="handleVariantImageSelect('${s.imgKey}_2', '${s.label}', 'laterale', this, '${escHtml(s.misura || '')}')">
         <input type="url" class="var-input url-input" id="var-${s.imgKey}_2"
           value="${escHtml(product[s.imgKey + '_2'] || '')}"
           placeholder="https://..."
           oninput="variantsDirty=true;" />
         <button class="var-upload-btn" id="varbtn-${s.imgKey}_2-laterale"
                 onclick="document.getElementById('varfile-${s.imgKey}_2-laterale').click()"
                 title="Carica immagine laterale">
           📤
         </button>`)
    },
    {
      label: '📷 Proporzione', badge: '✍️ MANUALE', badgeCls: 'MANUAL',
      cells: sizes.map(s =>
        `<input type="file" id="varfile-${s.imgKey}_3-proporzione" accept="image/*" style="display:none"
               onchange="handleVariantImageSelect('${s.imgKey}_3', '${s.label}', 'proporzione', this, '${escHtml(s.misura || '')}')">
         <input type="url" class="var-input url-input" id="var-${s.imgKey}_3"
           value="${escHtml(product[s.imgKey + '_3'] || '')}"
           placeholder="https://..."
           oninput="variantsDirty=true;" />
         <button class="var-upload-btn" id="varbtn-${s.imgKey}_3-proporzione"
                 onclick="document.getElementById('varfile-${s.imgKey}_3-proporzione').click()"
                 title="Carica immagine proporzione">
           📤
         </button>`)
    },
    {
      label: 'Condizione', badge: '📌 FISSO', badgeCls: 'FIXED',
      cells: sizes.map(() => `<span style="font-weight:600;">Nuovo</span>`)
    },
    {
      label: 'Prezzo', badge: '⚙️ AUTO', badgeCls: 'AUTO',
      cells: sizes.map(s =>
        `<span style="font-weight:700;color:var(--gray-800);">€${s.prezzo ? parseFloat(s.prezzo).toFixed(2) : '—'}</span>`)
    },
    {
      label: 'Quantità', badge: '📌 FISSO', badgeCls: 'FIXED',
      cells: sizes.map(() => `<span style="font-weight:600;">100</span>`)
    },
  ];

  const theadCols = sizes.map(s =>
    `<th>${escHtml(s.label)}<div style="font-size:10px;font-weight:400;opacity:0.7;margin-top:2px;">${escHtml(s.misura || '')}</div></th>`
  ).join('');

  const tbodyRows = rows.map((row, i) => `
    <tr style="background:${i % 2 === 0 ? 'var(--white)' : 'var(--gray-50)'};">
      <td>
        <div class="row-label">
          <span>${escHtml(row.label)}</span>
          <span class="badge-source ${row.badgeCls}" style="font-size:10px;">${row.badge}</span>
        </div>
      </td>
      ${row.cells.map(c => `<td>${c}</td>`).join('')}
    </tr>`).join('');

  card.innerHTML = `
    <div class="product-info-card" style="overflow-x:auto;">
      <h3 style="margin-bottom:16px;">🔀 Variazioni Prodotto</h3>
      ${skuPadreHtml}
      <div style="overflow-x:auto;">
        <table class="variants-table">
          <thead>
            <tr>
              <th style="min-width:180px;">Campo</th>
              ${theadCols}
            </tr>
          </thead>
          <tbody>${tbodyRows}</tbody>
        </table>
      </div>
      <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px;align-items:center;">
        <span id="variantsSaveNote" style="font-size:12px;color:var(--gray-400);">EAN e immagini sono salvate separatamente dagli attributi listing.</span>
        <button class="btn btn-success" id="saveVariantsBtn" onclick="saveVariants()">💾 Salva variazioni</button>
      </div>
    </div>`;
}

// =============================================
// SAVE VARIANTS
// =============================================
async function saveVariants() {
  const btn = document.getElementById('saveVariantsBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvataggio...'; }

  const body = {
    ean_max:           document.getElementById('var-ean_max')?.value.trim()           || null,
    ean_media:         document.getElementById('var-ean_media')?.value.trim()         || null,
    ean_mini:          document.getElementById('var-ean_mini')?.value.trim()          || null,
    immagine_max:      document.getElementById('var-immagine_max')?.value.trim()      || null,
    immagine_media:    document.getElementById('var-immagine_media')?.value.trim()    || null,
    immagine_mini:     document.getElementById('var-immagine_mini')?.value.trim()     || null,
    immagine_max_2:    document.getElementById('var-immagine_max_2')?.value.trim()    || null,
    immagine_max_3:    document.getElementById('var-immagine_max_3')?.value.trim()    || null,
    immagine_media_2:  document.getElementById('var-immagine_media_2')?.value.trim()  || null,
    immagine_media_3:  document.getElementById('var-immagine_media_3')?.value.trim()  || null,
    immagine_mini_2:   document.getElementById('var-immagine_mini_2')?.value.trim()   || null,
    immagine_mini_3:   document.getElementById('var-immagine_mini_3')?.value.trim()   || null,
  };

  try {
    const res = await fetch(`/api/products/${productId}/variants`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore salvataggio varianti');

    // Aggiorna currentProduct con i nuovi valori
    Object.assign(currentProduct, body);
    variantsDirty = false;

    showToast('✅ Variazioni salvate!', 'success');
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '💾 Salva variazioni'; }
  }
}

// =============================================
// RENDER SECTIONS
// =============================================
function renderSections(sections) {
  const container = document.getElementById('sectionsContainer');
  container.innerHTML = '';

  for (const [sectionName, attrs] of Object.entries(sections)) {
    if (!attrs || attrs.length === 0) continue;

    const block = document.createElement('div');
    block.className = 'section-block';
    block.dataset.section = sectionName;

    const icon = getSectionIcon(sectionName);
    block.innerHTML = `<div class="section-title">${icon} ${escHtml(sectionName)}</div>`;

    let hasCards = false;
    for (const attr of attrs) {
      if (/^immagine\s/i.test(attr.nome)) continue; // mostrate nella card immagini dedicata
      block.appendChild(createAttrCard(attr));
      hasCards = true;
    }

    if (hasCards) container.appendChild(block);
  }
}

// =============================================
// CREATE ATTRIBUTE CARD
// =============================================
function createAttrCard(attr) {
  const isReadonly = attr.source === 'FIXED' || attr.source === 'AUTO';
  const isEmpty = !attr.value || attr.value.trim() === '';
  const isManualEmpty = attr.source === 'MANUAL' && isEmpty;
  const charLimit = CHAR_LIMITS[attr.nome] || null;
  const isTextarea = /descrizione|punto elenco|elenco puntato|informazioni|caratteristiche/i.test(attr.nome);
  // Campo immagine: aggiunge upload button + preview
  const isImageField = /^immagine\s/i.test(attr.nome);

  const card = document.createElement('div');
  card.className = [
    'attr-card',
    attr.priorita,
    isReadonly ? 'readonly' : '',
    isManualEmpty ? 'empty-manual' : '',
  ].filter(Boolean).join(' ');
  card.dataset.attrId = attr.id;
  card.dataset.nome = attr.nome;
  card.dataset.source = attr.source;
  card.dataset.priorita = attr.priorita;

  // Source badge label & emoji
  const sourceMeta = {
    AI:     { label: '🤖 AI',     cls: 'AI' },
    FIXED:  { label: '📌 FISSO',  cls: 'FIXED' },
    AUTO:   { label: '⚙️ AUTO',   cls: 'AUTO' },
    MANUAL: { label: '✍️ MANUALE',cls: 'MANUAL' },
  };
  const sm = sourceMeta[attr.source] || { label: attr.source, cls: '' };

  // Priority indicator text
  const prioText = attr.priorita === 'obbligatorio' ? '<span style="color:#ef4444;font-size:11px;font-weight:700;">●</span>' :
                   attr.priorita === 'seo' ? '<span style="color:#f59e0b;font-size:11px;font-weight:700;">●</span>' : '';

  // Buttons
  const copyBtn = `<button class="btn btn-copy" onclick="copyAttr(${attr.id})" title="Copia">📋</button>`;
  const regenBtn = attr.source === 'AI'
    ? `<button class="btn-regen" onclick="regenerateAttr(${attr.id}, '${escHtml(attr.nome).replace(/'/g, "\\'")}', this)" title="Rigenera con AI">🔄 Rigenera</button>`
    : '';
  const ottimizzaBtn = BYTE_COUNTER_FIELDS.has(attr.nome)
    ? `<button class="btn-ottimizza" onclick="ottimizzaChiavi(${attr.id})" title="Normalizza: rimuovi punteggiatura, dedup, aggiungi core terms (quadro stampa tela decorazione parete)">⚡ Ottimizza</button>`
    : '';

  // Input element
  const inputId = `attr-${attr.id}`;
  const inputEl = isTextarea
    ? `<textarea id="${inputId}" class="attr-input" rows="3" ${isReadonly ? 'readonly' : ''}
        oninput="handleInput(${attr.id}, this)">${escHtml(attr.value || '')}</textarea>`
    : `<input type="text" id="${inputId}" class="attr-input" ${isReadonly ? 'readonly' : ''}
        value="${escHtml(attr.value || '')}" oninput="handleInput(${attr.id}, this)" />`;

  const useBytes = BYTE_COUNTER_FIELDS.has(attr.nome);
  const currentCount = useBytes
    ? getByteLength(attr.value || '')
    : (attr.value || '').length;
  const counterLabel = useBytes ? 'byte' : 'car.';
  const counterHtml = charLimit
    ? `<div class="char-counter" id="counter-${attr.id}">${currentCount} / ${charLimit} ${counterLabel}</div>`
    : '';

  // Badge qualità titolo (solo per "Nome dell'articolo")
  const isTitleField = /nome.*articolo/i.test(attr.nome);
  const titleBadgesHtml = isTitleField
    ? `<div class="title-quality-badges" id="title-badges-${attr.id}"></div>`
    : '';

  const manualHint = isManualEmpty
    ? `<div style="font-size:11px;color:#92400e;margin-top:4px;">⚠️ Campo manuale — inserire valore</div>`
    : '';

  // Upload immagine per campi immagine (MANUAL)
  const imageUploadHtml = isImageField ? `
    <div class="img-upload-wrap">
      <img class="img-preview${attr.value ? '' : ' hidden'}"
           id="imgpreview-${attr.id}"
           src="${escHtml(attr.value || '')}"
           onclick="window.open(this.src,'_blank')"
           title="Clicca per aprire in piena risoluzione" />
      <div style="display:flex;flex-direction:column;gap:6px;">
        <input type="file" id="imgfile-${attr.id}" accept="image/*" style="display:none"
               onchange="handleImageFileSelect(${attr.id}, this, '${escHtml(attr.nome).replace(/'/g, "\\'")}')">
        <button class="btn-upload-img" id="imgbtn-${attr.id}"
                onclick="document.getElementById('imgfile-${attr.id}').click()">
          📤 Carica immagine
        </button>
        <span style="font-size:11px;color:var(--gray-400);">JPG/PNG/WebP, max 10MB</span>
      </div>
    </div>` : '';

  card.innerHTML = `
    <div class="attr-header">
      <div class="attr-header-left">
        ${prioText}
        <span class="attr-nome">${escHtml(attr.nome)}</span>
        <span class="badge-source ${sm.cls}">${sm.label}</span>
      </div>
      <div class="attr-header-right">
        ${regenBtn}
        ${ottimizzaBtn}
        ${copyBtn}
      </div>
    </div>
    <div class="attr-body">
      ${inputEl}
      ${counterHtml}
      ${titleBadgesHtml}
      ${manualHint}
      ${imageUploadHtml}
    </div>`;

  return card;
}

// =============================================
// INPUT HANDLING (track changes)
// =============================================
function handleInput(attrId, el) {
  pendingChanges[attrId] = el.value;
  updateCharCounter(attrId, el.value);
  showSaveBar();

  const card = document.querySelector(`[data-attr-id="${attrId}"]`);
  const nomeCampo = card ? card.dataset.nome || '' : '';

  // Aggiorna badge qualità titolo (live)
  if (/nome.*articolo/i.test(nomeCampo)) {
    updateTitleQualityBadges(attrId, el.value);
  }

  // Aggiorna il badge OK/WARN con debounce 600ms se stiamo modificando le chiavi di ricerca
  if (/chiav[ei].*ricerca|keyword/i.test(nomeCampo)) {
    clearTimeout(kwBadgeDebounce);
    kwBadgeDebounce = setTimeout(() => {
      if (!currentSections) return;
      const titleBulletWords = buildTitleBulletWords();
      const kwTokens = tokenize(el.value.trim());
      const dupCount = new Set(kwTokens.filter(w => titleBulletWords.has(w))).size;
      updateKwBadge(dupCount, attrId);
    }, 600);
  }
}

function updateCharCounter(attrId, value) {
  const counter = document.getElementById(`counter-${attrId}`);
  if (!counter) return;

  const card = document.querySelector(`[data-attr-id="${attrId}"]`);
  const nome = card ? card.dataset.nome : '';
  const limit = CHAR_LIMITS[nome];
  if (!limit) return;

  const useBytes = BYTE_COUNTER_FIELDS.has(nome);
  const len = useBytes ? getByteLength(value) : value.length;
  const label = useBytes ? 'byte' : 'car.';

  // Salva il badge prima di sovrascrivere (textContent rimuoverebbe anche il badge span)
  const existingBadge = counter.querySelector('.kw-dup-badge');

  // Soglie e indicatori
  let indicator = '';
  counter.className = 'char-counter';

  if (useBytes) {
    // Campi byte (Chiavi di ricerca): soglie SEO Amazon specifiche
    if (len > limit) {
      counter.classList.add('over');
      indicator = ' 🔴';
    } else if (len === limit) {
      counter.classList.add('warn');
      indicator = ' 🟡';
    } else if (len >= 230) {
      counter.classList.add('okay');
      indicator = ' 🟢';
    }
    // < 230: neutro, nessun indicatore
  } else {
    // Campi carattere: soglie standard
    if (len > limit) counter.classList.add('over');
    else if (len > limit * 0.85) counter.classList.add('warn');
  }

  counter.textContent = `${len} / ${limit} ${label}${indicator}`;

  // Ri-aggiungi il badge se era presente
  if (existingBadge) counter.appendChild(existingBadge);
}

// =============================================
// COPY TEXT (helper generico per SKU e testi brevi)
// =============================================
function copyText(text, btn) {
  if (!text) { showToast('Nessun testo da copiare', 'warning'); return; }
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅';
    setTimeout(() => { btn.innerHTML = orig; }, 1200);
    showToast('📋 Copiato!', 'success');
  }).catch(() => {
    showToast('Copia non riuscita', 'error');
  });
}

// =============================================
// COPY ATTRIBUTE
// =============================================
function copyAttr(attrId) {
  const el = document.getElementById(`attr-${attrId}`);
  if (!el) return;
  const text = el.value || el.textContent;
  if (!text.trim()) { showToast('Campo vuoto!', 'warning'); return; }

  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Copiato!', 'success');
  }).catch(() => {
    el.select && el.select();
    document.execCommand('copy');
    showToast('📋 Copiato!', 'success');
  });
}

// =============================================
// SAVE CHANGES (bulk)
// =============================================
async function saveChanges() {
  if (Object.keys(pendingChanges).length === 0) return;

  const saveBtn = document.getElementById('saveBtn');
  const original = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Salvataggio...';

  const attributes = Object.entries(pendingChanges).map(([attribute_id, value]) => ({
    attribute_id: parseInt(attribute_id),
    value
  }));

  try {
    const res = await fetch(`/api/listings/${productId}/bulk`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Update currentSections with new values
    for (const [attrId, value] of Object.entries(pendingChanges)) {
      for (const attrs of Object.values(currentSections)) {
        const attr = attrs.find(a => a.id === parseInt(attrId));
        if (attr) { attr.value = value; attr.is_compiled = !!value; }
      }
    }

    pendingChanges = {};
    hideSaveBar();
    updateProgress();
    showToast(`✅ ${attributes.length} attributi salvati!`, 'success');
  } catch (err) {
    showToast(`Errore salvataggio: ${err.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = original;
  }
}

// =============================================
// DISCARD CHANGES
// =============================================
function discardChanges() {
  // Ripristina i valori originali dal currentSections
  for (const [attrId] of Object.entries(pendingChanges)) {
    for (const attrs of Object.values(currentSections)) {
      const attr = attrs.find(a => a.id === parseInt(attrId));
      if (attr) {
        const el = document.getElementById(`attr-${attrId}`);
        if (el) el.value = attr.value || '';
      }
    }
  }
  pendingChanges = {};
  hideSaveBar();
  showToast('Modifiche annullate', 'info');
}

// =============================================
// SAVE BAR
// =============================================
function showSaveBar() {
  const count = Object.keys(pendingChanges).length;
  document.getElementById('pendingCount').textContent =
    `${count} modifica${count !== 1 ? 'he' : ''} non salvata${count !== 1 ? 'e' : ''}`;
  document.getElementById('saveBar').classList.add('visible');
}

function hideSaveBar() {
  document.getElementById('saveBar').classList.remove('visible');
}

// =============================================
// GENERATE / REGENERATE ALL
// =============================================
async function generateListing() {
  showLoading('Generazione in corso...', 'Claude sta creando tutti gli attributi Amazon');

  const genBtn = document.getElementById('generateBtn');
  const regenBtn = document.getElementById('regenAllBtn');
  if (genBtn) genBtn.disabled = true;
  if (regenBtn) regenBtn.disabled = true;

  try {
    const res = await fetch(`/api/listings/generate/${productId}`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Errore generazione');
    }
    const data = await res.json();

    currentSections = data.sections;
    pendingChanges = {};

    // Re-render
    renderSections(currentSections);
    updateProgress();
    checkIfEmpty();
    hideSaveBar();

    showToast('✅ Listing generato con successo!', 'success');

    // Controlla automaticamente i duplicati nelle chiavi di ricerca e badge titolo
    // (piccolo timeout per dare tempo al DOM di aggiornarsi)
    setTimeout(() => checkKeywordDuplicates(), 300);
    setTimeout(() => initTitleBadges(), 150);
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  } finally {
    hideLoading();
    if (genBtn) genBtn.disabled = false;
    if (regenBtn) regenBtn.disabled = false;
  }
}

// =============================================
// REGENERATE SINGLE ATTRIBUTE
// =============================================
async function regenerateAttr(attrId, nomeAttributo, btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳';

  // Disabilita tutti i btn regen durante la rigenerazione
  document.querySelectorAll('.btn-regen').forEach(b => b.disabled = true);

  const el = document.getElementById(`attr-${attrId}`);
  const currentValue = el ? el.value : '';

  try {
    const res = await fetch(`/api/listings/${productId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attribute_id: attrId,
        nome_attributo: nomeAttributo,
        current_value: currentValue
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const newValue = data.value || '';

    // Aggiorna UI
    if (el) {
      el.value = newValue;
      updateCharCounter(attrId, newValue);
    }

    // Aggiorna currentSections
    for (const attrs of Object.values(currentSections)) {
      const attr = attrs.find(a => a.id === attrId);
      if (attr) { attr.value = newValue; attr.is_compiled = true; }
    }

    // Rimuovi dalle pendingChanges se c'era (è già salvato)
    delete pendingChanges[attrId];
    if (Object.keys(pendingChanges).length === 0) hideSaveBar();
    updateProgress();

    showToast(`✅ "${nomeAttributo}" rigenerato!`, 'success');

    // Se abbiamo rigenerato le chiavi di ricerca, ricontrolla i duplicati
    if (/chiav[ei].*ricerca|keyword/i.test(nomeAttributo)) {
      setTimeout(() => checkKeywordDuplicates(), 150);
    }
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  } finally {
    document.querySelectorAll('.btn-regen').forEach(b => b.disabled = false);
    btn.innerHTML = originalText;
  }
}

// =============================================
// PROGRESS BAR
// =============================================
function updateProgress() {
  if (!currentSections) return;
  const all = Object.values(currentSections).flat();
  const total = all.length;
  const compiled = all.filter(a => a.is_compiled || (a.value && a.value.trim())).length;
  const pct = total > 0 ? Math.round(compiled / total * 100) : 0;

  document.getElementById('progressLabel').textContent = `${compiled} / ${total} attributi compilati`;
  document.getElementById('progressFill').style.width = `${pct}%`;
}

// =============================================
// FILTER  (rispetta il tab corrente)
// =============================================
function applyFilter() {
  if (currentTab === 'variazioni') return;

  const onlyMandatory = document.getElementById('filterMandatory').checked;
  const hideReadonly  = document.getElementById('filterHideReadonly').checked;

  document.getElementById('filterChip').classList.toggle('active', onlyMandatory);
  document.getElementById('filterReadonlyChip').classList.toggle('active', hideReadonly);

  // Prefisso di match per il tab corrente (prime 5 lettere sono univoche)
  const tabPrefix = currentTab.slice(0, 5).toLowerCase();

  document.querySelectorAll('.attr-card').forEach(card => {
    const prio = card.dataset.priorita;
    const src  = card.dataset.source;
    let visible = true;
    if (onlyMandatory && prio !== 'obbligatorio') visible = false;
    if (hideReadonly && (src === 'FIXED' || src === 'AUTO')) visible = false;
    card.style.display = visible ? '' : 'none';
  });

  // Mostra/nascondi section-block in base al tab + carte visibili
  document.querySelectorAll('.section-block').forEach(block => {
    const sectionName = (block.dataset.section || '').toLowerCase();
    const tabMatch = sectionName.includes(tabPrefix);

    if (!tabMatch) {
      block.style.display = 'none';
      return;
    }
    const visibleCards = [...block.querySelectorAll('.attr-card')].filter(
      c => c.style.display !== 'none'
    );
    block.style.display = visibleCards.length > 0 ? '' : 'none';
  });
}

// =============================================
// DUPLICATE KEYWORD CHECKER
// =============================================

/**
 * Stop words italiane pure: articoli, preposizioni, congiunzioni.
 * NON includere parole core tipo arte/stampa/opera → quelle sono in CORE_FRONT_WORDS.
 */
const STOP_WORDS_IT = new Set([
  'di', 'e', 'su', 'il', 'la', 'un', 'per', 'con', 'da', 'in', 'a', 'al',
  'del', 'della', 'delle', 'dei', 'gli', 'le', 'lo', 'che', 'si', 'non',
  'come', 'questo', 'questa', 'ad', 'ed', 'o', 'ma', 'se', 'ne', 'ci',
  'tra', 'fra', 'ai', 'agli', 'uno', 'una', 'anche', 'più', 'sono', 'ha',
  'sua', 'suo', 'alle', 'all', 'allo', 'sulle', 'sulla', 'sullo',
  'degli', 'nei', 'nella', 'nelle', 'nello', 'col', 'coi',
]);

/**
 * Parole core sempre presenti nel fronte (titolo/bullet).
 * Vengono aggiunte FORZATAMENTE al set titleBulletWords, così qualsiasi
 * occorrenza nelle Chiavi di ricerca viene sempre flaggata come duplicato.
 */
const CORE_FRONT_WORDS = new Set([
  'stampa', 'tela', 'canvas', 'quadro', 'quadri',
  'arte', 'artista', 'pittura', 'opera', 'poster',
  'print', 'wall', 'dipinto', 'appendere', 'decorazione',
]);

/**
 * Parole deboli che da sole hanno scarsa rilevanza SEO.
 * Vengono rimosse come orfane se erano adiacenti (indice ±1 nell'array
 * tokenizzato) a un token rimosso come duplicato.
 */
const WEAK_STANDALONE_WORDS = new Set([
  'moderno', 'moderna', 'moderni', 'moderne',
  'stile', 'design', 'effetto', 'elegante', 'bello', 'bella',
  'colore', 'colori', 'ispirato', 'ispirata',
  'parete', 'pareti',
]);

/** Handle per debounce del badge on-input */
let kwBadgeDebounce = null;

/**
 * Tokenizza testo: apostrofi→spazio, punteggiatura→spazio, lowercase,
 * filtro stop words, filtro min 3 char.
 * Restituisce array ordinato (non Set) per poter fare adiacenza.
 */
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/['']/g, ' ')                           // apostrofi curvi e dritti → spazio
    .replace(/[^\wàèìòùáéíóúâêîôûäëïöü\s]/g, ' ')   // punteggiatura → spazio
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS_IT.has(w));
}

/**
 * Trova il campo "Chiavi di ricerca" nelle sezioni correnti.
 */
function findKeywordAttr() {
  if (!currentSections) return null;
  for (const attrs of Object.values(currentSections)) {
    const found = attrs.find(a => /chiav[ei].*ricerca|keyword/i.test(a.nome));
    if (found) return found;
  }
  return null;
}

/**
 * Costruisce il set titleBulletWords: parole da titolo+bullet + CORE_FRONT_WORDS forzate.
 */
function buildTitleBulletWords() {
  let sourceText = '';
  for (const attrs of Object.values(currentSections)) {
    for (const attr of attrs) {
      if (/nome.*articolo/i.test(attr.nome)) {
        const el = document.getElementById(`attr-${attr.id}`);
        sourceText += ' ' + (el ? el.value : (attr.value || ''));
      }
      if (/punto\s*elenco/i.test(attr.nome)) {
        const el = document.getElementById(`attr-${attr.id}`);
        sourceText += ' ' + (el ? el.value : (attr.value || ''));
      }
    }
  }
  return new Set([...tokenize(sourceText), ...CORE_FRONT_WORDS]);
}

/**
 * Aggiorna il badge OK/WARN inline nel char-counter del campo chiavi.
 * @param {number} dupCount - numero di duplicati rimanenti
 * @param {number|null} attrId - id attributo (se null, lo cerca automaticamente)
 */
function updateKwBadge(dupCount, attrId = null) {
  if (attrId === null) {
    const kwAttr = findKeywordAttr();
    if (!kwAttr) return;
    attrId = kwAttr.id;
  }
  const counter = document.getElementById(`counter-${attrId}`);
  if (!counter) return;

  // Rimuovi badge precedente
  const oldBadge = counter.querySelector('.kw-dup-badge');
  if (oldBadge) oldBadge.remove();

  const badge = document.createElement('span');
  badge.className = 'kw-dup-badge';
  if (dupCount === 0) {
    badge.style.cssText = 'margin-left:8px;background:#d1fae5;color:#065f46;' +
      'padding:1px 7px;border-radius:10px;font-size:11px;font-weight:600;';
    badge.textContent = '🟢 OK';
  } else {
    badge.style.cssText = 'margin-left:8px;background:#fef3c7;color:#92400e;' +
      'padding:1px 7px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;';
    badge.textContent = `🟡 ${dupCount} dup.`;
    badge.title = 'Clicca per aprire il pannello duplicati';
    badge.addEventListener('click', () => checkKeywordDuplicates());
  }
  counter.appendChild(badge);
}

/**
 * Controlla le parole duplicate tra Chiavi di ricerca e Titolo/Bullet.
 * Mostra un pannello sotto il campo e aggiorna il badge OK/WARN.
 */
function checkKeywordDuplicates() {
  // Rimuovi eventuale pannello precedente
  const existing = document.getElementById('kw-duplicate-panel');
  if (existing) existing.remove();

  const kwAttr = findKeywordAttr();
  if (!kwAttr) return;

  const kwEl = document.getElementById(`attr-${kwAttr.id}`);
  if (!kwEl) return;

  const kwText = kwEl.value.trim();
  if (!kwText) {
    updateKwBadge(0, kwAttr.id);
    return;
  }

  // titleBulletWords = parole estratte da titolo/bullet + CORE_FRONT_WORDS forzate
  const titleBulletWords = buildTitleBulletWords();

  // Token delle chiavi (array per adiacenza, Set per deduplicare i chip)
  const kwTokens = tokenize(kwText);
  const duplicates = [...new Set(kwTokens.filter(w => titleBulletWords.has(w)))];

  // Aggiorna badge
  updateKwBadge(duplicates.length, kwAttr.id);

  if (duplicates.length === 0) return;

  // Costruisci il pannello
  const panel = document.createElement('div');
  panel.id = 'kw-duplicate-panel';
  panel.style.cssText = [
    'margin-top:10px', 'padding:12px 14px',
    'background:#fffbeb', 'border:1px solid #f59e0b',
    'border-radius:8px', 'font-size:13px',
  ].join(';');

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                flex-wrap:wrap;gap:8px;margin-bottom:8px;">
      <span id="kw-dup-header" style="font-weight:600;color:#92400e;">
        ⚠️ ${duplicates.length} duplicat${duplicates.length === 1 ? 'o trovato' : 'i trovati'}:
      </span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button onclick="removeDuplicateKeywords()"
          style="background:#f59e0b;color:#fff;border:none;padding:4px 12px;
                 border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;">
          🔧 Rimuovi automaticamente
        </button>
        <button onclick="document.getElementById('kw-duplicate-panel').remove()"
          style="background:transparent;color:#92400e;border:1px solid #f59e0b;
                 padding:4px 12px;border-radius:5px;cursor:pointer;font-size:12px;">
          ✖ Ignora
        </button>
      </div>
    </div>
    <div id="kw-dup-chips" style="display:flex;flex-wrap:wrap;gap:6px;">
      ${duplicates.map(w => `
        <span class="dup-chip" data-word="${escHtml(w)}"
          title="Clicca per rimuovere solo questa parola"
          onclick="removeSingleDuplicateKeyword('${escHtml(w)}')"
          style="background:#fef3c7;border:1px solid #f59e0b;color:#92400e;
                 padding:3px 10px;border-radius:20px;cursor:pointer;
                 font-size:12px;font-weight:500;">
          ${escHtml(w)} ✕
        </span>`).join('')}
    </div>`;

  const kwCard = document.querySelector(`[data-attr-id="${kwAttr.id}"]`);
  if (kwCard) {
    kwCard.insertAdjacentElement('afterend', panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Rimuove tutti i duplicati dalle chiavi + orphan cleanup.
 * Orphan: WEAK_STANDALONE_WORDS adiacenti (indice ±1) a un token rimosso.
 */
function removeDuplicateKeywords() {
  const kwAttr = findKeywordAttr();
  if (!kwAttr) return;
  const kwEl = document.getElementById(`attr-${kwAttr.id}`);
  if (!kwEl) return;

  const titleBulletWords = buildTitleBulletWords();

  // Costruiamo array di coppie { raw, token } mantenendo l'ordine originale
  const rawWords = kwEl.value.trim().split(/\s+/).filter(Boolean);
  const pairs = rawWords.map(w => ({ raw: w, token: tokenize(w)[0] || null }));

  // Set di token rimossi (duplicati)
  const removedSet = new Set(
    pairs.filter(p => p.token && titleBulletWords.has(p.token)).map(p => p.token)
  );

  // Indici dei token rimossi (per adiacenza orphan check)
  const removedIndices = new Set(
    pairs.reduce((acc, p, i) => { if (p.token && removedSet.has(p.token)) acc.push(i); return acc; }, [])
  );

  // Filtra: mantieni solo token non duplicati e non orfani deboli
  const cleaned = pairs.filter((p, i) => {
    if (!p.token) return false;                  // stop word / troppo corta → salta
    if (removedSet.has(p.token)) return false;   // duplicato → rimuovi
    if (WEAK_STANDALONE_WORDS.has(p.token) &&
        (removedIndices.has(i - 1) || removedIndices.has(i + 1))) return false; // orfano debole
    return true;
  }).map(p => p.raw).join(' ');

  kwEl.value = cleaned;
  handleInput(kwAttr.id, kwEl);

  const panel = document.getElementById('kw-duplicate-panel');
  if (panel) panel.remove();

  updateKwBadge(0, kwAttr.id);
  showToast('🔧 Termini duplicati rimossi dalle chiavi di ricerca!', 'success');
}

/**
 * Rimuove UNA SINGOLA parola dalle chiavi di ricerca (via chip).
 */
function removeSingleDuplicateKeyword(word) {
  const kwAttr = findKeywordAttr();
  if (!kwAttr) return;
  const kwEl = document.getElementById(`attr-${kwAttr.id}`);
  if (!kwEl) return;

  // Rimuovi il token corrispondente dalla stringa raw
  const rawWords = kwEl.value.trim().split(/\s+/).filter(Boolean);
  const cleaned = rawWords
    .filter(w => (tokenize(w)[0] || '') !== word.toLowerCase())
    .join(' ');

  kwEl.value = cleaned;
  handleInput(kwAttr.id, kwEl);

  // Rimuovi il chip
  const chip = document.querySelector(`#kw-dup-chips [data-word="${word}"]`);
  if (chip) chip.remove();

  const remaining = document.querySelectorAll('#kw-dup-chips .dup-chip');
  if (remaining.length === 0) {
    const panel = document.getElementById('kw-duplicate-panel');
    if (panel) panel.remove();
    updateKwBadge(0, kwAttr.id);
  } else {
    const n = remaining.length;
    const header = document.getElementById('kw-dup-header');
    if (header) header.innerHTML = `⚠️ ${n} duplicat${n === 1 ? 'o trovato' : 'i trovati'}:`;
    updateKwBadge(n, kwAttr.id);
  }

  showToast(`✅ "${word}" rimosso dalle chiavi di ricerca`, 'success');
}

// =============================================
// OTTIMIZZA CHIAVI DI RICERCA
// =============================================

/**
 * Applica normalizeSearchTermsClient alle Chiavi di ricerca (lato client).
 * Rimuove punteggiatura, deduplica, aggiunge core terms mancanti, taglia a 250 byte.
 */
function ottimizzaChiavi(attrId) {
  const el = document.getElementById(`attr-${attrId}`);
  if (!el) return;
  const original = el.value;
  const normalized = normalizeSearchTermsClient(original);
  if (!normalized || normalized === original) {
    showToast('✅ Le chiavi sono già ottimizzate!', 'info');
    return;
  }
  el.value = normalized;
  handleInput(attrId, el);
  showToast('⚡ Chiavi ottimizzate: punteggiatura rimossa, dedup applicato, core terms verificati', 'success');
}

// =============================================
// BADGE QUALITÀ TITOLO
// =============================================

/**
 * Aggiorna i badge di qualità per il campo "Nome dell'articolo":
 * - Badge lunghezza: target 150–180 char
 * - Badge autore: controlla se il nome autore è nel titolo
 */
function updateTitleQualityBadges(attrId, value) {
  const container = document.getElementById(`title-badges-${attrId}`);
  if (!container) return;

  const len = value.length;

  // Badge lunghezza
  let lenBadge = '';
  if (len === 0) {
    lenBadge = '';
  } else if (len > 200) {
    lenBadge = `<span class="title-quality-badge badge-over">🔴 ${len} car. (max 200)</span>`;
  } else if (len > 180) {
    lenBadge = `<span class="title-quality-badge badge-warn">🟡 ${len} car. (target 150-180)</span>`;
  } else if (len >= 150) {
    lenBadge = `<span class="title-quality-badge badge-ok">✅ ${len} car.</span>`;
  } else {
    lenBadge = `<span class="title-quality-badge badge-warn">🟡 ${len} car. (target 150-180)</span>`;
  }

  // Badge autore — usa currentProduct.autore se disponibile
  let autoreBadge = '';
  if (currentProduct && currentProduct.autore && value) {
    const autoreNorm = currentProduct.autore.toLowerCase().trim();
    const titleNorm = value.toLowerCase();
    // Controlla se almeno una parola dell'autore (>3 char) appare nel titolo
    const autoreWords = autoreNorm.split(/\s+/).filter(w => w.length > 3);
    const found = autoreWords.some(w => titleNorm.includes(w));
    if (found) {
      autoreBadge = `<span class="title-quality-badge badge-over">⚠️ Autore nel titolo</span>`;
    } else {
      autoreBadge = `<span class="title-quality-badge badge-ok">✅ No autore</span>`;
    }
  }

  container.innerHTML = autoreBadge + (autoreBadge && lenBadge ? '&nbsp;' : '') + lenBadge;
}

/**
 * Inizializza i badge qualità titolo per tutti i campi titolo presenti nel DOM.
 * Da chiamare dopo renderSections.
 */
function initTitleBadges() {
  if (!currentSections) return;
  for (const attrs of Object.values(currentSections)) {
    for (const attr of attrs) {
      if (/nome.*articolo/i.test(attr.nome)) {
        const el = document.getElementById(`attr-${attr.id}`);
        if (el) updateTitleQualityBadges(attr.id, el.value);
        return;
      }
    }
  }
}

// =============================================
// KEYWORD MINING
// =============================================
async function mineKeywords() {
  const section = document.getElementById('keywordSection');
  const loading = document.getElementById('kwLoading');
  const chips = document.getElementById('kwChips');
  const status = document.getElementById('kwStatus');
  const copyBtn = document.getElementById('copyKwBtn');
  const injectBtn = document.getElementById('injectKwBtn');
  const btn = document.getElementById('mineKeywordsBtn');

  section.style.display = 'block';
  loading.style.display = 'block';
  chips.innerHTML = '';
  copyBtn.style.display = 'none';
  injectBtn.style.display = 'none';
  status.textContent = 'Mining in corso...';

  btn.disabled = true;
  const origBtn = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;"></span> Mining...';

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch(`/api/keywords/mine/${productId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    minedKeywords = data.keywords || [];
    loading.style.display = 'none';

    if (minedKeywords.length === 0) {
      chips.innerHTML = '<p style="color:var(--gray-500);font-size:13px;">Nessuna keyword trovata.</p>';
      status.textContent = '(nessun risultato)';
    } else {
      renderKeywordChips(minedKeywords);
      status.textContent = `— ${minedKeywords.length} keyword trovate`;
      copyBtn.style.display = 'inline-flex';
      injectBtn.style.display = 'inline-flex';
      showToast(`✅ ${minedKeywords.length} keyword trovate su Amazon.it!`, 'success');
    }
  } catch (err) {
    loading.style.display = 'none';
    chips.innerHTML = `<p style="color:var(--danger);font-size:13px;">Errore: ${escHtml(err.message)}</p>`;
    status.textContent = '(errore)';
    showToast(`Errore mining: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origBtn;
  }
}

function renderKeywordChips(keywords) {
  const container = document.getElementById('kwChips');
  container.innerHTML = '';
  keywords.forEach(kw => {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    chip.textContent = kw;
    chip.title = 'Clicca per copiare';
    chip.addEventListener('click', () => {
      navigator.clipboard.writeText(kw).then(() => {
        chip.classList.add('copied');
        const orig = chip.textContent;
        chip.textContent = '✅ ' + orig;
        setTimeout(() => { chip.classList.remove('copied'); chip.textContent = orig; }, 1200);
      });
    });
    container.appendChild(chip);
  });
}

function copyAllKeywords() {
  if (!minedKeywords.length) return;
  navigator.clipboard.writeText(minedKeywords.join(', ')).then(() => {
    showToast(`📋 ${minedKeywords.length} keyword copiate!`, 'success');
  });
}

function injectKeywords() {
  if (!minedKeywords.length) return;

  // Trova la prima Chiave ricerca nel DOM
  const kwCard = [...document.querySelectorAll('.attr-card')].find(
    c => /chiave|keyword|ricerca/i.test(c.dataset.nome || '')
  );
  if (!kwCard) {
    showToast('Attributo "Chiavi ricerca" non trovato', 'warning');
    return;
  }

  const attrId = kwCard.dataset.attrId;
  const el = document.getElementById(`attr-${attrId}`);
  if (!el) return;

  const existing = el.value.trim();
  const existingArr = existing ? existing.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];
  const toAdd = minedKeywords.filter(k => !existingArr.includes(k.toLowerCase()));

  if (toAdd.length === 0) { showToast('Tutte le keyword già presenti!', 'info'); return; }

  el.value = existing ? existing + ', ' + toAdd.join(', ') : toAdd.join(', ');
  handleInput(parseInt(attrId), el);

  showToast(`✨ ${toAdd.length} keyword aggiunte!`, 'success');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// =============================================
// CLOUDINARY IMAGE UPLOAD
// =============================================

/**
 * Carica un file immagine su Cloudinary via backend.
 * @param {File}   file    - File selezionato
 * @param {string} name    - Nome pubblico del file (senza estensione)
 * @param {string} folder  - Cartella Cloudinary
 * @returns {Promise<string>} URL pubblico Cloudinary
 */
async function uploadImageToCloudinary(file, name, folder) {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('name', name);
  formData.append('folder', folder);

  const res = await fetch('/api/images/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload fallito');
  return data.url;
}

/**
 * Gestisce la selezione file per un attributo immagine.
 * Mostra preview locale → carica su Cloudinary → salva URL nell'input.
 * @param {number} attrId    - ID attributo
 * @param {HTMLInputElement} input    - Il file input
 * @param {string} nomeCampo - Nome dell'attributo (es. "Immagine principale")
 */
async function handleImageFileSelect(attrId, input, nomeCampo) {
  const file = input.files[0];
  if (!file) return;

  const btn     = document.getElementById(`imgbtn-${attrId}`);
  const preview = document.getElementById(`imgpreview-${attrId}`);
  const urlInput = document.getElementById(`attr-${attrId}`);

  // Mostra preview locale immediatamente
  const localUrl = URL.createObjectURL(file);
  if (preview) {
    preview.src = localUrl;
    preview.classList.remove('hidden');
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="upload-spinner"></span> Caricamento...'; }

  try {
    const sku    = currentProduct?.sku_padre || `prod-${productId}`;
    const slug   = nomeCampo.toLowerCase().replace(/\s+/g, '-');
    const name   = `${sku}-${slug}-${Date.now()}`;
    const folder = `amazon-ai/${sku}`;

    const url = await uploadImageToCloudinary(file, name, folder);

    if (urlInput) {
      urlInput.value = url;
      handleInput(attrId, urlInput);
    }
    if (preview) preview.src = url; // sostituisce la preview locale con l'URL Cloudinary

    URL.revokeObjectURL(localUrl);
    showToast('✅ Immagine caricata!', 'success');
  } catch (err) {
    showToast(`❌ Upload fallito: ${err.message}`, 'error');
    if (preview && !(urlInput && urlInput.value)) preview.classList.add('hidden');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '📤 Carica immagine'; }
    input.value = ''; // resetta il file input
  }
}

/**
 * Gestisce upload immagine variante con naming intelligente.
 * @param {string} imgKey  - 'immagine_max' | 'immagine_max_2' | ecc.
 * @param {string} label   - 'Grande' | 'Media' | 'Piccola'
 * @param {string} imgType - 'frontale' | 'laterale' | 'proporzione'
 * @param {HTMLInputElement} input - file input
 * @param {string} misura  - es. '90x130 cm' — usato per naming corretto
 */
async function handleVariantImageSelect(imgKey, label, imgType, input, misura) {
  const file = input.files[0];
  if (!file) return;

  const btnId    = `varbtn-${imgKey}-${imgType}`;
  const btn      = document.getElementById(btnId);
  const urlInput = document.getElementById(`var-${imgKey}`);

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="upload-spinner"></span>'; }

  try {
    const skuPadre = currentProduct?.sku_padre || `prod-${productId}`;

    // SKU variante (es. sku_max per immagine_max / immagine_max_2 / immagine_max_3)
    const baseKey    = imgKey.replace(/_[23]$/, '');          // immagine_max_2 → immagine_max
    const skuKey     = baseKey.replace('immagine_', 'sku_');  // immagine_max → sku_max
    const skuVar     = currentProduct?.[skuKey] || label.toLowerCase();

    // Dimensioni corrette: lato lungo (base) × lato corto (altezza)
    let dimStr = '';
    if (misura) {
      const m = misura.match(/(\d+)\s*[xX×]\s*(\d+)/i);
      if (m) {
        const a = parseInt(m[1]);
        const b = parseInt(m[2]);
        const base    = Math.max(a, b);   // lato lungo = base
        const altezza = Math.min(a, b);   // lato corto = altezza
        dimStr = `_${base}x${altezza}cm`;
      }
    }

    const name   = `${skuVar}${dimStr}_${imgType}`;
    const folder = `amazon-ai/${skuPadre}`;

    const url = await uploadImageToCloudinary(file, name, folder);

    if (urlInput) { urlInput.value = url; variantsDirty = true; }
    if (currentProduct) currentProduct[imgKey] = url;

    showToast(`✅ ${imgType.charAt(0).toUpperCase() + imgType.slice(1)} variante ${label} caricata!`, 'success');
  } catch (err) {
    showToast(`❌ Upload fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '📤'; }
    input.value = '';
  }
}

// =============================================
// PRODUCT IMAGES CARD
// =============================================

/**
 * Slug per naming Cloudinary delle immagini prodotto.
 * "Immagine principale" → "principale" | "Immagine 2" → "img2" | ecc.
 */
function getImageTipo(nomeCampo) {
  if (/principale/i.test(nomeCampo)) return 'principale';
  const m = nomeCampo.match(/(\d+)$/);
  if (m) return `img${m[1]}`;
  return nomeCampo.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Renderizza la card dedicata delle immagini prodotto (riga parent).
 * Estrae gli attributi "Immagine *" da currentSections e li mostra in griglia 3×3.
 * Le card salvano tramite handleInput → pendingChanges → saveChanges (stesso flusso degli attributi).
 */
function renderProductImagesCard() {
  const card = document.getElementById('productImagesCard');
  if (!card) return;

  // Estrai e ordina attributi immagine
  const imageAttrs = [];
  if (currentSections) {
    for (const attrs of Object.values(currentSections)) {
      for (const attr of attrs) {
        if (/^immagine\s/i.test(attr.nome)) imageAttrs.push(attr);
      }
    }
  }
  imageAttrs.sort((a, b) => (a.ordine || 0) - (b.ordine || 0));

  if (imageAttrs.length === 0) {
    card.innerHTML = '';
    card.style.display = 'none';
    return;
  }

  const sku = currentProduct?.sku_padre || `prod-${productId}`;

  const slots = imageAttrs.map(attr => {
    const hasValue = attr.value && attr.value.trim();
    const tipo = getImageTipo(attr.nome);
    const nomeEsempio = `${sku}_${tipo}`;

    return `
      <div class="prod-img-slot">
        <div class="prod-img-preview-wrap" onclick="prodImgPreviewClick(${attr.id})">
          <img id="prod-imgpreview-${attr.id}"
               class="prod-img-preview${hasValue ? '' : ' hidden'}"
               src="${escHtml(attr.value || '')}"
               title="Clicca per aprire in piena risoluzione" />
          <div id="prod-imgplaceholder-${attr.id}"
               class="prod-img-placeholder${hasValue ? ' hidden' : ''}">🖼️</div>
        </div>
        <div class="prod-img-label">${escHtml(attr.nome)}</div>
        <div class="prod-img-name-hint" title="Nome Cloudinary: ${escHtml(nomeEsempio)}">${escHtml(nomeEsempio)}</div>
        <input type="file" id="prod-imgfile-${attr.id}" accept="image/*" style="display:none"
               onchange="handleProductImageFileSelect(${attr.id}, this, '${tipo}')">
        <button class="prod-img-upload-btn" id="prod-imgbtn-${attr.id}"
                onclick="document.getElementById('prod-imgfile-${attr.id}').click()">
          📤 Carica
        </button>
        <input type="url" id="attr-${attr.id}" class="prod-img-url"
               value="${escHtml(attr.value || '')}"
               placeholder="https://..."
               oninput="handleInput(${attr.id}, this); prodImgUrlChanged(${attr.id});" />
      </div>`;
  }).join('');

  card.innerHTML = `
    <div class="product-info-card" style="margin-bottom:20px;">
      <h3 style="margin-bottom:4px;">🖼️ Immagini Prodotto</h3>
      <p style="font-size:12px;color:var(--gray-400);margin-bottom:16px;">
        Immagini della riga <strong>parent</strong> nell'export Amazon (colonne 21–29).
        Naming automatico:
        <span style="font-family:monospace;background:var(--gray-100);padding:1px 5px;border-radius:4px;">${escHtml(sku)}_principale</span>,
        <span style="font-family:monospace;background:var(--gray-100);padding:1px 5px;border-radius:4px;">${escHtml(sku)}_img2</span>, ecc.
        Le modifiche vengono salvate tramite <strong>"💾 Salva modifiche"</strong>.
      </p>
      <div class="prod-img-grid">${slots}</div>
    </div>`;
}

/**
 * Apre l'immagine in una nuova tab al click sulla preview.
 */
function prodImgPreviewClick(attrId) {
  const preview = document.getElementById(`prod-imgpreview-${attrId}`);
  if (preview && preview.src && !preview.classList.contains('hidden')) {
    window.open(preview.src, '_blank');
  }
}

/**
 * Aggiorna la preview quando l'URL viene digitato manualmente nel campo testo.
 */
function prodImgUrlChanged(attrId) {
  const urlInput    = document.getElementById(`attr-${attrId}`);
  const preview     = document.getElementById(`prod-imgpreview-${attrId}`);
  const placeholder = document.getElementById(`prod-imgplaceholder-${attrId}`);
  if (!urlInput || !preview || !placeholder) return;
  const val = urlInput.value.trim();
  if (val) {
    preview.src = val;
    preview.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    preview.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
}

/**
 * Gestisce upload immagine prodotto (riga parent) con naming intelligente.
 * @param {number} attrId  - ID attributo (es. id di "Immagine principale")
 * @param {HTMLInputElement} input - file input
 * @param {string} tipo    - slug tipo (es. 'principale', 'img2', ...)
 */
async function handleProductImageFileSelect(attrId, input, tipo) {
  const file = input.files[0];
  if (!file) return;

  const btn         = document.getElementById(`prod-imgbtn-${attrId}`);
  const preview     = document.getElementById(`prod-imgpreview-${attrId}`);
  const placeholder = document.getElementById(`prod-imgplaceholder-${attrId}`);
  const urlInput    = document.getElementById(`attr-${attrId}`);

  // Preview locale immediata
  const localUrl = URL.createObjectURL(file);
  if (preview)     { preview.src = localUrl; preview.classList.remove('hidden'); }
  if (placeholder) placeholder.classList.add('hidden');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="upload-spinner"></span> Upload...'; }

  try {
    const sku    = currentProduct?.sku_padre || `prod-${productId}`;
    const name   = `${sku}_${tipo}`;
    const folder = `amazon-ai/${sku}`;

    const url = await uploadImageToCloudinary(file, name, folder);

    if (urlInput) {
      urlInput.value = url;
      handleInput(attrId, urlInput);
      prodImgUrlChanged(attrId);
    }
    if (preview) preview.src = url;
    URL.revokeObjectURL(localUrl);
    showToast(`✅ Immagine caricata: ${name}`, 'success');
  } catch (err) {
    showToast(`❌ Upload fallito: ${err.message}`, 'error');
    if (preview && !(urlInput && urlInput.value)) {
      preview.classList.add('hidden');
      if (placeholder) placeholder.classList.remove('hidden');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '📤 Carica'; }
    input.value = '';
  }
}

// =============================================
// DOWNLOAD PER AMAZON (WALL_ART.xlsm)
// =============================================
async function downloadForAmazon() {
  const btn = document.getElementById('downloadAmazonBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Download...'; }

  try {
    const res = await fetch(`/api/export/${productId}`);
    if (!res.ok) {
      let msg = 'Errore durante l\'export';
      try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    // Leggi il buffer e crea un link di download
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);

    // Recupera il filename dall'header Content-Disposition
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `WALL_ART_${productId}.xlsm`;

    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast('✅ File scaricato! Carica su Amazon Seller Central.', 'success');
  } catch (err) {
    showToast(`❌ Download fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '📥 Scarica per Amazon'; }
  }
}

// =============================================
// UI HELPERS
// =============================================
function showLoading(title, subtitle) {
  document.getElementById('loadingTitle').textContent = title;
  document.getElementById('loadingSubtitle').textContent = subtitle;
  document.getElementById('loadingOverlay').classList.remove('d-none');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('d-none');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
