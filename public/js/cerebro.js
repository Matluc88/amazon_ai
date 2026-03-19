/* =============================================
   CEREBRO — Keyword Manager
   Gestione cluster + importazione CSV Helium 10
   ============================================= */

let clusters = [];
let selectedClusterId = null;
let allKeywords = [];
let selectedIds = new Set();
let currentPage = 1;
let totalKeywords = 0;
const PAGE_SIZE = 50;

let sortBy = 'search_volume';
let sortOrder = 'desc';
let searchDebounceTimer = null;

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  loadClusters();
});

// =============================================
// CLUSTERS
// =============================================
async function loadClusters() {
  try {
    const res = await fetch('/api/cerebro/clusters');
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    const data = await res.json();
    clusters = Array.isArray(data) ? data : [];
    renderClusterList();
  } catch (err) {
    showToast('Errore caricamento cluster: ' + err.message, 'error');
  }
}

function renderClusterList() {
  const container = document.getElementById('clusterList');
  if (!clusters.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:30px 20px;">
        <div style="font-size:28px;">📂</div>
        <p style="font-size:12px;">Nessun cluster.<br>Crea il primo cluster.</p>
      </div>`;
    return;
  }

  container.innerHTML = clusters.map(c => {
    const total    = c.total_keywords || 0;
    const approved = c.approved || 0;
    const pending  = c.pending  || 0;
    const isActive = c.id === selectedClusterId;
    return `
      <div class="cluster-item${isActive ? ' active' : ''}" onclick="selectCluster(${c.id})">
        <div class="cluster-item-name">${escHtml(c.name)}</div>
        <div class="cluster-item-stats">
          <span class="cluster-stat">📊 ${total} kw</span>
          <span class="cluster-stat" style="color:#059669;">✅ ${approved}</span>
          <span class="cluster-stat" style="color:#d97706;">⏳ ${pending}</span>
        </div>
      </div>`;
  }).join('');
}

async function selectCluster(id) {
  selectedClusterId = id;
  currentPage = 1;
  selectedIds.clear();

  renderClusterList(); // aggiorna active state

  // Mostra sezione upload + stats
  document.getElementById('uploadSection').style.display = '';
  document.getElementById('clusterStatsCard').style.display = '';
  document.getElementById('noClusterMsg').style.display = 'none';
  document.getElementById('kwCard').style.display = '';

  const cluster = clusters.find(c => c.id === id);
  if (cluster) {
    renderClusterStats(cluster);
    document.getElementById('kwCardTitle').textContent = `🔑 ${cluster.name}`;
    document.getElementById('kwCardSub').textContent = cluster.description || '';
  }

  await loadKeywords();
}

function renderClusterStats(cluster) {
  const total    = cluster.total_keywords || 0;
  const approved = cluster.approved || 0;
  const pending  = cluster.pending  || 0;
  const rejected = cluster.rejected || 0;

  document.getElementById('clusterStats').innerHTML = `
    <div style="background:var(--gray-50);border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:700;color:var(--gray-800);">${total}</div>
      <div style="font-size:11px;color:var(--gray-500);">Totale keyword</div>
    </div>
    <div style="background:#d1fae5;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#065f46;">${approved}</div>
      <div style="font-size:11px;color:#065f46;">Approvate</div>
    </div>
    <div style="background:#fef3c7;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#92400e;">${pending}</div>
      <div style="font-size:11px;color:#92400e;">In attesa</div>
    </div>
    <div style="background:#fee2e2;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#991b1b;">${rejected}</div>
      <div style="font-size:11px;color:#991b1b;">Rifiutate</div>
    </div>`;

  // Tier stats
  const tierTitle   = cluster.tier_title   || 0;
  const tierBullet  = cluster.tier_bullet  || 0;
  const tierBackend = cluster.tier_backend || 0;
  document.getElementById('clusterTierStats').innerHTML = `
    <span style="background:#fef3c7;color:#92400e;border:1px solid #f59e0b;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">🥇 Titolo: ${tierTitle}</span>
    <span style="background:#dbeafe;color:#1e40af;border:1px solid #3b82f6;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">🥈 Bullet: ${tierBullet}</span>
    <span style="background:#ede9fe;color:#6d28d9;border:1px solid #8b5cf6;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">🧠 Backend: ${tierBackend}</span>`;
}

// ─── Create/Edit cluster ───────────────────────────
function openCreateCluster() {
  document.getElementById('clusterFormTitle').textContent = 'Nuovo cluster';
  document.getElementById('clusterName').value = '';
  document.getElementById('clusterDesc').value = '';
  document.getElementById('clusterEditId').value = '';
  document.getElementById('clusterCreateForm').style.display = '';
  document.getElementById('clusterName').focus();
}

function closeCreateCluster() {
  document.getElementById('clusterCreateForm').style.display = 'none';
}

function editCurrentCluster() {
  const cluster = clusters.find(c => c.id === selectedClusterId);
  if (!cluster) return;
  document.getElementById('clusterFormTitle').textContent = 'Modifica cluster';
  document.getElementById('clusterName').value = cluster.name;
  document.getElementById('clusterDesc').value = cluster.description || '';
  document.getElementById('clusterEditId').value = cluster.id;
  document.getElementById('clusterCreateForm').style.display = '';
  document.getElementById('clusterName').focus();
}

async function saveCluster() {
  const name = document.getElementById('clusterName').value.trim();
  const desc = document.getElementById('clusterDesc').value.trim();
  const editId = document.getElementById('clusterEditId').value;

  if (!name) { showToast('Inserisci un nome per il cluster', 'warning'); return; }

  try {
    let res;
    if (editId) {
      res = await fetch(`/api/cerebro/clusters/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc })
      });
    } else {
      res = await fetch('/api/cerebro/clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc })
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(editId ? '✅ Cluster aggiornato!' : '✅ Cluster creato!', 'success');
    closeCreateCluster();
    await loadClusters();

    if (!editId) {
      // Seleziona il nuovo cluster appena creato
      const newId = data.cluster?.id || data.id;
      if (newId) await selectCluster(newId);
    } else {
      // Aggiorna stats
      const cluster = clusters.find(c => c.id === parseInt(editId));
      if (cluster) renderClusterStats(cluster);
    }
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

async function deleteCurrentCluster() {
  if (!selectedClusterId) return;
  const cluster = clusters.find(c => c.id === selectedClusterId);
  if (!confirm(`Eliminare il cluster "${cluster?.name}"?\n\nTutte le keyword associate verranno eliminate.`)) return;

  try {
    const res = await fetch(`/api/cerebro/clusters/${selectedClusterId}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }

    showToast('🗑 Cluster eliminato', 'success');
    selectedClusterId = null;
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('clusterStatsCard').style.display = 'none';
    document.getElementById('noClusterMsg').style.display = '';
    document.getElementById('kwCard').style.display = 'none';
    await loadClusters();
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

// =============================================
// CSV UPLOAD
// =============================================
function handleCsvFileChange(input) {
  const file = input.files[0];
  const btn = document.getElementById('uploadBtn');
  if (file) {
    document.getElementById('uploadFileName').textContent = file.name;
    btn.disabled = false;
  } else {
    document.getElementById('uploadFileName').textContent = 'Nessun file selezionato';
    btn.disabled = true;
  }
}

async function uploadCsv() {
  if (!selectedClusterId) { showToast('Seleziona un cluster prima', 'warning'); return; }
  const input = document.getElementById('csvFileInput');
  const file = input.files[0];
  if (!file) { showToast('Seleziona un file CSV', 'warning'); return; }

  const btn = document.getElementById('uploadBtn');
  const progress = document.getElementById('uploadProgress');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(0,0,0,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;"></span> Importazione...';
  progress.textContent = 'Caricamento in corso...';

  const formData = new FormData();
  formData.append('csv', file);
  formData.append('cluster_id', selectedClusterId);

  try {
    const res = await fetch('/api/cerebro/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const { imported, skipped, total_parsed } = data;
    progress.textContent = '';
    showToast(`✅ ${imported} keyword importate! (${skipped} duplicate saltate, ${total_parsed} totali nel CSV)`, 'success');

    // Reset file input
    input.value = '';
    document.getElementById('uploadFileName').textContent = 'Nessun file selezionato';

    // Reload keywords e cluster stats
    await loadClusters();
    await selectCluster(selectedClusterId);
  } catch (err) {
    progress.textContent = '';
    showToast('Errore upload: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🚀 Importa keyword';
  }
}

// =============================================
// KEYWORDS LOAD + RENDER
// =============================================
async function loadKeywords() {
  if (!selectedClusterId) return;

  const status  = document.getElementById('filterStatus')?.value || '';
  const tier    = document.getElementById('filterTier')?.value   || '';
  const sortVal = document.getElementById('filterSort')?.value   || 'volume_desc';
  const search  = document.getElementById('kwSearch')?.value.trim() || '';

  // Parse sort
  const [sby, sord] = parseSortValue(sortVal);
  sortBy    = sby;
  sortOrder = sord;

  const params = new URLSearchParams({
    limit:  PAGE_SIZE,
    offset: (currentPage - 1) * PAGE_SIZE,
    sort:   sortBy,
    order:  sortOrder,
  });
  if (status)         params.set('status', status);
  if (tier === 'none') params.set('tier', 'none');
  else if (tier)      params.set('tier', tier);
  if (search)         params.set('search', search);

  const tbody = document.getElementById('kwTableBody');
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--gray-400);">
    <div style="display:inline-block;width:20px;height:20px;border:2px solid var(--gray-200);border-top-color:var(--primary);border-radius:50%;animation:spin 0.7s linear infinite;"></div>
    <span style="margin-left:8px;font-size:13px;">Caricamento...</span>
  </td></tr>`;

  try {
    const res = await fetch(`/api/cerebro/keywords/${selectedClusterId}?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    allKeywords = data.keywords || [];
    totalKeywords = data.total || 0;
    selectedIds.clear();
    updateBulkBar();
    renderKeywordsTable();
    renderPagination();
    updateSortHeaders();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger);">Errore: ${escHtml(err.message)}</td></tr>`;
  }
}

function parseSortValue(val) {
  switch (val) {
    case 'volume_asc':   return ['search_volume', 'asc'];
    case 'volume_desc':  return ['search_volume', 'desc'];
    case 'iq_desc':      return ['cerebro_iq', 'desc'];
    case 'keyword_asc':  return ['keyword', 'asc'];
    case 'imported_asc': return ['imported_at', 'asc'];
    default:             return ['search_volume', 'desc'];
  }
}

function renderKeywordsTable() {
  const tbody = document.getElementById('kwTableBody');
  document.getElementById('selectAll').checked = false;

  if (!allKeywords.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state" style="padding:40px;">
          <div style="font-size:28px;">🔍</div>
          <p>Nessuna keyword trovata con i filtri correnti.</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = allKeywords.map(kw => {
    const volClass = kw.search_volume >= 5000 ? 'high' : kw.search_volume >= 1000 ? 'med' : 'low';
    const volText  = kw.search_volume ? kw.search_volume.toLocaleString('it-IT') : '—';
    const iqText   = kw.cerebro_iq   ? kw.cerebro_iq  : '—';
    const densText = kw.title_density != null ? kw.title_density : '—';
    const statusBadge = statusBadgeHtml(kw.status);
    const tierBadge   = tierBadgeHtml(kw.id, kw.tier);
    const isSelected  = selectedIds.has(kw.id);

    return `
      <tr class="${isSelected ? 'selected' : ''}" id="kw-row-${kw.id}">
        <td><input type="checkbox" class="kw-checkbox" data-id="${kw.id}"
             ${isSelected ? 'checked' : ''} onchange="toggleSelect(${kw.id}, this.checked)" /></td>
        <td><div class="kw-text">${escHtml(kw.keyword)}</div></td>
        <td><span class="vol-badge ${volClass}">${volText}</span></td>
        <td><span style="font-size:12px;color:var(--gray-600);">${iqText}</span></td>
        <td><span style="font-size:12px;color:var(--gray-600);">${densText}</span></td>
        <td>${statusBadge}</td>
        <td>${tierBadge}</td>
        <td>
          <div style="display:flex;gap:4px;">
            ${kw.status !== 'approved' ? `<button class="kw-action-btn approve" onclick="updateKeyword(${kw.id},'approved',null)">✅</button>` : ''}
            ${kw.status !== 'rejected' ? `<button class="kw-action-btn reject"  onclick="updateKeyword(${kw.id},'rejected',null)">❌</button>` : ''}
            ${kw.status === 'approved' ? `<button class="kw-action-btn" onclick="updateKeyword(${kw.id},'pending',null)" style="border-color:#d97706;color:#d97706;">↩</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
}

function statusBadgeHtml(status) {
  const map = {
    pending:  `<span class="status-badge pending">⏳ In attesa</span>`,
    approved: `<span class="status-badge approved">✅ Approvata</span>`,
    rejected: `<span class="status-badge rejected">❌ Rifiutata</span>`,
  };
  return map[status] || `<span class="status-badge pending">${escHtml(status)}</span>`;
}

function tierBadgeHtml(kwId, tier) {
  const tiers = ['title', 'bullet', 'backend'];
  const labels = { title: '🥇 Titolo', bullet: '🥈 Bullet', backend: '🧠 Backend' };

  return `<select class="tier-select" data-kwid="${kwId}" onchange="updateKeyword(${kwId}, null, this.value || null)">
    <option value="" ${!tier ? 'selected' : ''}>— Nessuno</option>
    ${tiers.map(t => `<option value="${t}" ${tier === t ? 'selected' : ''}>${labels[t]}</option>`).join('')}
  </select>`;
}

// =============================================
// KEYWORD UPDATE
// =============================================
async function updateKeyword(kwId, status, tier) {
  const body = {};
  if (status !== null && status !== undefined) body.status = status;
  if (tier   !== null && tier   !== undefined) body.tier   = tier === '' ? null : tier;

  try {
    const res = await fetch(`/api/cerebro/keywords/${kwId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Aggiorna in-memory
    const kw = allKeywords.find(k => k.id === kwId);
    if (kw) {
      if (status !== null && status !== undefined) kw.status = status;
      if (tier   !== null && tier   !== undefined) kw.tier   = tier === '' ? null : tier;
    }

    // Re-render solo la riga
    const row = document.getElementById(`kw-row-${kwId}`);
    if (row && kw) {
      const cells = row.querySelectorAll('td');
      if (cells[5]) cells[5].innerHTML = statusBadgeHtml(kw.status);
      if (cells[6]) cells[6].innerHTML = tierBadgeHtml(kw.id, kw.tier);
      if (cells[7]) cells[7].innerHTML = `<div style="display:flex;gap:4px;">
        ${kw.status !== 'approved' ? `<button class="kw-action-btn approve" onclick="updateKeyword(${kw.id},'approved',null)">✅</button>` : ''}
        ${kw.status !== 'rejected' ? `<button class="kw-action-btn reject"  onclick="updateKeyword(${kw.id},'rejected',null)">❌</button>` : ''}
        ${kw.status === 'approved' ? `<button class="kw-action-btn" onclick="updateKeyword(${kw.id},'pending',null)" style="border-color:#d97706;color:#d97706;">↩</button>` : ''}
      </div>`;
    }
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

// =============================================
// BULK ACTIONS
// =============================================
function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id);
  else         selectedIds.delete(id);

  const row = document.getElementById(`kw-row-${id}`);
  if (row) row.classList.toggle('selected', checked);
  updateBulkBar();
}

function toggleSelectAll(checked) {
  allKeywords.forEach(kw => {
    const cb = document.querySelector(`.kw-checkbox[data-id="${kw.id}"]`);
    if (cb) { cb.checked = checked; }
    if (checked) selectedIds.add(kw.id);
    else         selectedIds.delete(kw.id);
    const row = document.getElementById(`kw-row-${kw.id}`);
    if (row) row.classList.toggle('selected', checked);
  });
  updateBulkBar();
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll('.kw-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('selectAll').checked = false;
  document.querySelectorAll('.kw-table tr.selected').forEach(r => r.classList.remove('selected'));
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = selectedIds.size;
  bar.classList.toggle('visible', count > 0);
  document.getElementById('bulkInfo').textContent = `${count} keyword selezionat${count === 1 ? 'a' : 'e'}`;
}

async function bulkSetStatus(status) {
  if (!selectedIds.size) return;
  await bulkUpdate({ ids: [...selectedIds], status });
}

async function bulkSetTier(tier) {
  if (!selectedIds.size) return;
  await bulkUpdate({ ids: [...selectedIds], tier });
}

async function bulkDelete() {
  if (!selectedIds.size) return;
  const n = selectedIds.size;
  if (!confirm(`Eliminare ${n} keyword selezionat${n === 1 ? 'a' : 'e'}?`)) return;

  try {
    const res = await fetch('/api/cerebro/keywords/bulk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`🗑 ${n} keyword eliminate`, 'success');
    selectedIds.clear();
    await loadClusters();
    await loadKeywords();
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

async function bulkUpdate(body) {
  try {
    const res = await fetch('/api/cerebro/keywords/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const n = selectedIds.size;
    showToast(`✅ ${n} keyword aggiornate`, 'success');
    clearSelection();
    await loadKeywords();
    await loadClusters(); // aggiorna stats
    const cluster = clusters.find(c => c.id === selectedClusterId);
    if (cluster) renderClusterStats(cluster);
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

async function approveAllVisible() {
  const ids = allKeywords.map(k => k.id);
  if (!ids.length) return;
  await fetch('/api/cerebro/keywords/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status: 'approved' })
  });
  showToast(`✅ ${ids.length} keyword approvate`, 'success');
  await loadKeywords();
  await loadClusters();
  const cluster = clusters.find(c => c.id === selectedClusterId);
  if (cluster) renderClusterStats(cluster);
}

async function rejectAllVisible() {
  const ids = allKeywords.map(k => k.id);
  if (!ids.length) return;
  await fetch('/api/cerebro/keywords/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status: 'rejected' })
  });
  showToast(`❌ ${ids.length} keyword rifiutate`, 'success');
  await loadKeywords();
  await loadClusters();
  const cluster = clusters.find(c => c.id === selectedClusterId);
  if (cluster) renderClusterStats(cluster);
}

// =============================================
// FILTERS + SORT
// =============================================
function applyFilters() {
  currentPage = 1;
  loadKeywords();
}

function resetFilters() {
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterTier').value   = '';
  document.getElementById('filterSort').value   = 'volume_desc';
  document.getElementById('kwSearch').value     = '';
  currentPage = 1;
  loadKeywords();
}

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => applyFilters(), 350);
}

function setSortBy(col) {
  // Cicla: desc → asc → desc
  if (sortBy === col) sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
  else { sortBy = col; sortOrder = 'desc'; }

  // Aggiorna select
  const map = {
    'search_volume': sortOrder === 'desc' ? 'volume_desc' : 'volume_asc',
    'cerebro_iq':    'iq_desc',
    'keyword':       'keyword_asc',
  };
  const sel = document.getElementById('filterSort');
  if (map[col]) sel.value = map[col];

  currentPage = 1;
  loadKeywords();
}

function updateSortHeaders() {
  document.querySelectorAll('.kw-table th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
  });
}

// =============================================
// PAGINATION
// =============================================
function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(totalKeywords / PAGE_SIZE));
  const start = ((currentPage - 1) * PAGE_SIZE) + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, totalKeywords);

  document.getElementById('paginationInfo').textContent =
    totalKeywords > 0
      ? `${start}–${end} di ${totalKeywords} keyword`
      : 'Nessuna keyword';

  const btns = document.getElementById('pageButtons');
  if (totalPages <= 1) { btns.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`;

  // Mostra al max 7 pagine
  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages = [1];
    if (currentPage > 3) pages.push('…');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  pages.forEach(p => {
    if (p === '…') {
      html += `<span style="padding:5px 4px;color:var(--gray-400);">…</span>`;
    } else {
      html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
    }
  });

  html += `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>`;
  btns.innerHTML = html;
}

function goPage(page) {
  const totalPages = Math.ceil(totalKeywords / PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  loadKeywords();
  document.getElementById('kwCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =============================================
// HELPERS
// =============================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
