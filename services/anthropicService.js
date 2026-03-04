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
    ? `\nKEYWORD REALI CERCATE SU AMAZON.IT — usa queste dove naturale:\n${keywords.slice(0, 20).join(', ')}\n`
    : '';

  const prompt = `Sei un esperto di listing Amazon per il mercato italiano, specializzato in arte e decorazione.

Il tuo compito è analizzare il testo di un'opera d'arte e generare TUTTI gli attributi necessari per un listing Amazon ottimizzato per stampe su tela.

TESTO DELL'OPERA:
"""
${product.descrizione_raw || 'Nessuna descrizione fornita'}
"""
${product.dimensioni ? `\nDIMENSIONI: ${product.dimensioni}` : ''}
${product.autore ? `\nAUTORE: ${product.autore}` : ''}
${product.tecnica ? `\nTECNICA: ${product.tecnica}` : ''}
${keywordsSection}

ISTRUZIONI:
- Analizza il testo e comprendi il soggetto, lo stile e il contesto dell'opera
- Genera contenuti SEO ottimizzati per Amazon Italia
- Tutti i campi DEVONO essere in ITALIANO
- Per "Chiavi di ricerca": stringa di 5-8 keyword separata da virgole (non troppo lunga)
- Per "Punto elenco": inizia con una keyword in MAIUSCOLO seguita da " – "
- Per "Nome dell'articolo": max 200 caratteri, formato: Stampa su Tela - [Titolo] di [Autore] - [Dimensioni] - [Caratteristica
- Per "Personaggio rappresentato": se non applicabile, scrivi "N/D"

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
  "Stagioni": "...",
  "Utilizzo in ambienti interni ed esterni": "...",
  "forma decorazione da parete": "..."
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

  const guideMap = {
    "Nome dell'articolo": 'max 200 caratteri, formato: Stampa su Tela - [Titolo Opera] di [Autore] - [Dimensioni]',
    "Nome del modello": 'breve nome identificativo dell\'opera (es. "La Notte Stellata - Van Gogh")',
    "Descrizione del prodotto": '200-2000 caratteri, racconta l\'opera e suggerisce utilizzi decorativi',
    "Punto elenco 1": 'inizia con keyword MAIUSCOLA – qualità della stampa',
    "Punto elenco 2": 'inizia con keyword MAIUSCOLA – fedeltà riproduzione',
    "Punto elenco 3": 'inizia con keyword MAIUSCOLA – utilizzi decorativi',
    "Punto elenco 4": 'inizia con keyword MAIUSCOLA – valore artistico',
    "Punto elenco 5": 'inizia con keyword MAIUSCOLA – info pratiche (montaggio, confezione)',
    "Chiavi di ricerca": '5-8 keyword separate da virgole, ottimizzate Amazon',
    "Stile": 'stile artistico (es. Impressionismo, Arte moderna, Astratto...)',
    "Tema": 'tema dell\'opera (es. Natura, Ritratto, Paesaggio...)',
    "Tipo di stanza": 'ambienti consigliati (es. Salotto, Camera, Ufficio...)',
    "Famiglia di colori": 'palette dominante (es. Blu e verde, Caldi, Pastello...)',
    "Colore": 'colori principali dell\'opera',
    "Motivo": 'motivo decorativo (es. Floreale, Astratto, Geometrico...)',
  };

  const guide = guideMap[nomeAttributo] || 'campo testo libero per listing Amazon Italia';

  const prompt = `Sei un esperto di listing Amazon per il mercato italiano.

Rigenera SOLO il campo "${nomeAttributo}" per questa stampa artistica su tela.

TESTO DELL'OPERA:
"""
${product.descrizione_raw || 'Nessuna descrizione'}
"""
${product.dimensioni ? `\nDIMENSIONI: ${product.dimensioni}` : ''}
${product.autore ? `\nAUTORE: ${product.autore}` : ''}

VALORE ATTUALE:
${currentValue || 'Non presente'}
${keywordsSection}
GUIDA: ${guide}

Rispondi SOLO con un JSON: {"${nomeAttributo}": "il nuovo valore"}`;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });

  return parseJsonResponse(message.content[0].text);
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

module.exports = { generateAllAiAttributes, regenerateSingleAttribute };
