// Database layer: SQLite via Node's built-in node:sqlite (Node >= 22.5)
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'emails.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const uid = () => crypto.randomUUID();

// ---------------------------------------------------------------- schema
db.exec(`
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,            -- gmail | outlook | yahoo
  email TEXT NOT NULL UNIQUE,
  oauth_token TEXT,                  -- encrypted at rest (AES-256-GCM)
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES email_accounts(id) ON DELETE CASCADE,
  subject TEXT,
  from_email TEXT,
  from_name TEXT,
  to_email TEXT,
  body_preview TEXT,
  body_full TEXT,
  date TEXT,
  is_read INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  is_spam INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  category TEXT,                     -- finance|work|personal|receipts|subscriptions|newsletters
  priority TEXT DEFAULT 'normal',    -- high | normal | low
  action_required INTEGER DEFAULT 0, -- bills / tax / payment detection
  has_attachment INTEGER DEFAULT 0,
  attachment_types TEXT DEFAULT '[]',-- JSON array: ["pdf","image",...]
  attachments TEXT DEFAULT '[]',     -- JSON array: [{name,type,size}]
  list_unsubscribe TEXT,             -- unsubscribe URL if the email has one
  message_id TEXT UNIQUE,
  thread_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_email);
CREATE INDEX IF NOT EXISTS idx_emails_category ON emails(category);

CREATE TABLE IF NOT EXISTS vip_list (
  id TEXT PRIMARY KEY,
  sender_email TEXT UNIQUE,
  sender_name TEXT,
  added_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  color TEXT,
  email_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS draft_replies (
  id TEXT PRIMARY KEY,
  email_id TEXT REFERENCES emails(id) ON DELETE CASCADE,
  to_email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'draft',       -- draft | pending_approval | sent
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS filter_presets (
  id TEXT PRIMARY KEY,
  name TEXT,
  filter_config TEXT,                -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spam_log (
  id TEXT PRIMARY KEY,
  email_id TEXT REFERENCES emails(id) ON DELETE SET NULL,
  action TEXT,                       -- marked_spam | unsubscribed
  from_email TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);
`);

// ------------------------------------------------- smart detection helpers
const ACTION_KEYWORDS = ['bill', 'invoice', 'tax', 'payment due', 'statement', 'refund', 'irs', 'past due', 'amount due', 'w-2', '1099'];

function detectActionRequired(subject, body) {
  const text = `${subject || ''} ${body || ''}`.toLowerCase();
  return ACTION_KEYWORDS.some(k => text.includes(k));
}

const CATEGORY_RULES = [
  { cat: 'receipts', kw: ['receipt', 'order confirm', 'your order', 'shipped', 'delivery confirm'] },
  { cat: 'finance', kw: ['bill', 'invoice', 'tax', 'payment', 'statement', 'refund', 'bank', 'credit card', 'insurance', 'mortgage', '401k', 'irs'] },
  { cat: 'newsletters', kw: ['newsletter', 'digest', 'weekly roundup', 'this week in', 'top stories'] },
  { cat: 'subscriptions', kw: ['subscription', 'renewal', 'your plan', 'membership', 'trial end'] },
  { cat: 'work', kw: ['meeting', 'project', 'deadline', 'standup', 'review', 'sprint', 'q3', 'client', 'proposal'] },
];

function detectCategory(subject, body, fromEmail, hasUnsubscribe) {
  const text = `${subject || ''} ${body || ''}`.toLowerCase();
  const from = (fromEmail || '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.some(k => text.includes(k))) return rule.cat;
  }
  if (/newsletter|digest|news@|crew@|alerts@/.test(from)) return 'newsletters';
  if (hasUnsubscribe) return 'newsletters'; // bulk sender with unsubscribe header
  return 'personal';
}

