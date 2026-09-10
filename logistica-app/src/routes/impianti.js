const express = require('express');
const db = require('../db');

const router = express.Router();

async function conCer(impianto) {
  if (!impianto) return impianto;
  const cer = (
    await db
      .prepare('SELECT cer_code, descrizione, principale FROM impianti_cer WHERE impianto_id = ? ORDER BY cer_code')
      .all(impianto.id)
  ).map((r) => ({ ...r, principale: !!r.principale }));
  return { ...impianto, cer_accettati: cer };
}

router.get('/', async (req, res) => {
  const { cer } = req.query;
  let rows;
  if (cer) {
    rows = await db
      .prepare(
        `SELECT DISTINCT i.* FROM impianti i
         JOIN impianti_cer ic ON ic.impianto_id = i.id
         WHERE ic.cer_code = ?
         ORDER BY i.comune, i.nome`
      )
      .all(cer);
  } else {
    rows = await db.prepare('SELECT * FROM impianti ORDER BY comune, nome').all();
  }
  res.json(await Promise.all(rows.map(conCer)));
});

router.get('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM impianti WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ errore: 'Impianto non trovato' });
  res.json(await conCer(row));
});

// cerList: array di stringhe ("15.01.01") oppure di oggetti { cer_code, descrizione, principale }
async function impostaCer(impiantoId, cerList) {
  await db.prepare('DELETE FROM impianti_cer WHERE impianto_id = ?').run(impiantoId);
  const stmt = db.prepare(
    'INSERT INTO impianti_cer (impianto_id, cer_code, descrizione, principale) VALUES (?, ?, ?, ?) ON CONFLICT (impianto_id, cer_code) DO NOTHING'
  );
  for (const voce of cerList || []) {
    const obj = typeof voce === 'string' ? { cer_code: voce } : voce || {};
    const code = String(obj.cer_code || '').trim();
    if (!code) continue;
    await stmt.run(impiantoId, code, obj.descrizione || null, obj.principale === false ? 0 : 1);
  }
}

router.post('/', async (req, res) => {
  const { nome, comune, indirizzo, lat, lon, referente, telefono, note, cer_accettati } = req.body;
  if (!nome) return res.status(400).json({ errore: "Il nome dell'impianto è obbligatorio" });
  const info = await db
    .prepare(
      'INSERT INTO impianti (nome, comune, indirizzo, lat, lon, referente, telefono, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(nome, comune || null, indirizzo || null, lat ?? null, lon ?? null, referente || null, telefono || null, note || null);
  await impostaCer(info.lastInsertRowid, cer_accettati);
  res.status(201).json(await conCer(await db.prepare('SELECT * FROM impianti WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM impianti WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Impianto non trovato' });
  const { nome, comune, indirizzo, lat, lon, referente, telefono, note, cer_accettati } = req.body;
  await db
    .prepare(
      `UPDATE impianti SET nome = ?, comune = ?, indirizzo = ?, lat = ?, lon = ?,
     referente = ?, telefono = ?, note = ? WHERE id = ?`
    )
    .run(
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
  if (cer_accettati !== undefined) await impostaCer(req.params.id, cer_accettati);
  res.json(await conCer(await db.prepare('SELECT * FROM impianti WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM impianti WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
