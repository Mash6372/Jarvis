//+------------------------------------------------------------------+
//|                                                     Aurum.mq5     |
//|  AURUM - "oro" in latino. Versione dedicata all'ORO (XAUUSD),     |
//|  sorella di Aquila (per forex).                                   |
//|                                                                    |
//|  DIFFERENZA IMPORTANTE rispetto ad Aquila: sull'oro il concetto   |
//|  di "pip" del forex non si applica in modo affidabile (a seconda  |
//|  del broker XAUUSD puo' avere 2 o 3 decimali, e la stessa formula |
//|  usata per il forex puo' calcolare una distanza reale di pochi    |
//|  centesimi invece che dollari interi - esattamente quello che ha  |
//|  causato ordini piazzati quasi sul massimo/minimo esatto, eseguiti|
//|  subito col rumore di prezzo). Per questo qui la distanza tra     |
//|  massimo/minimo e prezzo di entrata NON e' un numero fisso in     |
//|  dollari, ma l'EQUIVALENTE IN TEMPO REALE di N pips di EURUSD:    |
//|  legge il prezzo attuale di EURUSD e dell'oro, calcola che        |
//|  percentuale di movimento rappresentano quei pips su EURUSD, e    |
//|  applica la stessa percentuale al prezzo dell'oro (vedi           |
//|  GetEquivalentGoldDistance()). Stop Loss, Take Profit e trigger   |
//|  di chiusura parziale restano invece in dollari diretti, perche'  |
//|  su quelli il money management si ragiona in dollari di rischio.  |
//|                                                                    |
//|  Strategia "straddle sulle news": il giorno in cui esce una       |
//|  notizia ad alto impatto (NFP, FOMC, o qualsiasi altra), apri le  |
//|  proprieta' dell'EA e scrivi solo l'orario italiano di uscita     |
//|  (InpNewsTime). L'EA fa tutto da solo:                            |
//|   1) osserva le candele M5 nei 10 minuti precedenti l'orario,     |
//|      aggiornando in tempo reale massimo e minimo;                 |
//|   2) 3 secondi prima dell'orario congela il range e piazza due    |
//|      ordini pendenti in OCO, alla distanza calcolata come sopra;  |
//|   3) quando uno dei due scatta, cancella l'altro;                 |
//|   4) se nessuno dei due scatta entro 15 minuti, li cancella       |
//|      entrambi;                                                    |
//|   5) sulla posizione aperta, se impostata una chiusura parziale,  |
//|      chiude una percentuale al target indicato (in dollari) e     |
//|      (opzionale) sposta lo Stop Loss a pareggio sul resto.        |
//|                                                                    |
//|  Il pannello sul grafico e' di sola lettura: mostra lo stato in   |
//|  tempo reale e ha 2 pulsanti (Trading ON/OFF, Annulla). Disegna   |
//|  anche sul grafico il range tracciato e i livelli degli ordini.   |
//+------------------------------------------------------------------+
#property copyright "Jarvis"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//================================= INPUT ==================================
//  Solo quello che serve davvero. Il giorno della notizia, apri le   //
//  proprieta' dell'EA, scrivi l'orario in InpNewsTime e premi OK:    //
//  l'EA si riavvia e si mette subito a osservare il mercato.         //
//                                                                     //
//  ATTENZIONE: usa questo EA solo sul grafico dell'ORO (XAUUSD/GOLD  //
//  o il ticker equivalente del tuo broker). Tutte le distanze qui    //
//  sotto sono in DOLLARI diretti sul prezzo, non in pips.            //

input group "=== Notizia ==="
input string InpNewsTime             = "14:30"; // Orario italiano di uscita (HH:MM), vale per OGGI

input group "=== Fuso orario (imposta una volta sola) ==="
input int    InpServerMinusItalyMin  = 60;   // Differenza in MINUTI tra orario server del broker e orario italiano

