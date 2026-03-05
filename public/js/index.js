/* =============================================
   AMAZON AI LISTING TOOL — Dashboard JS
   ============================================= */

let allProducts = [];

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initCatalogUpload();
  loadProducts();
});

// =============================================
// AUTH
// =============================================
async function initAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    const user = await res.json();
    const badge = document.getElementById('userBadge');
    if (badge) badge.textContent = `👤 ${user.nome || user.email}`;
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
    populateDescDropdown(allProducts);
  } catch (err) {
    showToast('Errore nel caricamento dei prodotti', 'error');
  }
}

function updateStats(products) {
  const totali = products.length;
  const conListing = products.filter(p => parseInt(p.attributi_compilati) > 0).length;
  const senzaListing = totali - conListing;
  const senzaDescrizione = products.filter(p => !p.descrizione_raw).length;

  document.getElementById('statTotali').textContent = totali;
  document.getElementById('statConListing').textContent = conListing;
  document.getElementById('statSenzaListing').textContent = senzaListing;
  document.getElementById('statSenzaDescrizione').textContent = senzaDescrizione;

  const generateAllBtn = document.getElementById('generateAllBtn');
  // Mostra "Genera tutti" solo per prodotti con descrizione ma senza listing
  const daGenerare = products.filter(p =>
    parseInt(p.attributi_compilati) === 0 && p.descrizione_raw
  ).length;

  if (daGenerare > 0) {
    generateAllBtn.style.display = 'inline-flex';
    generateAllBtn.textContent = `✨ Genera tutti (${daGenerare})`;
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
        <p>Carica il catalogo Excel per iniziare.</p>
      </div>`;
    return;
  }

  const rows = products.map(p => {
    const compiled = parseInt(p.attributi_compilati) || 0;
    const total = parseInt(p.attributi_totali) || 0;
    const hasListing = compiled > 0;
    const hasDesc = !!p.descrizione_raw;
    const pct = total > 0 ? Math.round(compiled / total * 100) : 0;

    let statusBadge;
    if (!hasDesc) {
      statusBadge = `<span class="badge" style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;">📝 Manca descrizione</span>`;
    } else if (!hasListing) {
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

    // SKU info
    const skuInfo = p.sku_padre
      ? `<span style="font-size:11px;color:var(--gray-400);">SKU: ${escHtml(p.sku_padre)}</span>`
      : '';

    const createdAt = p.created_at
      ? new Date(p.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';

    return `
      <tr>
        <td>
          <span class="product-title">${escHtml(p.titolo_opera || '—')}</span>
          <span class="product-subtitle">${escHtml(p.autore || '—')}</span>
          ${skuInfo}
        </td>
        <td>
          ${p.misura_max ? `<div style="font-size:12px;">
            <div>Grande: ${escHtml(p.misura_max)}</div>
            ${p.misura_media ? `<div style="color:var(--gray-500);">Media: ${escHtml(p.misura_media)}</div>` : ''}
            ${p.misura_mini ? `<div style="color:var(--gray-500);">Mini: ${escHtml(p.misura_mini)}</div>` : ''}
          </div>` : escHtml(p.dimensioni || '—')}
        </td>
        <td>
          ${p.prezzo_max ? `<div style="font-size:12px;">
            <div>€${parseFloat(p.prezzo_max).toFixed(0)}</div>
            ${p.prezzo_media ? `<div style="color:var(--gray-500);">€${parseFloat(p.prezzo_media).toFixed(0)}</div>` : ''}
            ${p.prezzo_mini ? `<div style="color:var(--gray-500);">€${parseFloat(p.prezzo_mini).toFixed(0)}</div>` : ''}
          </div>` : (p.prezzo ? `€${parseFloat(p.prezzo).toFixed(2)}` : '—')}
        </td>
        <td>${statusBadge}</td>
        <td>${createdAt}</td>
        <td>
          <div class="actions-cell">
            <a href="/listing?id=${p.id}" class="btn btn-outline btn-sm">📄 Apri</a>
            ${!hasDesc
              ? `<button class="btn btn-secondary btn-sm" onclick="quickAddDesc(${p.id}, '${escHtml(p.titolo_opera || '').replace(/'/g, "\\'")}')">📝 Desc.</button>`
              : hasListing ? ''
              : `<button class="btn btn-primary btn-sm" onclick="generateListing(${p.id}, this)">✨ Genera</button>`
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
            <th>Opera / SKU</th>
            <th>Misure</th>
            <th>Prezzi</th>
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
    setTimeout(() => { window.location.href = `/listing?id=${productId}`; }, 600);
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
    hideLoading();
  }
}

