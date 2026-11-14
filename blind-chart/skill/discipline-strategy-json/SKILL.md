---
name: discipline-strategy-json
description: 把白話描述的交易策略轉成「你有紀律嗎?」（hgvf.github.io/blind-chart）可以直接匯入的策略 JSON。使用時機：使用者描述想要的進出場規則、技術指標條件（均線、KD、RSI、MACD、布林、突破、爆量…）、停損停利、部位大小或加碼方式，並要做成策略、規則或 JSON。輸出一份可以通過驗證的完整 JSON，附白話對照與自己補上的假設。
---

# 你有紀律嗎? — 策略 JSON 產生器

使用者會用白話描述一個交易策略。你的工作是把它寫成一份**完整、能通過驗證**的策略 JSON，讓使用者在「你有紀律嗎?」的策略頁匯入後就能玩。

## 回覆格式

1. 一個 ```json 區塊：完整的策略（含顯示用欄位 `short`、`category`、`idea`、`plain`、`roles`、`knobs`）。
2. 「規則對照」：3–8 行條列，把使用者的每句話對到 JSON 的哪個欄位。
3. 「我補上的假設」：使用者沒講、你自己決定的部分（停損方式、部位大小、冷卻天數…），每項一行。
4. 最後一行固定寫匯入方式：存成 `.json` 檔，到策略頁左下「匯入策略 JSON」選檔案；或在任一「我的策略」的 JSON 分頁整段貼上取代後按「儲存」。

**不要問太多問題。** 缺的部分用下面的「預設值」補上，寫在「我補上的假設」。只有核心的買進邏輯看不懂時才問，而且一次問完。

使用者要求修改時，回傳**修改後的完整 JSON**，不要只給片段。

## 遊戲的限制（寫規則前先確認做得到）

- **日 K**、**只能做多**（`direction` 只能是 `long`）。沒有放空、沒有盤中資料、沒有財報 / 新聞 / 基本面。
- 可用資料：`open` `high` `low` `close` `volume` `turnover`（成交金額）`benchmark`（大盤，可能沒有）。
- **價格和成交量都經過縮放**，不要寫絕對門檻（`close > 100`、`volume > 1000000`）。改用比例：`close > ma20 * 1.05`、`volume > vol20 * 1.5`。
- 每題前面有 **250 根背景 K 棒**，之後才是可操作區（120 / 250 / 500 根）。指標回看天數盡量 **≤ 240**，否則可操作區一開始指標還算不出來。
- 條件式在**每根收盤後**判斷，成立就**下一根開盤**成交（`fill.mode: next_open`）。停損、停利線是盤中碰到就以線價成交。
- 交易單位：台股 1000 股、日股 100 股、美韓 1 股，股數會無條件捨去。
- 遊戲開始頁有「每筆最多賠（1R）」設定，會覆蓋策略的風險比例。策略裡的 `sizing` 照常寫，當作「照策略」時的預設。
- 使用者要做空、要看財報、要盤中進出 → 說明做不到，提出最接近的做多版本。

## 骨架

```json
{
  "id": "英數與減號，例 my-kd-cross",
  "name": "完整名稱",
  "short": "短名稱（清單用，8 字內）",
  "category": "趨勢跟隨 | 動能突破 | 均值回歸",
  "idea": "一句話說明核心想法",
  "plain": { "buy": ["…"], "sell": ["…"], "add": ["…（有加碼才寫）"] },
  "roles": { "指標 id": "這個指標在策略裡做什麼" },
  "indicators": [ { "id": "ma20", "type": "sma", "params": { "length": 20 } } ],
  "vars": { "門檻名稱": 30 },
  "entry": { "signal": "買進條件式", "cooldownBars": 3 },
  "sizing": { "method": "risk_percent", "pct": 0.01, "caps": { "maxPositionPct": 0.4 } },
  "stops": [ { "type": "atr_initial", "params": { "atrId": "atr14", "k": 2 } } ],
  "targets": [ { "at": { "r": 2 }, "fraction": 0.5 } ],
  "exitSignals": [ { "expr": "賣出條件式", "fraction": 1 } ],
  "pyramiding": { "enabled": false },
  "knobs": [ { "path": "vars.門檻名稱", "label": "顯示名稱", "min": 10, "max": 50, "step": 5, "help": "一句說明" } ]
}
```

必填：`id`、`entry.signal`、`stops`（至少一條初始停損）。其他都有預設，但 `short`、`category`、`idea`、`plain`、`roles`、`knobs` 請一律寫上，網站會用它們顯示白話規則和調整旋鈕。

## 條件式

用在 `entry.signal`、`exitSignals[].expr`、`stops[].activateWhen`、`targets[].at.expr`、`pyramiding.trigger`。

| 寫法 | 意思 |
|---|---|
| `close` `open` `high` `low` `volume` | 這根 K 棒的值 |
| `ma20` | 指標 id（多輸出指標只寫 id = 第一個輸出） |
| `bb.upper` `kd.k` `macd.signal` | 多輸出指標的某一條 |
| `x[1]` | 前 1 根的值。`[ ]` 內只能放非負整數，也可以接在函數後面：`highest(high, 20)[1]` |
| `+ - * /`、`> < >= <= == !=` | 運算與比較 |
| `and` `or` `not` `( )` | 組合條件 |
| `$名稱` | 換成 `vars` 裡的數字 |

函數：

| 函數 | 意思 |
|---|---|
| `cross_up(a, b)` | a 由下往上穿過 b（前一根 a ≤ b，這根 a > b） |
| `cross_down(a, b)` | a 由上往下穿過 b |
| `rising(x, n)` / `falling(x, n)` | x 比前 n 根都高 / 都低 |
| `highest(x, n)` / `lowest(x, n)` | 最近 n 根（含這根）的最大 / 最小值 |
| `sma(x, n)` | 最近 n 根的平均 |
| `change(x, n)` | x − n 根前的 x（n 省略 = 1） |
| `min(a, b, …)` / `max(a, b, …)` / `abs(x)` | 最小、最大、絕對值 |
| `nz(x, v)` / `na(x)` | x 算不出來時用 v / x 是否算不出來 |

`rising` `falling` `highest` `lowest` `sma` 的第二個參數必須是**正整數**（可以用 `$n`，但 vars 裡要是整數）。指標還算不出來（暖機中）時，條件一律不成立。

持有中的部位（用在賣出、停損啟動、加碼、停利條件）：

| 變數 | 意思 |
|---|---|
| `pos.size` | 持有股數 |
| `pos.avgPrice` | 持有均價 |
| `pos.unrealizedR` | 目前賺幾 R（以收盤計） |
| `pos.unrealizedPnl` | 未實現損益 |
| `pos.barsHeld` | 持有幾根 |
| `pos.adds` | 已加碼幾次 |
| `pos.highestSinceEntry` | 買進後最高價 |
| `pos.lastAddPrice` | 最近一次買進價 |
| `pos.entryPrice` | 第一筆買價 |
| `pos.initialStop` | 初始停損價 |
| `pos.stop` | 目前有效停損 |
| `pos.riskPerShare` | 每股風險（買價 − 初始停損） |

帳戶：`acct.equity`（權益）、`acct.cash`（現金）、`acct.openRiskR`（全部停損會賠幾 R）、`acct.openRisk`（全部停損會賠多少）。

### 常見說法對照（台股用語）

| 使用者說 | 指標 | 條件式 |
|---|---|---|
| 週線 / 月線 / 季線 / 半年線 / 年線 | `sma` 5 / 20 / 60 / 120 / 240 | `close > ma20` |
| 站上月線 / 跌破季線 | | `close > ma20` / `close < ma60` |
| 均線黃金交叉 / 死亡交叉 | | `cross_up(ma5, ma20)` / `cross_down(ma5, ma20)` |
| 多頭排列 | | `ma5 > ma20 and ma20 > ma60` |
| 均線上揚 | | `rising(ma20, 5)` |
| 創 20 日新高 | `donchian` 20 | `close > dc20.upper[1]`（或 `close > highest(high, 20)[1]`） |
| 創 20 日新低 | | `close < lowest(low, 20)[1]` |
| 爆量 1.5 倍 / 量縮 | `volume_ma` 20 | `volume > vol20 * 1.5` / `volume < vol20 * 0.6` |
| 長紅 K（漲 4% 以上） | | `close > open * 1.04` |
| 今天漲超過 3% | | `close > close[1] * 1.03` |
| 跳空上漲 | | `low > high[1]` |
| 連 3 紅 | | `close > open and close[1] > open[1] and close[2] > open[2]` |
| 連漲 3 天 | | `close > close[1] and close[1] > close[2] and close[2] > close[3]` |
| RSI 超賣 / 超買 | `rsi` 14 | `rsi14 < 30` / `rsi14 > 70` |
| KD 低檔黃金交叉 | `kd` 9 | `cross_up(kd.k, kd.d) and kd.k < 20` |
| KD 高檔死叉 | | `cross_down(kd.k, kd.d) and kd.k[1] > 80` |
| MACD 黃金交叉 | `macd` | `cross_up(macd.macd, macd.signal)` |
| MACD 柱狀體翻紅 | | `cross_up(macd.hist, 0)` |
| 碰布林下軌 / 突破上軌 | `bollinger` 20, 2 | `low <= bb.lower` / `cross_up(close, bb.upper)` |
| 布林收斂 | | `bb.width < lowest(bb.width, 120)[1] * 1.2` |
| 比大盤強 | `rel_strength` 60 | `rs60 > 0` |
| 有趨勢且向上 | `adx` 14 | `adx14 > 25 and adx14.pdi > adx14.mdi` |
| 離 52 週高點 10% 內 | | `close >= highest(high, 240) * 0.9` |
| 跌深（負乖離 10%） | | `close < ma20 * 0.9` |
| 賺 10% 就賣 | | `targets: [{ "at": { "expr": "pos.entryPrice * 1.1" }, "fraction": 1 }]` |
| 從最高點回落 10% 就賣 | | `exitSignals: [{ "expr": "close < pos.highestSinceEntry * 0.9", "fraction": 1 }]` |
| 虧 8% 停損 | | `stops: [{ "type": "pct_initial", "params": { "p": 0.08 } }]` |
| 抱 N 天就賣 | | `stops: [{ "type": "time_stop", "params": { "bars": N, "minR": 99 } }]` |
| 賺到 1R 停損拉到成本 | | `stops: [{ "type": "breakeven", "params": { "atR": 1 } }]` |

## 指標（`indicators`）

寫法：`{ "id": "自己取的名字", "type": "類型", "params": { … } }`。id 只能用英數和底線、不能數字開頭、不能重複，建議用「類型+天數」，例 `ma20`、`rsi14`、`dc55`。params 沒寫的用預設值。

| type | 名稱 | params（預設、範圍） | 條件式怎麼引用 | 說明 |
|---|---|---|---|---|
| `sma` | SMA 簡單均線 | `length`=20（1–500）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id` | 簡單均線 |
| `ema` | EMA 指數均線 | `length`=20（1–500）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id` | 指數均線（反應較快） |
| `wma` | WMA 加權均線 | `length`=20（1–500）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id` | 加權均線 |
| `rma` | RMA（Wilder）均線 | `length`=14（1–500）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id` | Wilder 平滑均線 |
| `atr` | ATR 平均真實區間 | `length`=14（1–500）、`smoothing`="rma"（rma / sma / ema / wma）、`trMode`="standard"（standard / hl / gap_aware）、`asPercent`=false | `id` | 平均每天波動幅度，停損與部位常用。`asPercent: true` 改成佔收盤的 % |
| `donchian` | Donchian 通道 | `length`=20（1–500） | `id.upper` `id.lower` `id.mid`（`id` = `id.upper`） | N 日最高 / 最低價。突破前一根的 upper = 創 N 日新高：`close > dc20.upper[1]` |
| `bollinger` | 布林通道 | `length`=20（1–500）、`mult`=2（0.1–10）、`maType`="sma"（sma / ema）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id.upper` `id.mid` `id.lower` `id.width`（`id` = `id.upper`） | 均線 ± mult 倍標準差；width = (上軌 − 下軌) ÷ 中軌 |
| `keltner` | Keltner 通道 | `length`=20（1–500）、`atrLength`=10（1–500）、`mult`=2（0.1–10） | `id.upper` `id.mid` `id.lower`（`id` = `id.upper`） | EMA ± mult 倍 ATR |
| `rsi` | RSI | `length`=14（1–500）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id` | 0–100 |
| `macd` | MACD | `fast`=12（1–500）、`slow`=26（1–500）、`signal`=9（1–500）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id.macd` `id.signal` `id.hist`（`id` = `id.macd`） | macd = 快 EMA − 慢 EMA（DIF），signal = macd 的 EMA，hist = 兩者差 |
| `kd` | KD 隨機指標 | `length`=9（1–500）、`kSmooth`=3（1–20）、`dSmooth`=3（1–20） | `id.k` `id.d`（`id` = `id.k`） | 0–100，台灣常用算法（RSV 平滑） |
| `adx` | ADX / DMI | `length`=14（1–500） | `id.adx` `id.pdi` `id.mdi`（`id` = `id.adx`） | adx 趨勢強度（> 25 有趨勢），pdi / mdi 多空方向 |
| `supertrend` | SuperTrend | `atrLength`=10（1–500）、`mult`=3（0.1–20） | `id.line` `id.dir`（`id` = `id.line`） | line 追蹤線；dir = 1 多頭、−1 空頭。翻多：`st.dir > 0 and st.dir[1] < 0` |
| `swing` | Swing 波段高低點 | `left`=5（1–500）、`right`=5（1–500） | `id.high` `id.low`（`id` = `id.high`） | 波段高低點（要等右邊 right 根確認）；給 `structure` 停損用 |
| `volume_ma` | 量均線 | `length`=20（1–500）、`field`="volume"（volume / turnover） | `id` | 量均線；field 可用 turnover（成交金額） |
| `rel_strength` | 相對大盤強度 | `benchmark`="market"、`length`=60（1–500） | `id` | 個股 N 日報酬 − 大盤 N 日報酬（%），> 0 比大盤強；沒有大盤資料時算不出來 |
| `roc` | ROC 變動率 | `length`=20（1–500）、`source`="close"（open / high / low / close / hl2 / hlc3 / ohlc4 / volume） | `id` | (收盤 ÷ N 根前收盤 − 1) × 100 |
| `linreg` | 指數迴歸動能（Clenow） | `length`=90（10–500） | `id.adj` `id.slope` `id.r2`（`id` = `id.adj`） | 對數價格迴歸：slope 年化斜率 %、r2 擬合度、adj = slope × r2 |

