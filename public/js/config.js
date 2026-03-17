/* =============================================
   AMAZON AI LISTING TOOL — Config Page JS
   ============================================= */

let allAttributes = [];
let currentUser = null;

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  loadCurrentUser();
  loadAttributes();
});

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    currentUser = await res.json();

    // Mostra tab utenti solo agli admin
    if (currentUser.ruolo !== 'admin') {
      const usersTab = document.getElementById('usersTab');
      if (usersTab) usersTab.style.display = 'none';
      const addUserForm = document.getElementById('addUserForm');
      if (addUserForm) addUserForm.style.display = 'none';
      const clearChatForm = document.getElementById('clearChatForm');
      if (clearChatForm) clearChatForm.style.display = 'none';
    } else {
      loadUsers();
    }
  } catch (err) {
    console.error('Errore caricamento utente:', err);
  }
}

// =============================================
// TABS
// =============================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    const ids = ['attrs', 'users'];
    btn.classList.toggle('active', ids[i] === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === `tab-${tabId}`);
  });
  if (tabId === 'users') loadUsers();
}

// =============================================
// LOAD ATTRIBUTES
// =============================================
async function loadAttributes() {
  try {
    const res = await fetch('/api/config/attributes');
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login.html'; return; }
      throw new Error('Errore caricamento attributi');
    }
    allAttributes = await res.json();
    renderAttributes(allAttributes);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderAttributes(attrs) {
  const tbody = document.getElementById('attrTableBody');

  // Raggruppa per sezione
  const bySection = {};
  for (const attr of attrs) {
    if (!bySection[attr.sezione]) bySection[attr.sezione] = [];
    bySection[attr.sezione].push(attr);
  }

  let html = '';
  for (const [sezione, sAttrs] of Object.entries(bySection)) {
    html += `<tr><td colspan="6" class="sezione-header">${escHtml(sezione)}</td></tr>`;
    for (const attr of sAttrs) {
      const prioColor = {
        obbligatorio: '#ef4444',
        seo: '#f59e0b',
        facoltativo: '#9ca3af',
        non_rilevante: '#d1d5db',
      }[attr.priorita] || '#9ca3af';

      const sourceOptions = ['AI', 'FIXED', 'AUTO', 'MANUAL', 'SKIP'].map(s =>
        `<option value="${s}" ${attr.source === s ? 'selected' : ''}>${s}</option>`
      ).join('');

      const showFixed = attr.source === 'FIXED' ? '' : 'display:none';
      const fixedValue = escHtml(attr.fixed_value || '');

      html += `
        <tr data-attr-id="${attr.id}">
          <td>${escHtml(attr.nome_attributo)}</td>
          <td>${escHtml(attr.sezione)}</td>
          <td>
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${prioColor};margin-right:6px;"></span>
            ${attr.priorita}
          </td>
          <td>
            <select class="source-select ${attr.source}" onchange="onSourceChange(${attr.id}, this)">
              ${sourceOptions}
            </select>
          </td>
          <td>
            <input type="text"
              class="fixed-value-input"
              id="fv-${attr.id}"
              value="${fixedValue}"
              placeholder="Valore fisso..."
              style="${showFixed}"
            />
          </td>
          <td>
            <button class="btn-save-row" onclick="saveAttribute(${attr.id}, this)">💾 Salva</button>
          </td>
        </tr>`;
    }
  }

  tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--gray-400);">Nessun attributo trovato</td></tr>';
}

// =============================================
// SOURCE CHANGE → show/hide fixed value input
// =============================================
function onSourceChange(attrId, selectEl) {
  // Aggiorna il colore del select
  selectEl.className = `source-select ${selectEl.value}`;

  const fvInput = document.getElementById(`fv-${attrId}`);
  if (fvInput) {
    fvInput.style.display = selectEl.value === 'FIXED' ? '' : 'none';
  }
}

