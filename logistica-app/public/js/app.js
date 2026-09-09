// ---------- Helpers generici ----------

async function api(metodo, url, corpo) {
  const opzioni = { method: metodo, headers: {} };
  if (corpo !== undefined) {
    opzioni.headers['Content-Type'] = 'application/json';
    opzioni.body = JSON.stringify(corpo);
  }
  const risposta = await fetch(url, opzioni);
  if (risposta.status === 204) return null;
  const dati = await risposta.json().catch(() => null);
  if (!risposta.ok) {
    throw new Error((dati && dati.errore) || `Errore ${risposta.status}`);
  }
  return dati;
}

function mostraToast(messaggio, tipo) {
  const el = document.getElementById('toast');
  el.textContent = messaggio;
  el.className = 'toast' + (tipo === 'errore' ? ' errore' : '');
  el.classList.remove('hidden');
  clearTimeout(mostraToast._t);
  mostraToast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function apriModal(html) {
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function chiudiModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-box').innerHTML = '';
}
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') chiudiModal();
});

function formatoData(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

// ---------- Tabs ----------

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  caricaTab(btn.dataset.tab);
});

function caricaTab(nome) {
  if (nome === 'dashboard') caricaDashboard();
  if (nome === 'giri') caricaGiri();
  if (nome === 'ecostazioni') caricaEcostazioni();
  if (nome === 'impianti') caricaImpianti();
  if (nome === 'casse') caricaCasse();
  if (nome === 'mezzi') caricaMezzi();
}

// ---------- Dashboard ----------

async function caricaDashboard() {
  const d = await api('GET', '/api/dashboard');
  const cards = [
    ['Ecostazioni', d.conteggi.ecostazioni],
    ['Impianti', d.conteggi.impianti],
    ['Mezzi', d.conteggi.mezzi],
    ['Casse', d.conteggi.casse],
    ['Giri pianificati', d.conteggi.giri],
  ];
  document.getElementById('dash-cards').innerHTML = cards
    .map(([lbl, num]) => `<div class="card"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`)
    .join('');

  document.getElementById('dash-casse-stato').innerHTML = barreDa(d.casse_per_stato, 'stato');
  document.getElementById('dash-casse-lato').innerHTML = barreDa(d.casse_per_lato, 'lato_cerniera');

  document.getElementById('dash-storico').innerHTML = `
    <div class="kpi"><div class="num">${d.km_totali_storico}</div><div class="lbl">km totali percorsi</div></div>
    <div class="kpi"><div class="num">${Math.round(d.minuti_totali_storico / 60)}</div><div class="lbl">ore totali</div></div>
    <div class="kpi"><div class="num">${d.scambi_diretti_totali}</div><div class="lbl">scambi diretti effettuati</div></div>
  `;
}

function barreDa(righe, campo) {
  if (!righe.length) return '<div class="empty-state">Nessun dato</div>';
  const max = Math.max(...righe.map((r) => r.n));
  return righe
    .map(
      (r) => `<div class="bar-row">
        <div class="bar-label">${escapeHtml(r[campo])}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max) * 100}%"></div></div>
        <div class="bar-val">${r.n}</div>
      </div>`
    )
    .join('');
}

// ---------- Mezzi ----------

async function caricaMezzi() {
  const mezzi = await api('GET', '/api/mezzi');
  document.querySelector('#tabella-mezzi tbody').innerHTML = mezzi
    .map(
      (m) => `<tr>
        <td>${escapeHtml(m.nome)}</td>
        <td>${escapeHtml(m.targa) || '—'}</td>
        <td>${m.capacita_casse}</td>
        <td>${m.consumo_km_l ?? '—'}</td>
        <td>
          <button class="btn small" onclick="modificaMezzo(${m.id})">Modifica</button>
          <button class="btn small danger" onclick="eliminaMezzo(${m.id})">Elimina</button>
        </td>
      </tr>`
    )
    .join('') || '';
  if (!mezzi.length) document.querySelector('#tabella-mezzi tbody').innerHTML = '<tr><td colspan="5" class="empty-state">Nessun mezzo registrato</td></tr>';
}