## 停損（`stops`）

可以寫很多條，系統取**最高**的那條，而且只會往上移。
- **至少一條初始停損**（`atr_initial`、`pct_initial`、`structure`），而且這條**不要**加 `activateWhen`，1R 才算得出來。
- 加 `"activateWhen": "條件式"` 的停損，條件成立後才生效，例 `"pos.unrealizedR >= 2"` = 賺到 2R 才啟動。
- `atrId` 要填一個 `atr` 指標的 id；`maId` 填均線 id 或 `bb.mid`、`st.line` 這類輸出；`swingId` 填 `swing` 指標的 id。

| type | 種類 | params（預設） | 算法 |
|---|---|---|---|
| `atr_initial` | 初始（進場時算一次，之後不動） | `atrId`、`k`=2 | 買價 − k × ATR |
| `pct_initial` | 初始（進場時算一次，之後不動） | `p`=0.08 | 買價 × (1 − p)，p = 0.08 是 8% |
| `structure` | 初始（進場時算一次，之後不動） | `swingId`、`bufferAtr`=0、`bufferPct`=0、`atrId`、`trail`=false | 最近的波段低點再往下 bufferAtr 倍 ATR 或 bufferPct；需要 `swing` 指標。trail: true 時跟著新低點上移 |
| `atr_trailing` | 移動（每根收盤重算，只往上） | `atrId`、`k`=3 | 收盤 − k × ATR |
| `chandelier` | 移動（每根收盤重算，只往上） | `atrId`、`k`=3 | 買進後最高價 − k × ATR（常用的移動停利） |
| `ma_trailing` | 移動（每根收盤重算，只往上） | `maId`、`bufferPct`=0、`bufferAtr`=0、`atrId`、`trigger`="close"（close / low） | 跌破 maId 那條線（可再減緩衝）就賣；trigger = close 看收盤、low 看盤中 |
| `donchian_trailing` | 移動（每根收盤重算，只往上） | `length`=10 | 跌破最近 length 根的最低價就賣（海龜出場） |
| `breakeven` | 移動（每根收盤重算，只往上） | `atR`=1、`offsetR`=0、`offsetPct`=0 | 賺到 atR 個 R 後停損拉到成本（+ offsetR R 或 offsetPct） |
| `step_r` | 移動（每根收盤重算，只往上） | `stepR`=1、`moveR`=1 | 每多賺 stepR 個 R，停損上移 moveR 個 R |
| `time_stop` | 收盤檢查（成立就下一根開盤賣） | `bars`=20、`minR`=0.5 | 持有 bars 根仍沒賺到 minR 個 R 就賣；minR 設 99 = 持有滿 bars 根一律賣 |

