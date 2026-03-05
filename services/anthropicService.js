const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Genera TUTTI gli attributi AI in una singola chiamata Claude
 * @param {object} product - dati del prodotto (descrizione_raw, dimensioni, ecc.)
 * @param {string[]} keywords - keyword minate da Amazon (opzionale)
 * @returns {object} - { "Nome dell'articolo": "...", "Punto elenco 1": "...", ... }
 */
async function generateAllAiAttributes(product, keywords = []) {
  const keywordsSection = keywords.length > 0
    ? `\nKEYWORD REALI CERCATE SU AMAZON.IT — usa queste dove naturale (NON ripeterle nel titolo se già presenti):\n${keywords.slice(0, 20).join(', ')}\n`
    : '';

  // Sezione varianti per il prompt
  const variantiSection = (product.misura_max || product.sku_max)
    ? `\nVARIANTI DISPONIBILI (3 taglie):
- Grande: ${product.misura_max || '—'} — €${product.prezzo_max || '—'} (SKU: ${product.sku_max || '—'})
- Media: ${product.misura_media || '—'} — €${product.prezzo_media || '—'} (SKU: ${product.sku_media || '—'})
- Piccola: ${product.misura_mini || '—'} — €${product.prezzo_mini || '—'} (SKU: ${product.sku_mini || '—'})\n`
    : '';

  // hasSizeVariants: robusto contro null / "" / "—" / "0"
  const hasSizeVariants = typeof product.misura_max === 'string'
    ? product.misura_max.trim().length > 0 && product.misura_max.trim() !== '—'
    : Boolean(product.misura_max);

  // Dimensione taglia grande per single ASIN (es. "70x100")
  const dimensioneSingle = product.dimensioni || product.misura_max || '';

  const prompt = `Sei un esperto di listing Amazon per il mercato italiano, specializzato in arte e decorazione.

Il tuo compito è analizzare il testo di un'opera d'arte e generare TUTTI gli attributi necessari per un listing Amazon ottimizzato per stampe su tela.

TESTO DELL'OPERA:
"""
${product.descrizione_raw || 'Nessuna descrizione fornita'}
"""
${product.dimensioni ? `\nDIMENSIONI (taglia grande): ${product.dimensioni}` : ''}
${product.autore ? `\nAUTORE: ${product.autore}` : ''}
${product.tecnica ? `\nTECNICA: ${product.tecnica}` : ''}
${variantiSection}
${keywordsSection}

ISTRUZIONI:
- Analizza il testo e comprendi il soggetto, lo stile e il contesto dell'opera
- Genera contenuti SEO ottimizzati per Amazon Italia, algoritmo A9
- Tutti i campi DEVONO essere in ITALIANO

### NOME DELL'ARTICOLO (Amazon - Titolo):
Obiettivo: titolo CTR-first + SEO, leggibile su mobile, italiano naturale senza keyword stuffing.
Range TARGET: 150–180 caratteri. MAI oltre 200. Mira ai 160–170.

STRUTTURA OBBLIGATORIA (segui quest'ordine esatto, massimo 3 virgole interne):
"Stampa su Tela {soggetto}, {stile} dai Colori {colore1} e {colore2}, Decorazione Parete per {stanza1} e {stanza2}, Pronto da Appendere{DIMENSIONE}"

Dove:
- {soggetto}: 2–5 parole descrittive dell'opera (es. "Coppia Romantica", "Paesaggio Astratto", "Figura Femminile al Mare")
- {stile}: es. "Quadro Moderno", "Quadro Astratto Moderno", "Quadro Contemporaneo"
- {colore1} e {colore2}: i 2 colori principali, ogni parola Capitalizzata (es. "Turchese e Verde Petrolio", "Blu Notte e Oro")
- {stanza1} e {stanza2}: le 2 stanze più coerenti con l'opera (es. "Soggiorno e Camera da Letto", "Soggiorno e Ufficio")
- {DIMENSIONE}:
  - hasSizeVariants = ${hasSizeVariants}
  - Se hasSizeVariants è TRUE (prodotto parent con 3 taglie): NON aggiungere NESSUNA dimensione nel titolo
  - Se hasSizeVariants è FALSE (single ASIN): aggiungi ", ${dimensioneSingle} cm" subito dopo "Pronto da Appendere"

VIETATO (tassativo):
- Inserire autore, artista o "Arte di [Autore]" nel titolo — il nome dell'autore NON va mai nel titolo
- Inserire il brand "Sivigliart" nel titolo (è già nel campo "Nome del marchio" separato)
- ⚠️ Se nel testo dell'opera compare un autore o un nome di brand, IGNORALO completamente nel titolo
- Keyword stuffing: nessun elenco di parole separate da virgola senza senso compiuto
- MAIUSCOLO totale su più parole consecutive
- Parole vietate: migliore, premium, super qualità, gratis, spedizione veloce, esclusivo

ESEMPI CORRETTI:
- Single: "Stampa su Tela Coppia Romantica, Quadro Moderno dai Colori Turchese e Verde Petrolio, Decorazione Parete per Soggiorno e Camera da Letto, Pronto da Appendere, 70x100 cm" (167 car.)
- Parent: "Stampa su Tela Astratto Geometrico, Quadro Moderno dai Colori Nero e Oro, Decorazione Parete per Soggiorno e Ufficio, Pronto da Appendere" (138 car.)

Output: UNA sola riga di testo, senza virgolette esterne, senza spiegazioni.

### DESCRIZIONE DEL PRODOTTO (200-2000 caratteri):
- La PRIMA FRASE deve essere SEMPRE: "Stampa su tela che riproduce un'opera originale dipinta dall'artista [autore]." — sostituisci [autore] con il nome reale
- Prosegui raccontando l'opera con linguaggio evocativo
- Suggerisci contesti d'uso e destinatari
- ⚠️ Se il prodotto ha varianti di taglia (sezione VARIANTI DISPONIBILI presente nel prompt), DEVI chiudere SEMPRE la descrizione con la frase esatta: "Disponibile nelle misure: [misura_mini], [misura_media], [misura_max] cm." — usa i valori reali delle varianti.
- Chiudi dopo le misure con una frase che invita all'acquisto

### CHIAVI DI RICERCA (campo backend Search Terms — max 250 byte UTF-8):
- ⚠️ Formato OBBLIGATORIO: solo spazi tra i termini — ZERO virgole, ZERO punteggiatura, ZERO trattini
- 20-30 termini brevi (singole parole o coppie), tutti minuscoli, separati da un singolo spazio
- Riempi esattamente 240-250 byte — NON lasciare spazio inutilizzato
- NON ripetere NESSUNA parola già presente nel Nome dell'articolo, nei Punti elenco o nel nome del marchio
- Includi: sinonimi dell'opera, varianti di ricerca, ambienti, materiali, target, long tail
- Esempio corretto: "quadro tela arte moderna stampe canvas decorazione pareti soggiorno regalo bambini cameretta figurativo"

### PUNTI ELENCO (Amazon li indicizza tutti — usa keyword secondarie qui):
Segui ESATTAMENTE questo schema a 5 punti ottimizzati per conversione:

- Punto elenco 1 — MATERIALE: inizia con "STAMPA SU TELA CANVAS –" e usa SEMPRE questa formulazione esatta: "STAMPA SU TELA CANVAS – Stampa su tela che riproduce un'opera originale dipinta dall'artista [autore], su tela di alta qualità montata su telaio in legno e pronta da appendere." (sostituisci [autore] con il nome reale; chiarisce che non è un dipinto a mano)
- ⚠️ La formulazione "Stampa su tela che riproduce un'opera originale dipinta dall'artista [autore]" deve comparire SOLO nel Punto elenco 1 e nella Descrizione — NON nei bullet 2-5
- Punto elenco 2 — STILE/ARTE: inizia con "ARTE [STILE] –" e descrivi l'opera, i colori, l'impatto visivo
- Punto elenco 3 — AMBIENTI: inizia con "DECORAZIONE PARETE –" e indica i contesti ideali (soggiorno, camera da letto, ufficio, studio, corridoio...)
- Punto elenco 4 — INSTALLAZIONE: inizia con "PRONTO DA APPENDERE –" e descrivi telaio in legno, ganci, misure disponibili
- Punto elenco 5 — REGALO/GARANZIA: inizia con "IDEA REGALO –" menziona occasioni regalo e garanzia Sivigliart (imballaggio protettivo, reso gratuito 30 giorni)

### ALTRI CAMPI:
- "Personaggio rappresentato": se non applicabile, scrivi "N/D"
- "Colore": elenca i colori principali separati da virgola (es. "Turchese, Verde Petrolio, Giallo")
- "Stile": stile artistico (es. "Cubista", "Impressionista", "Arte Moderna", "Astratto")
- "Tema": tema/i dell'opera separati da virgola (es. "Coppia romantica, Estate, Amore")
- "Tipo di stanza": ambienti consigliati separati da virgola (es. "Soggiorno, Camera da letto")
- "Usi consigliati per il prodotto": usi pratici separati da virgola (es. "Decorazione parete, Regalo")
- "Tema animali": SOLO se il soggetto principale dell'opera è un animale, indicare il tipo (es. "Cane", "Gatto", "Cavallo", "Uccello", "Leone"). Se l'opera non rappresenta animali, scrivi "N/D"
- "Edizione": breve descrizione dell'edizione artistica (es. "Stampa Artistica Moderna", "Edizione Limitata", "Prima Edizione")

Rispondi SOLO con un oggetto JSON valido (nessun testo prima o dopo), con esattamente questi campi:

{
  "Nome dell'articolo": "...",
  "Nome del modello": "...",
  "Descrizione del prodotto": "...",
  "Punto elenco 1": "...",
  "Punto elenco 2": "...",
  "Punto elenco 3": "...",
  "Punto elenco 4": "...",
  "Punto elenco 5": "...",
  "Chiavi di ricerca": "...",
  "Funzioni speciali": "...",
  "Personaggio rappresentato": "...",
  "Stile": "...",
  "Tema": "...",
  "Usi consigliati per il prodotto": "...",
  "Tipo di stanza": "...",
  "Famiglia di colori": "...",
  "Motivo": "...",
  "Colore": "...",
  "Supporti di stampa": "Stampa su tela canvas",
  "Edizione": "...",
  "Stagioni": "...",
  "Utilizzo in ambienti interni ed esterni": "...",
  "forma decorazione da parete": "...",
  "Tema animali": "..."
}`;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }]
  });

  return parseJsonResponse(message.content[0].text);
}

