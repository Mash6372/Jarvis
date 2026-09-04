# Bot MT5 per news ad alto impatto (NFP, FOMC, ecc.)

Due Expert Advisor gemelli per MetaTrader 5, stessa strategia "straddle
sulle news", ognuno pensato per il tipo di strumento giusto:

- **`Aquila.mq5`** — per le coppie forex (EURUSD, GBPUSD, ecc.). Le distanze
  (tra massimo/minimo e prezzo di entrata, Stop Loss, Take Profit, trigger
  di chiusura parziale) si esprimono in **pips**.
- **`Aurum.mq5`** — dedicato all'**oro (XAUUSD/GOLD)**. Le stesse distanze
  si esprimono in **dollari diretti sul prezzo**, non in pips.

> ⚠️ **Perché due file separati e non uno solo con un interruttore
> forex/oro?** Perché il concetto di "pip" del forex non si applica in modo
> affidabile all'oro: a seconda del broker XAUUSD può avere 2 o 3 decimali,
> e la stessa formula usata per convertire pips in prezzo può calcolare una
> distanza reale di pochi **centesimi** di dollaro invece che dollari
> interi. È esattamente quello che è successo usando Aquila sull'oro: gli
> ordini finivano piazzati a pochi centesimi dal massimo/minimo, quindi
> scattavano quasi subito col semplice rumore di prezzo. Aurum evita il
> problema alla radice usando dollari diretti, senza nessuna conversione
> ambigua. **Usa sempre Aquila sul forex e Aurum sull'oro — mai il
> contrario.**

Entrambi funzionano allo stesso identico modo (stesso pannello, stessa
logica OCO, stessa chiusura parziale) — cambiano solo le unità di misura
delle distanze. Le istruzioni sotto usano Aquila come esempio, ma valgono
identiche per Aurum (vedi la tabella input dedicata più in basso per le
differenze).

Expert Advisor che automatizza la strategia "straddle sulle news": il
giorno in cui esce una notizia ad alto impatto, osserva le ultime candele a
5 minuti prima dell'orario di uscita, calcola massimo e minimo del range e,
3 secondi prima, piazza due ordini pendenti (Buy Stop sopra il massimo,
Sell Stop sotto il minimo). Quando uno dei due scatta, l'altro viene
cancellato automaticamente (logica OCO). Include anche la chiusura parziale
automatica a un target, con spostamento opzionale dello Stop Loss a
pareggio sul resto della posizione.

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

## Tabella degli input — Aquila (forex, distanze in pips)

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

## Tabella degli input — Aurum (oro)

Stessa logica, stesso pannello. Cambia il modo in cui si esprime la
**distanza tra massimo/minimo e prezzo di entrata**: invece di un numero
fisso, è l'**equivalente in tempo reale di N pips di EURUSD**, ricalcolato
ogni volta sul prezzo attuale dell'oro. L'EA legge il prezzo di EURUSD e
dell'oro, calcola che percentuale di movimento rappresentano quei pips su
EURUSD (es. 3 pips a EURUSD=1.0800 sono lo 0.0278% del prezzo), e applica
la stessa percentuale al prezzo dell'oro (a XAUUSD=2650 diventano circa
2650 × 0.0278% ≈ 0.74$). Così la distanza si adatta da sola sia al livello
di prezzo dell'oro sia a quello di EURUSD, invece di restare un numero
fisso che andrebbe ricalcolato a mano ogni volta che i prezzi cambiano.
Stop Loss, Take Profit e trigger di chiusura parziale restano invece in
**dollari diretti**, perché sul rischio in denaro ha senso ragionare in
dollari, non in "pips equivalenti".

Il pannello mostra sempre, in tempo reale, sia i pips impostati sia il
loro equivalente attuale in dollari (riga "Distanza").

| Input | Descrizione |
|---|---|
| `InpNewsTime` | Come sopra. |
| `InpServerMinusItalyMin` | Come sopra. |
| `InpDistanceEurUsdPips` | Distanza espressa come pips di EURUSD (default 3.0), ricalcolata in dollari sull'oro in tempo reale. |
| `InpEurUsdSymbol` | Nome esatto del simbolo EURUSD sul tuo broker (default `"EURUSD"` — cambialo se nel tuo Market Watch si chiama diversamente, es. `EURUSD.a`). |
| `InpLotSize` | Lotti per ogni ordine. |
| `InpStopLossUSD` | Stop Loss in **dollari** (0 = nessuno, default 5.00). |
| `InpTakeProfitUSD` | Take Profit finale in **dollari** (0 = nessuno). |
| `InpPartialClosePercent` | % di posizione da chiudere al target parziale (0 = disabilitata). |
| `InpPartialTriggerUSD` | **Dollari** di profitto per far scattare la chiusura parziale (default 3.00). |
| `InpEnableTrading` | Stato iniziale del pulsante Trading ON/OFF. |

> Nota: se il tuo broker non ha EURUSD nel Market Watch con quel nome
> esatto, l'EA non riesce a leggerne il prezzo e usa un valore di
> fallback fisso (1.0800) — controlla nel log della scheda "Esperti" che
> la distanza calcolata sia sensata (qualche decimo/un dollaro, non
> pochi centesimi) prima di fidarti.

Tutto il resto (finestra di osservazione, secondi di anticipo, scadenza
ordini, slippage, magic number) è fissato a valori sensati e non compare
più tra gli input, per tenere le proprietà semplici — su entrambi gli EA.

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
