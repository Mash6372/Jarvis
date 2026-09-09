const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM ecostazioni ORDER BY comune, nome').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM ecostazioni WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ errore: 'Ecostazione non trovata' });
  res.json(row);
});

function validaLato(lato) {
  return lato === 'sx' || lato === 'dx';
}

router.post('/', (req, res) => {
  const { nome, comune, indirizzo, lat, lon, lato_cerniera_richiesto, cer_code, giorno_scadenza, ora_scadenza, note } =
    req.body;
  if (!nome) return res.status(400).json({ errore: "Il nome dell'ecostazione è obbligatorio" });
  const lato = lato_cerniera_richiesto || 'dx';
  if (!validaLato(lato)) return res.status(400).json({ errore: 'lato_cerniera_richiesto deve essere "sx" o "dx"' });
  const info = db
    .prepare(
      `INSERT INTO ecostazioni (nome, comune, indirizzo, lat, lon, lato_cerniera_richiesto, cer_code, giorno_scadenza, ora_scadenza, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nome,
      comune || null,
      indirizzo || null,
      lat ?? null,
      lon ?? null,
      lato,
      cer_code || null,
      giorno_scadenza || null,
      ora_scadenza || null,
      note || null
    );
  res.status(201).json(db.prepare('SELECT * FROM ecostazioni WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM ecostazioni WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Ecostazione non trovata' });
  const { nome, comune, indirizzo, lat, lon, lato_cerniera_richiesto, cer_code, giorno_scadenza, ora_scadenza, note } =
    req.body;
  const lato = lato_cerniera_richiesto ?? existing.lato_cerniera_richiesto;
  if (!validaLato(lato)) return res.status(400).json({ errore: 'lato_cerniera_richiesto deve essere "sx" o "dx"' });
  db.prepare(
    `UPDATE ecostazioni SET nome = ?, comune = ?, indirizzo = ?, lat = ?, lon = ?,
     lato_cerniera_richiesto = ?, cer_code = ?, giorno_scadenza = ?, ora_scadenza = ?, note = ? WHERE id = ?`
  ).run(
    nome ?? existing.nome,
    comune ?? existing.comune,
    indirizzo ?? existing.indirizzo,
    lat ?? existing.lat,
    lon ?? existing.lon,
    lato,
    cer_code ?? existing.cer_code,
    giorno_scadenza ?? existing.giorno_scadenza,
    ora_scadenza ?? existing.ora_scadenza,
    note ?? existing.note,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM ecostazioni WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM ecostazioni WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
