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
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        // Alcuni WAF/plugin (Wordfence, Cloudflare) bloccano UA "node" default
        'User-Agent': 'Mozilla/5.0 (compatible; SivigliartBI/1.0; +https://amazon-ai.onrender.com)',
        Accept: 'application/json',
      },
    });

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok) {
      // Se è HTML, estrai titolo per capire se è WAF/block/login page
      const htmlTitle = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const hint = contentType.includes('html') && htmlTitle ? ` [HTML page: "${htmlTitle[1]}"]` : '';
      throw new Error(`WC API ${res.status} ${endpoint}${hint}: ${text.slice(0, 400)}`);
    }

    if (contentType.includes('html') || text.trim().startsWith('<')) {
      const htmlTitle = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = htmlTitle ? htmlTitle[1] : '(no title)';
      throw new Error(
        `WC API returned HTML instead of JSON — probabilmente il sito blocca l'IP di Render ` +
        `tramite WAF/plugin di sicurezza. HTML title: "${title}". ` +
        `Prime 300 lettere: ${text.slice(0, 300)}`
      );
    }

    let json;
    try { json = JSON.parse(text); }
    catch (e) { throw new Error(`WC API response non-JSON: ${text.slice(0, 400)}`); }

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
 * Recupera i dettagli prodotto (inclusi categories) per un set di product_id
 * in batch da 100 tramite il parametro ?include=id1,id2,...
 */
