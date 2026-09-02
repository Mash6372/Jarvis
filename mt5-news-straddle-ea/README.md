# Aquila — Bot MT5 per news ad alto impatto (NFP, FOMC, ecc.)

Expert Advisor per MetaTrader 5 che automatizza la strategia "straddle sulle
news": il giorno in cui esce una notizia ad alto impatto, osserva le ultime
candele a 5 minuti prima dell'orario di uscita, calcola massimo e minimo del
range e, 3 secondi prima, piazza due ordini pendenti (Buy Stop sopra il
massimo, Sell Stop sotto il minimo). Quando uno dei due scatta, l'altro
viene cancellato automaticamente (logica OCO). Include anche la chiusura
parziale automatica a un target di pips, con spostamento opzionale dello
Stop Loss a pareggio sul resto della posizione.

**Semplicissimo: un solo campo da cambiare ogni volta.** Il giorno in cui
devi usarlo, apri le proprietà dell'EA, scrivi l'orario italiano di uscita
della notizia in `InpNewsTime` (es. `14:30`), premi OK — l'EA si mette
subito a osservare il mercato. Nessuna data, nessun NFP/FOMC da
selezionare, nessuna casella da compilare sul grafico: tutto nelle
proprietà, il resto lo fa da solo.

## Come funziona, passo per passo

1. Nelle proprietà dell'EA scrivi l'orario italiano di oggi (formato
   `HH:MM`, es. `14:30`) in `InpNewsTime`.
2. All'avvio l'EA calcola l'orario "adesso" in Italia (usando l'orario del
   server meno la differenza minuti indicata in `InpServerMinusItalyMin`)
   per sapere qual è **oggi**, e lo combina con l'orario scritto. Se
   quell'orario è già passato da più di 15 minuti, lo sposta
   automaticamente a **domani**.
3. Da quel momento osserva in tempo reale le candele M5 comprese nella
   finestra dei 10 minuti precedenti l'orario indicato (le due candele da
   5 minuti prima della notizia), aggiornando il massimo/minimo mentre la
   seconda è ancora in formazione.
4. 3 secondi prima dell'orario, congela il range e piazza:
   - **Buy Stop** = massimo range + `InpPipsDistance` pips
   - **Sell Stop** = minimo range − `InpPipsDistance` pips
5. Se uno dei due ordini viene eseguito, l'altro viene cancellato subito.
6. Se nessuno dei due scatta entro 15 minuti, entrambi vengono cancellati.
7. Se una posizione si apre e raggiunge il target di `InpPartialTriggerPips`,
   l'EA chiude automaticamente `InpPartialClosePercent`% della posizione e
   (se il pulsante BE è attivo) sposta lo Stop Loss a pareggio sul resto.

**Per usarlo di nuovo alla prossima notizia:** apri di nuovo le proprietà
dell'EA (doppio clic sull'EA nel grafico, o clic destro sul grafico →
Expert Advisors → Properties), cambia `InpNewsTime` con il nuovo orario e
premi OK — l'EA si ricarica e riarma per oggi.

## Setup passo-passo su MetaTrader 5

### 1. Copia il file e compila
*File → Apri cartella dati* → `MQL5/Experts/` → copia lì
`Aquila.mq5`. Apri MetaEditor, premi **F7**, verifica "0 errori".

### 2. Attacca l'EA al grafico
Apri un grafico (es. EURUSD — il timeframe visualizzato non conta, l'EA
legge sempre M5 internamente). Nel Navigator di MT5 (Ctrl+N), sotto
"Expert Advisors", fai doppio clic su **Aquila**. Nella finestra
che si apre:
- scheda **Inputs** → imposta `InpNewsTime`, `InpServerMinusItalyMin` e
  gli altri parametri (vedi tabella sotto)
- scheda **Common** → spunta "Consenti Trading algoritmico"
- assicurati che il pulsante **"Algo Trading"** nella barra degli
  strumenti in alto di MT5 sia attivo (altrimenti l'EA non potrà mai
  operare, qualsiasi cosa tu imposti)

