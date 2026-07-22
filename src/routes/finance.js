const express = require('express');
const { db } = require('../db/database');
const router = express.Router();

// GET /api/finance/overview — accounts, net worth, month income/spend, category breakdown
router.get('/overview', (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts').all();
  const netWorth = accounts.reduce((s, a) => s + a.balance, 0);

  const monthStart = new Date();
  monthStart.setDate(1);
  const ms = monthStart.toISOString().slice(0, 10);

  const income = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE amount > 0 AND category != 'transfer' AND date >= ?"
  ).get(ms).v;
  const spending = db.prepare(
    "SELECT COALESCE(SUM(ABS(amount)),0) AS v FROM transactions WHERE amount < 0 AND category NOT IN ('transfer','investment') AND date >= ?"
  ).get(ms).v;
  const byCategory = db.prepare(
    "SELECT category, SUM(ABS(amount)) AS total FROM transactions WHERE amount < 0 AND category NOT IN ('transfer','investment') AND date >= ? GROUP BY category ORDER BY total DESC"
  ).all(ms);

  res.json({
    accounts,
    netWorth,
    month: { income, spending, byCategory },
    plaid: { connected: false, note: 'Demo data. Swap in Plaid Link + /transactions/sync here for live accounts.' },
  });
});

// GET /api/finance/transactions
router.get('/transactions', (_req, res) => {
  const rows = db.prepare(`
    SELECT t.*, a.name AS account_name, a.institution
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    ORDER BY t.date DESC, t.id DESC`).all();
  res.json(rows);
});

module.exports = router;
