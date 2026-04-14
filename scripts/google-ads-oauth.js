// Script one-shot per generare il GOOGLE_ADS_REFRESH_TOKEN.
//
// Come funziona:
//   1. Avvia un mini server HTTP su 127.0.0.1:8765
//   2. Apre il browser sulla pagina di consenso Google
//   3. Catturata l'autorizzazione, riceve il "code" sul callback locale
//   4. Scambia il code con refresh_token via OAuth2 token endpoint
//   5. Scrive automaticamente GOOGLE_ADS_REFRESH_TOKEN nel .env
//
// Prerequisiti nel .env:
//   GOOGLE_ADS_CLIENT_ID
//   GOOGLE_ADS_CLIENT_SECRET
//
// Uso:
//   node scripts/google-ads-oauth.js

require('dotenv').config();
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌ Mancano GOOGLE_ADS_CLIENT_ID o GOOGLE_ADS_CLIENT_SECRET nel .env');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

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

function updateEnv(refreshToken) {
  const envPath = path.join(__dirname, '..', '.env');
  let env = fs.readFileSync(envPath, 'utf8');
  const re = /^GOOGLE_ADS_REFRESH_TOKEN=.*$/m;
  const line = `GOOGLE_ADS_REFRESH_TOKEN=${refreshToken}`;
  if (re.test(env)) env = env.replace(re, line);
  else env = env.trimEnd() + '\n' + line + '\n';
  fs.writeFileSync(envPath, env);
}

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
    console.error('❌ OAuth error:', error);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400);
    res.end('Missing code');
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      throw new Error('Nessun refresh_token ricevuto. Prova a rimuovere l\'accesso dell\'app su https://myaccount.google.com/permissions e riprova.');
    }
    updateEnv(tokens.refresh_token);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto;">
        <h1>✅ Refresh token generato!</h1>
        <p>Il token è stato salvato automaticamente nel file <code>.env</code> del progetto come <code>GOOGLE_ADS_REFRESH_TOKEN</code>.</p>
        <p>Puoi chiudere questa scheda e tornare al terminale.</p>
      </body></html>
    `);
    console.log('✅ Refresh token salvato in .env');
    console.log('   access_token (temporaneo, non serve salvarlo):', tokens.access_token.slice(0, 20) + '...');
    console.log('   scadenza access_token:', tokens.expires_in, 'secondi');
    console.log('');
    console.log('Ora puoi eseguire: node scripts/sync-metrics.js 7');
    setTimeout(() => { server.close(); process.exit(0); }, 500);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>Errore</h1><pre>${err.message}</pre>`);
    console.error('❌', err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('🔐 Google Ads OAuth — generazione refresh token');
  console.log('');
  console.log('Apro il browser sulla pagina di consenso Google...');
  console.log('URL:', authUrl.toString());
  console.log('');
  console.log('In ascolto su', REDIRECT_URI);

  const opener = process.platform === 'darwin' ? 'open' :
                 process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${opener} "${authUrl.toString()}"`, (err) => {
    if (err) {
      console.log('⚠️  Impossibile aprire il browser automaticamente.');
      console.log('    Apri manualmente questo URL:');
      console.log('    ' + authUrl.toString());
    }
  });
});
