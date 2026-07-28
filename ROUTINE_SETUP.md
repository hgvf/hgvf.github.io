# 自動化：供應鏈新聞（每日）＋ 財報分析（手動）

兩個區塊的**資料都存在 Firebase Firestore**，頁面是靜態外殼、在瀏覽器端即時讀取渲染。
→ 新增／更新內容只要寫進 Firestore，**頁面立即反映，不需 rebuild、不需 git push**。

| 區塊 | 頁面 | Firestore collection | 更新方式 |
|------|------|----------------------|----------|
| 供應鏈瓶頸新聞 | `supply-chain/index.html` | `supply_chain_news` | **每日自動**（Routine） |
| 財報電話會議分析 | `earnings/index.html` | `earnings_calls` | **手動**（Claude Code web session） |

每個頁面都有：時間軸圖（節點依日期排列、點節點跳到對應卡片、日後可疊股價線）＋ 可讀卡片＋ ticker 標註＋ 偏多/偏空標色。首頁 **Quick Links** 有兩個入口。

> 全程使用 claude.ai 訂閱額度，不需 Claude API。

---

## 0. 一次性前置

1. **部署 Firestore 規則**（新增了 `supply_chain_news`、`earnings_calls` 兩個 collection，公開讀、白名單寫）：
   ```
   firebase deploy --only firestore:rules
   ```
   或把 `firestore.rules` 內容貼到 Firebase Console → Firestore → Rules → Publish。
2. 準備 **service account JSON**（Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰）。
   寫入 Firestore 用 Admin SDK，會繞過安全規則。

---

## A. 供應鏈新聞 — 設定 Routine（一次性）

在 **[claude.ai/code/routines](https://claude.ai/code/routines) → New routine**（或 CLI `/schedule`）：

1. **Repository**：`hgvf/hgvf.github.io`（用來取得 `scripts/publish.py`；本流程**不需 push**）。
2. **Trigger → Schedule → Daily**，挑當地早上、避開 `12:00 UTC`（例如台北 **08:07**）。
3. **環境設定**：
   - **Network access → Full**（要抓任意新聞網站，也要連 `firestore.googleapis.com`）。
   - **Environment variable**：`FIREBASE_SERVICE_ACCOUNT` = 整包 service account JSON（貼原文）。
   - **Setup script**：`pip install google-auth requests`
     （改用 Firestore REST API，**不裝 firebase-admin**，避開 grpcio 安裝失敗。）
4. **Prompt**：貼下方那段。
5. **Create** → 先按 **Run now** 測一次，點進 run 確認新聞有抓到、`publish.py` 有成功寫入，再開網頁看是否出現。

### Routine prompt（直接複製）

```
You curate the supply-chain news feed for a personal dashboard. Steps:

1. Use WebSearch (and WebFetch for detail) to find the most important
   supply-chain bottleneck news from the last 24-48 hours: shipping/port
   congestion, semiconductor and component shortages, freight rates,
   key-material supply disruptions, export controls affecting supply.
2. Select the 5-8 most material items. For EACH item build an object:
   {
     "date": "<ISO date the news refers to, YYYY-MM-DD>",
     "tickers": ["<related stock tickers, e.g. NVDA, TSM; [] if none>"],
     "headline": "<concise headline in Traditional Chinese>",
     "content": "<1-3 sentence summary + why it matters, Traditional Chinese>",
     "sentiment": "bullish | bearish | neutral  (for the related names)",
     "effect": "<下游如何被影響、哪些產品成本被堆高，Traditional Chinese; \"\" if unknown>",
     "advise": "<簡短投資建議, Traditional Chinese; \"\" if none>",
     "sources": [{"title": "<source name>", "url": "<link>"}]
   }
3. Write the array to /tmp/news.json as {"items": [ ... ]}.
4. Run: python scripts/publish.py --type news --file /tmp/news.json
   (credentials come from the FIREBASE_SERVICE_ACCOUNT env var).
5. Confirm the script printed "Published N news item(s)". Do NOT commit or
   push anything — the data lives in Firestore and the page reads it live.
```

---

## B. 財報分析 — 手動流程（每份 transcript 一次）

開一個 **Claude Code web session** 在 `hgvf/hgvf.github.io`（環境同樣設 `FIREBASE_SERVICE_ACCOUNT` 與 `pip install google-auth requests`），貼上／上傳 transcript，說：

> 分析這份 transcript，整理成一個 earnings call 物件：ticker、company、year、
> quarter、date、summary（一句話總結），以及 highlights 陣列——每個重點含
> text 與 sentiment（bullish／bearish／neutral），涵蓋營運財務、財測展望、
> **供應鏈訊號**、風險。寫成 `/tmp/call.json`（格式 `{"calls":[ ... ]}`），
> 再執行 `python scripts/publish.py --type earnings --file /tmp/call.json`。
> 不要 commit / push，資料進 Firestore 即可。

> 若想沿用 claude.ai **Project**：在 Project 裡分析完，把整理好的 JSON 貼進
> Claude Code web session 執行 `publish.py`（Project 聊天本身無法寫 Firestore）。

也可在本機跑：`python scripts/publish.py --type earnings --file call.json --credentials sa.json`

---

## 資料格式速查（`scripts/publish.py`）

- **news**：`{"items": [ {date, tickers[], headline, content, sentiment, effect?, advise?, sources[]} ]}`（`effect`／`advise` 選填，舊資料沒有也不影響）
- **earnings**：`{"calls": [ {ticker, company, year, quarter, date, summary, highlights:[{text, sentiment}]} ]}`
- doc id 由內容決定（news = date+headline、earnings = ticker-year-quarter），**重跑會更新、不會重複**。
- `sentiment` 只接受 `bullish` / `bearish` / `neutral`，其他值一律當 `neutral`。

## 之後想加股價線？
`js/reports.js` 的 `renderTimeline(host, items, { priceSeries })` 已支援：
只要傳入 `priceSeries: [{date, close}]`，節點就會落在股價線上（圖一那樣）。
目前 worker 只存漲跌%、沒存整條收盤序列；要畫線需另外提供每日收盤資料。
