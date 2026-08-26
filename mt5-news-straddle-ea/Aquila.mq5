//+------------------------------------------------------------------+
//|                                                    Aquila.mq5     |
//|  AQUILA - sempre in prima linea, scatta al momento giusto.        |
//|  Strategia "straddle" per NFP (14:30 IT) e FOMC (20:00 IT).       |
//|  Tutto si controlla dal pannello sul grafico: data dei due        |
//|  eventi, distanza in pips, lotto, stop loss, take profit e        |
//|  chiusura parziale a target.                                      |
//|                                                                    |
//|  Per ogni evento attivo, l'EA:                                    |
//|   1) osserva le candele M5 nei minuti precedenti l'orario della   |
//|      notizia, aggiornando in tempo reale massimo e minimo;        |
//|   2) pochi secondi prima dell'orario (default 3) congela il       |
//|      range e piazza due ordini pendenti in OCO:                   |
//|        - Buy Stop = massimo range + X pips                        |
//|        - Sell Stop = minimo range - X pips                        |
//|   3) quando uno dei due scatta, cancella l'altro;                 |
//|   4) se nessuno dei due scatta entro un tempo massimo, li          |
//|      cancella entrambi;                                           |
//|   5) sulla posizione aperta, se impostata una chiusura parziale,  |
//|      chiude una percentuale al target indicato e (opzionale)      |
//|      sposta lo Stop Loss a pareggio sul resto.                    |
//+------------------------------------------------------------------+
#property copyright "Jarvis"
#property version   "3.00"
#property strict

#include <Trade\Trade.mqh>

//================================= INPUT ==================================
//  Questi sono solo i valori di DEFAULT al primo avvio: tutto e'      //
//  comunque modificabile in qualsiasi momento dal pannello sul       //
//  grafico, senza dover rimuovere/riattaccare l'EA.                  //

input group "=== NFP (14:30 ora italiana) ==="
input string InpNFPDefaultDate       = "2026.09.04"; // Data del prossimo NFP (AAAA.MM.GG)

input group "=== FOMC (20:00 ora italiana) ==="
input string InpFOMCDefaultDate      = "2026.09.17"; // Data del prossimo FOMC (AAAA.MM.GG)

input group "=== Fuso orario ==="
input int    InpServerMinusItalyMin  = 60;   // Differenza in MINUTI tra orario server del broker e orario italiano

input group "=== Finestra di osservazione ==="
input int    InpLookbackMinutes      = 10;   // Minuti da guardare prima della notizia (10 = 2 candele M5)
input int    InpSecondsBeforeNews    = 3;    // Secondi prima della notizia in cui si congela il range e si piazzano gli ordini

input group "=== Ordini pendenti (default, modificabili dal pannello) ==="
input double InpPipsDistance         = 3.0;  // Distanza in pips tra massimo/minimo e prezzo di entrata
input double InpLotSize              = 0.10; // Lotti per ogni ordine
input double InpStopLossPips         = 20.0; // Stop Loss in pips (0 = nessuno)
input double InpTakeProfitPips       = 0.0;  // Take Profit finale in pips (0 = nessuno)
input double InpPartialClosePercent  = 50.0; // % di posizione da chiudere al target parziale (0 = disabilitata)
input double InpPartialTriggerPips   = 15.0; // Pips di profitto per far scattare la chiusura parziale
input bool   InpMoveToBreakevenAfterPartial = true; // Sposta lo Stop Loss a pareggio dopo la chiusura parziale
input int    InpExpirationMinutes    = 15;   // Minuti dopo la notizia dopo cui annullare gli ordini non eseguiti
input int    InpSlippagePoints       = 50;   // Deviazione massima in punti per l'invio ordini
input ulong  InpMagicNumber          = 20260825; // Magic number

input group "=== Sicurezza ==="
input bool   InpEnableTrading        = true; // false = simulazione: calcola i livelli ma non invia ordini reali

input group "=== Pannello su grafico ==="
input bool   InpShowPanel            = true; // Mostra il pannello di stato/controllo sul grafico
input int    InpPanelX               = 10;   // Posizione orizzontale del pannello (pixel dal bordo)
input int    InpPanelY               = 20;   // Posizione verticale del pannello (pixel dal bordo)
input double InpPanelScale           = 1.0;  // Scala dimensioni pannello (1.0 = normale, 1.5 = piu' grande, 0.7 = piu' piccolo)

