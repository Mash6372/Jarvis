# NewsStraddleEA — Bot MT5 per NFP / FOMC

Expert Advisor per MetaTrader 5 che automatizza la strategia "straddle sulle
news": osserva le ultime candele a 5 minuti prima di un dato orario (NFP o
FOMC), calcola massimo e minimo del range e, pochi secondi prima dell'uscita
della notizia, piazza due ordini pendenti (Buy Stop sopra il massimo, Sell
Stop sotto il minimo) a una distanza in pips configurabile. Quando uno dei
due scatta, l'altro viene cancellato automaticamente (logica OCO).

**Novità versione 2.0: zero configurazione manuale delle date.** Di default
(`InpAutoFetchFromCalendar = true`) l'EA trova da solo il prossimo NFP e il
prossimo FOMC leggendo il **Calendario Economico integrato di MT5** (lo
stesso che vedi in *Vista → Calendario Economico*), e calcola l'orario
esatto sul server del tuo broker usando l'orario GMT del terminale — non
devi inserire nessuna data né calcolare differenze di fuso orario a mano.
La modalità manuale (con date e orario italiano inseriti da te) resta
disponibile come riserva, per il caso in cui il calendario del tuo broker
non sia disponibile.

## Come funziona, passo per passo

1. **Modalità automatica (default):** l'EA cerca nel Calendario Economico
   di MT5 l'evento "Nonfarm Payrolls" per gli USA e l'evento della decisione
   sui tassi FOMC ("Interest Rate Decision"), prende le prossime date
   programmate (fino a `InpCalendarLookaheadDays` giorni avanti) e le
   converte automaticamente nell'orario del server del tuo broker
   (usando `TimeGMT()`, l'orario GMT reale che il terminale conosce sempre,
   a prescindere dal fuso orario del broker). Ricontrolla il calendario ogni
   `InpCalendarRefreshHours` ore per scoprire nuove date pubblicate.
2. Per ogni evento, calcola in tempo reale il massimo e il minimo delle
   candele M5 comprese nella finestra `[orario_notizia − 10min,
   orario_notizia)`. Con i valori di default (10 minuti) corrisponde
   esattamente alle due candele che descrivi tu: es. per le 14:30 guarda le
   candele 14:20–14:25 e 14:25–14:30, aggiornando il massimo/minimo in
   tempo reale mentre la seconda candela è ancora in formazione.
3. Quando mancano `InpSecondsBeforeNews` secondi alla notizia (default 3),
   l'EA congela il range e piazza:
   - **Buy Stop** = massimo range + `InpPipsDistance` pips
   - **Sell Stop** = minimo range − `InpPipsDistance` pips
4. Se uno dei due ordini viene eseguito, l'altro viene cancellato subito.
5. Se nessuno dei due scatta entro `InpExpirationMinutes` minuti dalla
   notizia, entrambi vengono cancellati automaticamente.

## Setup passo-passo su MetaTrader 5

### 1. Copia il file e compila
*File → Apri cartella dati* → `MQL5/Experts/` → copia lì
`NewsStraddleEA.mq5`. Apri MetaEditor, F7, verifica "0 errori".

### 2. Attiva il Calendario Economico nel terminale
In MT5 apri *Vista → Calendario Economico* (o *Toolbox* in basso e la
scheda "Calendario"). Deve mostrare eventi con date reali (serve una
connessione internet attiva). Se questa finestra è vuota o non esiste nel
tuo terminale, il tuo broker potrebbe non supportare il calendario
integrato: in tal caso usa la modalità manuale (vedi sotto).

### 3. Apri il grafico e trascina l'EA
Apri un grafico (es. EURUSD — il timeframe visualizzato non conta, l'EA
legge sempre M5 internamente), trascina `NewsStraddleEA` sul grafico,
spunta **"Consenti Trading algoritmico"** e assicurati che l'AutoTrading
sia attivo nella toolbar.

### 4. Verifica che l'EA trovi gli eventi giusti
Lascia `InpAutoFetchFromCalendar = true` e, la prima volta, metti anche
`InpListUSEventsOnInit = true`. Guarda la scheda "Esperti" in basso in
MT5 dopo l'avvio: vedrai l'elenco di tutti gli eventi USA nel calendario
con il loro nome esatto, e subito dopo i messaggi
`NewsStraddleEA [NFP]: evento trovato dal Calendario -> ...` e
`NewsStraddleEA [FOMC]: evento trovato dal Calendario -> ...`.

