const express = require('express');
const db = require('../db');
const { distanzaKm } = require('../lib/geo');
const { posizioneTappa, dettaglioTappa } = require('../lib/tappe');

const router = express.Router();

// Fattore di correzione strada-di-montagna rispetto alla linea d'aria, e velocità media stimata.
const FATTORE_STRADA = 1.35;
const VELOCITA_MEDIA_KMH_DEFAULT = 35;

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.*, m.nome AS mezzo_nome,
        (SELECT COUNT(*) FROM tappe t WHERE t.giro_id = g.id) AS numero_tappe
       FROM giri g LEFT JOIN mezzi m ON m.id = g.mezzo_id
       ORDER BY g.data DESC, g.id DESC`
    )
    .all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const giro = db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const tappe = db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);
  res.json({ ...giro, tappe: tappe.map(dettaglioTappa) });
});

router.post('/', (req, res) => {
  const { data, mezzo_id, autista, note } = req.body;
  if (!data) return res.status(400).json({ errore: 'La data del giro è obbligatoria' });
  const info = db
    .prepare('INSERT INTO giri (data, mezzo_id, autista, note) VALUES (?, ?, ?, ?)')
    .run(data, mezzo_id || null, autista || null, note || null);
  res.status(201).json(db.prepare('SELECT * FROM giri WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Giro non trovato' });
  const { data, mezzo_id, autista, stato, note } = req.body;
  db.prepare('UPDATE giri SET data = ?, mezzo_id = ?, autista = ?, stato = ?, note = ? WHERE id = ?').run(
    data ?? existing.data,
    mezzo_id ?? existing.mezzo_id,
    autista ?? existing.autista,
    stato ?? existing.stato,
    note ?? existing.note,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM giri WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Tappe ---

router.post('/:id/tappe', (req, res) => {
  const giro = db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const { tipo, ecostazione_id, impianto_id, note } = req.body;
  if (tipo !== 'ritiro' && tipo !== 'scarico') return res.status(400).json({ errore: 'tipo deve essere "ritiro" o "scarico"' });
  if (tipo === 'ritiro' && !ecostazione_id) return res.status(400).json({ errore: 'ecostazione_id obbligatorio per una tappa di ritiro' });
  if (tipo === 'scarico' && !impianto_id) return res.status(400).json({ errore: 'impianto_id obbligatorio per una tappa di scarico' });

  const { max } = db.prepare('SELECT MAX(ordine) AS max FROM tappe WHERE giro_id = ?').get(giro.id);
  const ordine = (max || 0) + 1;
  const info = db
    .prepare('INSERT INTO tappe (giro_id, ordine, tipo, ecostazione_id, impianto_id, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(giro.id, ordine, tipo, ecostazione_id || null, impianto_id || null, note || null);
  ricalcolaDistanzeGiro(giro.id);
  res.status(201).json(dettaglioTappa(db.prepare('SELECT * FROM tappe WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id/tappe/:tappaId', (req, res) => {
  const tappa = db.prepare('SELECT * FROM tappe WHERE id = ? AND giro_id = ?').get(req.params.tappaId, req.params.id);
  if (!tappa) return res.status(404).json({ errore: 'Tappa non trovata' });
  const { note, minuti_sosta, km_dalla_precedente, minuti_dalla_precedente } = req.body;
  db.prepare(
    'UPDATE tappe SET note = ?, minuti_sosta = ?, km_dalla_precedente = ?, minuti_dalla_precedente = ? WHERE id = ?'
  ).run(
    note ?? tappa.note,
    minuti_sosta ?? tappa.minuti_sosta,
    km_dalla_precedente ?? tappa.km_dalla_precedente,
    minuti_dalla_precedente ?? tappa.minuti_dalla_precedente,
    tappa.id
  );
  res.json(dettaglioTappa(db.prepare('SELECT * FROM tappe WHERE id = ?').get(tappa.id)));
});

router.delete('/:id/tappe/:tappaId', (req, res) => {
  db.prepare('DELETE FROM tappe WHERE id = ? AND giro_id = ?').run(req.params.tappaId, req.params.id);
  riordinaSequenziale(req.params.id);
  ricalcolaDistanzeGiro(req.params.id);
  res.status(204).end();
});

// Riordina le tappe secondo l'array di id passato nel body: { ordine: [idTappa1, idTappa2, ...] }
router.post('/:id/tappe/riordina', (req, res) => {
  const { ordine } = req.body;
  if (!Array.isArray(ordine)) return res.status(400).json({ errore: 'ordine deve essere un array di id tappa' });
  const stmt = db.prepare('UPDATE tappe SET ordine = ? WHERE id = ? AND giro_id = ?');
  const transazione = db.transaction(() => {
    ordine.forEach((tappaId, i) => stmt.run(i + 1, tappaId, req.params.id));
  });
  transazione();
  ricalcolaDistanzeGiro(req.params.id);
  const tappe = db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(req.params.id);
  res.json(tappe.map(dettaglioTappa));
});

function riordinaSequenziale(giroId) {
  const tappe = db.prepare('SELECT id FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giroId);
  const stmt = db.prepare('UPDATE tappe SET ordine = ? WHERE id = ?');
  tappe.forEach((t, i) => stmt.run(i + 1, t.id));
}

// Ricalcola km e minuti tra tappe consecutive quando entrambe hanno coordinate note.
function ricalcolaDistanzeGiro(giroId, velocitaMediaKmh = VELOCITA_MEDIA_KMH_DEFAULT) {
  const tappe = db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giroId);
  let precedente = null;
  tappe.forEach((tappa) => {
    const pos = posizioneTappa(tappa);
    if (precedente && pos) {
      const posPrec = posizioneTappa(precedente);
      const lineaAria = posPrec && pos ? distanzaKm(posPrec.lat, posPrec.lon, pos.lat, pos.lon) : null;
      if (lineaAria !== null) {
        const km = lineaAria * FATTORE_STRADA;
        const minuti = (km / velocitaMediaKmh) * 60;
        db.prepare('UPDATE tappe SET km_dalla_precedente = ?, minuti_dalla_precedente = ? WHERE id = ?').run(
          Math.round(km * 10) / 10,
          Math.round(minuti),
          tappa.id
        );
      }
    }
    precedente = tappa;
  });
}

// Ottimizza l'ordine delle tappe con un euristica "vicino più prossimo" a partire
// da un punto di partenza opzionale { lat, lon } (es. il deposito/rimessa mezzi).
router.post('/:id/ottimizza', (req, res) => {
  const giro = db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const { partenza, velocita_media_kmh } = req.body || {};

  const tappe = db.prepare('SELECT * FROM tappe WHERE giro_id = ?').all(giro.id);
  const conPosizione = tappe
    .map((t) => ({ tappa: t, pos: posizioneTappa(t) }))
    .filter((x) => x.pos && x.pos.lat != null && x.pos.lon != null);
  const senzaPosizione = tappe.filter((t) => !conPosizione.find((x) => x.tappa.id === t.id));

  const rimanenti = [...conPosizione];
  const risultato = [];
  let punto = partenza && partenza.lat != null && partenza.lon != null ? partenza : null;

  while (rimanenti.length) {
    let indiceMigliore = 0;
    if (punto) {
      let distanzaMinima = Infinity;
      rimanenti.forEach((candidato, i) => {
        const d = distanzaKm(punto.lat, punto.lon, candidato.pos.lat, candidato.pos.lon);
        if (d !== null && d < distanzaMinima) {
          distanzaMinima = d;
          indiceMigliore = i;
        }
      });
    }
    const scelto = rimanenti.splice(indiceMigliore, 1)[0];
    risultato.push(scelto.tappa);
    punto = scelto.pos;
  }

  const ordineFinale = [...risultato, ...senzaPosizione];
  const stmt = db.prepare('UPDATE tappe SET ordine = ? WHERE id = ?');
  const transazione = db.transaction(() => {
    ordineFinale.forEach((tappa, i) => stmt.run(i + 1, tappa.id));
  });
  transazione();
  ricalcolaDistanzeGiro(giro.id, velocita_media_kmh || VELOCITA_MEDIA_KMH_DEFAULT);

  const tappeAggiornate = db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);
  res.json({
    tappe: tappeAggiornate.map(dettaglioTappa),
    nota:
      senzaPosizione.length > 0
        ? `${senzaPosizione.length} tappa/e senza coordinate note sono state messe in coda: aggiungi lat/lon per includerle nell'ottimizzazione.`
        : null,
  });
});

