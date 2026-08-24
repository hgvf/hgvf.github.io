---
name: arsenal-lineage-research
description: 給一個武器型號或家族名稱（例 F-16、T-72、勃克級），從公開來源整理成「系統譜系 Arsenal」用的 weapon JSON——輸出整條世代繼承鏈（前代→本型→後繼），含時代、陣營、服役區間與設計取捨。當使用者說「research lineage <型號>」時使用。
---

# arsenal-lineage-research

輸入一個**型號/家族**（例：`F-16`、`T-72`、`Nimitz 級`），輸出 `{"weapons":[ … ]}`，
**貼進 Arsenal 頁的「ADD JSON」面板**即寫入 `mil_weapons`。本專案一律用頁面 ADD JSON 新增
（登入白名單帳號後才會出現該面板），不使用 publish.py。

## 0. 最終輸出契約（嚴格）

最終回覆只能是一個合法 JSON 物件（`{`…`}`，無 fence、無散文、`json.loads()` 可解析），外層 `{"weapons":[ … ]}`。

## 1. 輸出「整條譜系鏈」（重點）

不要只輸出單一型號，要輸出它所在的**繼承鏈**：
- 往前追**前代**、往後補**主要後繼**（同一 `family`），用 `parent`（前一世代的 id）串起來。
- 例：輸入 `F-16` → 輸出同一噴射戰機家族的 `F-86 → F-4 → F-15/F-16 → F-22/F-35` 之類的鏈（依實際血緣，`parent` 指前一世代）。
- 每個節點是一個 weapon 物件；`parent` 必須指向**同批**（或站上既有）某個 id。root 的 `parent:null`。

## 2. 來源與紀律

- 公開/官方/百科（百科用於交叉查證）。規格為概估、帶四捨五入；不確定填 `null`，不編造。
- 繁體中文用於 `name_zh / role / note`；型號代號與英文原名保留。

## 3. Weapon 物件 schema（arsenal）

```
{
  "id",                       // 小寫底線 slug（例 "f16"）
  "name_zh","name_en",
  "bloc":"west|east|other",   // 決定顏色（西方藍/東方紅/其他黃銅）
  "era":"WW2|冷戰|現代",       // 時代篩選用
  "family":"<家族 slug>",      // 同鏈共用（例 "us_jet_fighter"）
  "parent":"<前一世代 id>|null",
  "role","service":[起,迄],    // 迄=null 表示仍服役
  "status?":"未量產",          // 選填，虛線框
  "specs":{ "任意鍵":"值" },
  "note":"設計取捨/歷史定位"
}
```

`family` 未定義於站上時會自動歸入「自訂／未分類」群組並照 `parent` 排鏈，仍可用。

## 4. 自我驗證

① `json.loads()` 可解析；② 每個非 null 的 `parent` 都指向本批某個 `id`；③ `bloc/era` 值合法；
④ 至少排得出一條 root→衍生 的鏈（有一個 `parent:null` 的 root）。

---

## 範例輸出（已驗證）— 輸入：`F-16`

輸出 F-16 所在的美國噴射戰機譜系鏈（`F-86 → F-4 → F-16 / F-15 → F-35`，`parent` 指前一世代），
已通過 Arsenal 頁載入與譜系鏈渲染驗證（此為節錄鏈；實際可再補 F-15/F-22 等分支）：

```json
{
  "weapons": [
    {
      "id": "f86",
      "name_zh": "F-86 軍刀",
      "name_en": "F-86 Sabre",
      "bloc": "west",
      "era": "冷戰",
      "family": "us_jet_fighter",
      "parent": null,
      "role": "後掠翼噴射戰機",
      "service": [
        1949,
        1994
      ],
      "specs": {
        "最高速度": "1100 km/h",
        "武裝": "6×12.7mm"
      },
      "note": "韓戰與 MiG-15 對抗的第一代噴射戰機。"
    },
    {
      "id": "f4",
      "name_zh": "F-4 幽靈 II",
      "name_en": "F-4 Phantom II",
      "bloc": "west",
      "era": "冷戰",
      "family": "us_jet_fighter",
      "parent": "f86",
      "role": "多用途攔截/攻擊",
      "service": [
        1960,
        1996
      ],
      "specs": {
        "最高速度": "Mach 2.2",
        "武裝": "AIM-7/AIM-9"
      },
      "note": "越戰主力，強調飛彈交戰與雙發重載。"
    },
    {
      "id": "f16",
      "name_zh": "F-16 戰隼",
      "name_en": "F-16 Fighting Falcon",
      "bloc": "west",
      "era": "冷戰",
      "family": "us_jet_fighter",
      "parent": "f4",
      "role": "輕型多用途",
      "service": [
        1978,
        null
      ],
      "specs": {
        "最高速度": "Mach 2",
        "特點": "線傳飛控/放寬靜穩定"
      },
      "note": "高性價比多用途機，外銷極廣（含台灣）。"
    },
    {
      "id": "f35",
      "name_zh": "F-35 閃電 II",
      "name_en": "F-35 Lightning II",
      "bloc": "west",
      "era": "現代",
      "family": "us_jet_fighter",
      "parent": "f16",
      "role": "匿蹤多用途",
      "service": [
        2015,
        null
      ],
      "specs": {
        "特點": "感測融合/資料鏈",
        "型別": "A/B/C"
      },
      "note": "多國聯合的匿蹤多用途機，強調感測與網路。"
    }
  ]
}
```
