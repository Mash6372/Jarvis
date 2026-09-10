# Logistica Ritiri Ecostazioni

App per pianificare e ottimizzare i giri di ritiro delle casse dalle ecostazioni
SIA s.r.l. (Valli di Lanzo) verso gli impianti di scarico, tenendo conto del
**lato della cerniera del coperchio** di ogni cassa in modo da poterla
scambiare direttamente con una cassa vuota compatibile all'impianto, senza
doverla riportare indietro vuota per un secondo giro.

## Avvio rapido (in locale)

Serve Node.js 22 o superiore e un database Postgres — anche gratuito (vedi
sotto "Metterla online gratis" per crearne uno in due minuti su Neon).

```bash
cd logistica-app
npm install
cp .env.example .env   # poi modifica .env con la tua stringa di connessione Postgres
npm start
```

L'app sarà disponibile su **http://localhost:3000**. Al primo avvio crea da
sola le tabelle nel database e precarica gli **11 impianti di destinazione
reali** (con relativi codici CER, indirizzi e referenti) forniti da SIA
s.r.l. — vedi `src/seed.js`.

## Come è organizzata l'app

- **Dashboard** – panoramica: numero di ecostazioni/impianti/mezzi/casse,
  distribuzione casse per stato e per lato cerniera, storico km/ore/scambi.
- **Ecostazioni** – anagrafica dei punti di ritiro (comune, indirizzo,
  coordinate, **lato cerniera richiesto**, giorno/ora entro cui va fatto il
  ritiro, codice CER prevalente).
- **Impianti** – anagrafica degli impianti di scarico, con i codici CER
  accettati da ciascuno (e se sono destinazione principale o secondaria per
  quel rifiuto), referente e telefono.
- **Casse** – ogni cassa ha un codice univoco, il lato della cerniera,
  lo stato (vuota / piena / in transito) e la posizione attuale (ecostazione,
  impianto o mezzo).
- **Mezzi** – i camion, con capacità in numero di casse e consumo medio
  (km per litro), usato per stimare il consumo di ogni giro.
