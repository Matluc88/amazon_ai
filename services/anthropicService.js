const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── POOL SEO STANZE ──────────────────────────────────────────────────────
// 6 frasi SEO validate su Cerebro IT — solo keyword con volume reale.
// Ufficio/Studio/Ingresso/Corridoio ELIMINATI (volume = 0 su Amazon.it).
// Volumi da Cerebro 2026-03-20.
const ROOM_POOL = [
  'Quadri Moderni Soggiorno e Camera da Letto',  // vol ~51K — quadri moderni soggiorno (40K) + camera da letto (10.9K)
  'Quadri Camera da Letto e Soggiorno',           // vol ~11K — quadri camera da letto (anti-cannibalizzazione)
  'Quadri Moderni Soggiorno Grandi',              // vol ~934  — quadri moderni soggiorno grandi
  'Decorazioni Parete Soggiorno e Salotto',       // vol ~960  — decorazioni parete soggiorno (643) + quadri salotto (316)
  'Quadri Salotto e Camera da Letto',             // vol ~316  — quadri salotto
  'Decorazioni Parete Camera da Letto'            // vol ~6.5K — decorazioni parete (4.1K) + decorazioni camera da letto (2.4K)
];
// ───────────────────────────────────────────────────────────────────────────

/**
 * Costruisce il contenuto del messaggio Claude con o senza immagine.
 * Se imageUrl è valido, invia immagine + testo (Vision AI).
 * Altrimenti invia solo testo (comportamento precedente).
 *
 * @param {string} prompt    - Testo del prompt
 * @param {string|null} imageUrl - URL immagine Cloudinary (opzionale)
 * @returns {string|Array}   - Formato compatibile con Claude messages API
 */
function buildMessageContent(prompt, imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
    return prompt; // solo testo (backward compat)
  }
  return [
    {
      type: 'image',
      source: {
        type: 'url',
        url: imageUrl
      }
    },
    {
      type: 'text',
      text: prompt
    }
  ];
}

/**
 * Restituisce il primo URL immagine valido disponibile per un prodotto.
 * Prova in ordine: immagine_max → immagine_media → immagine_mini.
 *
 * @param {object} product
 * @returns {string|null}
 */
function getProductImageUrl(product) {
  const candidates = [
    product.immagine_max,
    product.immagine_media,
    product.immagine_mini,
    product.immagine_max_2,
  ];
  for (const url of candidates) {
    if (url && typeof url === 'string' && url.startsWith('http')) return url;
  }
  return null;
}

/**
 * Calcola orientamento e restituisce la stringa base×altezza già nello
 * stesso formato in cui le misure sono salvate nel DB (dopo swapDimensions).
 * Non importa da attributeService per evitare dipendenza circolare.
 *
 * @param {string} misuraStr  es. "130x90" (base×altezza, già swappato)
 * @returns {{ orientamento: string, display: string } | null}
 */
function calcOrientamento(misuraStr) {
  if (!misuraStr) return null;
  const m = misuraStr.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const a = Math.round(parseFloat(m[1].replace(',', '.')));
  const b = Math.round(parseFloat(m[2].replace(',', '.')));
  if (isNaN(a) || isNaN(b)) return null;
  const orientamento = a > b ? 'Orizzontale' : a < b ? 'Verticale' : 'Quadrato';
  return { orientamento, display: `${a}x${b}` };
}

/**
 * Genera TUTTI gli attributi AI in una singola chiamata Claude.
 * Se il prodotto ha un'immagine Cloudinary, la invia a Claude (Vision AI)
 * per un'analisi visiva precisa di soggetti, colori, personaggi e animali.
 *
 * @param {object} product - dati del prodotto (descrizione_raw, dimensioni, ecc.)
 * @param {string[]} keywords - keyword minate da Amazon (opzionale)
 * @returns {object} - { "Nome dell'articolo": "...", "Punto elenco 1": "...", ... }
 */