function formMezzo(m) {
  m = m || {};
  return `
    <h2>${m.id ? 'Modifica mezzo' : 'Nuovo mezzo'}</h2>
    <div class="form-row"><label>Nome / identificativo *</label><input id="f-nome" value="${escapeHtml(m.nome)}" /></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Targa</label><input id="f-targa" value="${escapeHtml(m.targa)}" /></div>
      <div class="form-row"><label>Capacità (n. casse)</label><input id="f-capacita" type="number" value="${m.capacita_casse ?? ''}" /></div>
    </div>
    <div class="form-row"><label>Consumo medio (km per litro)</label><input id="f-consumo" type="number" step="0.1" value="${m.consumo_km_l ?? ''}" /></div>
    <div class="form-row"><label>Note</label><textarea id="f-note" rows="2">${escapeHtml(m.note)}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="chiudiModal()">Annulla</button>
      <button class="btn primary" onclick="salvaMezzo(${m.id || 'null'})">Salva</button>
    </div>`;
}

function nuovoMezzo() { apriModal(formMezzo()); }
async function modificaMezzo(id) {
  const m = await api('GET', `/api/mezzi/${id}`);
  apriModal(formMezzo(m));
}
async function salvaMezzo(id) {
  const corpo = {
    nome: document.getElementById('f-nome').value.trim(),
    targa: document.getElementById('f-targa').value.trim(),
    capacita_casse: Number(document.getElementById('f-capacita').value) || 0,
    consumo_km_l: document.getElementById('f-consumo').value ? Number(document.getElementById('f-consumo').value) : null,
    note: document.getElementById('f-note').value.trim(),
  };
  if (!corpo.nome) return mostraToast('Il nome è obbligatorio', 'errore');
  try {
    await api(id ? 'PUT' : 'POST', id ? `/api/mezzi/${id}` : '/api/mezzi', corpo);
    chiudiModal();
    mostraToast('Mezzo salvato');
    caricaMezzi();
  } catch (e) { mostraToast(e.message, 'errore'); }
}
async function eliminaMezzo(id) {
  if (!confirm('Eliminare questo mezzo?')) return;
  await api('DELETE', `/api/mezzi/${id}`);
  caricaMezzi();
}

document.getElementById('btn-nuovo-mezzo').addEventListener('click', nuovoMezzo);

// ---------- Ecostazioni ----------

async function caricaEcostazioni() {
  const righe = await api('GET', '/api/ecostazioni');
  document.querySelector('#tabella-ecostazioni tbody').innerHTML =
    righe
      .map(
        (e) => `<tr>
      <td>${escapeHtml(e.nome)}</td>
      <td>${escapeHtml(e.comune) || '—'}</td>
      <td><span class="badge ${e.lato_cerniera_richiesto}">${e.lato_cerniera_richiesto === 'sx' ? 'Sinistra' : 'Destra'}</span></td>
      <td>${e.giorno_scadenza ? escapeHtml(e.giorno_scadenza) + (e.ora_scadenza ? ' ' + escapeHtml(e.ora_scadenza) : '') : '—'}</td>
      <td>${escapeHtml(e.cer_code) || '—'}</td>
      <td>${e.lat != null ? `${e.lat}, ${e.lon}` : '—'}</td>
      <td>
        <button class="btn small" onclick="modificaEcostazione(${e.id})">Modifica</button>
        <button class="btn small danger" onclick="eliminaEcostazione(${e.id})">Elimina</button>
      </td>
    </tr>`
      )
      .join('') || '<tr><td colspan="7" class="empty-state">Nessuna ecostazione registrata</td></tr>';
}

function formEcostazione(e) {
  e = e || {};
  return `
    <h2>${e.id ? 'Modifica ecostazione' : 'Nuova ecostazione'}</h2>
    <div class="form-row"><label>Nome *</label><input id="f-nome" value="${escapeHtml(e.nome)}" /></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Comune</label><input id="f-comune" value="${escapeHtml(e.comune)}" /></div>
      <div class="form-row"><label>Indirizzo</label><input id="f-indirizzo" value="${escapeHtml(e.indirizzo)}" /></div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Latitudine</label><input id="f-lat" type="number" step="0.000001" value="${e.lat ?? ''}" /></div>
      <div class="form-row"><label>Longitudine</label><input id="f-lon" type="number" step="0.000001" value="${e.lon ?? ''}" /></div>
    </div>
    <div class="form-row">
      <label>Lato cerniera del coperchio richiesto dalle casse in questa ecostazione *</label>
      <select id="f-lato">
        <option value="dx" ${e.lato_cerniera_richiesto === 'dx' ? 'selected' : ''}>Destra</option>
        <option value="sx" ${e.lato_cerniera_richiesto === 'sx' ? 'selected' : ''}>Sinistra</option>
      </select>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Giorno ritiro entro</label><input id="f-giorno" placeholder="es. martedi" value="${escapeHtml(e.giorno_scadenza)}" /></div>
      <div class="form-row"><label>Ora ritiro entro</label><input id="f-ora" placeholder="es. 14:00" value="${escapeHtml(e.ora_scadenza)}" /></div>
    </div>
    <div class="form-row"><label>Codice CER prevalente (opzionale)</label><input id="f-cer" value="${escapeHtml(e.cer_code)}" /></div>
    <div class="form-row"><label>Note</label><textarea id="f-note" rows="2">${escapeHtml(e.note)}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="chiudiModal()">Annulla</button>
      <button class="btn primary" onclick="salvaEcostazione(${e.id || 'null'})">Salva</button>
    </div>`;
}

