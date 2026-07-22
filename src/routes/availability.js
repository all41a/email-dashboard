const express = require('express');
const { db } = require('../db/database');
const router = express.Router();

// GET /api/availability — weekly grid
router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM availability ORDER BY day_of_week, slot').all());
});

// PUT /api/availability — { day_of_week, slot, status } cycles/set one cell
router.put('/', (req, res) => {
  const { day_of_week, slot, status } = req.body;
  const validSlots = ['morning', 'afternoon', 'evening', 'overnight'];
  const validStatus = ['available', 'preferred', 'unavailable'];
  if (![0, 1, 2, 3, 4, 5, 6].includes(day_of_week) || !validSlots.includes(slot) || !validStatus.includes(status)) {
    return res.status(400).json({ error: 'Invalid day_of_week, slot, or status' });
  }
  db.prepare(`INSERT INTO availability (day_of_week, slot, status) VALUES (?, ?, ?)
    ON CONFLICT(day_of_week, slot) DO UPDATE SET status = excluded.status`).run(day_of_week, slot, status);
  res.json({ ok: true, day_of_week, slot, status });
});

// GET /api/availability/shifts — offered/booked shifts
router.get('/shifts', (_req, res) => {
  res.json(db.prepare('SELECT * FROM shifts ORDER BY date ASC').all());
});

// POST /api/availability/shifts/:id/status — { status: 'requested' | 'confirmed' | 'declined' | 'open' }
router.post('/shifts/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['open', 'requested', 'confirmed', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const info = db.prepare('UPDATE shifts SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Shift not found' });
  res.json(db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id));
});

module.exports = router;