//================================ STATO =====================================

#define PANEL_LINE_H_BASE 16
#define PANEL_FONT_BASE   8

int    g_panelFont  = PANEL_FONT_BASE;
int    g_lineH      = PANEL_LINE_H_BASE;
double g_panelScale = 1.0;

//+------------------------------------------------------------------+
//| Applica la scala corrente del pannello a una dimensione in pixel  |
//+------------------------------------------------------------------+
int SC(const int pixels)
  {
   double scale = g_panelScale;
   if(scale < 0.5) scale = 0.5;
   if(scale > 3.0) scale = 3.0;
   return (int)MathRound(pixels * scale);
  }

enum EventState
  {
   STATE_WAITING  = 0, // in attesa, si aggiorna il range
   STATE_ARMED    = 1, // ordini pendenti piazzati, in attesa di esecuzione/scadenza
   STATE_POSITION = 2, // una posizione e' aperta, gestione parziale/BE in corso
   STATE_DONE     = 3  // evento concluso
  };

struct CategoryState
  {
   bool        active;
   string      label;
   datetime    time;
   EventState  state;
   double      rangeHigh;
   double      rangeLow;
   bool        rangeValid;
   ulong       buyTicket;
   ulong       sellTicket;
   ulong       positionTicket;
   bool        partialDone;
  };

CategoryState g_nfp;
CategoryState g_fomc;

bool     g_tradingEnabledRuntime = true;
bool     g_moveToBreakeven       = true;
double   g_pipsDistance          = 3.0;
double   g_lotSize               = 0.10;
double   g_slPips                = 20.0;
double   g_tpPips                = 0.0;
double   g_partialPercent        = 50.0;
double   g_partialTriggerPips    = 15.0;

string   g_panelPrefix = "AQ_";
CTrade   trade;

//+------------------------------------------------------------------+
//| Azzera una categoria (NFP o FOMC)                                  |
//+------------------------------------------------------------------+
void ResetCategory(CategoryState &cat, const string label)
  {
   cat.active         = false;
   cat.label          = label;
   cat.time           = 0;
   cat.state          = STATE_WAITING;
   cat.rangeHigh      = -1;
   cat.rangeLow       = -1;
   cat.rangeValid     = false;
   cat.buyTicket      = 0;
   cat.sellTicket     = 0;
   cat.positionTicket = 0;
   cat.partialDone    = false;
  }

