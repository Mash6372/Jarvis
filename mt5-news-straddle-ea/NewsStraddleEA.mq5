//+------------------------------------------------------------------+
//|                                           NewsStraddleEA.mq5      |
//|  Strategia "straddle" per news ad alto impatto (NFP, FOMC, ecc.) |
//|                                                                    |
//|  Per ogni evento programmato, l'EA:                               |
//|   1) tiene sotto osservazione le ultime N candele M5 precedenti   |
//|      l'orario della notizia (default: 10 minuti = 2 candele),     |
//|      aggiornando in tempo reale massimo e minimo raggiunti;       |
//|   2) pochi secondi prima dell'orario della notizia (default 3)    |
//|      congela il range e piazza due ordini pendenti in OCO:        |
//|        - Buy Stop = massimo range + X pips                        |
//|        - Sell Stop = minimo range - X pips                        |
//|   3) quando uno dei due ordini viene eseguito, cancella l'altro;  |
//|   4) se nessuno dei due scatta entro un tempo massimo dalla       |
//|      notizia, cancella entrambi gli ordini pendenti.              |
//+------------------------------------------------------------------+
#property copyright "Jarvis"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//================================= INPUT ==================================

input group "=== NFP (esce sempre alle 14:30 ora italiana) ==="
input bool   InpEnableNFP            = true; // Abilita gli eventi NFP
input string InpNFPDates             = "2026.09.04, 2026.10.02, 2026.11.06, 2026.12.04"; // Date NFP (solo giorno, formato YYYY.MM.DD, separate da virgola)
input string InpNFPTimeItaly         = "14:30"; // Orario italiano di uscita NFP (HH:MM)

input group "=== FOMC (esce sempre alle 20:00 ora italiana) ==="
input bool   InpEnableFOMC           = true; // Abilita gli eventi FOMC
input string InpFOMCDates            = "2026.09.17, 2026.11.05, 2026.12.17"; // Date FOMC (solo giorno, formato YYYY.MM.DD, separate da virgola)
input string InpFOMCTimeItaly        = "20:00"; // Orario italiano di uscita FOMC (HH:MM)

input group "=== Fuso orario ==="
input int    InpServerMinusItalyMin  = 60;   // Differenza in MINUTI tra orario server del broker e orario italiano (server = italia + questo valore). Verifica il tuo broker!

input group "=== Finestra di osservazione ==="
input int    InpLookbackMinutes      = 10;   // Minuti da guardare prima della notizia (10 = 2 candele M5)
input int    InpSecondsBeforeNews    = 3;    // Secondi prima della notizia in cui si congela il range e si piazzano gli ordini

input group "=== Ordini pendenti ==="
input double InpPipsDistance         = 3.0;  // Distanza in pips tra massimo/minimo e prezzo di entrata
input double InpLotSize              = 0.10; // Lotti per ogni ordine
input double InpStopLossPips         = 20.0; // Stop Loss in pips (0 = nessuno)
input double InpTakeProfitPips       = 0.0;  // Take Profit in pips (0 = nessuno)
input int    InpExpirationMinutes    = 15;   // Minuti dopo la notizia dopo i quali annullare gli ordini non eseguiti
input int    InpSlippagePoints       = 50;   // Deviazione massima in punti per l'invio ordini
input ulong  InpMagicNumber          = 20260825; // Magic number

input group "=== Sicurezza ==="
input bool   InpEnableTrading        = true; // false = simulazione: calcola i livelli ma non invia ordini reali

//================================ STATO =====================================

enum EventState
  {
   STATE_WAITING = 0, // in attesa, si aggiorna il range
   STATE_ARMED   = 1, // ordini piazzati, in attesa di esecuzione o scadenza
   STATE_DONE    = 2  // evento concluso
  };

struct NewsEvent
  {
   datetime    time;
   string      label;
   EventState  state;
   double      rangeHigh;
   double      rangeLow;
   bool        rangeValid;
   ulong       buyTicket;
   ulong       sellTicket;
  };

