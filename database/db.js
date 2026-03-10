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

    // Colonne EAN e immagini varianti
    const eanImageCols = [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ean_max VARCHAR(30)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ean_media VARCHAR(30)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ean_mini VARCHAR(30)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_max TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_media TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_mini TEXT`,
      // Immagine laterale (img 2) e proporzione (img 3) per variante
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_max_2 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_max_3 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_media_2 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_media_3 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_mini_2 TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS immagine_mini_3 TEXT`,
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
