# Aquila — Bot MT5 per news ad alto impatto (NFP, FOMC, ecc.)

Expert Advisor per MetaTrader 5 che automatizza la strategia "straddle sulle
news": osserva le ultime candele a 5 minuti prima di un dato orario, calcola
massimo e minimo del range e, pochi secondi prima dell'uscita della notizia,
piazza due ordini pendenti (Buy Stop sopra il massimo, Sell Stop sotto il
minimo) a una distanza in pips configurabile. Quando uno dei due scatta,
l'altro viene cancellato automaticamente (logica OCO). Include anche la
chiusura parziale automatica a un target di pips, con spostamento opzionale
dello Stop Loss a pareggio sul resto della posizione.

**Tutte le impostazioni si fanno nelle proprietà dell'EA (Inputs).** Il
pannello sul grafico è **solo lettura**: mostra in tempo reale lo stato
degli eventi, il range trovato e i valori attivi in quel momento, più tre
pulsanti rapidi (Trading ON/OFF, BE dopo parziale ON/OFF, Annulla evento).
Non ci sono caselle di testo da compilare sul grafico.

## Come funziona, passo per passo

1. Nelle proprietà dell'EA scrivi l'**orario italiano** di oggi (formato
   `HH:MM`, es. `14:30`) in `InpEvent1Time` e/o `InpEvent2Time` (usa i due
   eventi per NFP, FOMC o qualsiasi altra news).
2. All'avvio l'EA calcola l'orario "adesso" in Italia (usando l'orario del
   server meno la differenza minuti indicata in `InpServerMinusItalyMin`)
   per sapere qual è **oggi**, e lo combina con l'orario scritto. Se
   quell'orario è già passato da più della finestra di scadenza, lo sposta
   automaticamente a **domani**.
3. Da quel momento osserva in tempo reale le candele M5 comprese nella
   finestra `[orario_notizia − 10min, orario_notizia)` — con i valori di
   default corrisponde esattamente alle due candele che descrivi tu: per le
   14:30, le candele 14:20–14:25 e 14:25–14:30, aggiornando il massimo/minimo
   mentre la seconda è ancora in formazione.
4. Quando mancano `InpSecondsBeforeNews` secondi alla notizia (default 3),
   l'EA congela il range e piazza:
   - **Buy Stop** = massimo range + `InpPipsDistance` pips
   - **Sell Stop** = minimo range − `InpPipsDistance` pips
5. Se uno dei due ordini viene eseguito, l'altro viene cancellato subito.
6. Se nessuno dei due scatta entro `InpExpirationMinutes` minuti, entrambi
   vengono cancellati.
7. Se una posizione si apre e raggiunge il target di `InpPartialTriggerPips`,
   l'EA chiude automaticamente `InpPartialClosePercent`% della posizione e
   (se il pulsante BE è ON) sposta lo Stop Loss a pareggio sul resto.

**Per impostare un nuovo orario ogni giorno** (dato che non c'è più una
data memorizzata): apri le proprietà dell'EA (doppio clic sull'EA nel
grafico, o clic destro sul grafico → Expert Advisors → Properties), cambia
`InpEvent1Time`/`InpEvent2Time` e premi OK — l'EA si ricarica e riarma gli
eventi con l'orario nuovo, sempre riferito a oggi.

## Setup passo-passo su MetaTrader 5

### 1. Copia il file e compila
*File → Apri cartella dati* → `MQL5/Experts/` → copia lì
`Aquila.mq5`. Apri MetaEditor, premi **F7**, verifica "0 errori".

### 2. Attacca l'EA al grafico
Apri un grafico (es. EURUSD — il timeframe visualizzato non conta, l'EA
legge sempre M5 internamente). Nel Navigator di MT5 (Ctrl+N), sotto
"Expert Advisors", fai doppio clic su **Aquila**. Nella finestra
che si apre:
- scheda **Inputs** → imposta `InpEvent1Time`, `InpEvent2Time`,
  `InpServerMinusItalyMin` e tutti gli altri parametri (vedi tabella sotto)
- scheda **Common** → spunta "Consenti Trading algoritmico"
- assicurati che il pulsante **"Algo Trading"** nella barra degli
  strumenti in alto di MT5 sia attivo (altrimenti l'EA non potrà mai
  operare, qualsiasi cosa tu imposti)

### 3. Il pannello sul grafico (sola lettura + pulsanti)
Appena l'EA parte, in alto a sinistra del grafico compare:

- Modalità: LIVE o SIMULAZIONE
- Evento 1: countdown all'orario impostato, oppure "ordini piazzati" /
  "posizione aperta" / "non impostato (vedi proprietà EA)"
