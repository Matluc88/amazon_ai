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
Obiettivo: keyword-first, leggibile, conversione immediata. ZERO frasi artistiche, ZERO filler.
Range TARGET: 80–110 caratteri. Ideale: 85–105. MAI oltre 200.

⚠️ CHECKLIST OBBLIGATORIA — ogni titolo DEVE rispettare TUTTI questi punti:
✔ "Stampa su Tela" o "Stampa Tela" SEMPRE presente (keyword ad alto volume)
✔ Un termine TIPO scelto tra quelli sotto — VARIA tra prodotti diversi
✔ Una STANZA scelta tra quelle sotto — VARIA tra prodotti diversi
✔ Soggetto breve (2-4 parole) e specifico dell'opera
✔ 80–110 caratteri (ideale 85–105)
✔ Leggibile da un cliente reale
✗ ZERO "dai Colori X e Y" — vietato
✗ ZERO frasi artistiche/evocative
✗ ZERO brand, autore, "Sivigliart" nel titolo

TIPI DISPONIBILI — logica precisa (NON scegliere a caso):
- "Quadro Moderno" → DEFAULT per la maggior parte delle opere: figurative, narrative, ritratti, animali, religiosi, scene di vita, simboliche. USA QUESTO SE IN DUBBIO.
- "Quadro Romantico" → SOLO se il soggetto è ESPLICITAMENTE una coppia, scena d'amore, bacio, abbraccio sentimentale. Non usare per figure singole o scene generiche.
- "Quadro Astratto" → SOLO se l'opera è davvero astratta: geometrie, forme non figurative, colori senza soggetto riconoscibile. NON usare per opere narrative o figurative "moderne".
- "Quadro Mare" → SOLO per paesaggi marini, barche, oceano, spiagge, costiero.
- "Quadro Paesaggio" → SOLO per paesaggi terrestri NON marini: campagna, montagna, boschi, città.
- "Quadro su Tela" → variante neutra quando nessun altro tipo calza perfettamente.
- "Stampa su Tela Moderna" → usa se il titolo inizia con "Stampa" (struttura B).

⚠️ REGOLA CRITICA TIPI: "Quadro Moderno" è il tipo default sicuro. Usa gli altri solo quando il soggetto è INEQUIVOCABILMENTE quello specifico. In caso di dubbio → "Quadro Moderno".

STANZE DISPONIBILI — logica coerente con il soggetto:
- "Soggiorno" → DEFAULT per la maggior parte. Sempre appropriato.
- "Camera da Letto" → SOLO per soggetti romantici (coppie), floreali intimi, sensuali-artistici.
- "Ufficio" → per paesaggi ispiranti, soggetti lavorativi/aziendali, astratti dinamici.
- "Studio" → alternativa a Ufficio per soggetti artistici/culturali.
⚠️ NON forzare "Camera da Letto" o "Ufficio" su soggetti dove stona (es. scene circensi, narrative popolari → Soggiorno).

STRUTTURA BASE (scegli la più naturale per l'opera):
A) "{Tipo} {Stanza} {Soggetto 2-4 parole} – Stampa su Tela {keyword secondaria}"
B) "Stampa su Tela {Soggetto 2-4 parole} – {Tipo} {Stanza} {keyword secondaria}"

KEYWORD SECONDARIE — VARIA lungo il catalogo (non sempre la stessa):
- "Decorazione Parete" → uso frequente, ma non su TUTTI i prodotti
- "Arredamento Moderno" → alternativa valida per soggetti contemporanei
- "Quadro su Tela" → quando il tipo scelto non è già "su Tela"
- "Pronto da Appendere" → per prodotti con dimensione singola
- "Quadro Grande" → per soggetti monumentali o misure grandi
⚠️ Non ripetere sempre la stessa keyword secondaria. Distribuisci.

hasSizeVariants = ${hasSizeVariants}
⚠️ Se hasSizeVariants = FALSE, aggiungi ", ${dimensioneSingle} cm" alla fine del titolo.

⚠️ REGOLA ANTI-DUPLICAZIONE: Varia tipo/stanza/keyword secondaria tra prodotti diversi. Amazon penalizza listing simili. NON usare sempre la stessa combinazione.

VIETATO TASSATIVO:
- "dai Colori X e Y" → sostituito da keyword reale
- Autore, "Arte di", brand "Sivigliart" nel titolo
- Frasi SEO lunghe tipo "Quadri Moderni Soggiorno e Camera da Letto" nel titolo → vanno nel backend
- MAIUSCOLO totale, parole vietate (migliore, premium, esclusivo, gratis)

ESEMPI CORRETTI (keyword-first, leggibili, 80-110 car.):
- "Quadro Moderno Soggiorno Circo Cavalli Blu – Stampa su Tela Decorazione Parete" (78 car.)
- "Quadro Astratto Soggiorno Colorato Geometrico – Stampa su Tela Arredamento Moderno" (82 car.)  ← Astratto SOLO se davvero astratto
- "Quadro Romantico Camera da Letto Coppia Bacio Tramonto – Stampa su Tela Decorazione Parete" (90 car.)  ← Romantico SOLO per coppie
- "Quadro Moderno Soggiorno Mare Tramonto Barche – Stampa su Tela Quadro su Tela" (74 car.)
- "Quadro Moderno Ufficio Paesaggio Toscana Verde – Stampa su Tela Arredamento Moderno" (83 car.)
- "Quadro Mare Soggiorno Tramonto Barca Vela – Stampa su Tela Decorazione Parete" (75 car.)

ESEMPI SBAGLIATI (da NON imitare):
- Usare "Quadro Astratto" per opere figurative/narrative ← tipo sbagliato
- Usare "Camera da Letto" per soggetti circensi, storici, lavorativi ← stanza che stona
- "dai Colori Oro e Avorio, Pronto da Appendere" ← vietato, troppo descrittivo

Output: UNA sola riga di testo, senza virgolette esterne, senza spiegazioni.

### DESCRIZIONE DEL PRODOTTO (200-2000 caratteri):
⚠️ FORMATO TESTO PURO: VIETATO qualsiasi tag HTML (<b>, <br>, <p>, ecc.). Amazon mostrerebbe i tag come testo letterale.
Frasi corte. Leggibilità mobile. NO blocchi di testo lunghi (max 4 righe per parte).

STRUTTURA IN 3 PARTI, separate da " — " (spazio-trattino-spazio):

