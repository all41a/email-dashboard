const express = require('express');
const { db } = require('../db/database');
const router = express.Router();

// GET /api/calendar/events — upcoming events, oldest first
router.get('/events', (_req, res) => {
  const rows = db.prepare('SELECT * FROM calendar_events ORDER BY start_time ASC').all();
  res.json(rows);
});

// POST /api/calendar/events
router.post('/events', (req, res) => {
  const { title, description = '', location = '', start_time, end_time, category = 'clinical' } = req.body;
  if (!title || !start_time || !end_time) {
    return res.status(400).json({ error: 'title, start_time, and end_time are required' });
  }
  const info = db.prepare(`INSERT INTO calendar_events (title, description, location, start_time, end_time, source, category)
    VALUES (?, ?, ?, ?, ?, 'local', ?)`).run(title, description, location, start_time, end_time, category);
  res.status(201).json(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(info.lastInsertRowid));
});

// DELETE /api/calendar/events/:id
router.delete('/events/:id', (req, res) => {
  const info = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Event not found' });
  res.json({ ok: true });
});

// Calendar sources (multi-platform sync — Google/Apple/Outlook, demo connections)
router.get('/sources', (_req, res) => {
  res.json(db.prepare('SELECT * FROM calendar_sources').all());
});

// POST /api/calendar/sources/:id/toggle — connect/disconnect (real OAuth would plug in here)
router.post('/sources/:id/toggle', (req, res) => {
  const src = db.prepare('SELECT * FROM calendar_sources WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Source not found' });
  db.prepare('UPDATE calendar_sources SET connected = ? WHERE id = ?').run(src.connected ? 0 : 1, src.id);
  res.json(db.prepare('SELECT * FROM calendar_sources WHERE id = ?').get(src.id));
});

module.exports = router;
