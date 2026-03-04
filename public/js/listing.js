/* =============================================
   AMAZON AI LISTING TOOL — Listing Detail JS
   ============================================= */

let listingId = null;
let originalData = {};
let hasUnsavedChanges = false;

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
