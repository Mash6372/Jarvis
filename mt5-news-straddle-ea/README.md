# NewsStraddleEA — Bot MT5 per NFP / FOMC

Expert Advisor per MetaTrader 5 che automatizza la strategia "straddle sulle news":
osserva le ultime candele a 5 minuti prima di un dato orario (NFP o FOMC),
calcola massimo e minimo del range e, pochi secondi prima dell'uscita della
notizia, piazza due ordini pendenti (Buy Stop sopra il massimo, Sell Stop
sotto il minimo) a una distanza in pips configurabile. Quando uno dei due
scatta, l'altro viene cancellato automaticamente (logica OCO).

L'EA ha **due sezioni separate**:
- **NFP** — esce sempre alle **14:30 ora italiana**, inserisci solo le date.
- **FOMC** — esce sempre alle **20:00 ora italiana**, inserisci solo le date.

L'orario italiano viene convertito automaticamente nell'orario del server
del tuo broker (vedi sezione "Fuso orario" più sotto): non devi più
calcolare tu la conversione per ogni evento.

> ⚠️ NFP (8:30 ET) e FOMC (14:00 ET) cadono su 14:30/20:00 italiane per
> quasi tutto l'anno perché USA e Europa spostano l'ora legale con circa
> una settimana di scarto. Nelle 1-2 settimane intorno ai cambi di ora
> (metà marzo e fine ottobre/inizio novembre) l'orario italiano reale può
> spostarsi di **un'ora**: in quelle settimane controlla l'orario esatto su
> un calendario economico (es. Forex Factory) prima di fidarti del default.

## Come funziona, passo per passo

1. Per ogni data che inserisci in `InpNFPDates` o `InpFOMCDates`, l'EA la
   combina con l'orario fisso della categoria (14:30 o 20:00 italiane) e la
   converte in orario server usando `InpServerMinusItalyMin`.
2. Per ogni evento, calcola in tempo reale il massimo e il minimo delle
   candele M5 comprese nella finestra `[orario_notizia − 10min,
   orario_notizia)`. Con i valori di default (10 minuti) corrisponde
   esattamente alle due candele che descrivi tu: es. per le 14:30 guarda le
   candele 14:20–14:25 e 14:25–14:30, aggiornando il massimo/minimo tick per
   tick mentre la seconda candela è ancora in formazione.
3. Quando mancano `InpSecondsBeforeNews` secondi alla notizia (default 3),
   l'EA congela il range e piazza:
   - **Buy Stop** = massimo range + `InpPipsDistance` pips
   - **Sell Stop** = minimo range − `InpPipsDistance` pips
4. Se uno dei due ordini viene eseguito, l'altro viene cancellato subito.
5. Se nessuno dei due scatta entro `InpExpirationMinutes` minuti dalla
   notizia, entrambi vengono cancellati automaticamente.

## Setup passo-passo su MetaTrader 5

### 1. Copia il file nella cartella giusta
In MT5: *File → Apri cartella dati* → apri `MQL5/Experts/` → copia lì
`NewsStraddleEA.mq5`.

### 2. Compila
Apri MetaEditor (F4 da MT5), apri il file, premi **F7**. In basso deve
comparire "0 errori". Se ci sono errori, copiali e fatteli correggere.

### 3. Trova la differenza tra orario server e orario italiano
Questo è il passaggio più importante, da fare **una sola volta** (poi
resta valido finché il broker non cambia policy):

