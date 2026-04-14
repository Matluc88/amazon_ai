// Google Merchant Center — Content API for Shopping v2.1
// Legge lo stato del catalogo (approvati / limitati / disapprovati) e la lista
// problemi per i prodotti non in regola.
//
// Auth: Service Account JWT (stesso meccanismo di ga4Service ma con scope diverso).
//
// Env vars richieste:
//   MERCHANT_ACCOUNT_ID                — ID numerico Merchant Center (es. 120336385)
//   MERCHANT_SERVICE_ACCOUNT_KEY_B64   — JSON service account encoded base64
//                                        (può essere lo STESSO di GA4_SERVICE_ACCOUNT_KEY_B64)
//
// Il service account deve essere aggiunto come utente in:
// Merchant Center → Impostazioni → Utenti e accessi → Aggiungi utente.
//
// Docs: https://developers.google.com/shopping-content/reference/rest

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/content';
const API_BASE = 'https://shoppingcontent.googleapis.com/content/v2.1';

let cachedToken = null;
let cachedExpiry = 0;

function loadServiceAccount() {
  // Preferiamo una chiave dedicata al Merchant, ma se non esiste fallback su quella GA4
  const b64 = process.env.MERCHANT_SERVICE_ACCOUNT_KEY_B64 || process.env.GA4_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) throw new Error('MERCHANT_SERVICE_ACCOUNT_KEY_B64 (o GA4_SERVICE_ACCOUNT_KEY_B64) mancante');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedExpiry - 60_000) return cachedToken;

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const claimB64 = base64url(JSON.stringify(claim));
  const signingInput = `${headerB64}.${claimB64}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Merchant OAuth failed: ${JSON.stringify(json)}`);
  }
  cachedToken = json.access_token;
  cachedExpiry = Date.now() + (json.expires_in * 1000);
  return cachedToken;
}

/**
 * Scarica TUTTI i productstatuses del Merchant con paginazione.
 * Ritorna array di oggetti productstatus grezzi dalla API.
 */
async function fetchAllProductStatuses() {
  const merchantId = process.env.MERCHANT_ACCOUNT_ID;
  if (!merchantId) throw new Error('MERCHANT_ACCOUNT_ID mancante');

  const token = await getAccessToken();
  const allRows = [];
  let pageToken;

  do {
    const url = new URL(`${API_BASE}/${merchantId}/productstatuses`);
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`Merchant API ${res.status}: ${JSON.stringify(json).slice(0, 800)}`);
    }
    if (Array.isArray(json.resources)) allRows.push(...json.resources);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return allRows;
}

/**
 * Normalizza un productstatus in una o più righe "issue" per la tabella.
 * Un prodotto può avere N issue, ognuna su un paese diverso.
 * Se il prodotto è approvato ovunque, ritorna [] (niente da salvare).
 */
function normalizeProductStatus(ps) {
  const rows = [];
  const issues = Array.isArray(ps.itemLevelIssues) ? ps.itemLevelIssues : [];
  const destinations = Array.isArray(ps.destinationStatuses) ? ps.destinationStatuses : [];

  // Calcoliamo lo stato "peggiore" tra tutte le destination per sintetizzare
  let overall = 'approved';
  for (const d of destinations) {
    if (Array.isArray(d.disapprovedCountries) && d.disapprovedCountries.length > 0) overall = 'disapproved';
    else if (Array.isArray(d.pendingCountries) && d.pendingCountries.length > 0 && overall === 'approved') overall = 'pending';
  }
  if (issues.some((i) => i.servability === 'disapproved')) overall = 'disapproved';
  else if (issues.some((i) => i.servability === 'unaffected')) { /* resta approved */ }
  else if (issues.length > 0 && overall === 'approved') overall = 'limited';

  if (!issues.length && overall === 'approved') return rows;

  if (!issues.length) {
    rows.push({
      product_id: ps.productId || '',
      title: ps.title || '',
      link: ps.link || '',
      image_link: ps.googleExpirationDate ? '' : '',
      status: overall,
      country: null,
      issue_code: null,
      issue_severity: null,
      issue_description: null,
      issue_detail: null,
    });
    return rows;
  }

  for (const issue of issues) {
    const countries = Array.isArray(issue.applicableCountries) && issue.applicableCountries.length
      ? issue.applicableCountries
      : [null];
    for (const country of countries) {
      rows.push({
        product_id: ps.productId || '',
        title: ps.title || '',
        link: ps.link || '',
        image_link: '',
        status: issue.servability === 'disapproved' ? 'disapproved' : (issue.servability === 'unaffected' ? 'limited' : overall),
        country,
        issue_code: issue.code || null,
        issue_severity: issue.servability || null,
        issue_description: issue.description || null,
        issue_detail: issue.detail || null,
      });
    }
  }
  return rows;
}

/**
 * Scarica TUTTO il catalogo Merchant e ritorna:
 *   - counts: { total, approved, limited, disapproved, pending }
 *   - issues: array di righe pronte per metrics_merchant_issues
 */
async function fetchCatalogSnapshot() {
  const statuses = await fetchAllProductStatuses();
  const counts = { total: statuses.length, approved: 0, limited: 0, disapproved: 0, pending: 0 };
  const issues = [];

  for (const ps of statuses) {
    const destinations = Array.isArray(ps.destinationStatuses) ? ps.destinationStatuses : [];
    const itemIssues = Array.isArray(ps.itemLevelIssues) ? ps.itemLevelIssues : [];

    // Determina stato complessivo prodotto
    let productStatus = 'approved';
    const hasDisapproved = destinations.some((d) =>
      (d.disapprovedCountries && d.disapprovedCountries.length > 0)
    ) || itemIssues.some((i) => i.servability === 'disapproved');
    const hasPending = destinations.some((d) =>
      (d.pendingCountries && d.pendingCountries.length > 0)
    );
    const hasLimited = itemIssues.length > 0;

    if (hasDisapproved) productStatus = 'disapproved';
    else if (hasPending) productStatus = 'pending';
    else if (hasLimited) productStatus = 'limited';

    counts[productStatus]++;

    // Normalizza in righe issue
    const productRows = normalizeProductStatus(ps);
    issues.push(...productRows);
  }

  return { counts, issues };
}

module.exports = {
  getAccessToken,
  fetchAllProductStatuses,
  fetchCatalogSnapshot,
};