PARTE 1 — INTRO SEO (2-3 frasi brevi — inizia dal prodotto, non dall'arte):
La PRIMA FRASE deve essere SEMPRE: "Stampa su tela canvas dell'opera originale di ${autore}, pronta da appendere con telaio in legno incluso."
Continua con 1-2 frasi brevi che descrivono soggetto e uso. Aggancia il cliente con benefici concreti.
es. "Una decorazione moderna per soggiorno, camera da letto o ufficio. Colori vivaci e stampa ad alta risoluzione."

PARTE 2 — DESCRIZIONE OPERA (3-5 frasi brevi — evocativa ma sintetica):
Racconta l'opera. Soggetto, colori, atmosfera. Frasi max 15-20 parole. NO blocchi lunghi.
es. "Una scena vivace e colorata. I cavalli danzano sotto le luci del circo. Colori caldi e pennellate decise creano un'atmosfera unica."

PARTE 3 — USO E CONTESTI (2-3 frasi brevi — per chi, dove):
Dove va questo quadro? Per chi è ideale? Chiudi con CTA o misure.
es. "Ideale per soggiorno moderno, studio o camera da letto. Perfetto come regalo originale per chi ama l'arte."
⚠️ Se il prodotto ha varianti di taglia (sezione VARIANTI DISPONIBILI nel prompt), aggiungi: "Disponibile nelle misure: [misura_mini], [misura_media], [misura_max] cm."

REGOLE TECNICHE:
- VIETATO: "dipinto", "tela dipinta", "quadro dipinto"
- VIETATO: "dipinto da ${autore}", "opera di ${autore}" — usa "opera originale di ${autore}"
- Ogni frase max 20 parole — no blocchi lunghi
- Nessun paragone o metafora artistica elaborata

### CHIAVI DI RICERCA (campo backend Search Terms — 5 slot da 250 byte UTF-8 ciascuno = 1250 byte totali):
${formatoSection}
Formato OBBLIGATORIO: SOLO SPAZI tra i termini — ZERO virgole, ZERO punteggiatura, ZERO trattini. Tutto minuscolo. SOLO ITALIANO — zero parole in inglese o altra lingua.
⚠️ TARGET LUNGHEZZA OBBLIGATORIO: genera ESATTAMENTE 1100–1200 byte UTF-8. Questo corrisponde a circa 160–190 parole italiane. Se non raggiungi 1100 byte il campo NON è compilato correttamente.

⚠️ REGOLA CEREBRO OBBLIGATORIA — INIZIA DA QUI:
Se sono presenti keyword Cerebro nel prompt (sezione "KEYWORD REALI DA HELIUM 10 CEREBRO"), le keyword del tier BACKEND e BULLET devono essere TUTTE incluse nelle chiavi di ricerca. Queste keyword hanno volumi di ricerca reali validati — DEVONO comparire nel backend. Esempio obbligatorio: se ci sono "quadri moderni soggiorno", "quadri camera da letto", "stampa su tela", "quadretti da parete" tra le keyword Cerebro, inseriscile TUTTE. Sono come i clienti cercano qualsiasi quadro su Amazon, non sono duplicati inutili.

⚠️ REGOLA DUPLICATI (applicazione limitata):
La regola "zero duplicati" si applica SOLO a parole inventate generiche, NON alle keyword Cerebro. Le keyword Cerebro devono essere inserite nel backend ANCHE SE parole simili compaiono nel titolo.

STRUTTURA A 5 AREE COMPLEMENTARI — OGNUNA DEVE ESSERE AMPIA E DETTAGLIATA:

AREA 0 — KEYWORD UNIVERSALI OBBLIGATORIE (inserisci SEMPRE — validate su Cerebro Amazon.it 2026):
Queste keyword DEVONO comparire in QUALSIASI chiave di ricerca, per tutti i quadri, indipendentemente dal soggetto:
decorazioni casa arredamento casa regalo casa nuova arredamento soggiorno quadri grandi decorazioni per la casa quadri per soggiorno
Se sono presenti keyword Cerebro nel prompt (sezione "KEYWORD REALI DA HELIUM 10 CEREBRO"), aggiungi ANCHE le keyword del tier BACKEND e BULLET ricevute nel prompt. Non saltarne nessuna.
Esempio aggiuntivo: quadri moderni soggiorno quadro moderno soggiorno quadri camera da letto stampa su tela quadretti da parete decorazione da parete decorazioni camera da letto quadro grande soggiorno quadro moderno grande stampa tela grande...

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

### PUNTI ELENCO (5 bullet — ibrido SEO + conversione):
⚠️ REGOLA TECNICA: questo prodotto è una STAMPA SU TELA — NON un dipinto a mano. VIETATO: "dipinto", "tela dipinta", "quadro dipinto".
Max 220 caratteri per bullet. "Stampa su Tela" deve comparire in almeno 2 bullet. Frasi naturali, niente keyword stuffing.

SCHEMA A 5 PUNTI:

- Punto elenco 1 — PRODOTTO + AMBIENTE (SEO + prodotto):
  Struttura: "Quadro moderno per {stanza 1} e {stanza 2}, ideale come decorazione parete in ambienti {aggettivo}. Con telaio in legno incluso, senza cornice, pronto da appendere."
  es. "Quadro moderno per soggiorno e camera da letto, ideale come decorazione parete in ambienti contemporanei. Con telaio in legno incluso, senza cornice, pronto da appendere."

- Punto elenco 2 — MATERIALE + QUALITÀ (SEO + benefici):
  Struttura: "Stampa su tela canvas con {qualità colori/dettagli}, perfetta per {uso/arredamento}. Riproduzione ad alta risoluzione dell'opera originale di ${autore}."
  es. "Stampa su tela canvas con colori intensi e dettagli definiti, perfetta per arredamento moderno. Riproduzione ad alta risoluzione dell'opera originale di ${autore}."
  ⚠️ Il riferimento a ${autore} va SOLO qui — NON ripetere nei bullet 3-5.

- Punto elenco 3 — INSTALLAZIONE (benefici pratici):
  Struttura: "Quadro su tela pronto da appendere con telaio in legno resistente e fissativo laccato. Ganci inclusi, montaggio semplice in pochi minuti."
  ⚠️ Scrivi SEMPRE "fissativo laccato" — VIETATO "fissativo lucido", "lucidato" o alternative.

- Punto elenco 4 — REGALO + CONTESTI (conversione):
  Struttura: "Perfetto come idea regalo per casa nuova, {contesto 1}, {contesto 2} o {contesto 3}. Adatto a qualsiasi stile d'arredo."
  es. "Perfetto come idea regalo per casa nuova, ufficio, studio professionale o ambiente creativo. Adatto a qualsiasi stile d'arredo."

- Punto elenco 5 — DIMENSIONI + GARANZIA (chiusura acquisto):
  Se hasSizeVariants = ${hasSizeVariants} è TRUE: "Disponibile nelle misure: ${product.misura_mini || '[dim mini]'}, ${product.misura_media || '[dim media]'}, ${product.misura_max || '[dim max]'} cm, per adattarsi a qualsiasi spazio."
  Se hasSizeVariants = FALSE: "Disponibile in diverse dimensioni per adattarsi a qualsiasi spazio."
  Chiudi SEMPRE con: "Reso entro 14 giorni secondo le condizioni Amazon."

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
    result["Chiavi di ricerca"] = ensureArea0AndBytes(result["Chiavi di ricerca"], stableKey);
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
    "Nome dell'articolo": `Titolo Amazon keyword-first, leggibile, conversione immediata. ZERO frasi artistiche, ZERO filler.
Range TARGET: 80–110 caratteri. Ideale: 85–105. MAI oltre 200.

⚠️ CHECKLIST OBBLIGATORIA — ogni titolo DEVE rispettare TUTTI questi punti:
✔ "Stampa su Tela" o "Stampa Tela" SEMPRE presente (keyword ad alto volume)
✔ Un termine TIPO scelto tra quelli sotto — VARIA tra prodotti diversi
✔ Una STANZA scelta tra quelle sotto — VARIA tra prodotti diversi
✔ Soggetto breve (2-4 parole) e specifico dell'opera
✔ 80–110 caratteri (ideale 85–105)
✔ Leggibile da un cliente reale
✗ ZERO "dai Colori X e Y" — vietato
✗ ZERO frasi artistiche/evocative
✗ ZERO brand, autore, "Sivigliart" nel titolo

TIPI DISPONIBILI (analizza l'opera e scegli — VARIA tra prodotti):
- "Quadro Moderno" → opere figurative, ritratti, soggetti contemporanei, animali, religiosi
- "Quadro Astratto" → opere astratte, geometriche, non figurative, minimal, colorato
- "Quadro su Tela" → variante generica per qualsiasi soggetto
- "Stampa su Tela Moderna" → usa quando il titolo inizia con "Stampa"
- "Quadro Mare" → paesaggi marini, costieri, barche, spiagge, oceano
- "Quadro Paesaggio" → campagna, montagna, boschi, città, fiumi (NON mare)
- "Quadro Amore" / "Quadro Romantico" → coppie, baci, abbracci, scene romantiche

STANZE DISPONIBILI (VARIA tra prodotti — non sempre Soggiorno):
- "Soggiorno" (priorità alta — vol più alto)
- "Camera da Letto" (per soggetti romantici, floreali, personali)
- "Ufficio" (per paesaggi, astratti, ispiranti)
- "Studio" (alternativa ufficio)

STRUTTURA BASE (scegli la più naturale per l'opera):
A) "{Tipo} {Stanza} {Soggetto 2-4 parole} – Stampa su Tela {keyword secondaria}"
B) "Stampa su Tela {Soggetto 2-4 parole} – {Tipo} {Stanza} {keyword secondaria}"

KEYWORD SECONDARIE (scegli la più coerente — VARIA tra prodotti):
- "Decorazione Parete" (vol ~4.1K)
- "Arredamento Moderno"
- "Pronto da Appendere"
- "Decorazioni Parete"
- "Quadro Grande"

hasSizeVariants = ${hasSizeVariantsRegen}
⚠️ Se hasSizeVariants = FALSE, aggiungi ", ${dimensioneSingleRegen} cm" alla fine del titolo.

VIETATO TASSATIVO:
- "dai Colori X e Y" → sostituito da keyword reale
- Autore, "Arte di", brand "Sivigliart" nel titolo
- Frasi SEO lunghe tipo "Quadri Moderni Soggiorno e Camera da Letto" nel titolo → vanno nel backend
- MAIUSCOLO totale, parole vietate (migliore, premium, esclusivo, gratis)

ESEMPI CORRETTI (keyword-first, leggibili, 80-110 car.):
- "Quadro Moderno Soggiorno Circo Cavalli Blu – Stampa su Tela Decorazione Parete" (78 car.)
- "Quadro Astratto Camera da Letto Colorato Rosso – Stampa su Tela Arredamento Moderno" (84 car.)
- "Quadro Moderno Soggiorno Mare Tramonto Barche – Stampa su Tela Pronto da Appendere" (83 car.)
- "Stampa su Tela Moderna Coppia Romantica Bacio – Quadro Camera da Letto Decorazione Parete" (88 car.)
- "Quadro su Tela Ufficio Paesaggio Toscana Verde – Stampa Moderna Arredamento" (74 car.)

ESEMPI SBAGLIATI (da NON imitare):
- "Quadro Moderno Madonna con Bambino in Gloria..., dai Colori Oro e Avorio, Pronto da Appendere" ← troppo lungo, "dai Colori" vietato

Output: UNA sola riga di testo, senza virgolette esterne, senza spiegazioni.`,
    "Nome del modello": 'breve nome identificativo dell\'opera (es. "La Notte Stellata - Van Gogh")',
    "Descrizione del prodotto": `200-2000 caratteri.

⚠️ FORMATO TESTO PURO: VIETATO qualsiasi tag HTML (<b>, <br>, <p>, ecc.). Frasi corte. Leggibilità mobile. NO blocchi lunghi.

STRUTTURA IN 3 PARTI, separate da " — " (spazio-trattino-spazio):

PARTE 1 — INTRO SEO (2-3 frasi brevi — inizia dal prodotto, non dall'arte):
PRIMA FRASE OBBLIGATORIA: "Stampa su tela canvas dell'opera originale di ${autore}, pronta da appendere con telaio in legno incluso."
Continua con 1-2 frasi brevi su soggetto e uso. Aggancia il cliente con benefici concreti.
es. "Una decorazione moderna per soggiorno, camera da letto o ufficio."

PARTE 2 — DESCRIZIONE OPERA (3-5 frasi brevi — evocativa ma sintetica):
Racconta l'opera. Soggetto, colori, atmosfera. Frasi max 15-20 parole. NO blocchi lunghi.

PARTE 3 — USO E CONTESTI (2-3 frasi brevi — dove, per chi, CTA):
⚠️ Se il prodotto ha varianti di taglia, indica: "Disponibile nelle misure: ${misureVarianti || '[misura piccola], [misura media], [misura grande] cm'}."
Chiudi con una frase che invita all'acquisto.

REGOLE: VIETATO "dipinto", "tela dipinta". VIETATO "dipinto da ${autore}", "opera di ${autore}" — usa "opera originale di ${autore}". Ogni frase max 20 parole.`,
    "Punto elenco 1": `PRODOTTO + AMBIENTE (SEO + prodotto, max 220 car.):
Struttura: "Quadro moderno per {stanza 1} e {stanza 2}, ideale come decorazione parete in ambienti {aggettivo}. Con telaio in legno incluso, senza cornice, pronto da appendere."
es. "Quadro moderno per soggiorno e camera da letto, ideale come decorazione parete in ambienti contemporanei. Con telaio in legno incluso, senza cornice, pronto da appendere."
VIETATO: "dipinto", "tela dipinta", prefissi MAIUSCOLO tipo "STAMPA SU TELA CANVAS –".`,
    "Punto elenco 2": `MATERIALE + QUALITÀ (SEO + benefici, max 220 car.):
Struttura: "Stampa su tela canvas con {qualità/colori}, perfetta per {uso/arredamento}. Riproduzione ad alta risoluzione dell'opera originale di ${autore}."
⚠️ Il riferimento a ${autore} va SOLO qui — NON nei bullet 3-5. VIETATO: "dipinto", "tela dipinta".`,
    "Punto elenco 3": `INSTALLAZIONE (benefici pratici, max 220 car.):
Struttura: "Quadro su tela pronto da appendere con telaio in legno resistente e fissativo laccato. Ganci inclusi, montaggio semplice in pochi minuti."
⚠️ Scrivi SEMPRE "fissativo laccato" — VIETATO "fissativo lucido", "lucidato" o qualsiasi alternativa.`,
    "Punto elenco 4": `REGALO + CONTESTI (conversione, max 220 car.):
Struttura: "Perfetto come idea regalo per casa nuova, {contesto 1}, {contesto 2} o {contesto 3}. Adatto a qualsiasi stile d'arredo."
es. "Perfetto come idea regalo per casa nuova, ufficio, studio professionale o ambiente creativo. Adatto a qualsiasi stile d'arredo."`,
    "Punto elenco 5": `DIMENSIONI + GARANZIA (chiusura acquisto, max 220 car.):
Se prodotto con varianti: "Disponibile nelle misure: ${misureVarianti || '[dim mini], [dim media], [dim max] cm'}, per adattarsi a qualsiasi spazio."
Se prodotto singolo: "Disponibile in diverse dimensioni per adattarsi a qualsiasi spazio."
Chiudi SEMPRE con: "Reso entro 14 giorni secondo le condizioni Amazon."`,
    "Chiavi di ricerca": `Campo backend Search Terms — 5 slot da 250 byte UTF-8 ciascuno = 1250 byte totali.
${formatoInfoRegen}
Formato OBBLIGATORIO: SOLO SPAZI tra i termini — ZERO virgole, ZERO punteggiatura, ZERO trattini. Tutto minuscolo. SOLO ITALIANO — zero parole in inglese o altra lingua.
⚠️ TARGET LUNGHEZZA OBBLIGATORIO: genera ESATTAMENTE 1100–1200 byte UTF-8. Questo corrisponde a circa 160–190 parole italiane. Se non raggiungi 1100 byte il campo NON è compilato correttamente.

⚠️ REGOLA DUPLICATI (applicazione limitata):
La regola "zero duplicati" si applica SOLO a parole inventate generiche. Le keyword universali validate su Cerebro (AREA 0) devono essere inserite SEMPRE, anche se simili a parole nel titolo.

STRUTTURA A 6 AREE COMPLEMENTARI (AREA 0 obbligatoria + AREE 1-5 complementari):

AREA 0 — KEYWORD UNIVERSALI OBBLIGATORIE (inserisci SEMPRE — validate su Cerebro Amazon.it 2026):
Queste keyword DEVONO comparire in QUALSIASI chiave di ricerca, per tutti i quadri, indipendentemente dal soggetto:
decorazioni casa arredamento casa regalo casa nuova arredamento soggiorno quadri grandi decorazioni per la casa quadri per soggiorno
Se sono presenti keyword Cerebro nel prompt (sezione cerebroSection), aggiungi ANCHE quelle. Non saltarne nessuna.

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
    regenResult[nomeAttributo] = ensureArea0AndBytes(regenResult[nomeAttributo], stableKeyRegen);
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

// ─── POOL SEO PIÈCES FR — combinazioni validate su Cerebro Amazon.fr 2026 ──
// Volumi: "tableau decoration murale" (32K), "decoration chambre" (20K),
//         "decoration murale" (17K), "tableau salon" (1.4K)
const ROOM_POOL_FR = [
  'Salon et Chambre à Coucher',    // tableau salon + decoration chambre
  'Chambre à Coucher et Salon',    // anti-cannibalization
  'Salon et Bureau',
  'Salon et Entrée',
  'Bureau et Chambre à Coucher',
  'Salon et Cuisine',
];

// ─── AREA 0 universali FR — keyword validate su Cerebro Amazon.fr 2026 ─────
// Volumi: tableau decoration murale (32,047), decoration chambre (20,086),
//         panneau mural decoratif (20,611), decoration murale (17,411),
//         tableau salon (1,415), impression sur toile (836)
const AREA0_PHRASES_FR = [
  'tableau decoration murale',   // vol 32,047 — TOP keyword!
  'decoration murale',           // vol 17,411
  'decoration chambre',          // vol 20,086
  'impression sur toile',        // vol 836 — specifica del prodotto
  'tableau salon',               // vol 1,415
  'idee cadeau maison',          // regali casa
  'deco maison',                 // decorazione casa
];
const AREA0_TEXT_FR = 'tableau decoration murale decoration murale decoration chambre impression sur toile tableau salon idee cadeau maison deco maison';

/**
 * Garantisce che le 7 frasi AREA 0 FR siano presenti nelle chiavi.
 * Se mancano, le prepende. Poi tronca a max 1200 byte.
 *
 * @param {string} chiavi    - Termes de recherche generati da Claude
 * @param {string} stableKey - SKU o ID del prodotto (per il log)
 * @returns {string}         - Chiavi con AREA 0 FR garantita + max 1200 byte
 */
function ensureArea0AndBytesFR(chiavi, stableKey) {
  if (!chiavi) return chiavi;
  const MIN_BYTES = 1100;

  const lower = chiavi.toLowerCase();
  const missingPhrases = AREA0_PHRASES_FR.filter(p => !lower.includes(p));

  let result = chiavi;
  if (missingPhrases.length > 0) {
    result = missingPhrases.join(' ') + ' ' + result;
    console.warn(`[AI-FR] ⚠️ AREA 0 FR mancanti [${stableKey}]: ${missingPhrases.join(', ')} — aggiunte in testa`);
  }

  const byteCount = Buffer.byteLength(result, 'utf8');
  if (byteCount < MIN_BYTES) {
    console.warn(`[AI-FR] ⚠️ Chiavi FR sotto target [${stableKey}]: ${byteCount}/${MIN_BYTES} byte`);
  }

  return smartTruncateChiavi(result, stableKey);
}

/**
 * Genera TUTTI gli attributi AI per il mercato FRANCESE (amazon.fr).
 * Output: stessi campi JSON dell'IT (chiavi DB in italiano), contenuto in FRANCESE.
 *
 * @param {object} product - dati del prodotto
 * @param {string[]} keywords - keyword minate (opzionale)
 * @param {string} cerebroSection - sezione Cerebro FR (da getCerebroPromptSectionFR)
 * @returns {object} - { "Nome dell'articolo": "...(FR)...", ... }
 */
async function generateAllAiAttributesFR(product, keywords = [], cerebroSection = '') {
  const imageUrl = getProductImageUrl(product);
  const autore = (product.autore && product.autore.trim()) ? product.autore.trim() : 'Alessandro Siviglia';
  const stableKey = product.sku_max || product.sku_media || product.sku_mini || String(product.id || 0);

  const keywordsSection = keywords.length > 0
    ? `\nMOTS-CLÉS RÉELS AMAZON.FR — utilise-les là où c'est naturel:\n${keywords.slice(0, 20).join(', ')}\n`
    : '';
  const cerebroSectionText = cerebroSection ? `\n${cerebroSection}\n` : '';

  const variantiSection = (product.misura_max || product.sku_max)
    ? `\nVARIANTES DISPONIBLES (3 tailles):\n- Grande: ${product.misura_max || '—'} cm — €${product.prezzo_max || '—'} (SKU: ${product.sku_max || '—'})\n- Moyenne: ${product.misura_media || '—'} cm — €${product.prezzo_media || '—'} (SKU: ${product.sku_media || '—'})\n- Petite: ${product.misura_mini || '—'} cm — €${product.prezzo_mini || '—'} (SKU: ${product.sku_mini || '—'})\n`
    : '';

  const hasSizeVariants = typeof product.misura_max === 'string'
    ? product.misura_max.trim().length > 0 && product.misura_max.trim() !== '—'
    : Boolean(product.misura_max);
  const dimensioneSingle = product.dimensioni || product.misura_max || '';

  const oriCalc = calcOrientamento(product.misura_max || product.dimensioni || '');
  const formatoFR = oriCalc
    ? (() => {
        const fr = oriCalc.orientamento === 'Orizzontale' ? 'PAYSAGE' : oriCalc.orientamento === 'Verticale' ? 'PORTRAIT' : 'CARRÉ';
        return `\n⚠️ FORMAT DE L'ŒUVRE: ${fr} — dimensions LARGEUR×HAUTEUR (ex. "${oriCalc.display}"). Dans les termes de recherche, utilise TOUJOURS cet ordre.`;
      })()
    : '';

  const visionNote = imageUrl
    ? '\n🖼️ ANALYSE VISUELLE: Une image de l\'œuvre est fournie. Utilise-la comme source principale pour les champs visuels (personnages, couleurs, style, composition).\n'
    : '';

  const prompt = `Sei un esperto di listing Amazon per il mercato FRANCESE (amazon.fr), specializzato in arte e decorazione.

Genera TUTTI gli attributi per un listing Amazon ottimizzato — impressions sur toile (stampe su tela) su amazon.fr.
${visionNote}
TESTO DELL'OPERA (in italiano — interpretare il soggetto, NON tradurre letteralmente):
"""
${product.descrizione_raw || 'Nessuna descrizione fornita'}
"""
${product.dimensioni ? `\nDIMENSIONS (grande): ${product.dimensioni} cm` : ''}

ARTISTE: ${autore}
⚠️ "${autore}" est le NOM DE L'ARTISTE — ne pas confondre avec le titre de l'œuvre.
${variantiSection}${keywordsSection}${cerebroSectionText}

⚠️ RÈGLE ABSOLUE: TOUS les champs textuels (titre, description, puces, termes de recherche) DOIVENT être en FRANÇAIS. Seuls les champs meta (Stile, Tema, Tipo di stanza, Famiglia di colori, Stagioni, Edizione, Funzioni speciali, Personaggio rappresentato, Tema animali, Colore, Usi consigliati) restano in ITALIANO (sono chiavi del DB).
⚠️ POLITIQUE AMAZON: INTERDIT dans tout champ: "érotique", "sensuel", "sexy" ou tout terme adult. Pour œuvres romantiques: utiliser UNIQUEMENT "romantique", "couple", "amour", "passion artistique".

### NOM DE L'ARTICLE (Titre — 80-110 car., idéal 85-105, JAMAIS +200):
✔ "Impression sur Toile" TOUJOURS présent ✔ TYPE + PIÈCE + Sujet 2-4 mots ✔ Tout en FRANÇAIS
TYPES: "Tableau Moderne" (DEFAULT), "Tableau Romantique" (SEULEMENT couple/baiser), "Tableau Abstrait" (SEULEMENT abstrait), "Tableau Mer" (SEULEMENT marin), "Tableau Paysage" (SEULEMENT terrestre), "Tableau sur Toile" (neutre)
PIÈCES: "Salon" (DEFAULT), "Chambre" (romantique/floral), "Bureau" (paysage/abstrait)
STRUCTURE: A) "{Type} {Pièce} {Sujet 2-4 mots} – Impression sur Toile {mot-clé 2}" B) "Impression sur Toile {Sujet} – {Type} {Pièce} {mot-clé 2}"
MOTS-CLÉS 2: "Décoration Murale", "Décoration Intérieure", "Idée Cadeau", "Prêt à Accrocher"
hasSizeVariants=${hasSizeVariants} — si FALSE ajouter ", ${dimensioneSingle} cm" à la fin.
EXEMPLES: "Tableau Moderne Salon Chevaux Cirque – Impression sur Toile Décoration Murale" (79) | "Tableau Romantique Chambre Couple Baiser – Impression sur Toile Décoration Intérieure" (83)
Output: UNE ligne FRANÇAISE, sans guillemets.

### DESCRIPTION DU PRODUIT (200-2000 car., TEXTE PUR — INTERDIT HTML, tout en FRANÇAIS):
3 PARTIES séparées par " — ":
PARTIE 1: PREMIÈRE PHRASE OBLIGATOIRE: "Impression sur toile de l'œuvre originale de ${autore}, prête à accrocher avec cadre en bois inclus." + 1-2 phrases sur sujet/usage.
PARTIE 2: 3-5 phrases courtes sur l'œuvre (sujet, couleurs, atmosphère). Max 20 mots/phrase.
PARTIE 3: Où/pour qui + CTA. Si variantes: "Disponible en plusieurs formats: [mini], [media], [max] cm."
INTERDIT: "peint", "toile peinte".

### TERMES DE RECHERCHE (backend — 5 slots × 250 bytes = 1250 bytes, UNIQUEMENT FRANÇAIS):
${formatoFR}
Format: ESPACES uniquement, pas de virgules. Tout minuscule. Target: 1100-1200 bytes UTF-8.

ZONE 0 — OBLIGATOIRES (tous les tableaux Amazon.fr — validés Cerebro 2026):
tableau decoration murale decoration murale decoration chambre impression sur toile tableau salon idee cadeau maison deco maison
+ TOUS les mots-clés Cerebro tier BACKEND et BULLET du prompt (si présents). N'en manquer aucun.

ZONE 1 — SYNONYMES PRODUIT (min 20 termes): affiche poster peinture dessin art toile murale cadre decoration art mural encadrement maison cadeau anniversaire tableau toile...
ZONE 2 — SUJET SPÉCIFIQUE (min 25 mots en français): variantes du sujet de l'œuvre...
ZONE 3 — STYLE ET TECHNIQUE (min 15 mots): figuratif abstrait contemporain moderne impressionniste expressionniste...
ZONE 4 — ENVIRONNEMENTS (min 20 mots): entree couloir cuisine salle de bain terrasse balcon hotel restaurant bar cabinet medical...
ZONE 5 — CADEAUX ET LONG-TAIL (min 30 mots): cadeau fete des meres cadeau anniversaire copine cadeau mariage inauguration maison cadeau noel saint-valentin fete des peres cadeau ami...
RÈGLES: ZÉRO anglais (pas wall art, pas canvas, pas gift), pas "sivigliart", min 150 mots.

### POINTS DE LISTE (5 puces en FRANÇAIS — max 220 car. chacune):
INTERDIT: "peint", "toile peinte". "Impression sur Toile" dans au moins 2 puces.
Puce 1: "Tableau moderne pour {pièce 1} et {pièce 2}, idéal comme décoration murale dans des espaces {adj}. Avec cadre en bois inclus, sans cadre vitré, prêt à accrocher."
Puce 2: "Impression sur toile canvas avec {qualité}, parfaite pour {usage}. Reproduction haute résolution de l'œuvre originale de ${autore}." [seul puce avec l'artiste]
Puce 3: "Tableau sur toile prêt à accrocher avec cadre en bois résistant et finition laquée. Crochets inclus, montage simple en quelques minutes." [TOUJOURS "finition laquée"]
Puce 4: "Parfait comme idée cadeau pour emménagement, {contexte 1}, {contexte 2} ou {contexte 3}. Adapté à tous les styles de décoration."
Puce 5: ${hasSizeVariants ? `"Disponible en plusieurs formats: ${product.misura_mini || '[mini]'}, ${product.misura_media || '[med]'}, ${product.misura_max || '[max]'} cm, pour s'adapter à tous les espaces. Retour accepté sous 14 jours selon les conditions Amazon."` : '"Disponible en plusieurs tailles pour s\'adapter à tous les espaces. Retour accepté sous 14 jours selon les conditions Amazon."'}

### CHAMPS META (en ITALIANO — chiavi DB):
- "Personaggio rappresentato": figura umana → 1-3 parole IT (es. "Coppia", "Donna", "Musicista"); nessuna → "N/D"
- "Colore": 1-2 dominanti IT (es. "Blu, Oro"); 3+ → "Multicolore"
- "Stile": stile artistico IT (es. "Arte Moderna", "Impressionista", "Astratto")
- "Tema": temi IT virgola-separati (es. "Coppia romantica, Amore")
- "Tipo di stanza": 3-4 stanze IT, inizia "Soggiorno" (es. "Soggiorno, Camera da letto, Ufficio")
- "Famiglia di colori": UNO tra: "Bianco"|"Bianco e nero"|"Caldi"|"Freddi"|"Luminosi"|"Neutro"|"Pastelli"|"Scala di grigi"|"Tonalità della terra"|"Toni gioiello"
- "Usi consigliati per il prodotto": IT virgola-separati (es. "Decorazione parete, Regalo")
- "Tema animali": animale principale IT (es. "Cavallo", "Leone"); assenza → "N/D"
- "Funzioni speciali": SEMPRE "Pronto da appendere, Con telaio in legno" (IT)
- "Stagioni": UNO tra: "Tutte le stagioni"|"Primavera"|"Estate"|"Autunno"|"Inverno"
- "Edizione": IT (es. "Stampa Artistica Moderna")

Rispondi SOLO con JSON valido:
{"Nome dell'articolo":"...","Nome del modello":"...","Descrizione del prodotto":"...","Punto elenco 1":"...","Punto elenco 2":"...","Punto elenco 3":"...","Punto elenco 4":"...","Punto elenco 5":"...","Chiavi di ricerca":"...","Funzioni speciali":"...","Personaggio rappresentato":"...","Stile":"...","Tema":"...","Usi consigliati per il prodotto":"...","Tipo di stanza":"...","Famiglia di colori":"...","Motivo":"...","Colore":"...","Supporti di stampa":"Impression sur toile canvas","Edizione":"...","Stagioni":"...","Tema animali":"..."}`;

  if (imageUrl) {
    console.log(`[AI-FR] Vision AI attiva per prodotto ${product.id || '?'} — immagine: ${imageUrl.slice(0, 60)}...`);
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: buildMessageContent(prompt, imageUrl) }]
  });

  const result = parseJsonResponse(message.content[0].text);

  if (result["Nome dell'articolo"]) {
    result["Nome dell'articolo"] = smartTruncateTitle(result["Nome dell'articolo"], stableKey);
  }
  if (result["Chiavi di ricerca"]) {
    result["Chiavi di ricerca"] = ensureArea0AndBytesFR(result["Chiavi di ricerca"], stableKey);
  }

  return result;
}