/**
 * Rigenera un singolo attributo AI
 * @param {object} product
 * @param {string} nomeAttributo - es. "Punto elenco 1", "Descrizione del prodotto"
 * @param {string} currentValue - valore attuale
 * @param {string[]} keywords
 */
async function regenerateSingleAttribute(product, nomeAttributo, currentValue, keywords = []) {
  const keywordsSection = keywords.length > 0
    ? `\nKEYWORD REALI CERCATE SU AMAZON.IT:\n${keywords.slice(0, 20).join(', ')}\n`
    : '';

  // Calcola misure varianti per la guida (se disponibili)
  const misureVarianti = (product.misura_mini && product.misura_media && product.misura_max)
    ? `${product.misura_mini}, ${product.misura_media}, ${product.misura_max} cm`
    : null;

  // hasSizeVariants per regenerate (stessa logica di generateAllAiAttributes)
  const hasSizeVariantsRegen = typeof product.misura_max === 'string'
    ? product.misura_max.trim().length > 0 && product.misura_max.trim() !== '—'
    : Boolean(product.misura_max);
  const dimensioneSingleRegen = product.dimensioni || product.misura_max || '';

  const guideMap = {
    "Nome dell'articolo": `Titolo Amazon CTR-first + SEO. Range TARGET: 150–180 caratteri, MAI oltre 200.

STRUTTURA OBBLIGATORIA (massimo 3 virgole interne):
"Stampa su Tela {soggetto}, {stile} dai Colori {colore1} e {colore2}, Decorazione Parete per {stanza1} e {stanza2}, Pronto da Appendere{DIMENSIONE}"

Dove:
- {soggetto}: 2–5 parole descrittive dell'opera (es. "Coppia Romantica", "Paesaggio Astratto")
- {stile}: es. "Quadro Moderno", "Quadro Contemporaneo", "Quadro Astratto Moderno"
- {colore1} e {colore2}: i 2 colori principali, ogni parola Capitalizzata
- {stanza1} e {stanza2}: le 2 stanze più coerenti con l'opera
- hasSizeVariants = ${hasSizeVariantsRegen}
- {DIMENSIONE}: se hasSizeVariants TRUE → niente; se FALSE → aggiungi ", ${dimensioneSingleRegen} cm"

VIETATO:
- Autore, "Arte di [Autore]" o nome dell'artista nel titolo
- Brand "Sivigliart" nel titolo
- Se nel testo compare autore o brand, IGNORALI completamente
- Keyword stuffing, MAIUSCOLO totale, parole vietate (migliore, premium, esclusivo, gratis)

Output: UNA sola riga di testo, senza virgolette esterne, senza spiegazioni.`,
    "Nome del modello": 'breve nome identificativo dell\'opera (es. "La Notte Stellata - Van Gogh")',
    "Descrizione del prodotto": `200-2000 caratteri. La PRIMA FRASE deve essere SEMPRE: "Stampa su tela che riproduce un'opera originale dipinta dall'artista [autore]." (sostituisci [autore] con il nome reale). Poi racconta l'opera con linguaggio evocativo, suggerisci contesti d'uso. ⚠️ Se il prodotto ha varianti di taglia, DEVI chiudere SEMPRE con: "Disponibile nelle misure: ${misureVarianti || '[misura piccola], [misura media], [misura grande] cm'}." Poi aggiungi una frase che invita all'acquisto.`,
    "Punto elenco 1": `MATERIALE — usa SEMPRE questa formulazione esatta: "STAMPA SU TELA CANVAS – Stampa su tela che riproduce un'opera originale dipinta dall'artista [autore], su tela di alta qualità montata su telaio in legno e pronta da appendere." Sostituisci [autore] con il nome reale. Questa formulazione chiarisce che non è un dipinto a mano. ⚠️ NON usare questa formulazione negli altri bullet (2-5).`,
    "Punto elenco 2": 'STILE/ARTE — inizia con "ARTE [STILE] –" e descrivi l\'opera, i colori principali, l\'impatto visivo ed emotivo',
    "Punto elenco 3": 'AMBIENTI — inizia con "DECORAZIONE PARETE –" e indica tutti i contesti ideali: soggiorno, camera da letto, ufficio, studio, corridoio, cameretta...',
    "Punto elenco 4": 'INSTALLAZIONE — inizia con "PRONTO DA APPENDERE –" e descrivi: telaio in legno, ganci inclusi, misure disponibili (le 3 taglie)',
    "Punto elenco 5": 'REGALO/GARANZIA — inizia con "IDEA REGALO –" menziona: occasioni regalo (compleanno, anniversario, inaugurazione casa), garanzia Sivigliart, imballaggio protettivo, reso gratuito 30 giorni',
    "Chiavi di ricerca": `Campo backend Search Terms — max 250 byte UTF-8. ⚠️ Formato OBBLIGATORIO: solo spazi — ZERO virgole, ZERO punteggiatura. 20-30 termini brevi, tutti minuscoli. IMPORTANTE: Amazon indicizza già le parole nel titolo e nei bullet → usa SOLO sinonimi e long-tail non ancora indicizzati. Riempi 240-250 byte. Esempio: "decorazione parete astratta canvas wall art arredamento arte contemporanea telaio legno regalo casa stampa artistica moderna"`,
    "Edizione": 'breve descrizione dell\'edizione artistica (es. "Stampa Artistica Moderna", "Edizione Limitata", "Prima Edizione")',
    "Stile": 'stile artistico (es. Impressionismo, Arte moderna, Astratto, Figurativo...)',
    "Tema": 'tema/i dell\'opera separati da virgola (es. Natura, Ritratto, Paesaggio, Astratto...)',
    "Tipo di stanza": 'ambienti consigliati separati da virgola (es. Salotto, Camera, Ufficio...)',
    "Famiglia di colori": 'palette dominante (es. Blu e verde, Caldi, Pastello, Multicolore...)',
    "Colore": 'colori principali dell\'opera separati da virgola',
    "Motivo": 'motivo decorativo (es. Floreale, Astratto, Geometrico, Figurativo...)',
    "Usi consigliati per il prodotto": 'usi pratici separati da virgola (es. Decorazione parete, Regalo, Arredamento...)',
    "Tema animali": 'SOLO se il soggetto principale dell\'opera è un animale: indicare il tipo (es. "Cane", "Gatto", "Cavallo", "Uccello", "Leone"). Se l\'opera non rappresenta animali, scrivi "N/D".',
  };

  const guide = guideMap[nomeAttributo] || 'campo testo libero per listing Amazon Italia';

  const prompt = `Sei un esperto di listing Amazon per il mercato italiano, specializzato in arte e decorazione.

Rigenera SOLO il campo "${nomeAttributo}" per questa stampa artistica su tela.

TESTO DELL'OPERA:
"""
${product.descrizione_raw || 'Nessuna descrizione'}
"""
${product.dimensioni ? `\nDIMENSIONI: ${product.dimensioni}` : ''}
${product.autore ? `\nAUTORE: ${product.autore}` : ''}
${product.tecnica ? `\nTECNICA: ${product.tecnica}` : ''}

VALORE ATTUALE (da migliorare):
${currentValue || 'Non presente'}
${keywordsSection}
GUIDA SPECIFICA PER QUESTO CAMPO:
${guide}

Rispondi SOLO con un JSON: {"${nomeAttributo}": "il nuovo valore"}`;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  return parseJsonResponse(message.content[0].text);
}

