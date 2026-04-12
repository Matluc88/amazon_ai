/* =============================================
   AMAZON AI LISTING TOOL — Dashboard JS
   ============================================= */

let allProducts = [];
let selectedProductIds = new Set(); // ID prodotti selezionati per l'export

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
    loadEditingStatus(); // overlay "🔵 In corso"
  } catch (err) {
    showToast('Errore nel caricamento dei prodotti', 'error');
  }
}

// Sovrappone badge "🔵 In corso (Nome)" per le schede aperte in questo momento
async function loadEditingStatus() {
  try {
    const res = await fetch('/api/products/editing');
    if (!res.ok) return;
    const sessions = await res.json();
    sessions.forEach(s => {
      const cell = document.getElementById(`amazon-cell-${s.productId}`);
      if (!cell) return;
      cell.innerHTML = `
        <span class="amazon-status-badge"
              style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;"
              title="Sta lavorando su questa scheda">
          🔵 In corso
          <span style="display:block;font-size:10px;opacity:0.8;font-weight:400;">${escHtml(s.nome)}</span>
        </span>`;
    });
  } catch (_) { /* non critico */ }
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

  // Mostra "Scarica XLSM" se ci sono prodotti con listing compilato
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  if (downloadAllBtn) {
    if (conListing > 0) {
      downloadAllBtn.style.display = 'inline-flex';
      downloadAllBtn.textContent = `📥 Scarica XLSM per Amazon (${conListing})`;
    } else {
      downloadAllBtn.style.display = 'none';
    }
  }

  // Mostra "Scarica XLSM Francia" se ci sono prodotti con listing compilato
  const downloadAllFRBtn = document.getElementById('downloadAllFRBtn');
  if (downloadAllFRBtn) {
    if (conListing > 0) {
      downloadAllFRBtn.style.display = 'inline-flex';
      downloadAllFRBtn.textContent = `🇫🇷 Scarica XLSM Francia (${conListing})`;
    } else {
      downloadAllFRBtn.style.display = 'none';
    }
  }

  // Mostra "Scarica XLSM Germania" se ci sono prodotti con listing compilato
  const downloadAllDEBtn = document.getElementById('downloadAllDEBtn');
  if (downloadAllDEBtn) {
    if (conListing > 0) {
      downloadAllDEBtn.style.display = 'inline-flex';
      downloadAllDEBtn.textContent = `🇩🇪 Scarica XLSM Germania (${conListing})`;
    } else {
      downloadAllDEBtn.style.display = 'none';
    }
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
    const isChecked = selectedProductIds.has(p.id);
    const amazonStatus = getAmazonStatus(p);
    const amazonBadge = amazonStatus === 'live'
      ? `<span class="amazon-status-badge amazon-status-live">🟢 Live</span>`
      : amazonStatus === 'partial'
        ? `<span class="amazon-status-badge amazon-status-partial">🟡 Parziale</span>`
        : `<span class="amazon-status-badge amazon-status-none">🔴 Non caricato</span>`;

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

    const skuInfo = p.sku_padre
      ? `<span style="font-size:11px;color:var(--gray-400);">SKU: ${escHtml(p.sku_padre)}</span>`
      : '';

    const createdAt = p.created_at
      ? new Date(p.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';

    return `
      <tr id="row-${p.id}" data-amazon-status="${amazonStatus}" style="${isChecked ? 'background:#eff6ff;' : ''}">
        <td style="width:36px;text-align:center;padding:8px 6px;">
          <input type="checkbox" class="prod-checkbox"
            style="width:16px;height:16px;cursor:pointer;accent-color:#2563eb;"
            data-id="${p.id}"
            ${isChecked ? 'checked' : ''}
            onchange="toggleProductSelection(${p.id}, this.checked)">
        </td>
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
        <td id="amazon-cell-${p.id}">${amazonBadge}</td>
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
            <th style="width:36px;text-align:center;padding:8px 6px;">
              <input type="checkbox" id="selectAllCheckbox" title="Seleziona tutti"
                style="width:16px;height:16px;cursor:pointer;accent-color:#2563eb;"
                onchange="toggleSelectAll(this.checked)">
            </th>
            <th>Opera / SKU</th>
            <th>Misure</th>
            <th>Prezzi</th>
            <th>Stato</th>
            <th>🛒 Amazon</th>
            <th>Importato il</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Aggiorna lo stato del "select all" checkbox
  updateSelectAllCheckbox();
}

// =============================================
// SELEZIONE PRODOTTI PER EXPORT
// =============================================
function toggleProductSelection(productId, checked) {
  if (checked) {
    selectedProductIds.add(productId);
  } else {
    selectedProductIds.delete(productId);
  }
  // Evidenzia/deseleziona riga
  const row = document.getElementById(`row-${productId}`);
  if (row) row.style.background = checked ? '#eff6ff' : '';

  updateSelectionBar();
  updateSelectAllCheckbox();
}

function toggleSelectAll(checked) {
  if (checked) {
    allProducts.forEach(p => selectedProductIds.add(p.id));
  } else {
    selectedProductIds.clear();
  }
  // Aggiorna tutte le checkbox e i colori delle righe
  document.querySelectorAll('.prod-checkbox').forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.id);
    const row = document.getElementById(`row-${id}`);
    if (row) row.style.background = checked ? '#eff6ff' : '';
  });
  updateSelectionBar();
}

function deselectAll() {
  selectedProductIds.clear();
  document.querySelectorAll('.prod-checkbox').forEach(cb => {
    cb.checked = false;
    const id = parseInt(cb.dataset.id);
    const row = document.getElementById(`row-${id}`);
    if (row) row.style.background = '';
  });
  updateSelectionBar();
  updateSelectAllCheckbox();
}

function updateSelectionBar() {
  const bar = document.getElementById('selectionBar');
  const count = selectedProductIds.size;
  if (!bar) return;
  if (count > 0) {
    bar.style.display = 'flex';
    document.getElementById('selectionCount').textContent = `✅ ${count} ${count === 1 ? 'prodotto selezionato' : 'prodotti selezionati'}`;
  } else {
    bar.style.display = 'none';
  }
}

function updateSelectAllCheckbox() {
  const cb = document.getElementById('selectAllCheckbox');
  if (!cb) return;
  const total = allProducts.length;
  const sel = selectedProductIds.size;
  cb.checked = sel > 0 && sel === total;
  cb.indeterminate = sel > 0 && sel < total;
}

// =============================================
// DOWNLOAD XLSM — SOLO SELEZIONATI
// =============================================
async function downloadSelectedForAmazon() {
  const ids = Array.from(selectedProductIds);
  if (ids.length === 0) {
    showToast('Seleziona almeno un prodotto prima di esportare', 'warning');
    return;
  }

  const btn = document.getElementById('exportSelectedBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Generazione...'; }

  try {
    const res = await fetch('/api/export/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: ids })
    });
    if (!res.ok) {
      let msg = 'Errore durante l\'export';
      try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `WALL_ART_SELECTED.xlsm`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const count = res.headers.get('X-Product-Count') || ids.length;
    showToast(`✅ File scaricato con ${count} prodotti selezionati!`, 'success');
  } catch (err) {
    showToast(`❌ Download fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '📥 Esporta selezionati'; }
  }
}

