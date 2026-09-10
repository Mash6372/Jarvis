const express = require('express');
const db = require('../db');
const { distanzaKm } = require('../lib/geo');
const { posizioneTappa, dettaglioTappa } = require('../lib/tappe');

const router = express.Router();

// Fattore di correzione strada-di-montagna rispetto alla linea d'aria, e velocità media stimata.
const FATTORE_STRADA = 1.35;
const VELOCITA_MEDIA_KMH_DEFAULT = 35;

router.get('/', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT g.*, m.nome AS mezzo_nome,
        (SELECT COUNT(*) FROM tappe t WHERE t.giro_id = g.id)::int AS numero_tappe
       FROM giri g LEFT JOIN mezzi m ON m.id = g.mezzo_id
       ORDER BY g.data DESC, g.id DESC`
    )
    .all();
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const giro = await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const tappe = await db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);
  res.json({ ...giro, tappe: await Promise.all(tappe.map(dettaglioTappa)) });
});

router.post('/', async (req, res) => {
  const { data, mezzo_id, autista, note } = req.body;
  if (!data) return res.status(400).json({ errore: 'La data del giro è obbligatoria' });
  const info = await db
    .prepare('INSERT INTO giri (data, mezzo_id, autista, note) VALUES (?, ?, ?, ?)')
    .run(data, mezzo_id || null, autista || null, note || null);
  res.status(201).json(await db.prepare('SELECT * FROM giri WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ errore: 'Giro non trovato' });
  const { data, mezzo_id, autista, stato, note } = req.body;
  await db
    .prepare('UPDATE giri SET data = ?, mezzo_id = ?, autista = ?, stato = ?, note = ? WHERE id = ?')
    .run(
      data ?? existing.data,
      mezzo_id ?? existing.mezzo_id,
      autista ?? existing.autista,
      stato ?? existing.stato,
      note ?? existing.note,
      req.params.id
    );
  res.json(await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id));
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM giri WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Tappe ---

router.post('/:id/tappe', async (req, res) => {
  const giro = await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const { tipo, ecostazione_id, impianto_id, note } = req.body;
  if (tipo !== 'ritiro' && tipo !== 'scarico') return res.status(400).json({ errore: 'tipo deve essere "ritiro" o "scarico"' });
  if (tipo === 'ritiro' && !ecostazione_id) return res.status(400).json({ errore: 'ecostazione_id obbligatorio per una tappa di ritiro' });
  if (tipo === 'scarico' && !impianto_id) return res.status(400).json({ errore: 'impianto_id obbligatorio per una tappa di scarico' });

  const { max } = await db.prepare('SELECT MAX(ordine) AS max FROM tappe WHERE giro_id = ?').get(giro.id);
  const ordine = (max || 0) + 1;
  const info = await db
    .prepare('INSERT INTO tappe (giro_id, ordine, tipo, ecostazione_id, impianto_id, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(giro.id, ordine, tipo, ecostazione_id || null, impianto_id || null, note || null);
  await ricalcolaDistanzeGiro(giro.id);
  res.status(201).json(await dettaglioTappa(await db.prepare('SELECT * FROM tappe WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id/tappe/:tappaId', async (req, res) => {
  const tappa = await db.prepare('SELECT * FROM tappe WHERE id = ? AND giro_id = ?').get(req.params.tappaId, req.params.id);
  if (!tappa) return res.status(404).json({ errore: 'Tappa non trovata' });
  const { note, minuti_sosta, km_dalla_precedente, minuti_dalla_precedente } = req.body;
  await db
    .prepare('UPDATE tappe SET note = ?, minuti_sosta = ?, km_dalla_precedente = ?, minuti_dalla_precedente = ? WHERE id = ?')
    .run(
      note ?? tappa.note,
      minuti_sosta ?? tappa.minuti_sosta,
      km_dalla_precedente ?? tappa.km_dalla_precedente,
      minuti_dalla_precedente ?? tappa.minuti_dalla_precedente,
      tappa.id
    );
  res.json(await dettaglioTappa(await db.prepare('SELECT * FROM tappe WHERE id = ?').get(tappa.id)));
});

router.delete('/:id/tappe/:tappaId', async (req, res) => {
  await db.prepare('DELETE FROM tappe WHERE id = ? AND giro_id = ?').run(req.params.tappaId, req.params.id);
  await riordinaSequenziale(req.params.id);
  await ricalcolaDistanzeGiro(req.params.id);
  res.status(204).end();
});

// Riordina le tappe secondo l'array di id passato nel body: { ordine: [idTappa1, idTappa2, ...] }
router.post('/:id/tappe/riordina', async (req, res) => {
  const { ordine } = req.body;
  if (!Array.isArray(ordine)) return res.status(400).json({ errore: 'ordine deve essere un array di id tappa' });
  const applicaOrdine = db.transaction(async (scopedDb) => {
    const stmt = scopedDb.prepare('UPDATE tappe SET ordine = ? WHERE id = ? AND giro_id = ?');
    for (let i = 0; i < ordine.length; i++) {
      await stmt.run(i + 1, ordine[i], req.params.id);
    }
  });
  await applicaOrdine();
  await ricalcolaDistanzeGiro(req.params.id);
  const tappe = await db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(req.params.id);
  res.json(await Promise.all(tappe.map(dettaglioTappa)));
});

async function riordinaSequenziale(giroId) {
  const tappe = await db.prepare('SELECT id FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giroId);
  const stmt = db.prepare('UPDATE tappe SET ordine = ? WHERE id = ?');
  for (let i = 0; i < tappe.length; i++) {
    await stmt.run(i + 1, tappe[i].id);
  }
}

// Ricalcola km e minuti tra tappe consecutive quando entrambe hanno coordinate note.
async function ricalcolaDistanzeGiro(giroId, velocitaMediaKmh = VELOCITA_MEDIA_KMH_DEFAULT) {
  const tappe = await db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giroId);
  let precedente = null;
  for (const tappa of tappe) {
    const pos = await posizioneTappa(tappa);
    if (precedente && pos) {
      const posPrec = await posizioneTappa(precedente);
      const lineaAria = posPrec && pos ? distanzaKm(posPrec.lat, posPrec.lon, pos.lat, pos.lon) : null;
      if (lineaAria !== null) {
        const km = lineaAria * FATTORE_STRADA;
        const minuti = (km / velocitaMediaKmh) * 60;
        await db
          .prepare('UPDATE tappe SET km_dalla_precedente = ?, minuti_dalla_precedente = ? WHERE id = ?')
          .run(Math.round(km * 10) / 10, Math.round(minuti), tappa.id);
      }
    }
    precedente = tappa;
  }
}

// Ottimizza l'ordine delle tappe con un euristica "vicino più prossimo" a partire
// da un punto di partenza opzionale { lat, lon } (es. il deposito/rimessa mezzi).
router.post('/:id/ottimizza', async (req, res) => {
  const giro = await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const { partenza, velocita_media_kmh } = req.body || {};

  const tappe = await db.prepare('SELECT * FROM tappe WHERE giro_id = ?').all(giro.id);
  const conPosizioneCandidate = await Promise.all(tappe.map(async (t) => ({ tappa: t, pos: await posizioneTappa(t) })));
  const conPosizione = conPosizioneCandidate.filter((x) => x.pos && x.pos.lat != null && x.pos.lon != null);
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
  const applicaOrdine = db.transaction(async (scopedDb) => {
    const stmt = scopedDb.prepare('UPDATE tappe SET ordine = ? WHERE id = ?');
    for (let i = 0; i < ordineFinale.length; i++) {
      await stmt.run(i + 1, ordineFinale[i].id);
    }
  });
  await applicaOrdine();
  await ricalcolaDistanzeGiro(giro.id, velocita_media_kmh || VELOCITA_MEDIA_KMH_DEFAULT);

  const tappeAggiornate = await db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);
  res.json({
    tappe: await Promise.all(tappeAggiornate.map(dettaglioTappa)),
    nota:
      senzaPosizione.length > 0
        ? `${senzaPosizione.length} tappa/e senza coordinate note sono state messe in coda: aggiungi lat/lon per includerle nell'ottimizzazione.`
        : null,
  });
});