// --- Gestione casse su una tappa (carico/scarico piene o vuote) ---

router.post('/:id/tappe/:tappaId/casse', (req, res) => {
  const tappa = db.prepare('SELECT * FROM tappe WHERE id = ? AND giro_id = ?').get(req.params.tappaId, req.params.id);
  if (!tappa) return res.status(404).json({ errore: 'Tappa non trovata' });
  const giro = db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  const { cassa_id, azione } = req.body;
  const cassa = db.prepare('SELECT * FROM casse WHERE id = ?').get(cassa_id);
  if (!cassa) return res.status(404).json({ errore: 'Cassa non trovata' });

  const azioniValideRitiro = ['carica_piena', 'scarica_vuota'];
  const azioniValideScarico = ['scarica_piena', 'carica_vuota'];
  if (tappa.tipo === 'ritiro' && !azioniValideRitiro.includes(azione)) {
    return res.status(400).json({ errore: `Su una tappa di ritiro le azioni valide sono: ${azioniValideRitiro.join(', ')}` });
  }
  if (tappa.tipo === 'scarico' && !azioniValideScarico.includes(azione)) {
    return res.status(400).json({ errore: `Su una tappa di scarico le azioni valide sono: ${azioniValideScarico.join(', ')}` });
  }

  const info = db
    .prepare('INSERT INTO tappe_casse (tappa_id, cassa_id, azione) VALUES (?, ?, ?)')
    .run(tappa.id, cassa_id, azione);

  // Aggiorna posizione/stato della cassa in base all'azione svolta.
  if (azione === 'carica_piena') {
    db.prepare('UPDATE casse SET stato = ?, posizione_tipo = ?, posizione_id = ?, aggiornato_il = CURRENT_TIMESTAMP WHERE id = ?').run(
      'piena',
      'mezzo',
      giro.mezzo_id,
      cassa.id
    );
  } else if (azione === 'scarica_piena') {
    db.prepare('UPDATE casse SET stato = ?, posizione_tipo = ?, posizione_id = ?, aggiornato_il = CURRENT_TIMESTAMP WHERE id = ?').run(
      'vuota',
      'impianto',
      tappa.impianto_id,
      cassa.id
    );
  } else if (azione === 'carica_vuota') {
    db.prepare('UPDATE casse SET stato = ?, posizione_tipo = ?, posizione_id = ?, aggiornato_il = CURRENT_TIMESTAMP WHERE id = ?').run(
      'vuota',
      'mezzo',
      giro.mezzo_id,
      cassa.id
    );
  } else if (azione === 'scarica_vuota') {
    db.prepare('UPDATE casse SET stato = ?, posizione_tipo = ?, posizione_id = ?, aggiornato_il = CURRENT_TIMESTAMP WHERE id = ?').run(
      'vuota',
      'ecostazione',
      tappa.ecostazione_id,
      cassa.id
    );
  }

  res.status(201).json(dettaglioTappa(db.prepare('SELECT * FROM tappe WHERE id = ?').get(tappa.id)));
});

