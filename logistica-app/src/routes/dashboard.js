const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const conteggi = {
    ecostazioni: db.prepare('SELECT COUNT(*) AS n FROM ecostazioni').get().n,
    impianti: db.prepare('SELECT COUNT(*) AS n FROM impianti').get().n,
    mezzi: db.prepare('SELECT COUNT(*) AS n FROM mezzi').get().n,
    casse: db.prepare('SELECT COUNT(*) AS n FROM casse').get().n,
    giri: db.prepare('SELECT COUNT(*) AS n FROM giri').get().n,
  };

  const casseStato = db.prepare('SELECT stato, COUNT(*) AS n FROM casse GROUP BY stato').all();
  const casseLato = db.prepare('SELECT lato_cerniera, COUNT(*) AS n FROM casse GROUP BY lato_cerniera').all();

  const tappe = db.prepare('SELECT km_dalla_precedente, minuti_dalla_precedente, minuti_sosta FROM tappe').all();
  const kmTotaliStorico = tappe.reduce((s, t) => s + (t.km_dalla_precedente || 0), 0);
  const minutiTotaliStorico = tappe.reduce(
    (s, t) => s + (t.minuti_dalla_precedente || 0) + (t.minuti_sosta || 0),
    0
  );

  const scambi = db.prepare("SELECT COUNT(*) AS n FROM tappe_casse WHERE azione = 'carica_vuota'").get().n;

  res.json({
    conteggi,
    casse_per_stato: casseStato,
    casse_per_lato: casseLato,
    km_totali_storico: Math.round(kmTotaliStorico * 10) / 10,
    minuti_totali_storico: Math.round(minutiTotaliStorico),
    scambi_diretti_totali: scambi,
  });
});

module.exports = router;