NewsEvent   g_events[];
int         g_activeIndex = -1;
CTrade      trade;

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);

   ArrayResize(g_events, 0);

   if(InpEnableNFP)
      AddEvents(InpNFPDates, InpNFPTimeItaly, "NFP");
   if(InpEnableFOMC)
      AddEvents(InpFOMCDates, InpFOMCTimeItaly, "FOMC");

   SortEvents();

   if(ArraySize(g_events) == 0)
     {
      Print("NewsStraddleEA: nessun evento valido trovato (controlla InpNFPDates/InpFOMCDates).");
      return(INIT_PARAMETERS_INCORRECT);
     }

   Print("NewsStraddleEA inizializzato con ", ArraySize(g_events), " evento/i.");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
  }

//+------------------------------------------------------------------+
//| Aggiunge a g_events gli eventi di una categoria (NFP o FOMC):     |
//| combina ogni data con l'orario italiano fisso e lo converte in    |
//| orario server usando InpServerMinusItalyMin.                      |
//+------------------------------------------------------------------+
void AddEvents(const string datesList, const string timeItaly, const string label)
  {
   string dates[];
   int n = StringSplit(datesList, ',', dates);

   for(int i = 0; i < n; i++)
     {
      string d = dates[i];
      StringTrimLeft(d);
      StringTrimRight(d);
      if(d == "")
         continue;

      datetime italyTime = StringToTime(d + " " + timeItaly);
      if(italyTime <= 0)
        {
         Print("NewsStraddleEA [", label, "]: data non valida ignorata: '", d, "'");
         continue;
        }

      datetime serverTime = italyTime + InpServerMinusItalyMin * 60;

      // scarta eventi già passati oltre la finestra di scadenza
      if(serverTime + InpExpirationMinutes * 60 < TimeCurrent())
        {
         Print("NewsStraddleEA [", label, "]: evento già passato ignorato: ", TimeToString(serverTime));
         continue;
        }

      int idx = ArraySize(g_events);
      ArrayResize(g_events, idx + 1);
      g_events[idx].time       = serverTime;
      g_events[idx].label      = label;
      g_events[idx].state      = STATE_WAITING;
      g_events[idx].rangeHigh  = -1;
      g_events[idx].rangeLow   = -1;
      g_events[idx].rangeValid = false;
      g_events[idx].buyTicket  = 0;
      g_events[idx].sellTicket = 0;

      PrintFormat("NewsStraddleEA [%s]: evento programmato -> %s (orario server)", label, TimeToString(serverTime, TIME_DATE | TIME_MINUTES));
     }
  }

//+------------------------------------------------------------------+
//| Ordina g_events per data crescente (insertion sort, array piccoli)|
//+------------------------------------------------------------------+
void SortEvents()
  {
   int total = ArraySize(g_events);
   for(int i = 1; i < total; i++)
     {
      NewsEvent key = g_events[i];
      int j = i - 1;
      while(j >= 0 && g_events[j].time > key.time)
        {
         g_events[j + 1] = g_events[j];
         j--;
        }
      g_events[j + 1] = key;
     }
  }

//+------------------------------------------------------------------+
//| Ritorna la dimensione di un pip per il simbolo corrente            |
//+------------------------------------------------------------------+
double PipSize()
  {
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   if(digits == 3 || digits == 5)
      return(point * 10.0);
   return(point);
  }