async function generateAllAiAttributes(product, keywords = [], cerebroSection = '') {
  const imageUrl = getProductImageUrl(product);
  // ⚠️ Autore con fallback — evita che Claude usi il titolo dell'opera come nome artista
  const autore = (product.autore && product.autore.trim()) ? product.autore.trim() : 'Alessandro Siviglia';

  // stableKey usato per smartTruncateTitle (log)
  const stableKey = product.sku_max || product.sku_media || product.sku_mini || String(product.id || 0);

  const keywordsSection = keywords.length > 0
    ? `\nKEYWORD REALI CERCATE SU AMAZON.IT — usa queste dove naturale (NON ripeterle nel titolo se già presenti):\n${keywords.slice(0, 20).join(', ')}\n`
    : '';

  const cerebroSectionText = cerebroSection ? `\n${cerebroSection}\n` : '';

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

  // Orientamento e formato dimensioni (base×altezza)
  const oriCalc = calcOrientamento(product.misura_max || product.dimensioni || '');
  const formatoSection = oriCalc
    ? `\n⚠️ FORMATO ARTWORK: ${oriCalc.orientamento.toUpperCase()} — Le dimensioni nel DB sono BASE×ALTEZZA (es. "${oriCalc.display}" = base ${oriCalc.display.split('x')[0]} cm × altezza ${oriCalc.display.split('x')[1]} cm). Nelle Chiavi di ricerca usa SEMPRE questo ordine (base×altezza) e indica il formato ${oriCalc.orientamento.toLowerCase()} corretto.`
    : '';

  // Nota per il prompt: informa Claude che sta vedendo l'immagine se disponibile
  const visionNote = imageUrl
    ? '\n🖼️ ANALISI VISIVA: Ti viene fornita anche l\'immagine dell\'opera. Usala come fonte primaria per determinare: soggetti presenti (personaggi, animali), colori dominanti reali, stile artistico, composizione. I campi "Personaggio rappresentato", "Tema animali", "Colore", "Famiglia di colori" e "Stile" devono basarsi principalmente sull\'analisi visiva dell\'immagine.\n'
    : '';

  const prompt = `Sei un esperto di listing Amazon per il mercato italiano, specializzato in arte e decorazione.

Il tuo compito è analizzare${imageUrl ? ' l\'immagine e' : ''} il testo di un'opera d'arte e generare TUTTI gli attributi necessari per un listing Amazon ottimizzato per stampe su tela.
${visionNote}
TESTO DELL'OPERA:
"""
${product.descrizione_raw || 'Nessuna descrizione fornita'}
"""
${product.dimensioni ? `\nDIMENSIONI (taglia grande): ${product.dimensioni}` : ''}

AUTORE DELL'OPERA: ${autore}
⚠️ CRITICO — NON CONFONDERE: "${autore}" è il NOME DELL'ARTISTA. Il titolo dell'opera (es. "${product.titolo_opera || product.descrizione_raw?.split('\n')[0]?.slice(0, 40) || ''}") è il TITOLO, non l'autore. Usa SEMPRE e SOLO "${autore}" dove richiesto il nome dell'artista/autore.
${product.tecnica ? `\nTECNICA: ${product.tecnica}` : ''}
${variantiSection}
${keywordsSection}${cerebroSectionText}

ISTRUZIONI:
- Analizza il testo e comprendi il soggetto, lo stile e il contesto dell'opera
- Genera contenuti SEO ottimizzati per Amazon Italia, algoritmo A9
- Tutti i campi DEVONO essere in ITALIANO
- ⚠️ REGOLA CRITICA — AMAZON POLICY: VIETATO TASSATIVO in qualsiasi campo generato: "contenuti per adulti", "per adulti", "adult", "erotico", "sensuale", "intimo", "sexy", "piccante" o qualsiasi termine che Amazon potrebbe classificare come adult content. Opere con soggetti romantici (baci, coppie, abbracci, figure nude artistiche): usa ESCLUSIVAMENTE termini come "romantico", "coppia", "amore", "sentimentale", "passione artistica", "arte figurativa". Violare questa regola causa la sospensione del listing su Amazon.

### NOME DELL'ARTICOLO (Amazon - Titolo):
Obiettivo: titolo CTR-first + SEO, leggibile su mobile, italiano naturale senza keyword stuffing.
Range TARGET: 150–180 caratteri. MAI oltre 200. Mira ai 160–170.

⚠️ REGOLA CRITICA — PRIMA PAROLA: Il titolo DEVE INIZIARE SEMPRE con "Quadro".
VIETATO ASSOLUTO: iniziare con "Stampa", "Arte", "Sivigliart" o qualsiasi altra parola diversa da "Quadro".

Dopo "Quadro", scegli il TIPO più appropriato analizzando l'opera (immagine + testo).
⚠️ I TIPI sono basati su volumi reali Cerebro Amazon.it — usa SOLO questi:

- "Quadro Moderno" → opere moderne generiche, figurative, ritratti, soggetti contemporanei (vol: 2.067)
- "Quadro Mare" → paesaggi marini, costieri, oceano, barche, spiagge, porti (vol: 947)
- "Quadro Astratto" → opere astratte, geometriche, non figurative, minimal (vol: 723)
- "Quadro Paesaggio" → paesaggi NON marini: campagna, montagna, boschi, città, fiumi (vol: 102)
- "Quadro Amore" → scene d'amore, coppie, baci, abbracci, sentimenti romantici (vol: 100)
- "Quadro Pop Art" → stile pop, street art, colori saturi e netti, warhol-style (vol: 58)
- "Quadro Romantico" → scene sentimentali, coppie in contesti romantici (alternativa a Amore) (vol: 54)
- "Quadro Famiglia" → soggetti familiari, bambini con genitori, scene domestiche (vol: 23)
- ⚠️ TIPI ELIMINATI (volume 0 su Amazon.it — NON usarli): "Quadro Sacro", "Quadro Animali", "Quadro Naif", "Quadro Contemporaneo", "Quadro Figurativo Moderno", "Quadro Astratto Moderno"
  → Per soggetti religiosi (Madonna, Santi, ecc.): usa "Quadro Moderno" o direttamente "Quadro" + soggetto (es. "Quadro Madonna con Bambino in Gloria")
  → Per animali: usa "Quadro Moderno" + soggetto animale (es. "Quadro Moderno Leone in Savana al Tramonto")
  → Per stile naif: usa "Quadro Moderno" + soggetto

⚠️ KEYWORD SEO — scegli la frase più coerente con il tipo dell'opera identificato sopra:

FRASI SEO DISPONIBILI — validate su Cerebro IT (inseriscine UNA, copiandola ESATTAMENTE):
- "Quadri Moderni Soggiorno e Camera da Letto"  → per: Quadro Moderno, Quadro Mare, Quadro Famiglia (vol ~51K)
- "Quadri Camera da Letto e Soggiorno"          → per: Quadro Amore, Quadro Romantico (vol ~11K)
- "Quadri Moderni Soggiorno Grandi"             → per: Quadro Astratto, Quadro Moderno (alternativa per grandi formati) (vol ~934)
- "Decorazioni Parete Soggiorno e Salotto"      → per: Quadro Paesaggio, Quadro Pop Art, Quadro + soggetto diretto (vol ~960)
- "Quadri Salotto e Camera da Letto"            → per: Quadro Paesaggio (alt), Quadro Pop Art (alt), Quadro + soggetto (vol ~316)
- "Decorazioni Parete Camera da Letto"          → per: Quadro Amore (alt), soggetti senza tipo con volume (religioso, animali, naif) (vol ~6.5K)

Scegli la frase più adatta al tipo dell'opera che hai identificato sopra. Copiala ESATTAMENTE, senza modifiche.

STRUTTURA OBBLIGATORIA (massimo 3 virgole interne):
"Quadro {tipo_scelto} {soggetto 2-5 parole}, {FRASE_SEO_SCELTA}, dai Colori {colore1} e {colore2}, Pronto da Appendere{DIMENSIONE}"

Dove:
- {tipo_scelto}: scegli DALL'ANALISI dell'opera tra i tipi elencati sopra (o ometti il tipo e usa solo soggetto diretto se il tipo non ha volume)
- {soggetto}: 2–5 parole specifiche e descrittive dell'opera
- {FRASE_SEO_SCELTA}: la frase scelta dalla lista sopra — copiala ESATTAMENTE
- {colore1} e {colore2}: i 2 colori principali, ogni parola Capitalizzata (es. "Turchese e Verde Petrolio", "Blu Notte e Oro")
- hasSizeVariants = ${hasSizeVariants}
- {DIMENSIONE}: se hasSizeVariants TRUE → niente; se FALSE → ", ${dimensioneSingle} cm" subito dopo "Pronto da Appendere"

⚠️ LUNGHEZZA: con questa struttura il titolo tende ad essere ~120-140 car. Aggiungi dettagli al soggetto per raggiungere 150-170 car. (es. "Coppia al Molo con Sassofono" invece di "Coppia al Molo").

VIETATO TASSATIVO:
- Iniziare con qualsiasi parola diversa da "Quadro" (vietato "Stampa", "Arte di", "Sivigliart", ecc.)
- Autore, artista o "Arte di [Autore]" nel titolo — il nome dell'autore NON va mai nel titolo
- Brand "Sivigliart" ovunque nel titolo
- ⚠️ Se nel testo dell'opera compare autore o brand, IGNORALI completamente nel titolo
- Keyword stuffing, MAIUSCOLO totale, parole vietate (migliore, premium, esclusivo, gratis)

ESEMPI CORRETTI con nuova struttura Cerebro-validated:
- "Quadro Moderno Madonna con Bambino in Gloria tra Angeli, Quadri Moderni Soggiorno e Camera da Letto, dai Colori Oro e Avorio, Pronto da Appendere" (154 car.)
- "Quadro Mare Tramonto sul Golfo con Barche e Riflessi, Quadri Moderni Soggiorno e Camera da Letto, dai Colori Arancio e Blu, Pronto da Appendere" (153 car.)
- "Quadro Amore Coppia in Abbraccio sotto la Luna Piena, Quadri Camera da Letto e Soggiorno, dai Colori Bordeaux e Oro, Pronto da Appendere" (144 car.)
- "Quadro Paesaggio Campagna Toscana con Cipressi al Tramonto, Decorazioni Parete Soggiorno e Salotto, dai Colori Verde e Oro, Pronto da Appendere" (149 car.)
- "Quadro Pop Art Ritratto Femminile con Colori Saturi, Decorazioni Parete Soggiorno e Salotto, dai Colori Giallo e Rosso, Pronto da Appendere" (144 car.)

Output: UNA sola riga di testo, senza virgolette esterne, senza spiegazioni.

### DESCRIZIONE DEL PRODOTTO (200-2000 caratteri):
⚠️ FORMATO TESTO PURO: il campo accetta SOLO testo normale — VIETATO TASSATIVO qualsiasi tag HTML (<b>, <br>, <p>, <div> o qualsiasi altro). Amazon mostrerebbe i tag come testo letterale ai clienti.

Struttura in 4 sezioni ben distinte, separate da " — " (spazio-trattino-spazio):

SEZIONE 1 — INTRO OPERA: La PRIMA FRASE deve essere SEMPRE (nome già inserito — NON modificarlo): "Quadro che riproduce un'opera originale dell'artista ${autore}." (usa "dell'artista", NON "dipinto dall'artista"). Continua con una prima impressione evocativa dell'opera.

SEZIONE 2 — STILE, COLORI ED EMOZIONI: Descrivi lo stile artistico, i colori predominanti e le emozioni che l'opera trasmette. Usa aggettivi vividi e specifici per evidenziare i colori chiave (es. "i toni caldi dell'oro e del bordeaux dominano la composizione").

SEZIONE 3 — CONTESTI D'USO: Suggerisci i contesti abitativi ideali, il tipo di arredamento che si abbina e il destinatario ideale (es. "ideale per il soggiorno moderno o la camera da letto").

SEZIONE 4 — MISURE + CTA: ⚠️ Se il prodotto ha varianti di taglia (sezione VARIANTI DISPONIBILI presente nel prompt), DEVI iniziare questa sezione con la frase esatta: "Disponibile nelle misure: [misura_mini], [misura_media], [misura_max] cm." — usa i valori reali delle varianti. Chiudi con una frase che invita all'acquisto.

REGOLE TECNICHE OBBLIGATORIE:
- VIETATO: "dipinto", "tela dipinta", "quadro dipinto" come attributo del prodotto
- VIETATO nel corpo: "dipinto da ${autore}", "quadro di ${autore}", "opera di ${autore}" — usa SEMPRE "quadro che riproduce l'opera originale di ${autore}"
- Testo fluente e leggibile, senza simboli speciali o punteggiatura eccessiva

### CHIAVI DI RICERCA (campo backend Search Terms — 5 slot da 250 byte UTF-8 ciascuno = 1250 byte totali):
${formatoSection}
Formato OBBLIGATORIO: SOLO SPAZI tra i termini — ZERO virgole, ZERO punteggiatura, ZERO trattini. Tutto minuscolo. SOLO ITALIANO — zero parole in inglese o altra lingua.
⚠️ TARGET LUNGHEZZA OBBLIGATORIO: genera ESATTAMENTE 1100–1200 byte UTF-8. Questo corrisponde a circa 160–190 parole italiane. Se non raggiungi 1100 byte il campo NON è compilato correttamente.

⚠️ REGOLA CEREBRO OBBLIGATORIA — INIZIA DA QUI:
Se sono presenti keyword Cerebro nel prompt (sezione "KEYWORD REALI DA HELIUM 10 CEREBRO"), le keyword del tier BACKEND e BULLET devono essere TUTTE incluse nelle chiavi di ricerca. Queste keyword hanno volumi di ricerca reali validati — DEVONO comparire nel backend. Esempio obbligatorio: se ci sono "quadri moderni soggiorno", "quadri camera da letto", "stampa su tela", "quadretti da parete" tra le keyword Cerebro, inseriscile TUTTE. Sono come i clienti cercano qualsiasi quadro su Amazon, non sono duplicati inutili.

⚠️ REGOLA DUPLICATI (applicazione limitata):
La regola "zero duplicati" si applica SOLO a parole inventate generiche, NON alle keyword Cerebro. Le keyword Cerebro devono essere inserite nel backend ANCHE SE parole simili compaiono nel titolo.

STRUTTURA A 5 AREE COMPLEMENTARI — OGNUNA DEVE ESSERE AMPIA E DETTAGLIATA:

AREA 0 — KEYWORD CEREBRO (OBBLIGATORIA — inserisci TUTTE le keyword Cerebro tier BACKEND e BULLET):
Copia qui TUTTE le keyword Cerebro del tier backend e bullet ricevute nel prompt. Non saltarne nessuna.
Esempio: quadri moderni soggiorno quadro moderno soggiorno quadri camera da letto stampa su tela quadretti da parete decorazione da parete decorazioni camera da letto...

AREA 1 — SINONIMI E VARIANTI DEL PRODOTTO (almeno 20 termini diversi):
Tutti i modi in cui i clienti italiani cercano stampe/quadri su Amazon.it. Sii esaustivo.
es. poster pittura dipinto illustrazione arte tela arredamento decorazione casa parete muro cornice regalo anniversario

AREA 2 — SOGGETTO SPECIFICO (almeno 25 parole — varianti, sinonimi, dettagli visivi dell'opera):
Tutte le varianti possibili del soggetto, personaggi, azioni, elementi visivi dell'opera.
es. se c'è un circo → circo artisti giocolieri clown pagliaccio tendone acrobati funamboli saltimbanchi spettacolo festival divertimento

AREA 3 — STILE E TECNICA ARTISTICA (almeno 15 parole diverse):
Tutte le correnti artistiche, tecniche, aggettivi stilistici non già nel titolo.
es. figurativo astratto contemporaneo moderno naif pop realistico impressionista espressionista surrealista cubista pittura italiana vivaci

AREA 4 — AMBIENTI E CONTESTI D'USO (almeno 20 parole — tutti gli ambienti non già nelle keyword Cerebro):
Ogni possibile stanza, ambiente, luogo dove l'opera può essere appesa, non già coperto dalle keyword Cerebro.
es. ingresso corridoio scala anticamera bagno terrazzo balcone mansarda hotel ristorante bar ufficio medico ambulatorio reception albergo cantina

AREA 5 — OCCASIONI REGALO E LONG-TAIL (almeno 30 parole — frasi di ricerca con intento d'acquisto):
Tutte le occasioni regalo e frasi di acquisto specifiche.
es. regalo laurea regalo festa mamma regalo compleanno fidanzata regalo nozze anniversario matrimonio inaugurazione casa regalo natale capodanno pasqua san valentino festa papa regalo amica regalo coppia pensionamento

REGOLE CRITICHE:
- SOLO ITALIANO — ZERO parole in inglese (non wall art, non canvas, non art, non gift, non home decor)
- NON includere: il brand "sivigliart"
- NON includere: parole inutili come emozione, tenerezza, sentimento, poetico, evocativo
- Se ti mancano byte, aggiungi sinonimi, varianti di misura (centimetri grande piccolo medio), varianti tipologiche
- VERIFICA FINALE: conta le parole — devono essere almeno 150. Se hai meno di 150 parole aggiungi sinonimi finché raggiungi il target.

### PUNTI ELENCO (Amazon li indicizza tutti — usa keyword secondarie qui):
⚠️ REGOLA TECNICA per TUTTI i bullet: questo prodotto è una STAMPA SU TELA — NON un dipinto a mano.
VIETATO in qualsiasi bullet: "dipinto", "tela dipinta", "quadro dipinto" come attributo del prodotto.
Max 220 caratteri per bullet (leggibilità mobile). NON fare keyword stuffing.

Segui ESATTAMENTE questo schema a 5 punti ottimizzati per conversione:

- Punto elenco 1 — MATERIALE: usa QUESTA formulazione ESATTA (il nome è già inserito — NON cambiarlo con il titolo dell'opera):
  "STAMPA SU TELA CANVAS – Riproduzione su tela dell'opera originale dell'artista ${autore}, montata su telaio in legno e pronta da appendere."
  ("${autore}" è il NOME DELL'ARTISTA — non confonderlo con il titolo dell'opera)
- ⚠️ La formulazione "Riproduzione su tela dell'opera originale dell'artista ${autore}" deve comparire SOLO nel Punto elenco 1 — NON nei bullet 2-5
- Punto elenco 2 — STILE/ARTE: inizia con "ARTE [STILE] –" e descrivi l'opera, i colori dominanti, l'impatto visivo
- Punto elenco 3 — AMBIENTI: inizia con "DECORAZIONE PARETE –" e indica i contesti ideali (soggiorno, camera da letto, ufficio, studio, corridoio...)
- Punto elenco 4 — INSTALLAZIONE: inizia con "PRONTO DA APPENDERE –" e descrivi telaio in legno, ganci inclusi, misure disponibili. ⚠️ FINITURA: scrivi SEMPRE "fissativo laccato" — VIETATO scrivere "fissativo lucido", "lucidato" o qualsiasi altro termine alternativo.
- Punto elenco 5 — REGALO/GARANZIA: inizia con "IDEA REGALO –" menziona occasioni regalo (nascita, battesimo, anniversario, inaugurazione casa), imballaggio protettivo; chiudi SEMPRE con: "Reso entro 14 giorni secondo le condizioni Amazon."

### ALTRI CAMPI:
- "Personaggio rappresentato": analizza il soggetto dell'opera. Se è presente una figura umana o un personaggio riconoscibile, indicalo con 1-3 parole (es. "Coppia", "Musicista", "Bambino", "Famiglia", "Donna", "Ballerina", "Trombettista"). Se l'opera è paesaggistica, astratta o non ha figure umane/personaggi, scrivi "N/D"
- "Colore": se l'opera ha 1-2 colori dominanti elencali (es. "Arancione, Rosso"); se ha 3 o più colori usa "Multicolore" — Amazon lo gestisce meglio nei filtri di ricerca
- "Stile": stile artistico (es. "Cubista", "Impressionista", "Arte Moderna", "Astratto")
- "Tema": tema/i dell'opera separati da virgola (es. "Coppia romantica, Estate, Amore")
- "Tipo di stanza": scegli 3-4 stanze coerenti con il soggetto, separate da virgola. INIZIA SEMPRE con "Soggiorno". REGOLA OBBLIGATORIA: "Cameretta bambini", "Nursery", "Sala giochi", "Studio pediatrico", "Asilo nido" SOLO se soggetto esplicitamente infantile (bambini, animali cartoon, personaggi fantastici). Per soggetti adulti usa: Soggiorno, Camera da letto, Ufficio, Studio, Corridoio, Ingresso, Sala da pranzo.
- "Famiglia di colori": SCEGLI ESATTAMENTE UNO di questi valori (nessun altro valore è accettato): "Bianco" | "Bianco e nero" | "Caldi" | "Freddi" | "Luminosi" | "Neutro" | "Pastelli" | "Scala di grigi" | "Tonalità della terra" | "Toni gioiello". Scegli il valore che meglio descrive la palette dominante dell'opera.
- "Usi consigliati per il prodotto": usi pratici separati da virgola (es. "Decorazione parete, Regalo")
- "Tema animali": SOLO se il soggetto principale dell'opera è un animale, indicare il tipo (es. "Cane", "Gatto", "Cavallo", "Uccello", "Leone"). Se l'opera non rappresenta animali, scrivi "N/D"
- "Funzioni speciali": funzionalità fisiche del prodotto, separate da virgola. SCEGLI TRA: "Pronto da appendere", "Leggero", "Impermeabile", "Resistente agli strappi", "Senza cornice", "Con telaio in legno". Scrivi SEMPRE almeno "Pronto da appendere, Con telaio in legno".
- "Stagioni": indica la stagionalità dell'opera. SCEGLI ESATTAMENTE UNO di questi valori: "Tutte le stagioni" (per arte decorativa generica, astratta, figure, paesaggi senza connotazione stagionale specifica) | "Primavera" (soggetti primaverili: fiori in bud, rinascita) | "Estate" (soggetti estivi: mare, sole, colori caldi) | "Autunno" (foglie rosse/gialle, zucche, toni caldi-scuri) | "Inverno" (neve, freddo, natale). Per la stragrande maggioranza delle opere d'arte decorativa usa "Tutte le stagioni".
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
  "Tema animali": "..."
}`;

  if (imageUrl) {
    console.log(`[AI] Vision AI attiva per prodotto ${product.id || '?'} — immagine: ${imageUrl.slice(0, 60)}...`);
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: buildMessageContent(prompt, imageUrl) }]
  });

  const result = parseJsonResponse(message.content[0].text);

  // ─── Validazione lunghezza titolo post-generazione ──────────────────────
  if (result["Nome dell'articolo"]) {
    result["Nome dell'articolo"] = smartTruncateTitle(result["Nome dell'articolo"], stableKey);
  }
  // ─── Validazione byte Chiavi di ricerca post-generazione ────────────────
  if (result["Chiavi di ricerca"]) {
    result["Chiavi di ricerca"] = smartTruncateChiavi(result["Chiavi di ricerca"], stableKey);
  }
  // ────────────────────────────────────────────────────────────────────────

  return result;
}