// =============================================
// SAVE ATTRIBUTE ROW
// =============================================
async function saveAttribute(attrId, btn) {
  const row = document.querySelector(`tr[data-attr-id="${attrId}"]`);
  if (!row) return;

  const sourceSelect = row.querySelector('.source-select');
  const fvInput = row.querySelector('.fixed-value-input');

  const source = sourceSelect ? sourceSelect.value : null;
  const fixed_value = fvInput ? fvInput.value : undefined;

  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳';

  try {
    const body = {};
    if (source) body.source = source;
    if (source === 'FIXED' && fixed_value !== undefined) body.fixed_value = fixed_value;

    const res = await fetch(`/api/config/attributes/${attrId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json()).error);

    // Aggiorna in locale
    const attr = allAttributes.find(a => a.id === attrId);
    if (attr) {
      if (source) attr.source = source;
      if (body.fixed_value !== undefined) attr.fixed_value = body.fixed_value;
    }

    showToast('✅ Attributo aggiornato!', 'success');
    btn.innerHTML = '✅';
    setTimeout(() => { btn.innerHTML = originalText; btn.disabled = false; }, 1500);
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// =============================================
// FILTER ATTRIBUTES (search)
// =============================================
function filterAttributes() {
  const q = document.getElementById('searchAttr').value.toLowerCase();
  const filtered = q.trim()
    ? allAttributes.filter(a =>
        a.nome_attributo.toLowerCase().includes(q) ||
        a.sezione.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q)
      )
    : allAttributes;
  renderAttributes(filtered);
}

// =============================================
// USERS
// =============================================
async function loadUsers() {
  try {
    const res = await fetch('/api/auth/users');
    if (!res.ok) return; // non admin
    const users = await res.json();

    const tbody = document.getElementById('usersTableBody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-400);">Nessun utente</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const roleBadge = u.ruolo === 'admin'
        ? '<span class="badge-role-admin">Admin</span>'
        : '<span class="badge-role-op">Operatore</span>';
      const date = u.created_at ? new Date(u.created_at).toLocaleDateString('it-IT') : '—';
      const isCurrentUser = currentUser && currentUser.id === u.id;

      return `
        <tr>
          <td>${escHtml(u.nome || '—')}</td>
          <td>${escHtml(u.email)}</td>
          <td>${roleBadge}</td>
          <td>${date}</td>
          <td>
            ${!isCurrentUser
              ? `<button class="btn btn-secondary btn-sm" onclick="deleteUser(${u.id}, this)">🗑️ Elimina</button>`
              : '<span style="font-size:12px;color:var(--gray-400);">Tu</span>'}
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    console.error('Errore caricamento utenti:', err);
  }
}

async function addUser() {
  const nome = document.getElementById('newNome').value.trim();
  const email = document.getElementById('newEmail').value.trim();
  const password = document.getElementById('newPassword').value;
  const ruolo = document.getElementById('newRuolo').value;

  if (!email || !password) {
    showToast('Email e password sono obbligatorie', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, password, ruolo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('✅ Utente creato!', 'success');
    document.getElementById('newNome').value = '';
    document.getElementById('newEmail').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newRuolo').value = 'operatore';
    loadUsers();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  }
}

// =============================================
// CLEAR CHAT (solo admin)
// =============================================
async function clearChat() {
  if (!confirm('⚠️ Sei sicuro di voler cancellare TUTTI i messaggi della chat?\nQuesta operazione è irreversibile.')) return;
  try {
    const res = await fetch('/api/chat', { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    showToast('✅ Chat svuotata con successo!', 'success');
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
  }
}

async function deleteUser(userId, btn) {
  if (!confirm('Eliminare questo utente?')) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/auth/users/${userId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    showToast('Utente eliminato', 'success');
    loadUsers();
  } catch (err) {
    showToast(`Errore: ${err.message}`, 'error');
    btn.disabled = false;
  }
}

// =============================================
// HELPERS
// =============================================
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
