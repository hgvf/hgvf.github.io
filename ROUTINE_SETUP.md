# 自動化：供應鏈新聞（每日）＋ 財報分析（手動）

兩個區塊的**資料都存在 Firebase Firestore**，頁面是靜態外殼、在瀏覽器端即時讀取渲染。
→ 新增／更新內容只要寫進 Firestore，**頁面立即反映，不需 rebuild、不需 git push**。

| 區塊 | 頁面 | Firestore collection | 更新方式 |
|------|------|----------------------|----------|
| 供應鏈瓶頸新聞 | `supply-chain/index.html` | `supply_chain_news` | **每日自動**（Routine） |
| 產業消息 | `industry-news/index.html` | `supply_chain_events`＋`supply_chain_daily_digest` | **每日自動**（Routine，supply-chain-intelligence-daily skill） |
| 重點新聞（收藏彙整） | `highlights/index.html` | —（瀏覽器 localStorage，跨頁共用收藏） | 由上述頁面點 🔖 收藏 |
| 財報電話會議分析 | `earnings/index.html` | `earnings_calls` | **手動**（Claude Code web session） |

`產業消息` 用 `scripts/publish.py --type events --file <skill_output.json>` 發布：每個 event upsert 到
`supply_chain_events/<event_id>`（冪等），並把當日 digest 寫入 `supply_chain_daily_digest/<event_date>`。
可用 `--collection` / `--digest-collection` 覆寫目標 collection。

每個頁面都有：時間軸圖（節點依日期排列、點節點跳到對應卡片、日後可疊股價線）＋ 可讀卡片＋ ticker 標註＋ 偏多/偏空標色。首頁 **Quick Links** 有兩個入口。

> 全程使用 claude.ai 訂閱額度，不需 Claude API。

---

## 0. 一次性前置

1. **部署 Firestore 規則**（含 `supply_chain_news`、`earnings_calls`、以及新增的 `supply_chain_events`、`supply_chain_daily_digest`，皆公開讀、白名單寫）：
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

> 完整格式規格另存於 [`SUPPLY_CHAIN_NEWS_SCHEMA.md`](SUPPLY_CHAIN_NEWS_SCHEMA.md)。

```
You build a SUPPLY-CHAIN BOTTLENECK news feed for a personal investing
dashboard. This is NOT a general market/price-move feed — only include news
that is about a genuine supply-chain BOTTLENECK or a STRUCTURAL change to a
supply chain.

SELECTION (last 24-48h). Include an item only if it is one of:
  - a bottleneck: shortage, capacity/throughput constraint, lead-time blowout,
    single-source or chokepoint risk, key material/equipment disruption,
    export controls that restrict supply; OR
  - a structural shift that rewrites industry rules or a traditional supply
    chain: a new entrant, domestic substitution breaking a monopoly, or new
    tech that reroutes the chain. Example: "China DUV immersion litho reaches
    volume shipment; SMIC / Hua Hong / CXMT place orders within the year."
Skip generic index moves, earnings beats/misses, and price commentary that
carry no supply-chain angle. Pick the 5-8 most material items.

For EACH item, RESEARCH beyond the headline and build this object. Every field
except date/headline/content is OPTIONAL — use "" or [] when unknown; never
fabricate. Try to fill "chain", "alternatives" and "signals" whenever the
story is about a real bottleneck.

{
  "date": "<YYYY-MM-DD the news refers to>",
  "headline": "<concise headline, Traditional Chinese>",
  "content": "<1-3 sentence summary + why it matters, Traditional Chinese>",
  "tickers": ["<related tickers, e.g. TSM, 2317.TW; [] if none>"],
  "sentiment": "bullish | bearish | neutral  (for the related names)",
  "credibility": "高 | 中 | 低  (source reliability + corroboration)",
  "tags": ["<bottleneck keywords/themes, e.g. CoWoS, ABF substrate>"],
  "effect": "<下游如何被影響、哪些產品成本被墊高，Traditional Chinese>",
  "advise": "<簡短投資建議，Traditional Chinese>",
  "chain": {
    "upstream":   [{"name": "<company/material>", "note": "<how affected>"}],
    "midstream":  [{"name": "<company>", "note": "<how affected>"}],
    "downstream": [{"name": "<company>", "note": "<how affected>"}]
  },
  "alternatives": [
    {"name": "<incumbent>", "share": "<e.g. 95%>", "incumbent": true, "note": "..."},
    {"name": "<substitute company/product>", "share": "<e.g. ~5%>", "note": "..."}
  ],
  "signals": "<clues from recent earnings/revenue/call transcripts that
              corroborate the bottleneck, Traditional Chinese>",
  "sources": [{"title": "<source>", "url": "<link>"}]
}

To fill "chain" / "alternatives", trace who is upstream/mid/downstream of the
bottleneck, whether a substitute product or company exists, and the market
share of the incumbent vs the substitute. For "signals", check the last few
quarters' earnings / revenue / call transcripts of the named companies for
corroborating evidence.

STEPS:
1. Write the array to /tmp/news.json as {"items": [ ... ]}.
2. Run: python scripts/publish.py --type news --file /tmp/news.json
   (credentials come from the FIREBASE_SERVICE_ACCOUNT env var).
3. Confirm it printed "Published N news document(s)". Do NOT commit or push —
   the data lives in Firestore and the page reads it live.
```

