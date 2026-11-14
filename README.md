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

> ⚠️ **重要：改完 `worker/src/index.js` 一定要重新部署，程式碼進 repo 不會自動生效。**
> 若忘記重新部署，線上 Worker 仍跑舊版（例如 "Too many subrequests" 這類已修好的錯誤會持續出現）。
>
> **自動部署（建議）**：repo 內含 `.github/workflows/deploy_worker.yml`，只要
> 在 GitHub 加入 `CLOUDFLARE_API_TOKEN` secret（用 "Edit Cloudflare Workers" 範本建立
> 於 <https://dash.cloudflare.com/profile/api-tokens>），之後每次 `worker/**` 變更推到
> `main` 就會自動 `wrangler deploy`。也可在 Actions 分頁手動觸發（workflow_dispatch）。
> 既有的 `wrangler secret`（service account 等）會在部署間保留，不會被清掉。

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

## 6. Scheduled Automation (Workflow Execution Times)

All times are **UTC** (台灣時間 = UTC+8). The two daily Actions are ordered so
`update_changes` writes the week/month/year % **before** `sync_firestore`
exports the JSON, so the backup picks up the fresh values the same cycle.

| Automation | File | Schedule (cron) | Runs at | What it does |
|---|---|---|---|---|
| Intraday prices | `worker/wrangler.toml` (Cloudflare cron) | `0 10 * * 2-6` | **10:00 UTC, Tue–Sat** (18:00 台灣) | Worker fetches price, day %, P/E, market cap, volume (covers Mon–Fri US closes) |
| Week/Month/Year % | `.github/workflows/update_changes.yml` | `30 11 * * *` | **11:30 UTC daily** (19:30 台灣) | yfinance computes wk/mo/yr change % and **merges** into Firestore |
| Firestore → JSON backup | `.github/workflows/sync_firestore.yml` | `0 12 * * *` | **12:00 UTC daily** (20:00 台灣) | Exports `data/watchlist.json` + `data/prices.json` and commits |
| Worker deploy | `.github/workflows/deploy_worker.yml` | on push to `main` (`worker/**`) + manual | on demand | `wrangler deploy` when Worker code changes |
| Legacy price push | `.github/workflows/update_prices.yml` | manual only (disabled) | — | Superseded by `sync_firestore.yml` |

You can also trigger an intraday refresh on demand with the **Refresh Prices**
button in the UI (admin only). The manual refresh writes only the Worker-owned
intraday fields (via a Firestore `updateMask`), so it **preserves** the
week/month/year % written by `update_changes.yml`.

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

---

## 10. War Atlas（戰役地圖集，`war-atlas/`）

獨立的全螢幕地圖子網站（Leaflet），網址 `/war-atlas/`，Side Projects 頁的卡片與側邊欄 Side Project 資料夾連過去（定義在 `js/sideprojects.js`，`internal: true`）。新增戰役的流程與資料格式見 `skills/war-atlas/SKILL.md`。

| 資料來源 | 說明 |
|---|---|
| `war-atlas/data/battles/*.json` | 正本（GitHub）。skill 直接 commit 到這裡，之後跑 `python3 war-atlas/scripts/atlas.py build` 產生 `data/index.json` 與 `index.html` |
| Firestore `war_atlas_battles` / `war_atlas_wars` | 頁面上「＋ 新增」貼 JSON 登錄（白名單帳號），所有裝置立即可見 |
| `.github/workflows/sync_war_atlas.yml` | 每日 00:30 UTC 把 Firestore 的戰役拉回 `war-atlas/data/`、build、commit（可手動觸發） |

⚠️ 新增了 `war_atlas_*` 兩個 collection 的 rules，需重新部署 `firebase deploy --only firestore:rules`。

---

## 11. 下班倒數計時器（`countdown/`）

純前端靜態子網站，網址 `/countdown/`，Side Projects 頁卡片與側邊欄 Side Project 資料夾連過去（`js/sideprojects.js`，`internal: true`）。不需 build：原生 ES modules，直接由 GitHub Pages 提供。

