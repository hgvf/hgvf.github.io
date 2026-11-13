# 盲測 K 線 — 行情資料要上傳成什麼樣子

題庫產生流程：**行情 parquet** → `tools/sample_segments.py`（品質檢查、流動性門檻、隨機抽片段）→ `tools/gen-puzzles.mjs`（用跟前端同一份 engine 標 regime、掃 preset 訊號、匿名化）→ 推到 orphan branch `blind-chart-puzzles` → 前端從 `raw.githubusercontent.com` 讀。

**行情與題庫都不會進網站 `main` 的 git history。**

## 1. 檔案格式

放在一個資料夾（或打包成 `.tar` / `.tar.gz`）裡，底下遞迴找 `*.parquet`：

```
data/
  tw.parquet          # 或 tw/part-0001.parquet、tw/2024/*.parquet… MinIO 的分區資料夾也可以
  us.parquet
  jp.parquet
  kr.parquet
  universe.parquet    # 選填
  benchmarks.parquet  # 選填（rel_strength 指標才需要）
```

### bars（必要）— SDD 3.3

| 欄位 | 型別 | 說明 |
|---|---|---|
| `market` | string | `TW` / `US` / `JP` / `KR`。**沒有這欄也可以**：路徑裡含 `tw` / `us` / `jp` / `kr`（例 `tw/part-0.parquet`）就會自動判斷，或用 `--market TW` 指定 |
| `symbol` | string | 市場內代號 |
| `date` | date / timestamp / `YYYY-MM-DD` 字串 | 交易日（當地） |
| `open` `high` `low` `close` | float | **還原權值價**（auto adjust） |
| `volume` | float | 股數 |
| `turnover` | float | 成交金額，選填；沒有就用 `close × volume` 估 |

欄位名稱不一樣沒關係，用 `--map` 對應，例如你的欄位是 `ticker, trade_date, vol`：

```bash
python blind-chart/tools/inspect_parquet.py /path/to/data      # 會印出欄位並建議 --map
```

```bash
python blind-chart/tools/sample_segments.py --data /path/to/data --out build/segments.jsonl.gz --map "ticker=symbol,trade_date=date,vol=volume"
```

### universe.parquet（選填，建議）

`market, symbol, name, board, sector, listed_since, snapshot_date`

- 有這個檔：只抽 universe 裡的代號，並排除 `board` 是 ETF / ETN / REIT / WARRANT / TDR / PREFERRED / SPAC / UNIT / ADR / PRO 的標的（清單在 `config/universe.json`）；揭曉時顯示公司名與產業。
- 沒有這個檔：所有代號都可能被抽到，揭曉只顯示代號。**ETF、權證、特別股要事先排除**。

### benchmarks.parquet（選填）

`market, symbol, date, close` — 大盤指數（TAIEX / SPX / N225 / KOSPI），題目會附上同樣縮放過的大盤，`rel_strength` 指標才有值。

## 2. 放到哪裡

建議（SDD 的設計）：一個 **private repo**（預設 `hgvf/market-data`）的 **GitHub Release**，tag 例 `data-v1`，把上面的 parquet（或一個 tar.gz）當 release asset 上傳。

然後在網站 repo 設定：

| 設定 | 位置 | 值 |
|---|---|---|
| `MARKET_DATA_TOKEN` | Settings → Secrets → Actions | fine-grained token，只給 `market-data` repo 的 **Contents: Read** |
| `MARKET_DATA_REPO` | Settings → Variables → Actions | 選填，預設 `hgvf/market-data` |
| `MARKET_DATA_TAG` | Variables | 選填，預設 `data-v1`（排程跑的時候用） |
| `MARKET_DATA_MAP` | Variables | 選填，`--map` 的內容，例 `ticker=symbol,trade_date=date` |

接著 Actions → **Blind Chart — build puzzle bank** → Run workflow（輸入 tag）。之後每月 1 日自動重出一次題庫（換 seed 就是新題庫）。

> 單檔 release asset 上限 2 GB。四市場日 K 從 2005 年起大約數百 MB，parquet 壓縮後通常放得下；太大就分市場上傳多個檔案。

## 3. 本機直接出題（不經 Actions）

```bash
pip install -r blind-chart/tools/requirements.txt
python blind-chart/tools/sample_segments.py --data /path/to/data --out build/segments.jsonl.gz
node blind-chart/tools/gen-puzzles.mjs --segments build/segments.jsonl.gz --out build/bank
```

`build/bank/` 底下是 `index.json`、`puzzles/`、`answers/`、`manifest.json`，推到 `blind-chart-puzzles` 分支即可（內容整批取代、不留歷史）。

## 4. 參數

- `config/universe.json`：每市場的流動性門檻（片段內成交金額中位數）、單日漲跌幅上限、連續零成交量上限
- `config/puzzles.json`：背景 / 可操作 / 揭曉根數、每市場題數、regime 配額、`minSignals`、`seed`
