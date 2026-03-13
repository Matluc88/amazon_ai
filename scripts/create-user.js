/**
 * Script per creare un nuovo utente nel database.
 * Uso: node scripts/create-user.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');

async function createUser() {
  const email    = 'emanuela@sivigliart.com';
  const password = '***REMOVED***';
  const nome     = 'Emanuela';
  const ruolo    = 'operatore';

  const hash = await bcrypt.hash(password, 12);

  try {
    const result = await query(
      `INSERT INTO users (email, password_hash, nome, ruolo)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             nome          = EXCLUDED.nome,
             ruolo         = EXCLUDED.ruolo
       RETURNING id, email, nome, ruolo`,
      [email, hash, nome, ruolo]
    );
    console.log('✅ Utente creato/aggiornato:', result.rows[0]);
  } catch (err) {
    console.error('❌ Errore:', err.message);
  }
  process.exit(0);
}

createUser();
