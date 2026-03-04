/**
 * Seed del database: crea l'utente admin e tutte le definizioni attributi Amazon
 */
const bcrypt = require('bcryptjs');
const { query } = require('./db');

// ============================================================
// DEFINIZIONE COMPLETA ATTRIBUTI AMAZON (da Excel)
// Formato: { nome, sezione, priorita, source, ordine, fixedValue? }
// source: AI | FIXED | AUTO | MANUAL | SKIP
// ============================================================
const ATTRIBUTE_DEFINITIONS = [
  // ─── IDENTITÀ PRODOTTO ────────────────────────────────────
  { nome: 'Nome dell\'articolo',           sezione: 'identità',    priorita: 'obbligatorio',        source: 'AI',     ordine: 1 },
  { nome: 'Nome del marchio',              sezione: 'identità',    priorita: 'obbligatorio',        source: 'FIXED',  ordine: 2,  fixedValue: 'Sivigliart' },
  { nome: 'Tipo di prodotto',              sezione: 'identità',    priorita: 'struttura_catalogo',  source: 'FIXED',  ordine: 3,  fixedValue: 'WALL ART' },
  { nome: 'Nodi di navigazione consigliati', sezione: 'identità', priorita: 'facoltativo',         source: 'SKIP',   ordine: 4 },
  { nome: 'Varianti',                      sezione: 'identità',    priorita: 'variazione',          source: 'SKIP',   ordine: 5 },
  { nome: 'Attributi di variazione',       sezione: 'identità',    priorita: 'variazione',          source: 'SKIP',   ordine: 6 },

  // ─── DESCRIZIONE E CONTENUTO ─────────────────────────────
  { nome: 'Descrizione del prodotto',      sezione: 'descrizione', priorita: 'obbligatorio',        source: 'AI',     ordine: 10 },
  { nome: 'Punto elenco 1',                sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 11 },
  { nome: 'Punto elenco 2',                sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 12 },
  { nome: 'Punto elenco 3',                sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 13 },
  { nome: 'Punto elenco 4',                sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 14 },
  { nome: 'Punto elenco 5',                sezione: 'descrizione', priorita: 'seo_importante',      source: 'AI',     ordine: 15 },
  { nome: 'Immagine principale',           sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 16 },
  { nome: 'Immagine 2',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 17 },
  { nome: 'Immagine 3',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 18 },
  { nome: 'Immagine 4',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 19 },
  { nome: 'Immagine 5',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 20 },
  { nome: 'Immagine 6',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 21 },
  { nome: 'Immagine 7',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 22 },
  { nome: 'Immagine 8',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 23 },
  { nome: 'Immagine 9',                    sezione: 'media',       priorita: 'media_asset',         source: 'MANUAL', ordine: 24 },

  // ─── CARATTERISTICHE FISICHE ─────────────────────────────
  { nome: 'Nome del modello',              sezione: 'descrizione', priorita: 'obbligatorio',        source: 'AI',     ordine: 30 },
  { nome: 'Produttore',                    sezione: 'descrizione', priorita: 'obbligatorio',        source: 'FIXED',  ordine: 31, fixedValue: 'Sivigliart' },
  { nome: 'Colore',                        sezione: 'descrizione', priorita: 'obbligatorio',        source: 'AI',     ordine: 32 },
  { nome: 'Forma dell\'articolo',          sezione: 'descrizione', priorita: 'obbligatorio',        source: 'FIXED',  ordine: 33, fixedValue: 'Rettangolare' },
  { nome: 'Materiale della base',          sezione: 'descrizione', priorita: 'obbligatorio',        source: 'FIXED',  ordine: 34, fixedValue: 'Canvas' },
  { nome: 'Lunghezza del bordo più lungo dell\'articolo', sezione: 'descrizione', priorita: 'obbligatorio', source: 'AUTO', ordine: 35 },
  { nome: 'Unità di misura della lunghezza dell\'articolo', sezione: 'descrizione', priorita: 'obbligatorio', source: 'FIXED', ordine: 36, fixedValue: 'centimetri' },
  { nome: 'Larghezza del bordo più corto dell\'articolo', sezione: 'descrizione', priorita: 'obbligatorio', source: 'AUTO', ordine: 37 },
  { nome: 'Unità di misura della larghezza dell\'articolo', sezione: 'descrizione', priorita: 'obbligatorio', source: 'FIXED', ordine: 38, fixedValue: 'centimetri' },
  { nome: 'Conteggio di unità',            sezione: 'descrizione', priorita: 'obbligatorio',        source: 'FIXED',  ordine: 39, fixedValue: '1' },
  { nome: 'Tipo di conteggio unità',       sezione: 'descrizione', priorita: 'obbligatorio',        source: 'FIXED',  ordine: 40, fixedValue: 'Pezzo' },

  // ─── SEO / RICERCA ───────────────────────────────────────
  { nome: 'Chiavi di ricerca',             sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 50 },
  { nome: 'Funzioni speciali',             sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 51 },
  { nome: 'Personaggio rappresentato',     sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 52 },
  { nome: 'Stile',                         sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 53 },
  { nome: 'Tema',                          sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 54 },
  { nome: 'Usi consigliati per il prodotto', sezione: 'descrizione', priorita: 'seo',               source: 'AI',     ordine: 55 },
  { nome: 'Tipo di stanza',               sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 56 },
  { nome: 'Famiglia di colori',            sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 57 },
  { nome: 'Motivo',                        sezione: 'descrizione', priorita: 'seo',                 source: 'AI',     ordine: 58 },
  { nome: 'Orientamento',                  sezione: 'descrizione', priorita: 'seo',                 source: 'AUTO',   ordine: 59 },

  // ─── CARATTERISTICHE FACOLTATIVE ─────────────────────────
  { nome: 'Numero di articoli',            sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 70, fixedValue: '1' },
  { nome: 'Supporti di stampa',            sezione: 'descrizione', priorita: 'facoltativo',         source: 'AI',     ordine: 71 },
  { nome: 'È personalizzabile?',           sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 72, fixedValue: 'No' },
  { nome: 'Profondità dell\'articolo',     sezione: 'descrizione', priorita: 'facoltativo',         source: 'MANUAL', ordine: 73 },
  { nome: 'Tipo di confezione',            sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 74, fixedValue: 'Cartone' },
  { nome: 'Tipo di montaggio',             sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 75, fixedValue: 'Pronta da appendere' },
  { nome: 'Materiale',                     sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 76, fixedValue: 'Tela' },
  { nome: 'Tipo di telaio',                sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 77, fixedValue: 'Con telaio' },
  { nome: 'È fragile?',                    sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 78, fixedValue: 'No' },
  { nome: 'È incorniciato',                sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 79, fixedValue: 'No' },
  { nome: 'Stagioni',                      sezione: 'descrizione', priorita: 'facoltativo',         source: 'AI',     ordine: 80 },
  { nome: 'Utilizzo in ambienti interni ed esterni', sezione: 'descrizione', priorita: 'facoltativo', source: 'AI', ordine: 81 },
  { nome: 'forma decorazione da parete',   sezione: 'descrizione', priorita: 'facoltativo',         source: 'AI',     ordine: 82 },
  { nome: 'Numero di confezioni',          sezione: 'descrizione', priorita: 'facoltativo',         source: 'FIXED',  ordine: 83, fixedValue: '1' },
  { nome: 'Descrizione della fascia di età', sezione: 'descrizione', priorita: 'facoltativo',       source: 'SKIP',   ordine: 84 },
  { nome: 'Edizione',                      sezione: 'descrizione', priorita: 'facoltativo',         source: 'SKIP',   ordine: 85 },
  { nome: 'Tipo di vernice',               sezione: 'descrizione', priorita: 'facoltativo',         source: 'SKIP',   ordine: 86 },
  { nome: 'Finitura carta',                sezione: 'descrizione', priorita: 'facoltativo',         source: 'SKIP',   ordine: 87 },
  { nome: 'Tipo di finitura',              sezione: 'descrizione', priorita: 'facoltativo',         source: 'SKIP',   ordine: 88 },
  { nome: 'Materiale cornice',             sezione: 'descrizione', priorita: 'facoltativo',         source: 'SKIP',   ordine: 89 },
  { nome: 'Colore della cornice',          sezione: 'descrizione', priorita: 'facoltativo',         source: 'SKIP',   ordine: 90 },
  { nome: 'Volume/peso dell\'unità di vendita', sezione: 'descrizione', priorita: 'facoltativo',    source: 'SKIP',   ordine: 91 },

  // ─── NON RILEVANTE ───────────────────────────────────────
  { nome: 'Nome Lega',                     sezione: 'descrizione', priorita: 'non_rilevante',       source: 'SKIP',   ordine: 100 },
  { nome: 'Nome squadra',                  sezione: 'descrizione', priorita: 'non_rilevante',       source: 'SKIP',   ordine: 101 },
  { nome: 'Tema animali',                  sezione: 'descrizione', priorita: 'non_rilevante',       source: 'SKIP',   ordine: 102 },
  { nome: 'Nome del set',                  sezione: 'descrizione', priorita: 'non_rilevante',       source: 'SKIP',   ordine: 103 },
  { nome: 'Numero Di Parte',               sezione: 'descrizione', priorita: 'non_rilevante',       source: 'SKIP',   ordine: 104 },

  // ─── CONFORMITÀ ──────────────────────────────────────────
  { nome: 'Paese/Regione di origine',      sezione: 'conformità',  priorita: 'obbligatorio',        source: 'FIXED',  ordine: 110, fixedValue: 'Italia' },
  { nome: 'Peso dell\'articolo',           sezione: 'conformità',  priorita: 'obbligatorio',        source: 'MANUAL', ordine: 111 },
  { nome: 'Unità di peso dell\'articolo',  sezione: 'conformità',  priorita: 'obbligatorio',        source: 'FIXED',  ordine: 112, fixedValue: 'chilogrammi' },
  { nome: 'Attestazione di sicurezza GPSR', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'FIXED', ordine: 113, fixedValue: 'Conforme GPSR UE 2023/988' },
  { nome: 'Questo prodotto è soggetto a restrizioni di età per l\'acquirente?', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'FIXED', ordine: 114, fixedValue: 'No' },
  { nome: 'E-mail o indirizzo elettronico della persona responsabile', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'FIXED', ordine: 115, fixedValue: 'sivigliart@outlook.it' },
  { nome: 'E-mail o indirizzo elettronico del produttore', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'FIXED', ordine: 116, fixedValue: 'sivigliart@outlook.it' },
  { nome: 'Conformità del tipo di contenuto dei supporti multimediali', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'SKIP', ordine: 117 },
  { nome: 'Conformità della lingua del supporto multimediale', sezione: 'conformità', priorita: 'sicurezza_importante', source: 'SKIP', ordine: 118 },
  { nome: 'Spedizione a livello globale',  sezione: 'conformità',  priorita: 'facoltativo',         source: 'SKIP',   ordine: 120 },
  { nome: 'Con batteria sostituibile',     sezione: 'conformità',  priorita: 'facoltativo',         source: 'SKIP',   ordine: 121 },
  { nome: 'Codice IEC della batteria',     sezione: 'conformità',  priorita: 'non_rilevante',       source: 'SKIP',   ordine: 125 },
  { nome: 'Codice H del sistema GHS per le sostanze chimiche', sezione: 'conformità', priorita: 'non_rilevante', source: 'SKIP', ordine: 126 },

  // ─── OFFERTA ─────────────────────────────────────────────
  { nome: 'SKU',                           sezione: 'offerta',     priorita: 'obbligatorio',        source: 'MANUAL', ordine: 130 },
  { nome: 'Canale di gestione',            sezione: 'offerta',     priorita: 'obbligatorio',        source: 'FIXED',  ordine: 131, fixedValue: 'Amazon' },
  { nome: 'Prezzo al pubblico consigliato (IVA inclusa)', sezione: 'offerta', priorita: 'importante_offerta', source: 'MANUAL', ordine: 132 },
  { nome: 'Tempo di gestione',             sezione: 'offerta',     priorita: 'importante_offerta',  source: 'FIXED',  ordine: 133, fixedValue: '3' },
  { nome: 'L\'offerta può essere inviata tramite messaggio regalo', sezione: 'offerta', priorita: 'importante_offerta', source: 'FIXED', ordine: 134, fixedValue: 'No' },
  { nome: 'Condizione funzionale',         sezione: 'offerta',     priorita: 'importante_offerta',  source: 'FIXED',  ordine: 135, fixedValue: 'Nuovo' },
  { nome: 'Confezionamento',               sezione: 'offerta',     priorita: 'importante_offerta',  source: 'FIXED',  ordine: 136, fixedValue: 'Standard' },
  { nome: 'Prezzo minimo pubblicizzato',   sezione: 'offerta',     priorita: 'facoltativo',         source: 'MANUAL', ordine: 140 },
  { nome: 'Prezzo minimo consentito al venditore', sezione: 'offerta', priorita: 'importante_offerta', source: 'SKIP', ordine: 141 },
  { nome: 'Percentuale della durata della batteria', sezione: 'offerta', priorita: 'non_rilevante', source: 'SKIP',   ordine: 150 },
];

