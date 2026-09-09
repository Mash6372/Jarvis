const express = require('express');
const db = require('../db');

const router = express.Router();

function validaLato(lato) {
  return lato === 'sx' || lato === 'dx';
}
function validaStato(stato) {
  return ['vuota', 'piena', 'in_transito'].includes(stato);
}
function validaPosizioneTipo(tipo) {
  return ['ecostazione', 'impianto', 'mezzo', 'ignota'].includes(tipo);
}

router.get('/', (req, res) => {
  const { stato, lato_cerniera, posizione_tipo, posizione_id } = req.query;
  const clausole = [];
  const params = [];
  if (stato) {
    clausole.push('stato = ?');
    params.push(stato);
  }
  if (lato_cerniera) {
    clausole.push('lato_cerniera = ?');
    params.push(lato_cerniera);
  }
  if (posizione_tipo) {
    clausole.push('posizione_tipo = ?');
    params.push(posizione_tipo);
  }
  if (posizione_id) {
    clausole.push('posizione_id = ?');
    params.push(posizione_id);
  }
  const where = clausole.length ? `WHERE ${clausole.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM casse ${where} ORDER BY codice`).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM casse WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ errore: 'Cassa non trovata' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { codice, lato_cerniera, stato, cer_code, posizione_tipo, posizione_id, note } = req.body;
  if (!codice) return res.status(400).json({ errore: 'Il codice della cassa è obbligatorio' });
  if (!validaLato(lato_cerniera)) return res.status(400).json({ errore: 'lato_cerniera deve essere "sx" o "dx"' });
  const statoFinale = stato || 'vuota';
  if (!validaStato(statoFinale)) return res.status(400).json({ errore: 'stato non valido' });
  const posTipo = posizione_tipo || 'ignota';
  if (!validaPosizioneTipo(posTipo)) return res.status(400).json({ errore: 'posizione_tipo non valido' });
  try {
    const info = db
      .prepare(
        `INSERT INTO casse (codice, lato_cerniera, stato, cer_code, posizione_tipo, posizione_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(codice, lato_cerniera, statoFinale, cer_code || null, posTipo, posizione_id ?? null, note || null);
    res.status(201).json(db.prepare('SELECT * FROM casse WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ errore: `Esiste già una cassa con codice ${codice}` });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM casse WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Cassa non trovata' });
  const { codice, lato_cerniera, stato, cer_code, posizione_tipo, posizione_id, note } = req.body;
  const lato = lato_cerniera ?? existing.lato_cerniera;
  if (!validaLato(lato)) return res.status(400).json({ errore: 'lato_cerniera deve essere "sx" o "dx"' });
  const statoFinale = stato ?? existing.stato;
  if (!validaStato(statoFinale)) return res.status(400).json({ errore: 'stato non valido' });
  const posTipo = posizione_tipo ?? existing.posizione_tipo;
  if (!validaPosizioneTipo(posTipo)) return res.status(400).json({ errore: 'posizione_tipo non valido' });
  db.prepare(
    `UPDATE casse SET codice = ?, lato_cerniera = ?, stato = ?, cer_code = ?,
     posizione_tipo = ?, posizione_id = ?, note = ?, aggiornato_il = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    codice ?? existing.codice,
    lato,
    statoFinale,
    cer_code ?? existing.cer_code,
    posTipo,
    posizione_id ?? existing.posizione_id,
    note ?? existing.note,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM casse WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM casse WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