## 部位（`sizing`）

寫法：`{ "method": "risk_percent", "pct": 0.01, "caps": { "maxPositionPct": 0.4 } }`

| method | 參數（預設） | 算法 |
|---|---|---|
| `max_loss_amount` | `amount`=10000 | 股數 = amount ÷ (買價 − 停損)；每筆停損固定賠 amount |
| `risk_percent` | `pct`=0.01 | 股數 = 權益 × pct ÷ (買價 − 停損)；最常用，0.01 = 每筆賠帳戶 1% |
| `total_cost` | `cost`=100000 | 股數 = cost ÷ 買價 |
| `percent_equity` | `pct`=0.2 | 股數 = 權益 × pct ÷ 買價（不看停損） |
| `fixed_shares` | `shares`=1000 | 固定股數 |
| `vol_target` | `targetVolPct`=0.01、`atrId` | 股數 = 權益 × targetVolPct ÷ ATR；要寫 `atrId` |

`caps` 上限：`maxPositionPct` 單筆市值最多佔帳戶幾成（0.4 = 40%）、`maxOpenRiskR` 全部部位一起停損最多賠幾 R、`cashOnly` 不融資（預設 true）。`maxRiskPct` 由遊戲自動填，不用寫。

## 停利（`targets`）與賣出條件（`exitSignals`）

