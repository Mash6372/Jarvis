const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    'Manca la variabile d\'ambiente DATABASE_URL (stringa di connessione al database Postgres). ' +
      'Vedi il README per come ottenerne una gratuita (es. Neon) e impostarla.'
  );
  process.exit(1);
}

// I provider di Postgres gratuiti (Neon, Supabase, Render...) richiedono SSL ma spesso con un
// certificato non verificabile dalla CA di sistema: disabilitiamo la verifica del certificato,
// la connessione resta comunque cifrata.
const sslNecessario = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslNecessario ? { rejectUnauthorized: false } : false,
});

function convertiPlaceholder(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Espone la stessa API "db.prepare(sql).get/all/run(...params)" usata in tutto il progetto,
// ma basata su query asincrone verso Postgres invece che su node:sqlite sincrono.
function creaInterfaccia(queryable) {
  return {
    async exec(sql) {
      await queryable.query(sql);
    },
    prepare(sql) {
      return {
        async get(...params) {
          const res = await queryable.query(convertiPlaceholder(sql), params);
          return res.rows[0];
        },
        async all(...params) {
          const res = await queryable.query(convertiPlaceholder(sql), params);
          return res.rows;
        },
        async run(...params) {
          const isInsert = /^\s*insert/i.test(sql);
          // impianti_cer non ha una colonna "id" (chiave primaria composita): niente RETURNING.
          const haColonnaId = !/into\s+impianti_cer\b/i.test(sql);
          const sqlFinale = isInsert && haColonnaId && !/returning/i.test(sql) ? `${sql} RETURNING id` : sql;
          const res = await queryable.query(convertiPlaceholder(sqlFinale), params);
          return {
            lastInsertRowid: res.rows[0] ? res.rows[0].id : undefined,
            changes: res.rowCount,
          };
        },
      };
    },
  };
}

const db = creaInterfaccia(pool);

// db.transaction(async (scopedDb, ...args) => { ... })(...args)
// scopedDb usa un client dedicato (stessa connessione per BEGIN/COMMIT/ROLLBACK).
db.transaction = (fn) => async (...args) => {
  const client = await pool.connect();
  const scopedDb = creaInterfaccia(client);
  try {
    await client.query('BEGIN');
    const risultato = await fn(scopedDb, ...args);
    await client.query('COMMIT');
    return risultato;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mezzi (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  targa TEXT,
  capacita_casse INTEGER NOT NULL DEFAULT 0,
  consumo_km_l DOUBLE PRECISION,
  note TEXT
);

CREATE TABLE IF NOT EXISTS ecostazioni (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  comune TEXT,
  indirizzo TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  lato_cerniera_richiesto TEXT NOT NULL DEFAULT 'dx' CHECK (lato_cerniera_richiesto IN ('sx','dx')),
  cer_code TEXT,
  giorno_scadenza TEXT,
  ora_scadenza TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS impianti (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  comune TEXT,
  indirizzo TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
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
  id SERIAL PRIMARY KEY,
  codice TEXT UNIQUE NOT NULL,
  lato_cerniera TEXT NOT NULL CHECK (lato_cerniera IN ('sx','dx')),
  stato TEXT NOT NULL DEFAULT 'vuota' CHECK (stato IN ('vuota','piena','in_transito')),
  cer_code TEXT,
  posizione_tipo TEXT DEFAULT 'ignota' CHECK (posizione_tipo IN ('ecostazione','impianto','mezzo','ignota')),
  posizione_id INTEGER,
  note TEXT,
  aggiornato_il TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS giri (
  id SERIAL PRIMARY KEY,
  data TEXT NOT NULL,
  mezzo_id INTEGER REFERENCES mezzi(id),
  autista TEXT,
  stato TEXT NOT NULL DEFAULT 'pianificato' CHECK (stato IN ('pianificato','in_corso','concluso')),
  note TEXT,
  creato_il TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS tappe (
  id SERIAL PRIMARY KEY,
  giro_id INTEGER NOT NULL REFERENCES giri(id) ON DELETE CASCADE,
  ordine INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ritiro','scarico')),
  ecostazione_id INTEGER REFERENCES ecostazioni(id),
  impianto_id INTEGER REFERENCES impianti(id),
  km_dalla_precedente DOUBLE PRECISION,
  minuti_dalla_precedente DOUBLE PRECISION,
  minuti_sosta DOUBLE PRECISION DEFAULT 15,
  note TEXT
);

CREATE TABLE IF NOT EXISTS tappe_casse (
  id SERIAL PRIMARY KEY,
  tappa_id INTEGER NOT NULL REFERENCES tappe(id) ON DELETE CASCADE,
  cassa_id INTEGER NOT NULL REFERENCES casse(id),
  azione TEXT NOT NULL CHECK (azione IN ('carica_piena','scarica_piena','carica_vuota','scarica_vuota'))
);

CREATE INDEX IF NOT EXISTS idx_tappe_giro ON tappe(giro_id);
CREATE INDEX IF NOT EXISTS idx_tappe_casse_tappa ON tappe_casse(tappa_id);
CREATE INDEX IF NOT EXISTS idx_casse_posizione ON casse(posizione_tipo, posizione_id);
`;

db.ready = pool.query(SCHEMA).catch((err) => {
  console.error('Errore creando lo schema del database:', err.message);
  process.exit(1);
});

module.exports = db;