input group "=== Distanza ordini (equivalente a pips di EURUSD) ==="
input double InpDistanceEurUsdPips   = 3.0;  // Distanza equivalente a N pips su EURUSD, ricalcolata in $ sull'oro in base ai prezzi attuali
input string InpEurUsdSymbol         = "EURUSD"; // Nome esatto del simbolo EURUSD su questo broker (controlla in Market Watch se diverso)

input group "=== Ordini (Stop Loss / Take Profit / parziale in DOLLARI) ==="
input double InpLotSize              = 0.10; // Lotti per ogni ordine
input double InpStopLossUSD          = 5.00; // Stop Loss in $ (0 = nessuno)
input double InpTakeProfitUSD        = 0.0;  // Take Profit finale in $ (0 = nessuno)
input double InpPartialClosePercent  = 50.0; // % di posizione da chiudere al target parziale (0 = disabilitata)
input double InpPartialTriggerUSD    = 3.00; // Dollari di profitto per far scattare la chiusura parziale

input group "=== Sicurezza ==="
input bool   InpEnableTrading        = true; // false = simulazione: calcola i livelli ma non invia ordini reali

//================================ STATO =====================================
//  Parametri tecnici fissi (non serve toccarli): 10 minuti di        //
//  osservazione (2 candele M5), congela il range 3 secondi prima     //
//  della notizia, cancella gli ordini non eseguiti dopo 15 minuti.   //

#define LOOKBACK_MINUTES     10
#define SECONDS_BEFORE_NEWS  3
#define EXPIRATION_MINUTES   15
#define SLIPPAGE_POINTS      100
#define MAGIC_NUMBER         20260905

#define PANEL_LINE_H  16
#define PANEL_FONT    8
#define PANEL_X       10
#define PANEL_Y       20

enum EventState
  {
   STATE_WAITING  = 0, // in attesa, si aggiorna il range
   STATE_ARMED    = 1, // ordini pendenti piazzati, in attesa di esecuzione/scadenza
   STATE_POSITION = 2, // una posizione e' aperta, gestione parziale/BE in corso
   STATE_DONE     = 3  // evento concluso
  };

struct EventInfo
  {
   bool        active;
   datetime    time;
   EventState  state;
   double      rangeHigh;
   double      rangeLow;
   bool        rangeValid;
   ulong       buyTicket;
   ulong       sellTicket;
   ulong       positionTicket;
   bool        partialDone;
   double      buyPricePlaced;
   double      sellPricePlaced;
  };

EventInfo g_event;

bool     g_tradingEnabledRuntime = true;
bool     g_moveToBreakeven       = true;

string   g_panelPrefix = "AU_";
CTrade   trade;

//+------------------------------------------------------------------+
//| Azzera l'evento                                                    |
//+------------------------------------------------------------------+
void ResetEvent()
  {
   g_event.active         = false;
   g_event.time           = 0;
   g_event.state          = STATE_WAITING;
   g_event.rangeHigh      = -1;
   g_event.rangeLow       = -1;
   g_event.rangeValid     = false;
   g_event.buyTicket      = 0;
   g_event.sellTicket     = 0;
   g_event.positionTicket = 0;
   g_event.partialDone    = false;
   g_event.buyPricePlaced  = 0;
   g_event.sellPricePlaced = 0;
  }

//+------------------------------------------------------------------+
//| Calcola l'orario server corrispondente a un orario italiano       |
//| (HH:MM) di OGGI, usando la differenza server-Italia memorizzata.  |
//| Se l'orario risultante e' gia' passato da piu' del tempo di       |
//| scadenza, lo sposta automaticamente a domani.                     |
//+------------------------------------------------------------------+
datetime ComputeTargetTime(string timeStr)
  {
   StringTrimLeft(timeStr);
   StringTrimRight(timeStr);
   if(timeStr == "")
      return(0);

   datetime italyNow = TimeCurrent() - InpServerMinusItalyMin * 60;
   string   todayStr = TimeToString(italyNow, TIME_DATE);

   datetime italyTarget = StringToTime(todayStr + " " + timeStr);
   if(italyTarget <= 0)
      return(0);

   datetime serverTarget = italyTarget + InpServerMinusItalyMin * 60;

   if(serverTarget + EXPIRATION_MINUTES * 60 < TimeCurrent())
      serverTarget += 24 * 3600; // era gia' passato oggi: vale per domani

   return(serverTarget);
  }

