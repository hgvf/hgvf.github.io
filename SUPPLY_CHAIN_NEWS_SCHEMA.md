# 供應鏈瓶頸新聞 — JSON 格式（`supply_chain_news`）

這份是 supply-chain 頁面吃的資料格式，也是要餵給 AI 生成用的規格。
publish 方式：整包 `{"items": [ ... ]}` 交給 `scripts/publish.py --type news`（Routine 自動或手動）。

> **重點：只收「供應鏈瓶頸 / 結構性改變」的新聞**，不是一般盤勢或漲跌新聞。
> 收錄標的：缺料、產能吃緊、交期拉長、單一供應商 / 咽喉點風險、關鍵材料或設備斷鏈、
> 出口管制，以及**會改變產業規律或傳統供應鏈的消息**（新進入者 / 國產替代打破壟斷 /
> 新技術改寫供應鏈，例如「中國 DUV 浸潤式微影機量產出貨，SMIC／華虹／CXMT 接單」）。

## 完整範例

```json
{
  "items": [
    {
      "date": "2026-07-28",
      "tickers": ["2317.TW", "AMKR"],
      "headline": "先進封裝成為 AI 晶片新瓶頸：CoWoS 交期 52–78 週，ABF 薄膜 95% 由 Ajinomoto 獨家供應",
      "content": "AI 晶片瓶頸從晶圓製造轉向先進封裝。TSMC CoWoS 產能 2026 年底約 13 萬片/月仍不應求；ABF 載板薄膜由 Ajinomoto 獨家供應（市佔約 95%），Q3 起漲價約 30%。",
      "sentiment": "bearish",
      "credibility": "高",
      "tags": ["封裝瓶頸", "CoWoS", "ABF substrate", "獨家供應商風險"],
      "effect": "下游 AI 加速器出貨受封裝產能上限壓抑；載板成本墊高，終端 GPU/伺服器成本與交期同步惡化。",
      "advise": "封裝與載板供應鏈（設備、材料）偏多；純下游組裝、成本敏感者偏空，留意毛利率壓縮。",
      "chain": {
        "upstream":   [{ "name": "Ajinomoto Fine-Techno", "note": "ABF 薄膜約 95% 市佔，Q3 漲價 30%" }],
        "midstream":  [{ "name": "TSMC", "note": "CoWoS 產能主力，交期 52–78 週" },
                       { "name": "Amkor / ASE", "note": "承接外包封裝訂單" }],
        "downstream": [{ "name": "Nvidia", "note": "約佔 60% CoWoS 產能，出貨受限" }]
      },
      "alternatives": [
        { "name": "Ajinomoto", "share": "95%", "incumbent": true, "note": "ABF 載板薄膜現任龍頭" },
        { "name": "Sekisui / 台廠驗證中", "share": "~5%", "note": "量產驗證中，短期難放量" }
      ],
      "signals": "AT&S 法說：CoWoS 交期 52–78 週；Nvidia 近幾季財報 capex 續增、資料中心營收創高，佐證需求端未鬆動。",
      "sources": [
        { "title": "Nikkei Asia", "url": "https://..." },
        { "title": "Tech Times", "url": "https://..." }
      ]
    }
  ]
}
```

## 欄位規格

| 欄位 | 型別 | 必填 | 說明 |
|------|------|:---:|------|
| `date` | string | ✅ | 新聞對應日期 `YYYY-MM-DD`。沒填則不會出現在時間軸/月曆。 |
| `headline` | string | ✅ | 精簡標題（繁中）。 |
| `content` | string | ✅ | 1–3 句摘要 + 為何重要（繁中）。 |
| `tickers` | string[] | 選填 | 相關股票代號；無則 `[]`。 |
| `sentiment` | string | 選填 | `bullish` / `bearish` / `neutral`（對相關標的）。其他值當 `neutral`。 |
| `credibility` | string | 選填 | 可信度 `高` / `中` / `低`，顯示在右上角徽章。依來源可靠度與是否多方佐證判斷。 |
| `tags` | string[] | 選填 | 瓶頸關鍵字 / 題材，渲染成 chips（如 `CoWoS`、`ABF substrate`）。 |
| `effect` | string | 選填 | 下游如何被影響、哪些產品成本被墊高。 |
| `advise` | string | 選填 | 簡短投資建議。 |
| `chain` | object | 選填 | 供應鏈上中下游受影響對象。三個鍵 `upstream` / `midstream` / `downstream`，各為 `[{name, note}]`。 |
| `alternatives` | object[] | 選填 | 替代品 / 公司與市占。每筆 `{name, share, incumbent?, note?}`；`incumbent: true` 標記現任龍頭。 |
| `signals` | string | 選填 | 從近幾次財報、營收、電話會議逐字稿找到的佐證線索。 |
| `sources` | object[] | 選填 | 來源清單，每筆 `{title, url}`。 |

## 規則

- **doc id** = `date + headline` 的雜湊，**重貼同一則是更新、不會重複**。
- **所有選填欄位不溯及既往**：舊資料沒有這些欄位 → 對應 card 不顯示、也不報錯。
- `chain` 的三段、`alternatives` 若為空 → 該 card 自動略過。
- 渲染時每種資訊各自一張**有顏色與 icon 的 card**：可信度徽章（右上）、🏷️ 關鍵字、🔗 上中下游、🔄 替代品/市占、⛓️ 下游影響、🔍 財報線索、💡 投資建議。
