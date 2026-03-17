// ─── Offerte Internazionali EU — Frontend JS ───────────────────

const COUNTRY_META = {
  FR: { flag: '🇫🇷', name: 'Francia',  color: '#002395', bg: '#f0f4ff' },
  DE: { flag: '🇩🇪', name: 'Germania', color: '#000000', bg: '#f5f5f5' },
  ES: { flag: '🇪🇸', name: 'Spagna',   color: '#c60b1e', bg: '#fff3f3' },
  IT: { flag: '🇮🇹', name: 'Italia',   color: '#009246', bg: '#f0fff4' },
};

let selectedFile = null;
let selectedOfferIds = new Set(); // ID delle offerte selezionate
let allLoadedOffers  = [];        // tutte le offerte caricate nella tabella

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initDragDrop();
  loadDashboard();
  loadOffers();
});

// ─── AUTH ─────────────────────────────────────────────────────
async function initAuth() {
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) { window.location.href = '/login.html'; return; }
    const data = await r.json();
    const badge = document.getElementById('userBadge');
    if (badge) badge.textContent = `👤 ${data.nome || data.email}`;
  } catch { window.location.href = '/login.html'; }

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

// ─── DRAG & DROP ──────────────────────────────────────────────
function initDragDrop() {
  const area = document.getElementById('euUploadArea');
  if (!area) return;

  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) applySelectedFile(file);
  });
}

function handleEuFileSelect(input) {
  if (input.files && input.files[0]) {
    applySelectedFile(input.files[0]);
  }
}

function applySelectedFile(file) {
  selectedFile = file;
  const icon   = document.getElementById('euUploadIcon');
  const title  = document.getElementById('euUploadTitle');
  const sub    = document.getElementById('euUploadSubtitle');
  const info   = document.getElementById('euFileInfo');

  if (icon) icon.textContent = '✅';
  if (title) title.textContent = file.name;
  if (sub) sub.textContent = `${(file.size / 1024).toFixed(1)} KB`;

  if (info) {
    info.style.display = 'block';
    info.innerHTML = `
      <strong>📄 File selezionato:</strong> ${escHtml(file.name)}
      &nbsp;·&nbsp; <strong>Dimensione:</strong> ${(file.size / 1024).toFixed(1)} KB
    `;
  }
  updateUploadBtn();
}

function updateUploadBtn() {
  const country = document.getElementById('countrySelect')?.value;
  const btn     = document.getElementById('uploadEuBtn');
  if (btn) btn.disabled = !(selectedFile && country);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('countrySelect')?.addEventListener('change', updateUploadBtn);
});

