/* Physician Dashboard — single-file Express server.
 * npm install && npm start, then open the printed URL on any device on your WiFi. */
const express = require('express');
const path = require('path');
const os = require('os');

const { initDb } = require('./src/db/database');
const emailsRouter = require('./src/routes/emails');
const calendarRouter = require('./src/routes/calendar');
const financeRouter = require('./src/routes/finance');
const availabilityRouter = require('./src/routes/availability');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

initDb();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/emails', emailsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/finance', financeRouter);
app.use('/api/availability', availabilityRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'physician-dashboard' }));

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Basic error handler so a bad request never crashes the server
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

function localIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

app.listen(PORT, HOST, () => {
  const ips = localIPs();
  console.log('');
  console.log('  ─────────────────────────────────────────────');
  console.log('   Physician Dashboard is running');
  console.log('');
  console.log(`   On this Mac:   http://localhost:${PORT}`);
  ips.forEach((ip) => {
    console.log(`   On your phone: http://${ip}:${PORT}   (same WiFi)`);
  });
  if (ips.length === 0) {
    console.log('   (No WiFi/LAN address detected — connect to a network');
    console.log('    and restart to get a phone-accessible URL.)');
  }
  console.log('  ─────────────────────────────────────────────');
  console.log('');
});
