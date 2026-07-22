/* Mail Deck - personal email dashboard frontend (React + htm, no build step) */
const { useState, useEffect, useRef, useCallback, useMemo } = React;
const html = htm.bind(React.createElement);

// ------------------------------------------------------------- utilities
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Handles both ISO strings and SQLite "YYYY-MM-DD HH:MM:SS" (UTC) timestamps
function parseTs(ts) {
  if (typeof ts === 'string' && ts.includes(' ') && !ts.endsWith('Z')) return new Date(ts.replace(' ', 'T') + 'Z');
  return new Date(ts);
}

function fmtDate(iso) {
  const d = parseTs(iso);
  const now = new Date();
  const diff = (now - d) / 864e5;
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtSize(bytes) {
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.round(bytes / 1e3) + ' KB';
}

const AVATAR_COLORS = ['#4A9EFF', '#4CAF50', '#FF9800', '#EC407A', '#B388FF', '#26C6DA', '#FFD54F'];
const avatarColor = (s) => AVATAR_COLORS[[...(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = (name, email) => {
  const src = name || email || '?';
  const parts = src.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
};

const ATTACH_ICONS = { pdf: '\u{1F4C4}', image: '\u{1F5BC}️', document: '\u{1F4DD}' };
const EMPTY_FILTERS = {
  sender: '', category: '', is_read: '', is_starred: false, is_vip: false,
  action_required: false, has_attachment: false, attachment_type: '',
  date_from: '', date_to: '', logic: 'AND',
};

const VIEWS = {
  inbox: { label: 'Inbox', icon: '\u{1F4E5}' },
  important: { label: 'Important', icon: '\u{1F525}' },
  vip: { label: 'VIP', icon: '⭐' },
  action: { label: 'Action Items', icon: '\u{1F514}' },
  starred: { label: 'Starred', icon: '\u{1F31F}' },
  drafts: { label: 'Drafts', icon: '✏️' },
  spam: { label: 'Spam', icon: '\u{1F6AB}' },
  archived: { label: 'Archive', icon: '\u{1F4E6}' },
};

const IMP_LABELS = { bill: 'Bill', tax: 'Tax', urgent: 'Urgent', vip: 'VIP', action: 'Action' };
const FOLDER_ICONS = { amazon: '\u{1F4E6}', purchase: '\u{1F6D2}', returns: '↩️' };

// ---------------------------------------------------------------- App
function App() {
  const [view, setView] = useState('inbox');          // view key or 'cat:<name>'
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);     // full email object
  const [checked, setChecked] = useState(new Set());
  const [stats, setStats] = useState(null);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [vips, setVips] = useState([]);
  const [presets, setPresets] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [showFilters, setShowFilters] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');
  const [groupBy, setGroupBy] = useState('');
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [showAccounts, setShowAccounts] = useState(false);
  const [composing, setComposing] = useState(null);   // draft object being edited
  const [dragOverCat, setDragOverCat] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(['folder-amazon']));
  const [notifStatus, setNotifStatus] = useState(null);   // badge counts
  const [alertData, setAlertData] = useState(null);       // important-since-last-check payload
  const [alertHidden, setAlertHidden] = useState(false);
  const [digest, setDigest] = useState(null);             // digest modal payload
  const dragIds = useRef([]);

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.name, c])), [categories]);
  const vipEmails = useMemo(() => new Set(vips.map(v => v.sender_email)), [vips]);

  // ------------------------------------------------------------- loaders
  const loadMeta = useCallback(async () => {
    const [s, c, a, v, p, d, f, ns] = await Promise.all([
      api('/api/stats'), api('/api/categories'), api('/api/accounts'),
      api('/api/vip'), api('/api/filters/presets'), api('/api/drafts'),
      api('/api/folders'), api('/api/notifications/status'),
    ]);
    setStats(s); setCategories(c); setAccounts(a); setVips(v); setPresets(p); setDrafts(d);
    setFolders(f); setNotifStatus(ns);
  }, []);

  const loadEmails = useCallback(async () => {
    if (view === 'drafts') return;
    const params = new URLSearchParams();
    const isCat = view.startsWith('cat:');
    const isFolder = view.startsWith('folder:');
    params.set('view', isCat || isFolder ? 'inbox' : view);
    if (isCat) params.set('category', view.slice(4));
    if (isFolder) params.set('folder_id', view.slice(7));
    if (accountId) params.set('account_id', accountId);
    if (activeSearch) params.set('q', activeSearch);
    params.set('sort', sort); params.set('order', order);
    params.set('logic', filters.logic);
    if (filters.sender) params.set('sender', filters.sender);
    if (filters.category && !isCat) params.set('category', filters.category);
    if (filters.is_read !== '') params.set('is_read', filters.is_read);
    if (filters.is_starred) params.set('is_starred', 'true');
    if (filters.is_vip) params.set('is_vip', 'true');
    if (filters.action_required) params.set('action_required', 'true');
    if (filters.has_attachment) params.set('has_attachment', 'true');
    if (filters.attachment_type) params.set('attachment_type', filters.attachment_type);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    const data = await api(`/api/emails?${params}`);
    setEmails(data.emails); setTotal(data.total);
    setLoading(false);
  }, [view, accountId, activeSearch, sort, order, filters]);

  useEffect(() => { loadMeta().catch(e => toast(e.message, 'error')); }, [loadMeta, toast]);
  useEffect(() => { loadEmails().catch(e => toast(e.message, 'error')); }, [loadEmails, toast]);
  useEffect(() => { setChecked(new Set()); setSidebarOpen(false); }, [view]);

  const refresh = useCallback(() => Promise.all([loadEmails(), loadMeta()]).catch(e => toast(e.message, 'error')),
    [loadEmails, loadMeta, toast]);

  // ------------------------------------------------- notifications & sweep
  const openEmailRef = useRef(null); // set after openEmail is defined

  const loadNotifications = useCallback(async () => {
    try {
      const [imp, status] = await Promise.all([
        api('/api/notifications/important?mark_browser=true'),
        api('/api/notifications/status'),
      ]);
      setAlertData(imp); setNotifStatus(status);
      if (imp.count > 0) setAlertHidden(false);
      // Browser notifications for emails not yet pushed (max 3 per poll)
      if ('Notification' in window && Notification.permission === 'granted') {
        imp.emails.filter(e => e.new_for_browser).slice(0, 3).forEach(e => {
          const type = IMP_LABELS[e.important_types[0]] || 'Important';
          const n = new Notification(`${type}: ${e.from_name || e.from_email}`, {
            body: e.subject, tag: e.id,
          });
          n.onclick = () => { window.focus(); openEmailRef.current?.({ id: e.id, is_read: 0 }); n.close(); };
        });
      }
    } catch { /* server may be restarting; retry next poll */ }
  }, []);

  // Ask for browser notification permission on first load, then poll every 60s
  useEffect(() => {
    const subscribe = () => api('/api/notifications/subscribe', { method: 'POST', body: {} }).catch(() => {});
    if ('Notification' in window) {
      if (Notification.permission === 'granted') subscribe();
      else if (Notification.permission === 'default') {
        setTimeout(() => Notification.requestPermission().then(p => { if (p === 'granted') subscribe(); }), 1200);
      }
    }
    loadNotifications();
    const t = setInterval(loadNotifications, 60000);
    return () => clearInterval(t);
  }, [loadNotifications]);

  const dismissAlerts = useCallback(async (emailIds) => {
    try {
      await api('/api/notifications/dismiss', { method: 'POST', body: emailIds ? { email_ids: emailIds } : {} });
      await loadNotifications();
    } catch (err) { toast(err.message, 'error'); }
  }, [loadNotifications, toast]);

  const reviewImportant = () => { setView('important'); setAlertHidden(true); dismissAlerts(); };

  const runSweepNow = async () => {
    try {
      const r = await api('/api/notifications/sweep', { method: 'POST' });
      toast(`Sweep done: ${r.important_found} important, ${r.notifications_sent} new alert${r.notifications_sent === 1 ? '' : 's'}`, 'success');
      await Promise.all([loadNotifications(), refresh()]);
    } catch (err) { toast(err.message, 'error'); }
  };

  const sendDigest = async () => {
    try { setDigest(await api('/api/notifications/digest')); }
    catch (err) { toast(err.message, 'error'); }
  };

  // ------------------------------------------------------ search suggest
  useEffect(() => {
    if (!search.trim()) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const d = await api(`/api/search?suggest=true&q=${encodeURIComponent(search)}`);
        setSuggestions(d.suggestions || []);
      } catch { /* ignore */ }
    }, 180);
    return () => clearTimeout(t);
  }, [search]);

  // ------------------------------------------------------------- actions
  const openEmail = async (e) => {
    try {
      const full = await api(`/api/emails/${e.id}`);
      setSelected(full);
      if (!e.is_read) {
        await api(`/api/emails/${e.id}/read`, { method: 'POST' });
        setEmails(list => list.map(x => x.id === e.id ? { ...x, is_read: 1 } : x));
        loadMeta();
        loadNotifications(); // reading an important email clears it from alerts
      }
    } catch (err) { toast(err.message, 'error'); }
  };
  openEmailRef.current = openEmail;

  const setEmailFolder = async (email, folderId, folderName) => {
    try {
      await api(`/api/emails/${email.id}/folder`, { method: 'POST', body: { folder_id: folderId } });
      toast(folderId ? `Moved to ${folderName}` : 'Removed from folder', 'success');
      if (selected?.id === email.id) openEmail({ ...email, is_read: 1 });
      await refresh();
    } catch (err) { toast(err.message, 'error'); }
  };

  const act = async (fn, msg) => {
    try { await fn(); if (msg) toast(msg, 'success'); await refresh(); }
    catch (err) { toast(err.message, 'error'); }
  };

  const toggleStar = (e, ev) => { ev?.stopPropagation();
    act(() => api(`/api/emails/${e.id}/star`, { method: 'POST' }));
    if (selected?.id === e.id) setSelected(s => ({ ...s, is_starred: s.is_starred ? 0 : 1 }));
  };
  const archiveEmail = (e, ev) => { ev?.stopPropagation();
    if (selected?.id === e.id) setSelected(null);
    act(() => api(`/api/emails/${e.id}/archive`, { method: 'POST' }), 'Archived');
  };
  const deleteEmail = (e, ev) => { ev?.stopPropagation();
    if (selected?.id === e.id) setSelected(null);
    act(() => api(`/api/emails/${e.id}`, { method: 'DELETE' }), 'Deleted');
  };
  const spamEmail = (e, ev) => { ev?.stopPropagation();
    if (selected?.id === e.id) setSelected(null);
    act(() => api(`/api/emails/${e.id}/spam`, { method: 'POST', body: { is_spam: !e.is_spam } }),
      e.is_spam ? 'Moved out of spam' : 'Marked as spam');
  };
  const categorize = (e, category, ev) => { ev?.stopPropagation();
    act(() => api(`/api/emails/${e.id}/categorize`, { method: 'POST', body: { category } }), `Moved to ${category}`);
    if (selected?.id === e.id) setSelected(s => ({ ...s, category }));
  };
  const addVip = (e, ev) => { ev?.stopPropagation();
    act(() => api('/api/vip', { method: 'POST', body: { sender_email: e.from_email, sender_name: e.from_name } }),
      `${e.from_name || e.from_email} added to VIP`);
  };
  const removeVip = (email) => act(() => api(`/api/vip/${encodeURIComponent(email)}`, { method: 'DELETE' }), 'Removed from VIP');
  const unsubscribe = async (e) => {
    try {
      const r = await api(`/api/emails/${e.id}/unsubscribe`, { method: 'POST' });
      toast(r.message, 'success');
      if (selected?.id === e.id) setSelected(null);
      await refresh();
    } catch (err) { toast(err.message, 'error'); }
  };

  const bulk = (action, category) => {
    const ids = [...checked];
    act(() => api('/api/emails/bulk', { method: 'POST', body: { ids, action, category } }),
      `${action === 'vip' ? 'Added senders to VIP' : `Applied "${action}"`} (${ids.length} emails)`);
    setChecked(new Set());
    if (selected && ids.includes(selected.id) && ['archive', 'delete', 'spam'].includes(action)) setSelected(null);
  };

  const startReply = async (email) => {
    try {
      const d = await api('/api/drafts', { method: 'POST', body: {
        email_id: email.id, to_email: email.from_email,
        subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
        body: '',
      }});
      setComposing(d); loadMeta();
    } catch (err) { toast(err.message, 'error'); }
  };

  const savePreset = async () => {
    const name = prompt('Name this filter preset:');
    if (!name) return;
    const cfg = {};
    Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v !== false) cfg[k] = v; });
    await act(() => api('/api/filters/presets', { method: 'POST', body: { name, filter_config: cfg } }), `Preset "${name}" saved`);
  };

  const applyPreset = (p) => {
    const c = p.filter_config || {};
    setFilters({ ...EMPTY_FILTERS, ...c,
      is_read: c.is_read === false ? 'false' : c.is_read === true ? 'true' : (c.is_read ?? ''),
    });
    setShowFilters(true); setView('inbox');
    toast(`Preset "${p.name}" applied`);
  };

  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => k !== 'logic' && v !== '' && v !== false).length;

  // ------------------------------------------------------- drag & drop
  const onDragStart = (e, emailId) => {
    dragIds.current = checked.has(emailId) ? [...checked] : [emailId];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'emails');
  };
  const onDropCategory = (catName) => {
    const ids = dragIds.current;
    if (!ids.length) return;
    act(() => api('/api/emails/bulk', { method: 'POST', body: { ids, action: 'categorize', category: catName } }),
      `Moved ${ids.length} email${ids.length > 1 ? 's' : ''} to ${catName}`);
    setDragOverCat(null); setChecked(new Set());
  };
  // Manual override: dropping onto an Amazon subfolder reclassifies the email
  const onDropFolder = (folder) => {
    const ids = dragIds.current;
    if (!ids.length) return;
    act(() => api('/api/emails/bulk', { method: 'POST', body: { ids, action: 'folder', folder_id: folder.id } }),
      `Moved ${ids.length} email${ids.length > 1 ? 's' : ''} to ${folder.name}`);
    setDragOverCat(null); setChecked(new Set());
  };

  // -------------------------------------------------------- grouping
  const grouped = useMemo(() => {
    if (!groupBy) return [{ key: null, emails }];
    const groups = new Map();
    for (const e of emails) {
      let key;
      if (groupBy === 'sender') key = e.from_name || e.from_email;
      else if (groupBy === 'category') key = e.category || 'uncategorized';
      else {
        const d = new Date(e.date), now = new Date();
        const diff = (now.setHours(0,0,0,0) - new Date(d).setHours(0,0,0,0)) / 864e5;
        key = diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'This week' : 'Earlier';
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    return [...groups.entries()].map(([key, emails]) => ({ key, emails }));
  }, [emails, groupBy]);

  // ---------------------------------------------------------- render
  const allFolders = useMemo(() => folders.flatMap(f => [f, ...(f.children || [])]), [folders]);
  const viewTitle = view.startsWith('cat:') ? view.slice(4)
    : view.startsWith('folder:') ? (() => {
        const f = allFolders.find(x => x.id === view.slice(7));
        return f ? (f.parent_folder_id ? `Amazon / ${f.name}` : f.name) : 'Folder';
      })()
    : (VIEWS[view]?.label || 'Inbox');

  return html`
    <div class="app">
      <${TopBar}
        search=${search} setSearch=${setSearch} suggestions=${suggestions}
        onSearch=${(q) => { setActiveSearch(q); setSuggestions([]); if (view === 'drafts') setView('inbox'); }}
        accounts=${accounts} accountId=${accountId} setAccountId=${setAccountId}
        onSettings=${() => setShowAccounts(true)}
        onMenu=${() => setSidebarOpen(o => !o)}
      />
      <div class="main">
        <${Sidebar}
          open=${sidebarOpen} view=${view} setView=${setView} stats=${stats}
          categories=${categories} presets=${presets} drafts=${drafts}
          folders=${folders} expandedFolders=${expandedFolders} setExpandedFolders=${setExpandedFolders}
          notifStatus=${notifStatus} onDropFolder=${onDropFolder}
          dragOverCat=${dragOverCat} setDragOverCat=${setDragOverCat} onDropCategory=${onDropCategory}
          applyPreset=${applyPreset}
          deletePreset=${(p) => act(() => api(`/api/filters/presets/${p.id}`, { method: 'DELETE' }), 'Preset deleted')}
        />
        <div class="list-pane">
          ${alertData?.count > 0 && !alertHidden && html`<${AlertWidget}
            data=${alertData} onReview=${reviewImportant}
            onDismiss=${() => { setAlertHidden(true); dismissAlerts(); }}
            onOpen=${(e) => openEmail(e)}
          />`}
          ${stats && html`<div class="stats-bar">
            <span><b>${stats.unread}</b> unread</span>
            <span><b>${stats.action_required}</b> action required</span>
            <span><b>${stats.vip_unread}</b> VIP unread</span>
            <span class="spam-tip">${stats.spam_message}</span>
            <span style=${{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
              <button class="btn ghost sm" title="Email me a summary of what needs attention" onClick=${sendDigest}>\u{1F4EC} Digest</button>
              <button class="btn ghost sm" title=${`Hourly sweep${notifStatus?.last_sweep ? ` - last run ${fmtDate(notifStatus.last_sweep.sweep_time)}` : ''}`} onClick=${runSweepNow}>\u{1F9F9} Sweep now</button>
            </span>
          </div>`}

          ${view === 'drafts' ? html`<${DraftsView} drafts=${drafts} setComposing=${setComposing} refresh=${refresh} toast=${toast} api=${api} />` : html`
            <${React.Fragment}>
              <div class="toolbar">
                <span class="toolbar-label" style=${{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize' }}>
                  ${activeSearch ? `Search: "${activeSearch}"` : viewTitle} ${' '}
                  <span style=${{ color: 'var(--text-faint)', fontWeight: 400 }}>(${total})</span>
                </span>
                ${activeSearch && html`<button class="btn ghost sm" onClick=${() => { setActiveSearch(''); setSearch(''); }}>Clear search ✕</button>`}
                <div class="spacer" />
                <span class="toolbar-label">Sort</span>
                <select value=${sort} onChange=${e => setSort(e.target.value)}>
                  <option value="date">Date</option><option value="sender">Sender</option>
                  <option value="subject">Subject</option><option value="priority">Priority</option>
                </select>
                <button class="icon-btn" title="Toggle sort order" onClick=${() => setOrder(o => o === 'desc' ? 'asc' : 'desc')}>${order === 'desc' ? '↓' : '↑'}</button>
                <span class="toolbar-label">Group</span>
                <select value=${groupBy} onChange=${e => setGroupBy(e.target.value)}>
                  <option value="">None</option><option value="date">Date</option>
                  <option value="sender">Sender</option><option value="category">Category</option>
                </select>
                <button class=${`btn sm ${showFilters ? 'primary' : ''}`} onClick=${() => setShowFilters(s => !s)}>
                  Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}
                </button>
              </div>

              ${showFilters && html`<${FilterPanel} filters=${filters} setFilters=${setFilters}
                categories=${categories} savePreset=${savePreset} />`}

              ${checked.size > 0 && html`<div class="bulk-bar">
                <b>${checked.size} selected</b>
                <button class="btn sm" onClick=${() => bulk('read')}>Mark read</button>
                <button class="btn sm" onClick=${() => bulk('unread')}>Mark unread</button>
                <button class="btn sm" onClick=${() => bulk('archive')}>Archive</button>
                <button class="btn sm" onClick=${() => bulk('vip')}>Add to VIP</button>
                <select onChange=${e => { if (e.target.value) { bulk('categorize', e.target.value); e.target.value = ''; } }}>
                  <option value="">Categorize…</option>
                  ${categories.map(c => html`<option key=${c.id} value=${c.name}>${c.name}</option>`)}
                </select>
                <button class="btn sm" onClick=${() => bulk('spam')}>Spam</button>
                <button class="btn sm danger" onClick=${() => bulk('delete')}>Delete</button>
                <button class="btn sm ghost" onClick=${() => setChecked(new Set())}>Cancel</button>
              </div>`}

              <div class="email-list">
                ${loading ? html`<div class="empty-state">Loading…</div>` :
                  emails.length === 0 ? html`<div class="empty-state">
                    <div class="big">\u{1F4ED}</div>
                    <div>No emails here${activeFilterCount ? ' - try clearing some filters' : ''}.</div>
                  </div>` :
                  grouped.map(g => html`
                    <${React.Fragment} key=${g.key ?? 'all'}>
                      ${g.key !== null && html`<div class="group-header">${g.key} (${g.emails.length})</div>`}
                      ${g.emails.map(e => html`<${EmailRow} key=${e.id} email=${e} catMap=${catMap}
                        selected=${selected?.id === e.id} checked=${checked.has(e.id)}
                        onOpen=${() => openEmail(e)}
                        onCheck=${(v) => setChecked(prev => { const n = new Set(prev); v ? n.add(e.id) : n.delete(e.id); return n; })}
                        onStar=${(ev) => toggleStar(e, ev)} onArchive=${(ev) => archiveEmail(e, ev)}
                        onDelete=${(ev) => deleteEmail(e, ev)} onSpam=${(ev) => spamEmail(e, ev)}
                        onVip=${(ev) => addVip(e, ev)} onCategorize=${(cat, ev) => categorize(e, cat, ev)}
                        categories=${categories} onDragStart=${(ev) => onDragStart(ev, e.id)}
                      />`)}
                    </${React.Fragment}>`)}
              </div>
            </${React.Fragment}>`}
        </div>

        ${(selected || composing) && html`<div class="detail-pane">
          ${selected && html`<${EmailDetail} email=${selected} catMap=${catMap} vipEmails=${vipEmails}
            onClose=${() => setSelected(null)} onStar=${() => toggleStar(selected)}
            onArchive=${() => archiveEmail(selected)} onDelete=${() => deleteEmail(selected)}
            onSpam=${() => spamEmail(selected)} onUnsubscribe=${() => unsubscribe(selected)}
            onVip=${() => addVip(selected)} onRemoveVip=${() => removeVip(selected.from_email)}
            onReply=${() => startReply(selected)} onOpenRelated=${(id) => openEmail({ id, is_read: 1 })}
            onCategorize=${(cat) => categorize(selected, cat)} categories=${categories} toast=${toast}
            allFolders=${allFolders} onSetFolder=${(fid, name) => setEmailFolder(selected, fid, name)}
          />`}
          ${composing && html`<${Composer} draft=${composing} setDraft=${setComposing}
            onDone=${() => { setComposing(null); refresh(); }} toast=${toast} />`}
        </div>`}
      </div>

      ${showAccounts && html`<${AccountsModal} accounts=${accounts} onClose=${() => setShowAccounts(false)}
        refresh=${refresh} toast=${toast} vips=${vips} removeVip=${removeVip} />`}

      ${digest && html`<${Modal} title="\u{1F4EC} Email digest" onClose=${() => setDigest(null)}
        foot=${html`<button class="btn primary" onClick=${() => setDigest(null)}>Done</button>`}>
        <p style=${{ marginBottom: '10px' }}>${digest.summary}</p>
        <p style=${{ color: 'var(--text-faint)', fontSize: '12px', marginBottom: '12px' }}>${digest.message}</p>
        ${digest.items.map(i => html`
          <button key=${i.id} class="related-item" onClick=${() => { setDigest(null); openEmail({ id: i.id, is_read: 0 }); }}>
            ${i.types.map(t => html`<span key=${t} class=${`badge imp-${t}`} style=${{ marginRight: '6px' }}>${IMP_LABELS[t] || t}</span>`)}
            <b>${i.subject}</b>
            <span style=${{ color: 'var(--text-faint)' }}> · ${i.from_name} · ${fmtDate(i.date)}</span>
          </button>`)}
      </${Modal}>`}

      <div class="toasts">
        ${toasts.map(t => html`<div key=${t.id} class=${`toast ${t.type}`}>${t.message}</div>`)}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- TopBar
function TopBar({ search, setSearch, suggestions, onSearch, accounts, accountId, setAccountId, onSettings, onMenu }) {
  return html`
    <div class="topbar">
      <button class="icon-btn menu-btn" onClick=${onMenu}>☰</button>
      <div class="logo"><span class="dot" />Mail Deck</div>
      <div class="searchbox">
        <span class="search-icon">\u{1F50D}</span>
        <input placeholder="Search all 5 accounts…" value=${search}
          onInput=${e => setSearch(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') onSearch(search); }} />
        ${suggestions.length > 0 && html`<div class="suggestions">
          ${suggestions.map((s, i) => html`
            <button key=${i} class="suggestion" onClick=${() => { setSearch(s.text); onSearch(s.type === 'sender' ? s.detail : s.text); }}>
              <span class="s-type">${s.type}</span>
              <span class="s-text">${s.text}</span>
              ${s.detail && html`<span class="s-detail">${s.detail}</span>`}
            </button>`)}
        </div>`}
      </div>
      <select value=${accountId} onChange=${e => setAccountId(e.target.value)} title="Filter by account">
        <option value="">All accounts (${accounts.length})</option>
        ${accounts.map(a => html`<option key=${a.id} value=${a.id}>${a.email}</option>`)}
      </select>
      <button class="icon-btn" title="Settings & accounts" onClick=${onSettings}>⚙️</button>
    </div>`;
}

// --------------------------------------------------------------- Sidebar
function Sidebar({ open, view, setView, stats, categories, presets, drafts, folders, expandedFolders, setExpandedFolders, notifStatus, onDropFolder, dragOverCat, setDragOverCat, onDropCategory, applyPreset, deletePreset }) {
  const counts = {
    inbox: stats?.unread, vip: stats?.vip_unread, action: stats?.action_required,
    spam: stats?.spam, drafts: drafts.filter(d => d.status !== 'sent').length,
  };
  const badges = notifStatus?.folder_badges || {};
  const toggleFolder = (id, ev) => { ev.stopPropagation();
    setExpandedFolders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const folderItem = (f, isChild) => html`
    <button key=${f.id}
      class=${`nav-item ${isChild ? 'subfolder' : ''} ${view === `folder:${f.id}` ? 'active' : ''} ${dragOverCat === f.id ? 'drop-target' : ''}`}
      onClick=${() => setView(`folder:${f.id}`)}
      onDragOver=${e => { e.preventDefault(); setDragOverCat(f.id); }}
      onDragLeave=${() => setDragOverCat(d => d === f.id ? null : d)}
      onDrop=${e => { e.preventDefault(); onDropFolder(f); }}>
      ${!isChild && html`<span class=${`folder-arrow ${expandedFolders.has(f.id) ? 'open' : ''}`}
        onClick=${(ev) => toggleFolder(f.id, ev)}>▶</span>`}
      <span>${FOLDER_ICONS[f.icon] || '\u{1F4C1}'}</span> ${f.name}
      ${badges[f.id] > 0 && html`<span class="count alert" title="New important emails">${badges[f.id]}</span>`}
      ${!(badges[f.id] > 0) && f.email_count > 0 && html`<span class="count">${f.unread_count > 0 ? `${f.unread_count}/` : ''}${f.email_count}</span>`}
    </button>`;

  return html`
    <div class=${`sidebar ${open ? 'open' : ''}`}>
      ${Object.entries(VIEWS).map(([key, v]) => html`
        <button key=${key} class=${`nav-item ${view === key ? 'active' : ''}`} onClick=${() => setView(key)}>
          <span>${v.icon}</span> ${v.label}
          ${key === 'important'
            ? (notifStatus?.important_new > 0 && html`<span class="count alert" title="New important emails since last check">${notifStatus.important_new}</span>`)
            : (counts[key] > 0 && html`<span class=${`count ${key === 'action' ? 'hot' : ''}`}>${counts[key]}</span>`)}
        </button>`)}

      ${folders.length > 0 && html`<${React.Fragment}>
        <div class="nav-section">Folders <span style=${{ textTransform: 'none', fontWeight: 400 }}>(auto-sorted)</span></div>
        ${folders.map(f => html`
          <${React.Fragment} key=${f.id}>
            ${folderItem(f, false)}
            ${expandedFolders.has(f.id) && (f.children || []).map(c => folderItem(c, true))}
          </${React.Fragment}>`)}
      </${React.Fragment}>`}

      <div class="nav-section">Categories <span style=${{ textTransform: 'none', fontWeight: 400 }}>(drag emails here)</span></div>
      ${categories.map(c => html`
        <button key=${c.id}
          class=${`nav-item ${view === `cat:${c.name}` ? 'active' : ''} ${dragOverCat === c.name ? 'drop-target' : ''}`}
          onClick=${() => setView(`cat:${c.name}`)}
          onDragOver=${e => { e.preventDefault(); setDragOverCat(c.name); }}
          onDragLeave=${() => setDragOverCat(d => d === c.name ? null : d)}
          onDrop=${e => { e.preventDefault(); onDropCategory(c.name); }}>
          <span class="cat-dot" style=${{ background: c.color }} />
          <span style=${{ textTransform: 'capitalize' }}>${c.name}</span>
          ${c.email_count > 0 && html`<span class="count">${c.email_count}</span>`}
        </button>`)}

      ${presets.length > 0 && html`<${React.Fragment}>
        <div class="nav-section">Saved filters</div>
        ${presets.map(p => html`
          <div key=${p.id} class="preset-row">
            <button class="nav-item" onClick=${() => applyPreset(p)}><span>\u{1F4CC}</span> ${p.name}</button>
            <button class="preset-del" title="Delete preset" onClick=${() => deletePreset(p)}>✕</button>
          </div>`)}
      </${React.Fragment}>`}
    </div>`;
}

// ------------------------------------------------------------ AlertWidget
// "N important emails since last check" banner at the top of the dashboard.
function AlertWidget({ data, onReview, onDismiss, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const parts = Object.entries(data.breakdown || {})
    .map(([t, c]) => `${c} ${(IMP_LABELS[t] || t).toLowerCase()}${c > 1 ? 's' : ''}`);
  return html`
    <div class="alert-widget">
      <div class="alert-main">
        <span class="alert-icon">\u{1F514}</span>
        <div class="alert-text">
          <b>${data.count} important email${data.count > 1 ? 's' : ''} since last check</b>
          ${parts.length > 0 && html`<span class="alert-breakdown">${parts.join(' · ')}</span>`}
        </div>
        <button class="btn sm ghost" onClick=${() => setExpanded(x => !x)}>${expanded ? 'Hide list' : 'Show list'}</button>
        <button class="btn sm primary" onClick=${onReview}>Review now</button>
        <button class="btn sm ghost" title="Dismiss" onClick=${onDismiss}>✕ Dismiss</button>
      </div>
      ${expanded && html`<div class="alert-list">
        ${data.emails.slice(0, 8).map(e => html`
          <button key=${e.id} class="alert-item" onClick=${() => onOpen({ id: e.id, is_read: e.is_read })}>
            ${e.important_types.map(t => html`<span key=${t} class=${`badge imp-${t}`}>${IMP_LABELS[t] || t}</span>`)}
            <b>${e.from_name || e.from_email}</b>
            <span class="alert-subject">${e.subject}</span>
            <span class="alert-date">${fmtDate(e.date)}</span>
          </button>`)}
        ${data.emails.length > 8 && html`<div class="alert-more">+ ${data.emails.length - 8} more - hit Review now</div>`}
      </div>`}
    </div>`;
}

// ------------------------------------------------------------ FilterPanel
function FilterPanel({ filters, setFilters, categories, savePreset }) {
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  return html`
    <div class="filter-panel">
      <div class="filter-row">
        <input type="text" placeholder="Sender name or email" value=${filters.sender}
          onInput=${e => set('sender', e.target.value)} style=${{ width: '200px' }} />
        <select value=${filters.category} onChange=${e => set('category', e.target.value)}>
          <option value="">Any category</option>
          ${categories.map(c => html`<option key=${c.id} value=${c.name}>${c.name}</option>`)}
        </select>
        <select value=${filters.attachment_type} onChange=${e => set('attachment_type', e.target.value)}>
          <option value="">Any attachment type</option>
          <option value="pdf">PDF</option><option value="image">Image</option><option value="document">Document</option>
        </select>
        <select value=${filters.is_read} onChange=${e => set('is_read', e.target.value)}>
          <option value="">Read or unread</option><option value="false">Unread only</option><option value="true">Read only</option>
        </select>
      </div>
      <div class="filter-row">
        <label><input type="checkbox" checked=${filters.is_vip} onChange=${e => set('is_vip', e.target.checked)} /> From VIP</label>
        <label><input type="checkbox" checked=${filters.is_starred} onChange=${e => set('is_starred', e.target.checked)} /> Flagged/starred</label>
        <label><input type="checkbox" checked=${filters.action_required} onChange=${e => set('action_required', e.target.checked)} /> Action required</label>
        <label><input type="checkbox" checked=${filters.has_attachment} onChange=${e => set('has_attachment', e.target.checked)} /> Has attachment</label>
        <label>From <input type="date" value=${filters.date_from} onChange=${e => set('date_from', e.target.value)} /></label>
        <label>To <input type="date" value=${filters.date_to} onChange=${e => set('date_to', e.target.value)} /></label>
      </div>
      <div class="filter-row">
        <span class="toolbar-label">Combine with</span>
        <div class="logic-toggle">
          <button class=${filters.logic === 'AND' ? 'on' : ''} onClick=${() => set('logic', 'AND')}>AND</button>
          <button class=${filters.logic === 'OR' ? 'on' : ''} onClick=${() => set('logic', 'OR')}>OR</button>
        </div>
        <div style=${{ flex: 1 }} />
        <button class="btn sm" onClick=${savePreset}>\u{1F4CC} Save as preset</button>
        <button class="btn sm ghost" onClick=${() => setFilters({ ...EMPTY_FILTERS })}>Clear filters</button>
      </div>
    </div>`;
}

// -------------------------------------------------------------- EmailRow
function EmailRow({ email: e, catMap, selected, checked, onOpen, onCheck, onStar, onArchive, onDelete, onSpam, onVip, onCategorize, categories, onDragStart }) {
  const [catOpen, setCatOpen] = useState(false);
  const cat = e.category && catMap[e.category];
  return html`
    <div class=${`email-row ${e.is_read ? '' : 'unread'} ${selected ? 'selected' : ''}`}
      draggable="true" onDragStart=${onDragStart} onClick=${onOpen}>
      <input class="e-check" type="checkbox" checked=${checked}
        onClick=${ev => ev.stopPropagation()} onChange=${ev => onCheck(ev.target.checked)} />
      <button class=${`e-star ${e.is_starred ? 'on' : ''}`} title="Star" onClick=${onStar}>${e.is_starred ? '★' : '☆'}</button>
      <div class="e-main">
        <div class="e-line1">
          <span class="e-sender">${e.from_name || e.from_email}</span>
          ${e.is_vip ? html`<span class="badge vip">⭐ VIP</span>` : null}
          ${(e.important_types || []).filter(t => t !== 'vip').slice(0, 2).map(t =>
            html`<span key=${t} class=${`badge imp-${t}`}>${IMP_LABELS[t] || t}</span>`)}
          ${e.action_required ? html`<span class="badge action">Action required</span>` : null}
          ${e.is_spam ? html`<span class="badge spam">Spam</span>` : null}
          ${cat && html`<span class="badge cat" style=${{ background: cat.color + '26', color: cat.color }}>${e.category}</span>`}
          ${e.has_attachment ? html`<span class="attach-icon" title=${e.attachment_types.join(', ')}>\u{1F4CE}</span>` : null}
        </div>
        <div class="e-line2">
          <span class="e-subject">${e.subject}</span>
          <span class="e-preview">— ${e.body_preview}</span>
        </div>
      </div>
      <div class="e-meta">
        <span class="e-date">${fmtDate(e.date)}</span>
        <span class="badge provider">${e.provider}</span>
      </div>
      <div class="hover-actions" onClick=${ev => ev.stopPropagation()}>
        <button title="Archive" onClick=${onArchive}>\u{1F4E6}</button>
        <button title="Delete" onClick=${onDelete}>\u{1F5D1}️</button>
        <button title=${e.is_spam ? 'Not spam' : 'Mark spam'} onClick=${onSpam}>\u{1F6AB}</button>
        <button title="Add sender to VIP" onClick=${onVip}>⭐</button>
        <div class="cat-menu">
          <button title="Categorize" onClick=${() => setCatOpen(o => !o)}>\u{1F3F7}️</button>
          ${catOpen && html`<div class="cat-dropdown">
            ${categories.map(c => html`<button key=${c.id} onClick=${ev => { setCatOpen(false); onCategorize(c.name, ev); }}>
              <span class="cat-dot" style=${{ background: c.color }} />${c.name}</button>`)}
          </div>`}
        </div>
      </div>
    </div>`;
}

// ------------------------------------------------------------ EmailDetail
function EmailDetail({ email: e, catMap, vipEmails, onClose, onStar, onArchive, onDelete, onSpam, onUnsubscribe, onVip, onRemoveVip, onReply, onOpenRelated, onCategorize, categories, toast, allFolders = [], onSetFolder }) {
  const isVip = vipEmails.has(e.from_email);
  const cat = e.category && catMap[e.category];
  const [catOpen, setCatOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const currentFolder = e.folders?.[0];
  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div class="detail-header">
        <div style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <div class="detail-subject">
            ${e.subject}
            ${e.action_required ? html`<span class="badge action">Action required</span>` : null}
            ${(e.important_types || []).filter(t => t !== 'vip').map(t =>
              html`<span key=${t} class=${`badge imp-${t}`}>${IMP_LABELS[t] || t}</span>`)}
            ${cat && html`<span class="badge cat" style=${{ background: cat.color + '26', color: cat.color }}>${e.category}</span>`}
            ${currentFolder && html`<span class="badge folder" title=${`Filed ${currentFolder.assigned_by === 'manual' ? 'manually' : 'automatically'}`}>
              ${FOLDER_ICONS[currentFolder.icon] || '\u{1F4C1}'} ${currentFolder.name}</span>`}
          </div>
          <button class="icon-btn" title="Close" onClick=${onClose}>✕</button>
        </div>
        <div class="detail-from">
          <div class="avatar" style=${{ background: avatarColor(e.from_email) }}>${initials(e.from_name, e.from_email)}</div>
          <div class="who">
            <div class="name">
              ${e.from_name || e.from_email}
              ${isVip ? html`<span class="badge vip">⭐ VIP</span>` : null}
            </div>
            <div class="addr">${e.from_email} → ${e.account_email} (${e.provider}) · ${new Date(e.date).toLocaleString()}</div>
          </div>
          ${isVip
            ? html`<button class="btn sm ghost" onClick=${onRemoveVip}>Remove VIP</button>`
            : html`<button class="btn sm" onClick=${onVip}>⭐ Add VIP</button>`}
        </div>
      </div>

      ${e.action_required ? html`<div class="quick-actions">
        <span class="qa-label">\u{1F514} Quick actions</span>
        <button class="btn sm success" onClick=${() => toast('Opening payment portal… (demo)', 'success')}>Pay now</button>
        <button class="btn sm" onClick=${() => toast('Marked for review', 'success')}>Review later</button>
        <button class="btn sm" onClick=${() => toast('Forwarded to raj.mehta@cpafirm.com (demo)', 'success')}>Forward to accountant</button>
      </div>` : null}

      <div class="detail-actions">
        <button class="btn sm primary" onClick=${onReply}>↩ Reply</button>
        <button class="btn sm" onClick=${onStar}>${e.is_starred ? '★ Starred' : '☆ Star'}</button>
        <button class="btn sm" onClick=${onArchive}>Archive</button>
        <div class="cat-menu" style=${{ position: 'relative' }}>
          <button class="btn sm" onClick=${() => setCatOpen(o => !o)}>\u{1F3F7}️ Categorize</button>
          ${catOpen && html`<div class="cat-dropdown" style=${{ left: 0, right: 'auto' }}>
            ${categories.map(c => html`<button key=${c.id} onClick=${() => { setCatOpen(false); onCategorize(c.name); }}>
              <span class="cat-dot" style=${{ background: c.color }} />${c.name}</button>`)}
          </div>`}
        </div>
        <div class="cat-menu" style=${{ position: 'relative' }}>
          <button class="btn sm" onClick=${() => setFolderOpen(o => !o)}>\u{1F4C1} Folder</button>
          ${folderOpen && html`<div class="cat-dropdown" style=${{ left: 0, right: 'auto' }}>
            ${allFolders.filter(f => f.parent_folder_id).map(f => html`
              <button key=${f.id} onClick=${() => { setFolderOpen(false); onSetFolder(f.id, `Amazon / ${f.name}`); }}>
                ${FOLDER_ICONS[f.icon] || '\u{1F4C1}'} ${f.name}</button>`)}
            ${currentFolder && html`<button onClick=${() => { setFolderOpen(false); onSetFolder(null); }}>✕ Remove from folder</button>`}
          </div>`}
        </div>
        <button class="btn sm" onClick=${onSpam}>${e.is_spam ? 'Not spam' : '\u{1F6AB} Spam'}</button>
        ${(e.list_unsubscribe || e.category === 'newsletters' || e.category === 'subscriptions') &&
          html`<button class="btn sm warning" style=${{ borderColor: 'var(--warning)', color: 'var(--warning)', background: 'transparent' }}
            onClick=${onUnsubscribe}>✂ Unsubscribe</button>`}
        <button class="btn sm danger" onClick=${onDelete}>Delete</button>
      </div>

      <div class="detail-body">${e.body_full}</div>

      ${e.attachments?.length > 0 && html`<div class="attachments">
        ${e.attachments.map((a, i) => html`
          <button key=${i} class="attachment" onClick=${() => toast(`Downloading ${a.name}… (demo)`, 'success')}>
            <span>${ATTACH_ICONS[a.type] || '\u{1F4CE}'}</span>
            <span>${a.name}</span>
            <span class="a-size">${fmtSize(a.size)}</span>
          </button>`)}
      </div>`}

      ${e.related?.length > 0 && html`<div class="related">
        <h4>Related emails (same thread or sender)</h4>
        ${e.related.map(r => html`
          <button key=${r.id} class="related-item" onClick=${() => onOpenRelated(r.id)}>
            <b style=${{ fontWeight: r.is_read ? 400 : 700 }}>${r.subject}</b>
            <span style=${{ color: 'var(--text-faint)' }}> · ${r.from_name} · ${fmtDate(r.date)}</span>
          </button>`)}
      </div>`}
    </div>`;
}

// -------------------------------------------------------------- Composer
function Composer({ draft, setDraft, onDone, toast }) {
  const [form, setForm] = useState({ to_email: draft.to_email, subject: draft.subject || '', body: draft.body || '' });
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [showPreview, setShowPreview] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  const save = useCallback(async (status) => {
    setSaveState('saving');
    try {
      const d = await api(`/api/drafts/${draft.id}/save`, { method: 'POST', body: { ...formRef.current, status } });
      setDraft(prev => ({ ...prev, ...d }));
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
      return d;
    } catch (err) { setSaveState('idle'); toast(err.message, 'error'); }
  }, [draft.id, setDraft, toast]);

  // Auto-save every 10 seconds
  useEffect(() => {
    const t = setInterval(() => save(), 10000);
    return () => clearInterval(t);
  }, [save]);

  const requestApproval = async () => {
    await save('pending_approval');
    setShowApproval(true);
  };

  const approveAndSend = async () => {
    try {
      const r = await api(`/api/drafts/${draft.id}/approve`, { method: 'POST' });
      toast(r.message, 'success');
      setShowApproval(false); onDone();
    } catch (err) { toast(err.message, 'error'); }
  };

  const discard = async () => {
    try { await api(`/api/drafts/${draft.id}`, { method: 'DELETE' }); toast('Draft discarded'); onDone(); }
    catch (err) { toast(err.message, 'error'); }
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return html`
    <div class="composer">
      <div class="composer-head">
        <h3>✏️ Reply draft</h3>
        <span class=${`autosave ${saveState === 'saved' ? 'saved' : ''}`}>
          ${saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Draft saved' : 'Auto-saves every 10s'}
        </span>
      </div>
      <input placeholder="To" value=${form.to_email} onInput=${set('to_email')} />
      <input placeholder="Subject" value=${form.subject} onInput=${set('subject')} />
      <textarea placeholder="Write your reply…" value=${form.body} onInput=${set('body')} />
      <div class="composer-foot">
        <button class="btn sm" onClick=${() => setShowPreview(true)}>\u{1F441} Preview</button>
        <button class="btn sm primary" disabled=${!form.body.trim()} onClick=${requestApproval}>Send for approval</button>
        <button class="btn sm ghost" onClick=${() => save()}>Save draft</button>
        <div style=${{ flex: 1 }} />
        <button class="btn sm danger" onClick=${discard}>Discard</button>
      </div>

      ${showPreview && html`<${Modal} title="Reply preview" onClose=${() => setShowPreview(false)}
        foot=${html`<${React.Fragment}>
          <button class="btn" onClick=${() => setShowPreview(false)}>Keep editing</button>
          <button class="btn primary" onClick=${() => { setShowPreview(false); requestApproval(); }}>Looks good → approval</button>
        </${React.Fragment}>`}>
        <${PreviewCard} form=${form} />
      </${Modal}>`}

      ${showApproval && html`<${Modal} title="Approve & send?" onClose=${() => setShowApproval(false)}
        foot=${html`<${React.Fragment}>
          <button class="btn" onClick=${() => setShowApproval(false)}>Back to editing</button>
          <button class="btn success" onClick=${approveAndSend}>✓ Approve & send</button>
        </${React.Fragment}>`}>
        <p style=${{ color: 'var(--text-dim)', marginBottom: '12px' }}>
          This reply is <b style=${{ color: 'var(--warning)' }}>pending approval</b>. Review it one last time - it will be sent immediately after approval.
        </p>
        <${PreviewCard} form=${form} />
      </${Modal}>`}
    </div>`;
}

const PreviewCard = ({ form }) => html`
  <div class="preview-card">
    <div class="pv-row">To: <b>${form.to_email}</b></div>
    <div class="pv-row">Subject: <b>${form.subject || '(no subject)'}</b></div>
    <div class="pv-body">${form.body || '(empty message)'}</div>
  </div>`;

const Modal = ({ title, onClose, children, foot }) => html`
  <div class="modal-overlay" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" onClick=${onClose}>✕</button></div>
      <div class="modal-body">${children}</div>
      ${foot && html`<div class="modal-foot">${foot}</div>`}
    </div>
  </div>`;

// ------------------------------------------------------------- DraftsView
function DraftsView({ drafts, setComposing, refresh, toast }) {
  const approve = async (d) => {
    try { const r = await api(`/api/drafts/${d.id}/approve`, { method: 'POST' }); toast(r.message, 'success'); refresh(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const discard = async (d) => {
    try { await api(`/api/drafts/${d.id}`, { method: 'DELETE' }); toast('Draft discarded'); refresh(); }
    catch (err) { toast(err.message, 'error'); }
  };
  if (!drafts.length) return html`<div class="empty-state"><div class="big">✏️</div><div>No drafts yet. Open an email and hit Reply.</div></div>`;
  return html`
    <div class="email-list">
      ${drafts.map(d => html`
        <div key=${d.id} class="draft-card">
          <div class="d-head">
            <span class="d-to">To: ${d.to_email}</span>
            <span class=${`d-status ${d.status}`}>${d.status.replace('_', ' ')}</span>
            <span style=${{ color: 'var(--text-faint)', fontSize: '12px', marginLeft: 'auto' }}>
              ${d.status === 'sent' ? `Sent ${fmtDate(d.sent_at)}` : `Updated ${fmtDate(d.updated_at)}`}
            </span>
          </div>
          <div><b>${d.subject || '(no subject)'}</b>${d.email_subject ? html`<span style=${{ color: 'var(--text-faint)', fontSize: '12px' }}> · replying to "${d.email_subject}"</span>` : null}</div>
          <div class="d-body">${d.body || '(empty)'}</div>
          ${d.status !== 'sent' && html`<div class="d-foot">
            <button class="btn sm" onClick=${() => setComposing(d)}>Edit</button>
            ${d.status === 'pending_approval' && html`<button class="btn sm success" onClick=${() => approve(d)}>✓ Approve & send</button>`}
            <button class="btn sm danger" onClick=${() => discard(d)}>Discard</button>
          </div>`}
        </div>`)}
    </div>`;
}

// ----------------------------------------------------------- AccountsModal
function AccountsModal({ accounts, onClose, refresh, toast, vips, removeVip }) {
  const [provider, setProvider] = useState('gmail');
  const [email, setEmail] = useState('');
  const [vipInput, setVipInput] = useState('');

  const connect = async () => {
    try {
      const r = await api('/api/accounts/connect', { method: 'POST', body: { provider, email } });
      toast(r.message, 'success'); setEmail(''); refresh();
    } catch (err) { toast(err.message, 'error'); }
  };
  const disconnect = async (a) => {
    if (!confirm(`Disconnect ${a.email}? Its ${a.email_count} emails will be removed.`)) return;
    try { await api(`/api/accounts/${a.id}`, { method: 'DELETE' }); toast('Account disconnected'); refresh(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const addVipManual = async () => {
    if (!vipInput.includes('@')) return toast('Enter a valid email', 'error');
    try { await api('/api/vip', { method: 'POST', body: { sender_email: vipInput } }); toast('Added to VIP', 'success'); setVipInput(''); refresh(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return html`
    <${Modal} title="Settings" onClose=${onClose}>
      <h4 style=${{ marginBottom: '8px', fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Connected accounts (${accounts.length})</h4>
      ${accounts.map(a => html`
        <div key=${a.id} class="account-row">
          <span class=${`provider-chip provider-${a.provider}`}>${a.provider}</span>
          <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>${a.email}</span>
          <span style=${{ color: 'var(--text-faint)', fontSize: '12px' }}>${a.email_count} emails</span>
          <button class="btn sm danger" onClick=${() => disconnect(a)}>Disconnect</button>
        </div>`)}
      <div style=${{ display: 'flex', gap: '6px', margin: '12px 0 20px' }}>
        <select value=${provider} onChange=${e => setProvider(e.target.value)}>
          <option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="yahoo">Yahoo</option>
        </select>
        <input style=${{ flex: 1 }} placeholder="email@example.com" value=${email} onInput=${e => setEmail(e.target.value)} />
        <button class="btn primary sm" onClick=${connect}>Connect (OAuth)</button>
      </div>

      <h4 style=${{ marginBottom: '8px', fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-faint)' }}>VIP senders (${vips.length})</h4>
      <div>
        ${vips.map(v => html`
          <span key=${v.id} class="vip-chip">⭐ ${v.sender_name || v.sender_email}
            <button title="Remove" onClick=${() => removeVip(v.sender_email)}>✕</button>
          </span>`)}
      </div>
      <div class="vip-add">
        <input placeholder="Add VIP by email address" value=${vipInput} onInput=${e => setVipInput(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') addVipManual(); }} />
        <button class="btn sm" onClick=${addVipManual}>Add</button>
      </div>
    </${Modal}>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
