// Scambia il token Meta short-lived (1-2h) con uno long-lived (~60 giorni).
//
// Prerequisiti — aggiungi queste 2 righe al .env PRIMA di lanciare:
//   META_APP_ID=...         (da developers.facebook.com/apps/<APP>/settings/basic)
//   META_APP_SECRET=...     (stesso posto, clicca "Mostra")
//
// Uso:
//   node scripts/meta-longlived-token.js
//
// Lo script usa il META_ACCESS_TOKEN attuale dal .env come input,
// e stampa il nuovo long-lived token da copiare manualmente nel .env
// (sovrascrivendo la riga META_ACCESS_TOKEN).

require('dotenv').config();

const appId = process.env.META_APP_ID;
const appSecret = process.env.META_APP_SECRET;
const shortToken = process.env.META_ACCESS_TOKEN;

if (!appId || !appSecret || !shortToken) {
  console.error('❌ Mancano env vars richieste nel .env:');
  if (!appId)      console.error('   - META_APP_ID');
  if (!appSecret)  console.error('   - META_APP_SECRET');
  if (!shortToken) console.error('   - META_ACCESS_TOKEN (lo short-lived attuale)');
  process.exit(1);
}

const url = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
url.searchParams.set('grant_type', 'fb_exchange_token');
url.searchParams.set('client_id', appId);
url.searchParams.set('client_secret', appSecret);
url.searchParams.set('fb_exchange_token', shortToken);

(async () => {
  try {
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok || json.error) {
      console.error('❌ Errore Meta:', JSON.stringify(json, null, 2));
      process.exit(1);
    }

    const newToken = json.access_token;
    const expiresIn = json.expires_in; // secondi
    const days = expiresIn ? Math.round(expiresIn / 86400) : '~60';

    console.log('✅ Long-lived token generato');
    console.log('   Scadenza stimata:', days, 'giorni');
    console.log('');
    console.log('🔑 Nuovo token (copialo nel .env come META_ACCESS_TOKEN):');
    console.log('');
    console.log(newToken);
    console.log('');
    console.log('⚠️  Dopo aver aggiornato il .env locale, ricordati di aggiornare');
    console.log('    la stessa env var anche su Render (web service + cron job).');
  } catch (err) {
    console.error('❌ Errore di rete:', err.message);
    process.exit(1);
  }
})();
