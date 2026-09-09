const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM mezzi ORDER BY nome').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM mezzi WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ errore: 'Mezzo non trovato' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { nome, targa, capacita_casse, consumo_km_l, note } = req.body;
  if (!nome) return res.status(400).json({ errore: 'Il nome del mezzo è obbligatorio' });
  const info = db
    .prepare(
      'INSERT INTO mezzi (nome, targa, capacita_casse, consumo_km_l, note) VALUES (?, ?, ?, ?, ?)'
    )
    .run(nome, targa || null, capacita_casse || 0, consumo_km_l || null, note || null);
  res.status(201).json(db.prepare('SELECT * FROM mezzi WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM mezzi WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Mezzo non trovato' });
  const { nome, targa, capacita_casse, consumo_km_l, note } = req.body;
  db.prepare(
    'UPDATE mezzi SET nome = ?, targa = ?, capacita_casse = ?, consumo_km_l = ?, note = ? WHERE id = ?'
  ).run(
    nome ?? existing.nome,
    targa ?? existing.targa,
    capacita_casse ?? existing.capacita_casse,
    consumo_km_l ?? existing.consumo_km_l,
    note ?? existing.note,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM mezzi WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM mezzi WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