async function fetchProductsByIds(ids) {
  if (!ids.length) return new Map();
  const { base, authHeader } = getConfig();
  const map = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await fetch(`${base}/products?include=${batch.join(',')}&per_page=100`, {
      headers: {
        Authorization: authHeader,
        'User-Agent': 'Mozilla/5.0 (compatible; SivigliartBI/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) continue;
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { continue; }
    if (!Array.isArray(json)) continue;
    for (const p of json) {
      map.set(Number(p.id), {
        name: p.name || '',
        categories: (p.categories || []).map((c) => c.name),
      });
    }
  }
  return map;
}

/**
 * Normalizza una città per raggruppare varianti di maiuscole/spazi.
 * Es. "Nocera superiore" e "NOCERA SUPERIORE" → "nocera superiore".
 */
function normalizeCity(raw) {
  return (raw || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Scarica TUTTI gli ordini in un range di date e li aggrega per:
 *   - giorno (dailyRows)
 *   - prodotto top (productRows)
 *   - città d'acquisto (cityRows, dai billing address)
 *   - clienti per email (customerRows, aggrega guest + registrati)
 *   - categoria prodotto (categoryRows, richiede fetch /products)
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
  const byCity = new Map();
  const byEmail = new Map();

  const orderRows = [];

  for (const o of orders) {
    const dateKey = String(o.date_created || '').slice(0, 10);
    if (!dateKey) continue;

    const countable = ['processing', 'completed', 'on-hold'].includes(o.status);
    const refunded = o.status === 'refunded';

    // ─── Riga per ordine singolo (tutti gli status — utile per drill-down) ───
    {
      const lineItems = o.line_items || [];
      const itemsCount = lineItems.reduce((s, li) => s + Number(li.quantity || 0), 0);
      const itemsSummary = lineItems
        .map((li) => `${li.quantity || 1}× ${li.name || ''}`.trim())
        .filter(Boolean)
        .join(' | ')
        .slice(0, 2000);
      const meta = Array.isArray(o.meta_data) ? o.meta_data : [];
      const metaGet = (key) => {
        const m = meta.find((x) => x && x.key === key);
        return m ? String(m.value || '') : '';
      };
      // Order Attribution plugin (WooCommerce core dal 2024) o HPOS fields
      const sourceChannel =
        metaGet('_wc_order_attribution_source_type') ||
        metaGet('_wc_order_attribution_utm_source') ||
        metaGet('_wc_order_source') ||
        '';
      const sourceReferrer =
        metaGet('_wc_order_attribution_referrer') ||
        metaGet('_wc_order_attribution_session_entry') ||
        '';
      orderRows.push({
        shop_domain: shopDomain,
        order_id: String(o.id || ''),
        order_number: String(o.number || o.id || ''),
        date_created: o.date_created || null,
        status: o.status || '',
        customer_email: (o.billing?.email || '').toLowerCase().trim(),
        customer_name: `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim(),
        billing_city: (o.billing?.city || '').trim(),
        billing_country: (o.billing?.country || '').toUpperCase(),
        total: Number(o.total || 0),
        discount_total: Number(o.discount_total || 0),
        shipping_total: Number(o.shipping_total || 0),
        tax_total: Number(o.total_tax || 0),
        currency: o.currency || 'EUR',
        items_count: itemsCount,
        items_summary: itemsSummary,
        payment_method: (o.payment_method_title || o.payment_method || '').slice(0, 100),
        source_channel: sourceChannel.slice(0, 100),
        source_referrer: sourceReferrer.slice(0, 500),
      });
    }

    // ─── Aggregato giornaliero ───
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

    if (!countable) continue;

    // ─── Aggregato per prodotto ───
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

    // ─── Aggregato per città (billing) ───
    const cityDisplay = (o.billing?.city || '').trim();
    const cityKey = normalizeCity(cityDisplay) || '(unknown)';
    const country = (o.billing?.country || '').toUpperCase();
    const cityMapKey = `${cityKey}|${country}`;
    let c = byCity.get(cityMapKey);
    if (!c) {
      c = {
        shop_domain: shopDomain,
        city_key: cityKey,
        city_display: cityDisplay || '(unknown)',
        country,
        orders_count: 0,
        revenue: 0,
        items_sold: 0,
        period_days: days,
      };
      byCity.set(cityMapKey, c);
    }
    c.orders_count += 1;
    c.revenue += Number(o.total || 0);
    for (const li of (o.line_items || [])) {
      c.items_sold += Number(li.quantity || 0);
    }

    // ─── Aggregato per cliente (email, anche guest) ───
    const email = (o.billing?.email || '').toLowerCase().trim();
    if (email) {
      let cust = byEmail.get(email);
      if (!cust) {
        cust = {
          shop_domain: shopDomain,
          email,
          full_name: `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim(),
          city: cityDisplay,
          country,
          orders_count: 0,
          total_spent: 0,
          first_order_at: o.date_created,
          last_order_at: o.date_created,
          period_days: days,
        };
        byEmail.set(email, cust);
      }
      cust.orders_count += 1;
      cust.total_spent += Number(o.total || 0);
      if (o.date_created < cust.first_order_at) cust.first_order_at = o.date_created;
      if (o.date_created > cust.last_order_at) cust.last_order_at = o.date_created;
    }
  }

  // ─── Aggregato per categoria (richiede fetch /products) ───
  const productIds = Array.from(byProduct.values()).map((p) => Number(p.product_id));
  const productInfo = await fetchProductsByIds(productIds);

  const byCategory = new Map();
  for (const o of orders) {
    if (!['processing', 'completed', 'on-hold'].includes(o.status)) continue;
    for (const li of (o.line_items || [])) {
      const info = productInfo.get(Number(li.product_id));
      const cats = info && info.categories && info.categories.length
        ? info.categories
        : ['(senza categoria)'];
      const liRevenue = Number(li.total || 0) + Number(li.total_tax || 0);
      const liQty = Number(li.quantity || 0);
      for (const cat of cats) {
        let e = byCategory.get(cat);
        if (!e) {
          e = {
            shop_domain: shopDomain,
            category: cat,
            revenue: 0,
            items_sold: 0,
            occurrences: 0,
            period_days: days,
          };
          byCategory.set(cat, e);
        }
        e.revenue += liRevenue;
        e.items_sold += liQty;
        e.occurrences += 1;
      }
    }
  }

  const dailyRows = Array.from(byDate.values()).map((d) => ({
    ...d,
    avg_order_value: d.orders_count > 0 ? d.gross_revenue / d.orders_count : 0,
  }));

  const productRows = Array.from(byProduct.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 200);

  const cityRows = Array.from(byCity.values())
    .sort((a, b) => b.revenue - a.revenue);

  const customerRows = Array.from(byEmail.values())
    .sort((a, b) => b.total_spent - a.total_spent);

  const categoryRows = Array.from(byCategory.values())
    .sort((a, b) => b.revenue - a.revenue);

  return { dailyRows, productRows, cityRows, customerRows, categoryRows, orderRows };
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