- `targets`：盤中碰到目標價就賣出一部分。`at` 三選一：`{ "r": 2 }`（買價 + 2R）、`{ "atr": 3, "atrId": "atr14" }`（買價 + 3 倍 ATR）、`{ "expr": "bb.mid" }`（條件式算出的價格）。`fraction` 是賣出比例，0–1。
- `exitSignals`：`{ "expr": "條件式", "fraction": 1 }`，收盤成立就下一根開盤賣出 `fraction` 比例。可以寫很多條，任一成立就賣。
- 想要「全部出場」的條件放 `exitSignals`；想要「到價先賣一部分」放 `targets`。

## 加碼（`pyramiding`）

```json
"pyramiding": {
  "enabled": true, "maxAdds": 2,
  "trigger": "pos.unrealizedR >= 1 and close > pos.lastAddPrice + atr14",
  "size": { "mode": "fraction_of_initial", "value": 0.5 },
  "onAdd": { "moveStop": { "type": "breakeven" } },
  "riskCap": { "maxOpenRiskR": 1.5 }
}
```

- `size.mode`：`fraction_of_initial`（第一筆的 value 倍）、`pyramid_decreasing`（每次乘 value 遞減）、`risk_based`（每次加 value R 的風險）。
- `trigger` 一定要包含「已經賺錢」的條件（例 `pos.unrealizedR >= 1`）。賠錢加碼（攤平）在遊戲裡算違規。
- 不加碼就整段省略，或寫 `{ "enabled": false }`。有加碼時 `plain` 要寫 `add`。

