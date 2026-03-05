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

### NOME DELL'ARTICOLO (max 200 caratteri):
- Inizia con la keyword principale più cercata dagli acquirenti (es. "Quadro Moderno", "Stampa Arte", "Quadro Soggiorno")
- Poi segue: [Soggetto] - Stampa su Tela [Dimensioni] - [Caratteristica distintiva]
- NON iniziare genericamente con "Stampa su Tela" — metti la keyword ad alto volume subito

### DESCRIZIONE DEL PRODOTTO (200-2000 caratteri):
- Racconta l'opera con linguaggio evocativo
- Suggerisci contesti d'uso e destinatari
- Se il testo menziona misure/taglie alternative (es. "disponibile in tre misure: X, Y, Z"), RIPORTALE esplicitamente alla fine della descrizione con una frase tipo: "Disponibile nelle misure: [misure]."
- Chiudi sempre con una frase che invita all'acquisto

### CHIAVI DI RICERCA (campo backend Amazon):
- NON ripetere parole già presenti nel Nome dell'articolo
- Includi sinonimi, varianti di ricerca, contesti d'uso
- Sfrutta al massimo i 250 caratteri disponibili — la stringa deve essere LUNGA
- Formato: keyword1, keyword2, keyword3, ... (virgola + spazio tra le keyword)
- Almeno 8-12 keyword diverse

### PUNTI ELENCO:
- Inizia ogni punto con una keyword in MAIUSCOLO seguita da " – "
- Punto elenco 1: qualità e caratteristiche della stampa
- Punto elenco 2: palette cromatica e impatto visivo
- Punto elenco 3: processo artigianale (ritocchi, fissativo, ecc.)
- Punto elenco 4: info pratiche (dimensioni, telaio, pronta da appendere)
- Punto elenco 5: garanzia e acquisto sicuro — esempio: "ACQUISTO SICURO – Sivigliart garantisce imballaggio protettivo e reso gratuito entro 30 giorni. Ogni opera è accuratamente verificata prima della spedizione"

### ALTRI CAMPI:
- "Personaggio rappresentato": se non applicabile, scrivi "N/D"
- "Colore": elenca i colori principali separati da virgola
- "Stile": stile artistico
- "Tema": tema dell'opera
- "Tipo di stanza": ambienti consigliati separati da virgola
- "Usi consigliati per il prodotto": usi pratici separati da virgola

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
    "Nome dell'articolo": `max 200 caratteri. IMPORTANTE: inizia con la keyword principale più cercata (es. "Quadro Moderno", "Stampa Arte", "Quadro Soggiorno") — NON iniziare con "Stampa su Tela". Poi: [Soggetto] - Stampa su Tela [Dimensioni] - [Caratteristica].`,
    "Nome del modello": 'breve nome identificativo dell\'opera (es. "La Notte Stellata - Van Gogh")',
    "Descrizione del prodotto": `200-2000 caratteri. Racconta l'opera con linguaggio evocativo, suggerisci contesti d'uso. Se il testo menziona misure alternative (es. "disponibile in tre misure"), RIPORTALE esplicitamente alla fine con "Disponibile nelle misure: X, Y, Z." Chiudi con frase che invita all'acquisto.`,
    "Punto elenco 1": 'inizia con keyword MAIUSCOLA – qualità e caratteristiche della stampa',
    "Punto elenco 2": 'inizia con keyword MAIUSCOLA – palette cromatica e impatto visivo',
    "Punto elenco 3": 'inizia con keyword MAIUSCOLA – processo artigianale (ritocchi acrilici, fissativo)',
    "Punto elenco 4": 'inizia con keyword MAIUSCOLA – info pratiche (dimensioni, telaio, pronta da appendere)',
    "Punto elenco 5": 'inizia con "ACQUISTO SICURO –" e menziona garanzia Sivigliart, imballaggio protettivo, reso entro 30 giorni',
    "Chiavi di ricerca": `NON ripetere parole già nel titolo. Includi sinonimi, varianti, contesti d'uso. Sfrutta al massimo i 250 caratteri. Formato: keyword1, keyword2, keyword3, ... Almeno 8-12 keyword diverse.`,
    "Stile": 'stile artistico (es. Impressionismo, Arte moderna, Astratto, Figurativo...)',
    "Tema": 'tema dell\'opera (es. Natura, Ritratto, Paesaggio, Astratto...)',
    "Tipo di stanza": 'ambienti consigliati separati da virgola (es. Salotto, Camera, Ufficio...)',
    "Famiglia di colori": 'palette dominante (es. Blu e verde, Caldi, Pastello, Multicolore...)',
    "Colore": 'colori principali dell\'opera separati da virgola',
    "Motivo": 'motivo decorativo (es. Floreale, Astratto, Geometrico, Figurativo...)',
    "Usi consigliati per il prodotto": 'usi pratici separati da virgola (es. Decorazione parete, Regalo, Arredamento...)',
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
