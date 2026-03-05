/* =============================================
   AMAZON AI LISTING TOOL — Listing Dinamico
   Sistema attributi: AI | FIXED | AUTO | MANUAL
   ============================================= */

let productId = null;
let currentProduct = null;
let currentSections = null;           // { sezione: [attr, ...] }
let pendingChanges = {};              // { attribute_id: new_value }
let minedKeywords = [];

// Limiti caratteri noti (Amazon Italy)
const CHAR_LIMITS = {
  'Nome articolo': 200,
  'Punto elenco 1': 500, 'Punto elenco 2': 500,
  'Punto elenco 3': 500, 'Punto elenco 4': 500,
  'Punto elenco 5': 500,
  'Descrizione prodotto': 2000,
  'Chiavi ricerca': 250,
  'Chiavi ricerca 1': 250, 'Chiavi ricerca 2': 250,
  'Chiavi ricerca 3': 250,
};

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
  const hasAnyValue = allAttrs.some(a => a.value && a.value.trim().length > 0);

  if (!hasAnyValue) {
    document.getElementById('generateBanner').classList.remove('d-none');
    document.getElementById('listingToolbar').style.display = 'none';
  } else {
    document.getElementById('generateBanner').classList.add('d-none');
    document.getElementById('listingToolbar').style.display = '';
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

    for (const attr of attrs) {
      block.appendChild(createAttrCard(attr));
    }

    container.appendChild(block);
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

  // Input element
  const inputId = `attr-${attr.id}`;
  const inputEl = isTextarea
    ? `<textarea id="${inputId}" class="attr-input" rows="3" ${isReadonly ? 'readonly' : ''}
        oninput="handleInput(${attr.id}, this)">${escHtml(attr.value || '')}</textarea>`
    : `<input type="text" id="${inputId}" class="attr-input" ${isReadonly ? 'readonly' : ''}
        value="${escHtml(attr.value || '')}" oninput="handleInput(${attr.id}, this)" />`;

  const counterHtml = charLimit
    ? `<div class="char-counter" id="counter-${attr.id}">${(attr.value || '').length} / ${charLimit}</div>`
    : '';

  const manualHint = isManualEmpty
    ? `<div style="font-size:11px;color:#92400e;margin-top:4px;">⚠️ Campo manuale — inserire valore</div>`
    : '';

  card.innerHTML = `
    <div class="attr-header">
      <div class="attr-header-left">
        ${prioText}
        <span class="attr-nome">${escHtml(attr.nome)}</span>
        <span class="badge-source ${sm.cls}">${sm.label}</span>
      </div>
      <div class="attr-header-right">
        ${regenBtn}
        ${copyBtn}
      </div>
    </div>
    <div class="attr-body">
      ${inputEl}
      ${counterHtml}
      ${manualHint}
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
}

function updateCharCounter(attrId, value) {
  const counter = document.getElementById(`counter-${attrId}`);
  if (!counter) return;

  // Find the limit from the card nome
  const card = document.querySelector(`[data-attr-id="${attrId}"]`);
  const nome = card ? card.dataset.nome : '';
  const limit = CHAR_LIMITS[nome];
  if (!limit) return;

  const len = value.length;
  counter.textContent = `${len} / ${limit}`;
  counter.className = 'char-counter';
  if (len > limit) counter.classList.add('over');
  else if (len > limit * 0.85) counter.classList.add('warn');
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
// FILTER
// =============================================
function applyFilter() {
  const onlyMandatory = document.getElementById('filterMandatory').checked;
  const hideReadonly = document.getElementById('filterHideReadonly').checked;

  document.getElementById('filterChip').classList.toggle('active', onlyMandatory);
  document.getElementById('filterReadonlyChip').classList.toggle('active', hideReadonly);

  document.querySelectorAll('.attr-card').forEach(card => {
    const prio = card.dataset.priorita;
    const src = card.dataset.source;
    let visible = true;
    if (onlyMandatory && prio !== 'obbligatorio') visible = false;
    if (hideReadonly && (src === 'FIXED' || src === 'AUTO')) visible = false;
    card.style.display = visible ? '' : 'none';
  });

  // Nascondi sezioni vuote dopo il filtro
  document.querySelectorAll('.section-block').forEach(block => {
    const visibleCards = [...block.querySelectorAll('.attr-card')].filter(
      c => c.style.display !== 'none'
    );
    block.style.display = visibleCards.length > 0 ? '' : 'none';
  });
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
