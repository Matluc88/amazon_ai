const express = require('express');
const router  = express.Router();
const { query } = require('../database/db');

// GET /api/chat — ultimi 100 messaggi (dal più vecchio al più nuovo)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, sender_id, sender_nome, message,
              to_char(created_at AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS ora,
              created_at
       FROM chat_messages
       ORDER BY created_at ASC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Chat GET error:', err);
    res.status(500).json({ error: 'Errore lettura messaggi' });
  }
});

// POST /api/chat — invia un nuovo messaggio
router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Messaggio vuoto' });
  }
  try {
    const result = await query(
      `INSERT INTO chat_messages (sender_id, sender_nome, message)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, sender_nome, message,
                 to_char(created_at AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS ora,
                 created_at`,
      [
        req.session.userId,
        req.session.nome || req.session.email || 'Utente',
        message.trim()
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Chat POST error:', err);
    res.status(500).json({ error: 'Errore invio messaggio' });
  }
});

module.exports = router;