/**
 * Rigenera un singolo attributo AI
 * @param {object} product
 * @param {string} nomeAttributo - es. "Punto elenco 1", "Descrizione del prodotto"
 * @param {string} currentValue - valore attuale
 * @param {string[]} keywords
 */
async function regenerateSingleAttribute(product, nomeAttributo, currentValue, keywords = [], cerebroSection = '') {
  const imageUrl = getProductImageUrl(product);
  // ⚠️ Autore con fallback — stesso pattern di generateAllAiAttributes
  const autore = (product.autore && product.autore.trim()) ? product.autore.trim() : 'Alessandro Siviglia';
  const keywordsSection = keywords.length > 0
    ? `\nKEYWORD REALI CERCATE SU AMAZON.IT:\n${keywords.slice(0, 20).join(', ')}\n`
    : '';
  const cerebroSectionText = cerebroSection ? `\n${cerebroSection}\n` : '';

  // Calcola misure varianti per la guida (se disponibili)
  const misureVarianti = (product.misura_mini && product.misura_media && product.misura_max)
    ? `${product.misura_mini}, ${product.misura_media}, ${product.misura_max} cm`
    : null;

  // stableKeyRegen usato per smartTruncateTitle (log)
  const stableKeyRegen = product.sku_max || product.sku_media || product.sku_mini || String(product.id || 0);

  // hasSizeVariants per regenerate (stessa logica di generateAllAiAttributes)
  const hasSizeVariantsRegen = typeof product.misura_max === 'string'
    ? product.misura_max.trim().length > 0 && product.misura_max.trim() !== '—'
    : Boolean(product.misura_max);
  const dimensioneSingleRegen = product.dimensioni || product.misura_max || '';

  // Orientamento per rigenera
  const oriCalcRegen = calcOrientamento(product.misura_max || product.dimensioni || '');
  const formatoInfoRegen = oriCalcRegen
    ? `\n⚠️ FORMATO ARTWORK: ${oriCalcRegen.orientamento.toUpperCase()} — dimensioni BASE×ALTEZZA: ${oriCalcRegen.display} cm. Usa SEMPRE questo ordine e questo orientamento.`
    : '';

  const guideMap = {
    "Nome dell'articolo": `Titolo Amazon CTR-first + SEO. Range TARGET: 150–180 caratteri, MAI oltre 200.

⚠️ REGOLA CRITICA — PRIMA PAROLA: Il titolo DEVE INIZIARE SEMPRE con "Quadro".
VIETATO ASSOLUTO: iniziare con "Stampa", "Arte", "Sivigliart" o qualsiasi altra parola diversa da "Quadro".

Dopo "Quadro", scegli il TIPO più appropriato analizzando l'opera (immagine + testo).
⚠️ I TIPI sono basati su volumi reali Cerebro Amazon.it — usa SOLO questi:

- "Quadro Moderno" → opere moderne generiche, figurative, ritratti, soggetti contemporanei (vol: 2.067)
- "Quadro Mare" → paesaggi marini, costieri, oceano, barche, spiagge, porti (vol: 947)
- "Quadro Astratto" → opere astratte, geometriche, non figurative, minimal (vol: 723)
- "Quadro Paesaggio" → paesaggi NON marini: campagna, montagna, boschi, città, fiumi (vol: 102)
- "Quadro Amore" → scene d'amore, coppie, baci, abbracci, sentimenti romantici (vol: 100)
- "Quadro Pop Art" → stile pop, street art, colori saturi e netti, warhol-style (vol: 58)
- "Quadro Romantico" → scene sentimentali, coppie in contesti romantici (alternativa a Amore) (vol: 54)
- "Quadro Famiglia" → soggetti familiari, bambini con genitori, scene domestiche (vol: 23)
- ⚠️ TIPI ELIMINATI (volume 0 su Amazon.it — NON usarli): "Quadro Sacro", "Quadro Animali", "Quadro Naif", "Quadro Contemporaneo", "Quadro Figurativo Moderno", "Quadro Astratto Moderno"
  → Per soggetti religiosi (Madonna, Santi, ecc.): usa "Quadro Moderno" o direttamente "Quadro" + soggetto (es. "Quadro Madonna con Bambino in Gloria")
  → Per animali: usa "Quadro Moderno" + soggetto animale (es. "Quadro Moderno Leone in Savana al Tramonto")
  → Per stile naif: usa "Quadro Moderno" + soggetto

⚠️ KEYWORD SEO — scegli la frase più coerente con il tipo dell'opera identificato sopra:

FRASI SEO DISPONIBILI — validate su Cerebro IT (inseriscine UNA, copiandola ESATTAMENTE):
- "Quadri Moderni Soggiorno e Camera da Letto"  → per: Quadro Moderno, Quadro Mare, Quadro Famiglia (vol ~51K)
- "Quadri Camera da Letto e Soggiorno"          → per: Quadro Amore, Quadro Romantico (vol ~11K)
- "Quadri Moderni Soggiorno Grandi"             → per: Quadro Astratto, Quadro Moderno (grandi formati) (vol ~934)
- "Decorazioni Parete Soggiorno e Salotto"      → per: Quadro Paesaggio, Quadro Pop Art, Quadro + soggetto diretto (vol ~960)
- "Quadri Salotto e Camera da Letto"            → per: Quadro Paesaggio (alt), Quadro Pop Art (alt) (vol ~316)
- "Decorazioni Parete Camera da Letto"          → per: Quadro Amore (alt), soggetti religiosi/animali/naif (vol ~6.5K)

Scegli la frase più adatta al tipo dell'opera che hai identificato sopra. Copiala ESATTAMENTE, senza modifiche.

STRUTTURA OBBLIGATORIA (massimo 3 virgole interne):
"Quadro {tipo_scelto} {soggetto 2-5 parole}, {FRASE_SEO_SCELTA}, dai Colori {colore1} e {colore2}, Pronto da Appendere{DIMENSIONE}"

Dove:
- {tipo_scelto}: scegli DALL'ANALISI dell'opera tra i tipi elencati sopra (o ometti il tipo per soggetti senza volume)
- {soggetto}: 2–5 parole specifiche e descrittive dell'opera
- {FRASE_SEO_SCELTA}: la frase scelta dalla lista sopra — copiala ESATTAMENTE
- {colore1} e {colore2}: i 2 colori principali, ogni parola Capitalizzata
- hasSizeVariants = ${hasSizeVariantsRegen}
- {DIMENSIONE}: se hasSizeVariants TRUE → niente; se FALSE → ", ${dimensioneSingleRegen} cm"

⚠️ LUNGHEZZA: con questa struttura il titolo tende ad essere ~120-140 car. Aggiungi dettagli al soggetto per raggiungere 150-170 car.

VIETATO TASSATIVO:
- Iniziare con qualsiasi parola diversa da "Quadro" (vietato "Stampa", "Arte di", "Sivigliart", ecc.)
- Autore, "Arte di [Autore]" o nome dell'artista nel titolo
- Brand "Sivigliart" ovunque nel titolo
- Se nel testo compare autore o brand, IGNORALI completamente
- Keyword stuffing, MAIUSCOLO totale, parole vietate (migliore, premium, esclusivo, gratis)

ESEMPI CORRETTI con struttura Cerebro-validated:
- "Quadro Moderno Madonna con Bambino in Gloria tra Angeli, Quadri Moderni Soggiorno e Camera da Letto, dai Colori Oro e Avorio, Pronto da Appendere" (154 car.)
- "Quadro Mare Tramonto sul Golfo con Barche e Riflessi, Quadri Moderni Soggiorno e Camera da Letto, dai Colori Arancio e Blu, Pronto da Appendere" (153 car.)
- "Quadro Amore Coppia in Abbraccio sotto la Luna Piena, Quadri Camera da Letto e Soggiorno, dai Colori Bordeaux e Oro, Pronto da Appendere" (144 car.)
- "Quadro Paesaggio Campagna Toscana con Cipressi al Tramonto, Decorazioni Parete Soggiorno e Salotto, dai Colori Verde e Oro, Pronto da Appendere" (149 car.)

Output: UNA sola riga di testo, senza virgolette esterne, senza spiegazioni.`,
    "Nome del modello": 'breve nome identificativo dell\'opera (es. "La Notte Stellata - Van Gogh")',
    "Descrizione del prodotto": `200-2000 caratteri.

⚠️ FORMATO TESTO PURO: il campo accetta SOLO testo normale — VIETATO TASSATIVO qualsiasi tag HTML (<b>, <br>, <p>, <div> o qualsiasi altro). Amazon mostrerebbe i tag come testo letterale ai clienti.

Struttura in 4 sezioni ben distinte, separate da " — " (spazio-trattino-spazio):

SEZIONE 1 — INTRO OPERA: La PRIMA FRASE deve essere SEMPRE (nome già inserito — NON cambiarlo): "Quadro che riproduce un'opera originale dell'artista ${autore}." (usa "dell'artista", NON "dipinto dall'artista"). Continua con una prima impressione evocativa dell'opera.

SEZIONE 2 — STILE, COLORI ED EMOZIONI: Descrivi lo stile artistico, i colori predominanti e le emozioni che l'opera trasmette. Usa aggettivi vividi e specifici per evidenziare i colori chiave.

SEZIONE 3 — CONTESTI D'USO: Suggerisci i contesti abitativi ideali, il tipo di arredamento che si abbina e il destinatario ideale (es. "ideale per il soggiorno moderno o la camera da letto").

SEZIONE 4 — MISURE + CTA: ⚠️ Se il prodotto ha varianti di taglia, DEVI iniziare con: "Disponibile nelle misure: ${misureVarianti || '[misura piccola], [misura media], [misura grande] cm'}." Chiudi con una frase che invita all'acquisto.

REGOLE: VIETATO "dipinto", "tela dipinta". VIETATO "dipinto da ${autore}", "opera di ${autore}" — usa SEMPRE "quadro che riproduce l'opera originale di ${autore}". Testo fluente senza simboli speciali o tag.`,
    "Punto elenco 1": `MATERIALE — usa QUESTA formulazione ESATTA (il nome è già inserito — NON cambiarlo con il titolo dell'opera): "STAMPA SU TELA CANVAS – Riproduzione su tela dell'opera originale dell'artista ${autore}, montata su telaio in legno e pronta da appendere." ("${autore}" è il NOME DELL'ARTISTA). VIETATO: "dipinto", "tela dipinta". ⚠️ NON usare questa formulazione negli altri bullet (2-5).`,
    "Punto elenco 2": 'STILE/ARTE — inizia con "ARTE [STILE] –" e descrivi l\'opera, i colori principali, l\'impatto visivo ed emotivo',
    "Punto elenco 3": 'AMBIENTI — inizia con "DECORAZIONE PARETE –" e indica tutti i contesti ideali: soggiorno, camera da letto, ufficio, studio, corridoio, cameretta...',
    "Punto elenco 4": 'INSTALLAZIONE — inizia con "PRONTO DA APPENDERE –" e descrivi: telaio in legno, ganci inclusi, misure disponibili (le 3 taglie). ⚠️ FINITURA: scrivi SEMPRE "fissativo laccato" — VIETATO scrivere "fissativo lucido", "lucidato" o qualsiasi altro termine alternativo.',
    "Punto elenco 5": 'REGALO/GARANZIA — inizia con "IDEA REGALO –" menziona: occasioni regalo (nascita, battesimo, anniversario, inaugurazione casa), imballaggio protettivo per spedizione sicura; chiudi SEMPRE con: "Reso entro 14 giorni secondo le condizioni Amazon."',
    "Chiavi di ricerca": `Campo backend Search Terms — 5 slot da 250 byte UTF-8 ciascuno = 1250 byte totali.
${formatoInfoRegen}
Formato OBBLIGATORIO: SOLO SPAZI tra i termini — ZERO virgole, ZERO punteggiatura, ZERO trattini. Tutto minuscolo. SOLO ITALIANO — zero parole in inglese o altra lingua.
⚠️ TARGET LUNGHEZZA OBBLIGATORIO: genera ESATTAMENTE 1100–1200 byte UTF-8. Questo corrisponde a circa 160–190 parole italiane. Se non raggiungi 1100 byte il campo NON è compilato correttamente.

⚠️ REGOLA FONDAMENTALE — ZERO DUPLICATI:
Amazon indicizza titolo, bullet e search terms come UN UNICO INSIEME. Ripetere nelle chiavi parole già presenti nel titolo o nei bullet è uno spreco di byte e NON migliora il ranking (Amazon ignora i duplicati). Usa SOLO parole che NON compaiono già nel Nome dell'articolo e nei Punti elenco.

STRUTTURA A 5 AREE COMPLEMENTARI — OGNUNA DEVE ESSERE AMPIA E DETTAGLIATA (tutte parole NUOVE, non già nel titolo/bullet):

AREA 1 — SINONIMI E VARIANTI DEL PRODOTTO (almeno 25 termini diversi):
Tutti i modi in cui i clienti italiani cercano stampe/quadri su Amazon.it. Sii esaustivo.
es. poster quadro pittura dipinto illustrazione arte tela arredamento decorazione casa parete muro cornice regalo anniversario

AREA 2 — SOGGETTO SPECIFICO (almeno 30 parole — varianti, sinonimi, dettagli visivi dell'opera):
Tutte le varianti possibili del soggetto, personaggi, azioni, elementi visivi dell'opera.
es. se c'è un circo → circo artisti giocolieri clown pagliaccio tendone acrobati funamboli saltimbanchi spettacolo festival divertimento

AREA 3 — STILE E TECNICA ARTISTICA (almeno 20 parole diverse):
Tutte le correnti artistiche, tecniche, aggettivi stilistici non già nel titolo.
es. figurativo astratto contemporaneo moderno naif pop realistico impressionista espressionista surrealista cubista pittura italiana vivaci

AREA 4 — AMBIENTI E CONTESTI D'USO (almeno 30 parole — tutti gli ambienti non nei bullet):
Ogni possibile stanza, ambiente, luogo dove l'opera può essere appesa.
es. ingresso corridoio scala anticamera cucina bagno terrazzo balcone mansarda hotel ristorante bar ufficio medico ambulatorio reception albergo cantina

AREA 5 — OCCASIONI REGALO E LONG-TAIL (almeno 40 parole — frasi di ricerca con intento d'acquisto):
Tutte le occasioni regalo e frasi di acquisto specifiche.
es. regalo laurea regalo festa mamma regalo compleanno fidanzata regalo nozze anniversario matrimonio inaugurazione casa regalo natale capodanno pasqua san valentino festa papa regalo amica regalo coppia pensionamento

REGOLE CRITICHE:
- SOLO ITALIANO — ZERO parole in inglese (non wall art, non canvas, non art, non gift, non home decor)
- NON includere: parole già nel titolo, parole già nei 5 bullet, il brand "sivigliart"
- NON includere: parole inutili come emozione, tenerezza, sentimento, poetico, evocativo
- Se ti mancano byte, aggiungi sinonimi, varianti di misura (centimetri grande piccolo medio), varianti tipologiche
- VERIFICA FINALE: conta le parole — devono essere almeno 150. Se hai meno di 150 parole aggiungi sinonimi finché raggiungi il target.

Output: UNA sola riga di testo, senza virgolette esterne.`,
    "Edizione": 'breve descrizione dell\'edizione artistica (es. "Stampa Artistica Moderna", "Edizione Limitata", "Prima Edizione")',
    "Stile": 'stile artistico (es. Impressionismo, Arte moderna, Astratto, Figurativo...)',
    "Tema": 'tema/i dell\'opera separati da virgola (es. Natura, Ritratto, Paesaggio, Astratto...)',
    "Tipo di stanza": 'Scegli 3-4 stanze coerenti con il soggetto, separate da virgola. INIZIA con "Soggiorno". REGOLA: "Cameretta bambini", "Nursery", "Sala giochi" SOLO per soggetti infantili (bambini, animali cartoon). Per soggetti adulti usa: Soggiorno, Camera da letto, Ufficio, Studio, Corridoio, Ingresso.',
    "Famiglia di colori": 'SCEGLI ESATTAMENTE UNO di questi valori (nessun altro valore è accettato): "Bianco" | "Bianco e nero" | "Caldi" | "Freddi" | "Luminosi" | "Neutro" | "Pastelli" | "Scala di grigi" | "Tonalità della terra" | "Toni gioiello". Scegli il valore che meglio descrive la palette dominante dell\'opera.',
    "Colore": 'colori principali dell\'opera separati da virgola',
    "Motivo": 'motivo decorativo (es. Floreale, Astratto, Geometrico, Figurativo...)',
    "Usi consigliati per il prodotto": 'usi pratici separati da virgola (es. Decorazione parete, Regalo, Arredamento...)',
    "Personaggio rappresentato": 'Analizza il soggetto dell\'opera. Se è presente una figura umana o un personaggio riconoscibile, indicalo con 1-3 parole (es. "Coppia", "Musicista", "Bambino", "Famiglia", "Donna", "Ballerina", "Trombettista"). Se l\'opera è paesaggistica, astratta o non contiene figure umane/personaggi, scrivi "N/D".',
    "Tema animali": 'SOLO se il soggetto principale dell\'opera è un animale: indicare il tipo (es. "Cane", "Gatto", "Cavallo", "Uccello", "Leone"). Se l\'opera non rappresenta animali, scrivi "N/D".',
    "Funzioni speciali": 'Funzionalità fisiche del prodotto, separate da virgola. SCEGLI TRA: "Pronto da appendere", "Leggero", "Impermeabile", "Resistente agli strappi", "Senza cornice", "Con telaio in legno". Scrivi SEMPRE almeno "Pronto da appendere, Con telaio in legno". Aggiungi "Leggero" se il peso è inferiore a 3 kg.',
    "Stagioni": 'SCEGLI ESATTAMENTE UNO di questi valori (nessun altro valore è accettato): "Tutte le stagioni" | "Primavera" | "Estate" | "Autunno" | "Inverno". Per la stragrande maggioranza delle opere d\'arte decorativa usa "Tutte le stagioni". Usa una stagione specifica SOLO se il soggetto è chiaramente stagionale (es. neve→Inverno, mare estivo→Estate, fiori primaverili→Primavera, foglie autunnali→Autunno).',
  };

  const guide = guideMap[nomeAttributo] || 'campo testo libero per listing Amazon Italia';

  const visionNoteRegen = imageUrl
    ? '\n🖼️ ANALISI VISIVA: Ti viene fornita anche l\'immagine dell\'opera. Usala come fonte primaria per determinare soggetti, colori, personaggi e animali presenti.\n'
    : '';

  const prompt = `Sei un esperto di listing Amazon per il mercato italiano, specializzato in arte e decorazione.

Rigenera SOLO il campo "${nomeAttributo}" per questa stampa artistica su tela.
${visionNoteRegen}
TESTO DELL'OPERA:
"""
${product.descrizione_raw || 'Nessuna descrizione'}
"""
${product.dimensioni ? `\nDIMENSIONI: ${product.dimensioni}` : ''}

AUTORE DELL'OPERA: ${autore}
⚠️ CRITICO — NON CONFONDERE: "${autore}" è il NOME DELL'ARTISTA, non il titolo dell'opera. Usa SEMPRE e SOLO "${autore}" dove richiesto il nome dell'artista/autore.
${product.tecnica ? `\nTECNICA: ${product.tecnica}` : ''}

VALORE ATTUALE (da migliorare):
${currentValue || 'Non presente'}
${keywordsSection}${cerebroSectionText}
⚠️ REGOLA CRITICA — AMAZON POLICY: VIETATO TASSATIVO in qualsiasi campo: "contenuti per adulti", "per adulti", "adult", "erotico", "sensuale", "intimo", "sexy" o qualsiasi termine che Amazon possa classificare come adult content. Per soggetti romantici (baci, coppie, abbracci): usa SOLO "romantico", "coppia", "amore", "sentimentale", "arte figurativa".

${formatoInfoRegen}
GUIDA SPECIFICA PER QUESTO CAMPO:
${guide}

Rispondi SOLO con un JSON: {"${nomeAttributo}": "il nuovo valore"}`;

  if (imageUrl) {
    console.log(`[AI] Vision AI attiva — rigenera "${nomeAttributo}" con immagine`);
  }

  // Le Chiavi di ricerca richiedono ~1200 byte di testo + wrapper JSON → servono più token
  const maxTokensRegen = nomeAttributo === 'Chiavi di ricerca' ? 3000 : 1000;

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: maxTokensRegen,
    messages: [{ role: 'user', content: buildMessageContent(prompt, imageUrl) }]
  });

  const regenResult = parseJsonResponse(message.content[0].text);

  // ─── Validazione lunghezza titolo (solo per la rigenerazione del titolo) ─
  if (nomeAttributo === "Nome dell'articolo" && regenResult[nomeAttributo]) {
    regenResult[nomeAttributo] = smartTruncateTitle(regenResult[nomeAttributo], stableKeyRegen);
  }
  // ─── Validazione byte Chiavi di ricerca (solo per la rigenerazione chiavi) ─
  if (nomeAttributo === 'Chiavi di ricerca' && regenResult[nomeAttributo]) {
    regenResult[nomeAttributo] = smartTruncateChiavi(regenResult[nomeAttributo], stableKeyRegen);
  }
  // ────────────────────────────────────────────────────────────────────────

  return regenResult;
}

