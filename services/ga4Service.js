// Google Analytics 4 — client REST con auth via Service Account JWT.
// Zero dipendenze esterne: usa fetch nativo + crypto built-in.
//
// Env vars richieste:
//   GA4_PROPERTY_ID                — ID numerico della proprietà GA4
//   GA4_SERVICE_ACCOUNT_KEY_B64    — JSON service account encoded base64
//   GA4_SERVICE_ACCOUNT_EMAIL      — email del service account (per logging)
//
// Docs: https://developers.google.com/analytics/devguides/reporting/data/v1/rest

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const API_BASE = 'https://analyticsdata.googleapis.com/v1beta';

let cachedToken = null;
let cachedExpiry = 0;

function loadServiceAccount() {
  const b64 = process.env.GA4_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) throw new Error('GA4_SERVICE_ACCOUNT_KEY_B64 mancante');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Costruisce un JWT signed (RS256) e lo scambia con un access_token OAuth2.
 * Cache in memoria per evitare di rigenerare ad ogni chiamata.
 */
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
    throw new Error(`GA4 OAuth failed: ${JSON.stringify(json)}`);
  }
  cachedToken = json.access_token;
  cachedExpiry = Date.now() + (json.expires_in * 1000);
  return cachedToken;
}

/**
 * Esegue una runReport sulla proprietà GA4 configurata.
 */
async function runReport({ dateFrom, dateTo, dimensions = [], metrics = [], orderBys = [], limit = 10000 }) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error('GA4_PROPERTY_ID mancante');

  const token = await getAccessToken();
  const url = `${API_BASE}/properties/${propertyId}:runReport`;
  const body = {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: dimensions.map((d) => ({ name: d })),
    metrics: metrics.map((m) => ({ name: m })),
    orderBys,
    limit,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GA4 runReport ${res.status}: ${JSON.stringify(json).slice(0, 800)}`);
  }
  return json;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Scarica metriche giornaliere per sorgente di traffico (source/medium).
 * Ritorna righe pronte per metrics_ga4_daily.
 */
async function fetchDailyBySource({ dateFrom, dateTo }) {
  const report = await runReport({
    dateFrom,
    dateTo,
    dimensions: ['date', 'sessionSourceMedium'],
    metrics: [
      'sessions',
      'totalUsers',
      'screenPageViews',
      'conversions',
      'totalRevenue',
    ],
    orderBys: [{ dimension: { dimensionName: 'date' }, desc: true }],
  });

  const rows = (report.rows || []).map((r) => {
    const dims = r.dimensionValues || [];
    const mets = r.metricValues || [];
    const dateRaw = dims[0] ? dims[0].value : '';
    // GA4 ritorna le date come "YYYYMMDD", normalizziamo a "YYYY-MM-DD"
    const date = dateRaw.length === 8
      ? `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`
      : dateRaw;
    return {
      date,
      property_id: process.env.GA4_PROPERTY_ID,
      source: dims[1] ? dims[1].value : '(not set)',
      sessions: Number((mets[0] || {}).value || 0),
      users: Number((mets[1] || {}).value || 0),
      page_views: Number((mets[2] || {}).value || 0),
      conversions: Number((mets[3] || {}).value || 0),
      ecommerce_revenue: Number((mets[4] || {}).value || 0),
    };
  });

  return rows;
}

/**
 * Wrapper "ultimi N giorni" usato dal cron.
 */
async function fetchLastDays(days = 90) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return fetchDailyBySource({
    dateFrom: formatDate(from),
    dateTo: formatDate(to),
  });
}

module.exports = {
  getAccessToken,
  runReport,
  fetchDailyBySource,
  fetchLastDays,
};
