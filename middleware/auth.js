/**
 * Middleware di autenticazione — protegge tutte le route
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  // Se è una richiesta API, rispondi con 401 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non autenticato. Effettua il login.' });
  }
  // Altrimenti redirect alla pagina di login
  return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.ruolo === 'admin') {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Accesso riservato agli amministratori.' });
  }
  return res.redirect('/');
}

module.exports = { requireAuth, requireAdmin };