//+------------------------------------------------------------------+
//| Imposta/riarma l'evento con l'orario italiano configurato,        |
//| valido per oggi (o domani se l'orario di oggi e' gia' passato)    |
//+------------------------------------------------------------------+
bool ArmEvent(string timeStr)
  {
   StringTrimLeft(timeStr);
   StringTrimRight(timeStr);
   if(timeStr == "")
     {
      Print("Aurum: nessun orario impostato in InpNewsTime, EA inattivo.");
      ResetEvent();
      return(false);
     }

   datetime serverTime = ComputeTargetTime(timeStr);
   if(serverTime <= 0)
     {
      PrintFormat("Aurum: orario non valido '%s' (usa il formato HH:MM).", timeStr);
      return(false);
     }

   ResetEvent();
   g_event.time   = serverTime;
   g_event.active = true;

   PrintFormat("Aurum: evento impostato -> %s (orario server)", TimeToString(serverTime, TIME_DATE | TIME_MINUTES));
   return(true);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(MAGIC_NUMBER);
   trade.SetDeviationInPoints(SLIPPAGE_POINTS);
   trade.SetTypeFillingBySymbol(_Symbol);

   g_tradingEnabledRuntime = InpEnableTrading;
   g_moveToBreakeven       = true;

   // serve avere EURUSD nel Market Watch per poterne leggere il prezzo live
   SymbolSelect(InpEurUsdSymbol, true);

   ResetEvent();
   ArmEvent(InpNewsTime);

   EventSetTimer(1);
   CreatePanel();

   Print("Aurum inizializzato. Ricorda: questo EA va usato solo sul grafico dell'ORO.");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   DestroyPanel();
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
//| Dimensione di un pip su EURUSD (0.0001, sia a 4 che a 5 decimali) |
//+------------------------------------------------------------------+
double GetEurUsdPipSize()
  {
   double point  = SymbolInfoDouble(InpEurUsdSymbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(InpEurUsdSymbol, SYMBOL_DIGITS);
   if(point <= 0)
      return(0.0001); // simbolo non disponibile: valore standard di fallback
   if(digits == 5)
      return(point * 10.0);
   return(point);
  }

//+------------------------------------------------------------------+
//| Calcola, in tempo reale, la distanza in dollari sull'oro che      |
//| corrisponde a InpDistanceEurUsdPips pips di EURUSD: stessa        |
//| percentuale di movimento del prezzo, applicata al prezzo attuale  |
//| dell'oro. Es.: 3 pips EURUSD a 1.0800 = 0.0278% del prezzo; sul   |
//| oro a 2650 diventano circa 2650 * 0.0278% = 0.74$.                |
//+------------------------------------------------------------------+
double GetEquivalentGoldDistance()
  {
   double eurUsdPrice = SymbolInfoDouble(InpEurUsdSymbol, SYMBOL_BID);
   if(eurUsdPrice <= 0)
      eurUsdPrice = SymbolInfoDouble(InpEurUsdSymbol, SYMBOL_ASK);
   if(eurUsdPrice <= 0)
      eurUsdPrice = 1.08; // fallback prudente se il simbolo EURUSD non e' disponibile sul broker

   double eurUsdDistance = InpDistanceEurUsdPips * GetEurUsdPipSize();
   double percentMove    = eurUsdDistance / eurUsdPrice;

   double goldPrice = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(goldPrice <= 0)
      goldPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   return(percentMove * goldPrice);
  }

//+------------------------------------------------------------------+
//| Aggiorna massimo/minimo delle candele M5 nella finestra           |
//| [orario_evento - 10min, orario_evento)                            |
//+------------------------------------------------------------------+
bool UpdateRange()
  {
   int barsNeeded = MathMax(LOOKBACK_MINUTES / 5 + 5, 10);

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, PERIOD_M5, 0, barsNeeded, rates);
   if(copied <= 0)
      return(false);

   datetime windowStart = g_event.time - LOOKBACK_MINUTES * 60;
   datetime windowEnd   = g_event.time; // esclusivo

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
      g_event.rangeHigh  = high;
      g_event.rangeLow   = low;
      g_event.rangeValid = true;
     }

   return(found);
  }