## 違規判定（`discipline`，通常省略）

預設 `{ "entryWindowBars": 1, "chaseAtr": 0.5, "sizeTolerancePct": 10, "stopGraceBars": 0, "allowDiscretionaryExit": true }`：訊號後 1 根內買都算合規、追價超過 0.5 ATR 算追高、股數差 10% 以上算偏離、停損當根就要確認、可以自己提早賣。使用者明確要求才改。

## 顯示用欄位

- `short`：8 字內的短名稱。`category`：`趨勢跟隨`、`動能突破`、`均值回歸` 三選一。`idea`：一句話。
- `roles`：每個指標 id 都要有一句說明。
- `plain`：白話條列，`buy`、`sell`（有加碼再加 `add`），每項一句、不用術語堆疊。數字用 `{path}` 引用，網站會換成目前的值，使用者調旋鈕時跟著變：

| 寫法 | 顯示 |
|---|---|
| `{ind:ma20.length}` | 指標參數，例 20 |
| `{stop:atr_initial.k}` | 第一條該類型停損的參數，例 2 |
| `{vars.kLow}`、`{targets.0.at.r}`、`{pyramiding.maxAdds}` | 其他欄位（點分路徑，陣列用索引） |
| `{targets.0.fraction\|%}` | 乘 100 加 %，例 0.5 → 50% |
| `{vars.near\|below}` | (1 − 值) 的 %，例 0.9 → 10% |
| `{vars.up\|above}` | (值 − 1) 的 %，例 1.3 → 30% |