// =============================================
// DOWNLOAD XLSM FR — SOLO SELEZIONATI
// =============================================
async function downloadSelectedForAmazonFR() {
  const ids = Array.from(selectedProductIds);
  if (ids.length === 0) {
    showToast('Seleziona almeno un prodotto prima di esportare', 'warning');
    return;
  }

  const btn = document.getElementById('exportSelectedFRBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Generazione...'; }

  try {
    const res = await fetch('/api/export/fr/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: ids })
    });
    if (!res.ok) {
      let msg = 'Errore durante l\'export FR';
      try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `WALL_ART_FR_SELECTED.xlsm`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const count = res.headers.get('X-Product-Count') || ids.length;
    showToast(`🇫🇷 File Francia scaricato con ${count} prodotti selezionati!`, 'success');
  } catch (err) {
    showToast(`❌ Download FR fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '🇫🇷 Esporta FR selezionati'; }
  }
}

// =============================================
// DOWNLOAD XLSM FR (tutti i prodotti)
// =============================================
async function downloadAllForAmazonFR() {
  const btn = document.getElementById('downloadAllFRBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Generazione...'; }

  try {
    const res = await fetch('/api/export/fr/all');
    if (!res.ok) {
      let msg = 'Errore durante l\'export FR';
      try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `WALL_ART_FR_ALL.xlsm`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const count = res.headers.get('X-Product-Count') || '?';
    showToast(`🇫🇷 File Francia scaricato con ${count} prodotti. Carica su Amazon.fr!`, 'success');
  } catch (err) {
    showToast(`❌ Download FR fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '🇫🇷 Scarica XLSM Francia'; }
  }
}