//+------------------------------------------------------------------+
//| Piazza i due ordini pendenti (Buy Stop / Sell Stop) - distanze    |
//| in DOLLARI diretti sul prezzo, niente calcolo di "pip"            |
//+------------------------------------------------------------------+
void PlaceOrders()
  {
   if(!g_event.rangeValid)
     {
      Print("Aurum: range non valido, ordini NON piazzati.");
      g_event.state  = STATE_DONE;
      g_event.active = false;
      return;
     }

   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double dist   = GetEquivalentGoldDistance();

   double buyPrice  = NormalizeDouble(g_event.rangeHigh + dist, digits);
   double sellPrice = NormalizeDouble(g_event.rangeLow  - dist, digits);

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
   if(InpStopLossUSD > 0)
     {
      sl_buy  = NormalizeDouble(buyPrice  - InpStopLossUSD, digits);
      sl_sell = NormalizeDouble(sellPrice + InpStopLossUSD, digits);
     }
   if(InpTakeProfitUSD > 0)
     {
      tp_buy  = NormalizeDouble(buyPrice  + InpTakeProfitUSD, digits);
      tp_sell = NormalizeDouble(sellPrice - InpTakeProfitUSD, digits);
     }

   double volume = NormalizeVolume(InpLotSize);
   datetime expiration = g_event.time + EXPIRATION_MINUTES * 60;

   PrintFormat("Aurum: distanza equivalente a %.1f pip EURUSD -> %.2f$ sull'oro. Range [%s , %s], BuyStop=%s SellStop=%s",
               InpDistanceEurUsdPips, dist,
               DoubleToString(g_event.rangeLow, digits), DoubleToString(g_event.rangeHigh, digits),
               DoubleToString(buyPrice, digits), DoubleToString(sellPrice, digits));

   if(!g_tradingEnabledRuntime)
     {
      Print("Aurum: trading disabilitato (pannello), ordini NON inviati (simulazione).");
      g_event.state  = STATE_DONE;
      g_event.active = false;
      return;
     }

   string cmt = "Aurum " + TimeToString(g_event.time, TIME_DATE | TIME_MINUTES);

   g_event.buyPricePlaced  = buyPrice;
   g_event.sellPricePlaced = sellPrice;

   if(trade.BuyStop(volume, buyPrice, _Symbol, sl_buy, tp_buy, ORDER_TIME_SPECIFIED, expiration, cmt))
      g_event.buyTicket = trade.ResultOrder();
   else
      PrintFormat("Aurum: errore invio BuyStop: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());

   if(trade.SellStop(volume, sellPrice, _Symbol, sl_sell, tp_sell, ORDER_TIME_SPECIFIED, expiration, cmt))
      g_event.sellTicket = trade.ResultOrder();
   else
      PrintFormat("Aurum: errore invio SellStop: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());

   g_event.state = STATE_ARMED;
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
//| Gestisce OCO e scadenza mentre gli ordini sono pendenti (ARMED)   |
//+------------------------------------------------------------------+
void ManageArmedEvent()
  {
   bool buyPending  = OrderStillPending(g_event.buyTicket);
   bool sellPending = OrderStillPending(g_event.sellTicket);

   if(g_event.buyTicket != 0 && !buyPending && sellPending)
     {
      trade.OrderDelete(g_event.sellTicket);
      g_event.state = STATE_POSITION;
      Print("Aurum: BuyStop eseguito, SellStop annullato.");
      return;
     }
   if(g_event.sellTicket != 0 && !sellPending && buyPending)
     {
      trade.OrderDelete(g_event.buyTicket);
      g_event.state = STATE_POSITION;
      Print("Aurum: SellStop eseguito, BuyStop annullato.");
      return;
     }
   if(!buyPending && !sellPending)
     {
      g_event.state = STATE_POSITION; // ManagePosition capira' se esiste davvero una posizione
      return;
     }

   if(TimeCurrent() - g_event.time > EXPIRATION_MINUTES * 60)
     {
      if(buyPending)  trade.OrderDelete(g_event.buyTicket);
      if(sellPending) trade.OrderDelete(g_event.sellTicket);
      g_event.state = STATE_POSITION;
      Print("Aurum: scaduto, ordini pendenti residui cancellati.");
     }
  }

//+------------------------------------------------------------------+
//| Trova/gestisce la posizione aperta: chiusura parziale al target   |
//| (in dollari) e spostamento a pareggio                             |
//+------------------------------------------------------------------+
void ManagePosition()
  {
   if(g_event.positionTicket == 0)
     {
      for(int i = 0; i < PositionsTotal(); i++)
        {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0 || !PositionSelectByTicket(ticket))
            continue;
         if(PositionGetInteger(POSITION_MAGIC) != (long)MAGIC_NUMBER)
            continue;
         if(PositionGetString(POSITION_SYMBOL) != _Symbol)
            continue;

         g_event.positionTicket = ticket;
         g_event.partialDone    = false;
         break;
        }

      if(g_event.positionTicket == 0)
        {
         // nessuno dei due ordini e' mai scattato
         g_event.state  = STATE_DONE;
         g_event.active = false;
         return;
        }
     }

   if(!PositionSelectByTicket(g_event.positionTicket))
     {
      Print("Aurum: posizione chiusa.");
      g_event.positionTicket = 0;
      g_event.state  = STATE_DONE;
      g_event.active = false;
      return;
     }

   if(InpPartialClosePercent > 0 && !g_event.partialDone)
     {
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      long   posType   = PositionGetInteger(POSITION_TYPE);
      double curPrice  = (posType == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double profitUSD = (posType == POSITION_TYPE_BUY) ? (curPrice - openPrice) : (openPrice - curPrice);

      if(profitUSD >= InpPartialTriggerUSD)
        {
         double vol      = PositionGetDouble(POSITION_VOLUME);
         double closeVol = NormalizeVolume(vol * InpPartialClosePercent / 100.0);

         if(closeVol > 0 && closeVol < vol)
           {
            if(trade.PositionClosePartial(g_event.positionTicket, closeVol))
              {
               g_event.partialDone = true;
               PrintFormat("Aurum: chiusura parziale %.1f%% eseguita a +%.2f$.", InpPartialClosePercent, profitUSD);

               if(g_moveToBreakeven && PositionSelectByTicket(g_event.positionTicket))
                  trade.PositionModify(g_event.positionTicket, openPrice, PositionGetDouble(POSITION_TP));
              }
            else
               PrintFormat("Aurum: errore chiusura parziale: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
           }
        }
     }
  }

//+------------------------------------------------------------------+
//| Annulla manualmente: cancella ordini pendenti e chiude             |
//| l'eventuale posizione aperta (pulsante di emergenza)              |
//+------------------------------------------------------------------+
void CancelEvent()
  {
   if(!g_event.active)
     {
      Print("Aurum: nessun evento attivo da annullare.");
      return;
     }

   if(g_event.buyTicket != 0 && OrderStillPending(g_event.buyTicket))
      trade.OrderDelete(g_event.buyTicket);
   if(g_event.sellTicket != 0 && OrderStillPending(g_event.sellTicket))
      trade.OrderDelete(g_event.sellTicket);
   if(g_event.positionTicket != 0 && PositionSelectByTicket(g_event.positionTicket))
      trade.PositionClose(g_event.positionTicket);

   g_event.state  = STATE_DONE;
   g_event.active = false;
   Print("Aurum: annullato manualmente dal pannello.");
  }

//+------------------------------------------------------------------+
//| Avanza la macchina a stati                                        |
//+------------------------------------------------------------------+
void ProcessEvent()
  {
   if(!g_event.active)
      return;

   if(g_event.state == STATE_WAITING)
     {
      long secToNews = (long)(g_event.time - TimeCurrent());

      if(secToNews > SECONDS_BEFORE_NEWS)
        {
         UpdateRange();
        }
      else if(secToNews > -60) // margine di tolleranza se il timer/tick arriva in ritardo
        {
         UpdateRange();
         PlaceOrders();
        }
      else
        {
         Print("Aurum: evento perso (EA avviato troppo tardi), disattivato.");
         g_event.state  = STATE_DONE;
         g_event.active = false;
        }
     }
   else if(g_event.state == STATE_ARMED)
     {
      ManageArmedEvent();
     }
   else if(g_event.state == STATE_POSITION)
     {
      ManagePosition();
     }
  }

//+------------------------------------------------------------------+
//| Crea/aggiorna un'etichetta di testo del pannello (sola lettura)   |
//+------------------------------------------------------------------+
void PanelSetLabel(const string name, const int x, const int y, const string text, const color clr)
  {
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, PANEL_FONT);
      ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, name, OBJPROP_ZORDER, 5);
     }
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
  }

//+------------------------------------------------------------------+
//| Crea/aggiorna un pulsante del pannello                            |
//+------------------------------------------------------------------+
void PanelSetButton(const string name, const int x, const int y, const int w, const int h, const string text, const color bg)
  {
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
      ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, PANEL_FONT);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clrWhite);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, name, OBJPROP_ZORDER, 10);
     }
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bg);
  }

