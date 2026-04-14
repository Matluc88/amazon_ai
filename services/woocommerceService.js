// WooCommerce REST API v3 — legge ordini e calcola aggregati giornalieri.
//
// Env vars richieste:
//   WOOCOMMERCE_URL              — base URL del sito (es. "https://alessandrosiviglia.it")
//   WOOCOMMERCE_CONSUMER_KEY     — chiave consumer (ck_...)
//   WOOCOMMERCE_CONSUMER_SECRET  — secret consumer (cs_...)
//
// Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/

function getConfig() {
  const url = process.env.WOOCOMMERCE_URL;
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!url || !key || !secret) {
    throw new Error('WOOCOMMERCE_URL / CONSUMER_KEY / CONSUMER_SECRET mancanti');
  }
  const base = url.replace(/\/+$/, '') + '/wp-json/wc/v3';
  const authHeader = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
  const shopDomain = new URL(url).hostname;
  return { base, authHeader, shopDomain };
}

/**
 * Chiamata paginata a un endpoint WooCommerce.
 * Ritorna TUTTI i record iterando le pagine finché X-WP-TotalPages è > pagina corrente.
 */
async function fetchAll(endpoint, params = {}) {
  const { base, authHeader } = getConfig();
  const all = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const qs = new URLSearchParams({ ...params, per_page: String(perPage), page: String(page) });
    const url = `${base}${endpoint}?${qs.toString()}`;
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WC API ${res.status} ${endpoint}: ${text.slice(0, 500)}`);
    }
    const json = await res.json();
    if (!Array.isArray(json)) break;
    all.push(...json);
    const totalPages = Number(res.headers.get('x-wp-totalpages') || '1');
    if (page >= totalPages || json.length < perPage) break;
    page++;
  }
  return all;
}

function formatDateISO(d) {
  return d.toISOString();
}

/**
 * Scarica TUTTI gli ordini in un range di date e li aggrega per giorno.
 * Ritorna { dailyRows, productRows } pronte per l'UPSERT.
 */
async function fetchOrdersAggregated({ dateFrom, dateTo, days }) {
  const orders = await fetchAll('/orders', {
    after: formatDateISO(new Date(dateFrom)),
    before: formatDateISO(new Date(dateTo)),
    status: 'any',
    orderby: 'date',
    order: 'asc',
  });

  const { shopDomain } = getConfig();
  const byDate = new Map();
  const byProduct = new Map();

  for (const o of orders) {
    // Usiamo la data locale del sito (date_created è già "local time" senza TZ in WC)
    const dateKey = String(o.date_created || '').slice(0, 10);
    if (!dateKey) continue;

    // Solo ordini "finalizzati" contribuiscono al fatturato reale
    const countable = ['processing', 'completed', 'on-hold'].includes(o.status);
    const refunded = o.status === 'refunded';

    let day = byDate.get(dateKey);
    if (!day) {
      day = {
        date: dateKey,
        shop_domain: shopDomain,
        orders_count: 0,
        gross_revenue: 0,
        discount_total: 0,
        shipping_total: 0,
        tax_total: 0,
        refund_total: 0,
        items_sold: 0,
        currency: o.currency || 'EUR',
      };
      byDate.set(dateKey, day);
    }

    if (countable) {
      day.orders_count += 1;
      day.gross_revenue += Number(o.total || 0);
      day.discount_total += Number(o.discount_total || 0);
      day.shipping_total += Number(o.shipping_total || 0);
      day.tax_total += Number(o.total_tax || 0);
      for (const li of (o.line_items || [])) {
        day.items_sold += Number(li.quantity || 0);
      }
    }
    if (refunded) {
      day.refund_total += Number(o.total || 0);
    }

    // Aggrega per prodotto (solo ordini countable)
    if (countable) {
      for (const li of (o.line_items || [])) {
        const pid = String(li.product_id || li.id || '');
        if (!pid) continue;
        let p = byProduct.get(pid);
        if (!p) {
          p = {
            shop_domain: shopDomain,
            product_id: pid,
            product_name: li.name || '',
            sku: li.sku || '',
            quantity_sold: 0,
            revenue: 0,
            orders_count: 0,
            period_days: days,
          };
          byProduct.set(pid, p);
        }
        p.quantity_sold += Number(li.quantity || 0);
        p.revenue += Number(li.total || 0) + Number(li.total_tax || 0);
        p.orders_count += 1;
      }
    }
  }

  // Calcola AOV per ogni giorno
  const dailyRows = Array.from(byDate.values()).map((d) => ({
    ...d,
    avg_order_value: d.orders_count > 0 ? d.gross_revenue / d.orders_count : 0,
  }));

  const productRows = Array.from(byProduct.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 200);

  return { dailyRows, productRows };
}

/**
 * Wrapper "ultimi N giorni" usato dal cron.
 */
async function fetchLastDays(days = 90) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return fetchOrdersAggregated({
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    days,
  });
}

module.exports = {
  fetchAll,
  fetchOrdersAggregated,
  fetchLastDays,
};
