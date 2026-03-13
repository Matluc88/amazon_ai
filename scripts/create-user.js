/**
 * Script per creare / aggiornare un utente nel database.
 *
 * Uso:
 *   node scripts/create-user.js <email> <password> [nome] [ruolo]
 *
 * Esempi:
 *   node scripts/create-user.js admin@sivigliart.com MyPass123 Matteo admin
 *   node scripts/create-user.js emanuela@sivigliart.com MyPass123 Emanuela
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');

async function createUser() {
  const [,, email, password, nome = '', ruolo = 'operatore'] = process.argv;

  if (!email || !password) {
    console.error('❌ Uso: node scripts/create-user.js <email> <password> [nome] [ruolo]');
    process.exit(1);
  }

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
      [email.toLowerCase().trim(), hash, nome, ruolo]
    );
    console.log('✅ Utente creato/aggiornato:', result.rows[0]);
  } catch (err) {
    console.error('❌ Errore:', err.message);
  }
  process.exit(0);
}

createUser();