`{path}` 一定要指到存在的數字。部位大小不用寫在 plain，網站會自動產生。

- `knobs`：3–6 個最值得調的數字，做成旋鈕。`path` 寫法同上（不含 `|格式`）；`min` ≤ 預設值 ≤ `max`；`step` > 0；`unit` 單位文字（天、根、R、× ATR）；比例用 `"pct": true`（顯示成 %）；倍數用 `"fmt": "x"`；`help` 一句說明。把條件式裡的門檻寫成 `$變數` 放進 `vars`，才能做成旋鈕。旋鈕調到 `max` 時策略仍要有效（例：均線天數的 max 不要超過 240）。

## 使用者沒講時的預設值

| 項目 | 預設 |
|---|---|
| 初始停損 | `atr_initial`，`k: 2`，搭配 `{ "id": "atr14", "type": "atr", "params": { "length": 14 } }` |
| 部位 | `{ "method": "risk_percent", "pct": 0.01, "caps": { "maxPositionPct": 0.4 } }` |
| 出場（趨勢、突破類） | 賺 1R 後 `chandelier` k 3（`"activateWhen": "pos.unrealizedR >= 1"`） |
| 出場（均值回歸類） | 目標價或回到均線就賣，加 `time_stop`（`bars: 10, minR: 99`） |
| 冷卻 | `entry.cooldownBars: 3` |
| 加碼 | 不加碼 |

## 送出前自我檢查

- [ ] 條件式用到的每個名稱都在 `indicators` 裡（多輸出指標寫對 `.輸出`），每個 `$變數` 都在 `vars` 裡。
- [ ] 至少一條沒有 `activateWhen` 的初始停損；用到 ATR 的停損 / 部位 / 停利都有 `atr` 指標，`atrId` 對得上。
- [ ] `ma_trailing` 的 `maId`、`structure` 的 `swingId` 指到存在的指標。
- [ ] 指標 id 只有英數和底線、不重複、不以數字開頭；params 在範圍內。
- [ ] 回看天數 ≤ 240；沒有絕對價格或絕對成交量門檻；只做多。
- [ ] `targets[].fraction` 在 0–1 之間；有加碼就有 `trigger` 而且 trigger 含賺錢條件。
- [ ] 每個 `knobs[].path` 和 `plain` 裡的 `{path}` 都指到存在的數字；預設值在 min–max 之間。
- [ ] JSON 合法：雙引號、沒有註解、沒有結尾逗號。

## 範例

### 1. 「KD 低檔黃金交叉買，KD 高檔死叉或跌破季線賣」

