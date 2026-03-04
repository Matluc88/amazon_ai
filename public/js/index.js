/* =============================================
   AMAZON AI LISTING TOOL — Dashboard JS
   Sistema attributi dinamico + Auth
   ============================================= */

let allProducts = [];

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initUpload();
  loadProducts();
});

// =============================================
// AUTH
// =============================================
async function initAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return;
    }
    const user = await res.json();
    const badge = document.getElementById('userBadge');
    if (badge) {
      badge.textContent = `👤 ${user.nome || user.email}`;
    }
  } catch {
    window.location.href = '/login.html';
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

// =============================================
// CARICAMENTO PRODOTTI
// =============================================
async function loadProducts() {
  try {
    const res = await fetch('/api/listings');
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login.html'; return; }
      throw new Error('Errore server');
    }
    allProducts = await res.json();
    renderProducts(allProducts);
    updateStats(allProducts);
  } catch (err) {
    showToast('Errore nel caricamento dei prodotti', 'error');
  }
}

function updateStats(products) {
  const totali = products.length;
  const conListing = products.filter(p => parseInt(p.attributi_compilati) > 0).length;
  const senzaListing = totali - conListing;

  document.getElementById('statTotali').textContent = totali;
  document.getElementById('statConListing').textContent = conListing;
  document.getElementById('statSenzaListing').textContent = senzaListing;

  const generateAllBtn = document.getElementById('generateAllBtn');
  if (senzaListing > 0) {
    generateAllBtn.style.display = 'inline-flex';
    generateAllBtn.textContent = `✨ Genera tutti (${senzaListing})`;
    generateAllBtn.onclick = generateAll;
  } else {
    generateAllBtn.style.display = 'none';
  }
}

