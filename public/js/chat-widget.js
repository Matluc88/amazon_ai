/**
 * Chat Widget — bolla flottante con polling ogni 5 secondi
 * Includi questo script in tutte le pagine HTML protette da auth
 */
(function () {
  'use strict';

  // ─── Stato ────────────────────────────────────────────────────────────────
  let _open       = false;
  let _messages   = [];
  let _lastId     = 0;
  let _unread     = 0;
  let _pollTimer  = null;
  let _myUserId   = null;   // verrà rilevato dal primo messaggio inviato / dall'API /api/auth/me

  // ─── Costruzione DOM ──────────────────────────────────────────────────────
  function buildWidget() {
    const style = document.createElement('style');
    style.textContent = `
      /* ── Chat bubble ── */
      #chat-bubble {
        position: fixed;
        bottom: 24px; right: 24px;
        width: 52px; height: 52px;
        border-radius: 50%;
        background: var(--primary, #6366f1);
        color: #fff;
        font-size: 24px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,.25);
        z-index: 9998;
        border: none;
        transition: transform .2s;
        user-select: none;
      }
      #chat-bubble:hover { transform: scale(1.08); }
      #chat-unread-badge {
        position: absolute;
        top: 0; right: 0;
        background: #ef4444;
        color: #fff;
        font-size: 11px; font-weight: 700;
        width: 18px; height: 18px;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        line-height: 1;
        pointer-events: none;
      }
      #chat-unread-badge.hidden { display: none; }

      /* ── Panel ── */
      #chat-panel {
        position: fixed;
        bottom: 88px; right: 24px;
        width: 320px; height: 420px;
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,.18);
        display: flex; flex-direction: column;
        z-index: 9999;
        overflow: hidden;
        transform: scale(.9) translateY(20px);
        opacity: 0;
        pointer-events: none;
        transition: transform .2s, opacity .2s;
      }
      #chat-panel.open {
        transform: scale(1) translateY(0);
        opacity: 1;
        pointer-events: all;
      }

      /* Header */
      #chat-header {
        background: var(--primary, #6366f1);
        color: #fff;
        padding: 12px 16px;
        font-weight: 700;
        font-size: 14px;
        display: flex; align-items: center; gap: 8px;
        flex-shrink: 0;
      }
      #chat-header span { flex: 1; }
      #chat-close-btn {
        background: none; border: none; color: #fff;
        font-size: 18px; cursor: pointer; line-height: 1;
        opacity: .8; padding: 0;
      }
      #chat-close-btn:hover { opacity: 1; }

      /* Messages area */
      #chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex; flex-direction: column;
        gap: 8px;
        background: #f8fafc;
      }
      .chat-msg {
        max-width: 80%;
        padding: 7px 11px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.45;
        word-break: break-word;
      }
      .chat-msg.mine {
        align-self: flex-end;
        background: var(--primary, #6366f1);
        color: #fff;
        border-bottom-right-radius: 3px;
      }
      .chat-msg.other {
        align-self: flex-start;
        background: #e2e8f0;
        color: #1e293b;
        border-bottom-left-radius: 3px;
      }
      .chat-msg-meta {
        font-size: 10px;
        opacity: .65;
        margin-top: 3px;
        font-weight: 500;
      }
      .chat-msg.mine .chat-msg-meta { text-align: right; }

      /* Day divider */
      .chat-day-divider {
        text-align: center;
        font-size: 11px;
        color: #94a3b8;
        margin: 4px 0;
      }

      /* Empty state */
      #chat-empty {
        flex: 1; display: flex; align-items: center; justify-content: center;
        color: #94a3b8; font-size: 13px; text-align: center;
        padding: 16px;
      }

      /* Input area */
      #chat-input-area {
        display: flex; gap: 8px;
        padding: 10px 12px;
        border-top: 1px solid #e2e8f0;
        background: #fff;
        flex-shrink: 0;
      }
      #chat-input {
        flex: 1;
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        padding: 7px 14px;
        font-size: 13px;
        outline: none;
        resize: none;
        font-family: inherit;
        max-height: 80px;
        line-height: 1.4;
      }
      #chat-input:focus { border-color: var(--primary, #6366f1); }
      #chat-send-btn {
        background: var(--primary, #6366f1);
        color: #fff;
        border: none;
        border-radius: 50%;
        width: 36px; height: 36px;
        font-size: 16px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        transition: background .15s;
      }
      #chat-send-btn:hover { background: #4f46e5; }
      #chat-send-btn:disabled { background: #c7d2fe; cursor: default; }
    `;
    document.head.appendChild(style);

    // Bubble
    const bubble = document.createElement('button');
    bubble.id = 'chat-bubble';
    bubble.title = 'Chat team';
    bubble.innerHTML = `💬<span id="chat-unread-badge" class="hidden">0</span>`;
    bubble.addEventListener('click', toggleChat);
    document.body.appendChild(bubble);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.innerHTML = `
      <div id="chat-header">
        <span>💬 Chat Team</span>
        <button id="chat-close-btn" title="Chiudi">✕</button>
      </div>
      <div id="chat-messages"></div>
      <div id="chat-input-area">
        <textarea id="chat-input" placeholder="Scrivi un messaggio…" rows="1"></textarea>
        <button id="chat-send-btn" title="Invia">➤</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Events
    document.getElementById('chat-close-btn').addEventListener('click', closeChat);
    document.getElementById('chat-send-btn').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    // Auto-resize textarea
    document.getElementById('chat-input').addEventListener('input', autoResizeInput);
  }

  function autoResizeInput() {
    const ta = document.getElementById('chat-input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
  }

  // ─── Toggle / open / close ────────────────────────────────────────────────
  function toggleChat() {
    if (_open) closeChat(); else openChat();
  }
  function openChat() {
    _open = true;
    document.getElementById('chat-panel').classList.add('open');
    resetUnread();
    scrollToBottom();
    document.getElementById('chat-input').focus();
    startPolling();
  }
  function closeChat() {
    _open = false;
    document.getElementById('chat-panel').classList.remove('open');
  }

  // ─── Unread badge ─────────────────────────────────────────────────────────
  function addUnread(count) {
    _unread += count;
    const badge = document.getElementById('chat-unread-badge');
    if (_unread > 0) {
      badge.textContent = _unread > 99 ? '99+' : _unread;
      badge.classList.remove('hidden');
    }
  }
  function resetUnread() {
    _unread = 0;
    const badge = document.getElementById('chat-unread-badge');
    badge.classList.add('hidden');
  }

  // ─── Rendering messaggi ───────────────────────────────────────────────────
  function renderMessages(msgs, append = false) {
    const container = document.getElementById('chat-messages');
    if (!append) container.innerHTML = '';

    if (msgs.length === 0 && !append) {
      container.innerHTML = '<div id="chat-empty">Nessun messaggio ancora.<br>Di\' qualcosa! 👋</div>';
      return;
    }

    // Rimuovi empty state se presente
    const empty = container.querySelector('#chat-empty');
    if (empty) empty.remove();

    msgs.forEach((m) => {
      const isMine = m.sender_id === _myUserId;
      const div = document.createElement('div');
      div.className = 'chat-msg ' + (isMine ? 'mine' : 'other');
      div.innerHTML = `
        <div>${escHtml(m.message)}</div>
        <div class="chat-msg-meta">${isMine ? '' : escHtml(m.sender_nome) + ' · '}${m.ora}</div>
      `;
      container.appendChild(div);
    });

    scrollToBottom();
  }

  function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Fetch messaggi ───────────────────────────────────────────────────────
  async function fetchMessages(initial = false) {
    try {
      const res = await fetch('/api/chat');
      if (res.status === 401) return; // non autenticato
      if (!res.ok) return;
      const msgs = await res.json();

      if (initial) {
        _messages = msgs;
        _lastId   = msgs.length ? msgs[msgs.length - 1].id : 0;
        renderMessages(msgs, false);
        // Rileva myUserId dal primo messaggio che ha session — usiamo l'API me
        detectMyUser();
      } else {
        const newMsgs = msgs.filter(m => m.id > _lastId);
        if (newMsgs.length) {
          _lastId = newMsgs[newMsgs.length - 1].id;
          renderMessages(newMsgs, true);
          if (!_open) addUnread(newMsgs.length);
        }
      }
    } catch (_) { /* ignora errori di rete */ }
  }

  async function detectMyUser() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        _myUserId = data.id;
        // Ri-renderizza con mine/other corretti
        renderMessages(_messages, false);
      }
    } catch (_) { /* fallback: resterà null, tutti i messaggi "other" */ }
  }

  // ─── Polling ──────────────────────────────────────────────────────────────
  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(() => fetchMessages(false), 5000);
  }

  // ─── Invio messaggio ──────────────────────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text) return;

    const btn = document.getElementById('chat-send-btn');
    btn.disabled = true;
    input.value  = '';
    input.style.height = '';

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text })
      });
      if (!res.ok) { input.value = text; return; }
      const msg = await res.json();

      // Se non ho ancora il mio userId, lo rilevo dal messaggio inviato
      if (!_myUserId) _myUserId = msg.sender_id;

      // Aggiorna _lastId e aggiungi al DOM
      if (msg.id > _lastId) _lastId = msg.id;
      renderMessages([msg], true);
    } catch (_) {
      input.value = text; // ripristina se errore rete
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    buildWidget();
    fetchMessages(true);
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
