// Hourly email sweep: fetches new mail (demo: simulates it), detects
// important emails (bills / tax / urgent / VIP / action items), records
// notifications without duplicating, and logs every sweep to sweep_log.
const { db, uid, insertEmail } = require('../db');

// Demo mode simulates 1-2 fresh emails per sweep so the notification flow is
// always demonstrable. Set DEMO_MODE=false to sweep existing mail only
// (production would sync from the real providers here instead).
const DEMO_MODE = process.env.DEMO_MODE !== 'false';

// Rotating pool of realistic "new arrival" templates used in demo mode.
const DEMO_POOL = [
  { acc: 'acc-gmail-2', from_name: 'American Express', from_email: 'alerts@americanexpress.com',
    subject: 'Your statement is ready - payment due soon',
    preview: 'Statement balance: $912.44. Minimum payment due in 10 days.',
    body: 'Your American Express statement is ready.\n\nStatement balance: $912.44\nMinimum payment due: $40.00\n\nSchedule a payment to avoid late fees.' },
  { acc: 'acc-gmail-2', from_name: 'Raj Mehta CPA', from_email: 'raj.mehta@cpafirm.com',
    subject: 'Signed 1099 needed - deadline approaching',
    preview: 'Need your signed 1099 consent form back by end of week for the tax filing.',
    body: 'Hi Anesh,\n\nQuick reminder - I still need your signed 1099 consent form back by Friday to keep the amended filing on schedule with the IRS.\n\nTwo minutes with a pen, that\'s all.\n\nRaj' },
  { acc: 'acc-gmail-3', from_name: 'Dr. Sarah Chen', from_email: 'sarah.chen@medgroup.org',
    subject: 'Urgent: coverage needed for tomorrow morning',
    preview: 'Dr. Okafor called out sick - can you cover the 8am clinic block tomorrow?',
    body: 'Anesh,\n\nDr. Okafor called out sick. Can you cover the 8am-noon clinic block tomorrow? Need an answer tonight so I can arrange the schedule.\n\nSarah' },
  { acc: 'acc-outlook-1', from_name: 'Med Group Credentialing', from_email: 'credentialing@medgroup.org',
    subject: 'Action required: license renewal expires in 30 days',
    preview: 'Your medical license renewal must be completed before August 20.',
    body: 'Action required\n\nOur records show your state medical license expires August 20, 2026. Renewal must be completed and documentation uploaded before that date to avoid a lapse in privileges.' },
  { acc: 'acc-gmail-2', from_name: 'City of Oakland', from_email: 'tax@oaklandca.gov',
    subject: 'Reminder: property tax payment due - avoid penalty',
    preview: 'Your property tax installment is due soon. Late payments incur a 10% penalty.',
    body: 'This is a courtesy reminder that your property tax installment of $3,120.00 is due August 10, 2026. Payments received after the deadline incur a 10% penalty.' },
  { acc: 'acc-gmail-1', from_name: 'Amazon.com', from_email: 'auto-confirm@amazon.com',
    subject: 'Your Amazon.com order has been confirmed',
    preview: 'Order confirmation: household restock. Arriving in two days.',
    body: 'Thank you for your order.\n\nOrder #112-9931004\n- Paper towels (12-pack)\n- Dish soap refill\n\nTotal: $31.48. Arriving in two days.' },
  { acc: 'acc-gmail-1', from_name: 'Amazon.com', from_email: 'refunds@amazon.com',
    subject: 'Your refund has been issued',
    preview: 'Refund of $19.99 issued for the item you returned.',
    body: 'We processed your refund of $19.99 for the item you returned (phone case). Please allow 3-5 business days.\n\nReturn status: complete.' },
  { acc: 'acc-outlook-1', from_name: 'DocuSign', from_email: 'dse@docusign.net',
    subject: 'Approval needed: consulting agreement awaiting your signature',
    preview: 'James Liu sent you the telehealth consulting agreement to sign.',
    body: 'James Liu has sent you a document to review and sign: Telehealth Consulting Agreement v3.\n\nPlease confirm and sign at your earliest convenience - the client wants countersignatures this week.' },
];
let demoIndex = 0;

// Simulate provider sync: insert 1-2 new emails from the rotating pool.
function simulateNewEmails() {
  const count = 1 + Math.floor(Math.random() * 2);
  const created = [];
  for (let i = 0; i < count; i++) {
    const t = DEMO_POOL[demoIndex % DEMO_POOL.length];
    demoIndex++;
    const stamp = Date.now() + i;
    const id = insertEmail({
      ...t,
      to_email: null,
      date: new Date().toISOString(),
      read: 0,
      message_id: `<sweep-${stamp}@demo.local>`,
      thread_id: `thread-sweep-${stamp}`,
    });
    created.push(id);
  }
  return created;
}

// One sweep pass. Returns a summary object (also logged to sweep_log).
function runSweep({ simulate = DEMO_MODE } = {}) {
  const newIds = simulate ? simulateNewEmails() : [];

  // All candidate emails in active mail (unread, not spam/deleted/archived)
  const candidates = db.prepare(`SELECT e.id, e.important, e.important_types, e.from_email
    FROM emails e
    WHERE e.is_deleted = 0 AND e.is_spam = 0 AND e.is_archived = 0 AND e.is_read = 0`).all();

  const vips = new Set(db.prepare('SELECT sender_email FROM vip_list').all().map(r => r.sender_email));
  const important = candidates.filter(e => e.important || vips.has((e.from_email || '').toLowerCase()));

  // Don't notify twice about the same email
  const alreadyNotified = new Set(db.prepare(
    "SELECT email_id FROM notifications_sent WHERE notification_type = 'dashboard'").all().map(r => r.email_id));
  const fresh = important.filter(e => !alreadyNotified.has(e.id));

  const ins = db.prepare('INSERT INTO notifications_sent (id, email_id, notification_type) VALUES (?, ?, ?)');
  for (const e of fresh) ins.run(uid(), e.id, 'dashboard');

  db.prepare('INSERT INTO sweep_log (id, emails_checked, important_found, notifications_sent) VALUES (?, ?, ?, ?)')
    .run(uid(), candidates.length, important.length, fresh.length);

  const summary = {
    swept_at: new Date().toISOString(),
    new_emails: newIds.length,
    emails_checked: candidates.length,
    important_found: important.length,
    notifications_sent: fresh.length,
  };
  console.log(`[sweep] checked ${summary.emails_checked}, important ${summary.important_found}, new notifications ${summary.notifications_sent}`);
  return summary;
}

// Run once at startup, then every hour on the hour.
function startSweeper() {
  runSweep();
  const msToNextHour = 3600e3 - (Date.now() % 3600e3);
  setTimeout(() => {
    runSweep();
    setInterval(runSweep, 3600e3);
  }, msToNextHour);
  console.log(`[sweep] hourly sweeper started (next run in ${Math.round(msToNextHour / 60e3)} min, demo mode: ${DEMO_MODE})`);
}

module.exports = { runSweep, startSweeper, DEMO_MODE };
