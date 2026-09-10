const db = require('../db');

// Restituisce { lat, lon, nome, comune, lato_cerniera_richiesto? } per una tappa,
// leggendo dall'ecostazione o dall'impianto collegato.
async function posizioneTappa(tappa) {
  if (tappa.tipo === 'ritiro' && tappa.ecostazione_id) {
    const e = await db.prepare('SELECT * FROM ecostazioni WHERE id = ?').get(tappa.ecostazione_id);
    if (!e) return null;
    return { lat: e.lat, lon: e.lon, nome: e.nome, comune: e.comune, lato_cerniera_richiesto: e.lato_cerniera_richiesto };
  }
  if (tappa.tipo === 'scarico' && tappa.impianto_id) {
    const im = await db.prepare('SELECT * FROM impianti WHERE id = ?').get(tappa.impianto_id);
    if (!im) return null;
    return { lat: im.lat, lon: im.lon, nome: im.nome, comune: im.comune };
  }
  return null;
}

async function dettaglioTappa(tappa) {
  const pos = await posizioneTappa(tappa);
  const casse = await db
    .prepare(
      `SELECT tc.id AS tappa_cassa_id, tc.azione, c.*
       FROM tappe_casse tc JOIN casse c ON c.id = tc.cassa_id
       WHERE tc.tappa_id = ?`
    )
    .all(tappa.id);
  return { ...tappa, luogo: pos, casse };
}

module.exports = { posizioneTappa, dettaglioTappa };
