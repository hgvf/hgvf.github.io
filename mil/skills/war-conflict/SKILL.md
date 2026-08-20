---
name: war-conflict-research
description: 給一個戰役或戰爭名稱，從公開來源整理成「戰役消耗帳」用的自足戰爭 JSON（含階段、參戰武器、各戰役雙方兵力/傷亡/座標/戰略意義）。若輸入是局部戰役，會輸出其所屬的整場戰爭（category）並把該戰役納入。當使用者說「research <戰役/戰爭>」時使用。
---

# war-conflict-research

輸入一個**戰役**（例：`淞滬會戰`）或**戰爭**（例：`太平洋戰爭`），輸出一個**自足的戰爭物件**，
可貼進 War 頁「ADD JSON」或 `python scripts/publish.py --type conflict --file x.json` 寫入 `mil_conflicts`。

## 0. 最終輸出契約（嚴格）

最終回覆只能是一個合法 JSON 物件（`{`…`}`，無 fence、無散文、`json.loads()` 可解析）。
輸出**一整場戰爭**（若要一次多場則用 `{"conflicts":[ … ]}`）。

## 1. 局部戰役 → 建立戰爭 category（重點）

- 若輸入是**局部戰役**（例 `淞滬會戰`）：判定它所屬的**整場戰爭**（例：中日戰爭 1937–1945），
  以該戰爭為輸出的頂層物件（`id/name_zh/start/end` 用**戰爭**的，不是單一戰役的），
  並把該戰役放進 `battles[]`，同時補上該戰爭其他**代表性戰役**（3–8 場，含轉捩點）。
  → 這樣網站下拉選單就會新增這場戰爭，該戰役是其中一個標記。
- 若輸入本身是**整場戰爭**：直接以它為頂層，列出代表性戰役。
- `id` 用穩定 slug（例 `second_sino_japanese_war`）；重貼同 id 會覆蓋。

## 2. 來源與紀律

- 公開來源：各國國防部/軍史單位、學術與百科（百科用於交叉查證與發現一手來源）。
- **傷亡/兵力數字爭議大**：一律視為**估計並四捨五入**，於 `_note` 標明；不確定填 `null`，不編造。
- **平民死亡**放 `civilian_deaths`（獨立欄位，不計入色塊高度）；敏感事件（如屠殺）以中性、標明估計區間的方式敘述。
- 繁體中文用於 `name_zh / location_zh / significance / side_labels`。

## 3. 戰爭物件 schema（自足）

```
{
  "id","name_zh","name_en","start","end",           // start/end = YYYY-MM-DD（戰爭全程）
  "region_zh","wikidata?",
  "side_labels":{"allied":"我方標籤","enemy":"對方標籤"},  // 決定藍/紅與地圖顏色
  "_note":"估計來源說明",
  "phases":[{"id","name_zh","start","end"}],
  "weapons":[{"id","name_zh","name_en","side":"allied|enemy","family","parent":"id|null",
              "role","service":[起,迄],"specs":{},"note"}],
  "battles":[{
     "id","name_zh","name_en","phase",              // phase 需存在於 phases[]
     "start","end","location_zh","coord":[lat,lon],  // coord 為 [緯度,經度]
     "type","turning_point":bool,"featured":bool,     // featured=true 供「僅精選」篩選
     "sides":[{"key":"allied|enemy","name_zh","committed","deaths","wounded","materiel"}],
     "civilian_deaths?","outcome","significance",
     "weapons":["<本檔 weapons[] 的 id>"]             // 必須 ⊂ 上面 weapons[]
  }]
}
```

`outcome` 文字若含 `side_labels.allied` 的字樣 → 地圖標記畫藍，含 enemy → 紅；含「持續/僵持」→ 黃銅。
地圖圓面積 ∝ 雙方陣亡總數；時序視圖色塊高度 = √陣亡（平方根尺度）。

## 4. 自我驗證

① `json.loads()` 可解析；② 每個 `battles[].phase` 在 `phases[]`；③ 每個 `battles[].weapons` 的 id 在 `weapons[]`；
④ `coord` 為 `[lat,lon]` 兩元素；⑤ 至少一個 `turning_point:true`；⑥ start/end 為 YYYY-MM-DD。

---

## 範例輸出（已驗證）— 輸入：`淞滬會戰`

輸入局部戰役 `淞滬會戰`，輸出其所屬戰爭 **中日戰爭（1937–1945）**，淞滬會戰為其中一個 battle
（此處示範前 3 場；實際可列 3–8 場）。已通過 War 頁載入與地圖渲染、referential-integrity 驗證：