router.delete('/:id/tappe/:tappaId/casse/:tappaCassaId', (req, res) => {
  db.prepare(
    'DELETE FROM tappe_casse WHERE id = ? AND tappa_id = ?'
  ).run(req.params.tappaCassaId, req.params.tappaId);
  res.status(204).end();
});

// Suggerisce, per ogni tappa di ritiro preceduta (nello stesso giro) da uno scarico,
// quali casse vuote disponibili all'impianto hanno il lato cerniera giusto per il cambio diretto.
router.get('/:id/suggerimenti', (req, res) => {
  const giro = db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const tappe = db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);

  const suggerimenti = [];
  let ultimoScarico = null;
  tappe.forEach((tappa) => {
    if (tappa.tipo === 'scarico') {
      ultimoScarico = tappa;
      return;
    }
    if (tappa.tipo === 'ritiro' && ultimoScarico) {
      const eco = db.prepare('SELECT * FROM ecostazioni WHERE id = ?').get(tappa.ecostazione_id);
      if (!eco) return;
      const disponibili = db
        .prepare("SELECT * FROM casse WHERE stato = 'vuota' AND posizione_tipo = 'impianto' AND posizione_id = ?")
        .all(ultimoScarico.impianto_id);
      const compatibili = disponibili.filter((c) => c.lato_cerniera === eco.lato_cerniera_richiesto);
      suggerimenti.push({
        tappa_ritiro_id: tappa.id,
        ecostazione: eco.nome,
        lato_richiesto: eco.lato_cerniera_richiesto,
        tappa_scarico_id: ultimoScarico.id,
        casse_disponibili_impianto: disponibili.length,
        casse_compatibili: compatibili,
        scambio_diretto_possibile: compatibili.length > 0,
        avviso:
          compatibili.length === 0
            ? disponibili.length > 0
              ? `Nessuna cassa vuota con cerniera lato ${eco.lato_cerniera_richiesto} disponibile in questo impianto: le ${disponibili.length} casse presenti hanno il lato sbagliato. Serve un giro di recupero o portare casse vuote da un'altra fonte.`
              : "Nessuna cassa vuota disponibile in questo impianto per lo scambio diretto."
            : null,
      });
    }
  });

  res.json(suggerimenti);
});