function renderProducts(products) {
  const container = document.getElementById('productsContainer');

  if (!products || products.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🎨</span>
        <h3>Nessun prodotto ancora</h3>
        <p>Carica un file per iniziare ad importare i tuoi prodotti.</p>
      </div>`;
    return;
  }

  const rows = products.map(p => {
    const compiled = parseInt(p.attributi_compilati) || 0;
    const total = parseInt(p.attributi_totali) || 0;
    const hasListing = compiled > 0;
    const pct = total > 0 ? Math.round(compiled / total * 100) : 0;

    let statusBadge;
    if (!hasListing) {
      statusBadge = `<span class="badge badge-status-pending">⏳ Da generare</span>`;
    } else if (pct < 100) {
      statusBadge = `
        <div style="min-width:120px;">
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:3px;">${compiled}/${total} attributi (${pct}%)</div>
          <div style="background:var(--gray-200);border-radius:10px;height:4px;">
            <div style="background:var(--primary);width:${pct}%;height:100%;border-radius:10px;"></div>
          </div>
        </div>`;
    } else {
      statusBadge = `<span class="badge badge-status-done">✅ Completo</span>`;
    }

    const createdAt = p.created_at
      ? new Date(p.created_at).toLocaleDateString('it-IT', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        })
      : '—';

    return `
      <tr>
        <td>
          <span class="product-title">${escHtml(p.titolo_opera || '—')}</span>
          <span class="product-subtitle">${escHtml(p.autore || '—')}</span>
        </td>
        <td>${escHtml(p.dimensioni || '—')}</td>
        <td>${escHtml(p.tecnica || '—')}</td>
        <td>${p.prezzo ? `€${parseFloat(p.prezzo).toFixed(2)}` : '—'}</td>
        <td>${statusBadge}</td>
        <td>${createdAt}</td>
        <td>
          <div class="actions-cell">
            <a href="/listing?id=${p.id}" class="btn btn-outline btn-sm">📄 Apri</a>
            ${!hasListing
              ? `<button class="btn btn-primary btn-sm" onclick="generateListing(${p.id}, this)">✨ Genera</button>`
              : ''
            }
            <button class="btn btn-secondary btn-sm" onclick="deleteProduct(${p.id}, this)" title="Elimina">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Opera / Autore</th>
            <th>Dimensioni</th>
            <th>Tecnica</th>
            <th>Prezzo</th>
            <th>Stato</th>
            <th>Importato il</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// =============================================
// GENERAZIONE LISTING
// =============================================
async function generateListing(productId, btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  showLoading('Generazione listing...', 'Claude sta creando gli attributi Amazon');

  try {
    const res = await fetch(`/api/listings/generate/${productId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore sconosciuto');

    showToast('✅ Listing generato!', 'success');
    setTimeout(() => {
      window.location.href = `/listing?id=${productId}`;
    }, 600);

  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
    hideLoading();
  }
}

async function generateAll() {
  const toGenerate = allProducts.filter(p => parseInt(p.attributi_compilati) === 0);
  if (toGenerate.length === 0) return;

  showLoading(
    `Generazione di ${toGenerate.length} listing...`,
    'Claude sta lavorando. Potrebbe richiedere qualche minuto.'
  );

  let success = 0;
  let errors = 0;

  for (const product of toGenerate) {
    try {
      const res = await fetch(`/api/listings/generate/${product.id}`, { method: 'POST' });
      if (res.ok) success++;
      else errors++;
    } catch {
      errors++;
    }
    document.getElementById('loadingSubtitle').textContent =
      `Completati: ${success + errors} / ${toGenerate.length}`;
  }

  hideLoading();

  if (errors === 0) {
    showToast(`✅ Tutti i ${success} listing generati!`, 'success');
  } else {
    showToast(`⚠️ ${success} generati, ${errors} errori.`, 'warning');
  }

  loadProducts();
}

// =============================================
// ELIMINA PRODOTTO
// =============================================
async function deleteProduct(productId, btn) {
  if (!confirm('Eliminare questo prodotto e tutti i suoi attributi? L\'operazione non è reversibile.')) return;

  btn.disabled = true;
  try {
    const res = await fetch(`/api/products/${productId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Prodotto eliminato', 'success');
    loadProducts();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    btn.disabled = false;
  }
}

// =============================================
// IMPORT TAB SWITCHING
// =============================================
function switchImportTab(tab) {
  const isFile = tab === 'file';
  document.getElementById('tabFile').style.display = isFile ? '' : 'none';
  document.getElementById('tabPaste').style.display = isFile ? 'none' : '';

  const fileBtn = document.getElementById('tabFileBtn');
  const pasteBtn = document.getElementById('tabPasteBtn');

  fileBtn.style.color = isFile ? 'var(--primary)' : 'var(--gray-500)';
  fileBtn.style.borderBottom = isFile ? '2px solid var(--primary)' : '2px solid transparent';

  pasteBtn.style.color = isFile ? 'var(--gray-500)' : 'var(--primary)';
  pasteBtn.style.borderBottom = isFile ? '2px solid transparent' : '2px solid var(--primary)';
}

// =============================================
// SUBMIT PASTED TEXT
// =============================================
async function submitPastedText() {
  const textarea = document.getElementById('pasteTextarea');
  const text = textarea.value.trim();

  if (!text) {
    showToast('Incolla prima il testo del prodotto!', 'warning');
    return;
  }

  const btn = document.getElementById('submitPasteBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Importazione...';

  showLoading('Importazione testo...', 'Analisi della descrizione in corso');

  // Crea un file .txt virtuale dal testo incollato
  const blob = new Blob([text], { type: 'text/plain' });
  const file = new File([blob], 'prodotto.txt', { type: 'text/plain' });

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    hideLoading();
    showToast(`✅ ${data.message}`, 'success');
    textarea.value = '';
    loadProducts();
  } catch (err) {
    hideLoading();
    showToast(`Errore importazione: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// =============================================
// UPLOAD FILE
// =============================================
function initUpload() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
    fileInput.value = '';
  });
}

async function handleFile(file) {
  const allowed = ['.xlsx', '.xls', '.csv', '.txt'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

  if (!allowed.includes(ext)) {
    showToast(`Formato non supportato: ${ext}. Usa XLSX, CSV o TXT.`, 'error');
    return;
  }

  showLoading('Importazione...', `Elaborazione di: ${file.name}`);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    hideLoading();
    showToast(`✅ ${data.message}`, 'success');
    loadProducts();
  } catch (err) {
    hideLoading();
    showToast(`Errore importazione: ${err.message}`, 'error');
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