// --- Gestione casse su una tappa (carico/scarico piene o vuote) ---

router.post('/:id/tappe/:tappaId/casse', async (req, res) => {
  const tappa = await db.prepare('SELECT * FROM tappe WHERE id = ? AND giro_id = ?').get(req.params.tappaId, req.params.id);
  if (!tappa) return res.status(404).json({ errore: 'Tappa non trovata' });
  const giro = await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  const { cassa_id, azione } = req.body;
  const cassa = await db.prepare('SELECT * FROM casse WHERE id = ?').get(cassa_id);
  if (!cassa) return res.status(404).json({ errore: 'Cassa non trovata' });

  const azioniValideRitiro = ['carica_piena', 'scarica_vuota'];
  const azioniValideScarico = ['scarica_piena', 'carica_vuota'];
  if (tappa.tipo === 'ritiro' && !azioniValideRitiro.includes(azione)) {
    return res.status(400).json({ errore: `Su una tappa di ritiro le azioni valide sono: ${azioniValideRitiro.join(', ')}` });
  }
  if (tappa.tipo === 'scarico' && !azioniValideScarico.includes(azione)) {
    return res.status(400).json({ errore: `Su una tappa di scarico le azioni valide sono: ${azioniValideScarico.join(', ')}` });
  }

  await db.prepare('INSERT INTO tappe_casse (tappa_id, cassa_id, azione) VALUES (?, ?, ?)').run(tappa.id, cassa_id, azione);

  const aggiornaCassa = db.prepare(
    "UPDATE casse SET stato = ?, posizione_tipo = ?, posizione_id = ?, aggiornato_il = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?"
  );

  // Aggiorna posizione/stato della cassa in base all'azione svolta.
  if (azione === 'carica_piena') {
    await aggiornaCassa.run('piena', 'mezzo', giro.mezzo_id, cassa.id);
  } else if (azione === 'scarica_piena') {
    await aggiornaCassa.run('vuota', 'impianto', tappa.impianto_id, cassa.id);
  } else if (azione === 'carica_vuota') {
    await aggiornaCassa.run('vuota', 'mezzo', giro.mezzo_id, cassa.id);
  } else if (azione === 'scarica_vuota') {
    await aggiornaCassa.run('vuota', 'ecostazione', tappa.ecostazione_id, cassa.id);
  }

  res.status(201).json(await dettaglioTappa(await db.prepare('SELECT * FROM tappe WHERE id = ?').get(tappa.id)));
});

