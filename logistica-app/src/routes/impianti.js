const express = require('express');
const db = require('../db');

const router = express.Router();

function conCer(impianto) {
  if (!impianto) return impianto;
  const cer = db
    .prepare('SELECT cer_code, descrizione, principale FROM impianti_cer WHERE impianto_id = ? ORDER BY cer_code')
    .all(impianto.id)
    .map((r) => ({ ...r, principale: !!r.principale }));
  return { ...impianto, cer_accettati: cer };
}

router.get('/', (req, res) => {
  const { cer } = req.query;
  let rows;
  if (cer) {
    rows = db
      .prepare(
        `SELECT DISTINCT i.* FROM impianti i
         JOIN impianti_cer ic ON ic.impianto_id = i.id
         WHERE ic.cer_code = ?
         ORDER BY i.comune, i.nome`
      )
      .all(cer);
  } else {
    rows = db.prepare('SELECT * FROM impianti ORDER BY comune, nome').all();
  }
  res.json(rows.map(conCer));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM impianti WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ errore: 'Impianto non trovato' });
  res.json(conCer(row));
});

// cerList: array di stringhe ("15.01.01") oppure di oggetti { cer_code, descrizione, principale }
function impostaCer(impiantoId, cerList) {
  db.prepare('DELETE FROM impianti_cer WHERE impianto_id = ?').run(impiantoId);
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO impianti_cer (impianto_id, cer_code, descrizione, principale) VALUES (?, ?, ?, ?)'
  );
  (cerList || []).forEach((voce) => {
    const obj = typeof voce === 'string' ? { cer_code: voce } : voce || {};
    const code = String(obj.cer_code || '').trim();
    if (!code) return;
    stmt.run(impiantoId, code, obj.descrizione || null, obj.principale === false ? 0 : 1);
  });
}

router.post('/', (req, res) => {
  const { nome, comune, indirizzo, lat, lon, referente, telefono, note, cer_accettati } = req.body;
  if (!nome) return res.status(400).json({ errore: "Il nome dell'impianto è obbligatorio" });
  const info = db
    .prepare(
      'INSERT INTO impianti (nome, comune, indirizzo, lat, lon, referente, telefono, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(nome, comune || null, indirizzo || null, lat ?? null, lon ?? null, referente || null, telefono || null, note || null);
  impostaCer(info.lastInsertRowid, cer_accettati);
  res.status(201).json(conCer(db.prepare('SELECT * FROM impianti WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM impianti WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Impianto non trovato' });
  const { nome, comune, indirizzo, lat, lon, referente, telefono, note, cer_accettati } = req.body;
  db.prepare(
    `UPDATE impianti SET nome = ?, comune = ?, indirizzo = ?, lat = ?, lon = ?,
     referente = ?, telefono = ?, note = ? WHERE id = ?`
  ).run(
    nome ?? existing.nome,
    comune ?? existing.comune,
    indirizzo ?? existing.indirizzo,
    lat ?? existing.lat,
    lon ?? existing.lon,
    referente ?? existing.referente,
    telefono ?? existing.telefono,
    note ?? existing.note,
    req.params.id
  );
  if (cer_accettati !== undefined) impostaCer(req.params.id, cer_accettati);
  res.json(conCer(db.prepare('SELECT * FROM impianti WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM impianti WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