// ─── AREA 0 universali — 7 keyword validate su Cerebro Amazon.it 2026 ─────
// Queste frasi devono essere SEMPRE presenti nelle chiavi di ricerca.
// Volumi: decorazioni casa (9.711), arredamento casa (6.960),
//         regalo casa nuova (2.680), arredamento soggiorno (571),
//         quadri grandi (368), decorazioni per la casa (233), quadri per soggiorno (143)
const AREA0_PHRASES = [
  'decorazioni casa',
  'arredamento casa',
  'regalo casa nuova',
  'arredamento soggiorno',
  'quadri grandi',
  'decorazioni per la casa',
  'quadri per soggiorno'
];
const AREA0_TEXT = 'decorazioni casa arredamento casa regalo casa nuova arredamento soggiorno quadri grandi decorazioni per la casa quadri per soggiorno';

/**
 * Garantisce che le 7 frasi AREA 0 siano presenti nelle chiavi.
 * Se mancano, le prepende. Poi tronca a max 1200 byte.
 * Safety net contro la compressione AI dell'AREA 0.
 *
 * @param {string} chiavi    - Chiavi di ricerca generate da Claude
 * @param {string} stableKey - SKU o ID del prodotto (per il log)
 * @returns {string}         - Chiavi con AREA 0 garantita + max 1200 byte
 */
