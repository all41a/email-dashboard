# Mail Deck — Personal Email Dashboard

A unified inbox across 5 email accounts (3 Gmail, 1 Outlook, 1 Yahoo) with smart
prioritization, Amazon auto-filing, hourly sweeps with notifications, and a
reply-approval workflow. Single Express app, no build step, SQLite via Node's
built-in `node:sqlite` — the only dependency is Express.

## Quick start (local)

```bash
npm install
npm start
# open http://localhost:3000
```

Requires **Node 22.5+** (uses the built-in `node:sqlite` module). The database
auto-creates at `./data/emails.db` and auto-seeds with 57 demo emails on first
run — no setup needed.

## Deploy to Railway

1. Push this folder's contents to a GitHub repo (include the `lib/` and
   `public/` folders — see `DEPLOY.md` for a click-by-click guide).
2. On [railway.com](https://railway.com): **New → Deploy from GitHub repo** →
   pick your repo → Deploy. `railway.toml` configures Node 22, `npm start`,
   and the `/api/health` healthcheck automatically.
3. Service → **Settings → Networking → Generate Domain** (port 3000).

## Features

- **Unified inbox** — 5 accounts in one list, filterable per account
- **Smart prioritization** — bills, tax, urgent, VIP, and action items are
  auto-detected and badged; "Important" view collects them
- **Spam / declutter** — spam view, one-click unsubscribe with local
  filtering fallback, and a "you could reduce your daily email" metric
- **Categorization** — Finance, Work, Personal, Receipts, Subscriptions,
  Newsletters; auto-categorized, drag emails onto a category to reassign
- **Full-text search** — across subject, sender, and body of all accounts,
  with type-ahead suggestions
- **Advanced filters** — sender, category, read state, attachment type,
  date range, VIP, starred, action-required; AND/OR logic; saveable presets
- **VIP list** — dedicated VIP tab, add/remove senders anywhere
- **Read & reply workflow** — drafts auto-save, then go **pending approval**;
  nothing sends until you explicitly approve
- **Organization** — sort (date/sender/subject/priority), group
  (date/sender/category), bulk actions (read, archive, spam, delete,
  categorize, VIP, move to folder)
- **Amazon folder** — expandable sidebar folder with **Purchase** and
  **Returns** subfolders; Amazon mail is auto-routed by strict domain check
  plus keyword classification (manual moves always win)
- **Hourly sweep + notifications** — sweeps on startup and every hour on the
  hour; important mail triggers browser notifications, a dashboard alert
  banner, sidebar badges, and an on-demand digest ("Digest" button).
  "Sweep now" button runs one on demand.

## Files

| File | Purpose |
|---|---|
| `server.js` | Express backend, all API routes, static serving |
| `db.js` | SQLite schema, smart detection rules, demo seed data |
| `lib/sweeper.js` | Hourly sweep engine + notification ledger |
| `public/index.html` | HTML shell (React 18 + htm from CDN, no build) |
| `public/app.js` | Complete React frontend |
| `public/styles.css` | Dark theme |
| `railway.toml` | Railway deploy config |
| `.env.example` | Environment variables (all optional in demo mode) |

## Configuration (optional)

Everything works with zero configuration. See `.env.example` for:

- `PORT` (default 3000), `DB_PATH` (default `./data/emails.db`)
- `DEMO_MODE` — `true` (default) makes each sweep simulate 1–2 fresh incoming
  emails so notifications are always demonstrable; set `false` to sweep
  existing mail only
- OAuth credentials for connecting real Gmail/Outlook/Yahoo accounts later

Note: Railway's filesystem is ephemeral — the SQLite demo database re-seeds
on redeploy. Attach a Railway volume mounted at `/app/data` if you want data
to persist across deploys.
