/* Physician Dashboard — vanilla JS SPA */
(() => {
  const view = document.getElementById('view');
  const toastEl = document.getElementById('toast');
  let currentTab = 'inbox';
  let emailFilter = 'all';

  /* ---------- helpers ---------- */
  const api = async (url, opts = {}) => {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    return res.json();
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyShort = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  let toastTimer;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
  };
  const relTime = (isoStr) => {
    const d = new Date(isoStr);
    const now = new Date();
    const mins = Math.round((now - d) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    const days = Math.round(mins / (60 * 24));
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const fmtTime = (isoStr) => new Date(isoStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  document.getElementById('topbarDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      currentTab = btn.dataset.tab;
      render();
    });
  });

  async function refreshBadge() {
    try {
      const { unreadTotal } = await api('/api/emails/summary');
      const badge = document.getElementById('inboxBadge');
      badge.hidden = !unreadTotal;
      badge.textContent = unreadTotal;
    } catch { /* offline */ }
  }

  function render() {
    view.innerHTML = '<div class="empty">Loading…</div>';
    ({ inbox: renderInbox, calendar: renderCalendar, finance: renderFinance, availability: renderAvailability })[currentTab]();
  }

  /* ---------- Inbox ---------- */
  const CAT_LABELS = { clinical: 'Clinical', admin: 'Admin', cme: 'CME', financial: 'Financial', opportunities: 'Job Offers', personal: 'Personal', other: 'Other' };

  async function renderInbox() {
    const [summary, emails] = await Promise.all([
      api('/api/emails/summary'),
      api(`/api/emails?category=${emailFilter}`),
    ]);
    const counts = Object.fromEntries(summary.categories.map((c) => [c.category, c]));
    const chips = ['all', ...Object.keys(CAT_LABELS).filter((k) => counts[k])];

    view.innerHTML = `
      <div class="section-title">Inbox — organized for you</div>
      <div class="chips">
        ${chips.map((c) => `
          <button class="chip ${emailFilter === c ? 'active' : ''}" data-cat="${c}">
            ${c === 'all' ? 'All' : esc(CAT_LABELS[c])}
            ${c !== 'all' && counts[c]?.unread ? `<span class="count">${counts[c].unread}</span>` : ''}
          </button>`).join('')}
      </div>
      <div id="emailList">
        ${emails.length ? emails.map(emailCard).join('') : '<div class="empty">No email here. Enjoy the quiet.</div>'}
      </div>`;

    view.querySelectorAll('.chip').forEach((chip) =>
      chip.addEventListener('click', () => { emailFilter = chip.dataset.cat; renderInbox(); }));
    view.querySelectorAll('.email').forEach((el) =>
      el.addEventListener('click', () => openEmail(Number(el.dataset.id), emails)));
  }

  function emailCard(e) {
    return `
      <div class="email ${e.is_read ? '' : 'unread'}" data-id="${e.id}">
        <div class="email-avatar">${esc(initials(e.sender))}</div>
        <div class="email-main">
          <div class="email-top">
            <span class="email-sender">${esc(e.sender)}</span>
            <span class="email-time">${relTime(e.received_at)}</span>
          </div>
          <div class="email-subject">${esc(e.subject)}</div>
          <div class="email-preview">${esc(e.preview)}</div>
          <div class="email-tags">
            <span class="tag tag-${esc(e.category)}">${esc(CAT_LABELS[e.category] || e.category)}</span>
            ${e.priority === 'high' ? '<span class="tag tag-high">High priority</span>' : ''}
          </div>
        </div>
      </div>`;
  }

  async function openEmail(id, emails) {
    const e = emails.find((x) => x.id === id);
    if (!e) return;
    if (!e.is_read) { api(`/api/emails/${id}`, { method: 'PATCH', body: { is_read: 1 } }).then(refreshBadge); e.is_read = 1; }
    view.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="backBtn">&larr; Back to inbox</button>
      <div class="card" style="margin-top:12px">
        <div class="email-tags" style="margin-bottom:10px">
          <span class="tag tag-${esc(e.category)}">${esc(CAT_LABELS[e.category] || e.category)}</span>
          ${e.priority === 'high' ? '<span class="tag tag-high">High priority</span>' : ''}
        </div>
        <h2 style="font-size:18px;margin-bottom:6px">${esc(e.subject)}</h2>
        <div class="row-sub">${esc(e.sender)} &lt;${esc(e.sender_email)}&gt; · ${relTime(e.received_at)}</div>
        <div class="detail-actions">
          <button class="btn btn-sm" id="archiveBtn">Archive</button>
          <button class="btn btn-sm" id="unreadBtn">Mark unread</button>
        </div>
        <div class="email-body">${esc(e.body)}</div>
      </div>`;
    document.getElementById('backBtn').onclick = renderInbox;
    document.getElementById('archiveBtn').onclick = async () => {
      await api(`/api/emails/${id}`, { method: 'PATCH', body: { is_archived: 1 } });
      toast('Archived'); refreshBadge(); renderInbox();
    };
    document.getElementById('unreadBtn').onclick = async () => {
      await api(`/api/emails/${id}`, { method: 'PATCH', body: { is_read: 0 } });
      toast('Marked unread'); refreshBadge(); renderInbox();
    };
  }

  /* ---------- Calendar ---------- */
  async function renderCalendar() {
    const [events, sources] = await Promise.all([api('/api/calendar/events'), api('/api/calendar/sources')]);
    const upcoming = events.filter((e) => new Date(e.end_time) >= new Date(Date.now() - 86400000));
    const byDay = {};
    for (const e of upcoming) {
      const key = new Date(e.start_time).toDateString();
      (byDay[key] ||= []).push(e);
    }
    const todayKey = new Date().toDateString();

    view.innerHTML = `
      <div class="two-col">
        <div>
          <div class="section-title">Upcoming</div>
          ${Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => `
            <div class="day-group">
              <div class="day-head ${day === todayKey ? 'today' : ''}">
                <span class="dow">${day === todayKey ? 'Today' : new Date(day).toLocaleDateString(undefined, { weekday: 'long' })}</span>
                <span class="dnum">${new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              ${list.map((e) => `
                <div class="event">
                  <div class="event-stripe stripe-${esc(e.category)}"></div>
                  <div class="event-main">
                    <div class="event-title">${esc(e.title)}</div>
                    <div class="event-meta">${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}${e.location ? ' · ' + esc(e.location) : ''}</div>
                  </div>
                  <button class="event-del" data-id="${e.id}" title="Delete">&times;</button>
                </div>`).join('')}
            </div>`).join('') : '<div class="empty">Nothing scheduled.</div>'}
        </div>
        <div>
          <div class="section-title">Synced calendars</div>
          <div class="card">
            ${sources.map((s) => `
              <div class="row source-pill">
                <div class="source-info">
                  <div class="source-logo">${s.provider === 'google' ? 'G' : s.provider === 'apple' ? '&#63743;' : 'O'}</div>
                  <div>
                    <div class="row-title">${esc(s.name)}</div>
                    <div class="row-sub"><span class="dot ${s.connected ? 'on' : 'off'}"></span>${s.connected ? 'Connected' : 'Not connected'} · ${esc(s.provider)}</div>
                  </div>
                </div>
                <button class="btn btn-sm ${s.connected ? '' : 'btn-primary'}" data-src="${s.id}">${s.connected ? 'Disconnect' : 'Connect'}</button>
              </div>`).join('')}
            <div class="avail-hint">Demo connections — OAuth for Google / Apple / Outlook plugs in here.</div>
          </div>

          <div class="section-title">Add event</div>
          <div class="card form-grid">
            <div><label>Title</label><input id="evTitle" placeholder="e.g. Clinic block" /></div>
            <div class="form-2col">
              <div><label>Date</label><input id="evDate" type="date" /></div>
              <div><label>Category</label>
                <select id="evCat">
                  <option value="clinical">Clinical</option>
                  <option value="education">Education</option>
                  <option value="admin">Admin</option>
                  <option value="personal">Personal</option>
                </select>
              </div>
            </div>
            <div class="form-2col">
              <div><label>Start</label><input id="evStart" type="time" value="09:00" /></div>
              <div><label>End</label><input id="evEnd" type="time" value="10:00" /></div>
            </div>
            <div><label>Location (optional)</label><input id="evLoc" placeholder="Where" /></div>
            <button class="btn btn-primary btn-block" id="evAdd">Add to calendar</button>
          </div>
        </div>
      </div>`;

    document.getElementById('evDate').value = new Date().toISOString().slice(0, 10);
    view.querySelectorAll('.event-del').forEach((b) =>
      b.addEventListener('click', async () => {
        await api(`/api/calendar/events/${b.dataset.id}`, { method: 'DELETE' });
        toast('Event removed'); renderCalendar();
      }));
    view.querySelectorAll('[data-src]').forEach((b) =>
      b.addEventListener('click', async () => {
        const s = await api(`/api/calendar/sources/${b.dataset.src}/toggle`, { method: 'POST' });
        toast(s.connected ? `${s.name} connected` : `${s.name} disconnected`);
        renderCalendar();
      }));
    document.getElementById('evAdd').onclick = async () => {
      const title = document.getElementById('evTitle').value.trim();
      const date = document.getElementById('evDate').value;
      const start = document.getElementById('evStart').value;
      const end = document.getElementById('evEnd').value;
      if (!title || !date || !start || !end) return toast('Fill in title, date, and times');
      await api('/api/calendar/events', {
        method: 'POST',
        body: {
          title,
          location: document.getElementById('evLoc').value.trim(),
          category: document.getElementById('evCat').value,
          start_time: new Date(`${date}T${start}`).toISOString(),
          end_time: new Date(`${date}T${end}`).toISOString(),
        },
      });
      toast('Event added'); renderCalendar();
    };
  }

  /* ---------- Finance ---------- */
  async function renderFinance() {
    const [overview, txs] = await Promise.all([api('/api/finance/overview'), api('/api/finance/transactions')]);
    const { accounts, netWorth, month } = overview;
    const maxCat = Math.max(...month.byCategory.map((c) => c.total), 1);
    const typeLabel = { checking: 'Checking', savings: 'Savings', investment: 'Investments', credit: 'Credit card' };

    view.innerHTML = `
      <div class="section-title">This month</div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Net worth</div><div class="stat-value">${moneyShort(netWorth)}</div></div>
        <div class="stat"><div class="stat-label">Income</div><div class="stat-value pos">${moneyShort(month.income)}</div></div>
        <div class="stat"><div class="stat-label">Spending</div><div class="stat-value neg">${moneyShort(month.spending)}</div></div>
        <div class="stat"><div class="stat-label">Net</div><div class="stat-value ${month.income - month.spending >= 0 ? 'pos' : 'neg'}">${moneyShort(month.income - month.spending)}</div></div>
      </div>

      <div class="two-col" style="margin-top:16px">
        <div>
          <div class="section-title">Accounts</div>
          <div class="card">
            ${accounts.map((a) => `
              <div class="row">
                <div class="row-main">
                  <div class="row-title">${esc(a.name)}</div>
                  <div class="row-sub">${esc(a.institution)} · ${typeLabel[a.type] || a.type}</div>
                </div>
                <div class="row-val ${a.balance >= 0 ? '' : 'neg'}" style="${a.balance < 0 ? 'color:var(--red)' : ''}">${money(a.balance)}</div>
              </div>`).join('')}
            <button class="btn btn-block btn-sm" id="plaidBtn" style="margin-top:10px">+ Connect a bank (Plaid-ready)</button>
          </div>

          <div class="section-title">Spending by category</div>
          <div class="card">
            ${month.byCategory.map((c) => `
              <div class="bar-row">
                <div class="bar-top"><span class="cat">${esc(c.category)}</span><span>${moneyShort(c.total)}</span></div>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.round((c.total / maxCat) * 100)}%"></div></div>
              </div>`).join('') || '<div class="empty">No spending yet this month.</div>'}
          </div>
        </div>
        <div>
          <div class="section-title">Recent transactions</div>
          <div class="card">
            ${txs.slice(0, 12).map((t) => `
              <div class="row">
                <div class="row-main">
                  <div class="row-title">${esc(t.description)}</div>
                  <div class="row-sub">${esc(t.account_name)} · ${new Date(t.date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                </div>
                <div class="row-val ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : ''}${money(t.amount)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;

    document.getElementById('plaidBtn').onclick = () =>
      toast('Demo mode — wire up Plaid Link here for live bank data');
  }

  /* ---------- Availability ---------- */
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SLOTS = ['morning', 'afternoon', 'evening', 'overnight'];
  const SLOT_HDR = { morning: 'AM', afternoon: 'PM', evening: 'Eve', overnight: 'Night' };
  const CYCLE = { unavailable: 'available', available: 'preferred', preferred: 'unavailable' };

  async function renderAvailability() {
    const [avail, shifts] = await Promise.all([api('/api/availability'), api('/api/availability/shifts')]);
    const grid = {};
    avail.forEach((a) => (grid[`${a.day_of_week}-${a.slot}`] = a.status));

    view.innerHTML = `
      <div class="two-col">
        <div>
          <div class="section-title">Weekly availability</div>
          <div class="card">
            <div class="avail-legend">
              <span><span class="dot pref"></span>Preferred</span>
              <span><span class="dot avail"></span>Available</span>
              <span><span class="dot unavail"></span>Unavailable</span>
            </div>
            <div class="avail-grid">
              <div></div>
              ${SLOTS.map((s) => `<div class="hdr">${SLOT_HDR[s]}</div>`).join('')}
              ${DOW.map((d, di) => `
                <div class="dow">${d}</div>
                ${SLOTS.map((s) => {
                  const st = grid[`${di}-${s}`] || 'unavailable';
                  return `<button class="avail-cell ${st}" data-day="${di}" data-slot="${s}" aria-label="${d} ${s}: ${st}"></button>`;
                }).join('')}`).join('')}
            </div>
            <div class="avail-hint">Tap a cell to cycle: unavailable &rarr; available &rarr; preferred. Saves instantly — share this with your scheduler.</div>
          </div>
        </div>
        <div>
          <div class="section-title">Shift offers &amp; bookings</div>
          ${shifts.map((sh) => `
            <div class="card">
              <div class="row" style="border:none;padding:0">
                <div class="row-main">
                  <div class="row-title">${esc(sh.facility)}</div>
                  <div class="row-sub">${esc(sh.role)} · ${new Date(sh.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${sh.start_time}–${sh.end_time}${sh.rate ? ` · $${sh.rate}/hr` : ''}</div>
                </div>
                <span class="shift-status st-${sh.status}">${sh.status}</span>
              </div>
              ${sh.status === 'open' ? `
                <div class="detail-actions" style="margin:10px 0 0">
                  <button class="btn btn-sm btn-success" data-shift="${sh.id}" data-st="requested">Request shift</button>
                  <button class="btn btn-sm btn-danger" data-shift="${sh.id}" data-st="declined">Pass</button>
                </div>` : ''}
              ${sh.status === 'requested' ? `
                <div class="detail-actions" style="margin:10px 0 0">
                  <button class="btn btn-sm" data-shift="${sh.id}" data-st="open">Withdraw request</button>
                </div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;

    view.querySelectorAll('.avail-cell').forEach((cell) =>
      cell.addEventListener('click', async () => {
        const day = Number(cell.dataset.day);
        const slot = cell.dataset.slot;
        const current = SLOTS && (cell.classList.contains('preferred') ? 'preferred' : cell.classList.contains('available') ? 'available' : 'unavailable');
        const next = CYCLE[current];
        cell.classList.remove('preferred', 'available', 'unavailable');
        cell.classList.add(next);
        await api('/api/availability', { method: 'PUT', body: { day_of_week: day, slot, status: next } });
      }));

    view.querySelectorAll('[data-shift]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api(`/api/availability/shifts/${b.dataset.shift}/status`, { method: 'POST', body: { status: b.dataset.st } });
        toast(b.dataset.st === 'requested' ? 'Shift requested' : b.dataset.st === 'declined' ? 'Shift declined' : 'Request withdrawn');
        renderAvailability();
      }));
  }

  /* ---------- boot ---------- */
  refreshBadge();
  render();
})();
