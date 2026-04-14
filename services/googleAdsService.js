// Google Ads API — client REST + GAQL (nessuna dipendenza gRPC).
//
// Env vars richieste:
//   GOOGLE_ADS_DEVELOPER_TOKEN   — developer token del Manager account (MCC)
//   GOOGLE_ADS_CLIENT_ID         — OAuth 2.0 Client ID (Google Cloud Console)
//   GOOGLE_ADS_CLIENT_SECRET     — OAuth 2.0 Client Secret
//   GOOGLE_ADS_REFRESH_TOKEN     — refresh token generato da scripts/google-ads-oauth.js
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID — MCC (Manager) customer ID senza trattini (es. 4338663546)
//   GOOGLE_ADS_CUSTOMER_ID       — cliente da interrogare senza trattini (es. 5536122825)
//
// Docs: https://developers.google.com/google-ads/api/rest/overview

const API_VERSION = 'v18';
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Scambia il refresh_token con un access_token fresco (short-lived ~1h).
 */
async function getAccessToken() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth env vars mancanti (CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN)');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`OAuth refresh failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

/**
 * Esegue una query GAQL con il metodo search (non-streaming, più semplice).
 * Supporta paginazione tramite nextPageToken.
 */
async function gaqlSearch(query) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCid = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!devToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN mancante');
  if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID mancante');

  const accessToken = await getAccessToken();
  const url = `${BASE}/customers/${customerId}/googleAds:search`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': devToken,
    'Content-Type': 'application/json',
  };
  if (loginCid) headers['login-customer-id'] = loginCid;

  const results = [];
  let pageToken;
  do {
    const body = { query, pageSize: 1000 };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`Google Ads API non-JSON: ${text.slice(0, 500)}`); }
    if (!res.ok) {
      throw new Error(`Google Ads API ${res.status}: ${JSON.stringify(json).slice(0, 800)}`);
    }
    if (Array.isArray(json.results)) results.push(...json.results);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return results;
}

/**
 * Scarica insights a livello campagna × giorno, ritorna righe normalizzate
 * pronte per metrics_ads_daily (stessa shape del metaAdsService).
 */
async function fetchCampaignInsights({ dateFrom, dateTo }) {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND campaign.status != 'REMOVED'
    ORDER BY segments.date DESC
  `;
  const rows = await gaqlSearch(query);

  return rows.map((r) => {
    const date = r.segments && r.segments.date;
    const c = r.campaign || {};
    const m = r.metrics || {};
    const costMicros = Number(m.costMicros || 0);
    return {
      date,
      platform: 'google',
      account_id: process.env.GOOGLE_ADS_CUSTOMER_ID || '',
      campaign_id: String(c.id || ''),
      campaign_name: c.name || '',
      spend: costMicros / 1_000_000,
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      conversions: Number(m.conversions || 0),
      revenue: Number(m.conversionsValue || 0),
      currency: 'EUR',
    };
  });
}

/**
 * Scarica gli ultimi N giorni di insights Google Ads.
 */
async function fetchLastDays(days = 90) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return fetchCampaignInsights({
    dateFrom: formatDate(from),
    dateTo: formatDate(to),
  });
}

/**
 * Utility per il setup: lista gli account accessibili dal refresh token.
 */
async function listAccessibleCustomers() {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = await getAccessToken();
  const res = await fetch(`${BASE}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`listAccessibleCustomers ${res.status}: ${JSON.stringify(json)}`);
  return json.resourceNames || [];
}

module.exports = {
  getAccessToken,
  gaqlSearch,
  fetchCampaignInsights,
  fetchLastDays,
  listAccessibleCustomers,
};
