// Parser CSV minimale (gestisce virgolette e virgole nei campi quotati).
function parseCSV(testo) {
  const righe = [];
  let campo = '';
  let riga = [];
  let dentroVirgolette = false;
  const testoNorm = testo.replace(/\r\n/g, '\n');

  for (let i = 0; i < testoNorm.length; i++) {
    const c = testoNorm[i];
    if (dentroVirgolette) {
      if (c === '"') {
        if (testoNorm[i + 1] === '"') { campo += '"'; i++; }
        else dentroVirgolette = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroVirgolette = true;
    } else if (c === ',') {
      riga.push(campo);
      campo = '';
    } else if (c === '\n') {
      riga.push(campo);
      righe.push(riga);
      riga = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo.length || riga.length) {
    riga.push(campo);
    righe.push(riga);
  }
  return righe.filter((r) => r.some((v) => v !== ''));
}

// Converte il testo CSV (con intestazione) in un array di oggetti { colonna: valore }
function csvAOggetti(testo) {
  const righe = parseCSV(testo);
  if (righe.length === 0) return [];
  const intestazione = righe[0].map((h) => h.trim());
  return righe.slice(1).map((riga) => {
    const obj = {};
    intestazione.forEach((chiave, i) => { obj[chiave] = (riga[i] ?? '').trim(); });
    return obj;
  });
}
