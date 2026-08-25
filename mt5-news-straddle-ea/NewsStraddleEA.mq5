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

input group "=== Eventi (orario SERVER del broker, formato YYYY.MM.DD HH:MM) ==="
input string InpNewsTimes            = "2026.09.05 14:30, 2026.10.03 14:30"; // Lista orari notizie separati da virgola

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

   if(!ParseNewsTimes(InpNewsTimes))
     {
      Print("NewsStraddleEA: nessun orario valido trovato in InpNewsTimes");
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
//| Converte la lista di date/ore in input in eventi ordinati         |
//+------------------------------------------------------------------+
bool ParseNewsTimes(const string list)
  {
   string parts[];
   int n = StringSplit(list, ',', parts);
   ArrayResize(g_events, 0);

   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringTrimLeft(s);
      StringTrimRight(s);
      if(s == "")
         continue;

      datetime t = StringToTime(s);
      if(t <= 0)
        {
         Print("NewsStraddleEA: orario non valido ignorato: '", s, "'");
         continue;
        }

      // scarta eventi già passati oltre la finestra di scadenza
      if(t + InpExpirationMinutes * 60 < TimeCurrent())
        {
         Print("NewsStraddleEA: evento già passato ignorato: ", TimeToString(t));
         continue;
        }

      int idx = ArraySize(g_events);
      ArrayResize(g_events, idx + 1);
      g_events[idx].time       = t;
      g_events[idx].state      = STATE_WAITING;
      g_events[idx].rangeHigh  = -1;
      g_events[idx].rangeLow   = -1;
      g_events[idx].rangeValid = false;
      g_events[idx].buyTicket  = 0;
      g_events[idx].sellTicket = 0;
     }

   // ordina per data crescente (semplice insertion sort, gli array sono piccoli)
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

   return(total > 0);
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
      Print("NewsStraddleEA: range non valido per l'evento ", TimeToString(ev.time), ", ordini NON piazzati.");
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

   PrintFormat("NewsStraddleEA: evento %s -> range [%s , %s], BuyStop=%s SellStop=%s",
               TimeToString(ev.time), DoubleToString(ev.rangeLow, digits), DoubleToString(ev.rangeHigh, digits),
               DoubleToString(buyPrice, digits), DoubleToString(sellPrice, digits));

   if(!InpEnableTrading)
     {
      Print("NewsStraddleEA: InpEnableTrading=false, ordini NON inviati (modalita' simulazione).");
      ev.state = STATE_DONE;
      return;
     }

   string cmt = "NewsStraddle " + TimeToString(ev.time, TIME_DATE | TIME_MINUTES);

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
         Print("NewsStraddleEA: evento ", TimeToString(ev.time), " perso (EA avviato troppo tardi), saltato.");
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
