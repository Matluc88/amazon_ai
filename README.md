# 🎨 Amazon AI Listing Tool

Tool interno per generare automaticamente i contenuti di listing Amazon per stampe artistiche, usando l'API di Anthropic (Claude).

---

## 🚀 Avvio rapido

### 1. Configura la chiave API

Apri il file `.env` e inserisci la tua chiave API Anthropic:

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxx
PORT=3000
```

### 2. Avvia il server

```bash
npm start
```

Poi apri il browser su: **http://localhost:3000**

---

## 📋 Come si usa

### Flusso di lavoro

1. **Carica il file** — Trascina un file `.xlsx`, `.csv` o `.txt` nell'area di upload
2. **Genera il listing** — Clicca "✨ Genera" accanto al prodotto
3. **Modifica** — Apri il listing, modifica i campi se necessario
4. **Copia** — Usa i pulsanti 📋 per copiare i contenuti su Amazon Seller Central

### Formato file di input

Il file deve avere queste colonne (almeno `titolo_opera` è obbligatorio):

| Colonna | Obbligatorio | Descrizione |
|---------|-------------|-------------|
| `titolo_opera` | ✅ | Nome dell'opera |
| `autore` | — | Nome dell'artista |
| `dimensioni` | — | Es: 40x60 cm |
| `tecnica` | — | Es: Stampa su tela canvas |
| `descrizione_raw` | — | Testo descrittivo dell'opera |
| `prezzo` | — | Prezzo in euro (es: 29.90) |
| `quantita` | — | Quantità disponibile |

**Esempio CSV:**
```
titolo_opera,autore,dimensioni,tecnica,descrizione_raw,prezzo,quantita
La Gioconda,Leonardo da Vinci,40x60 cm,Stampa su tela,Riproduzione della celebre opera...,29.90,10
Notte Stellata,Vincent van Gogh,50x70 cm,Stampa su canvas,Il capolavoro di Van Gogh...,39.90,5
```

---

## ⚙️ Struttura del progetto

```
AMAZON_AI/
├── .env                    ← API key (non committare!)
├── server.js               ← Entry point
├── database/
│   ├── db.js               ← Configurazione SQLite
│   └── amazon_ai.db        ← Database (auto-generato)
├── routes/
│   ├── upload.js           ← POST /api/upload
│   ├── products.js         ← GET/DELETE /api/products
│   └── listings.js         ← CRUD + generazione AI
├── services/
│   ├── fileParser.js       ← Parser xlsx/csv/txt
│   └── anthropicService.js ← Integrazione Claude AI
├── uploads/                ← File temporanei (auto-svuotata)
└── public/
    ├── index.html          ← Dashboard
    ├── listing.html        ← Dettaglio listing
    ├── css/style.css
    └── js/
        ├── index.js
        └── listing.js
```

---

## 🤖 Funzioni AI disponibili

| Funzione | Descrizione |
|----------|-------------|
| **Genera listing completo** | Genera titolo, 5 bullet points, descrizione, parole chiave |
| **Rigenera Titolo** | Riscrivi solo il titolo ottimizzato Amazon |
| **Rigenera Bullet Points** | Riscrivi tutti e 5 i bullet points |
| **Rigenera Descrizione** | Riscrivi solo la descrizione lunga |

---

## 📡 API Backend

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/upload` | Carica file e importa prodotti |
| `GET` | `/api/products` | Lista prodotti |
| `DELETE` | `/api/products/:id` | Elimina prodotto |
| `GET` | `/api/listings` | Lista listing |
| `GET` | `/api/listings/:id` | Dettaglio listing |
| `PUT` | `/api/listings/:id` | Aggiorna listing manualmente |
| `POST` | `/api/listings/generate/:productId` | Genera listing con AI |
| `POST` | `/api/listings/:id/regenerate` | Rigenera campo specifico |

---

## 🛠️ Stack tecnologico

- **Backend**: Node.js + Express
- **Database**: SQLite nativo Node.js (`node:sqlite`)
- **AI**: Anthropic Claude API
- **Frontend**: HTML + CSS + Vanilla JS (nessuna dipendenza UI)
- **File parsing**: xlsx + csv-parse