---

## B. 財報分析 — 手動流程（每份 transcript 一次）

開一個 **Claude Code web session** 在 `hgvf/hgvf.github.io`（環境同樣設 `FIREBASE_SERVICE_ACCOUNT` 與 `pip install google-auth requests`），貼上／上傳 transcript，也可直接在 earnings 頁的「匯入 JSON」面板貼上。要求 AI 產生的格式：

```json
{
  "calls": [
    {
      "ticker": "IONQ",
      "company": "IonQ, Inc.",
      "year": 2026,
      "quarter": "Q2",
      "date": "2026-08-05",
      "summary": "一句話總結（繁中）。",
      "highlights": [
        { "text": "Q2 營收年增 287%，創新高。", "sentiment": "bullish" },
        { "text": "調整後 EBITDA 虧損擴大。", "sentiment": "bearish" },
        { "text": "管理層對 Q-Day 時間點描述保守。", "sentiment": "neutral" }
      ],
      "watch": [
        "9/8 Investor Day：確認合併財測、客戶訂單、256-qubit 細節",
        "SkyWater 合併財測與整合進度、內部交易抵銷影響",
        "256-qubit 系統 2027 上半年 commissioning 進度"
      ]
    }
  ]
}
```

- `highlights`：每個重點含 `text` 與 `sentiment`（`bullish`／`bearish`／`neutral`），涵蓋營運財務、財測展望、**供應鏈訊號**、風險。
- `watch`（選填）：**未來重點看點**字串陣列——之後該追蹤的催化劑／待確認事項；介面上會獨立成一張卡片。舊資料沒有也不影響。

寫成 `/tmp/call.json` 後執行 `python scripts/publish.py --type earnings --file /tmp/call.json`，不要 commit / push，資料進 Firestore 即可。

> 若想沿用 claude.ai **Project**：在 Project 裡分析完，把整理好的 JSON 貼進
> Claude Code web session 執行 `publish.py`（Project 聊天本身無法寫 Firestore）。

也可在本機跑：`python scripts/publish.py --type earnings --file call.json --credentials sa.json`

---

## 資料格式速查（`scripts/publish.py`）

- **news**：`{"items": [ {date, headline, content, tickers[], sentiment, credibility?, tags[]?, effect?, advise?, chain?, alternatives[]?, signals?, sources[]} ]}` — 完整規格見 [`SUPPLY_CHAIN_NEWS_SCHEMA.md`](SUPPLY_CHAIN_NEWS_SCHEMA.md)；選填欄位不溯及既往、舊資料沒有也不影響。
- **earnings**：`{"calls": [ {ticker, company, year, quarter, date, summary, highlights:[{text, sentiment}], watch[]?} ]}`（`watch` 未來重點看點選填，舊資料沒有也不影響）
- doc id 由內容決定（news = date+headline、earnings = ticker-year-quarter），**重跑會更新、不會重複**。
- `sentiment` 只接受 `bullish` / `bearish` / `neutral`，其他值一律當 `neutral`。

## 之後想加股價線？
`js/reports.js` 的 `renderTimeline(host, items, { priceSeries })` 已支援：
只要傳入 `priceSeries: [{date, close}]`，節點就會落在股價線上（圖一那樣）。
目前 worker 只存漲跌%、沒存整條收盤序列；要畫線需另外提供每日收盤資料。

---

## 事實追蹤 — 自動更新 Routine（`fact-tracker` skill）

把 `事實追蹤`（`tracked_facts` collection）裡「追蹤中」的法說事實 / 未來看點，每隔幾天自動上網找最新進展並回填。事實**由你在網站上收藏建立**，Routine 只負責更新、不新增。

| 元件 | 用途 |
|------|------|
| `skills/fact-tracker/SKILL.md` | 給 Claude Code 的技能（跨市場，含研究準則與 JSON 格式） |
| `scripts/facts_pull.py` | 把追蹤事實拉下來給模型研究 |
| `scripts/facts_push.py` | 把研究出的更新 merge 回 Firestore（只更新、去重、可 `--dry-run`） |

**設定 Routine**（[claude.ai/code/routines](https://claude.ai/code/routines) → New routine）：
1. **Repository**：`hgvf/hgvf.github.io`（取得 skill 與 scripts）。
2. **Trigger → Schedule**：每 3 天一次即可。
3. 環境變數 `FIREBASE_SERVICE_ACCOUNT` = service account JSON 原文（同 `publish.py`）。
4. **Prompt** 例：`使用 fact-tracker skill 更新我的事實追蹤`。

技能會自動跑：
```
pip install -q google-auth requests
python scripts/facts_pull.py --status due --out /tmp/facts.json   # 只挑到期/未設下次檢查的
# → 逐一上網研究，只對「真的有新消息」的事實寫成 /tmp/facts_updates.json
python scripts/facts_push.py --file /tmp/facts_updates.json       # 先 --dry-run 預覽亦可
```

- `facts_push.py` 是 **read-merge-write**：不覆蓋既有欄位、`(date,text)` 重複的更新會跳過，重跑安全。
- 更新內容附來源與日期，並視證據推進狀態（待驗證→進展符合／落後預期／已驗證／已失效），寫入後網站即時反映。
