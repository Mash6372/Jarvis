# Aquila — Bot MT5 per news ad alto impatto (NFP, FOMC, ecc.)

Expert Advisor per MetaTrader 5 che automatizza la strategia "straddle sulle
news": osserva le ultime candele a 5 minuti prima di un dato orario, calcola
massimo e minimo del range e, pochi secondi prima dell'uscita della notizia,
piazza due ordini pendenti (Buy Stop sopra il massimo, Sell Stop sotto il
minimo) a una distanza in pips configurabile. Quando uno dei due scatta,
l'altro viene cancellato automaticamente (logica OCO). Include anche la
chiusura parziale automatica a un target di pips, con spostamento opzionale
dello Stop Loss a pareggio sul resto della posizione.

**Niente date da inserire.** Sul grafico compare un pannello con due sezioni
generiche — **Evento 1** ed **Evento 2** (usale per NFP, FOMC o qualsiasi
altra news) — dove imposti solo l'**orario** (es. `14:30`): l'EA lo applica
automaticamente alla giornata corrente, calcolando da solo l'orario
corrispondente sul server del broker a partire dalla differenza
Italia/server che gli hai indicato una volta sola.

## Come funziona, passo per passo

1. Nel pannello scrivi l'**orario italiano** di oggi (formato `HH:MM`, es.
   `14:30`) nella casella di Evento 1 e/o Evento 2, poi premi **"Imposta
   Evento 1"** / **"Imposta Evento 2"**.
2. L'EA calcola l'orario "adesso" in Italia (usando `TimeCurrent()` del
   server meno la differenza minuti che gli hai indicato) per sapere qual è
   **oggi**, e lo combina con l'orario che hai scritto. Se quell'orario è
   già passato da più della finestra di scadenza, l'EA lo sposta
   automaticamente a **domani** (utile se lo imposti la sera prima).
3. Da quel momento osserva in tempo reale le candele M5 comprese nella
   finestra `[orario_notizia − 10min, orario_notizia)` — con i valori di
   default corrisponde esattamente alle due candele che descrivi tu: per le
   14:30, le candele 14:20–14:25 e 14:25–14:30, aggiornando il massimo/minimo
   mentre la seconda è ancora in formazione.
4. Quando mancano `InpSecondsBeforeNews` secondi alla notizia (default 3),
   l'EA congela il range e piazza:
   - **Buy Stop** = massimo range + pips distanza (dal pannello)
   - **Sell Stop** = minimo range − pips distanza (dal pannello)
5. Se uno dei due ordini viene eseguito, l'altro viene cancellato subito.
6. Se nessuno dei due scatta entro `InpExpirationMinutes` minuti, entrambi
   vengono cancellati.
7. Se una posizione si apre e raggiunge il target di **chiusura parziale**
   impostato, l'EA chiude automaticamente la percentuale indicata e
   (se attivo) sposta lo Stop Loss a pareggio sul resto.

## Setup passo-passo su MetaTrader 5

### 1. Copia il file e compila
*File → Apri cartella dati* → `MQL5/Experts/` → copia lì
`Aquila.mq5`. Apri MetaEditor, premi **F7**, verifica "0 errori".

### 2. Attacca l'EA al grafico
Apri un grafico (es. EURUSD — il timeframe visualizzato non conta, l'EA
legge sempre M5 internamente). Nel Navigator di MT5 (Ctrl+N), sotto
"Expert Advisors", fai doppio clic su **Aquila**. Nella finestra
che si apre:
- scheda **Common** → spunta "Consenti Trading algoritmico"
- assicurati che il pulsante **"Algo Trading"** nella barra degli
  strumenti in alto di MT5 sia attivo (altrimenti l'EA non potrà mai
  operare, qualsiasi cosa tu imposti)

### 3. Usa il pannello sul grafico
Appena l'EA parte, in alto a sinistra del grafico compare il pannello:

**Blocco di stato (si aggiorna da solo ogni secondo):**
- Modalità: LIVE o SIMULAZIONE
- Evento 1: countdown all'orario impostato, oppure "ordini piazzati" /
  "posizione aperta" / "non impostato"
- Evento 2: stessa cosa
- Range (massimo/minimo) trovato, appena disponibile

**Blocco impostazioni (editabile):**
- Campo **orario Evento 1** (`HH:MM`) + pulsante "Imposta Evento 1"
- Campo **orario Evento 2** (`HH:MM`) + pulsante "Imposta Evento 2"
- Distanza pips
- Lotto
- Stop Loss pips
- Take Profit pips (finale, 0 = nessuno)
- Chiusura parziale % (0 = disabilitata)
- Trigger parziale in pips (a quanti pips di profitto scatta la
  chiusura parziale)
- Pulsante **"Applica impostazioni"** — da premere dopo aver modificato
  uno di questi campi, altrimenti restano solo scritti nella casella e
  non vengono usati dall'EA

**Pulsanti di controllo:**
- **Trading: ON/OFF** — accende/spegne l'invio di ordini reali senza
  dover riavviare l'EA (se OFF, l'EA calcola comunque i livelli e li
  scrive nel log, ma non invia nulla al broker)
- **BE dopo parziale: ON/OFF** — attiva/disattiva lo spostamento dello
  Stop Loss a pareggio dopo la chiusura parziale