async function generateAll() {
  const toGenerate = allProducts.filter(p =>
    parseInt(p.attributi_compilati) === 0 && p.descrizione_raw
  );
  if (toGenerate.length === 0) return;

  showLoading(
    `Generazione di ${toGenerate.length} listing...`,
    'Claude sta lavorando. Potrebbe richiedere qualche minuto.'
  );

  let success = 0, errors = 0;
  for (const product of toGenerate) {
    try {
      const res = await fetch(`/api/listings/generate/${product.id}`, { method: 'POST' });
      if (res.ok) success++; else errors++;
    } catch { errors++; }
    document.getElementById('loadingSubtitle').textContent =
      `Completati: ${success + errors} / ${toGenerate.length}`;
  }

  hideLoading();
  if (errors === 0) showToast(`✅ Tutti i ${success} listing generati!`, 'success');
  else showToast(`⚠️ ${success} generati, ${errors} errori.`, 'warning');
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
// TAB SWITCHING (3 tab)
// =============================================
function switchImportTab(tab) {
  const tabs = ['catalog', 'desc', 'paste'];
  const btns = {
    catalog: document.getElementById('tabCatalogBtn'),
    desc: document.getElementById('tabDescBtn'),
    paste: document.getElementById('tabPasteBtn'),
  };
  const panels = {
    catalog: document.getElementById('tabCatalog'),
    desc: document.getElementById('tabDesc'),
    paste: document.getElementById('tabPaste'),
  };

  tabs.forEach(t => {
    const isActive = t === tab;
    panels[t].style.display = isActive ? '' : 'none';
    btns[t].style.color = isActive ? 'var(--primary)' : 'var(--gray-500)';
    btns[t].style.borderBottom = isActive ? '2px solid var(--primary)' : '2px solid transparent';
  });

  // Quando si apre il tab descrizione, aggiorna il dropdown
  if (tab === 'desc') populateDescDropdown(allProducts);
}

// =============================================
// TAB 1 — CATALOGO UPLOAD
// =============================================
function initCatalogUpload() {
  const uploadArea = document.getElementById('catalogUploadArea');
  const fileInput = document.getElementById('catalogFileInput');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleCatalogFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleCatalogFile(e.target.files[0]);
    fileInput.value = '';
  });
}

async function handleCatalogFile(file) {
  const allowed = ['.xlsx', '.xls', '.csv'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    showToast(`Formato non supportato per il catalogo: ${ext}. Usa XLSX o CSV.`, 'error');
    return;
  }

  showLoading('Importazione catalogo...', `Elaborazione di: ${file.name}`);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload/catalog', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    hideLoading();
    showToast(data.message, 'success');
    loadProducts();
  } catch (err) {
    hideLoading();
    showToast(`Errore importazione: ${err.message}`, 'error');
  }
}

// =============================================
// TAB 2 — AGGIUNGI DESCRIZIONE
// =============================================
function populateDescDropdown(products) {
  const select = document.getElementById('productSelect');
  if (!select) return;

  const current = select.value;
  select.innerHTML = '<option value="">— Seleziona un\'opera —</option>';

  products.forEach(p => {
    const hasDesc = !!p.descrizione_raw;
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = `${p.titolo_opera || '—'}${hasDesc ? ' ✅' : ' ⚠️ manca descrizione'}`;
    if (current && current == p.id) option.selected = true;
    select.appendChild(option);
  });

  select.onchange = () => showSelectedProductInfo(select.value);
}

function showSelectedProductInfo(productId) {
  const infoDiv = document.getElementById('selectedProductInfo');
  if (!productId) { infoDiv.style.display = 'none'; return; }

  const product = allProducts.find(p => p.id == productId);
  if (!product) { infoDiv.style.display = 'none'; return; }

  const hasDesc = !!product.descrizione_raw;
  infoDiv.style.display = 'block';
  infoDiv.innerHTML = `
    <strong>${escHtml(product.titolo_opera || '—')}</strong>
    ${product.sku_padre ? `<span style="color:var(--gray-500);margin-left:8px;">SKU padre: ${escHtml(product.sku_padre)}</span>` : ''}
    <div style="margin-top:4px;color:var(--gray-600);">
      ${product.misura_max ? `Misure: ${escHtml(product.misura_max)}${product.misura_media ? `, ${escHtml(product.misura_media)}` : ''}${product.misura_mini ? `, ${escHtml(product.misura_mini)}` : ''}` : ''}
    </div>
    <div style="margin-top:4px;">
      ${hasDesc
        ? `<span style="color:#16a34a;font-size:12px;">✅ Descrizione già presente — verrà sovrascritta</span>`
        : `<span style="color:#92400e;font-size:12px;">⚠️ Nessuna descrizione — verrà aggiunta</span>`
      }
    </div>`;
}

// Shortcut: dal pulsante "📝 Desc." nella tabella
function quickAddDesc(productId, titoloOpera) {
  switchImportTab('desc');
  const select = document.getElementById('productSelect');
  if (select) {
    select.value = productId;
    showSelectedProductInfo(productId);
  }
  document.getElementById('descTextarea').focus();
  document.querySelector('.card:first-of-type').scrollIntoView({ behavior: 'smooth' });
}

async function submitDescription() {
  const productId = document.getElementById('productSelect').value;
  const testo = document.getElementById('descTextarea').value.trim();

  if (!productId) {
    showToast('Seleziona prima un\'opera dal menu', 'warning');
    return;
  }
  if (!testo) {
    showToast('Incolla la descrizione prima di salvare', 'warning');
    return;
  }

  const btn = document.getElementById('submitDescBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvataggio...';

  try {
    const res = await fetch(`/api/products/${productId}/description`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('✅ Descrizione salvata!', 'success');
    document.getElementById('descTextarea').value = '';
    document.getElementById('productSelect').value = '';
    document.getElementById('selectedProductInfo').style.display = 'none';
    loadProducts();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// =============================================
// TAB 3 — TESTO LIBERO (crea nuovo prodotto)
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
