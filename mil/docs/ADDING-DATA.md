# 如何加入新資訊 — 武器探索 / 戰役消耗 / 系統譜系

三個頁面都有**兩種**加入資料的方式，兩種寫的是同一個 Firestore collection、doc id 規則一致，所以**同一筆重覆發布會 upsert 覆蓋、不會重複**。也都仍保留一份靜態 JSON 作為基底（版本控管、零配額）。

| 頁面 | Firestore collection | 靜態基底檔 | 主鍵 |
|---|---|---|---|
| ① 武器探索 explorer | `mil_weapons_modern` | `mil/data/weapons-modern.json` | 武器 `id` |
| ② 戰役消耗 war | `mil_conflicts` | `mil/data/wars/*.json` + `wars/index.json` | 戰爭 `id` |
| ③ 系統譜系 arsenal | `mil_weapons` | `mil/data/arsenal.json` | 武器 `id` |

載入時：**靜態基底 ∪ Firestore（Firestore 同 id 覆蓋基底）**。

---

## 方式 A — 頁面「ADD JSON」按鈕（手動、即時）

1. 用**白名單帳號**在頁面右上角「登入」（email 需在 Firestore `config/auth.allowed_emails`）。
2. 出現「匯入 / 新增…（ADD JSON）」面板 → 貼 JSON → 發布。前端用你的登入身分直接寫 Firestore。
3. **前提**：規則要先部署（見下）。

> 三頁的 ADD JSON 接受 `{"weapons":[…]}` / `{"conflicts":[…]}`（或戰爭單一物件）/ 陣列 / 單一物件。

## 方式 B — `scripts/publish.py`（排程 / CLI、自動、免登入）

用**服務帳號** server-side 寫入（繞過規則，不需白名單），適合排程：

```bash
python scripts/publish.py --type explorer --file modern.json    # -> mil_weapons_modern
python scripts/publish.py --type conflict --file war.json        # -> mil_conflicts
python scripts/publish.py --type arsenal  --file weapons.json    # -> mil_weapons
python scripts/publish.py --type defense  --file defense.json    # -> mil_defense_daily
```

憑證解析順序：`--credentials <path>` → `$FIREBASE_SERVICE_ACCOUNT`（原始 JSON 字串）→ `scripts/serviceAccount.json`。

排程範例（產 JSON 後自動 push）：

```bash
claude -p "…產生武器 JSON…" > /tmp/modern.json && \
python scripts/publish.py --type explorer --file /tmp/modern.json
```

---

## 部署 Firestore 規則（新 collection 必做一次）

方式 A 若出現 *Missing or insufficient permissions*，通常是規則還沒部署：

```bash
firebase deploy --only firestore:rules
```

規則已在 `firestore.rules`（`mil_weapons_modern / mil_conflicts / mil_weapons / mil_defense_daily`：public read、白名單 write），部署設定在 `firebase.json`。方式 B（服務帳號）不受此限。

---

## 各頁 JSON 結構重點

### ① 武器探索（weapons-modern schema）
每筆武器：`id`、`name_zh`（必填）；建議 `name / designation / country / entity_type / status / summary_zh / summary / specifications{欄位:{value,source_id,confidence}} / tags:[{type,value,source_id}] / variants[] / platforms[] / operators[] / events[] / sources[{id,title,publisher,url,reliability}] / model_3d{fidelity,shape,annotations}`。
- `tags[].value` 必須存在於 `mil/data/tags.json` 的分類法（否則相似度/Tag 頁對不到；ADD JSON 會提示未知 tag 但不阻擋）。
- `model_3d.shape`：`bodyLen / bodyDia / nose(ogive|cone|blunt|chisel) / wings{span,chord,axial,sweep} / tailFins{span,chord,count} / intake(belly|side2|nose|…) / booster{len,dia}`；`span` 視為**全展長**。完整範例見 `weapons-modern.json`。

### ② 戰役消耗（自足的戰爭）
一份戰爭：`id / name_zh / name_en / start / end / region_zh / side_labels{allied,enemy} / phases[] / weapons[] / battles[]`。
- 每場 `battles[]`：`id / name_zh / phase / start / end / location_zh / coord:[lat,lon] / type / turning_point / featured / sides:[{key:"allied|enemy",name_zh,committed,deaths,wounded,materiel}] / civilian_deaths? / outcome / significance / weapons:[武器id]`。
- `battles[].weapons` 的 id 必須存在於同檔 `weapons[]`。`featured:true` 會被「僅精選」篩選採用。
- 範例：`mil/data/wars/pacific_war.json`。若要新增到**靜態**清單，也在 `wars/index.json` 補一列並放檔案。

### ③ 系統譜系（跨時代武器）
每筆：`id / name_zh`（必填）；建議 `name_en / bloc(west|east|other) / era(WW2|冷戰|現代) / family / parent(前一世代 id|null) / role / service:[起,迄] / status? / specs{} / note`。
- `parent` 需存在（同批或既有）。`family` 未定義會歸入「自訂／未分類」群組。

---

## 檢查

```bash
python3 mil/scripts/check_integrity.py    # 驗證戰爭/武器/tag 參照完整性（靜態檔）
```
