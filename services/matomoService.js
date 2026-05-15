// Matomo Reporting API client (Matomo for WordPress, via WP REST API + Application Password).
//
// Env vars richieste:
//   MATOMO_WP_REST_URL    — base URL del namespace REST (es. "https://alessandrosiviglia.it/wp-json/matomo/v1")
//   MATOMO_WP_USER        — username WordPress (es. "matomo-sync")
//   MATOMO_WP_APP_PASSWORD — Application Password generata in WP (gli spazi sono tollerati)
//   MATOMO_SITE_ID        — id numerico del sito in Matomo (di solito 1)
//
// Endpoint utilizzati:
//   GET /matomo/v1/visits_summary/get?idSite=1&period=...&date=...
//   GET /matomo/v1/visits_summary/visits?idSite=1&period=...&date=...
//   (altri endpoint disponibili: vedi /wp-json/matomo/v1)
//
// Docs WP REST plugin: il plugin Matomo for WordPress espone i metodi API come route REST,
// dove "Module.method" diventa "/module/method" in lowercase.

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function getConfig() {
  const url = process.env.MATOMO_WP_REST_URL || (process.env.MATOMO_URL && process.env.MATOMO_URL.replace('/wp-content/plugins/matomo/app', '/wp-json/matomo/v1'));
  const user = process.env.MATOMO_WP_USER;
  const pass = process.env.MATOMO_WP_APP_PASSWORD;
  const siteId = process.env.MATOMO_SITE_ID || '1';
  if (!url) throw new Error('MATOMO_WP_REST_URL mancante');
  if (!user || !pass) throw new Error('MATOMO_WP_USER / MATOMO_WP_APP_PASSWORD mancanti');
  return { url: url.replace(/\/+$/, ''), user, pass, siteId };
}

function authHeader(user, pass) {
  // Application Passwords accettano la versione con spazi, ma Basic Auth richiede una stringa pulita
  const cleanPass = String(pass).replace(/\s+/g, '');
  const b64 = Buffer.from(`${user}:${cleanPass}`).toString('base64');
  return `Basic ${b64}`;
}

/**
 * Chiamata generica all'API Matomo via WP REST endpoint.
 * `method` formato Matomo: "VisitsSummary.get", "Referrers.getAll", ecc.
 * Mappa automaticamente in URL: VisitsSummary.get → /visits_summary/get
 */
function methodToRoute(method) {
  // "VisitsSummary.get" → "visits_summary/get"
  const [moduleName, action] = method.split('.');
  const mod = moduleName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  return `${mod}/${action}`;
}

// Route REST native disponibili nel plugin Matomo for WP (subset utile).
// Per metodi non in questa lista, usiamo /api/processed_report come fallback generico.
const NATIVE_ROUTES = new Set([
  'visits_summary/get',
  'visits_summary/visits',
  'visits_summary/unique_visitors',
  'live/counters',
  'live/last_visits_details',
]);

async function call(method, params = {}) {
  const { url, user, pass, siteId } = getConfig();
  const route = methodToRoute(method);
  const useNative = NATIVE_ROUTES.has(route);

  let fullUrl;
  if (useNative) {
    const qs = new URLSearchParams({ idSite: siteId, format: 'JSON', ...params });
    fullUrl = `${url}/${route}?${qs.toString()}`;
  } else {
    // Generic fallback via processed_report
    const qs = new URLSearchParams({
      idSite: siteId,
      format: 'JSON',
      apiModule: method.split('.')[0],
      apiAction: method.split('.')[1],
      ...params,
    });
    fullUrl = `${url}/api/processed_report?${qs.toString()}`;
  }

  const res = await fetch(fullUrl, {
    headers: {
      Authorization: authHeader(user, pass),
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Matomo API non-JSON (${res.status}): ${text.slice(0, 500)}`); }
  // Alcuni endpoint REST del plugin Matomo for WP ritornano il payload come stringa JSON
  // (doppio-encoded). Rilevalo e fai un secondo parse.
  if (typeof json === 'string') {
    try { json = JSON.parse(json); } catch { /* lascia stringa */ }
  }
  if (json && json.result === 'error') {
    throw new Error(`Matomo API error: ${json.message}`);
  }
  if (json && typeof json === 'object' && !Array.isArray(json) && json.code && typeof json.code === 'string' && json.message && json.data) {
    throw new Error(`WP REST error (${json.code}): ${json.message}`);
  }
  return json;
}

/**
 * Scarica metriche giornaliere aggregate (totale sito, no sorgente).
 *
 * VisitsSummary.get → ritorna oggetto chiave=YYYY-MM-DD, valore={nb_visits, nb_uniq_visitors, ...}
 * Goals.get          → ritorna oggetto chiave=YYYY-MM-DD, valore={nb_conversions, revenue, ...}
 *
 * Le merge insieme.
 */
async function fetchDailyTotals({ dateFrom, dateTo }) {
  const dateRange = `${dateFrom},${dateTo}`;
  const summary = await call('VisitsSummary.get', { period: 'day', date: dateRange });
  // Goals.get non è disponibile via REST native su WP Matomo plugin: i goal non sono
  // configurati su questo sito (nb_visits_converted già esposto in VisitsSummary).

  const { siteId } = getConfig();
  const rows = [];
  for (const date of Object.keys(summary || {})) {
    const s = summary[date] || {};
    const isEmpty = Array.isArray(s) && s.length === 0;
    if (isEmpty) continue;

    rows.push({
      date,
      site_id: String(siteId),
      source: '(all)',
      sessions: Number(s.nb_visits || 0),
      users: Number(s.nb_uniq_visitors || 0),
      page_views: Number(s.nb_actions || 0),
      conversions: Number(s.nb_visits_converted || 0),
      ecommerce_revenue: 0,
      bounce_rate: Number((s.bounce_rate || '0').toString().replace('%', '')) || 0,
      avg_time_on_site: Number(s.avg_time_on_site || 0),
    });
  }
  return rows;
}

/**
 * Top sorgenti di traffico per il periodo (aggregato range, no per giorno).
 */
async function fetchSources({ dateFrom, dateTo, limit = 50 }) {
  const dateRange = `${dateFrom},${dateTo}`;
  const data = await call('Referrers.getAll', {
    period: 'range',
    date: dateRange,
    filter_limit: limit,
  });
  if (!Array.isArray(data)) return [];

  const { siteId } = getConfig();
  return data.map((row) => ({
    source: row.label || '(direct)',
    sessions: Number(row.nb_visits || 0),
    users: Number(row.nb_uniq_visitors || 0),
    page_views: Number(row.nb_actions || 0),
    conversions: Number(row.goals && row.goals[0] && row.goals[0].nb_conversions || 0),
    ecommerce_revenue: 0,
    site_id: String(siteId),
  }));
}

/**
 * Wrapper "ultimi N giorni" per il cron — solo i totali giornalieri.
 */
async function fetchLastDays(days = 90) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return fetchDailyTotals({
    dateFrom: formatDate(from),
    dateTo: formatDate(to),
  });
}

module.exports = {
  call,
  fetchDailyTotals,
  fetchSources,
  fetchLastDays,
};
