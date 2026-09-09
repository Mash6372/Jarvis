const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'logistica.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS mezzi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  targa TEXT,
  capacita_casse INTEGER NOT NULL DEFAULT 0,
  consumo_km_l REAL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS ecostazioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  comune TEXT,
  indirizzo TEXT,
  lat REAL,
  lon REAL,
  lato_cerniera_richiesto TEXT NOT NULL DEFAULT 'dx' CHECK (lato_cerniera_richiesto IN ('sx','dx')),
  cer_code TEXT,
  giorno_scadenza TEXT,
  ora_scadenza TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS impianti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  comune TEXT,
  indirizzo TEXT,
  lat REAL,
  lon REAL,
  referente TEXT,
  telefono TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS impianti_cer (
  impianto_id INTEGER NOT NULL REFERENCES impianti(id) ON DELETE CASCADE,
  cer_code TEXT NOT NULL,
  descrizione TEXT,
  principale INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (impianto_id, cer_code)
);

CREATE TABLE IF NOT EXISTS casse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice TEXT UNIQUE NOT NULL,
  lato_cerniera TEXT NOT NULL CHECK (lato_cerniera IN ('sx','dx')),
  stato TEXT NOT NULL DEFAULT 'vuota' CHECK (stato IN ('vuota','piena','in_transito')),
  cer_code TEXT,
  posizione_tipo TEXT DEFAULT 'ignota' CHECK (posizione_tipo IN ('ecostazione','impianto','mezzo','ignota')),
  posizione_id INTEGER,
  note TEXT,
  aggiornato_il TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS giri (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  mezzo_id INTEGER REFERENCES mezzi(id),
  autista TEXT,
  stato TEXT NOT NULL DEFAULT 'pianificato' CHECK (stato IN ('pianificato','in_corso','concluso')),
  note TEXT,
  creato_il TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tappe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giro_id INTEGER NOT NULL REFERENCES giri(id) ON DELETE CASCADE,
  ordine INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ritiro','scarico')),
  ecostazione_id INTEGER REFERENCES ecostazioni(id),
  impianto_id INTEGER REFERENCES impianti(id),
  km_dalla_precedente REAL,
  minuti_dalla_precedente REAL,
  minuti_sosta REAL DEFAULT 15,
  note TEXT
);

CREATE TABLE IF NOT EXISTS tappe_casse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tappa_id INTEGER NOT NULL REFERENCES tappe(id) ON DELETE CASCADE,
  cassa_id INTEGER NOT NULL REFERENCES casse(id),
  azione TEXT NOT NULL CHECK (azione IN ('carica_piena','scarica_piena','carica_vuota','scarica_vuota'))
);

CREATE INDEX IF NOT EXISTS idx_tappe_giro ON tappe(giro_id);
CREATE INDEX IF NOT EXISTS idx_tappe_casse_tappa ON tappe_casse(tappa_id);
CREATE INDEX IF NOT EXISTS idx_casse_posizione ON casse(posizione_tipo, posizione_id);
`);

// node:sqlite non offre ancora un helper .transaction() come better-sqlite3: lo aggiungiamo qui
// per poter scrivere `db.transaction(fn)()` nello stesso stile nel resto del codice.
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try {
    const risultato = fn(...args);
    db.exec('COMMIT');
    return risultato;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

module.exports = db;