function nuovaEcostazione() { apriModal(formEcostazione()); }
async function modificaEcostazione(id) {
  const e = await api('GET', `/api/ecostazioni/${id}`);
  apriModal(formEcostazione(e));
}
async function salvaEcostazione(id) {
  const corpo = {
    nome: document.getElementById('f-nome').value.trim(),
    comune: document.getElementById('f-comune').value.trim(),
    indirizzo: document.getElementById('f-indirizzo').value.trim(),
    lat: document.getElementById('f-lat').value ? Number(document.getElementById('f-lat').value) : null,
    lon: document.getElementById('f-lon').value ? Number(document.getElementById('f-lon').value) : null,
    lato_cerniera_richiesto: document.getElementById('f-lato').value,
    giorno_scadenza: document.getElementById('f-giorno').value.trim(),
    ora_scadenza: document.getElementById('f-ora').value.trim(),
    cer_code: document.getElementById('f-cer').value.trim(),
    note: document.getElementById('f-note').value.trim(),
  };
  if (!corpo.nome) return mostraToast('Il nome è obbligatorio', 'errore');
  try {
    await api(id ? 'PUT' : 'POST', id ? `/api/ecostazioni/${id}` : '/api/ecostazioni', corpo);
    chiudiModal();
    mostraToast('Ecostazione salvata');
    caricaEcostazioni();
  } catch (e2) { mostraToast(e2.message, 'errore'); }
}
async function eliminaEcostazione(id) {
  if (!confirm('Eliminare questa ecostazione?')) return;
  await api('DELETE', `/api/ecostazioni/${id}`);
  caricaEcostazioni();
}

document.getElementById('btn-nuova-ecostazione').addEventListener('click', nuovaEcostazione);

// ---------- Impianti ----------

async function caricaImpianti() {
  const righe = await api('GET', '/api/impianti');
  document.querySelector('#tabella-impianti tbody').innerHTML =
    righe
      .map(
        (i) => `<tr>
      <td>${escapeHtml(i.nome)}</td>
      <td>${escapeHtml(i.comune) || '—'}</td>
      <td>${i.cer_accettati.map((c) => `<span class="badge dx" title="${escapeHtml(c.descrizione || '')}">${escapeHtml(c.cer_code)}${c.principale ? '' : ' (secondario)'}</span>`).join(' ') || '—'}</td>
      <td>${escapeHtml(i.referente) || '—'}</td>
      <td>${escapeHtml(i.telefono) || '—'}</td>
      <td>
        <button class="btn small" onclick="modificaImpianto(${i.id})">Modifica</button>
        <button class="btn small danger" onclick="eliminaImpianto(${i.id})">Elimina</button>
      </td>
    </tr>`
      )
      .join('') || '<tr><td colspan="6" class="empty-state">Nessun impianto registrato</td></tr>';
}

function formImpianto(i) {
  i = i || {};
  const cerTesto = (i.cer_accettati || []).map((c) => `${c.cer_code}|${c.descrizione || ''}|${c.principale ? 1 : 0}`).join('\n');
  return `
    <h2>${i.id ? 'Modifica impianto' : 'Nuovo impianto'}</h2>
    <div class="form-row"><label>Nome *</label><input id="f-nome" value="${escapeHtml(i.nome)}" /></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Comune</label><input id="f-comune" value="${escapeHtml(i.comune)}" /></div>
      <div class="form-row"><label>Indirizzo</label><input id="f-indirizzo" value="${escapeHtml(i.indirizzo)}" /></div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Latitudine</label><input id="f-lat" type="number" step="0.000001" value="${i.lat ?? ''}" /></div>
      <div class="form-row"><label>Longitudine</label><input id="f-lon" type="number" step="0.000001" value="${i.lon ?? ''}" /></div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Referente</label><input id="f-referente" value="${escapeHtml(i.referente)}" /></div>
      <div class="form-row"><label>Telefono</label><input id="f-telefono" value="${escapeHtml(i.telefono)}" /></div>
    </div>
    <div class="form-row">
      <label>CER accettati (una riga per codice: <code>codice|descrizione|principale(1/0)</code>)</label>
      <textarea id="f-cer" rows="4" placeholder="20.02.01|Verde e ramaglie|1">${escapeHtml(cerTesto)}</textarea>
    </div>
    <div class="form-row"><label>Note</label><textarea id="f-note" rows="2">${escapeHtml(i.note)}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="chiudiModal()">Annulla</button>
      <button class="btn primary" onclick="salvaImpianto(${i.id || 'null'})">Salva</button>
    </div>`;
}

