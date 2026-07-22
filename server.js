const express = require('express');
const path = require('node:path');
const { db, uid, seedIfEmpty, detectActionRequired, detectCategory, refreshCategoryCounts,
  ensureFoldersAndAmazon, routeAmazonEmail, FOLDER_IDS } = require('./db');
const { runSweep, startSweeper, DEMO_MODE } = require('./lib/sweeper');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

seedIfEmpty();
ensureFoldersAndAmazon();

const parseEmail = (row) => row && ({
  ...row,
  attachment_types: JSON.parse(row.attachment_types || '[]'),
  attachments: JSON.parse(row.attachments || '[]'),
  important_types: JSON.parse(row.important_types || '[]'),
  is_vip: undefined, // set by callers
});

function vipSet() {
  return new Set(db.prepare('SELECT sender_email FROM vip_list').all().map(r => r.sender_email));
}

function decorate(rows) {
  const vips = vipSet();
  return rows.map(r => ({ ...parseEmail(r), is_vip: vips.has(r.from_email) ? 1 : 0 }));
}

// -------------------------------------------------------------- filtering
// Builds WHERE clause from query params. Supports logic=AND|OR across the
// user-chosen filters; structural conditions (deleted, view) always apply.
function buildEmailQuery(q) {
  const structural = ['e.is_deleted = 0'];
  const params = [];
  const chosen = [];
  const cp = []; // chosen params

  const view = q.view || 'inbox';
  if (view === 'spam') structural.push('e.is_spam = 1');
  else if (view === 'archived') structural.push('e.is_archived = 1', 'e.is_spam = 0');
  else if (view === 'all') { /* everything not deleted */ }
  else structural.push('e.is_spam = 0', 'e.is_archived = 0'); // inbox default

  if (q.view === 'action') structural.push('e.action_required = 1');
  if (q.view === 'vip') structural.push('e.from_email IN (SELECT sender_email FROM vip_list)');
  if (q.view === 'starred') structural.push('e.is_starred = 1');
  if (q.view === 'important') structural.push('(e.important = 1 OR e.from_email IN (SELECT sender_email FROM vip_list))');
  if (q.folder_id) { structural.push('e.id IN (SELECT email_id FROM email_folders WHERE folder_id = ?)'); params.push(q.folder_id); }

  const add = (sql, ...vals) => { chosen.push(sql); cp.push(...vals); };

  if (q.account_id) add('e.account_id = ?', q.account_id);
  if (q.category) add('e.category = ?', q.category);
  if (q.sender) add('(e.from_email LIKE ? OR e.from_name LIKE ?)', `%${q.sender}%`, `%${q.sender}%`);
  if (q.is_read === 'true') add('e.is_read = 1');
  if (q.is_read === 'false') add('e.is_read = 0');
  if (q.is_starred === 'true') add('e.is_starred = 1');
  if (q.is_vip === 'true') add('e.from_email IN (SELECT sender_email FROM vip_list)');
  if (q.action_required === 'true') add('e.action_required = 1');
  if (q.priority) add('e.priority = ?', q.priority);
  if (q.has_attachment === 'true') add('e.has_attachment = 1');
  if (q.attachment_type) add("e.attachment_types LIKE ?", `%"${q.attachment_type}"%`);
  if (q.is_spam === 'true') add('e.is_spam = 1');
  if (q.date_from) add('e.date >= ?', new Date(q.date_from).toISOString());
  if (q.date_to) add('e.date <= ?', new Date(new Date(q.date_to).getTime() + 86399e3).toISOString());
  if (q.q) {
    add('(e.subject LIKE ? OR e.from_email LIKE ? OR e.from_name LIKE ? OR e.body_full LIKE ?)',
      `%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
  }

  const logic = (q.logic || 'AND').toUpperCase() === 'OR' ? ' OR ' : ' AND ';
  let where = structural.join(' AND ');
  if (chosen.length) where += ` AND (${chosen.join(logic)})`;
  params.push(...cp);

  const sortMap = {
    date: 'e.date', sender: 'LOWER(COALESCE(e.from_name, e.from_email))',
    subject: 'LOWER(e.subject)', priority: "CASE e.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END",
  };
  const sortCol = sortMap[q.sort] || 'e.date';
  const dir = (q.order || (q.sort === 'date' || !q.sort ? 'desc' : 'asc')).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const orderBy = `${sortCol} ${dir}, e.date DESC`;

  return { where, params, orderBy };
}

// ---------------------------------------------------------------- emails
app.get('/api/emails', (req, res) => {
  const { where, params, orderBy } = buildEmailQuery(req.query);
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare(`SELECT e.*, a.email AS account_email, a.provider
    FROM emails e JOIN email_accounts a ON a.id = e.account_id
    WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM emails e WHERE ${where}`).get(...params).c;
  res.json({ emails: decorate(rows), total });
});

app.get('/api/emails/:id', (req, res) => {
  const row = db.prepare(`SELECT e.*, a.email AS account_email, a.provider
    FROM emails e JOIN email_accounts a ON a.id = e.account_id WHERE e.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Email not found' });
  const related = db.prepare(`SELECT id, subject, from_name, date, is_read FROM emails
    WHERE id != ? AND is_deleted = 0 AND (thread_id = ? OR from_email = ?)
    ORDER BY date DESC LIMIT 6`).all(row.id, row.thread_id, row.from_email);
  const folders = db.prepare(`SELECT f.id, f.name, f.icon, ef.assigned_by FROM email_folders ef
    JOIN folders f ON f.id = ef.folder_id WHERE ef.email_id = ?`).all(row.id);
  const [email] = decorate([row]);
  res.json({ ...email, related, folders });
});

function updateEmail(id, sql, ...params) {
  const r = db.prepare(`UPDATE emails SET ${sql} WHERE id = ?`).run(...params, id);
  return r.changes > 0;
}

app.post('/api/emails/:id/read', (req, res) => {
  const val = req.body?.is_read === false ? 0 : 1;
  if (!updateEmail(req.params.id, 'is_read = ?', val)) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, is_read: val });
});