// =============================================
// GENERA LISTING DE — SELEZIONATI (bulk)
// =============================================
async function generateSelectedDE() {
  const ids = Array.from(selectedProductIds);
  if (ids.length === 0) {
    showToast('Seleziona almeno un prodotto prima di generare', 'warning');
    return;
  }

  const btn = document.getElementById('generateSelectedDEBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; }

  showLoading(
    `🇩🇪 Generazione listing DE per ${ids.length} prodotti...`,
    'Claude sta creando gli attributi Amazon in tedesco.'
  );

  let success = 0, errors = 0;
  for (let i = 0; i < ids.length; i++) {
    try {
      const res = await fetch(`/api/listings/generate-de/${ids[i]}`, { method: 'POST' });
      if (res.ok) success++; else errors++;
    } catch { errors++; }
    document.getElementById('loadingSubtitle').textContent =
      `Completati: ${success + errors} / ${ids.length}`;
  }

  hideLoading();
  if (errors === 0) showToast(`🇩🇪 Tutti i ${success} listing DE generati!`, 'success');
  else showToast(`⚠️ ${success} generati DE, ${errors} errori.`, 'warning');
  if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '🇩🇪 Genera DE selezionati'; }
}

// =============================================
// DOWNLOAD XLSM DE — SOLO SELEZIONATI
// =============================================
async function downloadSelectedForAmazonDE() {
  const ids = Array.from(selectedProductIds);
  if (ids.length === 0) {
    showToast('Seleziona almeno un prodotto prima di esportare', 'warning');
    return;
  }

  const btn = document.getElementById('exportSelectedDEBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Generazione...'; }

  try {
    const res = await fetch('/api/export/de/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: ids })
    });
    if (!res.ok) {
      let msg = 'Errore durante l\'export DE';
      try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `WALL_ART_DE_SELECTED.xlsm`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const count = res.headers.get('X-Product-Count') || ids.length;
    showToast(`🇩🇪 File Germania scaricato con ${count} prodotti selezionati!`, 'success');
  } catch (err) {
    showToast(`❌ Download DE fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '🇩🇪 Esporta DE selezionati'; }
  }
}

// =============================================
// DOWNLOAD XLSM DE (tutti i prodotti)
// =============================================
async function downloadAllForAmazonDE() {
  const btn = document.getElementById('downloadAllDEBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Generazione...'; }

  try {
    const res = await fetch('/api/export/de/all');
    if (!res.ok) {
      let msg = 'Errore durante l\'export DE';
      try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `WALL_ART_DE_ALL.xlsm`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const count = res.headers.get('X-Product-Count') || '?';
    showToast(`🇩🇪 File Germania scaricato con ${count} prodotti. Carica su Amazon.de!`, 'success');
  } catch (err) {
    showToast(`❌ Download DE fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '🇩🇪 Scarica XLSM Germania'; }
  }
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
// DOWNLOAD XLSM PER AMAZON (tutti i prodotti)
// =============================================
async function downloadAllForAmazon() {
  const btn = document.getElementById('downloadAllBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Generazione...'; }

  try {
    const res = await fetch('/api/export/all');
    if (!res.ok) {
      let msg = 'Errore durante l\'export';
      try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);

    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `WALL_ART_ALL.xlsm`;

    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const count = res.headers.get('X-Product-Count') || '?';
    showToast(`✅ File scaricato con ${count} prodotti. Carica su Amazon Seller Central!`, 'success');
  } catch (err) {
    showToast(`❌ Download fallito: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '📥 Scarica XLSM per Amazon'; }
  }
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
  const tabs = ['catalog', 'desc', 'paste', 'asin'];
  const btns = {
    catalog: document.getElementById('tabCatalogBtn'),
    desc:    document.getElementById('tabDescBtn'),
    paste:   document.getElementById('tabPasteBtn'),
    asin:    document.getElementById('tabAsinBtn'),
  };
  const panels = {
    catalog: document.getElementById('tabCatalog'),
    desc:    document.getElementById('tabDesc'),
    paste:   document.getElementById('tabPaste'),
    asin:    document.getElementById('tabAsin'),
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

// =============================================
// AMAZON STATUS FILTER
// =============================================
function getAmazonStatus(p) {
  // Controlla solo le varianti che il prodotto ha effettivamente (in base alle misure)
  const checks = [];
  if (p.misura_max)   checks.push(p.asin_max);
  if (p.misura_media) checks.push(p.asin_media);
  if (p.misura_mini)  checks.push(p.asin_mini);

  if (checks.length === 0) return 'none';
  const filled = checks.filter(v => v && v.trim()).length;
  if (filled === checks.length) return 'live';
  // Parziale: ha qualche ASIN, OPPURE ha la descrizione caricata (lavoro iniziato)
  if (filled > 0 || !!p.descrizione_raw) return 'partial';
  return 'none';
}

function filterByAmazonStatus() {
  const val = document.getElementById('filterAmazon').value;
  document.querySelectorAll('#productsContainer tbody tr').forEach(row => {
    if (val === 'all' || row.dataset.amazonStatus === val) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================
// TAB 4 — AGGIORNA ASIN DAL REPORT INVENTARIO
// =============================================

/**
 * Gestisce la selezione del file report inventario Amazon.
 * Parsa il TSV client-side e mostra anteprima delle entry trovate.
 */
function handleAsinFileSelect(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const entries = parseInventoryReport(text);
    const infoDiv = document.getElementById('asinFileInfo');
    const importBtn = document.getElementById('importAsinsBtn');
    const area = document.getElementById('asinUploadArea');

    if (entries.length === 0) {
      infoDiv.style.display = 'block';
      infoDiv.innerHTML = `<span style="color:var(--danger);">⚠️ Nessuna entry trovata nel file. Verifica che sia il formato corretto (TSV con colonne sku, asin).</span>`;
      importBtn.disabled = true;
      return;
    }

    // Mostra anteprima
    const prodotti = new Set(entries.map(e => e.sku.replace(/[-_](max|media|mini)$/i, '')));
    infoDiv.style.display = 'block';
    infoDiv.innerHTML = `
      <strong>📄 File:</strong> ${escHtml(file.name)} &nbsp;
      <strong>📊 Entry trovate:</strong> ${entries.length} &nbsp;
      <strong>🖼️ Prodotti:</strong> ${prodotti.size}
      <div style="margin-top:6px;font-size:12px;color:var(--gray-500);">
        SKU: ${[...prodotti].map(s => escHtml(s)).join(', ')}
      </div>`;

    // Aggiorna upload area con nome file
    area.innerHTML = `<span class="upload-icon">✅</span><h3>${escHtml(file.name)}</h3><p>${entries.length} entry, ${prodotti.size} prodotti</p>`;

    importBtn.disabled = false;

    // Salva le entry in memoria per quando si clicca il pulsante
    importBtn._entries = entries;
  };
  reader.readAsText(file);
}

/**
 * Parsa il TSV del Report Inventario Amazon.
 * Formato atteso (tab-separated):
 *   sku  asin  price  quantity  ...
 *   bacio-molo-max  B0XXXXXXXXX  330.00  100  ...
 */
function parseInventoryReport(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  // Trova la riga header (contiene "sku" e "asin" come colonne)
  let headerIdx = -1;
  let skuCol = -1;
  let asinCol = -1;

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const cols = lines[i].split('\t').map(c => c.trim().toLowerCase());
    // Supporta sia "Report inventario" (sku, asin) sia "Report tutte le offerte" (seller-sku, asin1)
    const si = cols.findIndex(c => c === 'sku' || c === 'seller-sku');
    const ai = cols.findIndex(c => c === 'asin' || c === 'asin1');
    if (si >= 0 && ai >= 0) {
      headerIdx = i;
      skuCol = si;
      asinCol = ai;
      break;
    }
  }

  if (headerIdx === -1) return []; // header non trovato

  const entries = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split('\t').map(c => c.trim());
    const sku = cols[skuCol] || '';
    const asin = cols[asinCol] || '';
    if (sku && asin && /^[A-Z0-9]{10}$/i.test(asin)) {
      entries.push({ sku, asin });
    }
  }
  return entries;
}

/**
 * Invia le entry parsate all'endpoint /api/products/import-asins
 * e mostra il report risultato.
 */
async function importAsins() {
  const btn = document.getElementById('importAsinsBtn');
  const entries = btn._entries;

  if (!entries || entries.length === 0) {
    showToast('Seleziona prima un file', 'warning');
    return;
  }

  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Elaborazione...';

  try {
    const res = await fetch('/api/products/import-asins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const { updated, skipped, not_found, errors } = data;

    // Toast riassuntivo
    const type = updated > 0 ? 'success' : (not_found > 0 || errors > 0 ? 'warning' : 'info');
    showToast(
      `🛒 ${updated} aggiornati | ⏩ ${skipped} già presenti | ❌ ${not_found + errors} non trovati/errori`,
      type
    );

    // Render tabella dettaglio
    renderAsinImportResults(data);

    // Ricarica prodotti se ci sono aggiornamenti
    if (updated > 0) loadProducts();

    // Reset
    btn._entries = null;

  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

/**
 * Mostra il report dettagliato dell'import ASIN.
 */
function renderAsinImportResults(data) {
  const container = document.getElementById('asinImportResults');
  if (!container) return;

  const { updated, skipped, not_found, errors, details } = data;

  const statusIcon = { updated: '✅', skipped: '⏩', not_found: '⚠️', error: '❌' };
  const statusColor = { updated: '#16a34a', skipped: '#6b7280', not_found: '#d97706', error: '#dc2626' };

  const rows = (details || []).map(d => `
    <tr>
      <td style="font-family:monospace;font-size:12px;">${escHtml(d.sku)}</td>
      <td style="font-family:monospace;font-size:12px;">${escHtml(d.asin)}</td>
      <td style="color:${statusColor[d.status] || '#374151'};font-weight:600;font-size:12px;">
        ${statusIcon[d.status] || ''} ${escHtml(d.msg)}
      </td>
    </tr>`).join('');

  container.style.display = 'block';
  container.innerHTML = `
    <div style="border:1px solid var(--gray-200);border-radius:var(--radius);overflow:hidden;">
      <div style="padding:12px 16px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);
                  display:flex;gap:20px;align-items:center;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:14px;">📊 Risultato import ASIN</span>
        <span style="color:#16a34a;font-size:13px;font-weight:600;">✅ ${updated} aggiornati</span>
        <span style="color:#6b7280;font-size:13px;">⏩ ${skipped} già presenti</span>
        ${not_found > 0 ? `<span style="color:#d97706;font-size:13px;">⚠️ ${not_found} non trovati</span>` : ''}
        ${errors > 0    ? `<span style="color:#dc2626;font-size:13px;">❌ ${errors} errori</span>` : ''}
      </div>
      <div style="max-height:300px;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:var(--gray-50);border-bottom:1px solid var(--gray-200);">
              <th style="text-align:left;padding:8px 12px;">SKU</th>
              <th style="text-align:left;padding:8px 12px;">ASIN</th>
              <th style="text-align:left;padding:8px 12px;">Stato</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