//+------------------------------------------------------------------+
//| Formatta un conto alla rovescia in giorni/ore/minuti/secondi      |
//+------------------------------------------------------------------+
string FormatCountdown(long secs)
  {
   if(secs < 0)
      secs = 0;
   long d = secs / 86400; secs %= 86400;
   long h = secs / 3600;  secs %= 3600;
   long m = secs / 60;    secs %= 60;
   long s = secs;
   return StringFormat("%02dg %02dh %02dm %02ds", (int)d, (int)h, (int)m, (int)s);
  }

//+------------------------------------------------------------------+
//| Testo di stato sintetico dell'evento                              |
//+------------------------------------------------------------------+
string EventStatusText()
  {
   if(!g_event.active)
      return("non impostato (scrivi l'orario in InpNewsTime nelle proprieta')");

   if(g_event.state == STATE_WAITING)
     {
      long secsLeft = (long)(g_event.time - TimeCurrent());
      return StringFormat("%s - countdown %s", TimeToString(g_event.time, TIME_DATE | TIME_MINUTES), FormatCountdown(secsLeft));
     }
   if(g_event.state == STATE_ARMED)
      return("ordini pendenti piazzati, in attesa");
   if(g_event.state == STATE_POSITION)
      return(g_event.partialDone ? "posizione aperta (parziale gia' fatto)" : "posizione aperta");
   return("concluso");
  }

