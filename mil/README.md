# 軍事專區 · Military Zone

在既有 `hgvf.github.io` 靜態站上新增的「軍事」內容專區。純 vanilla JS + ES module，
SVG 手繪圖表，零建置（no bundler / no framework），全相對路徑，深灰嚴肅主題（有別於主站褐色）。

## 頁面

| 路徑 | 模組 | 說明 | 資料 |
|---|---|---|---|
| `mil/index.html` | 總覽 | 專區入口卡片 | — |
| `mil/explorer/` | ① Weapon Research Explorer | 3D 檢視（Three.js 程序化近似）、技術 Tag→相似武器→比較、變體、時間軸、來源 | `data/weapons-modern.json`、`data/tags.json` |
| `mil/war/` | ② 戰役消耗帳 | 太平洋戰爭時序＋海圖雙視圖、√尺度陣亡、並行戰役標籤去碰撞、戰役↔武器 join | `data/pacific-war.json` + `data/weapons.json` + `data/battle-weapons.json` |
| `mil/arsenal/` | ③ 系統譜系 | 二戰武器家族繼承鏈、服役區間、變更紀錄格式、反查參戰戰役 | `data/weapons.json`、`data/battle-weapons.json` |
| `mil/strait/` | ④ 台海活動基線 | 滾動中位數 ± k·MAD 穩健基線、事件圖層、組成副圖、雙滑桿即時重算 | `data/strait.json`（無則 `strait-sample.json` 合成） |
| `mil/doctrine/` | ⑤ 文件敘事漂移 | 威脅排序流動、措辭升降（新舊原文並列）、章節增刪 | `data/doctrine.json`（示意） |
| `mil/exercises/` | ⑥ 演習行事曆 | 年度甘特＋月度密度條 | `data/exercises.json`（示意） |
| `mil/defense/` | ⑦ 每日軍武動態 | **ADD JSON → Firestore `mil_defense_daily`**（比照 earnings）；中文為主英文為輔、篩選、詳情 modal | Firestore；無資料時 `defense-sample.json` |
| `mil/digest/` | ⑧ 每日彙整 | 唯讀 Firestore `mil_feeds`（LLM → Worker → DB） | Firestore |

## 資料 / 後端

- **能靜態就不進 Firestore**：①②③④⑤⑥ 全為版本控管的靜態 JSON（零配額）。
- 只有需 LLM 判讀、每日變動者用 DB：⑦ `mil_defense_daily`（白名單前端寫）、⑧ `mil_feeds`（僅 Worker 寫）。
- `worker/ingest.js` + `wrangler.toml`：Cloudflare Worker 寫入端點（token → schema 驗證 → 服務帳號 JWT → Firestore PATCH）。401/400 不需 GCP 即可測。
- `skills/defense-digest/SKILL.md`：LLM routine 契約（僅官方來源、純 JSON、強制 source_url）。
- `scripts/scrape_mnd.py`：國防部公告解析（純標準庫、純函式 `parse_announcement`、`--self-test`、數字歸屬窗口截止日）。
- `scripts/fetch_battles.py`：Wikidata + Wikipedia infobox 抽取（括號深度解析、`needs_review` 不臆測）。
- `scripts/check_integrity.py`：資料檔參照完整性檢查（CI 可用）。
- `.github/workflows/strait-daily.yml`：每日抓取排程（self-test → 抓取 → 有 diff 才 commit）。

## 本機預覽

```bash
python3 -m http.server 8000
# 開 http://localhost:8000/mil/index.html
```

以 `file://` 直接開啟會被瀏覽器擋 `fetch`，頁面會顯示友善提示。

## 測試

```bash
python3 mil/scripts/check_integrity.py     # 參照完整性
python3 mil/scripts/scrape_mnd.py --self-test
python3 mil/scripts/fetch_battles.py --self-test
```

Worker 驗證邏輯（無需 GCP）：以 `node` import `worker/ingest.js` 的 `validate/normalise/toValue` 單測。

## 3D 檢視器

`js/viewer3d.js` 以 Three.js（CDN importmap）程序化組出 fidelity C（外型近似，識別用途）模型：
機身/機鼻/彈翼/尾翼/進氣道/助推段＋零件熱點標註→Tag。Three.js 採動態載入，
CDN 不可用時武器頁其餘資訊仍正常呈現。