app.post('/api/emails/:id/star', (req, res) => {
  const row = db.prepare('SELECT is_starred FROM emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const val = row.is_starred ? 0 : 1;
  updateEmail(req.params.id, 'is_starred = ?', val);
  res.json({ ok: true, is_starred: val });
});

app.post('/api/emails/:id/categorize', (req, res) => {
  const { category } = req.body || {};
  const valid = db.prepare('SELECT name FROM categories').all().map(r => r.name);
  if (category !== null && !valid.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!updateEmail(req.params.id, 'category = ?', category)) return res.status(404).json({ error: 'Not found' });
  refreshCategoryCounts();
  res.json({ ok: true, category });
});

app.post('/api/emails/:id/spam', (req, res) => {
  const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const val = req.body?.is_spam === false ? 0 : 1;
  updateEmail(req.params.id, 'is_spam = ?', val);
  if (val) {
    db.prepare('INSERT INTO spam_log (id, email_id, action, from_email) VALUES (?, ?, ?, ?)')
      .run(uid(), row.id, 'marked_spam', row.from_email);
  }
  refreshCategoryCounts();
  res.json({ ok: true, is_spam: val });
});

app.post('/api/emails/:id/unsubscribe', (req, res) => {
  const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('INSERT INTO spam_log (id, email_id, action, from_email) VALUES (?, ?, ?, ?)')
    .run(uid(), row.id, 'unsubscribed', row.from_email);
  // Safe fallback: even if the sender ignores the unsubscribe request,
  // future mail from them is auto-filed to spam locally.
  const filtered = db.prepare(`UPDATE emails SET is_spam = 1
    WHERE from_email = ? AND category IN ('newsletters','subscriptions') AND is_spam = 0`).run(row.from_email).changes;
  refreshCategoryCounts();
  res.json({
    ok: true,
    method: row.list_unsubscribe ? 'one_click' : 'local_filter',
    unsubscribe_url: row.list_unsubscribe || null,
    filtered_count: filtered,
    message: row.list_unsubscribe
      ? `Unsubscribe request sent to ${row.from_name || row.from_email}. Future emails will also be filtered locally as a fallback.`
      : `${row.from_name || row.from_email} has no unsubscribe link. Their newsletter emails will be filtered to spam locally instead.`,
  });
});

app.delete('/api/emails/:id', (req, res) => {
  if (!updateEmail(req.params.id, 'is_deleted = 1')) return res.status(404).json({ error: 'Not found' });
  refreshCategoryCounts();
  res.json({ ok: true });
});

app.post('/api/emails/:id/archive', (req, res) => {
  const val = req.body?.is_archived === false ? 0 : 1;
  if (!updateEmail(req.params.id, 'is_archived = ?', val)) return res.status(404).json({ error: 'Not found' });
  refreshCategoryCounts();
  res.json({ ok: true, is_archived: val });
});

// Manually assign an email to a folder (override auto-routing), or remove
// with { folder_id: null }. Manual assignments are never re-auto-routed.
app.post('/api/emails/:id/folder', (req, res) => {
  const email = db.prepare('SELECT id FROM emails WHERE id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email not found' });
  const { folder_id } = req.body || {};
  db.prepare('DELETE FROM email_folders WHERE email_id = ?').run(email.id);
  if (folder_id) {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder_id);
    if (!folder) return res.status(400).json({ error: 'Invalid folder' });
    db.prepare("INSERT INTO email_folders (email_id, folder_id, assigned_by) VALUES (?, ?, 'manual')")
      .run(email.id, folder_id);
    return res.json({ ok: true, folder_id, folder_name: folder.name });
  }
  res.json({ ok: true, folder_id: null });
});