//+------------------------------------------------------------------+
//| Aggiorna massimo/minimo delle candele M5 nella finestra           |
//| [news.time - LookbackMinutes*60, news.time)                       |
//+------------------------------------------------------------------+
bool UpdateRange(NewsEvent &ev)
  {
   int barsNeeded = MathMax(InpLookbackMinutes / 5 + 5, 10);

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, PERIOD_M5, 0, barsNeeded, rates);
   if(copied <= 0)
      return(false);

   datetime windowStart = ev.time - InpLookbackMinutes * 60;
   datetime windowEnd   = ev.time; // esclusivo

   double high = -1, low = -1;
   bool found = false;

   for(int i = 0; i < copied; i++)
     {
      if(rates[i].time >= windowStart && rates[i].time < windowEnd)
        {
         if(!found)
           {
            high = rates[i].high;
            low  = rates[i].low;
            found = true;
           }
         else
           {
            if(rates[i].high > high) high = rates[i].high;
            if(rates[i].low  < low)  low  = rates[i].low;
           }
        }
     }

   if(found)
     {
      ev.rangeHigh  = high;
      ev.rangeLow   = low;
      ev.rangeValid = true;
     }

   return(found);
  }

//+------------------------------------------------------------------+
//| Normalizza il volume secondo i vincoli del simbolo                |
//+------------------------------------------------------------------+
double NormalizeVolume(double volume)
  {
   double minVol  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxVol  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double stepVol = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   volume = MathRound(volume / stepVol) * stepVol;
   volume = MathMax(minVol, MathMin(maxVol, volume));
   return(volume);
  }

