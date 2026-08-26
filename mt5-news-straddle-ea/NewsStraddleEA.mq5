//+------------------------------------------------------------------+
//|                                           NewsStraddleEA.mq5      |
//|  Strategia "straddle" per news ad alto impatto (NFP, FOMC, ecc.) |
//|                                                                    |
//|  Per ogni evento (trovato in automatico nel Calendario Economico  |
//|  di MT5, oppure inserito a mano), l'EA:                           |
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
#property version   "2.00"
#property strict

#include <Trade\Trade.mqh>

//================================= INPUT ==================================

input group "=== Modalita' ==="
input bool   InpAutoFetchFromCalendar = true;  // true = prende le date da NFP/FOMC in automatico dal Calendario Economico di MT5
input bool   InpListUSEventsOnInit   = false;  // true = stampa nel log tutti gli eventi USA del calendario (utile per trovare la keyword esatta)

input group "=== NFP ==="
input bool   InpEnableNFP            = true;   // Abilita gli eventi NFP
input string InpNFPCountryCode       = "US";   // Codice paese nel Calendario Economico
input string InpNFPKeyword           = "Nonfarm Payrolls"; // Parola chiave nel nome evento (solo modalita' automatica)
input string InpNFPDatesManual       = "2026.09.04, 2026.10.02, 2026.11.06, 2026.12.04"; // Date NFP, solo se InpAutoFetchFromCalendar=false
input string InpNFPTimeItaly         = "14:30"; // Orario italiano NFP, solo modalita' manuale

input group "=== FOMC ==="
input bool   InpEnableFOMC           = true;   // Abilita gli eventi FOMC
input string InpFOMCCountryCode      = "US";   // Codice paese nel Calendario Economico
input string InpFOMCKeyword          = "Interest Rate Decision"; // Parola chiave nel nome evento (solo modalita' automatica)
input string InpFOMCDatesManual      = "2026.09.17, 2026.11.05, 2026.12.17"; // Date FOMC, solo se InpAutoFetchFromCalendar=false
input string InpFOMCTimeItaly        = "20:00"; // Orario italiano FOMC, solo modalita' manuale

input group "=== Calendario automatico ==="
input int    InpCalendarLookaheadDays = 45;    // Giorni in avanti in cui cercare i prossimi eventi
input int    InpCalendarRefreshHours  = 6;     // Ogni quante ore ricontrollare il calendario per nuove date

input group "=== Fuso orario (solo modalita' manuale) ==="
input int    InpServerMinusItalyMin  = 60;   // Differenza in MINUTI tra orario server del broker e orario italiano

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
datetime    g_lastCalendarRefresh = 0;
CTrade      trade;

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);

   if(InpListUSEventsOnInit)
      DumpCountryEvents("US");

   ArrayResize(g_events, 0);
   RefreshEvents();
   g_lastCalendarRefresh = TimeCurrent();

   if(ArraySize(g_events) == 0)
     {
      Print("NewsStraddleEA: nessun evento valido trovato. Se sei in modalita' automatica, controlla che il Calendario Economico sia attivo in MT5 (Vista -> Calendario Economico) e che le keyword siano corrette (prova InpListUSEventsOnInit=true).");
      return(INIT_PARAMETERS_INCORRECT);
     }

   EventSetTimer(1);
   Print("NewsStraddleEA inizializzato con ", ArraySize(g_events), " evento/i.");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

//+------------------------------------------------------------------+
//| Stampa nel log tutti gli eventi di un paese, per trovare la       |
//| keyword esatta da usare in InpNFPKeyword / InpFOMCKeyword          |
//+------------------------------------------------------------------+
void DumpCountryEvents(const string countryCode)
  {
   MqlCalendarEvent events[];
   int total = CalendarEventByCountry(countryCode, events);
   PrintFormat("NewsStraddleEA: %d eventi trovati nel Calendario per il paese '%s':", total, countryCode);
   for(int i = 0; i < total; i++)
      PrintFormat("   id=%I64u  importance=%d  name='%s'", events[i].id, (int)events[i].importance, events[i].name);
  }

//+------------------------------------------------------------------+
//| Cerca nel Calendario Economico l'evento il cui nome contiene la   |
//| keyword indicata (case-insensitive) per il paese specificato.     |
//+------------------------------------------------------------------+
bool FindEventId(const string countryCode, const string keyword, ulong &eventId)
  {
   MqlCalendarEvent events[];
   int total = CalendarEventByCountry(countryCode, events);
   if(total <= 0)
      return(false);

   string kw = keyword;
   StringToLower(kw);

   for(int i = 0; i < total; i++)
     {
      string name = events[i].name;
      StringToLower(name);
      if(StringFind(name, kw) >= 0)
        {
         eventId = events[i].id;
         return(true);
        }
     }
   return(false);
  }

//+------------------------------------------------------------------+
//| true se esiste gia' un evento della stessa categoria entro 12h    |
//| dall'orario indicato (evita doppioni tra un refresh e l'altro)    |
//+------------------------------------------------------------------+
bool AlreadyTracked(const string label, datetime t)
  {
   int total = ArraySize(g_events);
   for(int i = 0; i < total; i++)
     {
      if(g_events[i].label == label && MathAbs((long)(g_events[i].time - t)) < 12 * 3600)
         return(true);
     }
   return(false);
  }

