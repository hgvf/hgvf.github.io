# 每日全球法說會蒐集 → 取原始文件 → 產 JSON → 上傳 Firestore（單一 Routine）

一份完整、可直接貼進 **[claude.ai/code/routines](https://claude.ai/code/routines)** 的 instruction，一次做到兩件事：

1. **階段一**：抓「前一個工作日」實際召開財報法說會／earnings call／investor conference 的公司（限科技／半導體／AI／資料中心／能源／國防／太空題材）。
2. **階段二**：對每一家蒐集到的公司，去官方來源取**原始文件**（法說會逐字稿、法說會簡報 PPT／PDF 等，**不是相關新聞**），產出財報電話會議 JSON，並**執行 `scripts/publish.py` 上傳到 Firestore**（collection `earnings_calls`，與現有財報電話會議完全相同的路徑與冪等 doc id）。

> 全程使用 claude.ai 訂閱額度，不需 Claude API。資料寫進 Firestore 後，`earnings/index.html` 立即反映，**不需 rebuild、不需 git push**。

---

## 一次性 Routine 環境設定

在 **[claude.ai/code/routines](https://claude.ai/code/routines) → New routine**：

1. **Repository**：`hgvf/hgvf.github.io`（用來取得 `scripts/publish.py`；本流程**不需 push**）。
2. **Trigger → Schedule → Daily**：挑當地早上、避開 `12:00 UTC`（例如台北 **08:30**）。
   - 週一會自動改抓「上週五」的法說會（見下方目標日期規則）。
3. **環境設定**：
   - **Network access → Full**（要抓 alphamemo、各市場法說會日程、公司 IR 官網，也要連 `firestore.googleapis.com`）。
   - **Environment variable**：`FIREBASE_SERVICE_ACCOUNT` = 整包 service account JSON（貼原文）。
   - **Setup script**：`pip install google-auth requests yfinance`
     （`google-auth requests` 供 `publish.py` 用；`yfinance` 供取法說會相關資料用。）
4. **Prompt**：貼下方〈Routine Prompt〉整段。
5. **Create** → 先按 **Run now** 測一次，點進 run 確認：階段一表格正確、階段二有抓到原始文件、`publish.py` 印出 `Published N earnings document(s)`，再開 `earnings/index.html` 確認卡片出現。

---

## 上傳機制速查（模型必須照做）

- 每一家公司整理成一筆 call 物件，全部收進 `{"calls":[ ... ]}`，寫成 `/tmp/call.json`。
- 執行上傳（**這一步是必要的，不可省略**）：

  ```bash
  python scripts/publish.py --type earnings --file /tmp/call.json
  ```

  憑證解析順序：`--credentials` →  `$FIREBASE_SERVICE_ACCOUNT`（Routine 已設）→ `scripts/serviceAccount.json`。本機測試可用
  `python scripts/publish.py --type earnings --file /tmp/call.json --credentials sa.json`。
- **doc id = `ticker-year-quarter`**（小寫、非英數轉 `-`），例如 `2330.tw-2026-q2`、`intc-2026-q2`。同一場會議重跑是**更新、不重複**。
- **不要 commit / push**；資料進 Firestore 即完成。上傳後 `publish.py` 會順帶更新 `indexes/ticker_events`。

---

# Routine Prompt（直接複製整段貼進 Routine）

```
你要為個人投資儀表板執行「每日全球法說會蒐集 → 取原始文件 → 產 JSON → 上傳 Firestore」的完整自動化。
本任務分兩階段，兩階段都要在同一次 run 內完成。全程用繁體中文輸出。

工作目錄是 repo hgvf/hgvf.github.io，內含 scripts/publish.py。環境已設 FIREBASE_SERVICE_ACCOUNT
與已安裝 google-auth / requests / yfinance。不要 commit、不要 push。

================================================================
目標日期規則（先算出唯一目標法說會日期 D）
================================================================
依「執行當日」決定 D：
- 週二至週五：D = 前一個日曆日。
- 週一：D = 上週五。
- 不得往更早日期回溯、不得用舊資料補足數量、不重複列同一家公司或同一場法說會。
- 判斷基準是「法說會／earnings call 實際召開日期」，不是財報發布日、新聞發布日或逐字稿上傳日。
- 我只要「前一個工作日」有開法說會或 earnings call 的公司，不要更早的。

================================================================
階段一：蒐集目標日期 D 當天實際召開法說會的公司
================================================================
搜尋全球市場（美國、台灣、日本、韓國、歐洲、中國／香港、加拿大及其他主要市場）。

來源優先順序：
1. 先從 https://www.alphamemo.ai/free-transcripts 找 D 當天開法說會／電話會議的公司（優先）。
2. 再補其他市場：
   - 美股 earnings 日程：https://earningshub.com/earnings-list/this-week
   - 台股法說會：https://finmoconf.diveinvest.net/
   - 自行搜尋可靠的日本、韓國、歐洲及其他市場法說會日程。
3. 以公司 IR、交易所公告、官方 earnings calendar 或正式公告確認「實際法說會日期」= D。
   可用 Yahoo Finance、Investing.com、Reuters、Bloomberg、MarketScreener 交叉確認。

題材篩選（只列與下列明確相關者）：
- 半導體與電子供應鏈：晶圓代工、IC 設計、GPU/CPU/ASIC、AI accelerator、HBM/DRAM/NAND、
  半導體設備、半導體材料、先進封裝、CoWoS/Chiplet、ABF/PCB/CCL、測試量測、EDA/半導體 IP、
  功率半導體、SiC/GaN、類比 IC、感測器、光電與 III-V。
- AI、雲端與資料中心：AI、Generative AI、AI infra、Cloud、Hyperscaler、Neocloud、
  Data center、Server/AI server、Networking/Ethernet/Switch、CPO、光通訊/光模組/矽光子、
  資料中心散熱/液冷、電源/UPS/Rack power、資料中心電力基建。
- 電力與能源：電網/Grid、變壓器/Transformer、開關設備/Switchgear、電力設備、核電/SMR、
  燃氣渦輪、燃料電池、儲能、資料中心用電，及與 AI／資料中心用電需求直接相關的公用事業或能源。
- 軟體與科技：Cybersecurity、企業軟體、資料庫/資料平台、可觀測性、AI 軟體、SaaS、自動化、
  Robotics、工業 AI、Edge AI。
- 國防、航太與太空：Defense、Aerospace、飛彈、雷達、無人機/UAV、軍用電子、衛星、火箭、
  太空基建、對地觀測、衛星通訊。
- 其他重要科技題材：Robotics、Physical AI、自駕、LiDAR、先進電池、量子運算、CXL、
  Edge computing、AR/VR，及當期市場熱門且與科技產業明確相關的族群。

排除純傳統產業（傳統金融、食品、一般零售、傳統紡織/營建、傳統原物料、航運、一般消費品），
但若公司有明確且重要的半導體／AI／資料中心／電網或 AI 用電／國防航太科技曝險，可納入。

階段一只做蒐集，不分析內容。用 Markdown 表格輸出，欄位固定：
| 公司 | Ticker | 市場／國家 | 法說會日期 | 財報季度／會議類型 | 主要題材 | 為何符合篩選 | 官方／主要來源 |
- 法說會日期用 YYYY-MM-DD，且必須 = D（實際會議日）。
- 財報季度／會議類型例：2026 Q2 Earnings Call / FY2026 Q1 Earnings Call / Investor Conference / Results Briefing。
- 主要題材用 1~4 個簡短標籤。
- 為何符合篩選：一句繁中。
- 官方／主要來源：可確認 D 的可靠連結，優先公司 IR 或交易所。

資料品質：不可僅因當天發財報就推定有法說會；來源衝突時以公司 IR／交易所為準；
無法確認實際法說會日期 = D 的，不列入表格。數量不限、不得為了數量刪減。

若 D 當天找不到符合條件的公司，只回報這一句並「結束整個任務、不執行階段二」：
「YYYY-MM-DD 未找到符合指定科技／半導體／AI／資料中心／能源／國防／太空題材，且可確認當日實際召開法說會的公司。」
（YYYY-MM-DD 換成 D，不得用其他日期補足。）

================================================================
階段二：對階段一每一家公司，取原始文件 → 產 JSON → 上傳 Firestore
================================================================
對階段一表格中「每一家」公司逐一處理：

A. 取得原始文件（一定要原始內容，不要只抓相關新聞）：
   1. 逐字稿／transcript：
      - 優先從 https://www.alphamemo.ai/free-transcripts 對應該公司該場的逐字稿。
      - 美股可用 yfinance 輔助取得法說會相關資料（例如：
        `python -c "import yfinance,json;print(json.dumps(yfinance.Ticker('NVDA').earnings_dates.reset_index().astype(str).to_dict(orient='records'),ensure_ascii=False))"`
        確認季度、EPS 預估/實際等；若該版 yfinance 提供逐字稿相關欄位也一併取用）。
      - 其餘市場（台/日/韓/歐等）到公司 IR 官網取法說會逐字稿或錄音。
   2. 簡報 PPT／PDF、新聞稿(press release)、財報數字：一律到公司 IR 官網／交易所公告下載原始檔，
      不要用二手新聞轉述。若有影音檔或連結而無逐字稿，先自行聽打／轉逐字稿再分析。
   3. 若某公司完全找不到任何原始文件（無逐字稿、無簡報、無官方新聞稿），
      在回報中標記「無原始文件、略過上傳」，不要用新聞硬湊，不列入 JSON。

B. 依原始文件做分析（每家一筆 call 物件）：
   - 先做公司業務與重大告知／消息摘要（summary，一句話繁中）。
   - highlights：逐一分析重要內容，並以外部或公開資訊交叉比對；每條精簡一句繁中，
     建議涵蓋「營運/財務、財測展望、供應鏈訊號、風險」四類，並納入公司派展望與未來方向；
     若有大變化（營利結構調整、新產品、策略轉向等）必須放進 highlights，
     並把「之後要盯的事」放進 watch。
   - watch：未來重點看點字串陣列（催化劑、待確認事項、下季該驗證的指引）。

C. 組成上傳 JSON（{"calls":[...]}），每筆 call 欄位：
   - ticker (string, 必填, 會用於 doc id，如 "NVDA"、"2330.TW")
   - year (number 整數, 必填, 不加引號, 如 2026)
   - quarter (string, 必填, 如 "Q2"/"Q4"/"FY")
   - company (string, 選填, 省略預設=ticker)
   - date (string YYYY-MM-DD, 強烈建議 = D)
   - summary (string, 選填, 一句話)
   - highlights (array, 必填)：每條 { "text": string 必填, "sentiment": "bullish"|"bearish"|"neutral" 必填 }
   - watch (string[], 選填)
   規則：
   - sentiment 三選一（大小寫不拘），中文或其他值會被當 neutral。
   - year 是數字不加引號；其餘字串都要引號。
   - 卡片整體顏色由 highlights 判定：bullish 數量 > bearish + neutral 總和 → 偏多(綠)；
     bearish 數量 > bullish + neutral 總和 → 偏空(紅)；否則中性(灰)。判 sentiment 時留意此規則。

D. 上傳到 Firestore（必要步驟，務必實際執行 script，不可只印 JSON）：
   1. 把所有 call 物件收進單一 {"calls":[...]}，用檔案工具寫成 /tmp/call.json。
   2. 執行：
        python scripts/publish.py --type earnings --file /tmp/call.json
      （憑證取自環境變數 FIREBASE_SERVICE_ACCOUNT；不要 commit/push。）
   3. 確認輸出出現 "Published N earnings document(s) to earnings_calls."；
      N 應等於成功上傳的公司數。若出現 ERROR，讀錯誤訊息修正 JSON 後重跑同一指令
      （doc id = ticker-year-quarter，重跑是更新不會重複）。

================================================================
最後回報（繁體中文）
================================================================
- 貼出階段一 Markdown 表格。
- 條列階段二每家公司：ticker、year、quarter、原始文件來源連結、是否成功上傳（或為何略過）。
- 貼出 publish.py 的輸出摘要（Published N ...）。
- 若階段一無公司，只回報那一句無結果訊息即可。
```

---

## 備註

- **doc id 冪等**：`earnings_calls/<ticker-year-quarter>`。重跑同一場會議是更新，不會產生重複卡片。
- **年度/季度務必正確**（year 是數字），否則會建成不同 doc。
- **只寫 Firestore、不 push**：靜態頁 `earnings/index.html` 由瀏覽器端即時讀取渲染。
- 若想改成「先在 claude.ai Project 分析、再貼進 Claude Code web session 跑 `publish.py`」的半自動流程，
  參見 [`ROUTINE_SETUP.md`](ROUTINE_SETUP.md) B 節。
- 相關檔案：`scripts/publish.py`（上傳器）、`js/reports.js`（前端 `saveEarnings`／`parseCalls` 同格式）、
  `earnings/index.html`（財報電話會議頁）。
