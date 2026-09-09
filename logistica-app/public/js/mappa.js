// Helper condivisi per le mappe Leaflet (mappa operativa generale + mappa di un giro + selettore coordinate).

const COLORE_DX = '#1c4e80';
const COLORE_SX = '#b5690b';

function creaMappaBase(elementId, opzioni) {
  const mappa = L.map(elementId, { scrollWheelZoom: true, ...(opzioni || {}) });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mappa);
  // Valli di Lanzo come vista iniziale di default.
  mappa.setView([45.28, 7.45], 11);
  return mappa;
}

function iconaNumerata(numero, tipo) {
  const colore = tipo === 'scarico' ? '#b5540b' : '#1c4e80';
  return L.divIcon({
    className: 'icona-tappa',
    html: `<div class="pin-numero" style="background:${colore}"><span>${numero}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function markerEcostazione(eco) {
  if (eco.lat == null || eco.lon == null) return null;
  const colore = eco.lato_cerniera_richiesto === 'sx' ? COLORE_SX : COLORE_DX;
  const m = L.circleMarker([eco.lat, eco.lon], {
    radius: 9,
    color: '#fff',
    weight: 2,
    fillColor: colore,
    fillOpacity: 0.9,
  });
  const scadenza = eco.giorno_scadenza ? `<br>Ritirare entro: ${escapeHtml(eco.giorno_scadenza)} ${escapeHtml(eco.ora_scadenza || '')}` : '';
  m.bindPopup(`
    <strong>${escapeHtml(eco.nome)}</strong> (Ecostazione)<br>
    ${escapeHtml(eco.comune || '')}<br>
    Lato cerniera richiesto: <b>${eco.lato_cerniera_richiesto === 'sx' ? 'Sinistra' : 'Destra'}</b>
    ${scadenza}
    ${eco.cer_code ? `<br>CER: ${escapeHtml(eco.cer_code)}` : ''}
  `);
  return m;
}

function markerImpianto(imp) {
  if (imp.lat == null || imp.lon == null) return null;
  const m = L.marker([imp.lat, imp.lon]);
  const cer = (imp.cer_accettati || []).map((c) => `${escapeHtml(c.cer_code)}${c.principale ? '' : ' (sec.)'}`).join(', ');
  m.bindPopup(`
    <strong>${escapeHtml(imp.nome)}</strong> (Impianto)<br>
    ${escapeHtml(imp.comune || '')}<br>
    ${cer ? `CER accettati: ${cer}<br>` : ''}
    ${imp.referente ? `Referente: ${escapeHtml(imp.referente)}<br>` : ''}
    ${imp.telefono ? `Tel: ${escapeHtml(imp.telefono)}` : ''}
  `);
  return m;
}

// Disegna sulla mappa il percorso ordinato di un giro (tappe con dettaglioTappa già risolto lato server, campo `luogo`).
function disegnaPercorsoGiro(mappa, tappe) {
  const livello = L.layerGroup();
  const coordinate = [];
  tappe.forEach((tappa, i) => {
    if (!tappa.luogo || tappa.luogo.lat == null || tappa.luogo.lon == null) return;
    const latlng = [tappa.luogo.lat, tappa.luogo.lon];
    coordinate.push(latlng);
    const marker = L.marker(latlng, { icon: iconaNumerata(i + 1, tappa.tipo) });
    marker.bindPopup(`
      <strong>${i + 1}. ${escapeHtml(tappa.luogo.nome)}</strong><br>
      ${tappa.tipo === 'ritiro' ? 'Ritiro' : 'Scarico'}${tappa.luogo.comune ? ' — ' + escapeHtml(tappa.luogo.comune) : ''}
      ${tappa.luogo.lato_cerniera_richiesto ? `<br>Lato richiesto: <b>${tappa.luogo.lato_cerniera_richiesto}</b>` : ''}
    `);
    livello.addLayer(marker);
  });
  if (coordinate.length > 1) {
    livello.addLayer(L.polyline(coordinate, { color: '#1c4e80', weight: 4, opacity: 0.7, dashArray: '2,10' }));
  }
  livello.addTo(mappa);
  if (coordinate.length) mappa.fitBounds(coordinate.length > 1 ? coordinate : [coordinate[0]], { padding: [40, 40], maxZoom: 14 });
  return livello;
}

// Collega un piccolo selettore di coordinate su mappa a due input (lat/lon) di un form.
function collegaSelettoreCoordinate(elementId, inputLatId, inputLonId, latIniziale, lonIniziale) {
  const mappa = creaMappaBase(elementId);
  let marker = null;
  const posizionaMarker = (lat, lon) => {
    if (marker) mappa.removeLayer(marker);
    marker = L.marker([lat, lon]).addTo(mappa);
  };
  if (latIniziale != null && lonIniziale != null) {
    mappa.setView([latIniziale, lonIniziale], 14);
    posizionaMarker(latIniziale, lonIniziale);
  }
  mappa.on('click', (e) => {
    document.getElementById(inputLatId).value = e.latlng.lat.toFixed(6);
    document.getElementById(inputLonId).value = e.latlng.lng.toFixed(6);
    posizionaMarker(e.latlng.lat, e.latlng.lng);
  });
  return mappa;
}
