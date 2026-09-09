const express = require('express');
const path = require('node:path');
const db = require('./src/db');
const { seedSeVuoto } = require('./src/seed');

seedSeVuoto(db);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/mezzi', require('./src/routes/mezzi'));
app.use('/api/ecostazioni', require('./src/routes/ecostazioni'));
app.use('/api/impianti', require('./src/routes/impianti'));
app.use('/api/casse', require('./src/routes/casse'));
app.use('/api/import', require('./src/routes/import'));
app.use('/api/giri', require('./src/routes/giri'));
app.use('/api/dashboard', require('./src/routes/dashboard'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server', dettaglio: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Logistica app in ascolto su http://localhost:${PORT}`);
});