- Evento 2: stessa cosa
- Range (massimo/minimo) trovato, appena disponibile
- Riga con i valori attivi: distanza pips, lotto, stop loss, take profit
- Riga con i valori di chiusura parziale attivi

**Pulsanti:**
- **Trading: ON/OFF** — accende/spegne l'invio di ordini reali senza
  dover riavviare l'EA (se OFF, l'EA calcola comunque i livelli e li
  scrive nel log, ma non invia nulla al broker)
- **BE dopo parziale: ON/OFF** — attiva/disattiva lo spostamento dello
  Stop Loss a pareggio dopo la chiusura parziale
- **Annulla Evento 1** / **Annulla Evento 2** — pulsante di emergenza:
  cancella gli ordini pendenti e chiude l'eventuale posizione aperta di
  quell'evento

### 4. Trova la differenza server/Italia (una tantum)
Guarda l'orologio del server nel terminale MT5, confrontalo con l'ora
italiana attuale. Esempio: server 13:32, Italia 12:32 → differenza **60**
minuti. Scrivi questo valore in `InpServerMinusItalyMin` nelle proprietà —
non cambia quasi mai.

### 5. Prima prova: modalità simulazione
Nelle proprietà metti `InpEnableTrading = false` (oppure lascialo true e
clicca "Trading: OFF" sul pannello), imposta un orario vicino in
`InpEvent1Time`, riavvia l'EA, e guarda la scheda **"Esperti"** in basso in
MT5: dovresti vedere i log con il range calcolato e i prezzi che avrebbe
piazzato.

### 6. Test reale su demo
Metti `InpEnableTrading = true` (o clicca "Trading: ON" sul pannello) su un
conto **demo**, imposta l'orario vero della prossima news, e verifica il
giorno dell'evento che gli ordini pendenti compaiano davvero nella scheda
"Trade".

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
> Forex Factory) prima di scriverlo nelle proprietà.

## Tabella degli input (tutte le impostazioni si fanno qui)

| Input | Descrizione |
|---|---|
| `InpEvent1Time` / `InpEvent2Time` | Orario italiano (`HH:MM`) dell'evento, riferito a oggi (o domani se già passato). |
| `InpServerMinusItalyMin` | Differenza in minuti server−Italia. |
| `InpLookbackMinutes` | Minuti da osservare prima della notizia (default 10 = 2 candele M5). |
| `InpSecondsBeforeNews` | Secondi prima della notizia in cui si congela il range e si piazzano gli ordini. |
| `InpPipsDistance` | Distanza in pips tra massimo/minimo e prezzo di entrata. |
| `InpLotSize` | Lotti per ogni ordine. |
| `InpStopLossPips` | Stop Loss in pips (0 = nessuno). |
| `InpTakeProfitPips` | Take Profit finale in pips (0 = nessuno). |
| `InpPartialClosePercent` | % di posizione da chiudere al target parziale (0 = disabilitata). |
| `InpPartialTriggerPips` | Pips di profitto per far scattare la chiusura parziale. |
| `InpMoveToBreakevenAfterPartial` | Stato iniziale del pulsante BE (poi commutabile dal pannello). |
| `InpExpirationMinutes` | Minuti dopo la notizia dopo cui annullare gli ordini non eseguiti. |
| `InpSlippagePoints` | Deviazione massima consentita in punti. |
| `InpMagicNumber` | Magic number per identificare gli ordini dell'EA. |
| `InpEnableTrading` | Stato iniziale del pulsante Trading ON/OFF. |
| `InpShowPanel`, `InpPanelX`, `InpPanelY`, `InpPanelScale` | Mostra/posiziona/ridimensiona il pannello (sola lettura) sul grafico. |

## Note sulla gestione del rischio

- Imposta sempre uno Stop Loss coerente con il tuo money management:
  durante le news lo spread e lo slippage possono aumentare molto.
- La chiusura parziale + spostamento a pareggio riduce il rischio dopo un
  primo movimento a favore, ma non lo elimina: resta comunque uno Stop
  Loss iniziale.
- Puoi far girare l'EA su più grafici/simboli contemporaneamente (uno per
  simbolo), usando `InpMagicNumber` diversi se vuoi distinguerli nella
  cronologia.
- Ogni evento va reimpostato nelle proprietà prima della news successiva:
  non essendoci una data memorizzata, l'orario vale solo per la giornata in
  cui riavvii l'EA (o per il giorno dopo, se l'hai scritto quando l'orario
  di oggi era già passato).