function ensureArea0AndBytes(chiavi, stableKey) {
  if (!chiavi) return chiavi;
  const MIN_BYTES = 1100;

  // Verifica quali frasi AREA 0 mancano nell'output AI
  const lower = chiavi.toLowerCase();
  const missingPhrases = AREA0_PHRASES.filter(p => !lower.includes(p));

  let result = chiavi;
  if (missingPhrases.length > 0) {
    // Prepend delle frasi mancanti in testa
    result = missingPhrases.join(' ') + ' ' + result;
    console.warn(`[AI] ⚠️ AREA 0 mancanti [${stableKey}]: ${missingPhrases.join(', ')} — aggiunte in testa`);
  }

  // Log se sotto il target minimo di byte
  const byteCount = Buffer.byteLength(result, 'utf8');
  if (byteCount < MIN_BYTES) {
    console.warn(`[AI] ⚠️ Chiavi sotto target [${stableKey}]: ${byteCount}/${MIN_BYTES} byte — prompt AI troppo corto`);
  }

  // Tronca se sopra il massimo
  return smartTruncateChiavi(result, stableKey);
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

  if (len > 110) {
    console.info(`[AI] ℹ️ Titolo zona gialla [${stableKey}]: ${len} car. (target 80-110, ideale 85-105)`);
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

// ─── AREA 0 universali DE — keyword validate su Amazon.de 2026 ─────────────
// Volumi stimati per il mercato tedesco (Poster & Kunstdrucke):
// wandbilder wohnzimmer, leinwandbilder, bilder wohnzimmer, kunstdruck,
// wanddeko, poster wohnzimmer, leinwand, geschenk
const AREA0_PHRASES_DE = [
  'wandbilder wohnzimmer',        // top keyword DE
  'leinwandbilder',               // canvas prints
  'bilder wohnzimmer',            // pictures living room
  'kunstdruck',                   // art print
  'wanddeko',                     // wall decoration
  'poster wohnzimmer',            // poster living room
  'leinwand',                     // canvas
];

/**
 * Garantisce che le frasi AREA 0 DE siano presenti nelle chiavi.
 * Se mancano, le prepende. Poi tronca a max 1200 byte.
 */
function ensureArea0AndBytesDE(chiavi, stableKey) {
  if (!chiavi) return chiavi;
  const MIN_BYTES = 1100;

  const lower = chiavi.toLowerCase();
  const missingPhrases = AREA0_PHRASES_DE.filter(p => !lower.includes(p));

  let result = chiavi;
  if (missingPhrases.length > 0) {
    result = missingPhrases.join(' ') + ' ' + result;
    console.warn(`[AI-DE] ⚠️ AREA 0 DE mancanti [${stableKey}]: ${missingPhrases.join(', ')} — aggiunte in testa`);
  }

  const byteCount = Buffer.byteLength(result, 'utf8');
  if (byteCount < MIN_BYTES) {
    console.warn(`[AI-DE] ⚠️ Chiavi DE sotto target [${stableKey}]: ${byteCount}/${MIN_BYTES} byte`);
  }

  return smartTruncateChiavi(result, stableKey);
}

/**
 * Genera TUTTI gli attributi AI per il mercato TEDESCO (amazon.de).
 * Output: stessi campi JSON dell'IT (chiavi DB in italiano), contenuto in TEDESCO.
 *
 * @param {object} product - dati del prodotto
 * @param {string[]} keywords - keyword minate (opzionale)
 * @param {string} cerebroSection - sezione Cerebro DE (opzionale)
 * @returns {object} - { "Nome dell'articolo": "...(DE)...", ... }
 */
async function generateAllAiAttributesDE(product, keywords = [], cerebroSection = '') {
  const imageUrl = getProductImageUrl(product);
  const autore = (product.autore && product.autore.trim()) ? product.autore.trim() : 'Alessandro Siviglia';
  const stableKey = product.sku_max || product.sku_media || product.sku_mini || String(product.id || 0);

  const keywordsSection = keywords.length > 0
    ? `\nECHTE AMAZON.DE-SUCHBEGRIFFE — verwende sie wo natürlich passend:\n${keywords.slice(0, 20).join(', ')}\n`
    : '';
  const cerebroSectionText = cerebroSection ? `\n${cerebroSection}\n` : '';

  const variantiSection = (product.misura_max || product.sku_max)
    ? `\nVERFÜGBARE VARIANTEN (3 Größen):\n- Groß: ${product.misura_max || '—'} cm — €${product.prezzo_max || '—'} (SKU: ${product.sku_max || '—'})\n- Mittel: ${product.misura_media || '—'} cm — €${product.prezzo_media || '—'} (SKU: ${product.sku_media || '—'})\n- Klein: ${product.misura_mini || '—'} cm — €${product.prezzo_mini || '—'} (SKU: ${product.sku_mini || '—'})\n`
    : '';

  const hasSizeVariants = typeof product.misura_max === 'string'
    ? product.misura_max.trim().length > 0 && product.misura_max.trim() !== '—'
    : Boolean(product.misura_max);
  const dimensioneSingle = product.dimensioni || product.misura_max || '';

  const oriCalc = calcOrientamento(product.misura_max || product.dimensioni || '');
  const formatoDE = oriCalc
    ? (() => {
        const de = oriCalc.orientamento === 'Orizzontale' ? 'QUERFORMAT' : oriCalc.orientamento === 'Verticale' ? 'HOCHFORMAT' : 'QUADRATISCH';
        return `\n⚠️ FORMAT DES WERKS: ${de} — Maße BREITE×HÖHE (z.B. "${oriCalc.display}"). In den Suchbegriffen IMMER diese Reihenfolge verwenden.`;
      })()
    : '';

  const visionNote = imageUrl
    ? '\n🖼️ VISUELLE ANALYSE: Ein Bild des Werks ist beigefügt. Verwende es als Hauptquelle für visuelle Felder (Figuren, Farben, Stil, Komposition).\n'
    : '';

  const prompt = `Sei un esperto di listing Amazon per il mercato TEDESCO (amazon.de), specializzato in arte e decorazione.

Genera TUTTI gli attributi per un listing Amazon ottimizzato — Leinwanddruck (stampe su tela) su amazon.de.
${visionNote}
TESTO DELL'OPERA (in italiano — interpretare il soggetto, NON tradurre letteralmente):
"""
${product.descrizione_raw || 'Nessuna descrizione fornita'}
"""
${product.dimensioni ? `\nMASSE (groß): ${product.dimensioni} cm` : ''}

KÜNSTLER: ${autore}
⚠️ "${autore}" ist der NAME DES KÜNSTLERS — nicht mit dem Titel des Werks verwechseln.
${variantiSection}${keywordsSection}${cerebroSectionText}

⚠️ ABSOLUTE REGEL: ALLE Textfelder (Titel, Beschreibung, Aufzählungspunkte, Suchbegriffe) MÜSSEN auf DEUTSCH sein. Nur die Meta-Felder (Stile, Tema, Tipo di stanza, Famiglia di colori, Stagioni, Edizione, Funzioni speciali, Personaggio rappresentato, Tema animali, Colore, Usi consigliati) bleiben auf ITALIENISCH (DB-Schlüssel).
⚠️ AMAZON-RICHTLINIE: VERBOTEN in allen Feldern: "erotisch", "sinnlich", "sexy" oder ähnliche Begriffe. Für romantische Werke: NUR "romantisch", "Paar", "Liebe", "künstlerische Leidenschaft" verwenden.

### ARTIKELNAME (Titel — 80-110 Zeichen, ideal 85-105, NIE über 200):
✔ "Leinwandbild" IMMER enthalten ✔ TYP + RAUM + Motiv 2-4 Wörter ✔ Alles auf DEUTSCH
TYPEN: "Modernes Wandbild" (DEFAULT), "Romantisches Wandbild" (NUR Paar/Kuss), "Abstraktes Wandbild" (NUR abstrakt), "Meerbild" (NUR maritim), "Landschaftsbild" (NUR Landschaft), "Leinwandbild" (neutral)
RÄUME: "Wohnzimmer" (DEFAULT), "Schlafzimmer" (romantisch/floral), "Büro" (Landschaft/abstrakt)
STRUKTUR: A) "{Typ} {Raum} {Motiv 2-4 Wörter} – Leinwandbild {Schlüsselwort 2}" B) "Leinwandbild {Motiv} – {Typ} {Raum} {Schlüsselwort 2}"
SCHLÜSSELWÖRTER 2: "Wanddekoration", "Wohnzimmerdeko", "Geschenkidee", "Fertig zum Aufhängen"
hasSizeVariants=${hasSizeVariants} — wenn FALSE, ", ${dimensioneSingle} cm" am Ende hinzufügen.
BEISPIELE: "Modernes Wandbild Wohnzimmer Pferde Zirkus – Leinwandbild Wanddekoration" (72) | "Romantisches Wandbild Schlafzimmer Paar Kuss – Leinwandbild Wohnzimmerdeko" (78)
Ausgabe: EINE Zeile auf DEUTSCH, ohne Anführungszeichen.

### PRODUKTBESCHREIBUNG (200-2000 Zeichen, REINER TEXT — KEIN HTML, alles auf DEUTSCH):
3 TEILE getrennt durch " — ":
TEIL 1: ERSTER PFLICHT-SATZ: "Leinwanddruck des Originalwerks von ${autore}, fertig zum Aufhängen mit Holzrahmen inklusive." + 1-2 Sätze über Motiv/Verwendung.
TEIL 2: 3-5 kurze Sätze über das Werk (Motiv, Farben, Atmosphäre). Max 20 Wörter/Satz.
TEIL 3: Wo/für wen + CTA. Bei Varianten: "Erhältlich in mehreren Formaten: [klein], [mittel], [groß] cm."
VERBOTEN: "gemalt", "handgemalt".

### SUCHBEGRIFFE (Backend — 5 Slots × 250 Bytes = 1250 Bytes, NUR DEUTSCH):
${formatoDE}
Format: NUR Leerzeichen, keine Kommas. Alles kleingeschrieben. Ziel: 1100-1200 Bytes UTF-8.

ZONE 0 — PFLICHT (alle Leinwandbilder Amazon.de):
wandbilder wohnzimmer leinwandbilder bilder wohnzimmer kunstdruck wanddeko poster wohnzimmer leinwand geschenkidee wohnung
+ ALLE Cerebro-Schlüsselwörter der Tiers BACKEND und BULLET aus dem Prompt (falls vorhanden).

ZONE 1 — PRODUKT-SYNONYME (min 20 Begriffe): bild poster druck gemälde kunst wandbild rahmen dekoration kunstwerk wanddekoration leinwanddruck bilderwand wandschmuck wohndeko inneneinrichtung...
ZONE 2 — SPEZIFISCHES MOTIV (min 25 Wörter auf Deutsch): Varianten des Motivs des Werks...
ZONE 3 — STIL UND TECHNIK (min 15 Wörter): figurativ abstrakt zeitgenössisch modern impressionistisch expressionistisch...
ZONE 4 — RÄUME (min 20 Wörter): flur küche bad terrasse balkon hotel restaurant bar arztpraxis wartezimmer empfang...
ZONE 5 — GESCHENKE UND LONG-TAIL (min 30 Wörter): geschenk muttertag geschenk geburtstag freundin geschenk hochzeit einweihung geschenk weihnachten valentinstag vatertag geschenk freund...
REGELN: KEIN Englisch (kein wall art, kein canvas, kein gift), kein "sivigliart", min 150 Wörter.

### AUFZÄHLUNGSPUNKTE (5 Punkte auf DEUTSCH — max 220 Zeichen je):
VERBOTEN: "gemalt", "handgemalt". "Leinwandbild" in mindestens 2 Punkten.
Punkt 1: "Modernes Wandbild für {Raum 1} und {Raum 2}, ideal als Wanddekoration in {Adj.} Räumen. Mit Holzrahmen inklusive, ohne Glasrahmen, fertig zum Aufhängen."
Punkt 2: "Leinwandbild mit {Qualität}, perfekt für {Verwendung}. Hochauflösende Reproduktion des Originalwerks von ${autore}." [einziger Punkt mit Künstlername]
Punkt 3: "Wandbild auf Leinwand, fertig zum Aufhängen mit stabilem Holzrahmen und lackierter Oberfläche. Aufhänger inklusive, einfache Montage in wenigen Minuten." [IMMER "lackierter Oberfläche"]
Punkt 4: "Perfekt als Geschenkidee zum Einzug, {Anlass 1}, {Anlass 2} oder {Anlass 3}. Passt zu jedem Einrichtungsstil."
Punkt 5: ${hasSizeVariants ? `"Erhältlich in mehreren Formaten: ${product.misura_mini || '[klein]'}, ${product.misura_media || '[mittel]'}, ${product.misura_max || '[groß]'} cm, passend für jeden Raum. Rückgabe innerhalb von 14 Tagen gemäß Amazon-Bedingungen."` : '"Erhältlich in mehreren Größen für jeden Raum. Rückgabe innerhalb von 14 Tagen gemäß Amazon-Bedingungen."'}

### META-FELDER (in ITALIANO — chiavi DB):
- "Personaggio rappresentato": figura umana → 1-3 parole IT (es. "Coppia", "Donna", "Musicista"); nessuna → "N/D"
- "Colore": 1-2 dominanti IT (es. "Blu, Oro"); 3+ → "Multicolore"
- "Stile": stile artistico IT (es. "Arte Moderna", "Impressionista", "Astratto")
- "Tema": temi IT virgola-separati (es. "Coppia romantica, Amore")
- "Tipo di stanza": 3-4 stanze IT, inizia "Soggiorno" (es. "Soggiorno, Camera da letto, Ufficio")
- "Famiglia di colori": UNO tra: "Bianco"|"Bianco e nero"|"Caldi"|"Freddi"|"Luminosi"|"Neutro"|"Pastelli"|"Scala di grigi"|"Tonalità della terra"|"Toni gioiello"
- "Usi consigliati per il prodotto": IT virgola-separati (es. "Decorazione parete, Regalo")
- "Tema animali": animale principale IT (es. "Cavallo", "Leone"); assenza → "N/D"
- "Funzioni speciali": SEMPRE "Pronto da appendere, Con telaio in legno" (IT)
- "Stagioni": UNO tra: "Tutte le stagioni"|"Primavera"|"Estate"|"Autunno"|"Inverno"
- "Edizione": IT (es. "Stampa Artistica Moderna")

Rispondi SOLO con JSON valido:
{"Nome dell'articolo":"...","Nome del modello":"...","Descrizione del prodotto":"...","Punto elenco 1":"...","Punto elenco 2":"...","Punto elenco 3":"...","Punto elenco 4":"...","Punto elenco 5":"...","Chiavi di ricerca":"...","Funzioni speciali":"...","Personaggio rappresentato":"...","Stile":"...","Tema":"...","Usi consigliati per il prodotto":"...","Tipo di stanza":"...","Famiglia di colori":"...","Motivo":"...","Colore":"...","Supporti di stampa":"Leinwanddruck","Edizione":"...","Stagioni":"...","Tema animali":"..."}`;

  if (imageUrl) {
    console.log(`[AI-DE] Vision AI attiva per prodotto ${product.id || '?'} — immagine: ${imageUrl.slice(0, 60)}...`);
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: buildMessageContent(prompt, imageUrl) }]
  });

  const result = parseJsonResponse(message.content[0].text);

  if (result["Nome dell'articolo"]) {
    result["Nome dell'articolo"] = smartTruncateTitle(result["Nome dell'articolo"], stableKey);
  }
  if (result["Chiavi di ricerca"]) {
    result["Chiavi di ricerca"] = ensureArea0AndBytesDE(result["Chiavi di ricerca"], stableKey);
  }

  return result;
}

