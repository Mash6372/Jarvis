const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM mezzi ORDER BY nome').all();
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM mezzi WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ errore: 'Mezzo non trovato' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const { nome, targa, capacita_casse, consumo_km_l, note } = req.body;
  if (!nome) return res.status(400).json({ errore: 'Il nome del mezzo è obbligatorio' });
  const info = await db
    .prepare(
      'INSERT INTO mezzi (nome, targa, capacita_casse, consumo_km_l, note) VALUES (?, ?, ?, ?, ?)'
    )
    .run(nome, targa || null, capacita_casse || 0, consumo_km_l || null, note || null);
  res.status(201).json(await db.prepare('SELECT * FROM mezzi WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM mezzi WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Mezzo non trovato' });
  const { nome, targa, capacita_casse, consumo_km_l, note } = req.body;
  await db
    .prepare('UPDATE mezzi SET nome = ?, targa = ?, capacita_casse = ?, consumo_km_l = ?, note = ? WHERE id = ?')
    .run(
      nome ?? existing.nome,
      targa ?? existing.targa,
      capacita_casse ?? existing.capacita_casse,
      consumo_km_l ?? existing.consumo_km_l,
      note ?? existing.note,
      req.params.id
    );
  res.json(await db.prepare('SELECT * FROM mezzi WHERE id = ?').get(req.params.id));
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM mezzi WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