//+------------------------------------------------------------------+
//| Imposta/riarma una categoria con una nuova data (AAAA.MM.GG) e     |
//| l'orario italiano fisso della categoria (es. "14:30" o "20:00")    |
//+------------------------------------------------------------------+
bool ArmCategory(CategoryState &cat, string dateStr, const string timeItaly)
  {
   StringTrimLeft(dateStr);
   StringTrimRight(dateStr);
   if(dateStr == "")
     {
      PrintFormat("Aquila [%s]: nessuna data inserita, categoria disattivata.", cat.label);
      ResetCategory(cat, cat.label);
      return(false);
     }

   datetime italyTime = StringToTime(dateStr + " " + timeItaly);
   if(italyTime <= 0)
     {
      PrintFormat("Aquila [%s]: data non valida '%s' (usa il formato AAAA.MM.GG).", cat.label, dateStr);
      return(false);
     }

   datetime serverTime = italyTime + InpServerMinusItalyMin * 60;

   ResetCategory(cat, cat.label);
   cat.time   = serverTime;
   cat.active = true;

   PrintFormat("Aquila [%s]: evento impostato -> %s (orario server)", cat.label, TimeToString(serverTime, TIME_DATE | TIME_MINUTES));
   return(true);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);

   g_panelScale = InpPanelScale;
   g_panelFont  = SC(PANEL_FONT_BASE);
   g_lineH      = SC(PANEL_LINE_H_BASE);

   g_tradingEnabledRuntime = InpEnableTrading;
   g_moveToBreakeven       = InpMoveToBreakevenAfterPartial;
   g_pipsDistance          = InpPipsDistance;
   g_lotSize               = InpLotSize;
   g_slPips                = InpStopLossPips;
   g_tpPips                = InpTakeProfitPips;
   g_partialPercent        = InpPartialClosePercent;
   g_partialTriggerPips    = InpPartialTriggerPips;

   ResetCategory(g_nfp, "NFP");
   ResetCategory(g_fomc, "FOMC");

   if(StringLen(InpNFPDefaultDate) > 0)
      ArmCategory(g_nfp, InpNFPDefaultDate, "14:30");
   if(StringLen(InpFOMCDefaultDate) > 0)
      ArmCategory(g_fomc, InpFOMCDefaultDate, "20:00");

   EventSetTimer(1);
   CreatePanel();

   Print("Aquila inizializzato.");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   DestroyPanel();
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
//| [orario_evento - LookbackMinutes*60, orario_evento)               |
//+------------------------------------------------------------------+
bool UpdateRange(CategoryState &cat)
  {
   int barsNeeded = MathMax(InpLookbackMinutes / 5 + 5, 10);

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, PERIOD_M5, 0, barsNeeded, rates);
   if(copied <= 0)
      return(false);

   datetime windowStart = cat.time - InpLookbackMinutes * 60;
   datetime windowEnd   = cat.time; // esclusivo

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
      cat.rangeHigh  = high;
      cat.rangeLow   = low;
      cat.rangeValid = true;
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
//| Piazza i due ordini pendenti (Buy Stop / Sell Stop)                |
//+------------------------------------------------------------------+
void PlaceOrders(CategoryState &cat)
  {
   if(!cat.rangeValid)
     {
      PrintFormat("Aquila [%s]: range non valido, ordini NON piazzati.", cat.label);
      cat.state  = STATE_DONE;
      cat.active = false;
      return;
     }

   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double pip    = PipSize();
   double dist   = g_pipsDistance * pip;

   double buyPrice  = NormalizeDouble(cat.rangeHigh + dist, digits);
   double sellPrice = NormalizeDouble(cat.rangeLow  - dist, digits);

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
   if(g_slPips > 0)
     {
      sl_buy  = NormalizeDouble(buyPrice  - g_slPips * pip, digits);
      sl_sell = NormalizeDouble(sellPrice + g_slPips * pip, digits);
     }
   if(g_tpPips > 0)
     {
      tp_buy  = NormalizeDouble(buyPrice  + g_tpPips * pip, digits);
      tp_sell = NormalizeDouble(sellPrice - g_tpPips * pip, digits);
     }

   double volume = NormalizeVolume(g_lotSize);
   datetime expiration = cat.time + InpExpirationMinutes * 60;

   PrintFormat("Aquila [%s]: range [%s , %s], BuyStop=%s SellStop=%s",
               cat.label, DoubleToString(cat.rangeLow, digits), DoubleToString(cat.rangeHigh, digits),
               DoubleToString(buyPrice, digits), DoubleToString(sellPrice, digits));

   if(!g_tradingEnabledRuntime)
     {
      Print("Aquila: trading disabilitato (pannello), ordini NON inviati (simulazione).");
      cat.state  = STATE_DONE;
      cat.active = false;
      return;
     }

   string cmt = cat.label + " " + TimeToString(cat.time, TIME_DATE | TIME_MINUTES);

   if(trade.BuyStop(volume, buyPrice, _Symbol, sl_buy, tp_buy, ORDER_TIME_SPECIFIED, expiration, cmt))
      cat.buyTicket = trade.ResultOrder();
   else
      PrintFormat("Aquila: errore invio BuyStop: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());

   if(trade.SellStop(volume, sellPrice, _Symbol, sl_sell, tp_sell, ORDER_TIME_SPECIFIED, expiration, cmt))
      cat.sellTicket = trade.ResultOrder();
   else
      PrintFormat("Aquila: errore invio SellStop: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());

   cat.state = STATE_ARMED;
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
void ManageArmedCategory(CategoryState &cat)
  {
   bool buyPending  = OrderStillPending(cat.buyTicket);
   bool sellPending = OrderStillPending(cat.sellTicket);

   if(cat.buyTicket != 0 && !buyPending && sellPending)
     {
      trade.OrderDelete(cat.sellTicket);
      cat.state = STATE_POSITION;
      PrintFormat("Aquila [%s]: BuyStop eseguito, SellStop annullato.", cat.label);
      return;
     }
   if(cat.sellTicket != 0 && !sellPending && buyPending)
     {
      trade.OrderDelete(cat.buyTicket);
      cat.state = STATE_POSITION;
      PrintFormat("Aquila [%s]: SellStop eseguito, BuyStop annullato.", cat.label);
      return;
     }
   if(!buyPending && !sellPending)
     {
      cat.state = STATE_POSITION; // ManagePosition capira' se esiste davvero una posizione
      return;
     }

   if(TimeCurrent() - cat.time > InpExpirationMinutes * 60)
     {
      if(buyPending)  trade.OrderDelete(cat.buyTicket);
      if(sellPending) trade.OrderDelete(cat.sellTicket);
      cat.state = STATE_POSITION;
      PrintFormat("Aquila [%s]: scaduto, ordini pendenti residui cancellati.", cat.label);
     }
  }

//+------------------------------------------------------------------+
//| true se il ticket di posizione e' gia' tracciato da un'altra      |
//| categoria (evita che NFP e FOMC si "rubino" la stessa posizione)  |
//+------------------------------------------------------------------+
bool PositionAlreadyOwned(ulong ticket)
  {
   return(ticket == g_nfp.positionTicket || ticket == g_fomc.positionTicket);
  }

//+------------------------------------------------------------------+
//| Trova/gestisce la posizione aperta dell'evento: chiusura          |
//| parziale al target e spostamento a pareggio                       |
//+------------------------------------------------------------------+
void ManagePosition(CategoryState &cat)
  {
   if(cat.positionTicket == 0)
     {
      for(int i = 0; i < PositionsTotal(); i++)
        {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0 || !PositionSelectByTicket(ticket))
            continue;
         if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagicNumber)
            continue;
         if(PositionGetString(POSITION_SYMBOL) != _Symbol)
            continue;
         if(PositionAlreadyOwned(ticket))
            continue;

         cat.positionTicket = ticket;
         cat.partialDone    = false;
         break;
        }

      if(cat.positionTicket == 0)
        {
         // nessuno dei due ordini e' mai scattato
         cat.state  = STATE_DONE;
         cat.active = false;
         return;
        }
     }

   if(!PositionSelectByTicket(cat.positionTicket))
     {
      PrintFormat("Aquila [%s]: posizione chiusa.", cat.label);
      cat.positionTicket = 0;
      cat.state  = STATE_DONE;
      cat.active = false;
      return;
     }

   if(g_partialPercent > 0 && !cat.partialDone)
     {
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      long   posType   = PositionGetInteger(POSITION_TYPE);
      double pip       = PipSize();
      double curPrice  = (posType == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double profitPips = (posType == POSITION_TYPE_BUY) ? (curPrice - openPrice) / pip : (openPrice - curPrice) / pip;

      if(profitPips >= g_partialTriggerPips)
        {
         double vol      = PositionGetDouble(POSITION_VOLUME);
         double closeVol = NormalizeVolume(vol * g_partialPercent / 100.0);

         if(closeVol > 0 && closeVol < vol)
           {
            if(trade.PositionClosePartial(cat.positionTicket, closeVol))
              {
               cat.partialDone = true;
               PrintFormat("Aquila [%s]: chiusura parziale %.1f%% eseguita a +%.1f pips.", cat.label, g_partialPercent, profitPips);

               if(g_moveToBreakeven && PositionSelectByTicket(cat.positionTicket))
                  trade.PositionModify(cat.positionTicket, openPrice, PositionGetDouble(POSITION_TP));
              }
            else
               PrintFormat("Aquila [%s]: errore chiusura parziale: %d %s", cat.label, trade.ResultRetcode(), trade.ResultRetcodeDescription());
           }
        }
     }
  }

//+------------------------------------------------------------------+
//| Annulla manualmente una categoria: cancella ordini pendenti e     |
//| chiude l'eventuale posizione aperta (pulsante di emergenza)       |
//+------------------------------------------------------------------+
void CancelCategory(CategoryState &cat)
  {
   if(!cat.active)
     {
      PrintFormat("Aquila [%s]: nessun evento attivo da annullare.", cat.label);
      return;
     }

   if(cat.buyTicket != 0 && OrderStillPending(cat.buyTicket))
      trade.OrderDelete(cat.buyTicket);
   if(cat.sellTicket != 0 && OrderStillPending(cat.sellTicket))
      trade.OrderDelete(cat.sellTicket);
   if(cat.positionTicket != 0 && PositionSelectByTicket(cat.positionTicket))
      trade.PositionClose(cat.positionTicket);

   cat.state  = STATE_DONE;
   cat.active = false;
   PrintFormat("Aquila [%s]: annullato manualmente dal pannello.", cat.label);
  }

//+------------------------------------------------------------------+
//| Avanza la macchina a stati di una categoria                       |
//+------------------------------------------------------------------+
void ProcessCategory(CategoryState &cat)
  {
   if(!cat.active)
      return;

   if(cat.state == STATE_WAITING)
     {
      long secToNews = (long)(cat.time - TimeCurrent());

      if(secToNews > InpSecondsBeforeNews)
        {
         UpdateRange(cat);
        }
      else if(secToNews > -60) // margine di tolleranza se il timer/tick arriva in ritardo
        {
         UpdateRange(cat);
         PlaceOrders(cat);
        }
      else
        {
         PrintFormat("Aquila [%s]: evento perso (EA avviato troppo tardi), disattivato.", cat.label);
         cat.state  = STATE_DONE;
         cat.active = false;
        }
     }
   else if(cat.state == STATE_ARMED)
     {
      ManageArmedCategory(cat);
     }
   else if(cat.state == STATE_POSITION)
     {
      ManagePosition(cat);
     }
  }

//+------------------------------------------------------------------+
//| Crea/aggiorna un'etichetta di testo del pannello                  |
//+------------------------------------------------------------------+
void PanelSetLabel(const string name, const int x, const int y, const string text, const color clr)
  {
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, g_panelFont);
      ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, name, OBJPROP_ZORDER, 5);
     }
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
  }