//+------------------------------------------------------------------+
//| Testo del range                                                    |
//+------------------------------------------------------------------+
string EventRangeText()
  {
   if(!g_event.active || !g_event.rangeValid)
      return("");
   return StringFormat("   Range: H=%s  L=%s", DoubleToString(g_event.rangeHigh, _Digits), DoubleToString(g_event.rangeLow, _Digits));
  }

//+------------------------------------------------------------------+
//| Aggiorna il testo del pulsante Trading ON/OFF                     |
//+------------------------------------------------------------------+
void UpdateTradingButton()
  {
   string name = g_panelPrefix + "BtnTrading";
   if(ObjectFind(0, name) < 0)
      return;
   if(g_tradingEnabledRuntime)
     {
      ObjectSetString(0, name, OBJPROP_TEXT, "Trading: ON");
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, clrDarkGreen);
     }
   else
     {
      ObjectSetString(0, name, OBJPROP_TEXT, "Trading: OFF");
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, clrFireBrick);
     }
  }

//+------------------------------------------------------------------+
//| Ricrea le scritte dinamiche del pannello (sola lettura)            |
//+------------------------------------------------------------------+
void UpdatePanel()
  {
   int x = PANEL_X;
   int y = PANEL_Y;

   PanelSetLabel(g_panelPrefix + "L0", x, y + 0 * PANEL_LINE_H, "AURUM - Dashboard (ORO)", clrWhite);
   PanelSetLabel(g_panelPrefix + "L1", x, y + 1 * PANEL_LINE_H,
                 g_tradingEnabledRuntime ? "Modalita': LIVE (invia ordini reali)" : "Modalita': SIMULAZIONE",
                 g_tradingEnabledRuntime ? clrOrange : clrLightGray);
   PanelSetLabel(g_panelPrefix + "L2", x, y + 2 * PANEL_LINE_H, "Notizia: " + EventStatusText(), clrYellow);
   PanelSetLabel(g_panelPrefix + "L3", x, y + 3 * PANEL_LINE_H, EventRangeText(), clrWhite);
   PanelSetLabel(g_panelPrefix + "L4", x, y + 4 * PANEL_LINE_H,
                 StringFormat("Distanza: %.2f$ (=%.1fp EURUSD)  Lotto: %.2f  SL: %.2f$  TP: %.2f$",
                              GetEquivalentGoldDistance(), InpDistanceEurUsdPips, InpLotSize, InpStopLossUSD, InpTakeProfitUSD),
                 clrSilver);
   PanelSetLabel(g_panelPrefix + "L5", x, y + 5 * PANEL_LINE_H,
                 StringFormat("Parziale: %.1f%% a %.2f$", InpPartialClosePercent, InpPartialTriggerUSD),
                 clrSilver);

   UpdateTradingButton();
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
//| Crea tutti gli oggetti del pannello (una tantum, in OnInit)        |
//+------------------------------------------------------------------+
void CreatePanel()
  {
   int x = PANEL_X;
   int y = PANEL_Y;

   string bg = g_panelPrefix + "BG";
   if(ObjectFind(0, bg) < 0)
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, x - 6);
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, y - 6);
   ObjectSetInteger(0, bg, OBJPROP_XSIZE, 280);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE, 6 * PANEL_LINE_H + 44);
   ObjectSetInteger(0, bg, OBJPROP_ZORDER, 0);
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, C'20,20,20');
   ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bg, OBJPROP_COLOR, clrGold);
   ObjectSetInteger(0, bg, OBJPROP_BACK, false);
   ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);

   PanelSetLabel(g_panelPrefix + "L0", x, y + 0 * PANEL_LINE_H, "AURUM - Dashboard (ORO)", clrWhite);
   PanelSetLabel(g_panelPrefix + "L1", x, y + 1 * PANEL_LINE_H, "", clrWhite);
   PanelSetLabel(g_panelPrefix + "L2", x, y + 2 * PANEL_LINE_H, "", clrYellow);
   PanelSetLabel(g_panelPrefix + "L3", x, y + 3 * PANEL_LINE_H, "", clrWhite);
   PanelSetLabel(g_panelPrefix + "L4", x, y + 4 * PANEL_LINE_H, "", clrSilver);
   PanelSetLabel(g_panelPrefix + "L5", x, y + 5 * PANEL_LINE_H, "", clrSilver);

   int by = y + 6 * PANEL_LINE_H + 14;
   PanelSetButton(g_panelPrefix + "BtnTrading", x, by, 130, 24, "", clrGray);
   PanelSetButton(g_panelPrefix + "BtnCancel", x + 140, by, 130, 24, "Annulla", clrMaroon);

   UpdatePanel();
  }

