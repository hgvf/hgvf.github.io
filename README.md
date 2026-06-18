# hgvf.github.io — Setup Guide

Personal investment watchlist site hosted on GitHub Pages, backed by Firebase Firestore, with price fetching via Cloudflare Workers.

---

## 1. Firebase Setup

### 1.1 Create Firebase project
1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project**
2. Use project ID: `watchlist-12e29` (already set in code)

### 1.2 Enable Firestore
1. Firebase Console → **Firestore Database** → **Create database**
2. Start in **production mode** (rules are set below)
3. Choose a region (e.g. `asia-east1`)

### 1.3 Enable Authentication
1. Firebase Console → **Authentication** → **Get started**
2. Enable **Google** sign-in provider

### 1.4 Get web app config
1. Firebase Console → Project Settings → **Your apps** → **Add app** → Web
2. Register the app (name it anything)
3. Copy the config object and fill in `js/config.js`:

```js
export const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",       // ← fill in
  authDomain:        "watchlist-12e29.firebaseapp.com",
  projectId:         "watchlist-12e29",
  storageBucket:     "watchlist-12e29.appspot.com",
  messagingSenderId: "64065653725",
  appId:             "YOUR_APP_ID",        // ← fill in
};
```

### 1.5 Bootstrap config documents
In Firebase Console → Firestore → **Start collection** → create these documents manually:

**Collection: `config` / Document: `auth`**
```json
{
  "allowed_emails": ["your-google-email@gmail.com"]
}
```

**Collection: `config` / Document: `worker`**
```json
{
  "trigger_secret": "your-random-secret-string"
}
```
(Use a long random string for `trigger_secret`. Generate with: `openssl rand -hex 32`)

---

## 2. Deploy Firestore Security Rules

Install the Firebase CLI and deploy rules:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # select existing project watchlist-12e29
# when asked for rules file: firestore.rules (already exists)
firebase deploy --only firestore:rules
```

Or paste the contents of `firestore.rules` directly into Firebase Console → Firestore → **Rules** tab.

---

## 3. Cloudflare Worker Setup

### 3.1 Install Wrangler

```bash
cd worker
npm install
```

### 3.2 Create a Firebase Service Account
1. Firebase Console → Project Settings → **Service accounts**
2. Click **Generate new private key** → download the JSON file

### 3.3 Set Worker secrets

```bash
# Set the trigger secret (must match what you put in Firestore config/worker)
wrangler secret put TRIGGER_SECRET
# Paste your secret string when prompted

# Set the service account (paste the entire JSON content)
wrangler secret put FIREBASE_SERVICE_ACCOUNT
# Paste the entire service account JSON when prompted (single line or multiline)
```

### 3.4 Update WORKER_URL in js/config.js

```bash
wrangler deploy --dry-run  # shows the worker URL
```

Then update `js/config.js`:
```js
export const WORKER_URL = "https://watchlist-worker.YOUR_SUBDOMAIN.workers.dev";
```

### 3.5 Deploy the Worker

```bash
wrangler deploy
```

### 3.6 Test manual trigger

```bash
curl -X POST https://watchlist-worker.YOUR_SUBDOMAIN.workers.dev/trigger \
  -H "Authorization: Bearer your-trigger-secret"
```

---

## 4. Initial Data Seeding

If you have existing data in `data/watchlist.json` and `data/prices.json`:

```bash
pip install firebase-admin
python scripts/seed.py --credentials path/to/service-account.json
```

To seed from scratch, add sectors/subsectors/tickers via the admin UI instead.

---

## 5. Adding Yourself to the Whitelist

The first admin email must be added directly in Firebase Console to `config/auth.allowed_emails`.

After you are in the whitelist:
1. Sign in on the site (sidebar → **Sign In** button)
2. Click **Manage Whitelist** to add other emails

---

## 6. Daily Price Update Schedule

The Cloudflare Worker runs automatically via cron:
- **Schedule**: `0 2 * * 2-6` — 02:00 UTC, Tuesday–Saturday
  (covers Monday–Friday US market closes, accounting for timezone)

You can also trigger manually with the **Refresh Prices** button in the UI (admin only can see the secret, but the button is visible to all — you can adjust CSS if desired).

---

## 7. Project Structure

```
index.html              — Main SPA entry point
css/style.css           — All styles (wood-tone glassmorphism design)
js/
  config.js             — Firebase config + Worker URL (fill in your keys)
  db.js                 — Firestore CRUD functions
  auth.js               — Google Auth helpers
  render.js             — DOM rendering (sectors, tables, research cards)
  admin.js              — Admin modals (CRUD UI)
  app.js                — Main entry point, orchestration
data/
  watchlist.json        — Cold backup (structure only, no prices)
  prices.json           — Cold backup (price snapshots)
scripts/
  seed.py               — Seed Firestore from JSON backups
  backup.py             — Export/import Firestore ↔ JSON
worker/
  src/index.js          — Cloudflare Worker (price fetching)
  wrangler.toml         — Worker config
  package.json          — Dev dependencies
firestore.rules         — Security rules
```

---

## 8. No Build Step

The frontend uses ES modules loaded directly from CDN (Firebase v10.12.2). No webpack, no bundler. Just push to GitHub and GitHub Pages serves it.