//+------------------------------------------------------------------+
//| Crea un campo di testo modificabile del pannello (una tantum:     |
//| non va MAI ri-creato/sovrascritto da UpdatePanel, altrimenti      |
//| cancelleremmo quello che l'utente sta scrivendo)                  |
//+------------------------------------------------------------------+
void PanelSetEdit(const string name, const int x, const int y, const int w, const int h, const string defaultText)
  {
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_EDIT, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
      ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, g_panelFont);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clrBlack);
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, clrWhite);
      ObjectSetInteger(0, name, OBJPROP_ALIGN, ALIGN_CENTER);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, true);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, name, OBJPROP_ZORDER, 10);
      ObjectSetString(0, name, OBJPROP_TEXT, defaultText);
     }
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
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, g_panelFont);
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
//| Testo di stato sintetico per una categoria                        |
//+------------------------------------------------------------------+
string CategoryStatusText(const CategoryState &cat)
  {
   if(!cat.active)
      return("non impostato");

   if(cat.state == STATE_WAITING)
     {
      long secsLeft = (long)(cat.time - TimeCurrent());
      return StringFormat("%s - countdown %s", TimeToString(cat.time, TIME_DATE | TIME_MINUTES), FormatCountdown(secsLeft));
     }
   if(cat.state == STATE_ARMED)
      return("ordini pendenti piazzati, in attesa");
   if(cat.state == STATE_POSITION)
      return(cat.partialDone ? "posizione aperta (parziale gia' fatto)" : "posizione aperta");
   return("concluso");
  }