```json
{
  "id": "kd-golden-cross-ma60",
  "name": "KD 低檔黃金交叉 + 季線多頭",
  "short": "KD 低檔金叉",
  "category": "均值回歸",
  "idea": "季線之上的多頭裡，KD 在低檔黃金交叉代表回檔結束；KD 高檔死叉或跌破季線就走。",
  "plain": { "buy": [ "K 值往上穿過 D 值，且 K 值低於 {vars.kLow}", "收盤在 {ind:ma60.length} 日均線（季線）之上" ], "sell": [ "停損：買價往下 {stop:atr_initial.k} 倍 ATR", "K 值高於 {vars.kHigh} 後往下穿過 D 值就賣", "收盤跌破 {ind:ma60.length} 日均線全賣" ] },
  "roles": { "atr14": "停損距離", "ma60": "季線：多空分界與出場線", "kd": "KD：低檔金叉買、高檔死叉賣" },
  "indicators": [
    { "id": "atr14", "type": "atr", "params": { "length": 14 } },
    { "id": "ma60", "type": "sma", "params": { "length": 60 } },
    { "id": "kd", "type": "kd", "params": { "length": 9, "kSmooth": 3, "dSmooth": 3 } }
  ],
  "vars": { "kLow": 30, "kHigh": 80 },
  "entry": { "signal": "cross_up(kd.k, kd.d) and kd.k < $kLow and close > ma60", "cooldownBars": 3 },
  "sizing": { "method": "risk_percent", "pct": 0.01, "caps": { "maxPositionPct": 0.4 } },
  "stops": [
    { "type": "atr_initial", "params": { "atrId": "atr14", "k": 2 } }
  ],
  "exitSignals": [
    { "expr": "cross_down(kd.k, kd.d) and kd.k[1] > $kHigh", "fraction": 1 },
    { "expr": "close < ma60", "fraction": 1 }
  ],
  "knobs": [
    { "path": "vars.kLow", "label": "K 值低檔門檻", "min": 10, "max": 50, "step": 5, "help": "K 值低於多少時的黃金交叉才買。" },
    { "path": "vars.kHigh", "label": "K 值高檔門檻", "min": 50, "max": 90, "step": 5, "help": "K 值高於多少後的死亡交叉就賣。" },
    { "path": "ind:ma60.length", "label": "趨勢均線天數", "min": 20, "max": 120, "step": 10, "unit": "天", "help": "站在這條均線之上才買，跌破就賣。" },
    { "path": "stop:atr_initial.k", "label": "停損（ATR 倍數）", "min": 1, "max": 4, "step": 0.25, "unit": "× ATR", "help": "買價往下幾倍 ATR 停損。" }
  ]
}
```

### 2. 「多頭裡跌破布林下軌又收回來就買，碰到中軌賣，最多抱 10 天」

```json
{
  "id": "bb-lower-bounce",
  "name": "布林下軌反彈（多頭限定）",
  "short": "布林下軌反彈",
  "category": "均值回歸",
  "idea": "長期多頭裡跌破布林下軌後收回，短線常會反彈到中軌；快進快出。",
  "plain": { "buy": [ "收盤在 {ind:ma120.length} 日均線之上（長期多頭）", "前一根收在布林下軌之下，今天收回下軌之上" ], "sell": [ "碰到布林中軌就賣", "持有滿 {stop:time_stop.bars} 根就賣", "停損：買價往下 {stop:pct_initial.p|%}" ] },
  "roles": { "ma120": "長期多頭過濾（半年線）", "bb": "布林通道：下軌找買點、中軌當目標" },
  "indicators": [
    { "id": "ma120", "type": "sma", "params": { "length": 120 } },
    { "id": "bb", "type": "bollinger", "params": { "length": 20, "mult": 2 } }
  ],
  "entry": { "signal": "close > ma120 and close[1] < bb.lower[1] and close > bb.lower", "cooldownBars": 2 },
  "sizing": { "method": "risk_percent", "pct": 0.01, "caps": { "maxPositionPct": 0.4 } },
  "stops": [
    { "type": "pct_initial", "params": { "p": 0.06 } },
    { "type": "time_stop", "params": { "bars": 10, "minR": 99 } }
  ],
  "targets": [
    { "at": { "expr": "bb.mid" }, "fraction": 1 }
  ],
  "knobs": [
    { "path": "ind:bb.mult", "label": "布林倍數", "min": 1.5, "max": 3, "step": 0.1, "unit": "× σ", "help": "下軌離中軌幾個標準差。" },
    { "path": "stop:pct_initial.p", "label": "停損", "min": 0.03, "max": 0.12, "step": 0.01, "pct": true, "help": "買價往下幾 % 停損。" },
    { "path": "stop:time_stop.bars", "label": "最長持有", "min": 3, "max": 20, "step": 1, "unit": "根", "help": "超過就賣。" }
  ]
}
```