//+------------------------------------------------------------------+
//| Piazza i due ordini pendenti (Buy Stop / Sell Stop) per l'evento  |
//+------------------------------------------------------------------+
void PlaceOrders(NewsEvent &ev)
  {
   if(!ev.rangeValid)
     {
      Print("NewsStraddleEA [", ev.label, "]: range non valido per l'evento ", TimeToString(ev.time), ", ordini NON piazzati.");
      ev.state = STATE_DONE;
      return;
     }

   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double pip    = PipSize();
   double dist   = InpPipsDistance * pip;

   double buyPrice  = NormalizeDouble(ev.rangeHigh + dist, digits);
   double sellPrice = NormalizeDouble(ev.rangeLow  - dist, digits);

   // rispetta la distanza minima del broker (stop level)
   long stopLevelPts = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double stopLevel  = stopLevelPts * point;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if(stopLevel > 0)
     {
      if(buyPrice - ask < stopLevel)
         buyPrice = NormalizeDouble(ask + stopLevel, digits);
      if(bid - sellPrice < stopLevel)
         sellPrice = NormalizeDouble(bid - stopLevel, digits);
     }

   double sl_buy = 0, tp_buy = 0, sl_sell = 0, tp_sell = 0;
   if(InpStopLossPips > 0)
     {
      sl_buy  = NormalizeDouble(buyPrice  - InpStopLossPips * pip, digits);
      sl_sell = NormalizeDouble(sellPrice + InpStopLossPips * pip, digits);
     }
   if(InpTakeProfitPips > 0)
     {
      tp_buy  = NormalizeDouble(buyPrice  + InpTakeProfitPips * pip, digits);
      tp_sell = NormalizeDouble(sellPrice - InpTakeProfitPips * pip, digits);
     }

   double volume = NormalizeVolume(InpLotSize);
   datetime expiration = ev.time + InpExpirationMinutes * 60;

   PrintFormat("NewsStraddleEA [%s]: evento %s -> range [%s , %s], BuyStop=%s SellStop=%s",
               ev.label, TimeToString(ev.time), DoubleToString(ev.rangeLow, digits), DoubleToString(ev.rangeHigh, digits),
               DoubleToString(buyPrice, digits), DoubleToString(sellPrice, digits));

   if(!InpEnableTrading)
     {
      Print("NewsStraddleEA: InpEnableTrading=false, ordini NON inviati (modalita' simulazione).");
      ev.state = STATE_DONE;
      return;
     }

   string cmt = ev.label + " " + TimeToString(ev.time, TIME_DATE | TIME_MINUTES);

   if(trade.BuyStop(volume, buyPrice, _Symbol, sl_buy, tp_buy, ORDER_TIME_SPECIFIED, expiration, cmt))
      ev.buyTicket = trade.ResultOrder();
   else
      PrintFormat("NewsStraddleEA: errore invio BuyStop: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());

   if(trade.SellStop(volume, sellPrice, _Symbol, sl_sell, tp_sell, ORDER_TIME_SPECIFIED, expiration, cmt))
      ev.sellTicket = trade.ResultOrder();
   else
      PrintFormat("NewsStraddleEA: errore invio SellStop: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());

   ev.state = STATE_ARMED;
  }

//+------------------------------------------------------------------+
//| true se il ticket esiste ancora come ordine pendente               |
//+------------------------------------------------------------------+
bool OrderStillPending(ulong ticket)
  {
   if(ticket == 0)
      return(false);
   return(OrderSelect(ticket));
  }

//+------------------------------------------------------------------+
//| Gestisce OCO e scadenza per un evento in stato ARMED               |
//+------------------------------------------------------------------+
void ManageArmedEvent(NewsEvent &ev)
  {
   bool buyPending  = OrderStillPending(ev.buyTicket);
   bool sellPending = OrderStillPending(ev.sellTicket);

   // se uno dei due ordini non e' piu' pendente (eseguito o rimosso) e l'altro si',
   // cancella l'ordine rimasto perche' inutile (logica OCO)
   if(ev.buyTicket != 0 && !buyPending && sellPending)
     {
      trade.OrderDelete(ev.sellTicket);
      ev.state = STATE_DONE;
      Print("NewsStraddleEA: BuyStop eseguito/rimosso, cancellato SellStop residuo.");
      return;
     }
   if(ev.sellTicket != 0 && !sellPending && buyPending)
     {
      trade.OrderDelete(ev.buyTicket);
      ev.state = STATE_DONE;
      Print("NewsStraddleEA: SellStop eseguito/rimosso, cancellato BuyStop residuo.");
      return;
     }
   if(!buyPending && !sellPending)
     {
      ev.state = STATE_DONE;
      return;
     }

   // scadenza di sicurezza lato EA (oltre a quella impostata sull'ordine stesso)
   if(TimeCurrent() - ev.time > InpExpirationMinutes * 60)
     {
      if(buyPending)  trade.OrderDelete(ev.buyTicket);
      if(sellPending) trade.OrderDelete(ev.sellTicket);
      ev.state = STATE_DONE;
      Print("NewsStraddleEA: scaduta finestra post-notizia, ordini pendenti residui cancellati.");
     }
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   int total = ArraySize(g_events);
   if(total == 0)
      return;

   // seleziona il prossimo evento non ancora concluso
   if(g_activeIndex < 0 || g_activeIndex >= total || g_events[g_activeIndex].state == STATE_DONE)
     {
      g_activeIndex = -1;
      for(int i = 0; i < total; i++)
        {
         if(g_events[i].state != STATE_DONE)
           {
            g_activeIndex = i;
            break;
           }
        }
      if(g_activeIndex < 0)
         return; // tutti gli eventi conclusi
     }

   NewsEvent ev = g_events[g_activeIndex];

   if(ev.state == STATE_WAITING)
     {
      datetime now = TimeCurrent();
      int secToNews = (int)(ev.time - now);

      if(secToNews > InpSecondsBeforeNews)
        {
         UpdateRange(ev);
        }
      else if(secToNews > -60) // margine di tolleranza se il tick arriva in ritardo
        {
         UpdateRange(ev); // ultimo aggiornamento prima di congelare il range
         PlaceOrders(ev);
        }
      else
        {
         Print("NewsStraddleEA [", ev.label, "]: evento ", TimeToString(ev.time), " perso (EA avviato troppo tardi), saltato.");
         ev.state = STATE_DONE;
        }
     }
   else if(ev.state == STATE_ARMED)
     {
      ManageArmedEvent(ev);
     }

   g_events[g_activeIndex] = ev;
  }
//+------------------------------------------------------------------+