function nuovoImpianto() { apriModal(formImpianto()); }
async function modificaImpianto(id) {
  const i = await api('GET', `/api/impianti/${id}`);
  apriModal(formImpianto(i));
}
async function salvaImpianto(id) {
  const cerRighe = document
    .getElementById('f-cer')
    .value.split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [cer_code, descrizione, principale] = r.split('|').map((x) => (x ?? '').trim());
      return { cer_code, descrizione, principale: principale !== '0' };
    });
  const corpo = {
    nome: document.getElementById('f-nome').value.trim(),
    comune: document.getElementById('f-comune').value.trim(),
    indirizzo: document.getElementById('f-indirizzo').value.trim(),
    lat: document.getElementById('f-lat').value ? Number(document.getElementById('f-lat').value) : null,
    lon: document.getElementById('f-lon').value ? Number(document.getElementById('f-lon').value) : null,
    referente: document.getElementById('f-referente').value.trim(),
    telefono: document.getElementById('f-telefono').value.trim(),
    note: document.getElementById('f-note').value.trim(),
    cer_accettati: cerRighe,
  };
  if (!corpo.nome) return mostraToast('Il nome è obbligatorio', 'errore');
  try {
    await api(id ? 'PUT' : 'POST', id ? `/api/impianti/${id}` : '/api/impianti', corpo);
    chiudiModal();
    mostraToast('Impianto salvato');
    caricaImpianti();
  } catch (e) { mostraToast(e.message, 'errore'); }
}
async function eliminaImpianto(id) {
  if (!confirm('Eliminare questo impianto?')) return;
  await api('DELETE', `/api/impianti/${id}`);
  caricaImpianti();
}

document.getElementById('btn-nuovo-impianto').addEventListener('click', nuovoImpianto);

// ---------- Casse ----------