| 檔案 | 說明 |
|---|---|
| `countdown/js/clock.js` | 唯一時間來源，每幀用 `target - now()` 重算進度（背景分頁不漂移） |
| `countdown/js/schedule.js` | 下班規則（固定時長 / 固定時刻 / 手動指定）→ 目標時間 |
| `countdown/js/events.js` / `eggs.js` | 彩蛋排程（整點翻牌、12:00、15:00、50%、最後一小時、稀有事件）與動畫 |
| `countdown/js/copy.js` | 荒謬時間換算文案（活動資料庫 + 模板，時長為估計值） |
| `countdown/js/finale.js` / `fx.js` | 最後 5 分鐘四幕像素煙火 |
| `countdown/js/themes/*.js` | 每個主題實作 `render(g, p, dt, st)` 與 `renderEnd()`，新增主題只要加檔案並登記在 `themes/index.js` |
| `countdown/js/sprites.js` | 鴨子、熊熊、狗、貓與道具，程式繪製的像素 sprite（32 色調色盤、自動描邊） |

主題共 15 個（`countdown/js/themes/`，七段顯示器共用 `segments.js`）。設定頁「倒數的目標」可把畫面上所有「下班」換成別的詞（放假、發薪日…），由 `pixel.js` 的 `relabel()` 統一替換，分頁標題與 DOM 文字也一起換。

字型為俐方體 11 號（`countdown/assets/Cubic_11.woff2`，授權見同目錄 OFL 檔）。試玩：設定 → 試玩預覽，或網址加 `?demo=last15`、`?demo=flip-bear`、`?demo=day` 等。


## 12. Side Project：旅遊分帳（`split/`）

列在 Side Project 的「工具與其他」（`js/sideprojects.js`，`requiresAuth: true`）。未登入時側欄與卡片按鈕會顯示鎖頭並擋下點擊（擋點擊的邏輯在 `js/tools.js` 的 `bindAuthGate`）；頁面本身也會擋，Firestore rules 再擋一次。

- 手機、電腦都可以用：手機用底部抽屜，電腦（寬度 ≥ 900px）改成左右兩欄加置中對話框，按 `N` 可以快速新增一筆
- 資料存在 `split_tables/{id}`，**一張分帳表一個 doc**，成員與所有款項都放在同一個 doc 的 `expenses.<id>` map 裡：開一張表只花 1 次讀取，多人同時新增也不會互相覆蓋
- 只有 `access` 名單內的 Gmail 能讀寫；只有建立者能改共同編輯名單、刪除分帳表
- 時區：每筆款項會記下 `tz`，預設是自動偵測的裝置時區，也可以手動改，同一張表會記住上次選的時區；時間和「哪一天」都以那筆款項自己的時區顯示
- 金額以最小貨幣單位的整數儲存（TWD/JPY 為 1，USD 為 cent），均分剩下的零頭會在成員間輪替
- 多人合付：一筆款項可以由好幾個人一起付，記在 `payers`（`{成員 id: 金額}`，加總必須等於總金額，否則不能儲存）。「誰付的」和「分給誰」完全分開：合付只影響每個人「已付」多少，不會改變分攤。`payer` 仍會設成出最多錢的人，篩選和舊版畫面都還能用；萬一 `payers` 加總對不上，計算時會忽略它、當成 `payer` 一人付，帳永遠平衡（`ledger.js` 的 `paidOf`）
- 多幣別：每筆款項記自己的 `cur`（沒有的話用表的主要幣別），各幣別分開記帳。到「結算」頁填匯率（存在 `rates`，所有成員共用），可以「合併成主要幣別結算」，也可以「各幣別分開結算」；合併時四捨五入的零頭會補到餘額最大的人身上，確保加總剛好是 0
- 邀請連結：建立者在設定裡產生 `split/#join=<表id>.<inviteCode>`。對方登入後會把自己的 email 加進 `access`，並把邀請碼寫在 `joinWith`；rules 只在邀請碼跟表上的 `inviteCode` 一致時才放行，而且這次寫入只能動到 `access`、`joinWith`、`updatedAt`。重設或關閉連結後，舊連結就失效
- 純邏輯在 `split/js/ledger.js`（結算、餘額、時區換算），動畫在 `split/js/fx.js`

⚠️ 新增了 `split_tables` 的 rules，需要重新部署：`firebase deploy --only firestore:rules`。


## 13. Side Project：你有紀律嗎?（盲測 K 線，`blind-chart/`）

全版面靜態頁，網址 `/blind-chart/`。不需 build：原生 ES modules，圖表用 CDN 的 lightweight-charts。

