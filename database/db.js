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