// Bulk actions: { ids: [...], action: 'archive'|'delete'|'read'|'unread'|'spam'|'categorize'|'vip'|'folder', category?, folder_id? }
app.post('/api/emails/bulk', (req, res) => {
  const { ids, action, category, folder_id } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  const ph = ids.map(() => '?').join(',');
  let changed = 0;
  const run = (sql, ...extra) => db.prepare(sql).run(...extra, ...ids).changes;
  switch (action) {
    case 'archive': changed = run(`UPDATE emails SET is_archived = 1 WHERE id IN (${ph})`); break;
    case 'delete': changed = run(`UPDATE emails SET is_deleted = 1 WHERE id IN (${ph})`); break;
    case 'read': changed = run(`UPDATE emails SET is_read = 1 WHERE id IN (${ph})`); break;
    case 'unread': changed = run(`UPDATE emails SET is_read = 0 WHERE id IN (${ph})`); break;
    case 'spam': {
      changed = run(`UPDATE emails SET is_spam = 1 WHERE id IN (${ph})`);
      const rows = db.prepare(`SELECT id, from_email FROM emails WHERE id IN (${ph})`).all(...ids);
      const log = db.prepare('INSERT INTO spam_log (id, email_id, action, from_email) VALUES (?, ?, ?, ?)');
      rows.forEach(r => log.run(uid(), r.id, 'marked_spam', r.from_email));
      break;
    }
    case 'categorize':
      if (!category) return res.status(400).json({ error: 'category required' });
      changed = run(`UPDATE emails SET category = ? WHERE id IN (${ph})`, category); break;
    case 'vip': {
      const rows = db.prepare(`SELECT DISTINCT from_email, from_name FROM emails WHERE id IN (${ph})`).all(...ids);
      const ins = db.prepare('INSERT OR IGNORE INTO vip_list (id, sender_email, sender_name) VALUES (?, ?, ?)');
      rows.forEach(r => { changed += ins.run(uid(), r.from_email, r.from_name).changes; });
      break;
    }
    case 'folder': {
      if (!folder_id || !db.prepare('SELECT id FROM folders WHERE id = ?').get(folder_id))
        return res.status(400).json({ error: 'valid folder_id required' });
      const del = db.prepare('DELETE FROM email_folders WHERE email_id = ?');
      const ins = db.prepare("INSERT INTO email_folders (email_id, folder_id, assigned_by) VALUES (?, ?, 'manual')");
      ids.forEach(id => { del.run(id); changed += ins.run(id, folder_id).changes; });
      break;
    }
    default: return res.status(400).json({ error: 'Unknown action' });
  }
  refreshCategoryCounts();
  res.json({ ok: true, changed });
});

// ------------------------------------------------------------------ VIP
app.get('/api/vip', (req, res) => {
  const rows = db.prepare(`SELECT v.*,
      (SELECT COUNT(*) FROM emails e WHERE e.from_email = v.sender_email AND e.is_deleted = 0) AS email_count
    FROM vip_list v ORDER BY v.added_at DESC`).all();
  res.json(rows);
});

app.post('/api/vip', (req, res) => {
  const { sender_email, sender_name } = req.body || {};
  if (!sender_email) return res.status(400).json({ error: 'sender_email required' });
  const r = db.prepare('INSERT OR IGNORE INTO vip_list (id, sender_email, sender_name) VALUES (?, ?, ?)')
    .run(uid(), sender_email.toLowerCase(), sender_name || null);
  res.status(r.changes ? 201 : 200).json({ ok: true, added: r.changes > 0 });
});