- Se **non** compaiono questi messaggi (compare invece "nessun evento
  trovato... keyword"), cerca nell'elenco appena stampato il nome esatto
  dell'evento NFP (di solito "Nonfarm Payrolls") e di quello FOMC (di
  solito qualcosa come "Interest Rate Decision" o "Fed Interest Rate
  Decision") e copia una parte di quel testo in `InpNFPKeyword` /
  `InpFOMCKeyword`.
- Una volta che funziona, puoi rimettere `InpListUSEventsOnInit = false`
  per non riempire il log ad ogni avvio.

### 5. Prima prova: modalità simulazione
Lascia `InpEnableTrading = false` per una settimana o finché non arriva
il prossimo NFP/FOMC vero, e guarda nel log della scheda "Esperti" i
livelli che l'EA avrebbe piazzato — senza rischiare soldi.

### 6. Test reale su demo
Passa a `InpEnableTrading = true` su un conto **demo** e verifica, il
giorno della notizia, che gli ordini pendenti compaiano davvero nella
scheda "Trade" pochi secondi prima dell'orario.

### 7. Solo dopo, conto reale
Una volta soddisfatto del comportamento su demo, puoi passare a un conto
vero — controllando bene lotto (`InpLotSize`) e stop loss
(`InpStopLossPips`) coerenti con il tuo money management.

## Modalità manuale (fallback)

Se il Calendario Economico del tuo broker non è disponibile o non trova gli
eventi giusti, imposta `InpAutoFetchFromCalendar = false`. In questo caso
devi:

1. Trovare la differenza in minuti tra l'orario del server MT5 e l'orario
   italiano: guarda l'orologio del terminale (in basso a destra, o l'orario
   di una candela M1 in formazione) e confrontalo con l'ora italiana
   attuale. Esempio: server 13:32, Italia 12:32 → `InpServerMinusItalyMin
   = 60`.
2. Inserire a mano le date in `InpNFPDatesManual` e `InpFOMCDatesManual`
   (formato `YYYY.MM.DD`, separate da virgola), lasciando `InpNFPTimeItaly
   = "14:30"` e `InpFOMCTimeItaly = "20:00"` (raramente serve cambiarli).

> ⚠️ NFP (8:30 ET) e FOMC (14:00 ET) cadono su 14:30/20:00 italiane per
> quasi tutto l'anno perché USA e Europa spostano l'ora legale con circa
> una settimana di scarto. Nelle 1-2 settimane intorno ai cambi di ora
> (metà marzo e fine ottobre/inizio novembre) l'orario italiano reale può
> spostarsi di **un'ora**: in quelle settimane, sia in modalità automatica
> che manuale, ricontrolla l'orario esatto su un calendario economico (es.
> Forex Factory) prima di fidarti ciecamente del bot.

## Tabella completa degli input

| Input | Descrizione |
|---|---|
| `InpAutoFetchFromCalendar` | true = prende le date dal Calendario Economico di MT5; false = usa le date manuali. |
| `InpListUSEventsOnInit` | Stampa nel log tutti gli eventi USA del calendario, utile per trovare la keyword esatta. |
| `InpNFPKeyword` / `InpFOMCKeyword` | Parola chiave (case-insensitive) da cercare nel nome dell'evento nel calendario. |
| `InpNFPDatesManual` / `InpFOMCDatesManual` | Date inserite a mano (solo modalità manuale). |
| `InpNFPTimeItaly` / `InpFOMCTimeItaly` | Orario italiano fisso (solo modalità manuale). |
| `InpCalendarLookaheadDays` | Giorni in avanti in cui cercare i prossimi eventi nel calendario. |
| `InpCalendarRefreshHours` | Ogni quante ore ricontrollare il calendario per nuove date. |
| `InpServerMinusItalyMin` | Differenza in minuti server−Italia (solo modalità manuale). |
| `InpLookbackMinutes` | Minuti da osservare prima della notizia (default 10 = 2 candele M5). |
| `InpSecondsBeforeNews` | Secondi prima della notizia in cui si congela il range e si piazzano gli ordini (default 3). |
| `InpPipsDistance` | Distanza in pips tra massimo/minimo e prezzo di entrata degli ordini pendenti. |
| `InpLotSize` | Lotti per ciascun ordine. |
| `InpStopLossPips` | Stop Loss in pips (0 = nessuno — **sconsigliato lasciarlo a 0**). |
| `InpTakeProfitPips` | Take Profit in pips (0 = nessuno). |
| `InpExpirationMinutes` | Minuti dopo la notizia dopo cui annullare gli ordini non eseguiti. |
| `InpSlippagePoints` | Deviazione massima consentita in punti. |
| `InpMagicNumber` | Magic number per identificare gli ordini dell'EA. |
| `InpEnableTrading` | Se `false`, calcola e stampa i livelli senza inviare ordini reali. |

## Note sulla gestione del rischio

- Imposta sempre uno `InpStopLossPips` coerente con il tuo money management:
  durante NFP/FOMC lo spread e lo slippage possono aumentare molto, quindi
  l'esecuzione potrebbe avvenire a un prezzo peggiore di quello dell'ordine.
- `InpExpirationMinutes` evita di restare con ordini pendenti "vecchi" se il
  mercato non si muove abbastanza per attivarli.
- In modalità automatica, controlla ogni tanto la scheda "Esperti" per
  assicurarti che continui a trovare i prossimi eventi (soprattutto se il
  tuo broker aggiorna il calendario con ritardo).
- Puoi far girare l'EA su più grafici/simboli contemporaneamente (uno per
  simbolo), usando `InpMagicNumber` diversi se vuoi distinguerli nella
  cronologia.