/**
 * Chat AI per la dashboard metriche.
 * Riceve la domanda dell'utente e un oggetto "context" con i dati correnti
 * (KPI, top prodotti, clienti, città, ecc.) e usa Claude per dare consigli
 * di business marketing personalizzati.
 *
 * @param {string} userMessage   - domanda dell'utente
 * @param {object} context       - snapshot dei dati correnti dalla dashboard
 * @param {Array}  history       - storia della conversazione (opz): [{role, content}]
 */
async function chatAboutMetrics(userMessage, context = {}, history = []) {
  const contextBlock = JSON.stringify(context, null, 2);

  const systemPrompt = `Sei un consulente di marketing e business intelligence per Sivigliart,
un'attività italiana che vende quadri moderni (stampe su tela e dipinti originali) online tramite
il sito alessandrosiviglia.it, Meta Ads e Google Ads.

Rispondi SEMPRE in italiano, con tono diretto, pratico e orientato all'azione.

## Framework di ragionamento (3i — Initiate, Iterate, Integrate)

Quando analizzi i dati ricorda sempre:

1. **Initiate — parti dal cliente, non dal prodotto.**
   I dati ti dicono cosa i clienti FANNO realmente, non cosa dicono di voler fare. Se i numeri
   sembrano contraddire l'intuizione del venditore, fidati dei numeri. Il cliente è la fonte di
   verità, non il marketer.

2. **Iterate — nessuna idea è perfetta al primo colpo.**
   Se identifichi un'azione (es. "aumenta budget su X"), proponila come ipotesi da testare, non
   come certezza. Suggerisci sempre un modo semplice per verificare dopo 7-14 giorni se
   l'ipotesi ha funzionato.

3. **Integrate — collega canali e fonti diverse.**
   Una vendita raramente arriva da un solo canale. Se vedi una correlazione, controlla sempre
   se i dati di altri canali la supportano (es. picco vendite WC + picco ads Meta = correlato;
   picco vendite WC + zero traffico = probabilmente passaparola o email).

## Principio del "cliente soddisfatto" (Kotler)

"La migliore pubblicità è quella dei clienti soddisfatti." Quando vedi clienti ricorrenti nei dati,
trattali come un asset strategico: sono già convinti, basta coltivarli. Un singolo cliente
ricorrente vale più di dieci visitatori singoli perché il costo di acquisizione è già stato
ammortizzato e perché spontaneamente diventano ambassador del brand.

## REGOLE RIGOROSE per l'analisi dei dati

**1. NON fare inferenze causali azzardate.**
I dati che vedi sono correlazioni, non cause. Esempi di errori da evitare:
- "Meta ha 1 conversione ma WooCommerce 4 ordini, quindi Meta ne perde 3" → SBAGLIATO:
  le altre 3 vendite possono venire da Google/organico/direct, non da Meta. Meta
  sta probabilmente tracciando correttamente la sua sola vendita.
- "Il ROAS è 2× quindi la campagna rende poco" → SBAGLIATO: il ROAS del Pixel Meta
  è sistematicamente sottostimato del 30-50% per motivi tecnici (Safari, cookie).

**2. Distingui SEMPRE le fonti dei dati nel context:**
- \`ads.per_platform\`: conversioni TRACCIATE DAL PIXEL della piattaforma (possono
  essere sottostimate)
- \`woocommerce.totals\`: soldi REALI incassati, TOTALE da TUTTI i canali (non solo
  da quello che stai guardando)
- \`ga4.channel_breakdown\`: come GA4 attribuisce le sessioni e le conversioni ai
  diversi canali (Direct/Organic/Paid Search/Paid Social/...). USA QUESTO per capire
  da dove viene il traffico, non dal confronto Meta vs WC.

**3. Se qualcosa NON è nei dati, dillo esplicitamente.**
Non inventare spiegazioni. "Non posso dirlo con certezza perché manca X" è una
risposta valida.

**4. Quando indichi un problema, verifica che i dati lo supportino davvero.**
Prima di dire "hai un problema con X", ricontrolla il context: è davvero un problema
o sembra un problema solo perché stai confrontando metriche incompatibili?

## Stile

- Cita i numeri esatti dai dati forniti quando rilevanti
- Dai consigli CONCRETI e implementabili, non teoria generica
- Preferisci elenchi puntati brevi rispetto a paragrafi lunghi
- Evita preamboli. Vai dritto al consiglio.
- Non usare emoji tranne quando il tono è molto informale

## Dati correnti

I dati qui sotto rappresentano il periodo selezionato dall'utente nella dashboard
(\`periodo.from\` → \`periodo.to\`). Sono lo snapshot di QUESTO momento:

\`\`\`json
${contextBlock}
\`\`\``;

  const messages = [];
  for (const h of (history || [])) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: String(h.content || '').slice(0, 4000) });
    }
  }
  messages.push({ role: 'user', content: String(userMessage || '').slice(0, 4000) });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return text || 'Mi spiace, non ho potuto generare una risposta.';
}

module.exports = { generateAllAiAttributes, regenerateSingleAttribute, generateKeywordsWithAI, verifyOrientationWithAI, generateAllAiAttributesFR, generateAllAiAttributesDE, chatAboutMetrics };
