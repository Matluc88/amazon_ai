/**
 * Seed del database: crea l'utente admin e tutte le definizioni attributi Amazon
 * Le sezioni corrispondono ai 6 TAB di Amazon Seller Central:
 * identità | descrizione | dettagli | variazioni* | offerta | conformità
 * (* tab variazioni è gestito separatamente dalla pagina listing)
 *
 * Aggiornato 2026-03-05 — allineato agli screenshot reali di Amazon Seller Central IT
 * Wall Art category con 3 varianti taglia (Grande/Media/Piccola)
 */
const bcrypt = require('bcryptjs');
const { query } = require('./db');

const ATTRIBUTE_DEFINITIONS = [
  // ─── TAB: IDENTITÀ PRODOTTO ───────────────────────────────
  // Amazon mostra: Nome articolo, Tipo prodotto, Variazioni, Nome marchio
  { nome: "Nome dell'articolo",              sezione: 'identità',    priorita: 'obbligatorio',        source: 'AI',     ordine: 1 },
  { nome: 'Nome del marchio',                sezione: 'identità',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 2,  fixedValue: 'Sivigliart' },
  { nome: 'Tipo di prodotto',                sezione: 'identità',    priorita: 'struttura_catalogo',  source: 'FIXED',  ordine: 3,  fixedValue: 'WALL ART' },
  { nome: 'Variazioni',                      sezione: 'identità',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 4,  fixedValue: 'Taglia' },

  // ─── TAB: DESCRIZIONE ─────────────────────────────────────
  // Amazon mostra SOLO: Descrizione, Punti elenco, Immagini
  { nome: 'Descrizione del prodotto',        sezione: 'descrizione', priorita: 'obbligatorio',        source: 'AI',     ordine: 10 },
  { nome: 'Punto elenco 1',                  sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 11 },
  { nome: 'Punto elenco 2',                  sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 12 },
  { nome: 'Punto elenco 3',                  sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 13 },
  { nome: 'Punto elenco 4',                  sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 14 },
  { nome: 'Punto elenco 5',                  sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 15 },
  // Immagini prodotto (URL caricati manualmente)
  { nome: 'Immagine principale',             sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 30 },
  { nome: 'Immagine 2',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 31 },
  { nome: 'Immagine 3',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 32 },
  { nome: 'Immagine 4',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 33 },
  { nome: 'Immagine 5',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 34 },
  { nome: 'Immagine 6',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 35 },
  { nome: 'Immagine 7',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 36 },
  { nome: 'Immagine 8',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 37 },
  { nome: 'Immagine 9',                      sezione: 'descrizione', priorita: 'media_asset',         source: 'MANUAL', ordine: 38 },

  // ─── TAB: DETTAGLI PRODOTTO ───────────────────────────────
  // Amazon mostra tutti questi nel tab "Dettagli prodotto":
  // — Keywords e attributi SEO (spostati da descrizione)
  { nome: 'Chiavi di ricerca',               sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 40 },
  { nome: 'Funzioni speciali',               sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 41 },
  { nome: 'Personaggio rappresentato',       sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 42 },
  { nome: 'Stile',                           sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 43 },
  { nome: 'Tema',                            sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 44 },
  { nome: 'Usi consigliati per il prodotto', sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 45 },
  { nome: 'Tipo di stanza',                  sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 46 },
  { nome: 'Famiglia di colori',              sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 47 },
  { nome: 'Motivo',                          sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 48 },
  // — Attributi identificativi obbligatori
  { nome: 'Nome del modello',                sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'AI',     ordine: 50 },
  { nome: 'Produttore',                      sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 51, fixedValue: 'Sivigliart' },
  { nome: 'Colore',                          sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'AI',     ordine: 52 },
  { nome: "Forma dell'articolo",             sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 53, fixedValue: 'Rettangolare' },
  { nome: 'Materiale della base',            sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 54, fixedValue: 'Tela' },
  // — Dimensioni (estratte automaticamente da misura_max al momento della generazione)
  { nome: "Lunghezza del bordo più lungo dell'articolo",  sezione: 'dettagli', priorita: 'obbligatorio', source: 'AUTO', ordine: 55 },
  { nome: "Unità di misura della lunghezza dell'articolo", sezione: 'dettagli', priorita: 'obbligatorio', source: 'FIXED', ordine: 56, fixedValue: 'centimetri' },
  { nome: "Larghezza del bordo più corto dell'articolo",  sezione: 'dettagli', priorita: 'obbligatorio', source: 'AUTO', ordine: 57 },
  { nome: "Unità di misura della larghezza dell'articolo", sezione: 'dettagli', priorita: 'obbligatorio', source: 'FIXED', ordine: 58, fixedValue: 'centimetri' },
  { nome: 'Conteggio di unità',              sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 59, fixedValue: '1' },
  { nome: 'Tipo di conteggio unità',         sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 60, fixedValue: 'Pezzi' },
  { nome: 'Numero di articoli',              sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 61, fixedValue: '1' },
  { nome: 'Descrizione della fascia di età', sezione: 'dettagli',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 62, fixedValue: 'Adulto' },
  // — Attributi tecnici specifici Wall Art
  { nome: 'Orientamento',                    sezione: 'dettagli',    priorita: 'seo',                 source: 'AUTO',   ordine: 63 },
  { nome: 'Supporti di stampa',              sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 64 },
  { nome: 'Edizione',                        sezione: 'dettagli',    priorita: 'seo',                 source: 'AI',     ordine: 65 },
  { nome: 'Tipo di vernice',                 sezione: 'dettagli',    priorita: 'seo',                 source: 'FIXED',  ordine: 66, fixedValue: 'Stampa su tela' },
  { nome: 'Tipo di finitura',                sezione: 'dettagli',    priorita: 'seo',                 source: 'FIXED',  ordine: 67, fixedValue: 'Lucida' },
  { nome: 'Materiale',                       sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 68, fixedValue: 'Tela' },
  { nome: 'Tipo di telaio',                  sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 69, fixedValue: 'Con telaio' },
  { nome: "È personalizzabile?",             sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 70, fixedValue: 'No' },
  { nome: "Profondità dell'articolo",        sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 71, fixedValue: '2' },
  { nome: 'Tipo di confezione',              sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 72, fixedValue: 'Pronto da appendere' },
  { nome: 'Tipo di montaggio',               sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 73, fixedValue: 'Montaggio a parete' },
  { nome: "È fragile?",                      sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 74, fixedValue: 'No' },
  { nome: "È incorniciato",                  sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 75, fixedValue: 'No' },
  { nome: 'Stagioni',                        sezione: 'dettagli',    priorita: 'facoltativo',         source: 'AI',     ordine: 76 },
  { nome: 'Utilizzo in ambienti interni ed esterni', sezione: 'dettagli', priorita: 'facoltativo',    source: 'AI',     ordine: 77 },
  { nome: 'forma decorazione da parete',     sezione: 'dettagli',    priorita: 'facoltativo',         source: 'AI',     ordine: 78 },
  { nome: 'Numero di confezioni',            sezione: 'dettagli',    priorita: 'facoltativo',         source: 'FIXED',  ordine: 79, fixedValue: '1' },

  // ─── TAB: OFFERTA ─────────────────────────────────────────
  // SKU viene dal sku_padre (generato automaticamente dall'import catalogo)
  { nome: 'SKU',                             sezione: 'offerta',     priorita: 'obbligatorio',        source: 'AUTO',   ordine: 100 },
  { nome: 'Canale di gestione',              sezione: 'offerta',     priorita: 'obbligatorio',        source: 'FIXED',  ordine: 101, fixedValue: 'Amazon' },
  { nome: 'Prezzo al pubblico consigliato (IVA inclusa)', sezione: 'offerta', priorita: 'importante_offerta', source: 'AUTO', ordine: 102 },
  { nome: 'Tempo di gestione',               sezione: 'offerta',     priorita: 'importante_offerta',  source: 'FIXED',  ordine: 103, fixedValue: '7' },
  { nome: "L'offerta può essere inviata tramite messaggio regalo", sezione: 'offerta', priorita: 'importante_offerta', source: 'FIXED', ordine: 104, fixedValue: 'No' },
  { nome: 'Condizione funzionale',           sezione: 'offerta',     priorita: 'importante_offerta',  source: 'FIXED',  ordine: 105, fixedValue: 'Nuovo' },
  { nome: 'Confezionamento',                 sezione: 'offerta',     priorita: 'importante_offerta',  source: 'FIXED',  ordine: 106, fixedValue: 'Standard' },
  { nome: 'Codice fiscale del prodotto',     sezione: 'offerta',     priorita: 'facoltativo',         source: 'FIXED',  ordine: 107, fixedValue: 'A_GEN_NOTAX' },
  { nome: 'È disponibile in confezione regalo', sezione: 'offerta',  priorita: 'facoltativo',         source: 'FIXED',  ordine: 108, fixedValue: 'No' },
  { nome: 'Prezzo minimo pubblicizzato',     sezione: 'offerta',     priorita: 'facoltativo',         source: 'MANUAL', ordine: 110 },
  // Dimensioni imballaggio (estratte da misura_max)
  { nome: 'Lunghezza imballaggio',           sezione: 'offerta',     priorita: 'facoltativo',         source: 'AUTO',   ordine: 111 },
  { nome: 'Larghezza imballaggio',           sezione: 'offerta',     priorita: 'facoltativo',         source: 'AUTO',   ordine: 112 },
  { nome: 'Altezza imballaggio',             sezione: 'offerta',     priorita: 'facoltativo',         source: 'FIXED',  ordine: 113, fixedValue: '3' },
  { nome: 'Unità di misura imballaggio',     sezione: 'offerta',     priorita: 'facoltativo',         source: 'FIXED',  ordine: 114, fixedValue: 'centimetri' },
  { nome: 'Peso imballaggio',                sezione: 'offerta',     priorita: 'facoltativo',         source: 'MANUAL', ordine: 115 },

  // ─── TAB: CONFORMITÀ E SICUREZZA ──────────────────────────
  { nome: 'Paese/Regione di origine',        sezione: 'conformità',  priorita: 'obbligatorio',        source: 'FIXED',  ordine: 130, fixedValue: 'Italia' },
  { nome: "Peso dell'articolo",              sezione: 'conformità',  priorita: 'obbligatorio',        source: 'MANUAL', ordine: 131 },
  { nome: "Unità di peso dell'articolo",     sezione: 'conformità',  priorita: 'obbligatorio',        source: 'FIXED',  ordine: 132, fixedValue: 'chilogrammi' },
  { nome: 'Attestazione di sicurezza GPSR',  sezione: 'conformità',  priorita: 'sicurezza_importante', source: 'FIXED', ordine: 133, fixedValue: 'Sì' },
  { nome: "Questo prodotto è soggetto a restrizioni di età per l'acquirente?", sezione: 'conformità', priorita: 'sicurezza_importante', source: 'FIXED', ordine: 134, fixedValue: 'No' },
  { nome: 'E-mail o indirizzo elettronico della persona responsabile', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'FIXED', ordine: 135, fixedValue: 'sivigliart@outlook.it' },
  { nome: 'E-mail o indirizzo elettronico del produttore', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'FIXED', ordine: 136, fixedValue: 'sivigliart@outlook.it' },
  { nome: 'Prodotto OEM originale',          sezione: 'conformità',  priorita: 'facoltativo',         source: 'FIXED',  ordine: 137, fixedValue: 'No' },
];

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@sivigliart.it';
  const password = process.env.ADMIN_PASSWORD || 'Sivigliart2026!';

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log('👤 Admin già esistente, skip seed');
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await query(
    'INSERT INTO users (email, password_hash, nome, ruolo) VALUES ($1, $2, $3, $4)',
    [email, hash, 'Admin', 'admin']
  );
  console.log(`👤 Utente admin creato: ${email}`);
}

