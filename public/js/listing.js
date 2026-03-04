/* =============================================
   AMAZON AI LISTING TOOL — Listing Detail JS
   ============================================= */

let listingId = null;
let productId = null;
let originalData = {};
let hasUnsavedChanges = false;
let minedKeywords = [];

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  // Leggi l'ID dal query string
  const params = new URLSearchParams(window.location.search);
  listingId = params.get('id');

  if (!listingId) {
    showToast('ID listing non trovato', 'error');
    setTimeout(() => window.location.href = '/', 1500);
    return;
  }

  loadListing();
  initCounters();
  initSaveBar();
  initRegenButtons();
});

// =============================================
// CARICAMENTO LISTING
// =============================================
async function loadListing() {
  try {
    const res = await fetch(`/api/listings/${listingId}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Listing non trovato');
    }
    const listing = await res.json();
    populateListing(listing);
    populateProductInfo(listing);
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    setTimeout(() => window.location.href = '/', 2000);
  }
}

function populateListing(listing) {
  const fields = ['titolo', 'descrizione', 'bp1', 'bp2', 'bp3', 'bp4', 'bp5', 'parole_chiave', 'prezzo', 'quantita'];

  fields.forEach(field => {
    const el = document.getElementById(field);
    if (el) {
      el.value = listing[field] !== null && listing[field] !== undefined ? listing[field] : '';
      updateCounter(field);
    }
  });

  // Aggiorna header pagina
  document.getElementById('pageTitle').textContent = `📄 ${listing.titolo_opera || 'Listing'}`;
  document.getElementById('pageSubtitle').textContent =
    listing.autore
      ? `di ${listing.autore}${listing.dimensioni ? ' — ' + listing.dimensioni : ''}`
      : listing.dimensioni || 'Stampa artistica su tela';
  document.title = `${listing.titolo_opera} — Amazon AI Tool`;

  // Salva product_id per il keyword mining
  productId = listing.product_id;

  // Salva i dati originali per il "Annulla"
  originalData = { ...listing };

  // Reset modifiche non salvate
  hasUnsavedChanges = false;
  hideSaveBar();
}

function populateProductInfo(listing) {
  const card = document.getElementById('productInfoCard');
  const rows = document.getElementById('productInfoRows');

  const fields = [
    { key: 'Opera', val: listing.titolo_opera },
    { key: 'Autore', val: listing.autore },
    { key: 'Dimensioni', val: listing.dimensioni },
    { key: 'Tecnica', val: listing.tecnica },
    { key: 'Descrizione', val: listing.descrizione_raw },
  ];

  const html = fields
    .filter(f => f.val)
    .map(f => `
      <div class="product-info-row">
        <span class="info-key">${f.key}:</span>
        <span class="info-val">${escHtml(f.val)}</span>
      </div>`)
    .join('');

  if (html) {
    rows.innerHTML = html;
    card.style.display = 'block';
  }
}

// =============================================
// CONTATORI CARATTERI
// =============================================
function initCounters() {
  const fieldCounters = {
    'titolo': 'titoloCounter',
    'descrizione': 'descrizioneCounter',
    'bp1': 'bp1Counter',
    'bp2': 'bp2Counter',
    'bp3': 'bp3Counter',
    'bp4': 'bp4Counter',
    'bp5': 'bp5Counter',
  };

  Object.entries(fieldCounters).forEach(([fieldId, counterId]) => {
    const el = document.getElementById(fieldId);
    if (el) {
      el.addEventListener('input', () => {
        updateCounter(fieldId);
        markUnsaved();
      });
    }
  });

  // Monitora anche gli altri campi per le modifiche
  ['parole_chiave', 'prezzo', 'quantita'].forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) el.addEventListener('input', markUnsaved);
  });
}

function updateCounter(fieldId) {
  const counterMap = {
    'titolo': 'titoloCounter',
    'descrizione': 'descrizioneCounter',
    'bp1': 'bp1Counter',
    'bp2': 'bp2Counter',
    'bp3': 'bp3Counter',
    'bp4': 'bp4Counter',
    'bp5': 'bp5Counter',
  };

  const counterId = counterMap[fieldId];
  if (!counterId) return;

  const el = document.getElementById(fieldId);
  const counter = document.getElementById(counterId);
  if (el && counter) {
    const len = el.value.length;
    counter.textContent = `${len} car.`;

    // Colori warning
    const limits = { titolo: 200, descrizione: 2000, bp1: 500, bp2: 500, bp3: 500, bp4: 500, bp5: 500 };
    const limit = limits[fieldId];
    if (limit) {
      if (len > limit) {
        counter.style.color = 'var(--danger)';
        counter.style.fontWeight = '700';
      } else if (len > limit * 0.85) {
        counter.style.color = 'var(--warning)';
        counter.style.fontWeight = '600';
      } else {
        counter.style.color = '';
        counter.style.fontWeight = '';
      }
    }
  }
}

// =============================================
// SAVE BAR
// =============================================
function initSaveBar() {
  document.getElementById('saveBtn').addEventListener('click', saveListing);
  document.getElementById('discardBtn').addEventListener('click', discardChanges);
}

function markUnsaved() {
  if (!hasUnsavedChanges) {
    hasUnsavedChanges = true;
    showSaveBar();
  }
}

function showSaveBar() {
  document.getElementById('saveBar').classList.add('visible');
}

function hideSaveBar() {
  document.getElementById('saveBar').classList.remove('visible');
}

function discardChanges() {
  populateListing(originalData);
  showToast('Modifiche annullate', 'info');
}

async function saveListing() {
  const saveBtn = document.getElementById('saveBtn');
  const originalText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Salvataggio...';

  const payload = {
    titolo: document.getElementById('titolo').value,
    descrizione: document.getElementById('descrizione').value,
    bp1: document.getElementById('bp1').value,
    bp2: document.getElementById('bp2').value,
    bp3: document.getElementById('bp3').value,
    bp4: document.getElementById('bp4').value,
    bp5: document.getElementById('bp5').value,
    parole_chiave: document.getElementById('parole_chiave').value,
    prezzo: document.getElementById('prezzo').value || null,
    quantita: document.getElementById('quantita').value || null,
  };

  try {
    const res = await fetch(`/api/listings/${listingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    originalData = { ...originalData, ...payload };
    hasUnsavedChanges = false;
    hideSaveBar();
    showToast('✅ Listing salvato con successo!', 'success');

  } catch (err) {
    showToast(`Errore salvataggio: ${err.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalText;
  }
}

// =============================================
// RIGENERAZIONE AI
// =============================================
function initRegenButtons() {
  document.getElementById('regenTitoloBtn').addEventListener('click', () => regenerate('titolo'));
  document.getElementById('regenBpBtn').addEventListener('click', () => regenerate('bullet_points'));
  document.getElementById('regenDescBtn').addEventListener('click', () => regenerate('descrizione'));
  document.getElementById('mineKeywordsBtn').addEventListener('click', mineKeywords);
}

async function regenerate(field) {
  const labels = {
    titolo: 'titolo',
    bullet_points: 'bullet points',
    descrizione: 'descrizione'
  };

  showLoading(
    `Rigenerazione ${labels[field]}...`,
    'Claude sta riscrivendo il contenuto selezionato'
  );

  // Disabilita tutti i bottoni AI durante la rigenerazione
  setAiButtonsDisabled(true);

  try {
    const res = await fetch(`/api/listings/${listingId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Aggiorna i campi rigenerati
    const listing = data.listing;
    if (field === 'titolo') {
      document.getElementById('titolo').value = listing.titolo || '';
      updateCounter('titolo');
    } else if (field === 'bullet_points') {
      ['bp1', 'bp2', 'bp3', 'bp4', 'bp5'].forEach(bp => {
        document.getElementById(bp).value = listing[bp] || '';
        updateCounter(bp);
      });
    } else if (field === 'descrizione') {
      document.getElementById('descrizione').value = listing.descrizione || '';
      updateCounter('descrizione');
    }

    // Aggiorna i dati originali con quelli nuovi (già salvati sul server)
    originalData = { ...originalData, ...listing };
    hasUnsavedChanges = false;
    hideSaveBar();

    showToast(`✅ ${labels[field].charAt(0).toUpperCase() + labels[field].slice(1)} rigenerato!`, 'success');

  } catch (err) {
    showToast(`Errore rigenerazione: ${err.message}`, 'error');
  } finally {
    hideLoading();
    setAiButtonsDisabled(false);
  }
}

function setAiButtonsDisabled(disabled) {
  ['regenTitoloBtn', 'regenBpBtn', 'regenDescBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// =============================================
// KEYWORD MINING AMAZON.IT
// =============================================

/**
 * Avvia il mining delle keyword da Amazon.it per questo prodotto
 */
async function mineKeywords() {
  if (!productId) {
    showToast('Product ID non disponibile', 'error');
    return;
  }

  const btn = document.getElementById('mineKeywordsBtn');
  const section = document.getElementById('keywordMiningSection');
  const loading = document.getElementById('keywordMiningLoading');
  const chips = document.getElementById('keywordChipsContainer');
  const status = document.getElementById('keywordMiningStatus');
  const copyBtn = document.getElementById('copyAllKeywordsBtn');
  const useBtn = document.getElementById('useKeywordsBtn');

  // Mostra la sezione e lo stato di caricamento
  section.style.display = 'block';
  loading.style.display = 'block';
  chips.innerHTML = '';
  status.textContent = '';
  copyBtn.style.display = 'none';
  useBtn.style.display = 'none';

  btn.disabled = true;
  const btnOriginal = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Mining...';

  // Scroll alla sezione
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch(`/api/keywords/mine/${productId}`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Errore nel mining');

    minedKeywords = data.keywords || [];

    loading.style.display = 'none';

    if (minedKeywords.length === 0) {
      chips.innerHTML = '<p style="color:var(--gray-500);font-size:14px;">Nessuna keyword trovata per questo prodotto.</p>';
      status.textContent = '(nessun risultato)';
    } else {
      renderKeywordChips(minedKeywords);
      status.textContent = `— ${minedKeywords.length} keyword trovate`;
      copyBtn.style.display = 'inline-flex';
      useBtn.style.display = 'inline-flex';
      showToast(`✅ ${minedKeywords.length} keyword trovate su Amazon.it!`, 'success');
    }

  } catch (err) {
    loading.style.display = 'none';
    chips.innerHTML = `<p style="color:var(--danger);font-size:14px;">Errore: ${escHtml(err.message)}</p>`;
    status.textContent = '(errore)';
    showToast(`Errore mining: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnOriginal;
  }
}

/**
 * Mostra le keyword come chip cliccabili
 * Click su chip → copia la keyword singola
 */
function renderKeywordChips(keywords) {
  const container = document.getElementById('keywordChipsContainer');
  container.innerHTML = '';

  keywords.forEach(kw => {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    chip.textContent = kw;
    chip.title = 'Clicca per copiare';
    chip.style.cssText = `
      display:inline-block;
      background:#eff6ff;
      color:#1d4ed8;
      border:1px solid #bfdbfe;
      border-radius:20px;
      padding:4px 12px;
      font-size:13px;
      cursor:pointer;
      transition:all 0.15s;
      user-select:none;
    `;
    chip.addEventListener('click', () => {
      navigator.clipboard.writeText(kw).then(() => {
        chip.style.background = '#dcfce7';
        chip.style.color = '#166534';
        chip.style.borderColor = '#86efac';
        const orig = chip.textContent;
        chip.textContent = '✅ ' + orig;
        setTimeout(() => {
          chip.style.background = '#eff6ff';
          chip.style.color = '#1d4ed8';
          chip.style.borderColor = '#bfdbfe';
          chip.textContent = orig;
        }, 1200);
      });
    });
    container.appendChild(chip);
  });
}

/**
 * Copia tutte le keyword minate come stringa separata da virgole
 */
function copyMinedKeywords() {
  if (!minedKeywords.length) {
    showToast('Nessuna keyword da copiare', 'warning');
    return;
  }
  const text = minedKeywords.join(', ');
  navigator.clipboard.writeText(text).then(() => {
    showToast(`📋 ${minedKeywords.length} keyword copiate!`, 'success');
  });
}

/**
 * Inietta le keyword minate nel campo "Parole Chiave" del listing
 * (aggiunge senza sovrascrivere quelle esistenti)
 */
function injectKeywordsToParoleChiave() {
  if (!minedKeywords.length) {
    showToast('Nessuna keyword da aggiungere', 'warning');
    return;
  }

  const el = document.getElementById('parole_chiave');
  if (!el) return;

  const existing = el.value.trim();
  const existingArr = existing
    ? existing.split(',').map(k => k.trim().toLowerCase()).filter(k => k)
    : [];

  // Aggiungi solo quelle non già presenti (case-insensitive)
  const toAdd = minedKeywords.filter(k => !existingArr.includes(k.toLowerCase()));

  if (toAdd.length === 0) {
    showToast('Tutte le keyword sono già presenti nel campo!', 'info');
    return;
  }

  el.value = existing
    ? existing + ', ' + toAdd.join(', ')
    : toAdd.join(', ');

  markUnsaved();
  showToast(`✨ ${toAdd.length} keyword aggiunte alle Parole Chiave!`, 'success');

  // Scroll al campo parole chiave
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();
}

// =============================================
// COPIA NEGLI APPUNTI
// =============================================
function copyField(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  const text = el.value;
  if (!text.trim()) {
    showToast('Il campo è vuoto!', 'warning');
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast(`📋 "${getLabelForField(fieldId)}" copiato!`, 'success');

    // Feedback visivo sul bottone
    const btns = document.querySelectorAll(`button[onclick="copyField('${fieldId}')"]`);
    btns.forEach(btn => {
      const original = btn.innerHTML;
      btn.innerHTML = '✅ Copiato!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove('copied');
      }, 1500);
    });
  }).catch(() => {
    // Fallback per browser vecchi
    el.select();
    document.execCommand('copy');
    showToast(`📋 "${getLabelForField(fieldId)}" copiato!`, 'success');
  });
}

function copyAllBullets() {
  const bps = ['bp1', 'bp2', 'bp3', 'bp4', 'bp5']
    .map(id => document.getElementById(id)?.value)
    .filter(v => v && v.trim())
    .join('\n\n');

  if (!bps) {
    showToast('Nessun bullet point da copiare!', 'warning');
    return;
  }

  navigator.clipboard.writeText(bps).then(() => {
    showToast('📋 Tutti i bullet points copiati!', 'success');
  }).catch(() => {
    showToast('Errore durante la copia', 'error');
  });
}

function getLabelForField(fieldId) {
  const labels = {
    titolo: 'Titolo',
    descrizione: 'Descrizione',
    bp1: 'Bullet Point 1',
    bp2: 'Bullet Point 2',
    bp3: 'Bullet Point 3',
    bp4: 'Bullet Point 4',
    bp5: 'Bullet Point 5',
    parole_chiave: 'Parole chiave',
    prezzo: 'Prezzo',
    quantita: 'Quantità',
  };
  return labels[fieldId] || fieldId;
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