app.delete('/api/vip/:sender_email', (req, res) => {
  const r = db.prepare('DELETE FROM vip_list WHERE sender_email = ?').run(req.params.sender_email.toLowerCase());
  if (!r.changes) return res.status(404).json({ error: 'Not in VIP list' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- drafts
app.get('/api/drafts', (req, res) => {
  const rows = db.prepare(`SELECT d.*, e.subject AS email_subject, e.from_name AS email_from_name
    FROM draft_replies d LEFT JOIN emails e ON e.id = d.email_id
    ORDER BY d.updated_at DESC`).all();
  res.json(rows);
});

app.post('/api/drafts', (req, res) => {
  const { email_id, to_email, subject, body } = req.body || {};
  if (!to_email) return res.status(400).json({ error: 'to_email required' });
  const id = uid();
  db.prepare(`INSERT INTO draft_replies (id, email_id, to_email, subject, body, status)
    VALUES (?, ?, ?, ?, ?, 'draft')`).run(id, email_id || null, to_email, subject || '', body || '');
  res.status(201).json(db.prepare('SELECT * FROM draft_replies WHERE id = ?').get(id));
});

app.post('/api/drafts/:id/save', (req, res) => {
  const d = db.prepare('SELECT * FROM draft_replies WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  if (d.status === 'sent') return res.status(409).json({ error: 'Draft already sent' });
  const { to_email, subject, body, status } = req.body || {};
  const newStatus = ['draft', 'pending_approval'].includes(status) ? status : d.status;
  db.prepare(`UPDATE draft_replies SET to_email = ?, subject = ?, body = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(to_email ?? d.to_email, subject ?? d.subject, body ?? d.body, newStatus, d.id);
  res.json(db.prepare('SELECT * FROM draft_replies WHERE id = ?').get(d.id));
});

app.post('/api/drafts/:id/approve', (req, res) => {
  const d = db.prepare('SELECT * FROM draft_replies WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  if (d.status === 'sent') return res.status(409).json({ error: 'Already sent' });
  db.prepare(`UPDATE draft_replies SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(d.id);
  if (d.email_id) db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(d.email_id);
  res.json({ ok: true, status: 'sent', message: `Reply sent to ${d.to_email}` });
});

app.delete('/api/drafts/:id', (req, res) => {
  const r = db.prepare('DELETE FROM draft_replies WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// --------------------------------------------------------- filter presets
app.get('/api/filters/presets', (req, res) => {
  res.json(db.prepare('SELECT * FROM filter_presets ORDER BY created_at DESC').all()
    .map(p => ({ ...p, filter_config: JSON.parse(p.filter_config || '{}') })));
});

app.post('/api/filters/presets', (req, res) => {
  const { name, filter_config } = req.body || {};
  if (!name || !filter_config) return res.status(400).json({ error: 'name and filter_config required' });
  const id = uid();
  db.prepare('INSERT INTO filter_presets (id, name, filter_config) VALUES (?, ?, ?)')
    .run(id, name, JSON.stringify(filter_config));
  res.status(201).json({ id, name, filter_config });
});

app.delete('/api/filters/presets/:id', (req, res) => {
  const r = db.prepare('DELETE FROM filter_presets WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ------------------------------------------------------------- categories
app.get('/api/categories', (req, res) => {
  refreshCategoryCounts();
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

// ------------------------------------------------------------------ stats
app.get('/api/stats', (req, res) => {
  const g = (sql) => db.prepare(sql).get();
  const total = g("SELECT COUNT(*) c FROM emails WHERE is_deleted = 0 AND is_spam = 0 AND is_archived = 0").c;
  const unread = g("SELECT COUNT(*) c FROM emails WHERE is_deleted = 0 AND is_spam = 0 AND is_archived = 0 AND is_read = 0").c;
  const action = g("SELECT COUNT(*) c FROM emails WHERE is_deleted = 0 AND is_spam = 0 AND is_archived = 0 AND action_required = 1").c;
  const spam = g("SELECT COUNT(*) c FROM emails WHERE is_deleted = 0 AND is_spam = 1").c;
  const vipUnread = g(`SELECT COUNT(*) c FROM emails WHERE is_deleted = 0 AND is_spam = 0 AND is_archived = 0 AND is_read = 0
    AND from_email IN (SELECT sender_email FROM vip_list)`).c;
  const drafts = g("SELECT COUNT(*) c FROM draft_replies WHERE status != 'sent'").c;

  // Spam-reduction metric: daily volume vs volume without bulk senders
  const span = g("SELECT MAX(julianday(date)) - MIN(julianday(date)) AS d FROM emails WHERE is_deleted = 0").d || 1;
  const days = Math.max(span, 1);
  const allMail = g("SELECT COUNT(*) c FROM emails WHERE is_deleted = 0").c;
  const bulkMail = g(`SELECT COUNT(*) c FROM emails WHERE is_deleted = 0
    AND (is_spam = 1 OR category IN ('newsletters','subscriptions') OR list_unsubscribe IS NOT NULL)`).c;
  const dailyAvg = Math.round((allMail / days) * 10) / 10;
  const dailyReduced = Math.round(((allMail - bulkMail) / days) * 10) / 10;
  const unsubCandidates = db.prepare(`SELECT from_email, from_name, COUNT(*) c FROM emails
    WHERE is_deleted = 0 AND list_unsubscribe IS NOT NULL AND is_spam = 0
    AND from_email NOT IN (SELECT from_email FROM spam_log WHERE action = 'unsubscribed')
    GROUP BY from_email ORDER BY c DESC LIMIT 5`).all();

  res.json({
    total, unread, action_required: action, spam, vip_unread: vipUnread, open_drafts: drafts,
    daily_average: dailyAvg, daily_if_unsubscribed: dailyReduced,
    unsubscribe_candidates: unsubCandidates,
    spam_message: `You receive ~${dailyAvg} emails daily. You could reduce that to ~${dailyReduced} by unsubscribing from bulk senders.`,
  });
});

// ----------------------------------------------------------------- search
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ emails: [], suggestions: [], total: 0 });

  if (req.query.suggest === 'true') {
    const like = `%${q}%`;
    const senders = db.prepare(`SELECT DISTINCT from_name AS text, from_email AS detail, 'sender' AS type
      FROM emails WHERE is_deleted = 0 AND (from_name LIKE ? OR from_email LIKE ?) LIMIT 4`).all(like, like);
    const subjects = db.prepare(`SELECT DISTINCT subject AS text, from_name AS detail, 'subject' AS type
      FROM emails WHERE is_deleted = 0 AND subject LIKE ? LIMIT 5`).all(like);
    return res.json({ suggestions: [...senders, ...subjects] });
  }

  const { where, params, orderBy } = buildEmailQuery({ ...req.query, view: req.query.view || 'all' });
  const rows = db.prepare(`SELECT e.*, a.email AS account_email, a.provider
    FROM emails e JOIN email_accounts a ON a.id = e.account_id
    WHERE ${where} ORDER BY ${orderBy} LIMIT 100`).all(...params);
  res.json({ emails: decorate(rows), total: rows.length });
});

// --------------------------------------------------------------- accounts
app.get('/api/accounts', (req, res) => {
  const rows = db.prepare(`SELECT id, provider, email, synced_at,
    (SELECT COUNT(*) FROM emails e WHERE e.account_id = email_accounts.id AND e.is_deleted = 0) AS email_count
    FROM email_accounts ORDER BY provider, email`).all();
  res.json(rows);
});

app.post('/api/accounts/connect', (req, res) => {
  const { provider, email } = req.body || {};
  if (!['gmail', 'outlook', 'yahoo'].includes(provider)) return res.status(400).json({ error: 'provider must be gmail, outlook, or yahoo' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'valid email required' });
  // In production this kicks off the provider OAuth flow (see .env.example for
  // client credentials). Demo mode connects immediately with a placeholder token.
  const id = uid();
  try {
    db.prepare(`INSERT INTO email_accounts (id, provider, email, oauth_token, synced_at)
      VALUES (?, ?, ?, ?, datetime('now'))`).run(id, provider, email.toLowerCase(), 'demo-encrypted-token');
  } catch {
    return res.status(409).json({ error: 'Account already connected' });
  }
  res.status(201).json({ id, provider, email: email.toLowerCase(), message: 'Account connected (demo mode - OAuth flow stubbed)' });
});

app.delete('/api/accounts/:id', (req, res) => {
  const r = db.prepare('DELETE FROM email_accounts WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  refreshCategoryCounts();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- folders
// Returns the folder tree with per-folder totals and unread counts.
app.get('/api/folders', (req, res) => {
  const rows = db.prepare(`SELECT f.*,
      (SELECT COUNT(*) FROM email_folders ef JOIN emails e ON e.id = ef.email_id
        WHERE ef.folder_id = f.id AND e.is_deleted = 0 AND e.is_spam = 0) AS email_count,
      (SELECT COUNT(*) FROM email_folders ef JOIN emails e ON e.id = ef.email_id
        WHERE ef.folder_id = f.id AND e.is_deleted = 0 AND e.is_spam = 0 AND e.is_read = 0) AS unread_count
    FROM folders f ORDER BY f.parent_folder_id IS NOT NULL, f.name`).all();
  const roots = rows.filter(r => !r.parent_folder_id).map(r => ({
    ...r,
    children: rows.filter(c => c.parent_folder_id === r.id),
  }));
  // Parent totals include their children
  roots.forEach(r => {
    r.email_count += r.children.reduce((a, c) => a + c.email_count, 0);
    r.unread_count += r.children.reduce((a, c) => a + c.unread_count, 0);
  });
  res.json(roots);
});

// ---------------------------------------------------------- notifications
// Important emails the user hasn't dismissed/reviewed yet ("since last check").
// ?mark_browser=true additionally flags which ones still need a browser
// notification and records them, so each email pushes to the browser once.
app.get('/api/notifications/important', (req, res) => {
  const rows = db.prepare(`SELECT e.*, a.email AS account_email, a.provider, n.id AS notif_id, n.sent_at AS notified_at,
      EXISTS(SELECT 1 FROM notifications_sent b WHERE b.email_id = e.id AND b.notification_type = 'browser') AS browser_done
    FROM notifications_sent n
    JOIN emails e ON e.id = n.email_id
    JOIN email_accounts a ON a.id = e.account_id
    WHERE n.notification_type = 'dashboard' AND n.dismissed_at IS NULL
      AND e.is_deleted = 0 AND e.is_spam = 0 AND e.is_archived = 0 AND e.is_read = 0
    ORDER BY e.date DESC`).all();

  const vips = new Set(db.prepare('SELECT sender_email FROM vip_list').all().map(r => r.sender_email));
  const markBrowser = req.query.mark_browser === 'true';
  const insBrowser = db.prepare("INSERT INTO notifications_sent (id, email_id, notification_type) VALUES (?, ?, 'browser')");

  const emails = rows.map(r => {
    const types = JSON.parse(r.important_types || '[]');
    if (vips.has(r.from_email)) types.push('vip');
    const newForBrowser = markBrowser && !r.browser_done;
    if (newForBrowser) insBrowser.run(uid(), r.id);
    return { ...parseEmail(r), is_vip: vips.has(r.from_email) ? 1 : 0, important_types: [...new Set(types)], new_for_browser: newForBrowser };
  });

  const breakdown = {};
  for (const e of emails) for (const t of e.important_types) breakdown[t] = (breakdown[t] || 0) + 1;
  const labels = { bill: 'bill', tax: 'tax document', urgent: 'urgent', vip: 'VIP email', action: 'action item' };
  const summary = Object.entries(breakdown)
    .map(([t, c]) => `${c} ${labels[t] || t}${c > 1 ? 's' : ''}`).join(', ');
  const lastSweep = db.prepare('SELECT * FROM sweep_log ORDER BY sweep_time DESC LIMIT 1').get() || null;

  res.json({ count: emails.length, emails, breakdown, summary, last_sweep: lastSweep });
});

// Dismiss notifications. Body: { email_ids?: [...] } - omit to dismiss all.
app.post('/api/notifications/dismiss', (req, res) => {
  const { email_ids } = req.body || {};
  let changed;
  if (Array.isArray(email_ids) && email_ids.length) {
    const ph = email_ids.map(() => '?').join(',');
    changed = db.prepare(`UPDATE notifications_sent SET dismissed_at = datetime('now')
      WHERE notification_type = 'dashboard' AND dismissed_at IS NULL AND email_id IN (${ph})`).run(...email_ids).changes;
  } else {
    changed = db.prepare(`UPDATE notifications_sent SET dismissed_at = datetime('now')
      WHERE notification_type = 'dashboard' AND dismissed_at IS NULL`).run().changes;
  }
  res.json({ ok: true, dismissed: changed });
});

// Badge counts: undismissed important total + per-folder new-important counts.
app.get('/api/notifications/status', (req, res) => {
  const activeNotif = `SELECT n.email_id FROM notifications_sent n JOIN emails e ON e.id = n.email_id
    WHERE n.notification_type = 'dashboard' AND n.dismissed_at IS NULL
    AND e.is_deleted = 0 AND e.is_spam = 0 AND e.is_archived = 0 AND e.is_read = 0`;
  const importantNew = db.prepare(`SELECT COUNT(*) c FROM (${activeNotif})`).get().c;
  const folders = db.prepare(`SELECT f.id, f.name, COUNT(ef.email_id) AS important_new
    FROM folders f LEFT JOIN email_folders ef
      ON ef.folder_id = f.id AND ef.email_id IN (${activeNotif})
    GROUP BY f.id`).all();
  const folderBadges = Object.fromEntries(folders.map(f => [f.id, f.important_new]));
  folderBadges[FOLDER_IDS.amazon] = (folderBadges[FOLDER_IDS.purchase] || 0) + (folderBadges[FOLDER_IDS.returns] || 0);
  const lastSweep = db.prepare('SELECT * FROM sweep_log ORDER BY sweep_time DESC LIMIT 1').get() || null;
  res.json({ important_new: importantNew, folder_badges: folderBadges, last_sweep: lastSweep });
});

// Register a browser push subscription (demo: stored, not used server-side;
// the frontend fires Notifications while the dashboard is open).
app.post('/api/notifications/subscribe', (req, res) => {
  const sub = JSON.stringify(req.body?.subscription || { type: 'local', ua: req.headers['user-agent'] || '' });
  const r = db.prepare('INSERT OR IGNORE INTO push_subscriptions (id, subscription) VALUES (?, ?)').run(uid(), sub);
  res.status(r.changes ? 201 : 200).json({ ok: true, registered: r.changes > 0 });
});

// Trigger a sweep on demand (used by the demo "Run sweep now" button).
app.post('/api/notifications/sweep', (req, res) => {
  res.json({ ok: true, ...runSweep() });
});

// On-demand email digest: "here's what needs your attention".
app.get('/api/notifications/digest', (req, res) => {
  const rows = db.prepare(`SELECT e.id, e.subject, e.from_name, e.from_email, e.date, e.important_types
    FROM emails e
    WHERE e.is_deleted = 0 AND e.is_spam = 0 AND e.is_archived = 0 AND e.is_read = 0
      AND (e.important = 1 OR e.from_email IN (SELECT sender_email FROM vip_list))
    ORDER BY e.date DESC LIMIT 25`).all();
  const vips = new Set(db.prepare('SELECT sender_email FROM vip_list').all().map(r => r.sender_email));
  const items = rows.map(r => {
    const types = JSON.parse(r.important_types || '[]');
    if (vips.has(r.from_email)) types.push('vip');
    return { id: r.id, subject: r.subject, from_name: r.from_name, date: r.date,
      types: [...new Set(types)], link: `/?email=${r.id}` };
  });
  const breakdown = {};
  for (const i of items) for (const t of i.types) breakdown[t] = (breakdown[t] || 0) + 1;
  const labels = { bill: 'bill', tax: 'tax document', urgent: 'urgent', vip: 'VIP email', action: 'action item' };
  const summary = items.length
    ? `Here's what needs your attention: ${Object.entries(breakdown).map(([t, c]) => `${c} ${labels[t] || t}${c > 1 ? 's' : ''}`).join(', ')}.`
    : 'Nothing needs your attention right now. Inbox zero on the important stuff.';
  // Demo: record the digest instead of actually emailing it
  const ins = db.prepare("INSERT INTO notifications_sent (id, email_id, notification_type) VALUES (?, ?, 'digest')");
  items.forEach(i => ins.run(uid(), i.id));
  res.json({ ok: true, sent_to: 'aneshpatel.md@gmail.com', demo: true, summary, breakdown, items,
    message: `Digest ${DEMO_MODE ? 'generated (demo mode - would be emailed in production)' : 'sent'} to aneshpatel.md@gmail.com` });
});

// ------------------------------------------------------------------ misc
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Email dashboard running on http://0.0.0.0:${PORT}`);
  startSweeper(); // first sweep now, then hourly at :00
});
