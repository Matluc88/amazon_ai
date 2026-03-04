/* =============================================
   AMAZON AI LISTING TOOL — Dashboard JS
   ============================================= */

let allProducts = [];

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  loadProducts();
});

// =============================================
// CARICAMENTO PRODOTTI
// =============================================
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    allProducts = await res.json();
    renderProducts(allProducts);
    updateStats(allProducts);
  } catch (err) {
    showToast('Errore nel caricamento dei prodotti', 'error');
  }
}

function updateStats(products) {
  const totali = products.length;
  const conListing = products.filter(p => p.listing_id).length;
  const senzaListing = totali - conListing;

  document.getElementById('statTotali').textContent = totali;
  document.getElementById('statConListing').textContent = conListing;
  document.getElementById('statSenzaListing').textContent = senzaListing;

  // Mostra/nascondi bottone "Genera tutti"
  const generateAllBtn = document.getElementById('generateAllBtn');
  if (senzaListing > 0) {
    generateAllBtn.style.display = 'inline-flex';
    generateAllBtn.textContent = `✨ Genera tutti i listing (${senzaListing})`;
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
    const hasListing = !!p.listing_id;
    const statusBadge = hasListing
      ? `<span class="badge badge-status-done">✅ Listing generato</span>`
      : `<span class="badge badge-status-pending">⏳ Da generare</span>`;

    const updatedAt = p.listing_updated_at
      ? new Date(p.listing_updated_at).toLocaleDateString('it-IT', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        })
      : '—';

    return `
      <tr>
        <td>
          <span class="product-title">${escHtml(p.titolo_opera)}</span>
          <span class="product-subtitle">${escHtml(p.autore || '—')}</span>
        </td>
        <td>${escHtml(p.dimensioni || '—')}</td>
        <td>${escHtml(p.tecnica || '—')}</td>
        <td>${p.prezzo ? `€${parseFloat(p.prezzo).toFixed(2)}` : '—'}</td>
        <td>${statusBadge}</td>
        <td>${updatedAt}</td>
        <td>
          <div class="actions-cell">
            ${hasListing
              ? `<a href="/listing?id=${p.listing_id}" class="btn btn-outline btn-sm">📄 Apri</a>`
              : `<button class="btn btn-primary btn-sm" onclick="generateListing(${p.id}, this)">✨ Genera</button>`
            }
            <button class="btn btn-secondary btn-sm" onclick="deleteProduct(${p.id}, this)">🗑️</button>
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
            <th>Ultimo aggiornamento</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Collega il bottone "Genera tutti"
  document.getElementById('generateAllBtn').onclick = generateAll;
}

// =============================================
// GENERAZIONE LISTING
// =============================================
async function generateListing(productId, btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generazione...';

  showLoading('Generazione listing in corso...', 'Claude sta creando il tuo listing Amazon');

  try {
    const res = await fetch(`/api/listings/generate/${productId}`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Errore sconosciuto');

    showToast('✅ Listing generato con successo!', 'success');

    // Reindirizza alla pagina del listing
    setTimeout(() => {
      window.location.href = `/listing?id=${data.listing.id}`;
    }, 800);

  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
    hideLoading();
  }
}

async function generateAll() {
  const toGenerate = allProducts.filter(p => !p.listing_id);
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
      if (res.ok) {
        success++;
      } else {
        errors++;
      }
    } catch {
      errors++;
    }
    // Aggiorna il testo del loading
    document.getElementById('loadingSubtitle').textContent =
      `Completati: ${success + errors} / ${toGenerate.length}`;
  }

  hideLoading();

  if (errors === 0) {
    showToast(`✅ Tutti i ${success} listing generati con successo!`, 'success');
  } else {
    showToast(`⚠️ ${success} generati, ${errors} errori.`, 'warning');
  }

  loadProducts();
}

// =============================================
// ELIMINA PRODOTTO
// =============================================
async function deleteProduct(productId, btn) {
  if (!confirm('Eliminare questo prodotto e il suo listing? L\'operazione non è reversibile.')) return;

  try {
    const res = await fetch(`/api/products/${productId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Prodotto eliminato', 'success');
    loadProducts();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
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

  showLoading('Importazione in corso...', `Elaborazione di: ${file.name}`);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
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
