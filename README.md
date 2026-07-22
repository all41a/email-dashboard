# Physician Dashboard

A personal dashboard for physicians that runs on your Mac and works from your phone or tablet on the same WiFi.

**Features**

- **Inbox** — email triage organized by category (Clinical, Admin, CME, Financial, Job Offers, Personal) with priority flags, read/archive actions (demo data)
- **Calendar** — unified agenda with Google / Apple / Outlook source toggles (multi-platform sync ready), add and delete events
- **Finances** — net worth, monthly income/spending, category breakdown, accounts and transactions (Plaid-ready; demo data)
- **Shifts** — tap-to-set weekly availability grid plus shift offers you can request or decline

Dark mode, mobile-first, everything stored in a local SQLite file. No accounts, no cloud.

## Run it

```bash
npm install
npm start
```

You'll see:

```
─────────────────────────────────────────────
 Physician Dashboard is running

 On this Mac:   http://localhost:3000
 On your phone: http://192.168.1.42:3000   (same WiFi)
─────────────────────────────────────────────
```

## Access from phone or tablet

1. Make sure your phone is on the **same WiFi network** as the Mac.
2. Open the browser on your phone.
3. Type the `http://192.168.x.x:3000` address printed in the terminal.
4. That's it. For an app-like feel, use *Share → Add to Home Screen* in Safari.

**If it doesn't load on your phone:**

- macOS may prompt "Allow node to accept incoming network connections" the first time — click **Allow** (or check System Settings → Network → Firewall).
- Confirm both devices are on the same network (not a guest network).
- Use a different port if 3000 is taken: `PORT=4000 npm start`.

## Structure

```
physician-dashboard/
├── server.js            # Express server, binds 0.0.0.0, prints your Mac's IP
├── public/              # Frontend (dark, responsive SPA — no build step)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── src/
    ├── db/database.js   # SQLite schema + demo seed data (creates src/db/dashboard.db)
    └── routes/          # emails.js, calendar.js, finance.js, availability.js
```

## Notes

- **Reset demo data:** stop the server, delete `src/db/dashboard.db*`, restart.
- **Plaid:** the finance endpoints return the same shapes Plaid does — swap the demo queries in `src/routes/finance.js` for Plaid Link + `/transactions/sync` when ready.
- **Calendar sync:** the connect/disconnect buttons in Synced Calendars are where Google/Apple/Outlook OAuth plugs in (`src/routes/calendar.js`).
- This is intended for your own home network only — it has no authentication by design.
