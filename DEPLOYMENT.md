# Deploying the Physician Dashboard to Railway

This guide takes you from "code on my computer" to "live website with a URL
you can open on your phone from anywhere." No coding required. Budget about
15 minutes the first time.

Everything technical is already done — the app is pre-configured for Railway
(`railway.toml`, `Procfile`, health check, port handling). You just follow
the clicks below.

---

## Step 1 — Sign up for Railway (2 minutes)

1. Go to **https://railway.com** (formerly railway.app — either works).
2. Click **Login** (top right), then **Sign in with GitHub**.
   - Don't have a GitHub account? Create one first at **https://github.com/signup**
     (free, just needs an email). You'll want GitHub anyway — it's the easiest
     way to get your code onto Railway.
3. Approve the permissions GitHub asks for.
4. Railway starts you on a **free trial with $5 of credit** — more than enough
   to deploy and test this app. After the trial, the Hobby plan is $5/month.
   A small app like this typically uses only $1–3/month of that.

You do **not** need to enter a credit card to start the trial.

## Step 2 — Put the code on GitHub (5 minutes)

Railway deploys straight from a GitHub repository. Easiest no-terminal way:

1. Go to **https://github.com/new**.
2. Repository name: `physician-dashboard`. Set it to **Private**. Click
   **Create repository**.
3. On the new empty repo page, click the link **"uploading an existing file"**.
4. On your computer, open the `physician-dashboard-simple` folder in Finder.
5. Select **everything inside the folder** (Cmd+A) — **except** the
   `node_modules` folder if one exists (it's huge and not needed; GitHub
   would reject it anyway).
6. Drag the selected files into the GitHub upload box in your browser.
   Make sure these are included: `server.js`, `package.json`, `railway.toml`,
   `Procfile`, and the `src` and `public` folders.
7. Click **Commit changes** and wait for the upload to finish.

> Tip for later: if you ever change the code, upload the changed files the
> same way — Railway will automatically redeploy.

## Step 3 — Deploy on Railway (3 minutes)

1. Go to **https://railway.com/new** (or click **+ New Project** in Railway).
2. Choose **Deploy from GitHub repo**.
3. The first time, click **Configure GitHub App** and give Railway access to
   your `physician-dashboard` repository.
4. Click the **physician-dashboard** repo in the list.
5. Click **Deploy**.
6. Watch the build log. It will install dependencies and start the server.
   When you see a green **Success** / **Active** badge (usually 1–3 minutes),
   the app is running. Railway automatically checks the app's built-in
   health page (`/api/health`) before marking it live.

You don't need to set any environment variables — the app works out of the box.

## Step 4 — Get your public URL (1 minute)

1. In your Railway project, click the **physician-dashboard** service (the box
   in the middle of the screen).
2. Open the **Settings** tab.
3. Under **Networking → Public Networking**, click **Generate Domain**.
4. If it asks for a port, choose the one it suggests (Railway detects it
   automatically).
5. You'll get a URL like:

   `https://physician-dashboard-production-a1b2.up.railway.app`

6. Click it. Your dashboard is live. Open the same URL on your phone —
   it works from anywhere, not just your WiFi.

## Step 5 — After deployment

- **Bookmark the URL** on your phone: open it in Safari → Share →
  **Add to Home Screen**. It now behaves like an app icon.
- **Verify it's healthy** any time by opening `YOUR-URL/api/health` —
  you should see `{"ok":true,"app":"physician-dashboard"}`.
- **Demo data:** the app seeds itself with realistic demo data
  (emails, calendar, finances, shifts) on first run automatically.

### Optional: keep your data across redeploys

By default Railway's disk is wiped on each redeploy/restart, and the app
simply re-creates its demo data. If you start entering real data and want it
to persist:

1. In your Railway project, right-click the service → **Attach Volume**
   (or Settings → Volumes → **Add Volume**).
2. Set **Mount path** to `/data`.
3. Go to the **Variables** tab, click **New Variable**, and add:
   - Name: `DATA_DIR`  Value: `/data`
4. Click **Deploy** to apply. Your database now lives on the volume and
   survives restarts and updates.

### A note on privacy

The generated URL is public — anyone who has the exact link can open the app.
The demo data is fictional, so that's fine for showing it off. If you later
put real personal/patient information in it, tell me and we can add a login
password first.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Build fails with `node_modules` errors | Make sure you did NOT upload the `node_modules` folder. Delete it from the repo (GitHub → the folder → delete) and redeploy. |
| Build succeeds but "Healthcheck failed" | Open the **Deploy Logs** tab. The app prints its startup banner when healthy. If you see a crash, copy the red error text and ask me. |
| Page shows "Application failed to respond" | Wait 60 seconds (first boot compiles the database driver), then refresh. Still broken? Check that `Procfile` and `railway.toml` were uploaded. |
| Changes I made aren't showing | Railway redeploys when you commit to GitHub. Check the **Deployments** tab — a new deployment should appear after each upload. |
| Data disappeared after a redeploy | That's expected without a volume — see "keep your data across redeploys" above. |

---

## What was pre-configured for you (no action needed)

- `railway.toml` — tells Railway how to build, start, and health-check the app
- `Procfile` — declares the web process (`node server.js`)
- `package.json` — `npm start` runs the production server
- `server.js` — listens on Railway's assigned `PORT` and binds to `0.0.0.0`
- `/api/health` — health check endpoint Railway pings before routing traffic
- `src/db/database.js` — honors `DATA_DIR` for persistent volume storage
- `.env.example` — reference list of every environment variable (all optional)