- **Giri** – pianificazione di un giro: sequenza di tappe (ritiro presso
  un'ecostazione o scarico presso un impianto), con:
  - calcolo automatico di km/tempo tra le tappe (quando le coordinate sono
    note) e stima del consumo di carburante;
  - pulsante **"Ottimizza ordine"**: riordina le tappe con un euristica
    "vicino più prossimo" in base alle coordinate;
  - pannello **"Suggerimenti scambio casse"**: per ogni tappa di ritiro
    preceduta da uno scarico, mostra quali casse vuote disponibili
    all'impianto hanno il lato cerniera compatibile con l'ecostazione
    successiva, così puoi caricarle e scambiarle direttamente sul posto
    invece di fare un giro a vuoto;
  - gestione dei movimenti casse per tappa (carica piena, scarica piena,
    carica vuota, scarica vuota), che aggiorna automaticamente stato e
    posizione della cassa.

## Importare i tuoi dati

Ogni scheda (Ecostazioni, Impianti, Casse, Mezzi) ha un pulsante
**"Modello CSV"** da scaricare e compilare, e un pulsante **"Importa CSV"**
per caricarlo. Colonne attese:

- `ecostazioni_template.csv`: nome, comune, indirizzo, lat, lon,
  lato_cerniera_richiesto (`sx`/`dx`), cer_code, giorno_scadenza,
  ora_scadenza, note.
- `impianti_template.csv`: nome, comune, indirizzo, lat, lon, referente,
  telefono, cer_code, descrizione, principale (`1`/`0`), note. Una riga per
  ogni codice CER accettato: più righe con lo stesso nome+comune vengono
  unite nello stesso impianto.
- `casse_template.csv`: codice, lato_cerniera (`sx`/`dx`), stato, cer_code,
  note.
- `mezzi_template.csv`: nome, targa, capacita_casse, consumo_km_l, note.

Le coordinate (lat/lon) si possono recuperare facilmente da Google Maps
(tasto destro sul punto → copia le coordinate). Senza coordinate l'app
funziona comunque, ma non può calcolare km/tempo stimati né ottimizzare
l'ordine delle tappe.

## Dati già presenti

Gli **impianti di destinazione** (CARTAMACERO, INNOVA ECOSERVIZI,
ZAFONTE ECOLOGY, Ecocentro SIA - Grosso, LEIVO, ACEA Pinerolese, ecc.) sono
già caricati con i relativi codici CER e con coordinate **a livello di
comune** (per poterli vedere subito sulla mappa): se ti serve la posizione
precisa dell'impianto, aprilo dalla scheda Impianti e clicca sul punto
esatto nella mini-mappa del modulo di modifica. **Ecostazioni, casse e
mezzi vanno inseriti da te** (manualmente o via import CSV), perché solo tu
conosci con certezza il lato della cerniera di ogni cassa/ecostazione — un
dato sbagliato qui porterebbe a scambi errati sul campo.

## Mappa operativa

La scheda **Mappa** mostra tutte le ecostazioni (pallini blu = cerniera a
destra, arancioni = cerniera a sinistra) e tutti gli impianti (segnaposto),
con popup che riportano lato cerniera richiesto, scadenze di ritiro, CER
accettati e contatti. Il menu a tendina in alto permette di sovrapporre il
percorso di un giro specifico (tappe numerate in ordine, collegate da una
linea). La stessa mappa, centrata sul singolo giro, compare anche aprendo
il dettaglio di un giro nella scheda **Giri**.

Nei moduli di modifica di ecostazioni e impianti puoi impostare le
coordinate anche cliccando direttamente sulla mini-mappa, invece di
copiarle a mano da Google Maps.

## Metterla online gratis (link stabile, nessuna installazione)

Per avere un link tuo, sempre raggiungibile da PC/telefono/tablet, senza
installare nulla sui dispositivi che la usano, servono due pezzi **entrambi
gratuiti**: un database Postgres (Neon) e un hosting per l'app (Render).

### 1. Crea il database gratuito su Neon

1. Vai su [neon.tech](https://neon.tech) e registrati (bottone "Sign up",
   puoi usare l'account Google/GitHub).
2. Crea un nuovo progetto (basta dargli un nome, es. "logistica").
3. Nella dashboard del progetto trovi la **Connection string**: un testo
   che inizia con `postgresql://...`. Copiala: è la tua `DATABASE_URL`.
   Il piano gratuito di Neon include un database sempre attivo e persistente
   (i dati non si perdono mai), abbondante per questo uso.

### 2. Metti il codice online e collega Render

1. Vai su [render.com](https://render.com) e registrati.
2. Dashboard → **New → Web Service**.
3. Collega il tuo account GitHub e seleziona il repository `Jarvis`,
   branch `claude/happy-lamport-gb94f8` (o il branch su cui è stata
   unita questa app).
4. Imposta:
   - **Root Directory**: `logistica-app`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. In **Environment Variables** aggiungi:
   - `DATABASE_URL` = la stringa copiata da Neon al passo precedente
6. Clicca **Create Web Service**. Dopo qualche minuto Render ti dà un link
   pubblico tipo `https://logistica-nova-era.onrender.com` — quello è il
   link fisso da aprire da qualunque dispositivo.

**Nota sul piano gratuito di Render**: se l'app resta inutilizzata per un
po' "si addormenta" e la prima richiesta successiva impiega 30-60 secondi
per ripartire (le successive sono normali). I dati non vengono mai persi
perché vivono su Neon, non su Render. Se in futuro questo tempo di risveglio
diventa un problema, si risolve passando al piano a pagamento di Render
(pochi euro al mese) senza toccare il codice.

## Note tecniche

- Il database è Postgres (compatibile con qualunque provider, non solo
  Neon): la connessione si configura con la variabile d'ambiente
  `DATABASE_URL`, letta da un file `.env` in locale (vedi `.env.example`)
  o impostata nel pannello dell'hosting in produzione.
- Il calcolo di km/tempo tra due tappe usa la distanza in linea d'aria
  corretta con un fattore 1.35 (per tenere conto delle strade di montagna
  delle Valli di Lanzo) e una velocità media stimata di 35 km/h: sono valori
  indicativi, modificabili in `src/routes/giri.js` se vuoi tararli meglio
  sui tuoi percorsi reali.
- Per un backup dei dati: dal pannello Neon puoi esportare il database, o
  usare `pg_dump` con la tua `DATABASE_URL`.