- **Annulla Evento 1** / **Annulla Evento 2** — pulsante di emergenza:
  cancella gli ordini pendenti e chiude l'eventuale posizione aperta di
  quell'evento

**Dimensioni del pannello:** c'è anche un campo **"Scala pannello
(0.5-3.0)"** con il pulsante **"Applica scala"** — aumenta o diminuisci
questo numero (es. 1.3 per un pannello più grande, 0.8 per uno più
piccolo) e premi il pulsante: il pannello si ridisegna subito a nuova
dimensione, senza perdere i valori che avevi già inserito negli altri
campi.

### 4. Trova la differenza server/Italia (una tantum)
Guarda l'orologio del server nel terminale MT5, confrontalo con l'ora
italiana attuale. Esempio: server 13:32, Italia 12:32 → differenza **60**
minuti. Questo valore va impostato in `InpServerMinusItalyMin` nelle
proprietà dell'EA (Inputs) — non cambia quasi mai, quindi non serve un
campo apposito nel pannello: l'EA lo tiene a mente e lo riusa per calcolare
ogni orario che imposti dal pannello.

### 5. Prima prova: modalità simulazione
Lascia il pulsante **"Trading: OFF"**, scrivi un orario vicino (tra pochi
minuti da adesso) in una delle due caselle, premi "Imposta", e guarda la
scheda **"Esperti"** in basso in MT5: dovresti vedere i log con il range
calcolato e i prezzi che avrebbe piazzato.

### 6. Test reale su demo
Passa a **"Trading: ON"** su un conto **demo**, imposta l'orario vero della
prossima news dal pannello, e verifica il giorno dell'evento che gli ordini
pendenti compaiano davvero nella scheda "Trade".

### 7. Solo dopo, conto reale
Una volta soddisfatto del comportamento su demo, puoi passare a un conto
vero — controllando bene lotto e stop loss coerenti con il tuo money
management.

> ⚠️ NFP esce alle 8:30 ET e FOMC alle 14:00 ET, che corrispondono a
> 14:30/20:00 italiane per quasi tutto l'anno — ma USA e Europa spostano
> l'ora legale con circa una settimana di scarto. Nelle 1-2 settimane
> intorno ai cambi di ora (metà marzo e fine ottobre/inizio novembre)
> l'orario italiano reale della news può spostarsi di **un'ora**: in quelle
> settimane ricontrolla l'orario esatto su un calendario economico (es.
> Forex Factory) prima di scriverlo nel pannello.

## Tabella degli input (valori di default, tutti modificabili anche dal pannello tranne dove indicato)

| Input | Descrizione |
|---|---|
| `InpEvent1DefaultTime` / `InpEvent2DefaultTime` | Orario italiano (`HH:MM`) precaricato nel pannello all'avvio. |
| `InpServerMinusItalyMin` | Differenza in minuti server−Italia (solo qui, non nel pannello). |
| `InpLookbackMinutes` | Minuti da osservare prima della notizia (default 10 = 2 candele M5, solo qui). |
| `InpSecondsBeforeNews` | Secondi prima della notizia in cui si congela il range (solo qui). |
| `InpPipsDistance` | Distanza in pips di default (poi modificabile dal pannello). |
| `InpLotSize` | Lotto di default. |
| `InpStopLossPips` | Stop Loss in pips di default (0 = nessuno). |
| `InpTakeProfitPips` | Take Profit finale in pips di default (0 = nessuno). |
| `InpPartialClosePercent` | % di chiusura parziale di default (0 = disabilitata). |
| `InpPartialTriggerPips` | Pips di profitto per la chiusura parziale, di default. |
| `InpMoveToBreakevenAfterPartial` | Se spostare lo Stop Loss a pareggio dopo il parziale, di default. |
| `InpExpirationMinutes` | Minuti dopo la notizia dopo cui annullare gli ordini non eseguiti (solo qui). |
| `InpSlippagePoints` | Deviazione massima consentita in punti (solo qui). |
| `InpMagicNumber` | Magic number per identificare gli ordini dell'EA (solo qui). |
| `InpEnableTrading` | Stato iniziale del pulsante Trading ON/OFF. |
| `InpShowPanel`, `InpPanelX`, `InpPanelY` | Mostra/posiziona il pannello sul grafico (solo qui). |
| `InpPanelScale` | Scala di partenza del pannello (poi regolabile anche dal campo "Scala pannello" + pulsante "Applica scala"). |

## Note sulla gestione del rischio

- Imposta sempre uno Stop Loss coerente con il tuo money management:
  durante le news lo spread e lo slippage possono aumentare molto.
- La chiusura parziale + spostamento a pareggio riduce il rischio dopo un
  primo movimento a favore, ma non lo elimina: resta comunque uno Stop
  Loss iniziale.
- Puoi far girare l'EA su più grafici/simboli contemporaneamente (uno per
  simbolo), usando `InpMagicNumber` diversi se vuoi distinguerli nella
  cronologia.
- Dopo ogni modifica nei campi del pannello, ricordati di premere
  **"Applica impostazioni"**: finché non lo fai, l'EA continua a usare i
  valori precedenti.
- Ogni evento va "Impostato" di nuovo prima della news successiva: non
  essendoci più una data memorizzata, l'orario vale solo per la giornata
  in cui lo imposti (o per il giorno dopo, se l'hai scritto quando l'orario
  di oggi era già passato).
