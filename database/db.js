const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Errore pool PostgreSQL:', err.message);
});

/**
 * Esegui una query con parametri opzionali
 */
async function query(sql, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Inizializza il database creando tutte le tabelle
 */
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tabella utenti
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        nome VARCHAR(255),
        ruolo VARCHAR(50) NOT NULL DEFAULT 'operatore',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tabella sessioni
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" VARCHAR NOT NULL COLLATE "default",
        "sess" JSON NOT NULL,
        "expire" TIMESTAMP(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
    `);

    // Tabella prodotti
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        titolo_opera VARCHAR(500),
        autore VARCHAR(255),
        dimensioni VARCHAR(100),
        tecnica VARCHAR(255),
        descrizione_raw TEXT,
        prezzo DECIMAL(10,2),
        quantita INTEGER DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Colonne varianti prodotto (catalogo Sivigliart)
    const variantCols = [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS sku_padre VARCHAR(100)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS misura_max VARCHAR(50)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS prezzo_max DECIMAL(10,2)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS sku_max VARCHAR(100)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS misura_media VARCHAR(50)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS prezzo_media DECIMAL(10,2)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS sku_media VARCHAR(100)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS misura_mini VARCHAR(50)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS prezzo_mini DECIMAL(10,2)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS sku_mini VARCHAR(100)`,
    ];
    for (const col of variantCols) {
      await client.query(col);
    }
    // Indice univoco su sku_max (usato per UPSERT catalogo)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_max
      ON products (sku_max) WHERE sku_max IS NOT NULL AND sku_max != ''
    `);

    // Colonne ASIN Amazon (parent + 3 child)
    const asinCols = [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS asin_padre VARCHAR(20)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS asin_max VARCHAR(20)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS asin_media VARCHAR(20)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS asin_mini VARCHAR(20)`,
    ];
    for (const col of asinCols) {
      await client.query(col);
    }

    // Colonne EAN e immagini varianti
    const eanImageCols = [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ean_max VARCHAR(30)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ean_media VARCHAR(30)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ean_mini VARCHAR(30)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_max TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_media TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_mini TEXT`,
      // Immagini variante: _2=frontale lifestyle, _3=proporzione scala, _4=di lato (laterale)
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_max_2 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_max_3 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_max_4 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_media_2 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_media_3 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_media_4 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_mini_2 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_mini_3 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_mini_4 TEXT`,
    ];
    for (const col of eanImageCols) {
      await client.query(col);
    }

    // Tabella definizioni attributi Amazon
    await client.query(`
      CREATE TABLE IF NOT EXISTS attribute_definitions (
        id SERIAL PRIMARY KEY,
        nome_attributo VARCHAR(500) NOT NULL,
        sezione VARCHAR(100) NOT NULL,
        priorita VARCHAR(100) NOT NULL,
        source VARCHAR(50) NOT NULL DEFAULT 'SKIP',
        ordine INTEGER DEFAULT 0,
        UNIQUE(nome_attributo)
      )
    `);

    // Tabella valori fissi per attributi FIXED
    await client.query(`
      CREATE TABLE IF NOT EXISTS attribute_fixed_values (
        id SERIAL PRIMARY KEY,
        attribute_id INTEGER REFERENCES attribute_definitions(id) ON DELETE CASCADE,
        value TEXT,
        UNIQUE(attribute_id)
      )
    `);

    // Tabella valori attributi per prodotto
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_attribute_values (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        attribute_id INTEGER REFERENCES attribute_definitions(id) ON DELETE CASCADE,
        value TEXT,
        compiled_by VARCHAR(50),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(product_id, attribute_id)
      )
    `);

    // Tabella cache keyword Amazon
    await client.query(`
      CREATE TABLE IF NOT EXISTS amazon_suggest_cache (
        id SERIAL PRIMARY KEY,
        seed VARCHAR(500) NOT NULL,
        results_json TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(seed)
      )
    `);

    // Tabella offerte internazionali (EU)
    await client.query(`
      CREATE TABLE IF NOT EXISTS international_offers (
        id SERIAL PRIMARY KEY,
        country VARCHAR(2) NOT NULL,
        item_name TEXT,
        listing_id VARCHAR(100),
        seller_sku VARCHAR(200),
        price DECIMAL(10,2),
        quantity INTEGER DEFAULT 0,
        open_date TIMESTAMP,
        product_id_type VARCHAR(20),
        item_note TEXT,
        item_condition VARCHAR(20),
        will_ship_internationally VARCHAR(5),
        expedited_shipping VARCHAR(5),
        product_id VARCHAR(20),
        pending_quantity INTEGER DEFAULT 0,
        fulfillment_channel VARCHAR(50),
        merchant_shipping_group VARCHAR(200),
        status VARCHAR(20),
        minimum_order_quantity INTEGER,
        sell_remainder VARCHAR(10),
        uploaded_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_international_offers_country
      ON international_offers (country)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_international_offers_status
      ON international_offers (status)
    `);
    // Colonne parent/child detection
    await client.query(`ALTER TABLE international_offers ADD COLUMN IF NOT EXISTS is_parent BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE international_offers ADD COLUMN IF NOT EXISTS parent_sku VARCHAR(200)`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_international_offers_parent_sku
      ON international_offers (parent_sku)
    `);

    // Tabella cluster Cerebro (nicchie di ricerca competitiva)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cerebro_clusters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tabella keyword Cerebro (importate da Helium 10 Cerebro multi-ASIN)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cerebro_keywords (
        id SERIAL PRIMARY KEY,
        cluster_id INTEGER REFERENCES cerebro_clusters(id) ON DELETE CASCADE,
        keyword TEXT NOT NULL,
        search_volume INTEGER,
        cerebro_iq INTEGER,
        volume_trend INTEGER,
        competing_products TEXT,
        cpr INTEGER,
        title_density INTEGER,
        status VARCHAR(20) DEFAULT 'pending',
        tier VARCHAR(20) DEFAULT NULL,
        imported_at TIMESTAMP DEFAULT NOW(),
        source_file TEXT,
        UNIQUE(cluster_id, keyword)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cerebro_keywords_cluster
      ON cerebro_keywords (cluster_id, status)
    `);

    // Colonna cluster Cerebro sui prodotti
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS cerebro_cluster_id INTEGER REFERENCES cerebro_clusters(id) ON DELETE SET NULL
    `);

    // Tabella valori attributi FR (Amazon.fr) — contenuto in francese generato da AI
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_attribute_values_fr (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        nome_attributo VARCHAR(255) NOT NULL,
        value TEXT,
        compiled_by VARCHAR(50) DEFAULT 'AI',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(product_id, nome_attributo)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pav_fr_product
      ON product_attribute_values_fr (product_id)
    `);

    // Tabella valori attributi DE (Amazon.de) — contenuto in tedesco generato da AI
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_attribute_values_de (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        nome_attributo VARCHAR(255) NOT NULL,
        value TEXT,
        compiled_by VARCHAR(50) DEFAULT 'AI',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(product_id, nome_attributo)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pav_de_product
      ON product_attribute_values_de (product_id)
    `);

    // Tabella chat interna
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_nome VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
      ON chat_messages (created_at ASC)
    `);

    // Tabella metriche ads (Meta + Google Ads + eventuali altre ad-platform)
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_ads_daily (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        platform VARCHAR(20) NOT NULL,
        account_id VARCHAR(100),
        campaign_id VARCHAR(100) NOT NULL,
        campaign_name VARCHAR(500),
        spend DECIMAL(12,2) DEFAULT 0,
        impressions BIGINT DEFAULT 0,
        clicks BIGINT DEFAULT 0,
        conversions DECIMAL(12,2) DEFAULT 0,
        revenue DECIMAL(12,2) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'EUR',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(date, platform, campaign_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_ads_date
      ON metrics_ads_daily (date DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_ads_platform_date
      ON metrics_ads_daily (platform, date DESC)
    `);

    // Tabella metriche Google Analytics 4
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_ga4_daily (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        property_id VARCHAR(50) NOT NULL,
        source VARCHAR(200) DEFAULT '(all)',
        sessions BIGINT DEFAULT 0,
        users BIGINT DEFAULT 0,
        page_views BIGINT DEFAULT 0,
        conversions DECIMAL(12,2) DEFAULT 0,
        ecommerce_revenue DECIMAL(12,2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(date, property_id, source)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_ga4_date
      ON metrics_ga4_daily (date DESC)
    `);

    // Tabella metriche Matomo (web analytics self-hosted alternativa a GA4)
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_matomo_daily (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        site_id VARCHAR(20) NOT NULL,
        source VARCHAR(200) DEFAULT '(all)',
        sessions BIGINT DEFAULT 0,
        users BIGINT DEFAULT 0,
        page_views BIGINT DEFAULT 0,
        conversions DECIMAL(12,2) DEFAULT 0,
        ecommerce_revenue DECIMAL(12,2) DEFAULT 0,
        bounce_rate DECIMAL(5,2) DEFAULT 0,
        avg_time_on_site INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(date, site_id, source)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_matomo_date
      ON metrics_matomo_daily (date DESC)
    `);

    // Tabella ordini WooCommerce giornalieri (aggregato per data)
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_wc_orders_daily (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        shop_domain VARCHAR(255) NOT NULL,
        orders_count INTEGER DEFAULT 0,
        gross_revenue DECIMAL(12,2) DEFAULT 0,
        discount_total DECIMAL(12,2) DEFAULT 0,
        shipping_total DECIMAL(12,2) DEFAULT 0,
        tax_total DECIMAL(12,2) DEFAULT 0,
        refund_total DECIMAL(12,2) DEFAULT 0,
        items_sold INTEGER DEFAULT 0,
        avg_order_value DECIMAL(12,2) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'EUR',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(date, shop_domain)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_wc_orders_daily_date
      ON metrics_wc_orders_daily (date DESC)
    `);

    // Tabella top prodotti WooCommerce (rolling window ultimi 90 gg, riscritta ad ogni sync)
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_wc_products_recent (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) NOT NULL,
        product_id VARCHAR(50) NOT NULL,
        product_name TEXT,
        sku VARCHAR(100),
        quantity_sold INTEGER DEFAULT 0,
        revenue DECIMAL(12,2) DEFAULT 0,
        orders_count INTEGER DEFAULT 0,
        period_days INTEGER DEFAULT 90,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_wc_products_shop
      ON metrics_wc_products_recent (shop_domain)
    `);

    // Tabella snapshot catalogo Google Merchant Center (uno snapshot al giorno)
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_merchant_snapshot (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        merchant_id VARCHAR(50) NOT NULL,
        total_products INTEGER DEFAULT 0,
        approved INTEGER DEFAULT 0,
        limited INTEGER DEFAULT 0,
        disapproved INTEGER DEFAULT 0,
        pending INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(date, merchant_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_merchant_snapshot_date
      ON metrics_merchant_snapshot (date DESC)
    `);

    // Tabella problemi correnti sul catalogo Merchant (riscritta ad ogni sync, stato attuale)
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_merchant_issues (
        id SERIAL PRIMARY KEY,
        merchant_id VARCHAR(50) NOT NULL,
        product_id VARCHAR(200) NOT NULL,
        title TEXT,
        link TEXT,
        image_link TEXT,
        status VARCHAR(30) NOT NULL,
        country VARCHAR(10),
        issue_code VARCHAR(100),
        issue_severity VARCHAR(30),
        issue_description TEXT,
        issue_detail TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_merchant_issues_status
      ON metrics_merchant_issues (merchant_id, status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_merchant_issues_code
      ON metrics_merchant_issues (issue_code)
    `);

    // Tabella log sincronizzazioni metriche
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics_sync_log (
        id SERIAL PRIMARY KEY,
        platform VARCHAR(20) NOT NULL,
        started_at TIMESTAMP DEFAULT NOW(),
        finished_at TIMESTAMP,
        date_from DATE,
        date_to DATE,
        rows_synced INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'running',
        error_message TEXT
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_sync_log_started
      ON metrics_sync_log (platform, started_at DESC)
    `);

    await client.query('COMMIT');
    console.log('✅ Database inizializzato correttamente');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Errore inizializzazione database:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, initDatabase };