// ------------------------------------------------------------------ seed
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM emails').get().c;
  if (count > 0) return false;

  db.prepare('INSERT OR IGNORE INTO user (id) VALUES (?)').run('user-1');

  const accounts = [
    { id: 'acc-gmail-1', provider: 'gmail', email: 'anesh.personal@gmail.com' },
    { id: 'acc-gmail-2', provider: 'gmail', email: 'anesh.finance@gmail.com' },
    { id: 'acc-gmail-3', provider: 'gmail', email: 'aneshpatel.md@gmail.com' },
    { id: 'acc-outlook-1', provider: 'outlook', email: 'anesh.patel@outlook.com' },
    { id: 'acc-yahoo-1', provider: 'yahoo', email: 'anesh_patel@yahoo.com' },
  ];
  const insAcc = db.prepare('INSERT INTO email_accounts (id, provider, email, oauth_token, synced_at) VALUES (?, ?, ?, ?, datetime(\'now\'))');
  for (const a of accounts) insAcc.run(a.id, a.provider, a.email, 'demo-encrypted-token');

  const cats = [
    ['finance', '#4CAF50'], ['work', '#4A9EFF'], ['personal', '#B388FF'],
    ['receipts', '#26C6DA'], ['subscriptions', '#FF9800'], ['newsletters', '#EC407A'],
  ];
  const insCat = db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)');
  for (const [name, color] of cats) insCat.run(uid(), name, color);

  const vips = [
    ['sarah.chen@medgroup.org', 'Dr. Sarah Chen'],
    ['mom.patel@gmail.com', 'Mom'],
    ['raj.mehta@cpafirm.com', 'Raj Mehta CPA'],
  ];
  const insVip = db.prepare('INSERT INTO vip_list (id, sender_email, sender_name) VALUES (?, ?, ?)');
  for (const [e, n] of vips) insVip.run(uid(), e, n);

  // 50 demo emails. daysAgo controls date; att = [{name,type}]
  const E = (acc, from_name, from_email, subject, preview, body, daysAgo, opts = {}) =>
    ({ acc, from_name, from_email, subject, preview, body, daysAgo, ...opts });

  const seed = [
    // --- Bills / tax / action required (finance) ---
    E('acc-gmail-2', 'Pacific Gas & Electric', 'billing@pge.com', 'Your PG&E bill is ready - Payment due Jul 28', 'Your energy statement for June is now available. Amount due: $187.42.', 'Dear Customer,\n\nYour energy statement for June is now available. Amount due: $187.42, payment due by July 28, 2026.\n\nView and pay your bill online at pge.com/myaccount.\n\nThank you,\nPG&E Billing', 1, { att: [{ name: 'statement-june.pdf', type: 'pdf' }], read: 0 }),
    E('acc-gmail-2', 'IRS e-Services', 'noreply@irs.gov', 'Your tax refund status has been updated', 'Your 2025 federal tax refund of $1,240 has been approved and scheduled.', 'Your 2025 federal tax refund of $1,240.00 has been approved and is scheduled for direct deposit within 5 business days.\n\nRefund reference: 2026-8841-XT.\n\nDo not reply to this automated message.', 2, { read: 0 }),
    E('acc-gmail-2', 'Chase Bank', 'alerts@chase.com', 'Your credit card statement is ready', 'Statement balance: $2,341.87. Minimum payment due August 3.', 'Your Chase Sapphire statement is ready.\n\nStatement balance: $2,341.87\nMinimum payment due: $35.00 by August 3, 2026.\n\nLog in to review your transactions.', 3, { att: [{ name: 'chase-statement.pdf', type: 'pdf' }], read: 0 }),
    E('acc-outlook-1', 'City of Oakland', 'tax@oaklandca.gov', 'Property tax installment due August 10', 'Reminder: your property tax installment of $3,120 is due August 10.', 'This is a reminder that the second installment of your 2025-2026 property tax, $3,120.00, is due August 10, 2026.\n\nLate payments incur a 10% penalty.\n\nPay online at oaklandca.gov/tax.', 4, { att: [{ name: 'tax-notice.pdf', type: 'pdf' }], read: 0 }),
    E('acc-gmail-2', 'Raj Mehta CPA', 'raj.mehta@cpafirm.com', 'Q3 estimated tax payment reminder', 'Hi Anesh, your Q3 estimated tax payment of $4,500 is due September 15.', 'Hi Anesh,\n\nA heads-up that your Q3 estimated tax payment of $4,500 is due September 15. I attached the voucher and a worksheet showing how we got the number.\n\nLet me know if your income changed materially this quarter.\n\nBest,\nRaj', 5, { att: [{ name: '1040-ES-voucher.pdf', type: 'pdf' }, { name: 'worksheet.xlsx', type: 'document' }], read: 1 }),
    E('acc-gmail-3', 'Blue Shield of California', 'billing@blueshieldca.com', 'Invoice: July medical malpractice premium', 'Invoice #88213 for $612.00 - payment due July 25.', 'Invoice #88213\n\nJuly professional liability premium: $612.00\nDue: July 25, 2026\n\nAutopay is not enabled for this account.', 2, { att: [{ name: 'invoice-88213.pdf', type: 'pdf' }], read: 0 }),
    E('acc-yahoo-1', 'Comcast Xfinity', 'billing@xfinity.com', 'Your bill is past due - action needed', 'Your payment of $89.99 is past due. Avoid service interruption.', 'Your Xfinity payment of $89.99 was due July 12 and is now past due.\n\nPlease pay promptly to avoid service interruption and a late fee.', 6, { read: 0 }),
    E('acc-gmail-2', 'Vanguard', 'statements@vanguard.com', 'Your quarterly statement is available', 'Your Q2 2026 account statement is now available to view.', 'Your Q2 2026 statement for account ending 8842 is now available.\n\nPortfolio value: $148,220.14 (+4.2% this quarter).', 8, { att: [{ name: 'vanguard-q2.pdf', type: 'pdf' }], read: 1 }),
    E('acc-gmail-2', 'Geico', 'noreply@geico.com', 'Auto insurance payment due July 30', 'Your 6-month premium of $684.50 is due July 30. Renew now to keep coverage.', 'Your auto policy renews August 1. The 6-month premium of $684.50 is due July 30.\n\nYour rate went up $22 from last term due to regional adjustments.', 3, { read: 0 }),
    E('acc-gmail-3', 'ADP Payroll', 'noreply@adp.com', 'Your pay statement is available', 'Your pay statement for period ending 07/15 is ready to view.', 'Your pay statement for the period ending 07/15/2026 is now available in the ADP portal.\n\nNet pay: $8,412.33 deposited to account ****4421.', 4, { att: [{ name: 'paystub.pdf', type: 'pdf' }], read: 1 }),

    // --- Work ---
    E('acc-gmail-3', 'Dr. Sarah Chen', 'sarah.chen@medgroup.org', 'Patient case review - Thursday meeting moved', 'Hi Anesh, moving Thursday case review to 2pm. Can you present the cardiology consult?', 'Hi Anesh,\n\nWe need to move Thursday\'s case review to 2pm - the conference room was double-booked. Could you present the cardiology consult from last week? Slides would help but notes are fine.\n\nThanks,\nSarah', 0, { read: 0 }),
    E('acc-gmail-3', 'Dr. Sarah Chen', 'sarah.chen@medgroup.org', 'Re: Schedule swap for August 14?', 'That works. I\'ll take your Aug 14 shift if you cover my Aug 21.', 'That works for me. I\'ll take your August 14 shift if you can cover my August 21 evening block.\n\nI\'ll update the schedule system today unless you object.\n\nSarah', 2, { read: 1 }),
    E('acc-gmail-3', 'Med Group HR', 'hr@medgroup.org', 'Annual compliance training due August 1', 'Reminder: your HIPAA compliance modules must be completed by August 1.', 'This is a reminder that your annual HIPAA and safety compliance modules must be completed by August 1, 2026.\n\nEstimated time: 90 minutes. Access via the HR portal.', 5, { read: 0 }),
    E('acc-outlook-1', 'James Liu', 'james.liu@medconsulting.com', 'Proposal draft for the telehealth project', 'Attached is the revised proposal. Deadline for feedback is Friday.', 'Hi Anesh,\n\nAttached is the revised telehealth consulting proposal with the updated scope we discussed. The client wants feedback by Friday, so any comments before Thursday evening would be ideal.\n\nBest,\nJames', 1, { att: [{ name: 'telehealth-proposal-v2.docx', type: 'document' }], read: 0 }),
    E('acc-outlook-1', 'Calendly', 'notifications@calendly.com', 'New meeting scheduled: Advisory call with NovaHealth', 'Aditi Rao scheduled an advisory call for July 23, 3:00pm PT.', 'A new event has been scheduled.\n\nEvent: Advisory call\nInvitee: Aditi Rao (NovaHealth)\nTime: July 23, 2026, 3:00pm PT\nLocation: Zoom (link in calendar invite)', 2, { read: 1 }),
    E('acc-gmail-3', 'Epic Systems', 'noreply@epic.com', 'Scheduled maintenance this weekend', 'The EHR system will be unavailable Saturday 11pm - Sunday 3am.', 'Scheduled maintenance notice:\n\nThe EHR production environment will be unavailable Saturday July 25 11:00pm through Sunday July 26 3:00am PT. Downtime procedures apply.', 3, { read: 1 }),
    E('acc-outlook-1', 'James Liu', 'james.liu@medconsulting.com', 'Quick sync before the client review?', 'Do you have 15 minutes tomorrow morning before the 10am client review?', 'Anesh,\n\nDo you have 15 minutes tomorrow before the 10am client review? I want to align on how we present the staffing model numbers.\n\nJames', 0, { read: 0 }),

    // --- Personal ---
    E('acc-gmail-1', 'Mom', 'mom.patel@gmail.com', 'Diwali plans this year?', 'Beta, are you coming home for Diwali? Your cousins are asking.', 'Beta,\n\nAre you coming home for Diwali this year? Your cousins are all asking, and Nisha is bringing the baby. Let me know the dates so I can plan the food.\n\nAlso call your father, he figured out video calling.\n\nLove, Mom', 1, { read: 0 }),
    E('acc-gmail-1', 'Mom', 'mom.patel@gmail.com', 'Recipe you asked for', 'Here is the dal recipe. Do not skip the tempering step.', 'Here is the dal recipe you asked about. The secret is the double tempering - once at the start, once at the end. Do not skip it like last time.\n\nMom', 6, { read: 1 }),
    E('acc-gmail-1', 'Priya Sharma', 'priya.sharma88@gmail.com', 'Hiking Saturday - trail confirmed', 'We\'re doing the Skyline trail Saturday 8am. Parking lot fills fast!', 'Hey!\n\nSkyline-to-Sea it is, Saturday 8am at the trailhead. The lot fills by 8:30 so don\'t be late. Bring layers, it\'s foggy until noon.\n\nPriya', 2, { read: 0 }),
    E('acc-gmail-1', 'Vikram Patel', 'vikram.p@gmail.com', 'Fantasy league draft date', 'Draft is Aug 24 at 7pm. Same keeper rules as last year.', 'Draft night is set: August 24, 7pm, my place or online.\n\nSame keeper rules as last year. You still owe the league $50 from last season by the way.\n\nVik', 4, { read: 1 }),
    E('acc-gmail-1', 'Nextdoor', 'reply@nextdoor.com', 'New post in your neighborhood: Street repaving schedule', 'Montclair Ave repaving starts Monday. Street parking restricted.', 'A neighbor posted: Montclair Ave repaving starts Monday July 21. No street parking 7am-5pm through Thursday. Cars will be towed.', 3, { read: 1 }),
    E('acc-yahoo-1', 'Arjun Patel', 'arjun.patel92@yahoo.com', 'Flights booked for the reunion', 'Landing Friday 6pm. Can you pick me up or should I get a car?', 'Booked my flights for the reunion weekend - landing Friday 6:05pm at OAK, Southwest 1182.\n\nCan you grab me from the airport or should I just get a car?\n\nArjun', 1, { read: 0 }),

    // --- Receipts ---
    E('acc-gmail-1', 'Amazon', 'auto-confirm@amazon.com', 'Your order has shipped: running shoes + 2 items', 'Your package with Brooks Ghost 16 and 2 other items has shipped.', 'Your order #114-8823941 has shipped.\n\nItems: Brooks Ghost 16 (size 10.5), foam roller, electrolyte tablets.\nArriving: Tuesday, July 22.\nTotal: $164.83', 1, { att: [{ name: 'order-receipt.pdf', type: 'pdf' }], read: 1 }),
    E('acc-gmail-1', 'Uber Receipts', 'receipts@uber.com', 'Your Friday night trip receipt', 'Thanks for riding. Total: $23.47 including tip.', 'Trip receipt\n\nJuly 18, 10:42pm - Downtown to Montclair\nBase + distance: $19.47\nTip: $4.00\nTotal: $23.47 charged to Visa ****4421', 2, { read: 1 }),
    E('acc-gmail-1', 'DoorDash', 'no-reply@doordash.com', 'Order confirmed: Thai Basil Kitchen', 'Your order is confirmed. Estimated delivery 7:35pm. Total $42.18.', 'Order confirmation\n\nThai Basil Kitchen - estimated delivery 7:35pm.\nPad see ew, green curry, spring rolls.\nTotal: $42.18', 0, { read: 1 }),
    E('acc-yahoo-1', 'REI Co-op', 'orders@rei.com', 'Order confirmation and receipt #R-77821', 'Thanks for your order! Trekking poles and a water filter, total $148.90.', 'Order confirmation #R-77821\n\nTrekking poles (pair): $99.95\nSawyer water filter: $39.95\nMember dividend applied.\nTotal: $148.90\n\nPickup at Berkeley store from Wednesday.', 5, { att: [{ name: 'receipt-77821.pdf', type: 'pdf' }], read: 1 }),
    E('acc-gmail-1', 'Apple', 'no_reply@email.apple.com', 'Your receipt from Apple', 'Receipt for iCloud+ 2TB storage plan: $9.99.', 'Receipt\n\niCloud+ with 2TB storage - monthly\nBilled to Visa ****4421: $9.99\nDate: July 15, 2026', 5, { read: 1 }),
    E('acc-outlook-1', 'Delta Air Lines', 'receipts@delta.com', 'Your eTicket receipt - OAK to AUS', 'Confirmation #GH8L2K. Flight to Austin Sept 4-7, total $412.60.', 'eTicket receipt\n\nConfirmation: GH8L2K\nOAK-AUS Sept 4, return Sept 7\nMain cabin: $412.60 charged to Amex ****1002\n\nCheck in 24 hours before departure.', 7, { att: [{ name: 'eticket.pdf', type: 'pdf' }], read: 1 }),

    // --- Subscriptions ---
    E('acc-gmail-1', 'Netflix', 'info@account.netflix.com', 'Your subscription price is changing', 'Your plan will change from $15.49 to $17.99 starting August 15.', 'We\'re updating the price of your plan.\n\nStandard plan: $15.49 -> $17.99/month effective August 15, 2026.\n\nNo action needed to keep your subscription.', 2, { unsub: 'https://netflix.com/account/unsubscribe', read: 0 }),
    E('acc-gmail-1', 'Spotify', 'no-reply@spotify.com', 'Your Premium receipt', 'Spotify Premium Duo: $14.99 was charged on July 16.', 'Your Spotify Premium Duo subscription renewed.\n\n$14.99 charged July 16 to Visa ****4421.\nNext billing date: August 16.', 4, { unsub: 'https://spotify.com/account', read: 1, cat: 'subscriptions' }),
    E('acc-gmail-3', 'UpToDate', 'renewals@uptodate.com', 'Your subscription renews in 14 days', 'Your UpToDate clinical subscription auto-renews Aug 2 at $559/year.', 'Your UpToDate individual subscription auto-renews on August 2, 2026 at $559.00/year.\n\nTo change your renewal settings, visit your account page.', 5, { unsub: 'https://uptodate.com/account/renewal', read: 0 }),
    E('acc-yahoo-1', 'Audible', 'donotreply@audible.com', '1 credit added to your account', 'Your monthly membership renewed - 1 credit added. $14.95 charged.', 'Your Audible membership renewed.\n\n1 credit added. $14.95 charged to Visa ****4421.\nYou now have 4 unused credits - consider pausing your membership?', 6, { unsub: 'https://audible.com/account/cancel', read: 1, cat: 'subscriptions' }),
    E('acc-outlook-1', 'Adobe', 'mail@adobe.com', 'Your trial ends in 3 days', 'Your Lightroom trial ends July 23. You\'ll be charged $11.99/mo unless you cancel.', 'Your Adobe Lightroom free trial ends July 23, 2026.\n\nAfter that you\'ll be charged $11.99/month. Cancel anytime before the trial ends to avoid charges.', 1, { unsub: 'https://adobe.com/account/plans', read: 0 }),

    // --- Newsletters ---
    E('acc-gmail-1', 'Morning Brew', 'crew@morningbrew.com', 'Fed holds rates, markets shrug', 'Today: the Fed holds steady, chip stocks rally, and the housing market does a thing.', 'MORNING BREW - July 20\n\nMarkets: The Fed held rates steady and markets mostly shrugged. Chip stocks rallied on export news.\n\nHousing: Inventory finally ticking up in major metros...\n\n(unsubscribe anytime)', 0, { unsub: 'https://morningbrew.com/unsubscribe?u=88', read: 0 }),
    E('acc-gmail-1', 'Morning Brew', 'crew@morningbrew.com', 'The weekend edition: AI eats the call center', 'This weekend: AI call centers, olive oil prices, and a very good dog.', 'MORNING BREW WEEKEND\n\nDeep dive: AI is quietly taking over customer support, and the results are mixed...\n\n(unsubscribe anytime)', 1, { unsub: 'https://morningbrew.com/unsubscribe?u=88', read: 1 }),
    E('acc-gmail-3', 'NEJM Journal Watch', 'alerts@jwatch.org', 'This week in cardiology: 5 studies worth your time', 'New evidence on SGLT2 inhibitors, plus a surprising statin adherence study.', 'JOURNAL WATCH CARDIOLOGY\n\n1. SGLT2 inhibitors in HFpEF: new subgroup analysis...\n2. Statin adherence and telehealth follow-up...\n\nUnsubscribe from these alerts in your preferences.', 2, { unsub: 'https://jwatch.org/prefs', read: 0 }),
    E('acc-gmail-3', 'Medscape', 'news@medscape.com', 'Daily brief: burnout survey results are in', 'Physician burnout numbers improved slightly for the first time in 6 years.', 'MEDSCAPE DAILY\n\nPhysician burnout: 2026 survey shows the first improvement in six years, driven by scheduling flexibility...\n\nManage email preferences to unsubscribe.', 3, { unsub: 'https://medscape.com/prefs', read: 1 }),
    E('acc-yahoo-1', 'The Athletic', 'newsletter@theathletic.com', 'Warriors offseason grades are here', 'Grading every offseason move, plus training camp storylines.', 'THE ATHLETIC NBA\n\nWarriors offseason grades: the front office gets a B-...\n\nUnsubscribe from this newsletter in settings.', 2, { unsub: 'https://theathletic.com/unsubscribe', read: 1 }),
    E('acc-yahoo-1', 'Serious Eats', 'newsletter@seriouseats.com', 'The only grilling guide you need this summer', 'Charcoal vs gas (settled), plus 12 marinades that actually work.', 'SERIOUS EATS WEEKLY\n\nWe settled the charcoal vs gas debate with a blind taste test, and the results...\n\nUnsubscribe link at the bottom as always.', 4, { unsub: 'https://seriouseats.com/unsubscribe', read: 0 }),
    E('acc-gmail-1', 'Strava', 'no-reply@strava.com', 'Your weekly progress: 24.8 miles', 'You ran 24.8 miles last week, up 12% from the week before.', 'YOUR WEEK IN SPORT\n\nRunning: 24.8 miles (+12%)\nLongest run: 9.2 miles\nYou\'re ranked 3rd among friends this week.\n\nManage notification settings to unsubscribe.', 1, { unsub: 'https://strava.com/settings/email', read: 1 }),

    // --- Spam / junk ---
    E('acc-yahoo-1', 'Prize Notification Center', 'winner@lucky-draw-intl.info', 'CONGRATULATIONS! You have won $2,500,000 USD', 'You have been selected as a winner in the international email lottery.', 'CONGRATULATIONS!!!\n\nYour email address was selected as a WINNER of $2,500,000.00 USD in the International Email Lottery. To claim, reply with your full name, address, and bank details.', 3, { spam: 1, read: 0 }),
    E('acc-yahoo-1', 'Crypto Wealth Signals', 'noreply@cryptowealth-signals.biz', 'Last chance: 100x altcoin picks inside', 'Our members made 4,000% last month. Join before midnight.', 'Our private signal group returned 4,000% last month. This is your LAST CHANCE to join at the discounted rate before midnight. Limited to 50 spots.', 5, { spam: 1, unsub: 'https://cryptowealth-signals.biz/unsub', read: 0 }),
    E('acc-gmail-1', 'Warranty Services', 'renew@auto-warranty-final.net', 'FINAL NOTICE: Your car warranty is expiring', 'We have been trying to reach you about your car\'s extended warranty.', 'FINAL NOTICE\n\nWe\'ve been trying to reach you concerning your vehicle\'s extended warranty. Coverage expires soon. Call now to avoid costly repairs.', 7, { spam: 1, read: 0 }),
    E('acc-outlook-1', 'HR Dept', 'payroll-update@secure-docs-portal.click', 'Action required: verify your direct deposit', 'Your payroll profile requires immediate verification to avoid deposit delay.', 'Your payroll profile requires verification. Click the secure link below within 24 hours to avoid a delay in your next direct deposit.\n\n[Suspicious link removed]', 2, { spam: 1, read: 0 }),

    // --- More mixed recent mail to round out 50 ---
    E('acc-gmail-3', 'Dr. Sarah Chen', 'sarah.chen@medgroup.org', 'Slides from grand rounds', 'Attached are the slides from this morning. Great questions today.', 'Attached are the slides from this morning\'s grand rounds. Great questions from you today - the point about anticoagulation timing sparked a good hallway debate.\n\nSarah', 3, { att: [{ name: 'grand-rounds.pptx', type: 'document' }], read: 1 }),
    E('acc-gmail-1', 'Airbnb', 'automated@airbnb.com', 'Your reservation is confirmed - Tahoe cabin', 'Aug 8-10 at Tahoe Donner cabin. Total $624.18. Check-in 4pm.', 'Reservation confirmed!\n\nTahoe Donner A-frame cabin\nAug 8-10, 2 nights, 4 guests\nTotal: $624.18\nCheck-in: 4pm, self check-in with keypad.', 6, { att: [{ name: 'itinerary.pdf', type: 'pdf' }], read: 1 }),
    E('acc-outlook-1', 'LinkedIn', 'messages-noreply@linkedin.com', 'You have 3 new messages and 12 profile views', 'A recruiter from Kaiser and 2 others sent you messages this week.', 'You have new activity:\n\n3 new messages, including one from a Kaiser Permanente recruiter about a Medical Director role.\n12 people viewed your profile.\n\nManage email frequency in settings.', 2, { unsub: 'https://linkedin.com/settings/email', read: 0 }),
    E('acc-gmail-1', 'CVS Pharmacy', 'pharmacy@cvs.com', 'Your prescription is ready for pickup', 'Rx #2231 is ready at CVS Montclair. Pickup by July 27.', 'Your prescription (Rx #2231) is ready for pickup at CVS Montclair, 2077 Mountain Blvd.\n\nPlease pick up by July 27 or it will be returned to stock.', 0, { read: 0 }),
    E('acc-gmail-1', 'Priya Sharma', 'priya.sharma88@gmail.com', 'Photos from last weekend', 'Finally sorted the photos from the coast trip - the sunset ones came out great.', 'Finally sorted through the photos from the coast trip. The sunset ones from Pescadero came out incredible - attached my favorites, full album link inside.\n\nPriya', 5, { att: [{ name: 'sunset-01.jpg', type: 'image' }, { name: 'sunset-02.jpg', type: 'image' }], read: 1 }),
  ];

  const insEmail = db.prepare(`INSERT INTO emails
    (id, account_id, subject, from_email, from_name, to_email, body_preview, body_full, date,
     is_read, is_starred, is_spam, category, priority, action_required, has_attachment,
     attachment_types, attachments, list_unsubscribe, message_id, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const accEmail = Object.fromEntries(accounts.map(a => [a.id, a.email]));
  const now = Date.now();
  seed.forEach((e, i) => {
    const date = new Date(now - e.daysAgo * 86400e3 - (i % 12) * 3600e3 - (i * 7 % 60) * 60e3).toISOString();
    const action = detectActionRequired(e.subject, e.body) && !e.spam ? 1 : 0;
    const category = e.spam ? null : (e.cat || detectCategory(e.subject, e.body, e.from_email, !!e.unsub));
    const att = e.att || [];
    const types = [...new Set(att.map(a => a.type))];
    const starred = ['sarah.chen@medgroup.org', 'mom.patel@gmail.com'].includes(e.from_email) && i % 3 === 0 ? 1 : 0;
    insEmail.run(
      uid(), e.acc, e.subject, e.from_email, e.from_name, accEmail[e.acc],
      e.preview, e.body, date,
      e.read ?? 0, starred, e.spam ? 1 : 0, category,
      action ? 'high' : 'normal', action,
      att.length ? 1 : 0, JSON.stringify(types),
      JSON.stringify(att.map(a => ({ ...a, size: 40000 + (i * 13791) % 900000 }))),
      e.unsub || null, `<msg-${i + 1}@demo.local>`, `thread-${Math.floor(i / 2)}`
    );
  });

  // A saved filter preset to demo the feature
  db.prepare('INSERT INTO filter_presets (id, name, filter_config) VALUES (?, ?, ?)').run(
    uid(), 'Unread bills with PDFs',
    JSON.stringify({ action_required: true, is_read: false, attachment_type: 'pdf', logic: 'AND' })
  );

  refreshCategoryCounts();
  console.log(`Seeded database with ${seed.length} demo emails across ${accounts.length} accounts.`);
  return true;
}

function refreshCategoryCounts() {
  db.exec(`UPDATE categories SET email_count =
    (SELECT COUNT(*) FROM emails e WHERE e.category = categories.name AND e.is_spam = 0 AND e.is_deleted = 0 AND e.is_archived = 0)`);
}

module.exports = { db, uid, seedIfEmpty, detectActionRequired, detectCategory, refreshCategoryCounts, ACTION_KEYWORDS };
