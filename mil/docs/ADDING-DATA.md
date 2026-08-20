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
- `model_3d.shape.type`：`missile`（預設）｜`bomb`｜`ship`｜`aircraft`。
  - missile/bomb：`bodyLen / bodyDia / nose(ogive|cone|blunt|chisel) / wings{span,chord,axial,sweep} / tailFins{span,chord,count} / intake(belly|side2|nose|…) / booster{len,dia}`；`span` 視為**全展長**。
  - ship：`length / beam / superstructure[{a0,a1,w,h}] / funnels[] / masts[] / turrets[] / vls[{a}]`（比例 0=艦艏→1=艦艉）。
  - aircraft：`length / bodyDia / span / wing{axial,span,chord,sweep} / tail{span,chord,vspan} / canard? / twin_tail?`。
  - 完整範例見下方或 `mil/skills/weapon-explorer/SKILL.md`。

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

---

## 研究用 Skill（關鍵字 → JSON）

若要用 LLM「給關鍵字自動 survey 產生 JSON」，見三份 skill（markdown）：

| skill | 輸入範例 | 產出 |
|---|---|---|
| `mil/skills/weapon-explorer/SKILL.md` | `勃克級驅逐艦` | 武器實體（含 variants 譜系 + model_3d 3D）→ `mil_weapons_modern` |
| `mil/skills/war-conflict/SKILL.md` | `淞滬會戰` | 其所屬**整場戰爭**（含該戰役）→ `mil_conflicts` |
| `mil/skills/arsenal-lineage/SKILL.md` | `F-16` | 整條世代繼承鏈 → `mil_weapons` |

每份 skill 內含一個**已驗證的完整範例輸出**（即下方三例）。

---

## 完整 JSON 範例

### ① 武器探索 — 勃克級驅逐艦（entity_type=ship，含 variants + ship 型 model_3d）