### 3. Il pannello sul grafico (sola lettura + 2 pulsanti)
Appena l'EA parte, in alto a sinistra del grafico compare:
- Modalità: LIVE o SIMULAZIONE
- Notizia: countdown all'orario impostato, oppure "ordini piazzati" /
  "posizione aperta" / "non impostato"
- Range (massimo/minimo) trovato, appena disponibile
- I valori attivi: distanza pips, lotto, stop loss, take profit, parziale

**Pulsanti:**
- **Trading: ON/OFF** — accende/spegne l'invio di ordini reali senza
  dover riavviare l'EA (se OFF, l'EA calcola comunque i livelli e li
  scrive nel log, ma non invia nulla al broker)
- **Annulla** — pulsante di emergenza: cancella gli ordini pendenti e
  chiude l'eventuale posizione aperta

**Linee sul grafico:** mentre osserva le candele, l'EA disegna anche
direttamente sul prezzo:
- una linea **azzurra punteggiata** sul massimo e una sul minimo del range
  che sta tracciando;
- una linea **verde** (Buy Stop) e una **rossa** (Sell Stop) ai livelli di
  ingresso: **tratteggiate** finché sono solo un'anteprima, **continue**
  una volta che gli ordini sono davvero stati inviati al broker;
- quando uno dei due scatta e diventa una posizione, resta visibile solo
  la linea del prezzo di ingresso realmente eseguito.

Le linee spariscono automaticamente quando l'evento si conclude.

### 4. Trova la differenza server/Italia (una tantum)
Guarda l'orologio del server nel terminale MT5, confrontalo con l'ora
italiana attuale. Esempio: server 13:32, Italia 12:32 → differenza **60**
minuti. Scrivi questo valore in `InpServerMinusItalyMin` nelle proprietà —
non cambia quasi mai, lo imposti una volta sola.

### 5. Prima prova: modalità simulazione
Nelle proprietà metti `InpEnableTrading = false` (oppure lascialo true e
clicca "Trading: OFF" sul pannello), imposta un orario vicino in
`InpNewsTime`, riavvia l'EA, e guarda la scheda **"Esperti"** in basso in
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
> Forex Factory) prima di scriverlo in `InpNewsTime`.

## Tabella degli input (tutte le impostazioni si fanno qui)

| Input | Descrizione |
|---|---|
| `InpNewsTime` | Orario italiano (`HH:MM`) dell'uscita della notizia, riferito a oggi (o domani se già passato). **È l'unico campo che cambi ogni volta.** |
| `InpServerMinusItalyMin` | Differenza in minuti server−Italia (si imposta una volta sola). |
| `InpPipsDistance` | Distanza in pips tra massimo/minimo e prezzo di entrata. |
| `InpLotSize` | Lotti per ogni ordine. |
| `InpStopLossPips` | Stop Loss in pips (0 = nessuno). |
| `InpTakeProfitPips` | Take Profit finale in pips (0 = nessuno). |
| `InpPartialClosePercent` | % di posizione da chiudere al target parziale (0 = disabilitata). |
| `InpPartialTriggerPips` | Pips di profitto per far scattare la chiusura parziale. |
| `InpEnableTrading` | Stato iniziale del pulsante Trading ON/OFF. |

Tutto il resto (finestra di osservazione, secondi di anticipo, scadenza
ordini, slippage, magic number) è fissato a valori sensati e non compare
più tra gli input, per tenere le proprietà semplici.

## Note sulla gestione del rischio

- Imposta sempre uno Stop Loss coerente con il tuo money management:
  durante le news lo spread e lo slippage possono aumentare molto.
- La chiusura parziale + spostamento a pareggio riduce il rischio dopo un
  primo movimento a favore, ma non lo elimina: resta comunque uno Stop
  Loss iniziale.
- Puoi far girare l'EA su più grafici/simboli contemporaneamente (uno per
  simbolo): ognuno traccia il proprio orario impostato in `InpNewsTime`.
- Ogni notizia va reimpostata nelle proprietà prima della successiva: non
  essendoci una data memorizzata, l'orario vale solo per la giornata in
  cui riavvii l'EA (o per il giorno dopo, se l'hai scritto quando l'orario
  di oggi era già passato).
