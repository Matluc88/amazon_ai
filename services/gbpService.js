// Google Business Profile — Performance API v1
// Legge le metriche di visibilità del punto vendita fisico su Google Maps/Search.
//
// IMPORTANTE: richiede OAuth utente (non service account). Il flusso è:
//   1. Enable Business Profile Performance API in GCP
//   2. Run scripts/gbp-setup.js — fa OAuth, lista account/location, salva in .env
//   3. Da quel momento il sync usa il refresh token salvato
//
// Env vars richieste:
//   GBP_CLIENT_ID           — OAuth 2.0 Client ID (stesso GCP project di Google Ads va bene)
//   GBP_CLIENT_SECRET       — OAuth 2.0 Client Secret
//   GBP_REFRESH_TOKEN       — refresh token generato dal wizard
//   GBP_LOCATION_ID         — es. "locations/1234567890"
//
// Docs: https://developers.google.com/my-business/reference/performance/rest

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://businessprofileperformance.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

// Metriche che richiederemo all'API
const DAILY_METRICS = [
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
];

function formatDate(d) {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

/**
 * Scambia il refresh_token con un access_token fresco (~1h).
 */
async function getAccessToken() {
  const clientId = process.env.GBP_CLIENT_ID;
  const clientSecret = process.env.GBP_CLIENT_SECRET;
  const refreshToken = process.env.GBP_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GBP env vars mancanti (CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN)');
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
    throw new Error(`GBP OAuth refresh failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

/**
 * Chiama Performance API per ottenere la time series giornaliera delle metriche.
 * Range di date in cui l'API restituisce dati: tipicamente fino a 18 mesi indietro,
 * con latenza di 2-3 giorni sui dati più recenti.
 */
async function fetchDailyMetrics({ dateFrom, dateTo }) {
  const locationId = process.env.GBP_LOCATION_ID;
  if (!locationId) throw new Error('GBP_LOCATION_ID mancante');

  const token = await getAccessToken();

  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const fromParts = formatDate(from);
  const toParts = formatDate(to);

  // Costruisci URL con parametri query
  const params = new URLSearchParams();
  for (const m of DAILY_METRICS) {
    params.append('dailyMetrics', m);
  }
  params.set('dailyRange.startDate.year', String(fromParts.year));
  params.set('dailyRange.startDate.month', String(fromParts.month));
  params.set('dailyRange.startDate.day', String(fromParts.day));
  params.set('dailyRange.endDate.year', String(toParts.year));
  params.set('dailyRange.endDate.month', String(toParts.month));
  params.set('dailyRange.endDate.day', String(toParts.day));

  const url = `${API_BASE}/${locationId}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GBP Performance API ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  // Parsing: response has nested structure with one array per metric
  // Normalizziamo in un dict: { 'YYYY-MM-DD': { metric_name: value, ... } }
  const byDate = {};

  const seriesArr = json.multiDailyMetricTimeSeries || [];
  for (const container of seriesArr) {
    const innerArr = container.dailyMetricTimeSeries || [];
    for (const metricSeries of innerArr) {
      const metricName = metricSeries.dailyMetric;
      const datedValues = (metricSeries.timeSeries && metricSeries.timeSeries.datedValues) || [];
      for (const dv of datedValues) {
        const d = dv.date || {};
        const dateStr = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        byDate[dateStr] = byDate[dateStr] || {};
        byDate[dateStr][metricName] = Number(dv.value || 0);
      }
    }
  }

  // Trasforma in array di righe pronte per l'UPSERT
  const rows = [];
  for (const [date, metrics] of Object.entries(byDate)) {
    rows.push({
      date,
      location_id: locationId,
      call_clicks: metrics.CALL_CLICKS || 0,
      website_clicks: metrics.WEBSITE_CLICKS || 0,
      direction_requests: metrics.BUSINESS_DIRECTION_REQUESTS || 0,
      conversations: metrics.BUSINESS_CONVERSATIONS || 0,
      impressions_desktop_maps: metrics.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0,
      impressions_desktop_search: metrics.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0,
      impressions_mobile_maps: metrics.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0,
      impressions_mobile_search: metrics.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0,
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Wrapper "ultimi N giorni" con buffer di 3 giorni per la latenza API.
 * GBP Performance API ha tipicamente 2-3 giorni di latenza sui dati freschi.
 */
async function fetchLastDays(days = 30) {
  const to = new Date();
  to.setDate(to.getDate() - 3); // buffer latenza
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return fetchDailyMetrics({
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  });
}

/**
 * Utility per il wizard: lista gli account a cui l'utente autenticato ha accesso.
 */
async function listAccounts() {
  const token = await getAccessToken();
  const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`listAccounts: ${JSON.stringify(json)}`);
  return json.accounts || [];
}

/**
 * Utility per il wizard: lista le location (punti vendita) di un account.
 */
async function listLocations(accountName) {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    readMask: 'name,title,storefrontAddress,websiteUri',
    pageSize: '100',
  });
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`listLocations: ${JSON.stringify(json)}`);
  return json.locations || [];
}

module.exports = {
  getAccessToken,
  fetchDailyMetrics,
  fetchLastDays,
  listAccounts,
  listLocations,
};