| 路徑 | 說明 |
|---|---|
| `blind-chart/engine/` | `@trainer/engine`：指標 registry、條件式 parser（禁用 eval）、sizing / 停損 / 停利 / 加碼 plugin、撮合、紀律判定、Counterfactual 報告。瀏覽器與 Node 共用 |
| `blind-chart/engine/test/` | `node --test blind-chart/engine/test/*.test.mjs`：指標對參考公式、未來函數、照規則操作 Actual = Shadow、各違規類型 |
| `blind-chart/tools/` | 出題：`inspect_parquet.py`、`sample_segments.py`（DuckDB）、`gen-puzzles.mjs` |
| `blind-chart/config/` | `universe.json`（流動性門檻）、`puzzles.json`（題庫參數） |
| `blind-chart/js/` | 前端：開始 / 遊戲 / 報告 / 歷史 / 策略編輯器，Session 存 IndexedDB |
| `.github/workflows/blind_chart_puzzles.yml` | 下載行情 Release → 出題 → force-push 到 orphan branch `blind-chart-puzzles` |

行情資料的上傳格式見 **`blind-chart/DATA.md`**。內建 15 個策略的說明、旋鈕、出處與題庫回測見 **`blind-chart/STRATEGIES.md`**（策略頁 `#/editor` 有總覽比較、旋鈕調整與快速回測；策略 JSON 寫法在 `#/guide`；給 Claude 用的策略產生 skill 在 `blind-chart/skill/discipline-strategy-json/SKILL.md`）（重跑回測：`node blind-chart/tools/backtest-presets.mjs --bank <題庫資料夾>`）。題庫還沒發佈前，頁面會自動改用合成示範題。

## 14. Side Project：賭財報（法說會盲猜，`earnings-guess/`）

| 路徑 | 說明 |
|---|---|
| `earnings-guess/pipeline/` | Python：`models.py`（Pydantic）、`redact.py`（去識別化 + 殘留檢查）、`reaction.py`（yfinance 反應）、`calendar_us.py`（NYSE 交易日，BMO / AMC → t0）、`pipeline.py`（排程規則、發佈）、`cli.py` |
| `earnings-guess/config/` | `benchmarks.yaml`（sector → ETF，以及 watchlist 板塊 → sector 對照）、`release.yaml`（每日張數、間隔、答案打散、區間邊界）、`meta.yaml`（補 sector / aliases / BMO-AMC / 指定釋出日）、`redact_allowlist.txt` |
| `earnings-guess/data/` | 已釋出的公開卡（只新增不覆蓋）與 `index.json` |
| `.github/workflows/earnings_guess_release.yml` | **手動執行**（Actions → Run workflow），把反應視窗已結束的卡全部上架（`per_day: 0` = 不限量）；可手動指定 `count` / `id` / `dry_run` |

佇列就是 Firestore 既有的 `earnings_calls`，排程狀態存在 Firestore `earnings_guess_state/schedule`（沒有 client rule，瀏覽器讀不到）。sector 依序取：卡片 → `meta.yaml` → watchlist 板塊（有對照用對照，沒有就直接用板塊名）→ `Other`（基準 SPY）。缺 BMO/AMC（yfinance 也推不出）或去識別化有疑慮的卡會開 GitHub Issue，補 `meta.yaml` 後下次排程自動重新檢查。

```bash
pip install -r earnings-guess/pipeline/requirements.txt
python earnings-guess/pipeline/cli.py validate --credentials scripts/serviceAccount.json   # 檢查所有卡
python earnings-guess/pipeline/cli.py release --credentials scripts/serviceAccount.json --dry-run
python earnings-guess/pipeline/cli.py plan --credentials scripts/serviceAccount.json --days 30
```

玩法：重點一張一張出現（按「下一張」），看完才能猜股價反應；情緒標籤只放在混淆過的 answer 裡，揭曉時才顯示。題庫頁只讀 `index.json`（每張附 90 字 teaser）並分頁顯示，卡片再多也不必逐張下載。卡片附法說前 40 根日 K（以 t0 前一天收盤 = 100 縮放），揭曉後接上法說後 20 根與產業 ETF；資料由 pipeline 一起算好放進卡片 JSON（每張約 3 KB），前端不打任何行情 API。

示範模式：`/earnings-guess/?demo=1`。
