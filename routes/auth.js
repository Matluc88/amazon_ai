const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e password obbligatorie' });
    }

    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    // Salva in sessione
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.nome = user.nome;
    req.session.ruolo = user.ruolo;

    res.json({
      success: true,
      user: { id: user.id, email: user.email, nome: user.nome, ruolo: user.ruolo }
    });
  } catch (err) {
    console.error('Errore login:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// GET /api/auth/me — info utente corrente
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  res.json({
    id: req.session.userId,
    email: req.session.email,
    nome: req.session.nome,
    ruolo: req.session.ruolo
  });
});

// GET /api/auth/users — lista utenti (solo admin)
router.get('/users', async (req, res) => {
  if (req.session.ruolo !== 'admin') {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  try {
    const result = await query('SELECT id, email, nome, ruolo, created_at FROM users ORDER BY created_at');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/users — crea utente (solo admin)
router.post('/users', async (req, res) => {
  if (req.session.ruolo !== 'admin') {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  try {
    const { email, password, nome, ruolo = 'operatore' } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e password obbligatorie' });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (email, password_hash, nome, ruolo) VALUES ($1, $2, $3, $4) RETURNING id, email, nome, ruolo',
      [email.toLowerCase().trim(), hash, nome || '', ruolo]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email già registrata' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auth/users/:id — elimina utente (solo admin)
router.delete('/users/:id', async (req, res) => {
  if (req.session.ruolo !== 'admin') {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  try {
    if (parseInt(req.params.id) === req.session.userId) {
      return res.status(400).json({ error: 'Non puoi eliminare il tuo account' });
    }
    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
