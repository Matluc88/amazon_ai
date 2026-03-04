const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Blocco aggiuntivo con le keyword reali minate da Amazon.it
 */
function keywordsBlock(keywords) {
  if (!keywords || keywords.length === 0) return '';
  return `
KEYWORD REALI CERCATE SU AMAZON.IT (usa queste nei contenuti dove naturale):
${keywords.slice(0, 20).join(', ')}
`;
}

/**
 * Genera il listing completo per un prodotto
 * @param {object} product
 * @param {string[]} [keywords] - keyword minate da Amazon (opzionale)
 */
async function generateFullListing(product, keywords = []) {
  const prompt = buildFullPrompt(product, keywords);

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const responseText = message.content[0].text;
  return parseJsonResponse(responseText);
}

/**
 * Rigenera solo il titolo
 * @param {object} product
 * @param {object} currentListing
 * @param {string[]} [keywords]
 */
async function regenerateTitle(product, currentListing, keywords = []) {
  const prompt = `Sei un esperto copywriter specializzato in listing Amazon per il mercato italiano.

Devi riscrivere SOLO il titolo del prodotto Amazon per questa stampa artistica su tela.

DATI DEL PRODOTTO:
- Opera: ${product.titolo_opera}
- Autore: ${product.autore || 'N/D'}
- Dimensioni: ${product.dimensioni || 'N/D'}
- Tecnica: ${product.tecnica || 'Stampa su tela'}
- Descrizione: ${product.descrizione_raw || 'N/D'}

TITOLO ATTUALE:
${currentListing.titolo || 'Non presente'}
${keywordsBlock(keywords)}
REGOLE PER IL TITOLO AMAZON:
- Massimo 200 caratteri
- Includi: tipo prodotto, titolo opera, autore, dimensioni se disponibili
- Ottimizzato per le ricerche Amazon italiane
- Deve essere chiaro, descrittivo e accattivante
- Non usare caratteri speciali non necessari (!, ?, *)
- Formato consigliato: [Tipo] - [Titolo Opera] di [Autore] - [Dimensioni] - [Materiale/Caratteristica]

Rispondi SOLO con un JSON nel seguente formato, senza testo aggiuntivo:
{"titolo": "il titolo generato"}`;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = message.content[0].text;
  return parseJsonResponse(responseText);
}

/**
 * Rigenera solo i bullet points
 * @param {object} product
 * @param {object} currentListing
 * @param {string[]} [keywords]
 */
async function regenerateBulletPoints(product, currentListing, keywords = []) {
  const prompt = `Sei un esperto copywriter specializzato in listing Amazon per il mercato italiano.

Devi riscrivere SOLO i 5 bullet points del prodotto Amazon per questa stampa artistica su tela.

DATI DEL PRODOTTO:
- Opera: ${product.titolo_opera}
- Autore: ${product.autore || 'N/D'}
- Dimensioni: ${product.dimensioni || 'N/D'}
- Tecnica: ${product.tecnica || 'Stampa su tela'}
- Descrizione: ${product.descrizione_raw || 'N/D'}

BULLET POINTS ATTUALI:
1. ${currentListing.bp1 || 'Non presente'}
2. ${currentListing.bp2 || 'Non presente'}
3. ${currentListing.bp3 || 'Non presente'}
4. ${currentListing.bp4 || 'Non presente'}
5. ${currentListing.bp5 || 'Non presente'}
${keywordsBlock(keywords)}
REGOLE PER I BULLET POINTS AMAZON:
- Massimo 500 caratteri per bullet point
- Inizia ogni bullet con una keyword importante in MAIUSCOLO seguita da " – "
- Evidenzia benefici concreti per l'acquirente
- Copri: qualità del prodotto, caratteristiche tecniche, uso decorativo, valore artistico, informazioni pratiche
- Linguaggio persuasivo ma informativo
- In italiano

Rispondi SOLO con un JSON nel seguente formato, senza testo aggiuntivo:
{
  "bp1": "primo bullet point",
  "bp2": "secondo bullet point",
  "bp3": "terzo bullet point",
  "bp4": "quarto bullet point",
  "bp5": "quinto bullet point"
}`;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = message.content[0].text;
  return parseJsonResponse(responseText);
}

/**
 * Rigenera solo la descrizione
 * @param {object} product
 * @param {object} currentListing
 * @param {string[]} [keywords]
 */
