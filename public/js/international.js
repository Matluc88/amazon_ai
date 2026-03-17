// ─── Offerte Internazionali EU — Frontend JS ───────────────────

const COUNTRY_META = {
  FR: { flag: '🇫🇷', name: 'Francia',  color: '#002395', bg: '#f0f4ff' },
  DE: { flag: '🇩🇪', name: 'Germania', color: '#000000', bg: '#f5f5f5' },
  ES: { flag: '🇪🇸', name: 'Spagna',   color: '#c60b1e', bg: '#fff3f3' },
  IT: { flag: '🇮🇹', name: 'Italia',   color: '#009246', bg: '#f0fff4' },
};

let selectedFile    = null;
let selectedOfferIds = new Set();  // ID offerte child/standalone selezionate
let allLoadedOffers  = [];         // tutte le offerte (flat) caricate

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
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) applySelectedFile(file);
  });
}

function handleEuFileSelect(input) {
  if (input.files && input.files[0]) applySelectedFile(input.files[0]);
}

function applySelectedFile(file) {
  selectedFile = file;
  const icon  = document.getElementById('euUploadIcon');
  const title = document.getElementById('euUploadTitle');
  const sub   = document.getElementById('euUploadSubtitle');
  const info  = document.getElementById('euFileInfo');
  if (icon)  icon.textContent  = '✅';
  if (title) title.textContent = file.name;
  if (sub)   sub.textContent   = `${(file.size / 1024).toFixed(1)} KB`;
  if (info) {
    info.style.display = 'block';
    info.innerHTML = `<strong>📄 File selezionato:</strong> ${escHtml(file.name)}
      &nbsp;·&nbsp; <strong>Dimensione:</strong> ${(file.size / 1024).toFixed(1)} KB`;
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

    const r    = await fetch('/api/international/upload', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Errore upload');

    let msg = `✅ ${meta.flag} ${meta.name}: ${data.imported} offerte importate`;
    if (data.parents > 0) msg += ` · ${data.parents} parent · ${data.linked} varianti collegate`;
    showToast(msg, 'success');

    // Reset form
    selectedFile = null;
    document.getElementById('euFileInput').value       = '';
    document.getElementById('euUploadIcon').textContent  = '📄';
    document.getElementById('euUploadTitle').textContent = 'Trascina il report oppure clicca per selezionarlo';
    document.getElementById('euUploadSubtitle').textContent = 'File TXT/TSV scaricato da Amazon Seller Central';
    document.getElementById('euFileInfo').style.display  = 'none';
    document.getElementById('countrySelect').value       = '';
    updateUploadBtn();

    await loadDashboard();
    await loadOffers();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ─── RICALCOLA PARENT/CHILD (dati esistenti) ──────────────────
async function relinkAllParents() {
  showLoading('Rilevamento parent/child...', 'Analisi SKU in corso');
  try {
    const r    = await fetch('/api/international/relink', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    const summary = Object.entries(data.results)
      .map(([c, v]) => {
        const m = COUNTRY_META[c] || { flag: '🌍', name: c };
        return `${m.flag} ${v.parents} parent, ${v.linked} link`;
      }).join(' · ');
    showToast(`🔗 Rilevamento completato: ${summary || 'nessuna relazione trovata'}`, 'success');
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
    const r    = await fetch('/api/international/dashboard');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    const byCountry = data.data || {};
    const countries = Object.keys(byCountry);

    if (countries.length === 0) {
      body.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🌍</span>
        <h3>Nessun dato ancora</h3>
        <p>Carica i report dei mercati europei per vedere la dashboard comparativa.</p>
      </div>`;
      return;
    }

    // Card per paese
    let cardsHtml = '<div class="eu-country-cards">';
    for (const [code, d] of Object.entries(byCountry)) {
      const meta = COUNTRY_META[code] || { flag: '🌍', name: code, color: '#666', bg: '#f9f9f9' };
      const pct  = d.totale > 0 ? Math.round((d.attivi / d.totale) * 100) : 0;
      const upd  = d.ultimo_aggiornamento
        ? new Date(d.ultimo_aggiornamento).toLocaleDateString('it-IT',
            { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
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
              <div class="eu-stat-label">Offerte</div>
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
              <div class="eu-stat-label">Qtà stock</div>
            </div>
            <div class="eu-stat">
              <div class="eu-stat-value" style="color:var(--primary);">€${
                Number(d.valore_stock || 0).toLocaleString('it-IT', { minimumFractionDigits: 0 })
              }</div>
              <div class="eu-stat-label">Valore stock</div>
            </div>
          </div>
          <div style="margin-top:12px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-600);margin-bottom:4px;">
              <span>% Offerte attive</span><span>${pct}%</span>
            </div>
            <div style="background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden;">
              <div style="background:${meta.color};height:100%;width:${pct}%;border-radius:4px;transition:width .4s;"></div>
            </div>
          </div>
          <div style="margin-top:10px;font-size:11px;color:var(--gray-500);">
            Range: €${Number(d.prezzo_min || 0).toFixed(0)} – €${Number(d.prezzo_max || 0).toFixed(0)}
            &nbsp;·&nbsp; Agg.: ${upd}
          </div>
        </div>`;
    }
    cardsHtml += '</div>';

    // Tabella comparativa
    let tableHtml = `
      <h3 style="margin:28px 0 12px;font-size:15px;font-weight:700;color:var(--gray-800);">📊 Tabella Comparativa</h3>
      <div style="overflow-x:auto;">
      <table class="eu-compare-table">
        <thead><tr>
          <th>Paese</th><th>Offerte</th><th>🟢 Attive</th><th>🔴 Inattive</th>
          <th>% Attive</th><th>Prezzo Medio</th><th>Range</th>
          <th>Qtà Stock</th><th>Valore Stock</th>
        </tr></thead>
        <tbody>`;
    for (const [code, d] of Object.entries(byCountry)) {
      const meta = COUNTRY_META[code] || { flag: '🌍', name: code };
      const pct  = d.totale > 0 ? Math.round((d.attivi / d.totale) * 100) : 0;
      tableHtml += `<tr>
        <td><span style="font-size:18px;">${meta.flag}</span> <strong>${meta.name}</strong></td>
        <td style="text-align:center;font-weight:700;">${d.totale}</td>
        <td style="text-align:center;color:#16a34a;font-weight:600;">${d.attivi}</td>
        <td style="text-align:center;color:#dc2626;font-weight:600;">${d.inattivi}</td>
        <td style="text-align:center;font-weight:700;">${pct}%</td>
        <td style="text-align:right;">€${Number(d.prezzo_medio || 0).toFixed(2)}</td>
        <td style="text-align:center;font-size:12px;">€${Number(d.prezzo_min||0).toFixed(0)} – €${Number(d.prezzo_max||0).toFixed(0)}</td>
        <td style="text-align:center;">${d.quantita_totale || 0}</td>
        <td style="text-align:right;color:var(--primary);font-weight:700;">€${
          Number(d.valore_stock || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }</td>
      </tr>`;
    }
    tableHtml += '</tbody></table></div>';

    body.innerHTML = cardsHtml + tableHtml;
  } catch (err) {
    body.innerHTML = `<div style="padding:20px;color:var(--danger);">❌ Errore: ${escHtml(err.message)}</div>`;
  }
}

// ─── OFFERTE — VISTA RAGGRUPPATA PARENT/CHILD ─────────────────
async function loadOffers() {
  const container = document.getElementById('offersContainer');
  if (!container) return;

  const country = document.getElementById('filterCountry')?.value || 'all';
  const status  = document.getElementById('filterStatus')?.value  || 'all';

  try {
    const params = new URLSearchParams();
    if (country !== 'all') params.set('country', country);
    if (status  !== 'all') params.set('status',  status);
    params.set('limit', '1000');

    const r    = await fetch(`/api/international/offers?${params}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    allLoadedOffers = data.data || [];
    selectedOfferIds.clear();
    updateSelectionBar();

    if (allLoadedOffers.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-icon">📋</span>
        <h3>Nessuna offerta trovata</h3>
        <p>Prova a cambiare i filtri o carica i report dei mercati.</p>
      </div>`;
      return;
    }

    // ── Raggruppa per parent/child ──────────────────────────────
    // parentsMap: sku_lower → { offer, children[] }
    const parentsMap = new Map();
    const orphans    = []; // non-parent senza parent, o con parent non in lista

    for (const o of allLoadedOffers) {
      if (o.is_parent) {
        parentsMap.set((o.seller_sku || '').toLowerCase(), { offer: o, children: [] });
      }
    }
    for (const o of allLoadedOffers) {
      if (o.is_parent) continue;
      if (o.parent_sku) {
        const grp = parentsMap.get(o.parent_sku.toLowerCase());
        if (grp) { grp.children.push(o); continue; }
      }
      orphans.push(o);
    }

    // Costruisci lista parent SKU per dropdown accoppiamento manuale
    const allParentSkus = [...parentsMap.values()].map(g => g.offer.seller_sku);

    // ── Rendering ──────────────────────────────────────────────
    let childCount      = orphans.filter(o => !o.is_parent).length;
    let parentGroupCount = parentsMap.size;
    for (const g of parentsMap.values()) childCount += g.children.length;

    let html = `
      <div style="padding:12px 20px;font-size:13px;color:var(--gray-600);border-bottom:1px solid var(--gray-100);">
        Visualizzando <strong>${allLoadedOffers.length}</strong> righe su <strong>${data.total}</strong>
        ${parentGroupCount > 0 ? `&nbsp;·&nbsp; <strong>${parentGroupCount}</strong> gruppi parent &nbsp;·&nbsp; <strong>${childCount}</strong> varianti/standalone` : ''}
      </div>
      <div style="overflow-x:auto;">
      <table class="products-table">
        <thead>
          <tr>
            <th style="width:36px;text-align:center;">
              <input type="checkbox" id="selectAllOffers" onchange="toggleSelectAllOffers(this)"
                style="cursor:pointer;width:15px;height:15px;">
            </th>
            <th style="width:36px;"></th>
            <th>Nome prodotto</th>
            <th>SKU</th>
            <th>ASIN</th>
            <th style="text-align:right;">Prezzo</th>
            <th style="text-align:center;">Qtà</th>
            <th style="text-align:center;">Stato</th>
            <th>Canale</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>`;

    // ── Gruppi parent ──────────────────────────────────────────
    for (const [, grp] of parentsMap) {
      const parent   = grp.offer;
      const children = grp.children;
      const meta     = COUNTRY_META[parent.country] || { flag: '🌍', name: parent.country };
      const groupId  = `grp-${parent.id}`;

      // Aggregati dai child
      const totalQty   = children.reduce((s, c) => s + (c.quantity  || 0), 0);
      const prices     = children.filter(c => c.price != null).map(c => Number(c.price));
      const minPrice   = prices.length ? Math.min(...prices) : null;
      const maxPrice   = prices.length ? Math.max(...prices) : null;
      const activeKids = children.filter(c => (c.status || '').toLowerCase() === 'active');
      const anyActive  = activeKids.length > 0;
      const statusBadge = anyActive
        ? `<span class="badge badge-success">🟢 Attivo (${activeKids.length}/${children.length})</span>`
        : `<span class="badge badge-danger">🔴 Inattivo</span>`;
      const priceRange = minPrice != null
        ? (minPrice === maxPrice ? `€${minPrice.toFixed(2)}` : `€${minPrice.toFixed(0)}–€${maxPrice.toFixed(0)}`)
        : '—';

      // Checkbox parent: seleziona/deseleziona tutti i child
      html += `
        <tr class="eu-parent-row" title="Clicca per espandere/comprimere le varianti">
          <td style="text-align:center;">
            <input type="checkbox" class="parent-checkbox" data-group="${groupId}"
              onchange="toggleGroupSelection('${groupId}', this.checked)"
              style="cursor:pointer;width:15px;height:15px;accent-color:#6366f1;">
          </td>
          <td style="text-align:center;font-size:20px;" title="${meta.name}">${meta.flag}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="eu-group-toggle" id="btn-${groupId}" onclick="toggleGroup('${groupId}')"
                title="Espandi/comprimi varianti">▶</button>
              <div>
                <div style="font-size:12px;color:var(--gray-700);font-weight:700;line-height:1.4;
                  max-width:280px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;"
                  title="${escHtml(parent.item_name || '')}">
                  ${escHtml(parent.item_name || '—')}
                </div>
                <div style="font-size:10px;color:var(--gray-500);margin-top:2px;">
                  📦 ${children.length} variant${children.length === 1 ? 'e' : 'i'} · PARENT
                </div>
              </div>
            </div>
          </td>
          <td style="font-size:11px;color:#6366f1;font-family:monospace;font-weight:700;">
            ${escHtml(parent.seller_sku || '—')}
          </td>
          <td style="font-size:11px;font-family:monospace;">
            ${parent.product_id
              ? `<a href="https://www.amazon.${amazonDomain(parent.country)}/dp/${parent.product_id}"
                  target="_blank" style="color:var(--primary);text-decoration:none;">${escHtml(parent.product_id)} 🔗</a>`
              : '—'}
          </td>
          <td style="text-align:right;font-size:12px;color:var(--gray-600);">${priceRange}</td>
          <td style="text-align:center;font-weight:700;color:#1d4ed8;">${totalQty}</td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="font-size:11px;color:var(--gray-500);">—</td>
          <td style="font-size:11px;color:var(--gray-500);">—</td>
        </tr>`;

      // Righe child (nascoste di default, visibili su click toggle)
      for (const child of children) {
        const isActive = (child.status || '').toLowerCase() === 'active';
        const dateStr  = child.open_date
          ? new Date(child.open_date).toLocaleDateString('it-IT',
              { day:'2-digit', month:'2-digit', year:'numeric' })
          : '—';
        html += `
          <tr class="eu-child-row" data-group="${groupId}" style="display:none;">
            <td style="text-align:center;">
              <input type="checkbox" class="offer-checkbox" data-id="${child.id}"
                onchange="toggleOfferSelection(${child.id}, this.checked)"
                style="cursor:pointer;width:15px;height:15px;">
            </td>
            <td style="text-align:center;font-size:16px;" title="${meta.name}">${meta.flag}</td>
            <td>
              <div style="padding-left:20px;font-size:12px;color:var(--gray-800);line-height:1.4;
                overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-width:280px;"
                title="${escHtml(child.item_name || '')}">
                ↳ ${escHtml(child.item_name || '—')}
              </div>
            </td>
            <td style="font-size:11px;color:var(--gray-600);font-family:monospace;padding-left:20px;">
              ${escHtml(child.seller_sku || '—')}
            </td>
            <td style="font-size:11px;font-family:monospace;">
              ${child.product_id
                ? `<a href="https://www.amazon.${amazonDomain(child.country)}/dp/${child.product_id}"
                    target="_blank" style="color:var(--primary);text-decoration:none;">${escHtml(child.product_id)} 🔗</a>`
                : '—'}
            </td>
            <td style="text-align:right;font-weight:700;">€${child.price != null ? Number(child.price).toFixed(2) : '—'}</td>
            <td style="text-align:center;">${child.quantity ?? '—'}</td>
            <td style="text-align:center;">
              <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
                ${isActive ? '🟢 Active' : '🔴 Inactive'}
              </span>
            </td>
            <td style="font-size:11px;color:var(--gray-600);">${escHtml(child.fulfillment_channel || '—')}</td>
            <td style="font-size:11px;color:var(--gray-600);">${dateStr}</td>
          </tr>`;
      }
    }

    // ── Offerte standalone / orfane ────────────────────────────
    if (orphans.length > 0) {
      // Separatore visivo se ci sono anche gruppi parent
      if (parentsMap.size > 0) {
        html += `<tr><td colspan="10" style="padding:8px 16px;background:var(--gray-50);
          font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;
          letter-spacing:0.5px;border-top:2px solid var(--gray-200);">
          ✦ Offerte standalone (${orphans.length})
        </td></tr>`;
      }

      for (const row of orphans) {
        const meta     = COUNTRY_META[row.country] || { flag: '🌍', name: row.country };
        const isActive = (row.status || '').toLowerCase() === 'active';
        const dateStr  = row.open_date
          ? new Date(row.open_date).toLocaleDateString('it-IT',
              { day:'2-digit', month:'2-digit', year:'numeric' })
          : '—';

        // Opzioni dropdown per accoppiamento parent (solo parent dello stesso paese)
        const sameCountryParents = [...parentsMap.values()]
          .filter(g => g.offer.country === row.country)
          .map(g => g.offer.seller_sku);

        const parentDropdown = sameCountryParents.length > 0 ? `
          <div style="margin-top:4px;">
            <select onchange="setParentLink(${row.id}, this.value)"
              style="font-size:10px;padding:2px 6px;border:1px solid var(--gray-300);
                border-radius:4px;color:var(--gray-600);cursor:pointer;max-width:160px;">
              <option value="">🔗 Associa a parent…</option>
              ${sameCountryParents.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
            </select>
          </div>` : '';

        html += `
          <tr id="offer-row-${row.id}">
            <td style="text-align:center;">
              <input type="checkbox" class="offer-checkbox" data-id="${row.id}"
                onchange="toggleOfferSelection(${row.id}, this.checked)"
                style="cursor:pointer;width:15px;height:15px;">
            </td>
            <td style="text-align:center;font-size:20px;" title="${meta.name}">${meta.flag}</td>
            <td style="max-width:300px;">
              <div style="font-size:12px;color:var(--gray-800);line-height:1.4;
                overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;"
                title="${escHtml(row.item_name || '')}">
                ${escHtml(row.item_name || '—')}
              </div>
            </td>
            <td style="font-size:11px;color:var(--gray-600);font-family:monospace;">
              ${escHtml(row.seller_sku || '—')}
              ${parentDropdown}
            </td>
            <td style="font-size:11px;font-family:monospace;">
              ${row.product_id
                ? `<a href="https://www.amazon.${amazonDomain(row.country)}/dp/${row.product_id}"
                    target="_blank" style="color:var(--primary);text-decoration:none;">${escHtml(row.product_id)} 🔗</a>`
                : '—'}
            </td>
            <td style="text-align:right;font-weight:700;">€${row.price != null ? Number(row.price).toFixed(2) : '—'}</td>
            <td style="text-align:center;">${row.quantity ?? '—'}</td>
            <td style="text-align:center;">
              <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
                ${isActive ? '🟢 Active' : '🔴 Inactive'}
              </span>
            </td>
            <td style="font-size:11px;color:var(--gray-600);">${escHtml(row.fulfillment_channel || '—')}</td>
            <td style="font-size:11px;color:var(--gray-600);">${dateStr}</td>
          </tr>`;
      }
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="padding:20px;color:var(--danger);">❌ Errore: ${escHtml(err.message)}</div>`;
  }
}

// ─── TOGGLE GRUPPO PARENT ─────────────────────────────────────
function toggleGroup(groupId) {
  const rows = document.querySelectorAll(`tr.eu-child-row[data-group="${groupId}"]`);
  const btn  = document.getElementById(`btn-${groupId}`);
  if (!rows.length) return;
  const isHidden = rows[0].style.display === 'none';
  rows.forEach(r => { r.style.display = isHidden ? '' : 'none'; });
  if (btn) btn.textContent = isHidden ? '▼' : '▶';
}

// ─── ACCOPPIAMENTO MANUALE ────────────────────────────────────
async function setParentLink(offerId, parentSku) {
  if (!parentSku) return;
  showLoading('Collegamento...', '');
  try {
    const r = await fetch(`/api/international/offers/${offerId}/set-parent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_sku: parentSku }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    showToast(`✅ Offerta collegata a parent "${parentSku}"`, 'success');
    await loadOffers();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ─── SELEZIONE ────────────────────────────────────────────────

/** Seleziona/deseleziona tutti i child di un gruppo parent */
function toggleGroupSelection(groupId, checked) {
  const childBoxes = document.querySelectorAll(
    `tr.eu-child-row[data-group="${groupId}"] .offer-checkbox`
  );
  childBoxes.forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.id);
    if (checked) { selectedOfferIds.add(id); } else { selectedOfferIds.delete(id); }
  });
  updateSelectAllCheckbox();
  updateSelectionBar();
}

function toggleOfferSelection(id, checked) {
  if (checked) { selectedOfferIds.add(id); } else { selectedOfferIds.delete(id); }
  updateSelectAllCheckbox();
  updateSelectionBar();
}

function toggleSelectAllOffers(checkbox) {
  // Seleziona solo le offerte child/standalone (non i parent)
  const checkboxes = document.querySelectorAll('.offer-checkbox');
  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    cb.checked = checkbox.checked;
    if (checkbox.checked) { selectedOfferIds.add(id); } else { selectedOfferIds.delete(id); }
  });
  // Aggiorna anche le parent checkboxes visivamente
  document.querySelectorAll('.parent-checkbox').forEach(cb => { cb.checked = checkbox.checked; });
  updateSelectionBar();
}

function deselectAllOffers() {
  selectedOfferIds.clear();
  document.querySelectorAll('.offer-checkbox, .parent-checkbox')
    .forEach(cb => cb.checked = false);
  const sel = document.getElementById('selectAllOffers');
  if (sel) { sel.checked = false; sel.indeterminate = false; }
  updateSelectionBar();
}

function updateSelectAllCheckbox() {
  const sel  = document.getElementById('selectAllOffers');
  const cbs  = document.querySelectorAll('.offer-checkbox');
  if (!sel || cbs.length === 0) return;
  const all  = [...cbs].every(cb => cb.checked);
  const any  = [...cbs].some(cb => cb.checked);
  sel.checked       = all;
  sel.indeterminate = any && !all;
}

function updateSelectionBar() {
  const bar   = document.getElementById('offersSelectionBar');
  const count = document.getElementById('offersSelectionCount');
  if (!bar) return;
  const n = selectedOfferIds.size;
  if (n > 0) {
    bar.style.display = 'flex';
    if (count) count.textContent =
      `✅ ${n} offert${n === 1 ? 'a' : 'e'} selezionat${n === 1 ? 'a' : 'e'}`;
  } else {
    bar.style.display = 'none';
  }
}

// ─── EXPORT ───────────────────────────────────────────────────
async function exportSelectedOffers() {
  if (selectedOfferIds.size === 0) {
    showToast('⚠️ Seleziona almeno un\'offerta.', 'warning');
    return;
  }
  showLoading('Generazione Excel...', `Export di ${selectedOfferIds.size} offerte`);
  try {
    const ids = [...selectedOfferIds];
    const r   = await fetch('/api/international/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Errore export'); }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `offerte-eu-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
function amazonDomain(countryCode) {
  const map = { FR: 'fr', DE: 'de', IT: 'it', ES: 'es' };
  return map[countryCode] || 'com';
}

function showLoading(title = 'Caricamento...', subtitle = '') {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  document.getElementById('loadingTitle').textContent    = title;
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
  }, 4500);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
