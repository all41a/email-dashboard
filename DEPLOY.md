# Deploy Your Email Dashboard to Railway

**Total time: about 10 minutes. No coding. No terminal. Just clicking and dragging.**

You will do two things:
1. Put your app files on GitHub (a free website that stores code) — by dragging and dropping.
2. Tell Railway (a free hosting website) to run them.

Follow every step in order. Do not skip steps.

---

## Part 1 — Put the app on GitHub (5 minutes)

### Step 1: Create a free GitHub account (skip if you have one)

1. Go to **https://github.com/signup**
2. Enter your email (aneshpatel.md@gmail.com works fine), create a password, pick any username.
3. Verify your email when GitHub sends you a code.

### Step 2: Create a new repository (a "repository" is just a folder on GitHub)

1. Go to **https://github.com/new**
2. In the **Repository name** box, type: `email-dashboard`
3. Leave everything else exactly as it is (keep it **Public** — Railway's free tier needs this, and there are no passwords or secrets in these files).
4. **IMPORTANT: check the box that says "Add a README file."** (This makes the drag-and-drop upload page available. If you skip this, the next step won't work.)
5. Click the green **Create repository** button at the bottom.

### Step 3: Upload the app files by drag and drop

1. You are now looking at your new repository page. Click the **"Add file"** button (near the top right, next to the green "Code" button), then click **"Upload files"** from the dropdown.
2. Open **Finder** on your Mac and go to the `email-dashboard-complete` folder on your computer.
3. Open the folder so you can see the files inside it (`package.json`, `server.js`, `db.js`, `railway.toml`, and the `public` and `lib` folders).
4. Select **everything inside the folder**: click once inside the Finder window, then press **Cmd+A** (select all).
5. **Drag all the selected items** from Finder into the big dashed box on the GitHub page that says "Drag files here to add them to your repository."
6. Wait until the file list appears below the box. You should see at least these names listed:
   - `package.json`
   - `server.js`
   - `db.js`
   - `railway.toml`
   - `lib/sweeper.js` (**required** — the app won't start without it)
   - `public/index.html`, `public/app.js`, `public/styles.css`
7. Scroll down and click the green **"Commit changes"** button.
8. Wait a few seconds. Your repository page now shows all the files.

**Common mistakes to avoid in this step:**
- Do NOT drag the `email-dashboard-complete` folder itself. Drag the files **inside** it. (If you drag the whole folder, GitHub nests everything one level deep and Railway won't find `package.json`.)
- If you see a folder called `node_modules` in Finder, do NOT upload it. (You probably won't see one — that's normal.)
- Files starting with a dot (like `.env.example`) may be invisible in Finder and won't get dragged. **That is fine.** They are not needed for deployment.

---

## Part 2 — Deploy on Railway (5 minutes)

### Step 4: Create a free Railway account

1. Go to **https://railway.com** (it may also appear as railway.app — same site).
2. Click **"Login"** (top right), then choose **"Login with GitHub."**
3. GitHub will ask you to authorize Railway. Click the green **"Authorize"** button.
4. If Railway asks you to verify your account, follow the prompts (this is normal for free accounts and prevents abuse).

### Step 5: Deploy your repository

1. On the Railway dashboard, click the **"+ New"** button (or "New Project").
2. Choose **"Deploy from GitHub repo."**
3. If Railway says it needs access to your repositories, click **"Configure GitHub App"**, choose your GitHub account, select **"All repositories"** (simplest), and click **Save**. You'll land back on Railway.
4. Click on **`email-dashboard`** in the list of repositories.
5. Click **"Deploy"** (or "Deploy Now").
6. Railway now builds your app. You'll see a card/tile for the service with logs scrolling by. **Wait 1–3 minutes** until the status says **"Active"** or shows a green checkmark ("Deployment successful").

**If the build fails:** click the deployment to open the logs, scroll to the bottom, and read the last red line. The most common cause is the Part 1 mistake — files nested inside an extra folder. Open your GitHub repo page and confirm `package.json` is visible on the front page of the repo, not inside a subfolder. If it's nested, delete the repo (repo Settings → scroll to bottom → Delete this repository) and redo Step 3 correctly.

### Step 6: Get your live URL (do not skip — the app has no address until you do this)

1. In your Railway project, **click on the service card** (the tile named `email-dashboard`).
2. Click the **"Settings"** tab.
3. Find the **"Networking"** section (sometimes called "Public Networking").
4. Click **"Generate Domain."**
5. If it asks for a port, type **3000** and confirm. (Usually it detects this automatically.)
6. Railway shows you a URL like:

   **`https://email-dashboard-production-xxxx.up.railway.app`**

7. Click it. **That's your live email dashboard.** Bookmark it — this URL works from any device, anywhere.

---

## Part 3 — After deployment: test it (2 minutes)

The app starts **pre-loaded with demo data** (sample emails across Gmail, Outlook, and Yahoo demo accounts) so you can try everything immediately:

- **Unified inbox** — see emails from all demo accounts in one list.
- **Priority view** — important emails float to the top.
- **Categories** — emails sorted into buckets (spam/promotions decluttered away).
- **VIP list** — mark senders as VIPs and see their mail highlighted.
- **Drafts** — the app can prepare reply drafts that wait for your approval; nothing sends without you clicking approve.

Click around. Nothing you do in demo mode affects any real email account.

**Connecting your real Gmail/Outlook/Yahoo accounts** is a separate, optional step later. It requires creating OAuth credentials with Google/Microsoft/Yahoo and adding them as environment variables in Railway (see `.env.example` for the list). Do the demo test first; connect real accounts only when you're ready.

---

## Quick answers

| Question | Answer |
|---|---|
| How much does this cost? | Railway's trial/free tier covers a small app like this. If you exceed it, the Hobby plan is ~$5/month. |
| Is my data safe? | Demo mode contains only fake sample emails. No real email account is connected yet. |
| The page shows an error or won't load | Wait 60 seconds and refresh — the app may still be starting. Then check Step 6 was completed (no domain = no page). |
| "Application failed to respond" | In Railway: service → Settings → Networking → make sure the target port is **3000**. |
| I want to update the app later | Edit/re-upload files in your GitHub repo (Add file → Upload files, overwrite is automatic). Railway redeploys automatically within a minute or two. |
| Where's my URL again? | Railway dashboard → your project → click the service → Settings → Networking. |

---

## One-page cheat sheet

1. github.com/new → name it `email-dashboard` → check "Add a README" → Create.
2. Add file → Upload files → drag the **contents** of the email-dashboard-complete folder in (including the `lib` and `public` folders) → Commit changes.
3. railway.com → Login with GitHub.
4. + New → Deploy from GitHub repo → pick `email-dashboard` → Deploy.
5. Click the service → Settings → Networking → **Generate Domain**.
6. Open the URL. Done.