async function caricaCasse() {
  const stato = document.getElementById('filtro-stato').value;
  const lato = document.getElementById('filtro-lato').value;
  const params = new URLSearchParams();
  if (stato) params.set('stato', stato);
  if (lato) params.set('lato_cerniera', lato);
  const righe = await api('GET', `/api/casse?${params.toString()}`);
  document.querySelector('#tabella-casse tbody').innerHTML =
    righe
      .map(
        (c) => `<tr>
      <td>${escapeHtml(c.codice)}</td>
      <td><span class="badge ${c.lato_cerniera}">${c.lato_cerniera === 'sx' ? 'Sinistra' : 'Destra'}</span></td>
      <td><span class="badge ${c.stato}">${c.stato.replace('_', ' ')}</span></td>
      <td>${escapeHtml(c.cer_code) || '—'}</td>
      <td>${c.posizione_tipo !== 'ignota' ? `${c.posizione_tipo} #${c.posizione_id}` : '—'}</td>
      <td>${c.aggiornato_il || '—'}</td>
      <td>
        <button class="btn small" onclick="modificaCassa(${c.id})">Modifica</button>
        <button class="btn small danger" onclick="eliminaCassa(${c.id})">Elimina</button>
      </td>
    </tr>`
      )
      .join('') || '<tr><td colspan="7" class="empty-state">Nessuna cassa registrata</td></tr>';
}
document.getElementById('filtro-stato').addEventListener('change', caricaCasse);
document.getElementById('filtro-lato').addEventListener('change', caricaCasse);

function formCassa(c) {
  c = c || {};
  return `
    <h2>${c.id ? 'Modifica cassa' : 'Nuova cassa'}</h2>
    <div class="form-row"><label>Codice identificativo *</label><input id="f-codice" value="${escapeHtml(c.codice)}" /></div>
    <div class="form-grid-2">
      <div class="form-row">
        <label>Lato cerniera del coperchio *</label>
        <select id="f-lato">
          <option value="dx" ${c.lato_cerniera === 'dx' ? 'selected' : ''}>Destra</option>
          <option value="sx" ${c.lato_cerniera === 'sx' ? 'selected' : ''}>Sinistra</option>
        </select>
      </div>
      <div class="form-row">
        <label>Stato</label>
        <select id="f-stato">
          <option value="vuota" ${c.stato === 'vuota' ? 'selected' : ''}>Vuota</option>
          <option value="piena" ${c.stato === 'piena' ? 'selected' : ''}>Piena</option>
          <option value="in_transito" ${c.stato === 'in_transito' ? 'selected' : ''}>In transito</option>
        </select>
      </div>
    </div>
    <div class="form-row"><label>Codice CER contenuto (opzionale)</label><input id="f-cer" value="${escapeHtml(c.cer_code)}" /></div>
    <div class="form-row"><label>Note</label><textarea id="f-note" rows="2">${escapeHtml(c.note)}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="chiudiModal()">Annulla</button>
      <button class="btn primary" onclick="salvaCassa(${c.id || 'null'})">Salva</button>
    </div>`;
}
function nuovaCassa() { apriModal(formCassa()); }
async function modificaCassa(id) {
  const c = await api('GET', `/api/casse/${id}`);
  apriModal(formCassa(c));
}
async function salvaCassa(id) {
  const corpo = {
    codice: document.getElementById('f-codice').value.trim(),
    lato_cerniera: document.getElementById('f-lato').value,
    stato: document.getElementById('f-stato').value,
    cer_code: document.getElementById('f-cer').value.trim(),
    note: document.getElementById('f-note').value.trim(),
  };
  if (!corpo.codice) return mostraToast('Il codice è obbligatorio', 'errore');
  try {
    await api(id ? 'PUT' : 'POST', id ? `/api/casse/${id}` : '/api/casse', corpo);
    chiudiModal();
    mostraToast('Cassa salvata');
    caricaCasse();
  } catch (e) { mostraToast(e.message, 'errore'); }
}
async function eliminaCassa(id) {
  if (!confirm('Eliminare questa cassa?')) return;
  await api('DELETE', `/api/casse/${id}`);
  caricaCasse();
}

document.getElementById('btn-nuova-cassa').addEventListener('click', nuovaCassa);

// ---------- Import CSV ----------

function collegaImport(bottoneId, fileInputId, endpoint, ricarica) {
  const bottone = document.getElementById(bottoneId);
  const fileInput = document.getElementById(fileInputId);
  bottone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const testo = await file.text();
    const righe = csvAOggetti(testo);
    try {
      const risultato = await api('POST', endpoint, { righe });
      mostraToast(`Importate ${risultato.importate} righe${risultato.errori.length ? `, ${risultato.errori.length} errori` : ''}`);
      if (risultato.errori.length) console.warn('Errori import:', risultato.errori);
      ricarica();
    } catch (e) {
      mostraToast(e.message, 'errore');
    }
    fileInput.value = '';
  });
}
collegaImport('btn-import-ecostazioni', 'file-import-ecostazioni', '/api/import/ecostazioni', caricaEcostazioni);
collegaImport('btn-import-impianti', 'file-import-impianti', '/api/import/impianti', caricaImpianti);
collegaImport('btn-import-casse', 'file-import-casse', '/api/import/casse', caricaCasse);
collegaImport('btn-import-mezzi', 'file-import-mezzi', '/api/import/mezzi', caricaMezzi);

// ---------- Giri ----------

let giroCorrenteId = null;

async function caricaGiri() {
  mostraListaGiri();
  const giri = await api('GET', '/api/giri');
  document.querySelector('#tabella-giri tbody').innerHTML =
    giri
      .map(
        (g) => `<tr style="cursor:pointer" onclick="apriGiro(${g.id})">
      <td>${formatoData(g.data)}</td>
      <td>${escapeHtml(g.mezzo_nome) || '—'}</td>
      <td>${escapeHtml(g.autista) || '—'}</td>
      <td><span class="badge ${g.stato}">${g.stato.replace('_', ' ')}</span></td>
      <td>${g.numero_tappe}</td>
      <td><button class="btn small danger" onclick="event.stopPropagation(); eliminaGiro(${g.id})">Elimina</button></td>
    </tr>`
      )
      .join('') || '<tr><td colspan="6" class="empty-state">Nessun giro pianificato</td></tr>';
}

function mostraListaGiri() {
  giroCorrenteId = null;
  document.getElementById('giri-lista-view').classList.remove('hidden');
  document.getElementById('giro-dettaglio-view').classList.add('hidden');
}

async function formNuovoGiro() {
  const mezzi = await api('GET', '/api/mezzi');
  apriModal(`
    <h2>Nuovo giro</h2>
    <div class="form-row"><label>Data *</label><input id="f-data" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
    <div class="form-row"><label>Mezzo</label>
      <select id="f-mezzo"><option value="">— seleziona —</option>${mezzi.map((m) => `<option value="${m.id}">${escapeHtml(m.nome)}</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>Autista</label><input id="f-autista" /></div>
    <div class="modal-actions">
      <button class="btn" onclick="chiudiModal()">Annulla</button>
      <button class="btn primary" onclick="salvaNuovoGiro()">Crea giro</button>
    </div>
  `);
}
async function salvaNuovoGiro() {
  const corpo = {
    data: document.getElementById('f-data').value,
    mezzo_id: document.getElementById('f-mezzo').value || null,
    autista: document.getElementById('f-autista').value.trim(),
  };
  if (!corpo.data) return mostraToast('La data è obbligatoria', 'errore');
  try {
    const giro = await api('POST', '/api/giri', corpo);
    chiudiModal();
    apriGiro(giro.id);
  } catch (e) { mostraToast(e.message, 'errore'); }
}
async function eliminaGiro(id) {
  if (!confirm('Eliminare questo giro e tutte le sue tappe?')) return;
  await api('DELETE', `/api/giri/${id}`);
  caricaGiri();
}

document.getElementById('btn-nuovo-giro').addEventListener('click', formNuovoGiro);
document.getElementById('btn-torna-giri').addEventListener('click', caricaGiri);

async function apriGiro(id) {
  giroCorrenteId = id;
  document.getElementById('giri-lista-view').classList.add('hidden');
  document.getElementById('giro-dettaglio-view').classList.remove('hidden');
  await renderGiro();
}

async function renderGiro() {
  const giro = await api('GET', `/api/giri/${giroCorrenteId}`);
  document.getElementById('giro-titolo').textContent = `Giro del ${formatoData(giro.data)}`;

  document.getElementById('giro-info-panel').innerHTML = `
    <h2>Dettagli giro</h2>
    <div class="form-row"><label>Stato</label>
      <select onchange="cambiaStatoGiro(this.value)">
        <option value="pianificato" ${giro.stato === 'pianificato' ? 'selected' : ''}>Pianificato</option>
        <option value="in_corso" ${giro.stato === 'in_corso' ? 'selected' : ''}>In corso</option>
        <option value="concluso" ${giro.stato === 'concluso' ? 'selected' : ''}>Concluso</option>
      </select>
    </div>
    <div class="tappa-meta">Autista: ${escapeHtml(giro.autista) || '—'}</div>
  `;

  const riepilogo = await api('GET', `/api/giri/${giroCorrenteId}/riepilogo`);
  document.getElementById('giro-riepilogo').innerHTML = `
    <div class="kpi"><div class="num">${riepilogo.km_totali}</div><div class="lbl">km totali</div></div>
    <div class="kpi"><div class="num">${Math.round(riepilogo.minuti_totali)}</div><div class="lbl">minuti stimati</div></div>
    <div class="kpi"><div class="num">${riepilogo.litri_stimati ?? '—'}</div><div class="lbl">litri stimati</div></div>
    <div class="kpi"><div class="num">${riepilogo.casse_vuote_scambiate_direttamente}</div><div class="lbl">scambi diretti</div></div>
  `;

  document.getElementById('lista-tappe').innerHTML =
    giro.tappe
      .map((t, idx) => {
        const luogo = t.luogo ? `${escapeHtml(t.luogo.nome)}${t.luogo.comune ? ' (' + escapeHtml(t.luogo.comune) + ')' : ''}` : 'Luogo non impostato';
        const latoInfo = t.tipo === 'ritiro' && t.luogo && t.luogo.lato_cerniera_richiesto
          ? ` · lato richiesto <span class="badge ${t.luogo.lato_cerniera_richiesto}">${t.luogo.lato_cerniera_richiesto}</span>`
          : '';
        const distanza = t.km_dalla_precedente != null ? ` · ${t.km_dalla_precedente} km / ${Math.round(t.minuti_dalla_precedente)} min dalla tappa precedente` : '';
        return `<div class="tappa-card">
          <div class="tappa-head">
            <div>
              <span class="tappa-tipo ${t.tipo}">${t.tipo}</span>
              <span class="tappa-titolo">${luogo}</span>
              ${latoInfo}
            </div>
            <div class="tappa-order-btns">
              <button class="btn small" ${idx === 0 ? 'disabled' : ''} onclick="spostaTappa(${t.id}, -1)">↑</button>
              <button class="btn small" ${idx === giro.tappe.length - 1 ? 'disabled' : ''} onclick="spostaTappa(${t.id}, 1)">↓</button>
              <button class="btn small" onclick="apriGestioneCasse(${t.id}, '${t.tipo}')">Casse</button>
              <button class="btn small danger" onclick="eliminaTappa(${t.id})">✕</button>
            </div>
          </div>
          <div class="tappa-meta">${distanza || 'Distanza non calcolabile (coordinate mancanti)'}</div>
          <div class="tappa-casse">
            ${t.casse.map((c) => `<span class="cassa-chip">${escapeHtml(c.codice)} <span class="badge ${c.lato_cerniera}">${c.lato_cerniera}</span> · ${c.azione.replace('_', ' ')}</span>`).join('') || '<span class="tappa-meta">Nessun movimento cassa registrato</span>'}
          </div>
        </div>`;
      })
      .join('') || '<div class="empty-state">Nessuna tappa. Aggiungi la prima tappa del giro.</div>';

  const suggerimenti = await api('GET', `/api/giri/${giroCorrenteId}/suggerimenti`);
  document.getElementById('suggerimenti-lista').innerHTML =
    suggerimenti
      .map(
        (s) => `<div class="suggerimento-card ${s.avviso ? 'avviso' : ''}">
      <strong>${escapeHtml(s.ecostazione)}</strong> richiede lato <span class="badge ${s.lato_richiesto}">${s.lato_richiesto}</span> —
      ${s.scambio_diretto_possibile
        ? `${s.casse_compatibili.length} cassa/e vuota/e compatibile/i disponibile/i all'impianto della tappa precedente: ${s.casse_compatibili.map((c) => escapeHtml(c.codice)).join(', ')}. Puoi caricarle lì e scambiarle direttamente qui.`
        : s.avviso}
    </div>`
      )
      .join('') || '<div class="empty-state">Nessun suggerimento: aggiungi tappe di scarico prima delle tappe di ritiro per vedere le proposte di scambio.</div>';
}

async function cambiaStatoGiro(stato) {
  await api('PUT', `/api/giri/${giroCorrenteId}`, { stato });
  mostraToast('Stato aggiornato');
}

document.getElementById('btn-ottimizza').addEventListener('click', async () => {
  try {
    const risultato = await api('POST', `/api/giri/${giroCorrenteId}/ottimizza`, {});
    if (risultato.nota) mostraToast(risultato.nota);
    else mostraToast('Ordine ottimizzato');
    renderGiro();
  } catch (e) { mostraToast(e.message, 'errore'); }
});

async function spostaTappa(tappaId, direzione) {
  const giro = await api('GET', `/api/giri/${giroCorrenteId}`);
  const ids = giro.tappe.map((t) => t.id);
  const i = ids.indexOf(tappaId);
  const j = i + direzione;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await api('POST', `/api/giri/${giroCorrenteId}/tappe/riordina`, { ordine: ids });
  renderGiro();
}

async function eliminaTappa(tappaId) {
  if (!confirm('Rimuovere questa tappa?')) return;
  await api('DELETE', `/api/giri/${giroCorrenteId}/tappe/${tappaId}`);
  renderGiro();
}

async function formAggiungiTappa() {
  const [ecostazioni, impianti] = await Promise.all([api('GET', '/api/ecostazioni'), api('GET', '/api/impianti')]);
  apriModal(`
    <h2>Aggiungi tappa</h2>
    <div class="form-row"><label>Tipo</label>
      <select id="f-tipo" onchange="document.getElementById('f-eco-wrap').classList.toggle('hidden', this.value!=='ritiro'); document.getElementById('f-imp-wrap').classList.toggle('hidden', this.value!=='scarico');">
        <option value="ritiro">Ritiro presso ecostazione</option>
        <option value="scarico">Scarico presso impianto</option>
      </select>
    </div>
    <div class="form-row" id="f-eco-wrap"><label>Ecostazione</label>
      <select id="f-eco">${ecostazioni.map((e) => `<option value="${e.id}">${escapeHtml(e.nome)} (${e.comune || ''}) — lato ${e.lato_cerniera_richiesto}</option>`).join('')}</select>
    </div>
    <div class="form-row hidden" id="f-imp-wrap"><label>Impianto</label>
      <select id="f-imp">${impianti.map((i) => `<option value="${i.id}">${escapeHtml(i.nome)} (${i.comune || ''})</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>Note</label><textarea id="f-note" rows="2"></textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="chiudiModal()">Annulla</button>
      <button class="btn primary" onclick="salvaNuovaTappa()">Aggiungi</button>
    </div>
  `);
}
async function salvaNuovaTappa() {
  const tipo = document.getElementById('f-tipo').value;
  const corpo = {
    tipo,
    ecostazione_id: tipo === 'ritiro' ? Number(document.getElementById('f-eco').value) : null,
    impianto_id: tipo === 'scarico' ? Number(document.getElementById('f-imp').value) : null,
    note: document.getElementById('f-note').value.trim(),
  };
  try {
    await api('POST', `/api/giri/${giroCorrenteId}/tappe`, corpo);
    chiudiModal();
    renderGiro();
  } catch (e) { mostraToast(e.message, 'errore'); }
}
document.getElementById('btn-aggiungi-tappa').addEventListener('click', formAggiungiTappa);

async function apriGestioneCasse(tappaId, tipoTappa) {
  const giro = await api('GET', `/api/giri/${giroCorrenteId}`);
  const tappa = giro.tappe.find((t) => t.id === tappaId);
  let casseCandidate = [];
  let azioniPossibili = [];
  if (tipoTappa === 'ritiro') {
    casseCandidate = await api('GET', `/api/casse?stato=piena&posizione_tipo=ecostazione&posizione_id=${tappa.ecostazione_id}`);
    const vuoteQui = await api('GET', `/api/casse?stato=vuota&posizione_tipo=mezzo`);
    azioniPossibili = [
      { valore: 'carica_piena', etichetta: 'Carica cassa piena trovata qui', casse: casseCandidate },
      { valore: 'scarica_vuota', etichetta: 'Scarica cassa vuota dal mezzo (sostituzione)', casse: vuoteQui },
    ];
  } else {
    const pieneSulMezzo = await api('GET', `/api/casse?stato=piena&posizione_tipo=mezzo`);
    const vuoteAllImpianto = await api('GET', `/api/casse?stato=vuota&posizione_tipo=impianto&posizione_id=${tappa.impianto_id}`);
    azioniPossibili = [
      { valore: 'scarica_piena', etichetta: 'Scarica cassa piena qui', casse: pieneSulMezzo },
      { valore: 'carica_vuota', etichetta: 'Carica cassa vuota da qui (per la prossima ecostazione)', casse: vuoteAllImpianto },
    ];
  }

  apriModal(`
    <h2>Movimento casse</h2>
    <div class="form-row"><label>Azione</label>
      <select id="f-azione" onchange="aggiornaListaCasseModal()">
        ${azioniPossibili.map((a) => `<option value="${a.valore}">${a.etichetta}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label>Cassa</label><select id="f-cassa"></select></div>
    <div class="modal-actions">
      <button class="btn" onclick="chiudiModal()">Annulla</button>
      <button class="btn primary" onclick="salvaMovimentoCassa(${tappaId})">Registra</button>
    </div>
  `);
  window._azioniPossibiliModal = azioniPossibili;
  aggiornaListaCasseModal();
}
function aggiornaListaCasseModal() {
  const azione = document.getElementById('f-azione').value;
  const trovato = window._azioniPossibiliModal.find((a) => a.valore === azione);
  const select = document.getElementById('f-cassa');
  select.innerHTML = trovato.casse.length
    ? trovato.casse.map((c) => `<option value="${c.id}">${escapeHtml(c.codice)} — lato ${c.lato_cerniera}</option>`).join('')
    : '<option value="">Nessuna cassa disponibile</option>';
}
async function salvaMovimentoCassa(tappaId) {
  const azione = document.getElementById('f-azione').value;
  const cassaId = document.getElementById('f-cassa').value;
  if (!cassaId) return mostraToast('Nessuna cassa disponibile per questa azione', 'errore');
  try {
    await api('POST', `/api/giri/${giroCorrenteId}/tappe/${tappaId}/casse`, { cassa_id: Number(cassaId), azione });
    chiudiModal();
    mostraToast('Movimento registrato');
    renderGiro();
  } catch (e) { mostraToast(e.message, 'errore'); }
}

// ---------- Avvio ----------

caricaDashboard();