1. Guarda l'orario del server nel terminale MT5 — o l'orologio in basso a
   destra della piattaforma, o l'orario dell'ultima candela sul grafico
   (deve essere l'ora "adesso", guarda una candela M1 in formazione).
2. Confrontalo con l'ora italiana attuale (telefono/PC).
3. Calcola: `differenza_minuti = orario_server − orario_italiano` (in
   minuti). Esempio: se in Italia sono le 15:00 e il server MT5 segna le
   16:00, la differenza è **+60**.
4. Molti broker retail usano orario server EET (Europa orientale), che è
   Italia + 1 ora tutto l'anno: per questo il default nell'EA è già
   `InpServerMinusItalyMin = 60`. Verifica comunque il tuo caso specifico:
   alcuni broker usano GMT, GMT+3 fisso, o orario di New York.

### 4. Apri il grafico e trascina l'EA
- Apri il grafico del simbolo che vuoi tradare (es. EURUSD) — il timeframe
  visualizzato non conta, l'EA legge sempre M5 internamente.
- Trascina `NewsStraddleEA` dalla finestra Navigator sul grafico.
- Nella scheda "Common" spunta **"Consenti Trading algoritmico"** e
  assicurati che il pulsante "AutoTrading" nella toolbar di MT5 sia
  attivo (verde).

### 5. Configura gli input

Nella scheda "Inputs" della finestra dell'EA troverai i gruppi:

**Gruppo NFP**
- `InpEnableNFP` = true/false per abilitare o disabilitare questa categoria.
- `InpNFPDates` = elenco delle date dei prossimi NFP, **solo la data**,
  formato `YYYY.MM.DD`, separate da virgola. Esempio:
  `2026.09.04, 2026.10.02, 2026.11.06, 2026.12.04`
  (i venerdì di pubblicazione NFP li trovi su qualsiasi calendario
  economico, es. Forex Factory, ForexLive, Investing.com).
- `InpNFPTimeItaly` = "14:30" (di norma non serve cambiarlo).

**Gruppo FOMC**
- `InpEnableFOMC` = true/false.
- `InpFOMCDates` = elenco delle date delle riunioni FOMC (giorno di
  pubblicazione dello statement), stesso formato. Esempio:
  `2026.09.17, 2026.11.05, 2026.12.17`
- `InpFOMCTimeItaly` = "20:00" (di norma non serve cambiarlo).

**Gruppo Fuso orario**
- `InpServerMinusItalyMin` = il valore in minuti calcolato al punto 3.

**Altri gruppi** (finestra di osservazione, ordini pendenti, sicurezza):
uguali per entrambe le categorie — vedi tabella sotto.

| Input | Descrizione |
|---|---|
| `InpLookbackMinutes` | Minuti da osservare prima della notizia (default 10 = 2 candele M5). |
| `InpSecondsBeforeNews` | Secondi prima della notizia in cui si congela il range e si piazzano gli ordini (default 3). |
| `InpPipsDistance` | Distanza in pips tra massimo/minimo e prezzo di entrata degli ordini pendenti. |
| `InpLotSize` | Lotti per ciascun ordine (Buy Stop e Sell Stop hanno lo stesso volume). |
| `InpStopLossPips` | Stop Loss in pips da ciascun prezzo di entrata (0 = nessuno — **sconsigliato lasciarlo a 0**). |
| `InpTakeProfitPips` | Take Profit in pips (0 = nessuno, gestione manuale/trailing). |
| `InpExpirationMinutes` | Minuti dopo la notizia dopo cui annullare gli ordini non eseguiti. |
| `InpSlippagePoints` | Deviazione massima consentita in punti. |
| `InpMagicNumber` | Magic number per identificare gli ordini dell'EA. |
| `InpEnableTrading` | Se `false`, l'EA calcola e stampa nel log i livelli ma **non invia ordini reali** — utile per verificare il comportamento prima di usarlo su un conto vero. |

### 6. Prima prova: modalità simulazione
Lascia `InpEnableTrading = false` e metti in `InpNFPDates` una data/ora
fittizia vicina (es. tra 5-10 minuti da adesso, ricordando che userà
comunque l'orario fisso 14:30 — per un test rapido puoi temporaneamente
cambiare `InpNFPTimeItaly` con l'orario italiano tra pochi minuti). Guarda
la scheda "Esperti" in basso in MT5: dovresti vedere i log con il range
calcolato e i prezzi che avrebbe piazzato.

### 7. Test reale su demo
Rimetti gli orari giusti (14:30/20:00), passa a `InpEnableTrading = true`
su un conto **demo**, e nel giorno della prossima notizia lascia MT5 acceso
e collegato per tempo. Verifica nella scheda "Trade" che gli ordini
pendenti compaiano davvero pochi secondi prima dell'orario.

### 8. Solo dopo, conto reale
Una volta soddisfatto del comportamento su demo, puoi passare a un conto
vero — controllando bene lotto (`InpLotSize`) e stop loss
(`InpStopLossPips`) coerenti con il tuo money management.

## Note sulla gestione del rischio

- Imposta sempre uno `InpStopLossPips` coerente con il tuo money management:
  durante NFP/FOMC lo spread e lo slippage possono aumentare molto, quindi
  l'esecuzione potrebbe avvenire a un prezzo peggiore di quello dell'ordine.
- `InpExpirationMinutes` evita di restare con ordini pendenti "vecchi" se il
  mercato non si muove abbastanza per attivarli.
- Ricordati di aggiornare `InpNFPDates`/`InpFOMCDates` ogni mese con le
  nuove date: l'EA non le genera da solo, vanno inserite a mano guardando
  un calendario economico.
- Puoi far girare l'EA su più grafici/simboli contemporaneamente (uno per
  simbolo), usando `InpMagicNumber` diversi se vuoi distinguerli nella
  cronologia.