### 3. 「爆量突破 60 日高點追進，賺錢再加碼，用移動停利出場」

```json
{
  "id": "volume-breakout-pyramid",
  "name": "爆量突破 + 順勢加碼",
  "short": "爆量突破",
  "category": "動能突破",
  "idea": "帶量突破 60 日高點才追，賺錢後再加碼，讓大波段變大。",
  "plain": { "buy": [ "收盤突破前 {ind:dc60.length} 天最高價", "成交量是 20 日均量的 {vars.volX} 倍以上", "收盤在季線（60 日均線）之上" ], "sell": [ "停損：買價往下 {stop:atr_initial.k} 倍 ATR", "賺到 {stop:breakeven.atR}R，停損拉到成本", "從最高點回落 {stop:chandelier.k} 倍 ATR 就賣" ], "add": [ "賺 1R 以上且比上次買價再漲 1 倍 ATR 就加碼第一筆的一半，最多 {pyramiding.maxAdds} 次" ] },
  "roles": { "atr14": "停損、移動停利與加碼間距", "ma60": "季線：多頭過濾", "dc60": "60 日高點：突破判斷", "vol20": "20 日均量：爆量判斷" },
  "indicators": [
    { "id": "atr14", "type": "atr", "params": { "length": 14 } },
    { "id": "ma60", "type": "sma", "params": { "length": 60 } },
    { "id": "dc60", "type": "donchian", "params": { "length": 60 } },
    { "id": "vol20", "type": "volume_ma", "params": { "length": 20 } }
  ],
  "vars": { "volX": 1.5 },
  "entry": { "signal": "close > dc60.upper[1] and volume > vol20 * $volX and close > ma60", "cooldownBars": 5 },
  "sizing": { "method": "risk_percent", "pct": 0.01, "caps": { "maxPositionPct": 0.5, "maxOpenRiskR": 1.5 } },
  "stops": [
    { "type": "atr_initial", "params": { "atrId": "atr14", "k": 2 } },
    { "type": "breakeven", "params": { "atR": 1.5 } },
    { "type": "chandelier", "params": { "atrId": "atr14", "k": 3 } }
  ],
  "pyramiding": { "enabled": true, "maxAdds": 2, "trigger": "pos.unrealizedR >= 1 and close > pos.lastAddPrice + atr14", "size": { "mode": "fraction_of_initial", "value": 0.5 }, "onAdd": { "moveStop": { "type": "breakeven" } }, "riskCap": { "maxOpenRiskR": 1.5 } },
  "knobs": [
    { "path": "ind:dc60.length", "label": "突破天數", "min": 20, "max": 120, "step": 10, "unit": "天", "help": "突破前 N 天最高價。" },
    { "path": "vars.volX", "label": "爆量倍數", "min": 1, "max": 3, "step": 0.1, "fmt": "x", "help": "成交量至少是 20 日均量的幾倍。" },
    { "path": "stop:chandelier.k", "label": "移動停利（ATR 倍數）", "min": 2, "max": 5, "step": 0.25, "unit": "× ATR", "help": "從最高點回落幾倍 ATR 就賣。" },
    { "path": "pyramiding.maxAdds", "label": "最多加碼次數", "min": 0, "max": 4, "step": 1, "unit": "次", "help": "0 = 不加碼。" }
  ]
}
```
