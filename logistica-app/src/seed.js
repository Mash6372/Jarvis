// Dati reali degli impianti di destinazione, da "Impianti_di_destino.xlsx" (fornito da SIA s.r.l.).
// Vengono caricati automaticamente al primo avvio se la tabella impianti è vuota.

const IMPIANTI = [
  {
    nome: 'CARTAMACERO di Bertolino',
    comune: 'Leinì',
    indirizzo: 'Via Muzio 24 (b.ta Muzio - Leinì)',
    referente: 'Tiziana Gallon (uffici)',
    telefono: '3491865160 / 0114362696',
    cer: [
      { cer_code: '15.01.01', descrizione: 'Carta e cartone', principale: true },
      { cer_code: '20.01.01', descrizione: 'Carta e cartone', principale: true },
    ],
  },
  {
    nome: 'INNOVA ECOSERVIZI SRL',
    comune: 'Venaria Reale',
    indirizzo: 'Corso Cuneo 52 - Venaria',
    referente: 'Davide Manoni (ufficio pesa)',
    telefono: '3485749023 / 3351359196',
    cer: [
      { cer_code: '20.01.39', descrizione: 'Imballaggi in plastica', principale: true },
      { cer_code: '15.01.02', descrizione: 'Imballaggi in plastica', principale: true },
      { cer_code: '20.03.07', descrizione: 'Ingombranti', principale: true },
    ],
  },
  {
    nome: 'ZAFONTE ECOLOGY SRL',
    comune: 'Torino',
    indirizzo: 'Via Reiss Romoli 122/8 - Torino',
    referente: 'Daniela Sesia',
    telefono: '3487165121',
    cer: [
      { cer_code: '15.01.03', descrizione: 'Imballaggi in legno', principale: true },
      { cer_code: '20.01.38', descrizione: 'Imballaggi in legno', principale: true },
      { cer_code: '17.01.07', descrizione: 'Inerti', principale: true },
    ],
  },
  {
    nome: 'WOOD RECYCLING',
    comune: 'Grugliasco',
    indirizzo: 'Interporto SITO, Strada - Grugliasco',
    referente: 'Uffici',
    telefono: '3479607892',
    cer: [
      { cer_code: '15.01.03', descrizione: 'Imballaggi in legno', principale: false },
      { cer_code: '20.01.38', descrizione: 'Imballaggi in legno', principale: false },
    ],
  },
  {
    nome: 'Ecocentro SIA - Grosso',
    comune: 'Grosso',
    indirizzo: 'Località Vauda Grande snc - Grosso',
    referente: 'Roberto De Stefanis',
    telefono: '3394119848',
    cer: [
      { cer_code: '15.01.07', descrizione: 'Vetro', principale: true },
      { cer_code: '20.01.02', descrizione: 'Vetro', principale: true },
    ],
  },
  {
    nome: 'LEIVO',
    comune: 'Vauda Canavese',
    indirizzo: 'Via XXV Aprile 25 (Frazione Palazzo Grosso) - Vauda Canavese',
    referente: 'Uffici',
    telefono: '3201393428',
    cer: [{ cer_code: '17.01.07', descrizione: 'Inerti', principale: false }],
  },
  {
    nome: 'ACEA Pinerolese',
    comune: 'Pinerolo',
    indirizzo: 'Corso Costituzione 19 - Pinerolo',
    referente: 'Ufficio pesa (Nadia Cavigliasso)',
    telefono: '0121236428',
    cer: [
      { cer_code: '20.02.01', descrizione: 'Verde e ramaglie', principale: true },
      { cer_code: '03.01.01', descrizione: 'Verde e ramaglie', principale: true },
      { cer_code: '20.01.08', descrizione: 'Organico', principale: true },
    ],
  },
  {
    nome: 'ITALCONCIMI Srl',
    comune: 'Torino',
    indirizzo: 'Corso Regina Margherita 497 - Torino',
    referente: 'Delfino Sremin',
    telefono: '3358350846',
    cer: [
      { cer_code: '20.02.01', descrizione: 'Verde e ramaglie', principale: false },
      { cer_code: '03.01.01', descrizione: 'Verde e ramaglie', principale: false },
    ],
  },
  {
    nome: 'HAIKI RECYCLING',
    comune: 'Chivasso',
    indirizzo: 'Regione Pozzo (ex Fornace) - Chivasso',
    referente: 'Stefano Albera',
    telefono: '3452507923',
    cer: [{ cer_code: '16.01.03', descrizione: 'Pneumatici', principale: false }],
  },
  {
    nome: 'CUMIANA GOMME GROUP - Sede di Settimo T.se',
    comune: 'Settimo Torinese',
    indirizzo: 'Via Sicilia 10 - Settimo Torinese',
    referente: 'Gianluca Piarulli',
    telefono: '3295912989',
    cer: [{ cer_code: '16.01.03', descrizione: 'Pneumatici', principale: true }],
  },
  {
    nome: 'TRM',
    comune: 'Torino',
    indirizzo: 'Strada del Portone - Torino',
    referente: 'Angelica Facelli',
    telefono: '3397785948',
    cer: [{ cer_code: '20.03.01', descrizione: 'RSU', principale: true }],
  },
];

function seedSeVuoto(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM impianti').get();
  if (count > 0) return;

  const inserisciImpianto = db.prepare(
    'INSERT INTO impianti (nome, comune, indirizzo, referente, telefono) VALUES (?, ?, ?, ?, ?)'
  );
  const inserisciCer = db.prepare(
    'INSERT INTO impianti_cer (impianto_id, cer_code, descrizione, principale) VALUES (?, ?, ?, ?)'
  );

  const inserisciTutto = db.transaction(() => {
    IMPIANTI.forEach((impianto) => {
      const info = inserisciImpianto.run(
        impianto.nome,
        impianto.comune,
        impianto.indirizzo,
        impianto.referente,
        impianto.telefono
      );
      impianto.cer.forEach((voce) => {
        inserisciCer.run(info.lastInsertRowid, voce.cer_code, voce.descrizione, voce.principale ? 1 : 0);
      });
    });
  });
  inserisciTutto();
  console.log(`Precaricati ${IMPIANTI.length} impianti di destinazione (dati SIA s.r.l.).`);
}

module.exports = { seedSeVuoto };
