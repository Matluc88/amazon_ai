const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// In produzione (Render) usa DATABASE_PATH=/data/amazon_ai.db
// In locale usa il percorso di default nella cartella database/
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'amazon_ai.db');

// Assicura che la directory esista
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

// Abilita WAL mode per performance migliori
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Crea tabella products
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titolo_opera TEXT NOT NULL,
    autore TEXT,
    dimensioni TEXT,
    tecnica TEXT,
    descrizione_raw TEXT,
    prezzo REAL,
    quantita INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Crea tabella amazon_listings
db.exec(`
  CREATE TABLE IF NOT EXISTS amazon_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    titolo TEXT,
    descrizione TEXT,
    bp1 TEXT,
    bp2 TEXT,
    bp3 TEXT,
    bp4 TEXT,
    bp5 TEXT,
    parole_chiave TEXT,
    prezzo REAL,
    quantita INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )
`);

module.exports = db;
