---
name: defense-digest
description: 每日彙整官方/一級來源的國防動態，輸出純 JSON（無 code fence）並 POST 至 mil_feeds 寫入 Worker。當使用者要求「跑每日國防彙整 / defense digest / 更新 mil_feeds」時使用。
---

# defense-digest

每日產出一份「國防動態彙整」，經 Cloudflare Worker 寫入 Firestore `mil_feeds`，供 `mil/digest/` 唯讀呈現。

## 硬規則

1. **只用官方 / 一級來源**。可信來源清單：
   - 美國：`war.gov`（合約）、`defense.gov`、各軍種 `.mil`、GAO、DSCA（FMS）
   - 日本：防衛省 / ATLA（防衛裝備廳）
   - 韓國：DAPA（防衛事業廳）
   - 台灣：國防部 MND
   - 原廠官方新聞稿（RTX / Lockheed Martin / Boeing / MBDA / Kongsberg / NCSIST 等）
   - 研究機構作為輔助脈絡：CSIS、IISS、CRS（不可作為唯一出處）
2. **每一則必須有可開啟的官方 `source_url`（http/https）**。無出處者一律不輸出——這是分辨「讀到的」與「幻覺」的唯一欄位。
3. `summary` 必須是**改寫**，不得逐字複製原文。
4. **輸出純 JSON，無 code fence、無前後說明文字**。

## 輸出契約

POST 至 Worker：`POST <WORKER_URL>/ingest`，標頭 `Authorization: Bearer <INGEST_TOKEN>`，body：

```json
{
  "feed": "defense-digest",
  "date": "YYYY-MM-DD",
  "model": "<model-name>",
  "items": [
    {
      "headline": "字串（<=1200，中文為主）",
      "summary": "字串（<=1200，改寫非逐字，中文為主）",
      "source_name": "字串（發布機構）",
      "source_url": "https://…（必填，http/https）",
      "published_at": "YYYY-MM-DD（選填）",
      "sentiment": "positive|negative|neutral（選填，default neutral）",
      "confidence": "high|medium|low（選填，default medium）",
      "tags": ["字串", "…（<=8）"],
      "entities": ["字串", "…（<=12）"]
    }
  ]
}
```

- `feed` 白名單：`defense-digest | exercise-watch | doctrine-watch`。
- `items` 上限 40 筆。
- `generated_at` 與 `item_count` 由 Worker 填入，勿自行帶入。
- Worker 以 doc id = `feed__date` **覆蓋**寫入，故同日重跑安全。

## 失敗處理

- `401`：token 錯誤或未設定 → **停止**，回報需檢查 `INGEST_TOKEN`。
- `400`：schema 驗證失敗 → 讀 `details` 陣列修正後**重試一次**；仍失敗則停止並回報。
- `502`：Firestore / OAuth 寫入失敗 → **停止**，回報 Worker 端問題（勿重試以免半寫）。

## 內容邊界

- 不推測未公開的部署位置、數量或時程。
- 不拼湊未經官方發布的能力評估。
- 不使用宣稱掌握機密的來源。
- 資料有衝突時，優先採信一級官方；於 `confidence` 反映不確定性。