//+------------------------------------------------------------------+
//| Rimuove tutti gli oggetti del pannello dal grafico                 |
//+------------------------------------------------------------------+
void DestroyPanel()
  {
   ObjectsDeleteAll(0, g_panelPrefix);
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
//| Crea/aggiorna/rimuove una linea orizzontale di livello sul grafico|
//+------------------------------------------------------------------+
void SetLevelLine(const string name, const double price, const color clr, const ENUM_LINE_STYLE style, const string text)
  {
   if(price <= 0)
     {
      ObjectDelete(0, name);
      return;
     }
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
     }
   ObjectSetDouble(0, name, OBJPROP_PRICE, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
  }

//+------------------------------------------------------------------+
//| Disegna sul grafico il range tracciato e i livelli di ingresso    |
//+------------------------------------------------------------------+
void DrawEventLines()
  {
   string prefix = g_panelPrefix + "LN_";
   string nHigh = prefix + "High";
   string nLow  = prefix + "Low";
   string nBuy  = prefix + "Buy";
   string nSell = prefix + "Sell";

   if(!g_event.active || !g_event.rangeValid || g_event.state == STATE_DONE)
     {
      ObjectDelete(0, nHigh);
      ObjectDelete(0, nLow);
      ObjectDelete(0, nBuy);
      ObjectDelete(0, nSell);
      return;
     }

   SetLevelLine(nHigh, g_event.rangeHigh, clrDeepSkyBlue, STYLE_DOT, "Aurum - massimo range");
   SetLevelLine(nLow,  g_event.rangeLow,  clrDeepSkyBlue, STYLE_DOT, "Aurum - minimo range");

   if(g_event.state == STATE_WAITING)
     {
      double dist = GetEquivalentGoldDistance();
      double buyPreview  = g_event.rangeHigh + dist;
      double sellPreview = g_event.rangeLow  - dist;
      SetLevelLine(nBuy,  buyPreview,  clrLime,      STYLE_DASHDOT, "Aurum - anteprima Buy Stop");
      SetLevelLine(nSell, sellPreview, clrOrangeRed, STYLE_DASHDOT, "Aurum - anteprima Sell Stop");
     }
   else if(g_event.state == STATE_ARMED)
     {
      SetLevelLine(nBuy,  g_event.buyPricePlaced,  clrLime,      STYLE_SOLID, "Aurum - Buy Stop piazzato");
      SetLevelLine(nSell, g_event.sellPricePlaced, clrOrangeRed, STYLE_SOLID, "Aurum - Sell Stop piazzato");
     }
   else if(g_event.state == STATE_POSITION)
     {
      if(g_event.positionTicket != 0 && PositionSelectByTicket(g_event.positionTicket))
        {
         double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
         long   posType   = PositionGetInteger(POSITION_TYPE);
         if(posType == POSITION_TYPE_BUY)
           {
            SetLevelLine(nBuy, openPrice, clrLime, STYLE_SOLID, "Aurum - ingresso BUY");
            ObjectDelete(0, nSell);
           }
         else
           {
            SetLevelLine(nSell, openPrice, clrOrangeRed, STYLE_SOLID, "Aurum - ingresso SELL");
            ObjectDelete(0, nBuy);
           }
        }
      else
        {
         ObjectDelete(0, nBuy);
         ObjectDelete(0, nSell);
        }
     }
  }

//+------------------------------------------------------------------+
//| Gestisce i clic sui pulsanti del pannello                         |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK)
      return;

   string p = g_panelPrefix;

   if(sparam == p + "BtnTrading")
     {
      g_tradingEnabledRuntime = !g_tradingEnabledRuntime;
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
     }
   else if(sparam == p + "BtnCancel")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      CancelEvent();
     }
   else
      return;

   UpdatePanel();
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   ProcessEvent();
   DrawEventLines();
   UpdatePanel();
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ProcessEvent();
  }
//+------------------------------------------------------------------+