```json
{
  "weapons": [
    {
      "id": "arleigh_burke",
      "name": "Arleigh Burke-class Destroyer",
      "name_zh": "勃克級驅逐艦",
      "designation": "DDG-51",
      "entity_type": "ship",
      "country": "USA",
      "manufacturer": [
        "General Dynamics BIW",
        "Huntington Ingalls"
      ],
      "status": "operational",
      "summary_zh": "美國海軍神盾飛彈驅逐艦，以 Aegis 作戰系統整合相位陣列雷達與 Mk 41 垂直發射系統，具區域防空、反艦、對陸打擊與（Flight III）彈道飛彈防禦能力；COGAG 燃氣渦輪推進。是美軍數量最多的主力水面作戰艦，並持續建造。",
      "summary": "US Navy Aegis guided-missile destroyer integrating a phased-array radar and Mk 41 VLS; area air defense, anti-ship, land attack and (Flight III) ballistic-missile defense. COGAG propulsion. The most numerous US surface combatant, still in production.",
      "specifications": {
        "length_m": {
          "value": 155.3,
          "source_id": "ab_navy",
          "confidence": "high"
        },
        "range_km": {
          "value": "~8100 (4400 nm @20kn)",
          "source_id": "ab_navy",
          "confidence": "medium"
        },
        "speed": {
          "value": "30+ 節",
          "source_id": "ab_navy",
          "confidence": "high"
        },
        "weight_kg": {
          "value": "~9700 噸（滿載排水量）",
          "source_id": "ab_navy",
          "confidence": "medium"
        },
        "propulsion": {
          "value": "COGAG 4×LM2500 燃氣渦輪、雙軸",
          "source_id": "ab_navy",
          "confidence": "high"
        },
        "guidance": {
          "value": "Aegis 作戰系統 + 相位陣列雷達",
          "source_id": "ab_navy",
          "confidence": "high"
        }
      },
      "tags": [
        {
          "type": "ship_type",
          "value": "destroyer",
          "source_id": "ab_navy"
        },
        {
          "type": "combat_system",
          "value": "aegis",
          "source_id": "ab_navy"
        },
        {
          "type": "radar",
          "value": "pesa",
          "source_id": "ab_navy"
        },
        {
          "type": "launcher",
          "value": "mk41_vls",
          "source_id": "ab_navy"
        },
        {
          "type": "role",
          "value": "air_defense",
          "source_id": "ab_navy"
        },
        {
          "type": "role",
          "value": "anti_ship",
          "source_id": "ab_navy"
        },
        {
          "type": "role",
          "value": "land_attack",
          "source_id": "ab_navy"
        },
        {
          "type": "role",
          "value": "ballistic_missile_defense",
          "source_id": "ab_csis"
        },
        {
          "type": "capability",
          "value": "area_air_defense",
          "source_id": "ab_navy"
        },
        {
          "type": "capability",
          "value": "bmd_capable",
          "source_id": "ab_csis"
        },
        {
          "type": "capability",
          "value": "asw",
          "source_id": "ab_navy"
        },
        {
          "type": "capability",
          "value": "asuw",
          "source_id": "ab_navy"
        },
        {
          "type": "propulsion",
          "value": "cogag",
          "source_id": "ab_navy"
        },
        {
          "type": "launch",
          "value": "ship",
          "source_id": "ab_navy"
        },
        {
          "type": "launch",
          "value": "vls",
          "source_id": "ab_navy"
        }
      ],
      "variants": [
        {
          "id": "flight1",
          "name": "Flight I/II",
          "name_zh": "Flight I/II",
          "changes": {
            "note": "初始批次，SPY-1D 雷達、90 管 VLS。"
          }
        },
        {
          "id": "flight2a",
          "name": "Flight IIA",
          "name_zh": "Flight IIA",
          "changes": {
            "note": "加裝雙機庫可搭載兩架直升機，96 管 VLS。"
          }
        },
        {
          "id": "flight3",
          "name": "Flight III",
          "name_zh": "Flight III",
          "changes": {
            "radar": "+ AN/SPY-6 AESA",
            "role": "+ 強化彈道飛彈防禦",
            "note": "換裝 SPY-6 主動相位陣列與更大電力/冷卻。"
          }
        }
      ],
      "platforms": [],
      "operators": [
        {
          "country": "US",
          "name_zh": "美國海軍",
          "status": "operational",
          "note": "數十艘服役、持續建造。"
        },
        {
          "country": "JP",
          "name_zh": "日本（衍生：金剛/愛宕/摩耶級）",
          "status": "operational",
          "note": "以此為基礎發展。"
        }
      ],
      "events": [
        {
          "date": "1991-01-01",
          "type": "deployment",
          "title_zh": "首艦勃克號服役",
          "title": "USS Arleigh Burke commissioned",
          "source_ids": [
            "ab_navy"
          ]
        },
        {
          "date": "2023-01-01",
          "type": "upgrade",
          "title_zh": "Flight III（SPY-6）交付",
          "title": "Flight III (SPY-6) delivered",
          "source_ids": [
            "ab_navy"
          ]
        }
      ],
      "sources": [
        {
          "id": "ab_navy",
          "title": "Arleigh Burke-class (DDG 51) — U.S. Navy Fact File",
          "publisher": "U.S. Navy",
          "source_type": "official",
          "url": "https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169871/destroyers-ddg/",
          "reliability": "tier_1"
        },
        {
          "id": "ab_csis",
          "title": "Aegis BMD — CSIS Missile Threat",
          "publisher": "CSIS Missile Threat",
          "source_type": "research",
          "url": "https://missilethreat.csis.org/defsys/aegis/",
          "reliability": "tier_2"
        }
      ],
      "model_3d": {
        "fidelity": "c",
        "shape": {
          "type": "ship",
          "length": 155,
          "beam": 20,
          "color": "#8b929c",
          "superstructure": [
            {
              "a0": 0.24,
              "a1": 0.5,
              "w": 0.62,
              "h": 1.5
            },
            {
              "a0": 0.5,
              "a1": 0.66,
              "w": 0.5,
              "h": 1.0
            }
          ],
          "funnels": [
            0.48
          ],
          "masts": [
            0.34,
            0.6
          ],
          "turrets": [
            0.13
          ],
          "vls": [
            {
              "a": 0.2
            },
            {
              "a": 0.82
            }
          ]
        },
        "annotations": [
          {
            "id": "spy",
            "name": "Phased-array radar (SPY)",
            "name_zh": "相位陣列雷達（SPY）",
            "axial": 0.3,
            "radial": "dorsal",
            "tag": "radar:pesa",
            "source_id": "ab_navy"
          },
          {
            "id": "vls_fwd",
            "name": "Mk 41 VLS (fwd)",
            "name_zh": "Mk 41 垂直發射（前）",
            "axial": 0.2,
            "radial": "dorsal",
            "tag": "launcher:mk41_vls",
            "source_id": "ab_navy"
          },
          {
            "id": "gun",
            "name": "5-inch gun",
            "name_zh": "127mm 艦砲",
            "axial": 0.13,
            "radial": "dorsal",
            "tag": "ship_type:destroyer",
            "source_id": "ab_navy"
          }
        ]
      }
    }
  ]
}
```

### ② 戰役消耗 — 中日戰爭（輸入局部戰役「淞滬會戰」→ 輸出整場戰爭 category，此處節錄 3 場）

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

### ③ 系統譜系 — F-16 世代繼承鏈（parent 指前一世代）

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
