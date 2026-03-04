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

// ─── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
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

// ─── Avvio ───────────────────────────────────────────────────
async function start() {
  try {
    await initDatabase();
    await runSeed();
    app.listen(PORT, () => {
      console.log(`🚀 Server avviato su http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Errore avvio server:', err.message);
    process.exit(1);
  }
}

start();
