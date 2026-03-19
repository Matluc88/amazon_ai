// ─── Cattura TUTTI gli errori (anche al caricamento moduli) ──
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:');
  console.error('  message:', err?.message);
  console.error('  name   :', err?.name);
  console.error('  code   :', err?.code);
  console.error('  stack  :', err?.stack || String(err));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 UNHANDLED REJECTION:', reason);
  process.exit(1);
});

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const path = require('path');
const { pool, initDatabase } = require('./database/db');
const { runSeed } = require('./database/seed');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Mappa in memoria per tracking "chi sta editando quale prodotto"
// { productId (number) → { userId, nome, updatedAt } }
app.locals.editingMap = new Map();
// Pulizia automatica ogni minuto (rimuove sessioni > 2 minuti)
setInterval(() => {
  const threshold = Date.now() - 120_000;
  for (const [key, val] of app.locals.editingMap.entries()) {
    if (val.updatedAt < threshold) app.locals.editingMap.delete(key);
  }
}, 60_000);

// ─── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'amazon-ai-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 giorni
    httpOnly: true,
    secure: false // metti true in produzione con HTTPS
  }
}));

// ─── Route pubbliche (no auth) ───────────────────────────────
app.use('/api/auth', require('./routes/auth'));

// Pagina login pubblica
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Redirect root → login se non autenticato
app.get('/', (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login.html');
  next();
});

// Route HTML senza estensione (protette da auth)
app.get('/listing', (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'listing.html'));
});

app.get('/config', (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

app.get('/cerebro', (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'cerebro.html'));
});

// ─── File statici (protetti) ─────────────────────────────────
app.use((req, res, next) => {
  // Lascia passare login.html, css, js (pubblici)
  const publicPaths = ['/login.html', '/css/', '/js/'];
  if (publicPaths.some(p => req.path.startsWith(p))) return next();
  // Tutto il resto richiede auth (per le pagine HTML)
  if (!req.path.startsWith('/api/') && req.path.endsWith('.html') && !req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── Route API protette ──────────────────────────────────────
app.use('/api/products', requireAuth, require('./routes/products'));
app.use('/api/upload',   requireAuth, require('./routes/upload'));
app.use('/api/listings', requireAuth, require('./routes/listings'));
app.use('/api/keywords', requireAuth, require('./routes/keywords'));
app.use('/api/config',   requireAuth, require('./routes/config'));
app.use('/api/export',   requireAuth, require('./routes/export'));
app.use('/api/images',   requireAuth, require('./routes/images'));
app.use('/api/chat',     requireAuth, require('./routes/chat'));
app.use('/api/international', requireAuth, require('./routes/international'));
app.use('/api/cerebro',       requireAuth, require('./routes/cerebro'));

// ─── Avvio ───────────────────────────────────────────────────
async function start() {
  try {
    console.log('🔄 Step 1: initDatabase...');
    await initDatabase();

    console.log('🔄 Step 2: runSeed...');
    await runSeed();

    console.log('🔄 Step 3: app.listen...');
    app.listen(PORT, () => {
      console.log(`🚀 Server avviato su http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Errore avvio server');
    console.error('  message :', err?.message);
    console.error('  name    :', err?.name);
    console.error('  code    :', err?.code);
    console.error('  stack   :', err?.stack || String(err));
    process.exit(1);
  }
}

start();
