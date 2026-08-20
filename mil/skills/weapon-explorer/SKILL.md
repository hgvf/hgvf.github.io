---
name: weapon-explorer-research
description: 給一個武器/載台名稱（飛彈、軍艦、飛機、火砲…），從公開官方與可信來源拼湊完整資訊，輸出可直接匯入「武器探索 Explorer」的 weapon JSON（含技術 Tag、型號譜系 variants、3D 模型參數 model_3d）。當使用者說「research <武器>」「查 <武器> 並產生 JSON」時使用。
---

# weapon-explorer-research

輸入一個**武器/載台名稱**（例：`勃克級驅逐艦`、`Tomahawk`、`F-16`、`雄風三型`），
輸出一個 `{"weapons":[ <weapon> ]}`，可貼進 Explorer 頁的「ADD JSON」或
`python scripts/publish.py --type explorer --file x.json` 寫入 `mil_weapons_modern`。

## 0. 最終輸出契約（嚴格）

執行 research 時，assistant 的最終回覆 **只能是一個合法 JSON 物件**：
第一字元 `{`、最後 `}`；無 markdown fence、無說明文字、`json.loads()` 可解析。
外層固定 `{"weapons":[ … ]}`（單一武器也放進陣列）。使用者若要求「解釋 skill」而非執行，才允許正常散文。

## 1. 兩個必產項目（硬性）

survey 一個武器時，**除基本資料外，必須自行產生**：
1. **型號譜系 `variants[]`** — 該武器的 Block/Flight/型號演進鏈（至少列出已知主要變體與差異）。
2. **3D 檢視 `model_3d`** — 依外型特徵給出 `shape` 幾何參數與零件 `annotations`（見 §5）。

缺這兩項視為未完成。

## 2. 來源政策

只採公開、可信、優先官方一手來源：
- 原廠官方（RTX / Lockheed Martin / Boeing / MBDA / Kongsberg / NCSIST / General Dynamics …）
- 軍種 / 政府（US Navy/Air Force/Army fact files、各國國防部、GAO）
- 研究機構（CSIS Missile Threat、IISS、CRS）作為輔證
- 維基百科等**僅用於發現一手來源**，不作為唯一事實依據

每個關鍵規格盡量帶 `source_id`；至少一筆 `sources[]`（tier_1/tier_2）。**只用公開資訊，不碰機密**。

## 3. 抽取紀律

- 只寫來源支持的事實；不確定一律 `null`，**絕不編造**射程/數量/型號/日期。
- 繁體中文（zh-TW）用於 `name_zh / summary_zh / variants[].name_zh / annotations[].name_zh`；
  型號代號、公司名、英文原名保持原樣。
- 關鍵規格帶 `confidence`（high/medium/low）。

## 4. Tag 分類法（`tags:[{type,value,source_id}]`）

`value` 必須取自下列分類法（不足時先在 `mil/data/tags.json` 補新 value，否則相似度/Tag 頁對不到；系統不阻擋但會提示未知 tag）：

- **role**: anti_ship, air_defense, air_to_air, land_attack, anti_radiation, ballistic_missile_defense, anti_tank
- **propulsion**: solid_rocket, liquid_rocket, turbojet, turbofan, ramjet, scramjet, dual_pulse_motor, rocket_booster, gas_turbine, cogag, nuclear_propulsion, diesel_electric, steam_turbine
- **guidance**: inertial, gps, gps_ins, active_radar, semi_active_radar, infrared, imaging_ir, laser, terrain_matching, datalink
- **flight**: sea_skimming, high_altitude, low_altitude, ballistic, quasi_ballistic, terminal_dive, lofted, unpowered
- **speed**: subsonic, supersonic, hypersonic
- **launch**: ship, vls, ground, air, submarine, vehicle
- **target**: surface_ship, aircraft, missile, fixed_ground_target, moving_ground_target, radar
- **ship_type**: destroyer, frigate, cruiser, aircraft_carrier, corvette, attack_submarine, amphibious_ship
- **combat_system**: aegis　**radar**: aesa, pesa, s_band, x_band　**launcher**: mk41_vls, mk57_vls, deck_gun, ciws
- **capability**: area_air_defense, point_defense, bmd_capable, asw, asuw, naval_strike
- **aircraft_type**: fighter, multirole, bomber, attack_aircraft, uav　**generation**: gen4, gen4_5, gen5

相似度權重目前只計 role/propulsion/guidance/flight/launch/speed；艦/機專屬 tag 仍會顯示並可點。

## 5. 3D 模型 `model_3d`（fidelity C，外型近似）

`{"fidelity":"c","shape":{…},"annotations":[…]}`。依實體選 `shape.type`：

- **missile**（預設）/ **bomb**：`bodyLen, bodyDia, color, nose(ogive|cone|blunt|chisel), faceted?, wings{span,chord,axial,sweep}, tailFins{span,chord,count,strakes?}, canards{span,chord,axial}, intake(belly|dorsal|side2|side|nose), booster{len,dia}`。`span` 為**全展長**（tip-to-tip）。
- **ship**：`length, beam, color, superstructure:[{a0,a1,w,h}], funnels:[axial], masts:[axial], turrets:[axial], vls:[{a}]`。`a/a0/a1/axial` 為 0（艦艏）→1（艦艉）的比例；`w` 為 beam 比例、`h` 為 beam×0.5 的倍數。
- **aircraft**：`length, bodyDia, span, color, wing{axial,span,chord,sweep}, tail{span,chord,vspan}, canard?{axial,span,chord}, twin_tail?`。
- **annotations**：`[{id,name,name_zh,axial(0..1 由前到後),radial(nose|dorsal|belly|side|tail),tag:"type:value",source_id}]` — 點熱點會連到該 Tag。

尺寸給大致真實比例即可；系統會夾限與置中，不會跑版。

## 6. Weapon 物件必填/建議欄位

必填：`id`（小寫底線 slug）、`name_zh`。
建議：`name, designation, entity_type(missile|guided_bomb|ship|aircraft|…), country, manufacturer[], status(operational|development|testing|retired), summary_zh, summary, specifications{欄位:{value,source_id,confidence}}, tags[], variants[], platforms[], operators[{country,name_zh,status,note}], events[{date,type,title_zh,source_ids}], sources[{id,title,publisher,source_type,url,reliability}], model_3d`。
`specifications` 常用欄位：`length_m, diameter_m, weight_kg, range_km, speed, warhead, propulsion, guidance`（頁面依此順序顯示；不適用者留空）。

## 7. 自我驗證

產出後自檢：① `json.loads()` 可解析；② 每個 `tags[].value` 在 §4 分類法內；
③ `variants[]` 與 `model_3d`（含 shape 與 ≥1 annotation）皆存在；④ 每筆有 `sources[]`。

---

## 範例輸出（已驗證）— 輸入：`勃克級驅逐艦`

下方為本 skill 對 `勃克級驅逐艦` 的實際輸出格式（entity_type=ship、含 variants 型號譜系與 ship 型 model_3d），已通過 Explorer 匯入與 3D 渲染驗證：

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
