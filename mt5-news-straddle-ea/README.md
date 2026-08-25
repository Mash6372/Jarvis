# NewsStraddleEA — Bot MT5 per NFP / FOMC

Expert Advisor per MetaTrader 5 che automatizza la strategia "straddle sulle news":
osserva le ultime candele a 5 minuti prima di un dato orario (es. NFP o FOMC),
calcola massimo e minimo del range e, pochi secondi prima dell'uscita della
notizia, piazza due ordini pendenti (Buy Stop sopra il massimo, Sell Stop
sotto il minimo) a una distanza in pips configurabile. Quando uno dei due
scatta, l'altro viene cancellato automaticamente (logica OCO).

## Come funziona, passo per passo

1. Configuri nell'input `InpNewsTimes` l'elenco degli orari delle notizie
   (uno o più, separati da virgola), **nell'orario del server del tuo broker**.
2. Per ogni evento, l'EA calcola in tempo reale il massimo e il minimo delle
   candele M5 comprese nella finestra `[orario_notizia - InpLookbackMinutes,
   orario_notizia)`. Con i valori di default (10 minuti) corrisponde
   esattamente alle due candele che descrivi tu: es. per una notizia delle
   14:30 guarda le candele 14:20–14:25 e 14:25–14:30, aggiornando il
   massimo/minimo tick per tick mentre la seconda candela è ancora in
   formazione.
3. Quando mancano `InpSecondsBeforeNews` secondi alla notizia (default 3),
   l'EA congela il range e piazza:
   - **Buy Stop** = massimo range + `InpPipsDistance` pips
   - **Sell Stop** = minimo range − `InpPipsDistance` pips
4. Se uno dei due ordini viene eseguito, l'altro viene cancellato subito.
5. Se nessuno dei due scatta entro `InpExpirationMinutes` minuti dalla
   notizia, entrambi vengono cancellati automaticamente.

## Installazione

1. Copia `NewsStraddleEA.mq5` nella cartella
   `MQL5/Experts/` del tuo terminale MetaTrader 5
   (in MT5: *File → Apri cartella dati → MQL5 → Experts*).
2. In MetaEditor compila il file (F7). Deve compilare senza errori.
3. Apri il grafico del simbolo desiderato (es. EURUSD) — **il timeframe del
   grafico non è rilevante**, l'EA legge sempre le candele M5 direttamente,
   indipendentemente dal timeframe visualizzato.
4. Trascina l'EA sul grafico, abilita "Consenti Trading algoritmico" e
   imposta gli input (vedi sotto).

## Input principali

| Input | Descrizione |
|---|---|
| `InpNewsTimes` | Elenco orari notizia, formato `YYYY.MM.DD HH:MM`, separati da virgola. **Orario del server del broker**, non il tuo orario locale. |
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

## ⚠️ Importante: orario del server

MetaTrader 5 lavora sempre con l'orario del server del broker (`TimeCurrent()`),
che quasi mai coincide con il tuo orario locale o con il GMT. Prima di ogni
evento:

1. Guarda l'orologio in basso a destra del terminale (o l'orario delle
   candele sul grafico) per sapere l'orario "server" attuale.
2. Calcola la differenza rispetto all'orario ufficiale della notizia (es. NFP
   pubblicato alle 8:30 ET, FOMC alle 14:00 ET) e converti in orario server.
3. Inserisci l'orario già convertito in `InpNewsTimes`.

Un errore di conversione dell'orario è la causa più comune di
malfunzionamento: se sbagli l'orario, l'EA piazzerà gli ordini nel momento
sbagliato (troppo presto, calcolando un range "vuoto" o sbagliato, oppure
troppo tardi, perdendo l'evento).

## Note sulla gestione del rischio

- Imposta sempre uno `InpStopLossPips` coerente con il tuo money management:
  durante NFP/FOMC lo spread e lo slippage possono aumentare molto, quindi
  l'esecuzione potrebbe avvenire a un prezzo peggiore di quello dell'ordine.
- `InpExpirationMinutes` evita di restare con ordini pendenti "vecchi" se il
  mercato non si muove abbastanza per attivarli.
- Prova prima su un conto demo con `InpEnableTrading=false` per controllare
  nel tab "Esperti" i livelli calcolati, poi passa a `true`.
- Puoi far girare l'EA su più grafici/simboli contemporaneamente (uno per
  simbolo), usando `InpMagicNumber` diversi se vuoi distinguerli nella
  cronologia.

## Esempio: NFP alle 14:30 (orario server)

```
InpNewsTimes = "2026.09.04 14:30"
InpLookbackMinutes = 10
InpSecondsBeforeNews = 3
InpPipsDistance = 3
```

L'EA guarderà le candele M5 14:20–14:25 e 14:25–14:30, congelerà il range
alle 14:29:57 e piazzerà i due ordini pendenti.

## Esempio: più eventi (NFP + FOMC) sullo stesso grafico

```
InpNewsTimes = "2026.09.04 14:30, 2026.09.17 20:00"
```

L'EA gestisce gli eventi in ordine cronologico automaticamente, uno alla
volta.