//+------------------------------------------------------------------+
//| Aggiunge un evento a g_events                                     |
//+------------------------------------------------------------------+
void AppendEvent(const datetime serverTime, const string label)
  {
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
  }

//+------------------------------------------------------------------+
//| Recupera dal Calendario Economico i prossimi eventi di una        |
//| categoria e li aggiunge a g_events (converte da GMT a orario      |
//| server del broker automaticamente, senza bisogno di input manuali)|
//+------------------------------------------------------------------+
void RefreshCategoryFromCalendar(const string countryCode, const string keyword, const string label)
  {
   ulong eventId;
   if(!FindEventId(countryCode, keyword, eventId))
     {
      PrintFormat("NewsStraddleEA [%s]: nessun evento trovato nel Calendario con keyword '%s' per il paese '%s'. Attiva InpListUSEventsOnInit per vedere i nomi disponibili.", label, keyword, countryCode);
      return;
     }

   MqlCalendarValue values[];
   datetime fromUTC = TimeGMT() - 3600;
   datetime toUTC   = TimeGMT() + InpCalendarLookaheadDays * 24 * 3600;
   int total = CalendarValueHistoryByEvent(eventId, values, fromUTC, toUTC);
   if(total <= 0)
     {
      PrintFormat("NewsStraddleEA [%s]: il Calendario non ha ancora pubblicato date future per questo evento, riprovo al prossimo refresh.", label);
      return;
     }

   long offsetSec = (long)TimeCurrent() - (long)TimeGMT();

   for(int i = 0; i < total; i++)
     {
      datetime serverTime = values[i].time + offsetSec;

      if(serverTime + InpExpirationMinutes * 60 < TimeCurrent())
         continue; // già passato

      if(AlreadyTracked(label, serverTime))
         continue;

      AppendEvent(serverTime, label);
      PrintFormat("NewsStraddleEA [%s]: evento trovato dal Calendario -> %s (orario server)", label, TimeToString(serverTime, TIME_DATE | TIME_MINUTES));
     }
  }

//+------------------------------------------------------------------+
//| Aggiunge eventi inseriti a mano (modalita' manuale/fallback)      |
//+------------------------------------------------------------------+
void AddManualEvents(const string datesList, const string timeItaly, const string label)
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

      if(serverTime + InpExpirationMinutes * 60 < TimeCurrent())
        {
         Print("NewsStraddleEA [", label, "]: evento già passato ignorato: ", TimeToString(serverTime));
         continue;
        }

      if(AlreadyTracked(label, serverTime))
         continue;

      AppendEvent(serverTime, label);
      PrintFormat("NewsStraddleEA [%s]: evento manuale programmato -> %s (orario server)", label, TimeToString(serverTime, TIME_DATE | TIME_MINUTES));
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
//| Punto unico di aggiornamento della lista eventi                   |
//+------------------------------------------------------------------+
void RefreshEvents()
  {
   if(InpAutoFetchFromCalendar)
     {
      if(InpEnableNFP)
         RefreshCategoryFromCalendar(InpNFPCountryCode, InpNFPKeyword, "NFP");
      if(InpEnableFOMC)
         RefreshCategoryFromCalendar(InpFOMCCountryCode, InpFOMCKeyword, "FOMC");
     }
   else
     {
      if(InpEnableNFP)
         AddManualEvents(InpNFPDatesManual, InpNFPTimeItaly, "NFP");
      if(InpEnableFOMC)
         AddManualEvents(InpFOMCDatesManual, InpFOMCTimeItaly, "FOMC");
     }
   SortEvents();
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
      Print("NewsStraddleEA [", ev.label, "]: BuyStop eseguito/rimosso, cancellato SellStop residuo.");
      return;
     }
   if(ev.sellTicket != 0 && !sellPending && buyPending)
     {
      trade.OrderDelete(ev.buyTicket);
      ev.state = STATE_DONE;
      Print("NewsStraddleEA [", ev.label, "]: SellStop eseguito/rimosso, cancellato BuyStop residuo.");
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
      Print("NewsStraddleEA [", ev.label, "]: scaduta finestra post-notizia, ordini pendenti residui cancellati.");
     }
  }

//+------------------------------------------------------------------+
//| Avanza la macchina a stati per l'evento attualmente attivo        |
//+------------------------------------------------------------------+
void ProcessEvents()
  {
   int total = ArraySize(g_events);
   if(total == 0)
      return;

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
      else if(secToNews > -60) // margine di tolleranza se il timer/tick arriva in ritardo
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
void OnTimer()
  {
   if(InpAutoFetchFromCalendar && TimeCurrent() - g_lastCalendarRefresh >= InpCalendarRefreshHours * 3600)
     {
      RefreshEvents();
      g_lastCalendarRefresh = TimeCurrent();
     }
   ProcessEvents();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ProcessEvents();
  }
//+------------------------------------------------------------------+