/**
 * Seed attributi Amazon — sempre upsert (idempotente).
 * Aggiorna sezione/priorita/source/ordine anche su attributi già esistenti nel DB.
 * I valori già generati da Claude in amazon_listing_attributes NON vengono toccati.
 */
async function seedAttributes() {
  console.log(`📋 Upsert ${ATTRIBUTE_DEFINITIONS.length} attributi Amazon...`);

  for (const attr of ATTRIBUTE_DEFINITIONS) {
    const res = await query(
      `INSERT INTO attribute_definitions (nome_attributo, sezione, priorita, source, ordine)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nome_attributo) DO UPDATE SET
         sezione   = EXCLUDED.sezione,
         priorita  = EXCLUDED.priorita,
         source    = EXCLUDED.source,
         ordine    = EXCLUDED.ordine
       RETURNING id`,
      [attr.nome, attr.sezione, attr.priorita, attr.source, attr.ordine]
    );

    const attrId = res.rows[0].id;

    if (attr.source === 'FIXED' && attr.fixedValue) {
      await query(
        `INSERT INTO attribute_fixed_values (attribute_id, value)
         VALUES ($1, $2)
         ON CONFLICT (attribute_id) DO UPDATE SET value = EXCLUDED.value`,
        [attrId, attr.fixedValue]
      );
    }
  }

  console.log('✅ Attributi Amazon aggiornati correttamente');
}

async function runSeed() {
  try {
    await seedAdmin();
    await seedAttributes();
    console.log('✅ Seed completato');
  } catch (err) {
    console.error('❌ Errore seed:', err.message);
    throw err;
  }
}

module.exports = { runSeed, ATTRIBUTE_DEFINITIONS };
