# 軍武專區 · Military Zone

在既有 `hgvf.github.io` 靜態站上的「軍武」內容專區。純 vanilla JS + ES module、
SVG 手繪圖表、零建置、全相對路徑、深灰嚴肅主題。

主站側邊欄僅保留單一入口「軍武專區」；進入後**無側邊欄**，改由頂部工具列（← 主站 · 分頁 · 登入）導覽。

## 頁面（4）

| 路徑 | 模組 | 說明 | 資料 |
|---|---|---|---|
| `mil/explorer/` | ① 武器探索 | 3D 檢視（Three.js 程序化近似）、技術 Tag→相似武器→比較、變體、時間軸、來源 | `data/weapons-modern.json`、`data/tags.json` |
| `mil/war/` | ② 戰役消耗 | **多戰爭**時序＋海圖雙視圖、√尺度陣亡、戰爭切換選單、Timeline 戰役篩選、戰役↔武器 join、ADD JSON 新增戰爭 | `data/wars/*.json` + Firestore `mil_conflicts` |
| `mil/arsenal/` | ③ 系統譜系 | **全時代**（WW2/冷戰/現代）武器繼承鏈、era/陣營/搜尋篩選、ADD JSON 新增武器 | `data/arsenal.json` + Firestore `mil_weapons` |
| `mil/defense/` | ④ 每日軍武合約 | ADD JSON → Firestore `mil_defense_daily`；中文為主英文為輔、篩選、詳情 modal | Firestore；無資料時 `defense-sample.json` |

## 新增資料的方式（ADD JSON）

三個頁面（②③④）都支援「白名單登入 → 貼 JSON → 發布至 Firestore」，比照主站 earnings/annual report：

- **戰爭 / 戰役**（②）：貼一份自足的戰爭 JSON（`id/name_zh/start/end/phases/weapons[]/battles[]`，每場 battle 以 `weapons:[武器id]` 關聯該檔 weapons）。寫入 `mil_conflicts`，立即出現在戰爭切換選單。靜態範例：`data/wars/pacific_war.json`、`gulf_war.json`、`russo_ukrainian.json`。
- **武器譜系**（③）：貼 `{"weapons":[…]}`；每筆需 `id/name_zh`，建議含 `bloc/era/family/parent/service`。寫入 `mil_weapons`。
- **每日合約**（④）：貼 skill 產出的 `{"events":[…]}`。寫入 `mil_defense_daily`。

Timeline 篩選（②）：可用「全部 / 僅轉捩點 / 僅精選 / 自訂勾選」決定哪些戰役畫在時序與海圖上（不影響點選詳情）。

## Firestore 規則（重要）

新增的 collection 需**部署規則**才能寫入，否則會出現 *Missing or insufficient permissions*：

```bash
firebase deploy --only firestore:rules
```

規則已在 `firestore.rules`（`mil_defense_daily / mil_conflicts / mil_weapons`：public read、白名單 write），部署設定於 `firebase.json`。寫入者的 email 也必須在 `config/auth.allowed_emails` 白名單內。

## 本機預覽

```bash
python3 -m http.server 8000   # 開 http://localhost:8000/mil/explorer/index.html
```

`file://` 直接開啟會被瀏覽器擋 `fetch`，頁面顯示友善提示。

## 測試

```bash
python3 mil/scripts/check_integrity.py       # 參照完整性（戰爭/武器/tag）
python3 mil/scripts/fetch_battles.py --self-test
```

## 3D 檢視器

`js/viewer3d.js` 以 Three.js（CDN importmap）程序化組出 fidelity C 外型近似模型＋零件熱點→Tag。
Three.js 動態載入，CDN 不可用時武器頁其餘資訊仍正常呈現。