/**
 * Seed dell'utente admin
 */
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
 * Seed degli attributi Amazon
 */
async function seedAttributes() {
  const existing = await query('SELECT COUNT(*) FROM attribute_definitions');
  if (parseInt(existing.rows[0].count) > 0) {
    console.log('📋 Attributi già presenti, skip seed');
    return;
  }

  console.log(`📋 Inserimento ${ATTRIBUTE_DEFINITIONS.length} attributi Amazon...`);

  for (const attr of ATTRIBUTE_DEFINITIONS) {
    // Inserisci definizione
    const res = await query(
      `INSERT INTO attribute_definitions (nome_attributo, sezione, priorita, source, ordine)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nome_attributo) DO UPDATE SET
         sezione = EXCLUDED.sezione,
         priorita = EXCLUDED.priorita,
         source = EXCLUDED.source,
         ordine = EXCLUDED.ordine
       RETURNING id`,
      [attr.nome, attr.sezione, attr.priorita, attr.source, attr.ordine]
    );

    const attrId = res.rows[0].id;

    // Se FIXED, inserisci il valore fisso
    if (attr.source === 'FIXED' && attr.fixedValue) {
      await query(
        `INSERT INTO attribute_fixed_values (attribute_id, value)
         VALUES ($1, $2)
         ON CONFLICT (attribute_id) DO UPDATE SET value = EXCLUDED.value`,
        [attrId, attr.fixedValue]
      );
    }
  }

  console.log('✅ Attributi Amazon inseriti correttamente');
}

/**
 * Esegui tutto il seed
 */
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