// ─── UPLOAD ───────────────────────────────────────────────────
async function uploadEuFile() {
  const country = document.getElementById('countrySelect')?.value;
  if (!country || !selectedFile) {
    showToast('⚠️ Seleziona un paese e un file.', 'warning');
    return;
  }

  const meta = COUNTRY_META[country];
  showLoading(`Caricamento ${meta.flag} ${meta.name}...`, 'Elaborazione del report in corso');

  try {
    const fd = new FormData();
    fd.append('country', country);
    fd.append('file', selectedFile);

    const r = await fetch('/api/international/upload', { method: 'POST', body: fd });
    const data = await r.json();

    if (!r.ok) throw new Error(data.error || 'Errore upload');

    showToast(`✅ ${meta.flag} ${meta.name}: ${data.imported} offerte importate!`, 'success');

    // Reset form
    selectedFile = null;
    document.getElementById('euFileInput').value = '';
    document.getElementById('euUploadIcon').textContent = '📄';
    document.getElementById('euUploadTitle').textContent = 'Trascina il report oppure clicca per selezionarlo';
    document.getElementById('euUploadSubtitle').textContent = 'File TXT/TSV scaricato da Amazon Seller Central';
    document.getElementById('euFileInfo').style.display = 'none';
    document.getElementById('countrySelect').value = '';
    updateUploadBtn();

    // Ricarica dashboard e offerte
    await loadDashboard();
    await loadOffers();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ─── DASHBOARD ────────────────────────────────────────────────
async function loadDashboard() {
  const body = document.getElementById('dashboardBody');
  if (!body) return;

  try {
    const r = await fetch('/api/international/dashboard');
    const data = await r.json();

    if (!r.ok) throw new Error(data.error);

    const byCountry = data.data || {};
    const countries = Object.keys(byCountry);

    if (countries.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🌍</span>
          <h3>Nessun dato ancora</h3>
          <p>Carica i report dei mercati europei per vedere la dashboard comparativa.</p>
        </div>`;
      return;
    }

    // Card summary per paese
    let cardsHtml = '<div class="eu-country-cards">';
    for (const [code, d] of Object.entries(byCountry)) {
      const meta = COUNTRY_META[code] || { flag: '🌍', name: code, color: '#666', bg: '#f9f9f9' };
      const pct  = d.totale > 0 ? Math.round((d.attivi / d.totale) * 100) : 0;
      const upd  = d.ultimo_aggiornamento
        ? new Date(d.ultimo_aggiornamento).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';

      cardsHtml += `
        <div class="eu-country-card" style="border-top:4px solid ${meta.color};background:${meta.bg};">
          <div class="eu-card-header">
            <span class="eu-flag">${meta.flag}</span>
            <span class="eu-country-name">${meta.name}</span>
            <button class="eu-delete-btn" onclick="deleteCountry('${code}')" title="Elimina dati ${meta.name}">🗑️</button>
          </div>
          <div class="eu-card-stats">
            <div class="eu-stat">
              <div class="eu-stat-value">${d.totale}</div>
              <div class="eu-stat-label">Totale offerte</div>
            </div>
            <div class="eu-stat">
              <div class="eu-stat-value" style="color:#16a34a;">${d.attivi}</div>
              <div class="eu-stat-label">🟢 Attive</div>
            </div>
            <div class="eu-stat">
              <div class="eu-stat-value" style="color:#dc2626;">${d.inattivi}</div>
              <div class="eu-stat-label">🔴 Inattive</div>
            </div>
            <div class="eu-stat">
              <div class="eu-stat-value">€${Number(d.prezzo_medio || 0).toFixed(0)}</div>
              <div class="eu-stat-label">Prezzo medio</div>
            </div>
            <div class="eu-stat">
              <div class="eu-stat-value">${d.quantita_totale || 0}</div>
              <div class="eu-stat-label">Qtà totale</div>
            </div>
            <div class="eu-stat">
              <div class="eu-stat-value" style="color:var(--primary);">€${Number(d.valore_stock || 0).toLocaleString('it-IT', {minimumFractionDigits:0})}</div>
              <div class="eu-stat-label">Valore stock</div>
            </div>
          </div>
          <!-- Barra % attive -->
          <div style="margin-top:12px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-600);margin-bottom:4px;">
              <span>% Offerte attive</span><span>${pct}%</span>
            </div>
            <div style="background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden;">
              <div style="background:${meta.color};height:100%;width:${pct}%;border-radius:4px;transition:width .4s;"></div>
            </div>
          </div>
          <div style="margin-top:10px;font-size:11px;color:var(--gray-500);">
            Range prezzi: €${Number(d.prezzo_min || 0).toFixed(0)} – €${Number(d.prezzo_max || 0).toFixed(0)}
            &nbsp;·&nbsp; Aggiornato: ${upd}
          </div>
        </div>
      `;
    }
    cardsHtml += '</div>';

    // Tabella comparativa riassuntiva
    let tableHtml = `
      <h3 style="margin:28px 0 12px;font-size:15px;font-weight:700;color:var(--gray-800);">📊 Tabella Comparativa</h3>
      <div style="overflow-x:auto;">
      <table class="eu-compare-table">
        <thead>
          <tr>
            <th>Paese</th>
            <th>Totale</th>
            <th>🟢 Attive</th>
            <th>🔴 Inattive</th>
            <th>% Attive</th>
            <th>Prezzo Medio</th>
            <th>Range Prezzi</th>
            <th>Qtà Totale</th>
            <th>Valore Stock</th>
          </tr>
        </thead>
        <tbody>
    `;
    for (const [code, d] of Object.entries(byCountry)) {
      const meta = COUNTRY_META[code] || { flag: '🌍', name: code };
      const pct  = d.totale > 0 ? Math.round((d.attivi / d.totale) * 100) : 0;
      tableHtml += `
        <tr>
          <td><span style="font-size:18px;">${meta.flag}</span> <strong>${meta.name}</strong></td>
          <td style="text-align:center;font-weight:700;">${d.totale}</td>
          <td style="text-align:center;color:#16a34a;font-weight:600;">${d.attivi}</td>
          <td style="text-align:center;color:#dc2626;font-weight:600;">${d.inattivi}</td>
          <td style="text-align:center;">
            <span style="font-weight:700;">${pct}%</span>
          </td>
          <td style="text-align:right;">€${Number(d.prezzo_medio || 0).toFixed(2)}</td>
          <td style="text-align:center;font-size:12px;">€${Number(d.prezzo_min || 0).toFixed(0)} – €${Number(d.prezzo_max || 0).toFixed(0)}</td>
          <td style="text-align:center;">${d.quantita_totale || 0}</td>
          <td style="text-align:right;color:var(--primary);font-weight:700;">€${Number(d.valore_stock || 0).toLocaleString('it-IT', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        </tr>
      `;
    }
    tableHtml += '</tbody></table></div>';

    body.innerHTML = cardsHtml + tableHtml;
  } catch (err) {
    body.innerHTML = `<div style="padding:20px;color:var(--danger);">❌ Errore: ${escHtml(err.message)}</div>`;
  }
}

// ─── OFFERTE DETTAGLIO (con checkbox di selezione) ────────────
async function loadOffers() {
  const container = document.getElementById('offersContainer');
  if (!container) return;

  const country = document.getElementById('filterCountry')?.value || 'all';
  const status  = document.getElementById('filterStatus')?.value || 'all';

  try {
    const params = new URLSearchParams();
    if (country !== 'all') params.set('country', country);
    if (status  !== 'all') params.set('status', status);
    params.set('limit', '500');

    const r = await fetch(`/api/international/offers?${params}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    allLoadedOffers = data.data || [];
    selectedOfferIds.clear();
    updateSelectionBar();

    if (allLoadedOffers.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📋</span>
          <h3>Nessuna offerta trovata</h3>
          <p>Prova a cambiare i filtri o carica i report dei mercati.</p>
        </div>`;
      return;
    }

    let html = `
      <div style="padding:12px 20px;font-size:13px;color:var(--gray-600);">
        Visualizzando <strong>${allLoadedOffers.length}</strong> offerte su <strong>${data.total}</strong> totali
      </div>
      <div style="overflow-x:auto;">
      <table class="products-table">
        <thead>
          <tr>
            <th style="width:36px;text-align:center;">
              <input type="checkbox" id="selectAllOffers" onchange="toggleSelectAllOffers(this)"
                style="cursor:pointer;width:15px;height:15px;">
            </th>
            <th style="width:36px;">Paese</th>
            <th>Nome prodotto</th>
            <th>SKU</th>
            <th>ASIN</th>
            <th style="text-align:right;">Prezzo</th>
            <th style="text-align:center;">Qtà</th>
            <th style="text-align:center;">Stato</th>
            <th>Canale</th>
            <th>Data apertura</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const row of allLoadedOffers) {
      const meta     = COUNTRY_META[row.country] || { flag: '🌍', name: row.country };
      const isActive = (row.status || '').toLowerCase() === 'active';
      const date     = row.open_date
        ? new Date(row.open_date).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' })
        : '—';
      const countryCode = row.country;
      const amazonDomain = countryCode === 'FR' ? 'fr' : countryCode === 'DE' ? 'de' : countryCode === 'IT' ? 'it' : 'es';

      html += `
        <tr id="offer-row-${row.id}" style="cursor:default;">
          <td style="text-align:center;">
            <input type="checkbox" class="offer-checkbox" data-id="${row.id}"
              onchange="toggleOfferSelection(${row.id}, this.checked)"
              style="cursor:pointer;width:15px;height:15px;">
          </td>
          <td style="text-align:center;font-size:20px;" title="${meta.name}">${meta.flag}</td>
          <td style="max-width:300px;">
            <div style="font-size:12px;color:var(--gray-800);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;" title="${escHtml(row.item_name || '')}">
              ${escHtml(row.item_name || '—')}
            </div>
          </td>
          <td style="font-size:11px;color:var(--gray-600);font-family:monospace;">${escHtml(row.seller_sku || '—')}</td>
          <td style="font-size:11px;font-family:monospace;">
            ${row.product_id
              ? `<a href="https://www.amazon.${amazonDomain}/dp/${row.product_id}" target="_blank" style="color:var(--primary);text-decoration:none;" title="Apri su Amazon">${escHtml(row.product_id)} 🔗</a>`
              : '—'}
          </td>
          <td style="text-align:right;font-weight:700;">€${row.price != null ? Number(row.price).toFixed(2) : '—'}</td>
          <td style="text-align:center;">${row.quantity ?? '—'}</td>
          <td style="text-align:center;">
            <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">${isActive ? '🟢 Active' : '🔴 Inactive'}</span>
          </td>
          <td style="font-size:11px;color:var(--gray-600);">${escHtml(row.fulfillment_channel || '—')}</td>
          <td style="font-size:11px;color:var(--gray-600);">${date}</td>
        </tr>
      `;
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="padding:20px;color:var(--danger);">❌ Errore: ${escHtml(err.message)}</div>`;
  }
}

// ─── SELEZIONE OFFERTE ────────────────────────────────────────
function toggleOfferSelection(id, checked) {
  if (checked) {
    selectedOfferIds.add(id);
  } else {
    selectedOfferIds.delete(id);
  }
  updateSelectAllCheckbox();
  updateSelectionBar();
}

function toggleSelectAllOffers(checkbox) {
  const checkboxes = document.querySelectorAll('.offer-checkbox');
  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    cb.checked = checkbox.checked;
    if (checkbox.checked) {
      selectedOfferIds.add(id);
    } else {
      selectedOfferIds.delete(id);
    }
  });
  updateSelectionBar();
}

function deselectAllOffers() {
  selectedOfferIds.clear();
  document.querySelectorAll('.offer-checkbox').forEach(cb => cb.checked = false);
  const selectAll = document.getElementById('selectAllOffers');
  if (selectAll) selectAll.checked = false;
  updateSelectionBar();
}

function updateSelectAllCheckbox() {
  const selectAll  = document.getElementById('selectAllOffers');
  const checkboxes = document.querySelectorAll('.offer-checkbox');
  if (!selectAll || checkboxes.length === 0) return;
  const allChecked = [...checkboxes].every(cb => cb.checked);
  const anyChecked = [...checkboxes].some(cb => cb.checked);
  selectAll.checked       = allChecked;
  selectAll.indeterminate = anyChecked && !allChecked;
}

function updateSelectionBar() {
  const bar   = document.getElementById('offersSelectionBar');
  const count = document.getElementById('offersSelectionCount');
  if (!bar) return;
  const n = selectedOfferIds.size;
  if (n > 0) {
    bar.style.display = 'flex';
    if (count) count.textContent = `✅ ${n} offert${n === 1 ? 'a' : 'e'} selezionat${n === 1 ? 'a' : 'e'}`;
  } else {
    bar.style.display = 'none';
  }
}

// ─── EXPORT SELEZIONATI ───────────────────────────────────────
async function exportSelectedOffers() {
  if (selectedOfferIds.size === 0) {
    showToast('⚠️ Seleziona almeno un\'offerta.', 'warning');
    return;
  }

  showLoading('Generazione Excel...', `Export di ${selectedOfferIds.size} offerte in corso`);

  try {
    const ids = [...selectedOfferIds];
    const r = await fetch('/api/international/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error || 'Errore export');
    }

    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const ts   = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `offerte-eu-${ts}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`✅ Export completato: ${ids.length} offerte scaricate!`, 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ─── ELIMINA PAESE ────────────────────────────────────────────
async function deleteCountry(country) {
  const meta = COUNTRY_META[country] || { flag: '🌍', name: country };
  if (!confirm(`Sei sicuro di voler eliminare tutti i dati di ${meta.flag} ${meta.name}?`)) return;

  try {
    const r = await fetch(`/api/international/country/${country}`, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    showToast(`🗑️ Dati ${meta.name} eliminati (${data.deleted} record)`, 'success');
    await loadDashboard();
    await loadOffers();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

// ─── UTILITIES ────────────────────────────────────────────────
function showLoading(title = 'Caricamento...', subtitle = '') {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  document.getElementById('loadingTitle').textContent = title;
  document.getElementById('loadingSubtitle').textContent = subtitle;
  overlay.classList.remove('d-none');
}

function hideLoading() {
  document.getElementById('loadingOverlay')?.classList.add('d-none');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