/**
 * Genera keyword Amazon.it ottimizzate con Claude AI
 * Sostituisce il mining via Amazon autocomplete (bloccato per IP server)
 *
 * @param {object} product
 * @returns {string[]} array di keyword ordinate per rilevanza
 */
async function generateKeywordsWithAI(product) {
  const prompt = `Sei un esperto SEO per Amazon Italia (marketplace IT), specializzato in arte e decorazione.

Analizza questo prodotto e genera le migliori keyword di ricerca che i clienti italiani userebbero su Amazon.it per trovarlo.

PRODOTTO:
- Opera: ${product.titolo_opera || ''}
- Autore: ${product.autore || ''}
- Dimensioni: ${product.dimensioni || product.misura_max || ''}
- Tecnica: ${product.tecnica || 'Stampa su tela'}
- Descrizione: ${(product.descrizione_raw || '').slice(0, 600)}

ISTRUZIONI:
1. Genera esattamente 40 keyword in ITALIANO che i clienti cercano su Amazon.it
2. Includi: termini generici popolari, termini specifici dell'opera, dimensioni, ambienti, occasioni regalo
3. Ordina per volume di ricerca stimato (dalla più cercata alla meno cercata)
4. Ogni keyword deve essere una frase di ricerca reale (1-5 parole)
5. NON includere keyword in altre lingue
6. Focus su: decorazione casa, quadri, stampe, soggetti specifici, ambienti (soggiorno, camera, ecc.)

Rispondi SOLO con un JSON array di stringhe:
["keyword1", "keyword2", "keyword3", ...]`;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = message.content[0].text;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr.map(k => String(k).toLowerCase().trim()).filter(k => k.length > 2) : [];
  } catch {
    return [];
  }
}

/**
 * Estrae e parsa la risposta JSON di Claude
 */
function parseJsonResponse(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude non ha restituito un JSON valido');
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Errore nel parsing della risposta AI: ${e.message}`);
  }
}

module.exports = { generateAllAiAttributes, regenerateSingleAttribute, generateKeywordsWithAI };
