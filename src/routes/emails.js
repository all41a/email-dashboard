const express = require('express');
const { db } = require('../db/database');
const router = express.Router();

// GET /api/emails?category=clinical&archived=0
router.get('/', (req, res) => {
  const { category } = req.query;
  const archived = req.query.archived === '1' ? 1 : 0;
  let rows;
  if (category && category !== 'all') {
    rows = db.prepare('SELECT * FROM emails WHERE is_archived = ? AND category = ? ORDER BY received_at DESC').all(archived, category);
  } else {
    rows = db.prepare('SELECT * FROM emails WHERE is_archived = ? ORDER BY received_at DESC').all(archived);
  }
  res.json(rows);
});

// GET /api/emails/summary — counts per category for the triage chips
router.get('/summary', (_req, res) => {
  const rows = db.prepare(`
    SELECT category, COUNT(*) AS total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
    FROM emails WHERE is_archived = 0 GROUP BY category`).all();
  const unreadTotal = db.prepare('SELECT COUNT(*) AS c FROM emails WHERE is_read = 0 AND is_archived = 0').get().c;
  res.json({ categories: rows, unreadTotal });
});

// PATCH /api/emails/:id — { is_read?, is_archived?, category?, priority? }
router.patch('/:id', (req, res) => {
  const allowed = ['is_read', 'is_archived', 'category', 'priority'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(req.body[key]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  const info = db.prepare(`UPDATE emails SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  if (!info.changes) return res.status(404).json({ error: 'Email not found' });
  res.json(db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id));
});

module.exports = router;