router.delete('/:id/tappe/:tappaId/casse/:tappaCassaId', async (req, res) => {
  await db.prepare('DELETE FROM tappe_casse WHERE id = ? AND tappa_id = ?').run(req.params.tappaCassaId, req.params.tappaId);
  res.status(204).end();
});

// Suggerisce, per ogni tappa di ritiro preceduta (nello stesso giro) da uno scarico,
// quali casse vuote disponibili all'impianto hanno il lato cerniera giusto per il cambio diretto.
router.get('/:id/suggerimenti', async (req, res) => {
  const giro = await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const tappe = await db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);

  const suggerimenti = [];
  let ultimoScarico = null;
  for (const tappa of tappe) {
    if (tappa.tipo === 'scarico') {
      ultimoScarico = tappa;
      continue;
    }
    if (tappa.tipo === 'ritiro' && ultimoScarico) {
      const eco = await db.prepare('SELECT * FROM ecostazioni WHERE id = ?').get(tappa.ecostazione_id);
      if (!eco) continue;
      const disponibili = await db
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
  }

  res.json(suggerimenti);
});

// Riepilogo del giro: km/tempo totali, litri stimati, esito scambi.
router.get('/:id/riepilogo', async (req, res) => {
  const giro = await db.prepare('SELECT * FROM giri WHERE id = ?').get(req.params.id);
  if (!giro) return res.status(404).json({ errore: 'Giro non trovato' });
  const tappe = await db.prepare('SELECT * FROM tappe WHERE giro_id = ? ORDER BY ordine').all(giro.id);
  const mezzo = giro.mezzo_id ? await db.prepare('SELECT * FROM mezzi WHERE id = ?').get(giro.mezzo_id) : null;

  const kmTotali = tappe.reduce((somma, t) => somma + (Number(t.km_dalla_precedente) || 0), 0);
  const minutiViaggio = tappe.reduce((somma, t) => somma + (Number(t.minuti_dalla_precedente) || 0), 0);
  const minutiSosta = tappe.reduce((somma, t) => somma + (Number(t.minuti_sosta) || 0), 0);
  const litriStimati = mezzo && mezzo.consumo_km_l ? kmTotali / mezzo.consumo_km_l : null;

  const casseCaricatePiene = (
    await db
      .prepare(
        `SELECT COUNT(*)::int AS n FROM tappe_casse tc JOIN tappe t ON t.id = tc.tappa_id
       WHERE t.giro_id = ? AND tc.azione = 'carica_piena'`
      )
      .get(giro.id)
  ).n;
  const casseScaricatePiene = (
    await db
      .prepare(
        `SELECT COUNT(*)::int AS n FROM tappe_casse tc JOIN tappe t ON t.id = tc.tappa_id
       WHERE t.giro_id = ? AND tc.azione = 'scarica_piena'`
      )
      .get(giro.id)
  ).n;
  const casseScambiateDirette = (
    await db
      .prepare(
        `SELECT COUNT(*)::int AS n FROM tappe_casse tc JOIN tappe t ON t.id = tc.tappa_id
       WHERE t.giro_id = ? AND tc.azione = 'carica_vuota'`
      )
      .get(giro.id)
  ).n;

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
