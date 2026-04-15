// Wizard one-shot per configurare Google Business Profile sulla dashboard.
//
// Fa tutto in 3 fasi:
//   1. OAuth utente → genera refresh_token
//   2. Lista gli account Business Profile accessibili dall'utente
//   3. Lista le location di ogni account, utente sceglie quella giusta
//   4. Salva GBP_REFRESH_TOKEN e GBP_LOCATION_ID in .env
//
// Prerequisiti:
//   - GBP_CLIENT_ID e GBP_CLIENT_SECRET nel .env (stesso OAuth client di Google Ads
//     va benissimo, basta che abbia http://127.0.0.1:8766/callback nei redirect autorizzati)
//   - API "Business Profile Performance API", "My Business Account Management API" e
//     "My Business Business Information API" abilitate nel progetto GCP
//   - L'utente che fa login deve essere owner/manager della Business Profile
//
// Uso:
//   node scripts/gbp-setup.js

require('dotenv').config();
const http = require('http');
const { exec } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const PORT = 8766;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

const clientId = process.env.GBP_CLIENT_ID;
const clientSecret = process.env.GBP_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌ Mancano GBP_CLIENT_ID o GBP_CLIENT_SECRET nel .env');
  console.error('   Puoi riusare lo stesso OAuth Client di Google Ads: basta aggiungere');
  console.error(`   ${REDIRECT_URI} nei Redirect URI autorizzati di quel client.`);
  process.exit(1);
}

function updateEnv(updates) {
  const envPath = path.join(__dirname, '..', '.env');
  let env = fs.readFileSync(envPath, 'utf8');
  for (const [key, val] of Object.entries(updates)) {
    const re = new RegExp('^' + key + '=.*$', 'm');
    const line = `${key}=${val}`;
    if (re.test(env)) env = env.replace(re, line);
    else env = env.trimEnd() + '\n' + line + '\n';
  }
  fs.writeFileSync(envPath, env);
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  }
  return json;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function doOAuth() {
  return new Promise((resolve, reject) => {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPE);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Errore OAuth</h1><p>${error}</p>`);
        server.close();
        reject(new Error(error));
        return;
      }
      if (!code) { res.writeHead(400); res.end('Missing code'); return; }

      try {
        const tokens = await exchangeCode(code);
        if (!tokens.refresh_token) {
          throw new Error('Nessun refresh_token ricevuto. Rimuovi accesso app su https://myaccount.google.com/permissions e riprova.');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto;">
          <h1>✅ OAuth completato!</h1>
          <p>Torna al terminale per completare il wizard.</p>
        </body></html>`);
        setTimeout(() => { server.close(); resolve(tokens.refresh_token); }, 500);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Errore</h1><pre>${err.message}</pre>`);
        server.close();
        reject(err);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log('');
      console.log('🔐 Step 1/3 — OAuth Google Business Profile');
      console.log('');
      console.log('   Apro il browser per il consenso...');
      const opener = process.platform === 'darwin' ? 'open' :
                     process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${opener} "${authUrl.toString()}"`);
    });
  });
}

async function main() {
  try {
    // ── Step 1: OAuth ──
    const refreshToken = await doOAuth();
    updateEnv({ GBP_REFRESH_TOKEN: refreshToken });
    console.log('✅ Refresh token salvato in .env');

    // ── Step 2: Lista account ──
    console.log('');
    console.log('🏢 Step 2/3 — Lista account Business Profile accessibili');
    console.log('');
    const { listAccounts, listLocations } = require('../services/gbpService');
    const accounts = await listAccounts();
    if (!accounts.length) {
      console.error('❌ Nessun account Business Profile trovato per questo utente Google.');
      console.error('   L\'utente deve essere owner o manager di almeno un Business Profile.');
      process.exit(1);
    }
    console.log(`   Trovati ${accounts.length} account:`);
    accounts.forEach((a, i) => {
      console.log(`   [${i + 1}] ${a.accountName || a.name} — ${a.name} (${a.type || 'PERSONAL'})`);
    });

    let accountIdx = 1;
    if (accounts.length > 1) {
      const answer = await prompt(`\n   Quale account vuoi usare? [1-${accounts.length}]: `);
      accountIdx = Math.max(1, Math.min(accounts.length, Number(answer) || 1));
    }
    const chosenAccount = accounts[accountIdx - 1];
    console.log(`   → ${chosenAccount.name}`);

    // ── Step 3: Lista location ──
    console.log('');
    console.log('📍 Step 3/3 — Lista punti vendita (location)');
    console.log('');
    const locations = await listLocations(chosenAccount.name);
    if (!locations.length) {
      console.error('❌ Nessuna location trovata in questo account.');
      process.exit(1);
    }
    console.log(`   Trovati ${locations.length} punti vendita:`);
    locations.forEach((loc, i) => {
      const addr = loc.storefrontAddress
        ? `${(loc.storefrontAddress.addressLines || []).join(', ')}, ${loc.storefrontAddress.postalCode || ''} ${loc.storefrontAddress.locality || ''}`
        : '(no address)';
      console.log(`   [${i + 1}] ${loc.title || loc.name}`);
      console.log(`       📍 ${addr}`);
      console.log(`       🔗 ${loc.websiteUri || '—'}`);
      console.log(`       id: ${loc.name}`);
    });

    let locIdx = 1;
    if (locations.length > 1) {
      const answer = await prompt(`\n   Quale location vuoi usare? [1-${locations.length}]: `);
      locIdx = Math.max(1, Math.min(locations.length, Number(answer) || 1));
    }
    const chosenLoc = locations[locIdx - 1];
    updateEnv({ GBP_LOCATION_ID: chosenLoc.name });
    console.log('');
    console.log('✅ GBP_LOCATION_ID salvato:', chosenLoc.name);
    console.log('');
    console.log('🎉 Setup completato! Ora puoi lanciare:');
    console.log('');
    console.log('   node scripts/sync-metrics.js 30');
    console.log('');
    console.log('per scaricare le ultime 30 giorni di dati GBP.');
    process.exit(0);
  } catch (err) {
    console.error('💥', err.message || err);
    process.exit(1);
  }
}

main();