/**
 * Genera keyword Amazon.it ottimizzate con Claude AI
 * Sostituisce il mining via Amazon autocomplete (bloccato per IP server)
 *
 * @param {object} product
 * @returns {string[]} array di keyword ordinate per rilevanza
 */
async function generateKeywordsWithAI(product) {
  const imageUrl = getProductImageUrl(product);
  const oriCalcKw = calcOrientamento(product.misura_max || product.dimensioni || '');
  const formatoKw = oriCalcKw
    ? `- Formato: ${oriCalcKw.orientamento} (dimensioni BASE×ALTEZZA: ${oriCalcKw.display} cm) — usa questo ordine e questo orientamento nelle keyword con dimensioni`
    : '';

  const visionNoteKw = imageUrl
    ? '\n🖼️ ANALISI VISIVA: Ti viene fornita anche l\'immagine dell\'opera. Usala per identificare con precisione: soggetti, colori dominanti, stile, elementi caratteristici — e genera keyword coerenti con ciò che si vede.\n'
    : '';

  const prompt = `Sei un esperto SEO per Amazon Italia (marketplace IT), specializzato in arte e decorazione.

Analizza questo prodotto${imageUrl ? ' (testo + immagine)' : ''} e genera le migliori keyword di ricerca che i clienti italiani userebbero su Amazon.it per trovarlo.
${visionNoteKw}
PRODOTTO:
- Opera: ${product.titolo_opera || ''}
- Autore: ${product.autore || ''}
- Dimensioni: ${product.dimensioni || product.misura_max || ''}
${formatoKw}
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

  if (imageUrl) {
    console.log(`[AI] Vision AI attiva — keyword generation con immagine`);
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: buildMessageContent(prompt, imageUrl) }]
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
 * Smart truncation delle Chiavi di ricerca Amazon.
 * Amazon accetta max 1250 byte UTF-8 totali (5 slot × 250 byte).
 * Tronca all'ultimo spazio prima di 1200 byte (margine di sicurezza).
 *
 * @param {string} chiavi     - Chiavi di ricerca generate da Claude
 * @param {string} stableKey  - SKU o ID del prodotto (per il log)
 * @returns {string}          - Chiavi entro 1200 byte UTF-8
 */
function smartTruncateChiavi(chiavi, stableKey) {
  if (!chiavi) return chiavi;
  const MAX_BYTES = 1200;
  const currentBytes = Buffer.byteLength(chiavi, 'utf8');
  if (currentBytes <= MAX_BYTES) return chiavi;

  // Tronca al byte limit, poi cerca l'ultimo spazio
  let truncated = Buffer.from(chiavi, 'utf8').slice(0, MAX_BYTES).toString('utf8');
  truncated = truncated.replace(/\uFFFD/g, ''); // rimuove caratteri UTF-8 spezzati
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > MAX_BYTES * 0.7) {
    truncated = truncated.slice(0, lastSpace).trim();
  } else {
    truncated = truncated.trim();
  }

  console.warn(`[AI] ⚠️ Chiavi TRONCATE [${stableKey}]: ${currentBytes} → ${Buffer.byteLength(truncated, 'utf8')} byte`);
  return truncated;
}

/**
 * Smart truncation del titolo Amazon.
 * Applica la chain: ultima virgola → ultimo spazio → taglio secco a 200 + trim().
 * Logga warning se il titolo era oltre limite (> 200) o in zona gialla (181-200).
 *
 * @param {string} title      - Titolo generato da Claude
 * @param {string} stableKey  - SKU o ID del prodotto (per il log)
 * @returns {string}          - Titolo entro 200 caratteri
 */
function smartTruncateTitle(title, stableKey) {
  if (!title) return title;
  const len = title.length;

  if (len > 200) {
    // Fallback chain: virgola → spazio → taglio secco
    let cutAt = title.lastIndexOf(',', 199);   // ultima virgola entro 200
    if (cutAt < 100) {
      cutAt = title.lastIndexOf(' ', 199);     // ultimo spazio entro 200
    }
    const truncated = cutAt > 100
      ? title.slice(0, cutAt).trim()
      : title.slice(0, 200).trim();

    console.warn(`[AI] ⚠️ Titolo TRONCATO [${stableKey}]: ${len} → ${truncated.length} car. (taglio: ${cutAt > 100 ? (title[cutAt] === ',' ? 'virgola' : 'spazio') : 'secco'})`);
    return truncated;
  }

  if (len > 180) {
    console.info(`[AI] ℹ️ Titolo zona gialla [${stableKey}]: ${len} car. (target 150-180, max 200)`);
  }

  return title;
}

/**
 * Verifica l'orientamento di un'opera tramite analisi visiva AI (Claude Haiku).
 * Usa l'immagine come fonte di verità per determinare se l'opera è
 * Orizzontale, Verticale o Quadrata, indipendentemente dalle dimensioni nel DB.
 *
 * @param {string} imageUrl - URL immagine Cloudinary
 * @returns {Promise<'Orizzontale'|'Verticale'|'Quadrato'|null>}
 */
async function verifyOrientationWithAI(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) return null;
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imageUrl }
          },
          {
            type: 'text',
            text: "Guarda questa immagine. Qual è il suo orientamento? Rispondi SOLO con una di queste tre parole esatte: Orizzontale, Verticale, Quadrato. Nient'altro."
          }
        ]
      }]
    });
    const text = message.content[0].text.trim().toLowerCase();
    if (text.includes('verticale'))   return 'Verticale';
    if (text.includes('orizzontale')) return 'Orizzontale';
    if (text.includes('quadrato'))    return 'Quadrato';
    return null;
  } catch (e) {
    console.warn('[AI] verifyOrientationWithAI fallito:', e.message);
    return null;
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

module.exports = { generateAllAiAttributes, regenerateSingleAttribute, generateKeywordsWithAI, verifyOrientationWithAI };