//+------------------------------------------------------------------+
//| Testo del range per una categoria                                 |
//+------------------------------------------------------------------+
string CategoryRangeText(const CategoryState &cat)
  {
   if(!cat.active || !cat.rangeValid)
      return("");
   return StringFormat("   Range: H=%s  L=%s", DoubleToString(cat.rangeHigh, _Digits), DoubleToString(cat.rangeLow, _Digits));
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
//| Aggiorna il testo del pulsante BE dopo parziale ON/OFF             |
//+------------------------------------------------------------------+
void UpdateBEButton()
  {
   string name = g_panelPrefix + "BtnBE";
   if(ObjectFind(0, name) < 0)
      return;
   if(g_moveToBreakeven)
     {
      ObjectSetString(0, name, OBJPROP_TEXT, "BE dopo parziale: ON");
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, clrDarkGreen);
     }
   else
     {
      ObjectSetString(0, name, OBJPROP_TEXT, "BE dopo parziale: OFF");
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, clrFireBrick);
     }
  }

//+------------------------------------------------------------------+
//| Ricrea le scritte dinamiche del pannello (mai gli edit box!)      |
//+------------------------------------------------------------------+
void UpdatePanel()
  {
   if(!InpShowPanel)
      return;

   int x = InpPanelX;
   int y = InpPanelY;

   PanelSetLabel(g_panelPrefix + "L0", x, y + 0 * g_lineH, "AQUILA - Dashboard", clrWhite);
   PanelSetLabel(g_panelPrefix + "L1", x, y + 1 * g_lineH,
                 g_tradingEnabledRuntime ? "Modalita': LIVE (invia ordini reali)" : "Modalita': SIMULAZIONE",
                 g_tradingEnabledRuntime ? clrOrange : clrLightGray);

   PanelSetLabel(g_panelPrefix + "L2", x, y + 2 * g_lineH, "NFP: " + CategoryStatusText(g_nfp), clrYellow);
   PanelSetLabel(g_panelPrefix + "L3", x, y + 3 * g_lineH, CategoryRangeText(g_nfp), clrWhite);
   PanelSetLabel(g_panelPrefix + "L4", x, y + 4 * g_lineH, "FOMC: " + CategoryStatusText(g_fomc), clrYellow);
   PanelSetLabel(g_panelPrefix + "L5", x, y + 5 * g_lineH, CategoryRangeText(g_fomc), clrWhite);

   UpdateTradingButton();
   UpdateBEButton();
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
//| Crea tutti gli oggetti del pannello (una tantum, in OnInit)        |
//+------------------------------------------------------------------+
void CreatePanel()
  {
   if(!InpShowPanel)
      return;

   int x = InpPanelX;
   int y = InpPanelY;

   string bg = g_panelPrefix + "BG";
   if(ObjectFind(0, bg) < 0)
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, x - SC(6));
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, y - SC(6));
   ObjectSetInteger(0, bg, OBJPROP_XSIZE, SC(300));
   ObjectSetInteger(0, bg, OBJPROP_YSIZE, SC(460));
   ObjectSetInteger(0, bg, OBJPROP_ZORDER, 0);
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, C'20,20,20');
   ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bg, OBJPROP_COLOR, clrSilver);
   ObjectSetInteger(0, bg, OBJPROP_BACK, false);
   ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);

   // -- Blocco stato (dinamico, gestito da UpdatePanel) --
   PanelSetLabel(g_panelPrefix + "L0", x, y + 0 * g_lineH, "AQUILA - Dashboard", clrWhite);
   PanelSetLabel(g_panelPrefix + "L1", x, y + 1 * g_lineH, "", clrWhite);
   PanelSetLabel(g_panelPrefix + "L2", x, y + 2 * g_lineH, "", clrYellow);
   PanelSetLabel(g_panelPrefix + "L3", x, y + 3 * g_lineH, "", clrWhite);
   PanelSetLabel(g_panelPrefix + "L4", x, y + 4 * g_lineH, "", clrYellow);
   PanelSetLabel(g_panelPrefix + "L5", x, y + 5 * g_lineH, "", clrWhite);

   int by = y + 6 * g_lineH + SC(10);

   // -- Blocco impostazioni (editabile) --
   PanelSetLabel(g_panelPrefix + "LblNFPDate", x, by, "Data NFP (AAAA.MM.GG):", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditNFPDate", x, by + SC(14), SC(140), SC(20), InpNFPDefaultDate);
   PanelSetButton(g_panelPrefix + "BtnSetNFP", x + SC(150), by + SC(14), SC(130), SC(20), "Imposta NFP", clrDarkSlateGray);
   by += SC(38);

   PanelSetLabel(g_panelPrefix + "LblFOMCDate", x, by, "Data FOMC (AAAA.MM.GG):", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditFOMCDate", x, by + SC(14), SC(140), SC(20), InpFOMCDefaultDate);
   PanelSetButton(g_panelPrefix + "BtnSetFOMC", x + SC(150), by + SC(14), SC(130), SC(20), "Imposta FOMC", clrDarkSlateGray);
   by += SC(38);

   PanelSetLabel(g_panelPrefix + "LblDist", x, by, "Distanza pips:", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditDist", x + SC(160), by - SC(2), SC(90), SC(20), DoubleToString(InpPipsDistance, 1));
   by += SC(24);

   PanelSetLabel(g_panelPrefix + "LblLot", x, by, "Lotto:", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditLot", x + SC(160), by - SC(2), SC(90), SC(20), DoubleToString(InpLotSize, 2));
   by += SC(24);

   PanelSetLabel(g_panelPrefix + "LblSL", x, by, "Stop Loss pips:", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditSL", x + SC(160), by - SC(2), SC(90), SC(20), DoubleToString(InpStopLossPips, 1));
   by += SC(24);

   PanelSetLabel(g_panelPrefix + "LblTP", x, by, "Take Profit pips:", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditTP", x + SC(160), by - SC(2), SC(90), SC(20), DoubleToString(InpTakeProfitPips, 1));
   by += SC(24);

   PanelSetLabel(g_panelPrefix + "LblPartPct", x, by, "Chiusura parziale %:", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditPartPct", x + SC(160), by - SC(2), SC(90), SC(20), DoubleToString(InpPartialClosePercent, 1));
   by += SC(24);

   PanelSetLabel(g_panelPrefix + "LblPartTrig", x, by, "Trigger parziale (pips):", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditPartTrig", x + SC(160), by - SC(2), SC(90), SC(20), DoubleToString(InpPartialTriggerPips, 1));
   by += SC(30);

   PanelSetLabel(g_panelPrefix + "LblScale", x, by, "Scala pannello (0.5-3.0):", clrSilver);
   PanelSetEdit(g_panelPrefix + "EditScale", x + SC(160), by - SC(2), SC(90), SC(20), DoubleToString(g_panelScale, 2));
   by += SC(30);

   PanelSetButton(g_panelPrefix + "BtnApply", x, by, SC(140), SC(22), "Applica impostazioni", clrDarkSlateGray);
   PanelSetButton(g_panelPrefix + "BtnApplyScale", x + SC(150), by, SC(130), SC(22), "Applica scala", clrDarkSlateGray);
   by += SC(30);

   PanelSetButton(g_panelPrefix + "BtnTrading", x, by, SC(135), SC(22), "", clrGray);
   PanelSetButton(g_panelPrefix + "BtnBE", x + SC(145), by, SC(135), SC(22), "", clrGray);
   by += SC(28);

   PanelSetButton(g_panelPrefix + "BtnCancelNFP", x, by, SC(135), SC(22), "Annulla NFP", clrMaroon);
   PanelSetButton(g_panelPrefix + "BtnCancelFOMC", x + SC(145), by, SC(135), SC(22), "Annulla FOMC", clrMaroon);
   by += SC(28);

   ObjectSetInteger(0, bg, OBJPROP_YSIZE, (by - y) + SC(20));

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
//| Ricostruisce il pannello con una nuova scala, preservando i         |
//| valori che l'utente aveva gia' scritto nei campi editabili         |
//+------------------------------------------------------------------+
void RebuildPanelKeepingValues()
  {
   string p = g_panelPrefix;

   string savedNFP  = ObjectGetString(0, p + "EditNFPDate", OBJPROP_TEXT);
   string savedFOMC = ObjectGetString(0, p + "EditFOMCDate", OBJPROP_TEXT);
   string savedDist = ObjectGetString(0, p + "EditDist", OBJPROP_TEXT);
   string savedLot  = ObjectGetString(0, p + "EditLot", OBJPROP_TEXT);
   string savedSL   = ObjectGetString(0, p + "EditSL", OBJPROP_TEXT);
   string savedTP   = ObjectGetString(0, p + "EditTP", OBJPROP_TEXT);
   string savedPct  = ObjectGetString(0, p + "EditPartPct", OBJPROP_TEXT);
   string savedTrig = ObjectGetString(0, p + "EditPartTrig", OBJPROP_TEXT);

   DestroyPanel();
   CreatePanel();

   ObjectSetString(0, p + "EditNFPDate", OBJPROP_TEXT, savedNFP);
   ObjectSetString(0, p + "EditFOMCDate", OBJPROP_TEXT, savedFOMC);
   ObjectSetString(0, p + "EditDist", OBJPROP_TEXT, savedDist);
   ObjectSetString(0, p + "EditLot", OBJPROP_TEXT, savedLot);
   ObjectSetString(0, p + "EditSL", OBJPROP_TEXT, savedSL);
   ObjectSetString(0, p + "EditTP", OBJPROP_TEXT, savedTP);
   ObjectSetString(0, p + "EditPartPct", OBJPROP_TEXT, savedPct);
   ObjectSetString(0, p + "EditPartTrig", OBJPROP_TEXT, savedTrig);
   ObjectSetString(0, p + "EditScale", OBJPROP_TEXT, DoubleToString(g_panelScale, 2));
  }

//+------------------------------------------------------------------+
//| Legge i campi editabili e aggiorna i parametri usati dall'EA      |
//+------------------------------------------------------------------+
void ApplyPanelSettings()
  {
   string p = g_panelPrefix;

   double dist     = StringToDouble(ObjectGetString(0, p + "EditDist", OBJPROP_TEXT));
   double lot      = StringToDouble(ObjectGetString(0, p + "EditLot", OBJPROP_TEXT));
   double sl       = StringToDouble(ObjectGetString(0, p + "EditSL", OBJPROP_TEXT));
   double tp       = StringToDouble(ObjectGetString(0, p + "EditTP", OBJPROP_TEXT));
   double partPct  = StringToDouble(ObjectGetString(0, p + "EditPartPct", OBJPROP_TEXT));
   double partTrig = StringToDouble(ObjectGetString(0, p + "EditPartTrig", OBJPROP_TEXT));

   g_pipsDistance       = (dist > 0) ? dist : InpPipsDistance;
   g_lotSize            = (lot  > 0) ? lot  : InpLotSize;
   g_slPips             = (sl   >= 0) ? sl  : 0;
   g_tpPips             = (tp   >= 0) ? tp  : 0;
   g_partialPercent     = (partPct  >= 0 && partPct  <= 100) ? partPct  : 0;
   g_partialTriggerPips = (partTrig >= 0) ? partTrig : 0;

   PrintFormat("Aquila: impostazioni applicate -> distanza=%.1f lotto=%.2f SL=%.1f TP=%.1f parziale=%.1f%% trigger=%.1f pips",
               g_pipsDistance, g_lotSize, g_slPips, g_tpPips, g_partialPercent, g_partialTriggerPips);
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
   else if(sparam == p + "BtnBE")
     {
      g_moveToBreakeven = !g_moveToBreakeven;
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
     }
   else if(sparam == p + "BtnSetNFP")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      string d = ObjectGetString(0, p + "EditNFPDate", OBJPROP_TEXT);
      ArmCategory(g_nfp, d, "14:30");
     }
   else if(sparam == p + "BtnSetFOMC")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      string d = ObjectGetString(0, p + "EditFOMCDate", OBJPROP_TEXT);
      ArmCategory(g_fomc, d, "20:00");
     }
   else if(sparam == p + "BtnApply")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      ApplyPanelSettings();
     }
   else if(sparam == p + "BtnApplyScale")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      double newScale = StringToDouble(ObjectGetString(0, p + "EditScale", OBJPROP_TEXT));
      if(newScale < 0.5) newScale = 0.5;
      if(newScale > 3.0) newScale = 3.0;
      g_panelScale = newScale;
      g_panelFont  = SC(PANEL_FONT_BASE);
      g_lineH      = SC(PANEL_LINE_H_BASE);
      RebuildPanelKeepingValues();
      PrintFormat("Aquila: scala pannello impostata a %.2f", g_panelScale);
     }
   else if(sparam == p + "BtnCancelNFP")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      CancelCategory(g_nfp);
     }
   else if(sparam == p + "BtnCancelFOMC")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      CancelCategory(g_fomc);
     }
   else
      return;

   UpdatePanel();
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   ProcessCategory(g_nfp);
   ProcessCategory(g_fomc);
   UpdatePanel();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ProcessCategory(g_nfp);
   ProcessCategory(g_fomc);
  }
//+------------------------------------------------------------------+
