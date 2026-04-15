// Check scadenza token Meta via debug_token endpoint.
// Salva il risultato in app_tokens.
//
// Uso manuale: node scripts/check-meta-token.js
// Uso automatico: viene chiamato da sync-metrics.js ogni notte

require('dotenv').config();
const { query, pool } = require('../database/db');

async function checkMetaToken() {
  const token = process.env.META_ACCESS_TOKEN;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!token) {
    return { status: 'missing', error_message: 'META_ACCESS_TOKEN non configurato' };
  }

  // debug_token richiede app_id|app_secret come access_token
  let debugAuth;
  if (appId && appSecret) {
    debugAuth = `${appId}|${appSecret}`;
  } else {
    // Fallback: usa il token stesso (funziona ma risposta meno completa)
    debugAuth = token;
  }

  const url = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(debugAuth)}`;

  try {
    const res = await fetch(url);
    const json = await res.json();

    if (json.error) {
      return { status: 'error', error_message: json.error.message || 'Errore API' };
    }

    const data = json.data || {};
    const expiresAt = data.expires_at ? new Date(data.expires_at * 1000) : null;
    const isValid = data.is_valid === true;

    if (!isValid) {
      return {
        status: 'invalid',
        error_message: data.error?.message || 'Token non valido',
        expires_at: expiresAt,
      };
    }

    // Meta ritorna expires_at=0 per token non scadenti (system user tokens)
    if (!data.expires_at || data.expires_at === 0) {
      return { status: 'permanent', expires_at: null, days_remaining: null };
    }

    const daysRemaining = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
    let status = 'ok';
    if (daysRemaining <= 3) status = 'critical';
    else if (daysRemaining <= 14) status = 'warning';

    return { status, expires_at: expiresAt, days_remaining: daysRemaining };
  } catch (err) {
    return { status: 'error', error_message: err.message };
  }
}

async function saveTokenStatus(platform, result) {
  await query(
    `INSERT INTO app_tokens (platform, expires_at, days_remaining, status, error_message, checked_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (platform) DO UPDATE SET
       expires_at      = EXCLUDED.expires_at,
       days_remaining  = EXCLUDED.days_remaining,
       status          = EXCLUDED.status,
       error_message   = EXCLUDED.error_message,
       checked_at      = NOW()`,
    [
      platform,
      result.expires_at || null,
      result.days_remaining || null,
      result.status,
      result.error_message || null,
    ]
  );
}

async function main() {
  console.log('🔐 Check Meta token...');
  const result = await checkMetaToken();
  console.log('   Status:', result.status);
  if (result.expires_at) console.log('   Scadenza:', result.expires_at.toISOString().slice(0, 10));
  if (result.days_remaining) console.log('   Giorni rimasti:', result.days_remaining);
  if (result.error_message) console.log('   Errore:', result.error_message);
  await saveTokenStatus('meta', result);
  console.log('✅ Salvato in app_tokens');
  await pool.end();
}

// Esporta per uso da sync-metrics
module.exports = { checkMetaToken, saveTokenStatus };

// Standalone execution
if (require.main === module) {
  main().catch((err) => {
    console.error('💥', err);
    process.exit(1);
  });
}
