# hgvf.github.io — Setup Guide

Personal investment watchlist site hosted on GitHub Pages, backed by Firebase Firestore, with price fetching via Cloudflare Workers.

---

## 1. Firebase Setup

### 1.1 Create Firebase project
1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project**

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
3. Copy the config object and fill in `js/config.js`

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
- **Schedule**: `0 10 * * 2-6` — 10:00 UTC, Tuesday–Saturday
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

---

## 9. 資料備份與合併工作流

### 9.1 兩個 write path 的差異

| 路徑 | 說明 |
|------|------|
| **UI 操作** | 直接寫入 Firestore（即時生效，但不會自動更新 JSON） |
| **編輯 `data/watchlist.json`** | 只更新 repo 裡的冷備份，Firestore 不受影響，需手動 import 才同步 |

### 9.2 ⚠️ import 之前必須先 export 一次

`data/watchlist.json` 的原始種子格式（ticker 沒有 id）直接 import 會產生**重複資料**。
必須先 export 取得帶 id 的版本，後續才能安全地 import。

```bash
pip install firebase-admin

# 只做一次：把 Firestore 現況 dump 成帶 id 的 JSON
python scripts/backup.py --export --credentials scripts/serviceAccount.json
git commit -am "sync: rebuild watchlist.json with firestore ids"
```

做完之後 `data/watchlist.json` 每筆 sector / subsector / ticker / analysis / note 都會帶 Firestore document id，後續所有 import 都是 **merge（原地更新，不刪不覆蓋無關欄位）**。

### 9.3 日常備份（Firestore → JSON）

```bash
python scripts/backup.py --export --credentials scripts/serviceAccount.json
git commit -am "backup: $(date +%Y-%m-%d)"
git push
```

### 9.4 同時存在 UI 修改與手動 JSON 修改時的合併流程

```bash
# 1. 把 UI 那邊（Firestore 最新狀態）匯出到暫存檔，避免覆蓋本地改動
python scripts/backup.py --export --credentials scripts/serviceAccount.json \
    --watchlist data/_live.json

# 2. 比對兩份 JSON，把非衝突的改動合併到 data/watchlist.json
#    （兩邊改的是不同 doc / 不同欄位 → 通常幾乎不衝突）
#    用任何 JSON diff 工具或 git merge 合併

# 3. 把合併結果推回 Firestore（帶 id → 原地更新，不會重複也不會刪東西）
python scripts/backup.py --import --credentials scripts/serviceAccount.json

# 4. 再 export 一次標準化，確保 JSON 與 Firestore 一致，然後 commit
python scripts/backup.py --export --credentials scripts/serviceAccount.json
git commit -am "merge: ui + manual edits"
rm data/_live.json
```

**心智模型：Firestore 是合併點。** import 是 additive-merge：只新增 / 更新，永不刪除。兩邊各自增加不同 doc 時，import 後兩邊都會保留。

### 9.5 關於刪除

import 永不刪除 Firestore 裡的資料。若想刪除某個 ticker / 題材，只能：
- 在 UI 上點 ✕ 刪除，或
- 到 Firebase Console → Firestore 手動刪除

### 9.6 冷備援：seed.html

`seed.html` 的兩個按鈕等同 `backup.py --import`，但只在瀏覽器裡跑、不需要 Python 環境。
**注意**：使用 seed.html 之前同樣需要先確認 JSON 帶有正確的 id，否則會產生重複資料。

### 9.7 serviceAccount.json 安全提醒

`scripts/serviceAccount.json` 是 Firebase 最高權限金鑰，請確認：
- 加入 `.gitignore`（`scripts/serviceAccount.json`）
- **不要 commit 到 GitHub**，否則任何人都能讀寫整個資料庫
