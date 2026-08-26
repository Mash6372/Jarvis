# Real Estate Flip Analyzer

Software di analisi per operazioni di **buy-renovate-sell** (compra, ristruttura, rivendi) sugli immobili italiani. Aggrega annunci da pi&ugrave; portali, li confronta e stima quali sono le migliori operazioni in base a superficie, locali, prezzo, condizione e comparabili di zona.

## ⚠️ Leggi prima di usarlo

- **immobiliare.it e idealista.it vietano lo scraping nei loro Termini di Servizio** e usano protezioni anti-bot (rate limiting, IP ban, captcha, in particolare Idealista con Akamai/DataDome). Questo tool &egrave; pensato per **uso personale, a basso volume**, con throttling aggressivo di default (6-14s tra una richiesta e l'altra sullo stesso portale, rispetto di robots.txt). Non &egrave; pensato per essere distribuito come prodotto commerciale contro questi portali senza una valutazione legale e/o un accordo di accesso ai dati.
- Le stime economiche (costo ristrutturazione, valore post-lavori, costi di transazione) sono **ipotesi configurabili** in `backend/app/config.py`, non dati di mercato certificati. Vanno sempre validate con preventivi reali e comparabili verificati a mano prima di decidere un acquisto.
- **Questo ambiente di sviluppo non ha accesso di rete verso immobiliare.it/idealista.it** (proxy in uscita bloccato). Gli scraper in `backend/app/scrapers/` sono stati scritti sulla base della struttura nota di questi siti (JSON-LD, `__NEXT_DATA__`) ma **non sono stati testati contro pagine live**. Prima di affidarti ai risultati:
  1. Esegui una singola richiesta manuale contro una pagina di ricerca e una pagina annuncio reali.
  2. Stampa/ispeziona il JSON estratto (`extract_next_data` / `extract_json_ld`) e verifica i percorsi (`_dig(...)`) usati in `immobiliare.py` e `idealista.py`.
  3. Aggiusta i selettori se il sito ha cambiato struttura.
  4. Per idealista.it, molto probabilmente dovrai far passare le richieste attraverso **Playwright** (browser reale) invece di semplici richieste HTTP, perch&eacute; le protezioni anti-bot bloccano client non-browser. Lo scraper &egrave; gi&agrave; predisposto per questo (`fetch_html` iniettabile).

## Architettura

```
real-estate-analyzer/
  backend/                  FastAPI + SQLAlchemy + APScheduler
    app/
      config.py             Impostazioni e assunzioni economiche (costi ristrutturazione, tasse, ecc.)
      models.py             Listing, SavedSearch, ScrapeRun, PropertyCluster
      scrapers/
        base.py             Interfaccia comune (SearchFilters, ScrapedListing, BaseScraper)
        immobiliare.py       Scraper immobiliare.it (via __NEXT_DATA__ / JSON-LD)
        idealista.py         Scraper idealista.it (via JSON-LD, fallback HTML)
        utils.py             Throttling, robots.txt, estrazione dati strutturati
      services/
        dedup.py             Raggruppa lo stesso immobile pubblicato su pi&ugrave; portali
        analysis.py          Calcolo ROI/margine/deal score per operazioni di flip
        scheduler.py         Job periodici di scraping + upsert annunci
      api/                   Endpoint REST (ricerche, annunci, statistiche di zona)
  frontend/                 Dashboard statica (HTML/CSS/JS vanilla, nessuna build)
```

## Come funziona l'analisi "deal score"

Per ogni annuncio con condizione "da ristrutturare"/"grezzo":

1. Cerca comparabili nella stessa zona gi&agrave; in condizione "buono"/"ottimo" &rarr; stima il prezzo/mq post-ristrutturazione (ARV).
2. Stima il costo di ristrutturazione in base a &euro;/mq per condizione (configurabile).
3. Stima i costi di transazione (imposte d'acquisto, notaio, provvigione di vendita).
4. Calcola margine atteso = valore stimato post-lavori &minus; prezzo acquisto &minus; costo ristrutturazione &minus; costi transazione.
5. Calcola ROI% e un punteggio 0-100 (`deal_score`), scontato se ci sono pochi comparabili nella zona (bassa confidenza).

Tutte le costanti sono in `backend/app/config.py` — vanno tarate sui tuoi preventivi reali e sulla tua zona.

## Avvio

### Backend

```bash
cd real-estate-analyzer/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium   # solo se abiliti il fetch via browser per idealista.it
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Al primo avvio crea automaticamente `real_estate.db` (SQLite) e lo scheduler.

### Frontend

Il frontend &egrave; puro HTML/CSS/JS statico, nessuna build necessaria:

```bash
cd real-estate-analyzer/frontend
python -m http.server 5500
```

Apri `http://localhost:5500`. Se il backend gira su un host/porta diverso, imposta `window.REA_API_BASE` in una tag `<script>` prima di `js/app.js`.

## Uso

1. **Ricerche salvate**: aggiungi una ricerca (citt&agrave;, zona, range prezzo/mq/locali). Viene eseguita subito e poi ogni 6 ore in background su tutti i portali selezionati.
2. **Import manuale**: incolla il link di un singolo annuncio per importarlo senza aspettare la ricerca automatica — utile anche come fallback a basso rischio se lo scraping automatico viene bloccato da un portale.
3. **Tabella annunci**: filtra per prezzo/mq/locali/condizione/portale e ordina per Deal Score per vedere le operazioni potenzialmente pi&ugrave; convenienti.
4. **Statistiche di zona**: `GET /api/analysis/zones?city=Milano` restituisce il prezzo/mq medio per zona diviso tra "buono stato" e "da ristrutturare", utile per capire lo spread potenziale prima ancora di guardare i singoli annunci.

## Prossimi passi suggeriti

- Calibrare `config.py` con dati reali (preventivi ristrutturazione, aliquote fiscali aggiornate alla tua situazione — prima casa vs seconda casa cambia molto le imposte).
- Validare/aggiustare i selettori degli scraper contro pagine live (vedi sopra).
- Aggiungere altri portali (Casa.it, Subito.it) implementando `BaseScraper`.
- Se il volume di ricerca cresce, valutare un proxy pool residenziale e Playwright per idealista.it, sempre nel rispetto dei ToS e con throttling conservativo.