// Riepilogo del giro: km/tempo totali, litri stimati, esito scambi.
router.get('/:id/riepilogo', (req, res) => {
  const giro = db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const tappe = db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);
  const mezzo = giro.mezzo_id ? db.prepare('SELECT * FROM mezzi WHERE id = ?').get(giro.mezzo_id) : null;

  const kmTotali = tappe.reduce((somma, t) => somma + (t.km_dalla_precedente || 0), 0);
  const minutiViaggio = tappe.reduce((somma, t) => somma + (t.minuti_dalla_precedente || 0), 0);
  const minutiSosta = tappe.reduce((somma, t) => somma + (t.minuti_sosta || 0), 0);
  const litriStimati = mezzo && mezzo.consumo_km_l ? kmTotali / mezzo.consumo_km_l : null;

  const casseCaricatePiene = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tappe_casse tc JOIN tappe t ON t.id = tc.tappa_id
       WHERE t.giro_id = ? AND tc.azione = 'carica_piena'`
    )
    .get(giro.id).n;
  const casseScaricatePiene = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tappe_casse tc JOIN tappe t ON t.id = tc.tappa_id
       WHERE t.giro_id = ? AND tc.azione = 'scarica_piena'`
    )
    .get(giro.id).n;
  const casseScambiateDirette = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tappe_casse tc JOIN tappe t ON t.id = tc.tappa_id
       WHERE t.giro_id = ? AND tc.azione = 'carica_vuota'`
    )
    .get(giro.id).n;

  res.json({
    km_totali: Math.round(kmTotali * 10) / 10,
    minuti_viaggio: Math.round(minutiViaggio),
    minuti_sosta: Math.round(minutiSosta),
    minuti_totali: Math.round(minutiViaggio + minutiSosta),
    litri_stimati: litriStimati !== null ? Math.round(litriStimati * 10) / 10 : null,
    numero_tappe: tappe.length,
    casse_ritirate_piene: casseCaricatePiene,
    casse_conferite_piene: casseScaricatePiene,
    casse_vuote_scambiate_direttamente: casseScambiateDirette,
  });
});

module.exports = router;