```json
{
  "id": "second_sino_japanese_war",
  "name_zh": "中日戰爭（抗日戰爭）",
  "name_en": "Second Sino-Japanese War",
  "start": "1937-07-07",
  "end": "1945-09-02",
  "region_zh": "中國",
  "wikidata": "Q170314",
  "side_labels": {
    "allied": "中國",
    "enemy": "日本"
  },
  "_note": "ILLUSTRATIVE open-source estimates, heavily rounded. Casualty figures for this conflict are contested and vary widely by source; treat as indicative only. Civilian-death figures (esp. Nanjing) are estimates with wide ranges and are shown separately, not in the casualty bars.",
  "phases": [
    {
      "id": "opening",
      "name_zh": "開戰（1937）",
      "start": "1937-07-07",
      "end": "1938-06-01"
    },
    {
      "id": "stalemate",
      "name_zh": "相持階段",
      "start": "1938-06-01",
      "end": "1943-12-31"
    },
    {
      "id": "counter",
      "name_zh": "反攻",
      "start": "1944-01-01",
      "end": "1945-09-02"
    }
  ],
  "weapons": [
    {
      "id": "hawk3",
      "name_zh": "霍克 III 戰鬥機",
      "name_en": "Curtiss Hawk III",
      "side": "allied",
      "family": "cn_fighter",
      "parent": null,
      "role": "戰鬥機",
      "service": [
        1936,
        1942
      ],
      "specs": {
        "最高速度": "387 km/h",
        "武裝": "2×機槍"
      },
      "note": "抗戰初期中國空軍主力雙翼戰機。"
    },
    {
      "id": "i16",
      "name_zh": "I-16 戰鬥機",
      "name_en": "Polikarpov I-16",
      "side": "allied",
      "family": "cn_fighter",
      "parent": "hawk3",
      "role": "戰鬥機",
      "service": [
        1937,
        1943
      ],
      "specs": {
        "最高速度": "462 km/h"
      },
      "note": "蘇聯志願航空隊與中國空軍使用的單翼戰機。"
    },
    {
      "id": "zb26",
      "name_zh": "ZB-26 輕機槍（捷克式）",
      "name_en": "ZB vz. 26",
      "side": "allied",
      "family": "cn_infantry",
      "parent": null,
      "role": "輕機槍",
      "service": [
        1927,
        1945
      ],
      "specs": {
        "口徑": "7.92mm"
      },
      "note": "中國軍隊廣泛使用的班用輕機槍。"
    },
    {
      "id": "type97_tank",
      "name_zh": "九七式中戰車",
      "name_en": "Type 97 Chi-Ha",
      "side": "enemy",
      "family": "jp_tank",
      "parent": null,
      "role": "中戰車",
      "service": [
        1938,
        1945
      ],
      "specs": {
        "主砲": "57mm",
        "裝甲": "薄"
      },
      "note": "日本陸軍主力中戰車。"
    },
    {
      "id": "a5m",
      "name_zh": "九六式艦上戰鬥機",
      "name_en": "Mitsubishi A5M",
      "side": "enemy",
      "family": "jp_fighter",
      "parent": null,
      "role": "艦載戰鬥機",
      "service": [
        1936,
        1942
      ],
      "specs": {
        "最高速度": "440 km/h"
      },
      "note": "零戰前身，抗戰初期日本主力戰機。"
    },
    {
      "id": "g3m",
      "name_zh": "九六式陸上攻擊機",
      "name_en": "Mitsubishi G3M",
      "side": "enemy",
      "family": "jp_bomber",
      "parent": null,
      "role": "陸上轟炸機",
      "service": [
        1936,
        1945
      ],
      "specs": {
        "航程": "遠",
        "載彈": "800 kg"
      },
      "note": "長航程轟炸機，執行對中國城市的越洋轟炸。"
    }
  ],
  "battles": [
    {
      "id": "shanghai_1937",
      "name_zh": "淞滬會戰",
      "name_en": "Battle of Shanghai",
      "phase": "opening",
      "start": "1937-08-13",
      "end": "1937-11-26",
      "location_zh": "上海",
      "coord": [
        31.23,
        121.47
      ],
      "type": "城市會戰",
      "turning_point": true,
      "featured": true,
      "sides": [
        {
          "key": "allied",
          "name_zh": "中國",
          "committed": 700000,
          "deaths": 250000,
          "wounded": 0,
          "materiel": "精銳中央軍損失慘重"
        },
        {
          "key": "enemy",
          "name_zh": "日本",
          "committed": 300000,
          "deaths": 40000,
          "wounded": 0,
          "materiel": ""
        }
      ],
      "outcome": "日本勝利",
      "significance": "粉碎日軍『三月亡華』速戰速決構想，但國軍精銳與空軍損失巨大，戰爭轉為長期化。",
      "weapons": [
        "hawk3",
        "i16",
        "type97_tank",
        "a5m",
        "g3m"
      ]
    },
    {
      "id": "nanjing_1937",
      "name_zh": "南京保衛戰",
      "name_en": "Battle of Nanking",
      "phase": "opening",
      "start": "1937-12-01",
      "end": "1937-12-13",
      "location_zh": "南京",
      "coord": [
        32.06,
        118.8
      ],
      "type": "城市防禦",
      "turning_point": false,
      "featured": true,
      "sides": [
        {
          "key": "allied",
          "name_zh": "中國",
          "committed": 100000,
          "deaths": 50000,
          "wounded": 0,
          "materiel": ""
        },
        {
          "key": "enemy",
          "name_zh": "日本",
          "committed": 70000,
          "deaths": 8000,
          "wounded": 0,
          "materiel": ""
        }
      ],
      "civilian_deaths": 200000,
      "outcome": "日本勝利",
      "significance": "城陷後發生南京大屠殺；平民與戰俘死亡估計數十萬，各方估計差異極大。",
      "weapons": [
        "type97_tank",
        "g3m"
      ]
    },
    {
      "id": "taierzhuang_1938",
      "name_zh": "台兒莊戰役",
      "name_en": "Battle of Taierzhuang",
      "phase": "opening",
      "start": "1938-03-24",
      "end": "1938-04-07",
      "location_zh": "山東 台兒莊",
      "coord": [
        34.56,
        117.73
      ],
      "type": "會戰",
      "turning_point": true,
      "featured": true,
      "sides": [
        {
          "key": "allied",
          "name_zh": "中國",
          "committed": 290000,
          "deaths": 30000,
          "wounded": 0,
          "materiel": ""
        },
        {
          "key": "enemy",
          "name_zh": "日本",
          "committed": 70000,
          "deaths": 20000,
          "wounded": 0,
          "materiel": "重挫兩個師團"
        }
      ],
      "outcome": "中國勝利",
      "significance": "抗戰初期正面戰場重大勝利，重創日軍並提振全國士氣。",
      "weapons": [
        "zb26",
        "type97_tank"
      ]
    }
  ]
}
```
