// Meta (Facebook) Marketing API — fetch giornaliero insights a livello di campagna
//
// Env vars richieste:
//   META_ACCESS_TOKEN   — long-lived access token (user o system user)
//   META_AD_ACCOUNT_ID  — formato "act_XXXXXXXXX"
//
// Docs: https://developers.facebook.com/docs/marketing-api/insights

const API_VERSION = 'v21.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Scarica insights per campagna tra dateFrom e dateTo (YYYY-MM-DD).
 * Ritorna array di righe normalizzate pronte per metrics_ads_daily.
 */
async function fetchCampaignInsights({ accessToken, adAccountId, dateFrom, dateTo }) {
  if (!accessToken) throw new Error('META_ACCESS_TOKEN mancante');
  if (!adAccountId) throw new Error('META_AD_ACCOUNT_ID mancante');

  const fields = [
    'date_start',
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'actions',
    'action_values',
    'account_currency',
  ].join(',');

  const params = new URLSearchParams({
    access_token: accessToken,
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    fields,
    limit: '500',
  });

  const url = `${BASE_URL}/${adAccountId}/insights?${params.toString()}`;
  const rows = [];
  let next = url;

  while (next) {
    const res = await fetch(next);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta API ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = await res.json();
    for (const r of json.data || []) {
      const conversions = sumActions(r.actions, ['purchase', 'offsite_conversion.fb_pixel_purchase']);
      const revenue = sumActions(r.action_values, ['purchase', 'offsite_conversion.fb_pixel_purchase']);
      rows.push({
        date: r.date_start,
        platform: 'meta',
        account_id: adAccountId,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        conversions,
        revenue,
        currency: r.account_currency || 'EUR',
      });
    }
    next = json.paging && json.paging.next ? json.paging.next : null;
  }

  return rows;
}

function sumActions(actions, types) {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    if (types.includes(a.action_type)) total += Number(a.value || 0);
  }
  return total;
}

/**
 * Scarica gli ultimi N giorni di insights Meta.
 */
async function fetchLastDays(days = 90) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return fetchCampaignInsights({
    accessToken: process.env.META_ACCESS_TOKEN,
    adAccountId: process.env.META_AD_ACCOUNT_ID,
    dateFrom: formatDate(from),
    dateTo: formatDate(to),
  });
}

module.exports = { fetchCampaignInsights, fetchLastDays };
