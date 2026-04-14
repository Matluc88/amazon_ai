// Matomo Reporting API client.
// Funziona sia con Matomo standalone sia con Matomo for WordPress.
//
// Env vars richieste:
//   MATOMO_URL          — base URL completo (es. "https://alessandrosiviglia.it/wp-content/plugins/matomo/app")
//   MATOMO_AUTH_TOKEN   — token API generato da WP Admin → Matomo Analytics → Settings → Auth Token
//   MATOMO_SITE_ID      — id numerico del sito in Matomo (di solito 1)
//
// Docs: https://developer.matomo.org/api-reference/reporting-api

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function getConfig() {
  const url = process.env.MATOMO_URL;
  const token = process.env.MATOMO_AUTH_TOKEN;
  const siteId = process.env.MATOMO_SITE_ID || '1';
  if (!url) throw new Error('MATOMO_URL mancante');
  if (!token) throw new Error('MATOMO_AUTH_TOKEN mancante');
  return { url: url.replace(/\/+$/, ''), token, siteId };
}

/**
 * Chiamata generica all'API Matomo.
 * Restituisce sempre JSON parsed.
 */
async function call(method, params = {}) {
  const { url, token, siteId } = getConfig();
  const qs = new URLSearchParams({
    module: 'API',
    method,
    idSite: siteId,
    format: 'JSON',
    token_auth: token,
    ...params,
  });
  const res = await fetch(`${url}/index.php?${qs.toString()}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Matomo API non-JSON: ${text.slice(0, 500)}`); }
  if (json && json.result === 'error') {
    throw new Error(`Matomo API error: ${json.message}`);
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
  const [summary, goals] = await Promise.all([
    call('VisitsSummary.get', { period: 'day', date: dateRange }),
    call('Goals.get', { period: 'day', date: dateRange }),
  ]);

  const dates = new Set([
    ...Object.keys(summary || {}),
    ...Object.keys(goals || {}),
  ]);

  const { siteId } = getConfig();
  const rows = [];
  for (const date of dates) {
    const s = summary[date] || {};
    const g = goals[date] || {};
    // Matomo restituisce array vuoti per giorni senza dati
    const isEmpty = Array.isArray(s) && s.length === 0;
    if (isEmpty) continue;

    rows.push({
      date,
      site_id: String(siteId),
      source: '(all)',
      sessions: Number(s.nb_visits || 0),
      users: Number(s.nb_uniq_visitors || 0),
      page_views: Number(s.nb_actions || 0),
      conversions: Number((g && g.nb_conversions) || 0),
      ecommerce_revenue: Number((g && g.revenue) || 0),
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
