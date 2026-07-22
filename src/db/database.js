/* SQLite setup + demo seed data.
 * Locally the database file lives at src/db/dashboard.db (created on first run).
 * In the cloud, set DATA_DIR (e.g. a Railway volume mounted at /data) so the
 * database survives restarts. If DATA_DIR is unset, this folder is used. */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || __dirname;
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'dashboard.db'));
db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      preview TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      priority TEXT NOT NULL DEFAULT 'normal',
      is_read INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      location TEXT DEFAULT '',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'local',
      category TEXT NOT NULL DEFAULT 'clinical'
    );

    CREATE TABLE IF NOT EXISTS calendar_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      connected INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      institution TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL,
      plaid_ready INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL,      -- 0=Sun .. 6=Sat
      slot TEXT NOT NULL,                -- 'morning' | 'afternoon' | 'evening' | 'overnight'
      status TEXT NOT NULL DEFAULT 'unavailable',  -- 'available' | 'preferred' | 'unavailable'
      UNIQUE(day_of_week, slot)
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility TEXT NOT NULL,
      role TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      rate REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'  -- 'open' | 'requested' | 'confirmed' | 'declined'
    );
  `);

  const emailCount = db.prepare('SELECT COUNT(*) AS c FROM emails').get().c;
  if (emailCount === 0) seed();
}

/* ---------- demo data ---------- */

function iso(daysFromNow, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function dateOnly(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function seed() {
  const insEmail = db.prepare(`INSERT INTO emails
    (sender, sender_email, subject, preview, body, category, priority, is_read, received_at)
    VALUES (@sender, @sender_email, @subject, @preview, @body, @category, @priority, @is_read, @received_at)`);

  const emails = [
    { sender: 'Dr. Sarah Chen', sender_email: 'schen@mercygeneral.org', subject: 'Consult request: 62M with atypical chest pain', preview: 'Would appreciate your read on the troponin trend before we...', body: 'Hi,\n\nWould appreciate your read on the troponin trend before we commit to the cath lab. ECG and labs attached in the chart (MRN 448291). Patient is stable, pain resolved with nitro.\n\nThanks,\nSarah', category: 'clinical', priority: 'high', is_read: 0, received_at: iso(0, 7, 42) },
    { sender: 'Mercy General Scheduling', sender_email: 'scheduling@mercygeneral.org', subject: 'ACTION NEEDED: October shift preferences due Friday', preview: 'Submit your availability for October by Friday 5pm to be included...', body: 'Submit your availability for October by Friday 5pm to be included in the first draft of the schedule. Late submissions will be slotted into remaining shifts.\n\n— Scheduling Office', category: 'admin', priority: 'high', is_read: 0, received_at: iso(0, 6, 15) },
    { sender: 'Epic Systems', sender_email: 'no-reply@epic.com', subject: 'Your In Basket has 14 unresolved messages', preview: 'You have 14 messages requiring action: 6 results, 5 patient...', body: 'You have 14 messages requiring action:\n- 6 result notifications\n- 5 patient advice requests\n- 3 Rx renewal requests\n\nSign in to resolve.', category: 'clinical', priority: 'normal', is_read: 0, received_at: iso(0, 5, 30) },
    { sender: 'CME Tracker', sender_email: 'alerts@cmetracker.net', subject: '18 Category 1 credits still needed before Dec 31', preview: 'Your license renewal requires 40 credits. You have completed 22...', body: 'Your license renewal requires 40 credits. You have completed 22. Consider the upcoming Hospital Medicine Update (8 credits, virtual) on Nov 2.', category: 'cme', priority: 'normal', is_read: 0, received_at: iso(-1, 16, 5) },
    { sender: 'Anita Rodriguez, Locum Tenens', sender_email: 'arodriguez@locumpartners.com', subject: 'Weekend hospitalist coverage — $185/hr, Nov 8-10', preview: 'A 3-day weekend block just opened at Riverside Medical...', body: 'Hi Dr. Patel,\n\nA 3-day weekend block just opened at Riverside Medical Center (Nov 8–10), 7a–7p, $185/hr with travel covered. Interested? These go fast.\n\nAnita', category: 'opportunities', priority: 'normal', is_read: 0, received_at: iso(-1, 11, 20) },
    { sender: 'MedMal Insurance Group', sender_email: 'billing@medmalgroup.com', subject: 'Q4 malpractice premium invoice — $4,850', preview: 'Your quarterly premium of $4,850 is due October 15...', body: 'Your quarterly premium of $4,850 is due October 15. Autopay is not enabled on this policy. Pay online or enable autopay in your account settings.', category: 'financial', priority: 'high', is_read: 1, received_at: iso(-2, 9, 0) },
    { sender: 'Dr. James Okafor', sender_email: 'jokafor@mercygeneral.org', subject: 'Journal club Thursday — GLP-1s in heart failure', preview: 'We are discussing the STEP-HFpEF trial this Thursday at 6:30...', body: 'We are discussing the STEP-HFpEF trial this Thursday at 6:30 pm, Conference Room B (pizza provided). Paper attached. Hope you can make it.\n\nJames', category: 'cme', priority: 'low', is_read: 1, received_at: iso(-2, 14, 45) },
    { sender: 'HR Benefits', sender_email: 'benefits@mercygeneral.org', subject: 'Open enrollment closes in 10 days', preview: 'Review your health, disability, and retirement elections before...', body: 'Review your health, disability, and retirement elections before open enrollment closes. Changes take effect January 1. No action keeps your current elections.', category: 'admin', priority: 'normal', is_read: 1, received_at: iso(-3, 10, 30) },
    { sender: 'Vanguard', sender_email: 'statements@vanguard.com', subject: 'Your September statement is ready', preview: 'Your account statement for September is now available...', body: 'Your account statement for September is now available. Sign in to view your portfolio summary, transactions, and performance.', category: 'financial', priority: 'low', is_read: 1, received_at: iso(-3, 8, 0) },
    { sender: 'Priya Patel', sender_email: 'priya.patel@gmail.com', subject: 'Diwali dinner — are you on call?', preview: 'Mom wants a headcount for the 20th. Are you working that...', body: 'Mom wants a headcount for the 20th. Are you working that weekend or can you make it this year? She is making your favorite.\n\nP', category: 'personal', priority: 'normal', is_read: 0, received_at: iso(-1, 19, 10) },
    { sender: 'State Medical Board', sender_email: 'licensing@medboard.state.gov', subject: 'License renewal window now open', preview: 'Your medical license expires December 31. Renew online to avoid...', body: 'Your medical license expires December 31. Renew online to avoid late fees. Required: CME attestation, current DEA number, and renewal fee of $450.', category: 'admin', priority: 'high', is_read: 0, received_at: iso(-4, 9, 15) },
    { sender: 'UpToDate', sender_email: 'digest@uptodate.com', subject: 'Practice-changing updates: hospital medicine', preview: 'New this month: updated sepsis fluid resuscitation guidance...', body: 'New this month:\n- Updated sepsis fluid resuscitation guidance\n- DOAC dosing in obesity\n- Revised community-acquired pneumonia pathway', category: 'cme', priority: 'low', is_read: 1, received_at: iso(-5, 7, 0) },
    { sender: 'Riverside Medical Center', sender_email: 'medstaff@riversidemed.org', subject: 'Credentialing packet approved', preview: 'Your privileges at Riverside Medical Center have been approved...', body: 'Your privileges at Riverside Medical Center have been approved through 2027. You may now be scheduled for shifts. Welcome to the medical staff.', category: 'admin', priority: 'normal', is_read: 1, received_at: iso(-6, 13, 20) },
    { sender: 'AMEX', sender_email: 'alerts@americanexpress.com', subject: 'Large purchase alert: $1,240.00', preview: 'A purchase of $1,240.00 was made at CONF-REG-SHM2026...', body: 'A purchase of $1,240.00 was made at CONF-REG-SHM2026 (conference registration). If this was not you, contact us immediately.', category: 'financial', priority: 'normal', is_read: 1, received_at: iso(-6, 15, 55) },
  ];
  const seedEmails = db.transaction(() => emails.forEach((e) => insEmail.run(e)));
  seedEmails();

  const insEvent = db.prepare(`INSERT INTO calendar_events
    (title, description, location, start_time, end_time, source, category)
    VALUES (@title, @description, @location, @start_time, @end_time, @source, @category)`);
  const events = [
    { title: 'ICU rounds', description: 'Morning rounds with residents', location: 'Mercy General, 4th floor', start_time: iso(0, 7, 0), end_time: iso(0, 9, 0), source: 'work', category: 'clinical' },
    { title: 'Clinic — follow-ups', description: '12 patients scheduled', location: 'Outpatient Bldg, Suite 210', start_time: iso(0, 10, 0), end_time: iso(0, 16, 0), source: 'work', category: 'clinical' },
    { title: 'Journal club: STEP-HFpEF', description: 'Presenter: Dr. Okafor', location: 'Conference Room B', start_time: iso(2, 18, 30), end_time: iso(2, 20, 0), source: 'work', category: 'education' },
    { title: 'Night shift — hospitalist', description: '7p–7a admitting', location: 'Mercy General', start_time: iso(3, 19, 0), end_time: iso(4, 7, 0), source: 'work', category: 'clinical' },
    { title: 'Dentist', description: 'Cleaning', location: 'Smile Dental', start_time: iso(5, 14, 0), end_time: iso(5, 15, 0), source: 'personal', category: 'personal' },
    { title: 'Diwali dinner at Mom\'s', description: 'Bring dessert', location: 'Family home', start_time: iso(7, 18, 0), end_time: iso(7, 22, 0), source: 'personal', category: 'personal' },
    { title: 'Hospital Medicine Update (CME)', description: '8 Category 1 credits, virtual', location: 'Zoom', start_time: iso(9, 8, 0), end_time: iso(9, 16, 0), source: 'work', category: 'education' },
    { title: 'Weekend coverage — Riverside', description: 'Locum shift, 7a–7p, $185/hr', location: 'Riverside Medical Center', start_time: iso(12, 7, 0), end_time: iso(12, 19, 0), source: 'work', category: 'clinical' },
    { title: 'Gym — legs', description: '', location: '', start_time: iso(1, 6, 0), end_time: iso(1, 7, 0), source: 'personal', category: 'personal' },
    { title: 'Admin: license renewal', description: 'Complete CME attestation + pay fee', location: '', start_time: iso(4, 12, 0), end_time: iso(4, 12, 30), source: 'personal', category: 'admin' },
  ];
  const seedEvents = db.transaction(() => events.forEach((e) => insEvent.run(e)));
  seedEvents();

  const insSource = db.prepare('INSERT INTO calendar_sources (name, provider, connected) VALUES (?, ?, ?)');
  insSource.run('Work (Hospital)', 'google', 1);
  insSource.run('Personal', 'apple', 1);
  insSource.run('Locums Agency', 'outlook', 0);

  const insAccount = db.prepare('INSERT INTO accounts (name, institution, type, balance) VALUES (?, ?, ?, ?)');
  const checking = insAccount.run('Everyday Checking', 'Chase', 'checking', 18420.55).lastInsertRowid;
  const savings = insAccount.run('High-Yield Savings', 'Marcus', 'savings', 62300.00).lastInsertRowid;
  const invest = insAccount.run('Brokerage', 'Vanguard', 'investment', 214780.32).lastInsertRowid;
  const credit = insAccount.run('AMEX Gold', 'American Express', 'credit', -3245.18).lastInsertRowid;

  const insTx = db.prepare('INSERT INTO transactions (account_id, description, category, amount, date) VALUES (?, ?, ?, ?, ?)');
  const txs = [
    [checking, 'Mercy General — Payroll', 'income', 12450.00, dateOnly(-2)],
    [checking, 'Locum Partners — Weekend shift', 'income', 4440.00, dateOnly(-9)],
    [checking, 'MedMal Insurance Group', 'insurance', -4850.00, dateOnly(-5)],
    [checking, 'Mortgage payment', 'housing', -3200.00, dateOnly(-15)],
    [credit, 'SHM 2026 Conference registration', 'education', -1240.00, dateOnly(-6)],
    [credit, 'Whole Foods', 'groceries', -186.42, dateOnly(-1)],
    [credit, 'Shell', 'transport', -52.10, dateOnly(-3)],
    [credit, 'Epic UserWeb subscription', 'work', -49.00, dateOnly(-12)],
    [checking, 'Transfer to savings', 'transfer', -3000.00, dateOnly(-14)],
    [savings, 'Transfer from checking', 'transfer', 3000.00, dateOnly(-14)],
    [invest, 'VTSAX purchase', 'investment', -5000.00, dateOnly(-20)],
    [checking, 'State Medical Board — renewal fee', 'licensing', -450.00, dateOnly(-4)],
    [credit, 'Blue Bottle Coffee', 'dining', -14.75, dateOnly(0)],
    [checking, 'Mercy General — Payroll', 'income', 12450.00, dateOnly(-16)],
    [credit, 'Scrubs & Beyond', 'work', -128.30, dateOnly(-8)],
  ];
  const seedTx = db.transaction(() => txs.forEach((t) => insTx.run(...t)));
  seedTx();

  const insAvail = db.prepare('INSERT INTO availability (day_of_week, slot, status) VALUES (?, ?, ?)');
  const defaults = {
    // Mon–Fri mornings/afternoons available, evenings preferred off, weekend flexible
    0: { morning: 'unavailable', afternoon: 'unavailable', evening: 'unavailable', overnight: 'unavailable' },
    1: { morning: 'preferred', afternoon: 'preferred', evening: 'available', overnight: 'unavailable' },
    2: { morning: 'preferred', afternoon: 'preferred', evening: 'available', overnight: 'unavailable' },
    3: { morning: 'available', afternoon: 'available', evening: 'unavailable', overnight: 'unavailable' },
    4: { morning: 'preferred', afternoon: 'preferred', evening: 'available', overnight: 'available' },
    5: { morning: 'available', afternoon: 'available', evening: 'available', overnight: 'available' },
    6: { morning: 'available', afternoon: 'unavailable', evening: 'unavailable', overnight: 'unavailable' },
  };
  const seedAvail = db.transaction(() => {
    for (let d = 0; d <= 6; d++) {
      for (const slot of ['morning', 'afternoon', 'evening', 'overnight']) {
        insAvail.run(d, slot, defaults[d][slot]);
      }
    }
  });
  seedAvail();

  const insShift = db.prepare('INSERT INTO shifts (facility, role, date, start_time, end_time, rate, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insShift.run('Riverside Medical Center', 'Hospitalist', dateOnly(12), '07:00', '19:00', 185, 'confirmed');
  insShift.run('Riverside Medical Center', 'Hospitalist', dateOnly(13), '07:00', '19:00', 185, 'requested');
  insShift.run('St. Luke\'s Community', 'Hospitalist (nights)', dateOnly(18), '19:00', '07:00', 210, 'open');
  insShift.run('Mercy General', 'Hospitalist', dateOnly(3), '19:00', '07:00', 0, 'confirmed');
  insShift.run('Lakeview Urgent Care', 'Urgent Care', dateOnly(20), '08:00', '20:00', 160, 'open');
  insShift.run('St. Luke\'s Community', 'Hospitalist', dateOnly(25), '07:00', '19:00', 195, 'open');

  console.log('Seeded demo data (emails, calendar, finance, availability).');
}

module.exports = { db, initDb };