async function regenerateDescription(product, currentListing, keywords = []) {
  const prompt = `Sei un esperto copywriter specializzato in listing Amazon per il mercato italiano.

Devi riscrivere SOLO la descrizione lunga del prodotto Amazon per questa stampa artistica su tela.

DATI DEL PRODOTTO:
- Opera: ${product.titolo_opera}
- Autore: ${product.autore || 'N/D'}
- Dimensioni: ${product.dimensioni || 'N/D'}
- Tecnica: ${product.tecnica || 'Stampa su tela'}
- Descrizione originale: ${product.descrizione_raw || 'N/D'}

DESCRIZIONE ATTUALE:
${currentListing.descrizione || 'Non presente'}
${keywordsBlock(keywords)}
REGOLE PER LA DESCRIZIONE AMAZON:
- Tra 200 e 2000 caratteri
- Racconta la storia dell'opera e dell'artista
- Descrivi l'effetto visivo e l'atmosfera
- Spiega i possibili utilizzi decorativi (salotto, camera, ufficio, ecc.)
- Includi informazioni tecniche (materiale, qualità di stampa)
- Termina con un invito all'acquisto
- Linguaggio caldo, evocativo e persuasivo
- In italiano

Rispondi SOLO con un JSON nel seguente formato, senza testo aggiuntivo:
{"descrizione": "la descrizione generata"}`;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = message.content[0].text;
  return parseJsonResponse(responseText);
}

/**
 * Costruisce il prompt completo per la generazione del listing
 */
function buildFullPrompt(product, keywords = []) {
  return `Sei un esperto copywriter specializzato in listing Amazon per il mercato italiano.

Devi creare un listing completo e ottimizzato per Amazon per questa stampa artistica su tela.

DATI DEL PRODOTTO:
- Titolo opera: ${product.titolo_opera}
- Autore: ${product.autore || 'N/D'}
- Dimensioni: ${product.dimensioni || 'N/D'}
- Tecnica: ${product.tecnica || 'Stampa su tela'}
- Descrizione originale: ${product.descrizione_raw || 'N/D'}
- Prezzo: ${product.prezzo ? `€${product.prezzo}` : 'N/D'}
${keywordsBlock(keywords)}
OBIETTIVO: Creare contenuti che convincano un acquirente italiano ad acquistare questa stampa artistica su tela su Amazon.

REGOLE SPECIFICHE:

TITOLO (max 200 caratteri):
- Includi: tipo prodotto, titolo opera, autore, dimensioni se disponibili
- Formato: [Stampa su Tela] - [Titolo Opera] di [Autore] - [Dimensioni] - [Caratteristica chiave]
- Ottimizzato per ricerche Amazon italiane

BULLET POINTS (5 punti, max 500 caratteri ciascuno):
- Inizia ogni bullet con una keyword in MAIUSCOLO seguita da " – "
- bp1: Qualità e materiali della stampa
- bp2: Fedeltà riproduzione e dettagli artistici
- bp3: Utilizzi decorativi e ambienti consigliati
- bp4: Valore artistico e informazioni sull'opera/autore
- bp5: Informazioni pratiche (spedizione, montaggio, confezione)

DESCRIZIONE (200-2000 caratteri):
- Racconta la storia dell'opera
- Descrivi l'effetto visivo e l'atmosfera
- Spiega i possibili utilizzi decorativi
- Includi informazioni tecniche
- Termina con invito all'acquisto
- Linguaggio caldo ed evocativo

PAROLE CHIAVE (stringa separata da virgole):
- 8-12 keyword rilevanti per la ricerca su Amazon
- Includi: tipo prodotto, soggetto, stile, utilizzo, autore
- Varianti e sinonimi utili

Rispondi SOLO con un JSON valido nel seguente formato, senza testo aggiuntivo prima o dopo:
{
  "titolo": "...",
  "bp1": "...",
  "bp2": "...",
  "bp3": "...",
  "bp4": "...",
  "bp5": "...",
  "descrizione": "...",
  "parole_chiave": "..."
}`;
}

/**
 * Estrae e parsa la risposta JSON di Claude
 */
function parseJsonResponse(text) {
  // Cerca il JSON nella risposta (Claude a volte aggiunge testo prima/dopo)
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

module.exports = {
  generateFullListing,
  regenerateTitle,
  regenerateBulletPoints,
  regenerateDescription
};
