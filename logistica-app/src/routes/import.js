const express = require('express');
const db = require('../db');

const router = express.Router();

function testoOnullo(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function numeroOnullo(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}
function normalizzaLato(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['sx', 'sinistra', 'sinistro', 'left', 'l'].includes(s)) return 'sx';
  if (['dx', 'destra', 'destro', 'right', 'r'].includes(s)) return 'dx';
  return null;
}

// Importa ecostazioni: colonne attese ->
// nome, comune, indirizzo, lat, lon, lato_cerniera_richiesto (sx/dx), cer_code, giorno_scadenza, ora_scadenza, note
router.post('/ecostazioni', (req, res) => {
  const righe = req.body.righe || [];
  const stmt = db.prepare(
    `INSERT INTO ecostazioni (nome, comune, indirizzo, lat, lon, lato_cerniera_richiesto, cer_code, giorno_scadenza, ora_scadenza, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const errori = [];
  let importate = 0;
  righe.forEach((riga, i) => {
    const nome = testoOnullo(riga.nome);
    if (!nome) {
      errori.push({ riga: i + 1, errore: 'nome mancante' });
      return;
    }
    const lato = normalizzaLato(riga.lato_cerniera_richiesto) || 'dx';
    stmt.run(
      nome,
      testoOnullo(riga.comune),
      testoOnullo(riga.indirizzo),
      numeroOnullo(riga.lat),
      numeroOnullo(riga.lon),
      lato,
      testoOnullo(riga.cer_code),
      testoOnullo(riga.giorno_scadenza),
      testoOnullo(riga.ora_scadenza),
      testoOnullo(riga.note)
    );
    importate += 1;
  });
  res.json({ importate, errori });
});

// Importa impianti: colonne attese ->
// nome, comune, indirizzo, lat, lon, referente, telefono, note, cer_code, descrizione, principale
router.post('/impianti', (req, res) => {
  const righe = req.body.righe || [];
  const trovaOInserisci = db.prepare('SELECT id FROM impianti WHERE nome = ? AND IFNULL(comune,\'\') = IFNULL(?,\'\')');
  const inserisci = db.prepare(
    'INSERT INTO impianti (nome, comune, indirizzo, lat, lon, referente, telefono, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const inserisciCer = db.prepare(
    'INSERT OR IGNORE INTO impianti_cer (impianto_id, cer_code, descrizione, principale) VALUES (?, ?, ?, ?)'
  );
  const errori = [];
  let importate = 0;
  righe.forEach((riga, i) => {
    const nome = testoOnullo(riga.nome);
    if (!nome) {
      errori.push({ riga: i + 1, errore: 'nome mancante' });
      return;
    }
    const comune = testoOnullo(riga.comune);
    let impiantoId;
    const esistente = trovaOInserisci.get(nome, comune);
    if (esistente) {
      impiantoId = esistente.id;
    } else {
      const info = inserisci.run(
        nome,
        comune,
        testoOnullo(riga.indirizzo),
        numeroOnullo(riga.lat),
        numeroOnullo(riga.lon),
        testoOnullo(riga.referente),
        testoOnullo(riga.telefono),
        testoOnullo(riga.note)
      );
      impiantoId = info.lastInsertRowid;
    }
    const cerCode = testoOnullo(riga.cer_code);
    if (cerCode) {
      inserisciCer.run(impiantoId, cerCode, testoOnullo(riga.descrizione), riga.principale === false ? 0 : 1);
    }
    importate += 1;
  });
  res.json({ importate, errori });
});

// Importa casse: colonne attese -> codice, lato_cerniera (sx/dx), stato, cer_code, note
router.post('/casse', (req, res) => {
  const righe = req.body.righe || [];
  const inserisci = db.prepare(
    'INSERT INTO casse (codice, lato_cerniera, stato, cer_code, note) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(codice) DO UPDATE SET lato_cerniera = excluded.lato_cerniera, stato = excluded.stato, ' +
      'cer_code = excluded.cer_code, note = excluded.note, aggiornato_il = CURRENT_TIMESTAMP'
  );
  const errori = [];
  let importate = 0;
  righe.forEach((riga, i) => {
    const codice = testoOnullo(riga.codice);
    const lato = normalizzaLato(riga.lato_cerniera);
    if (!codice || !lato) {
      errori.push({ riga: i + 1, errore: 'codice o lato_cerniera mancante/non valido (usare sx/dx)' });
      return;
    }
    const stato = ['vuota', 'piena', 'in_transito'].includes(riga.stato) ? riga.stato : 'vuota';
    inserisci.run(codice, lato, stato, testoOnullo(riga.cer_code), testoOnullo(riga.note));
    importate += 1;
  });
  res.json({ importate, errori });
});

// Importa mezzi: colonne attese -> nome, targa, capacita_casse, consumo_km_l, note
router.post('/mezzi', (req, res) => {
  const righe = req.body.righe || [];
  const stmt = db.prepare(
    'INSERT INTO mezzi (nome, targa, capacita_casse, consumo_km_l, note) VALUES (?, ?, ?, ?, ?)'
  );
  const errori = [];
  let importate = 0;
  righe.forEach((riga, i) => {
    const nome = testoOnullo(riga.nome);
    if (!nome) {
      errori.push({ riga: i + 1, errore: 'nome mancante' });
      return;
    }
    stmt.run(nome, testoOnullo(riga.targa), numeroOnullo(riga.capacita_casse) || 0, numeroOnullo(riga.consumo_km_l), testoOnullo(riga.note));
    importate += 1;
  });
  res.json({ importate, errori });
});

module.exports = router;
