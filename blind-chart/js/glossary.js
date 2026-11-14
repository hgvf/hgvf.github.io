// glossary.js — 專業術語說明。qm(key) 產生「?」按鈕；桌機滑過、手機點一下顯示說明。
// 查找順序：`${scope}.${key}` → key，所以同名參數可依情境給不同解釋（例 stop.k / sizing.pct）。
import { esc } from './ui.js';

export const GLOSSARY = {
  // ── 基本概念 ──
  R: 'R：一筆交易照規則停損時會賠的錢（買價 − 停損價）× 股數。開始頁的「每筆最多賠」就是 1R 的上限，股數由它反推。+2R = 賺到兩倍風險。',
  '1R': '1R = 這筆交易照規則停損時的預定虧損金額。所有損益都可以換算成幾個 R，方便比較不同大小的交易。',
  id: '策略的唯一代號（英數），用來存檔與辨識。',
  name: '顯示用的策略名稱。',
  expr: '條件式：用 close、high、指標 id（例 ema20、dc20.upper）組成的判斷，例 close > ema20 and rsi14 > 50。x[1] 是前一根的值。函數：cross_up(a,b)、cross_down、rising(x,n)、falling、highest(x,n)、lowest、min、max、abs。部位變數：pos.unrealizedR、pos.barsHeld、pos.adds…',
  'entry.signal': '進場條件式：在某根 K 棒收盤後成立，就是「進場訊號」，預設下一根開盤買進。例 cross_up(close, dc20.upper[1]) = 收盤價向上突破前一根的 20 日高點。',
  cooldownBars: '冷卻期：出場後至少隔幾根 K 棒才允許下一次進場，避免剛停損又馬上追回去。',
  activateWhen: '啟動條件（選填）：條件成立後這條停損才開始生效，而且一旦生效就不會關閉。例 pos.unrealizedR >= 2 = 賺到 2R 之後才改用這條移動停利。',

  // ── 指標 ──
  sma: 'SMA 簡單移動平均：最近 N 根收盤價的平均。',
  ema: 'EMA 指數移動平均：越近的價格權重越高，反應比 SMA 快。',
  wma: 'WMA 加權移動平均：權重線性遞減（最新一根權重 N，最舊一根權重 1）。',
  rma: 'RMA（Wilder 平滑）：權重 1/N 的指數平均，RSI、ATR 原版都用它，比 EMA 更平滑。',
  atr: 'ATR 平均真實區間：一根 K 棒「真實波動幅度」的平均，衡量這檔股票平常一天動多少。常用來設停損距離（例 2 × ATR）。',
  donchian: 'Donchian 通道：最近 N 根的最高價（upper）與最低價（lower）。收盤突破 upper = 創 N 日新高，是海龜交易的經典進場訊號。',
  bollinger: '布林通道：均線 ± 倍數 × 標準差。width = 通道寬度 / 中線，可看波動收斂或擴張。',
  keltner: 'Keltner 通道：EMA ± 倍數 × ATR，比布林通道平滑。',
  rsi: 'RSI 相對強弱指標（0–100）：近期漲幅佔總波動的比例。> 70 常視為過熱，< 30 常視為超賣。',
  macd: 'MACD：快 EMA − 慢 EMA（macd，又稱 DIF），再取其 EMA 當訊號線（signal），兩者差為柱狀體（hist）。',
  kd: 'KD 隨機指標（0–100）：收盤價在最近 N 天高低區間的位置。K 是快線、D 是慢線；> 80 偏熱、< 20 偏冷。',
  kSmooth: 'K 值的平滑天數（台灣常用 3）。', dSmooth: 'D 值的平滑天數（台灣常用 3）。',
  adx: 'ADX 趨向指標：衡量趨勢「強度」（不分方向），> 25 通常代表有趨勢；pdi / mdi 分別是上漲與下跌動能。',
  supertrend: 'SuperTrend：以 ATR 畫出的跟隨趨勢線，價格在線上方為多頭（dir = 1）。',
  swing: 'Swing 波段高低點：左右各 N 根都比它低（高）的高點（低點）。要等右邊 N 根走完才確認，所以不會偷看未來。',
  volume_ma: '量均線：成交量（或成交金額）的移動平均，例 volume > vol20 * 1.5 = 量增 50%。',
  roc: 'ROC 變動率：(今天收盤 ÷ N 根前收盤 − 1) × 100。roc252 > 0 代表過去一年是上漲的（時間序列動能）。',
  linreg: '指數迴歸動能（Clenow）：對過去 N 根的 ln(收盤) 做線性迴歸，slope = 年化斜率 %，r2 = 擬合程度（0–1），adj = slope × r2。漲得又快又穩的股票 adj 最高。',
  rel_strength: '相對大盤強度：個股 N 日報酬相對大盤 N 日報酬的差（%），> 0 代表比大盤強。',
  length: '計算長度：用最近幾根 K 棒計算。',
  source: '用哪個價格計算：close 收盤、hl2 =（高+低）/2、hlc3 =（高+低+收）/3、ohlc4 = 四價平均。',
  smoothing: 'ATR 的平滑方式。Wilder 原版是 rma；sma / ema / wma 是其他算法，數值會略有不同。',
  trMode: '真實區間（True Range）的算法：standard = max(高−低, |高−昨收|, |低−昨收|)（Wilder 原版）；hl = 只看當天高−低（忽略跳空）；gap_aware = 額外加重開盤跳空。',
  asPercent: '勾選後 ATR 以「佔收盤價的 %」表示，方便跨股票比較。',
  mult: '倍數：通道寬度是幾倍的標準差或 ATR。',
  maType: '中線用哪種均線。',
  atrLength: '計算 ATR 的長度。',
  fast: 'MACD 快線 EMA 長度。', slow: 'MACD 慢線 EMA 長度。', signal: 'MACD 訊號線長度（對 macd 再取 EMA）。',
  left: '左邊需要幾根 K 棒比它低（高）。', right: '右邊需要幾根 K 棒確認；越大越可靠，但確認越晚。',
  field: '用成交量（volume）或成交金額（turnover）。',
  benchmark: '對照的大盤（題目附帶的縮放指數）。',

  // ── 部位大小 ──
  method: '決定買幾股的方法（詳見各選項的說明）。',
  max_loss_amount: '固定最大虧損：股數 = 金額 ÷ 停損距離。不管股價多少，停損時都虧同樣的錢（= 1R）。',
  risk_percent: '帳戶 % 風險：股數 = 權益 × % ÷ 停損距離。例 1% = 每筆停損最多虧帳戶的 1%。',
  total_cost: '固定總成本：股數 = 金額 ÷ 進場價，每筆投入同樣的錢；R 由停損距離反推。',
  percent_equity: '帳戶 % 部位：股數 = 權益 × % ÷ 進場價，每筆用帳戶固定比例的錢。',
  fixed_shares: '固定股數：每筆買一樣的股數。',
  vol_target: '波動度目標：股數 = 權益 × 目標 % ÷ ATR，波動越大的股票買越少。',
  amount: '每筆交易停損時願意虧的金額（= 1R）。',
  'sizing.pct': '比例（0.01 = 1%）。',
  cost: '每筆投入的總金額。', shares: '每筆固定買幾股。', targetVolPct: '希望一天的波動佔權益的比例（0.01 = 1%）。',
  maxPositionPct: '單筆市值上限：持倉市值不超過權益的這個比例（0.3 = 30%）。',
  maxRiskPct: '每筆最多賠：一筆交易打到停損最多賠帳戶的幾 %（開始頁設定）。',
  maxOpenRiskR: '未保護風險上限：所有持倉（含加碼）如果全部停損，總虧損不超過幾個 R。',
  cashOnly: '只用現金，不融資。',
  lotSize: '交易單位：台股一張 1000 股、日股 100 股、美韓 1 股，股數會無條件捨去到這個倍數。',

  // ── 停損 ──
  stops: '可以疊加多條停損，系統取「最保護」（最高）的那一條，而且只會往上移，不會往下（ratchet）。',
  atr_initial: '初始 ATR 停損：進場價 − k × ATR（用進場訊號當下的 ATR），之後固定不動。',
  pct_initial: '初始 % 停損：進場價 ×（1 − p）。例 p = 0.08 → 跌 8% 停損。',
  structure: '結構停損：放在最近一個 swing low（波段低點）下方一點（buffer），跌破前低代表結構被破壞。',
  atr_trailing: 'ATR 移動停損：收盤價 − k × ATR，價格上漲時跟著上移，只上不下。',
  chandelier: 'Chandelier 吊燈停損：進場後最高價 − k × ATR，像吊燈一樣從最高點往下掛。',
  ma_trailing: '均線移動停損：跌破指定均線（± buffer）就出場。trigger = close 只看收盤跌破；low = 盤中碰到就算。',
  donchian_trailing: 'N 日低點停損：跌破最近 N 根的最低點就出場（海龜交易的出場法）。',
  breakeven: '保本停損：賺到 atR 個 R 之後，停損移到均價（可加 offset），這筆交易最差打平。',
  step_r: '階梯 R 停損：每多賺 stepR 個 R，停損就上移 moveR 個 R。',
  time_stop: '時間停損：持有 bars 根仍沒賺到 minR 個 R 就出場，避免資金卡在不動的股票。',
  atrId: '用哪一個 ATR 指標（填指標 id，例 atr14）。',
  'stop.k': '倍數：停損距離是幾倍 ATR。越大越不容易被洗掉，但每筆虧損（1R）也越大。',
  k: '倍數。',
  p: '比例（0.08 = 8%）。',
  swingId: '用哪一個 swing 指標（填 id）。',
  bufferAtr: '再往下留幾倍 ATR 的緩衝，避免剛好被掃到。',
  bufferPct: '再往下留幾 % 的緩衝（0.01 = 1%）。',
  trail: '勾選後，出現更高的 swing low 時停損會跟著上移。',
  maId: '用哪一條均線（填指標 id，例 ema20）。',
  trigger: 'close：收盤跌破才算，下一根開盤出場；low：盤中最低價碰到就算。',
  atR: '賺到幾個 R 之後啟動保本。',
  offsetR: '保本線再往上加幾個 R（0 = 剛好均價）。',
  offsetPct: '保本線再往上加幾 %。',
  stepR: '每賺幾個 R 上移一階。', moveR: '每階停損上移幾個 R。',
  bars: '持有幾根 K 棒後檢查。', minR: '到時候至少要賺幾個 R，否則出場。',

  // ── 停利 / 出場 / 加碼 ──
  targets: '分批停利：價格碰到目標就賣出一部分（fraction），可以設定之後改用另一條停損（thenStop）。',
  exitSignals: '出場訊號：條件式成立就在下一根開盤賣出 fraction 比例。例 close < ema60 = 收盤跌破季線出場。',
  fraction: '賣出比例（1 = 全部，0.5 = 一半）。',
  pyramiding: '加碼：部位賺錢且條件成立時加碼，讓贏的交易更大。虧損中加碼（攤平）會被判違規。',
  enabled: '是否啟用。',
  maxAdds: '最多加碼幾次。',
  'pyramiding.trigger': '加碼條件式，例 pos.unrealizedR >= 1 and close > pos.lastAddPrice + 0.5 * atr14 = 已賺 1R 且比上次加碼價再漲 0.5 ATR。',

  // ── 紀律 ──
  discipline: '紀律容忍度：定義什麼情況算違規。',
  entryWindowBars: '訊號後幾根內進場都算合規（0 = 只能在訊號那根）。',
  chaseAtr: '追價容忍：成交價高於訊號價 + 這個倍數 × ATR 就算追價。',
  sizeTolerancePct: '股數與建議股數差超過這個 % 就算部位偏離。',
  stopGraceBars: '停損觸發後，幾根內出場不算違規（0 = 觸發當根就要確認）。',
  allowDiscretionaryExit: '勾選 = 規則沒叫你賣、你自己提早賣不算違規；取消勾選則會記「提早出場」。',
  'fill.mode': 'next_open：收盤後下單，下一根開盤成交（預設，最貼近實戰）；this_close：以當根收盤價成交。',

  // ── 遊戲 / 報告 ──
  shadow: '影子帳戶（Shadow）：同一題、同一策略，所有進出場與加碼都由規則自動執行，等於「這個策略本身的表現」。',
  actual: '實際帳戶（Actual）：照你的實際操作重算的結果。',
  counterfactual: '反事實帳戶：只把某一個違規改成規則動作，其他保持不變重算。兩者的差 = 這個違規的代價。',
  cost: '違規代價 = 反事實權益 − 實際權益。正數 = 這個違規讓你少賺（多賠）；負數 = 這次違規反而賺到（運氣）。',
  interaction: '交互殘差：Shadow − Actual 不一定等於各違規代價加總，差額來自違規彼此影響，以及影子帳戶進出時機不同。',
  score: '紀律分數 = 100 − 各違規權重加總（最低 0）。只看行為、不看賺賠：賺錢但違規一樣扣分。',
  compliance: '規則遵守率 = 合規的動作數 ÷ 規則要求的動作數。',
  totalR: '總 R：所有交易的 R 加總。',
  vars: '策略變數：條件式裡寫 $名稱，引擎會換成這裡設定的數字。把門檻（例如 RSI < 10 的 10）做成變數，就能用旋鈕調整，不必改條件式。',
  quickBacktest: '快速回測：在題庫挑 42 題（多頭、空頭、盤整各 14 題）跑影子帳戶，幾十毫秒就算完，適合調旋鈕時看方向。樣本小、數字會跳動；完整題庫的結果是預先算好的。',
  avgHold: '平均持有：每筆交易從進場到出場平均幾根 K 棒。均值回歸通常幾天、趨勢跟隨通常幾週到幾個月。',
  level: '入門：規則少、旋鈕少，容易看懂每個設定的影響。進階：有加碼、結構停損或多重條件，適合熟悉後再調。',
  sharpe: 'Sharpe ratio：平均日報酬 ÷ 日報酬標準差 × √252，代表每承擔一單位波動拿到多少報酬。> 0.5 算不錯、> 1 很好。不受部位大小影響，適合比較部位大小不同的策略。',
  annReturn: '平均年化報酬：每題報酬換算成 252 根（約一年）的年化值後取平均。',
  maxDDP90: '最大回撤（較差 10%）：把所有題目的最大回撤排序，取第 90 百分位，代表「運氣不好時」大概會回撤多少。',
  exposure: '曝險：持有部位的 K 棒佔全部 K 棒的比例。曝險低的策略大部分時間空手，報酬與回撤自然都小。',
  winRate: '勝率：獲利交易佔全部交易的比例。趨勢策略勝率常只有 30–40%，靠少數大賺撐起整體；均值回歸則相反。',
  expectancy: '期望值：平均每筆交易賺幾個 R。> 0 代表長期有優勢。',
  profitFactor: 'Profit factor = 總獲利 ÷ 總虧損，> 1 才賺錢。',
  maxDD: '最大回撤：權益從高點往下跌的最大幅度。',
  mae: 'MAE（最大不利偏移）：持有期間最多曾經虧到幾個 R。',
  mfe: 'MFE（最大有利偏移）：持有期間最多曾經賺到幾個 R。',
  unrealized: '未實現損益：持倉以現價計算、還沒賣掉的損益。',
  effStop: '有效停損：目前所有停損規則中最高的那一條，下一根盤中碰到就該出場。',
  openRisk: '未保護風險：如果現在全部打到停損，會虧多少（以 R 和帳戶 % 表示）。停損移到均價以上時為 0。',
  hint: '提示強度：full = 畫線 + 文字提示；lines = 只畫線；none = 什麼都不畫，只在檢討報告比對。',
  campaign: '連關：N 題串成一關，權益延續到下一題，最後看綜合結果。',
  mixed: '混合盲測：連市場都隱藏，交易單位一律 1 股。',
  regime: '盤勢：題目可操作區間的走勢分類（多頭 / 空頭 / 盤整），依報酬與 ADX 判斷。',
  survivorship: 'Survivorship bias（倖存者偏差）：題庫只收現在還上市的股票，下市的輸家不在裡面，所以 Buy & hold 看起來會偏好。',
};

export function tip(key, scope) {
  return (scope && GLOSSARY[`${scope}.${key}`]) || GLOSSARY[key] || null;
}

/** 直接用一段文字做「?」按鈕（旋鈕說明等） */
export function qmText(text) {
  return text ? `<button type="button" class="qm" data-tip="${esc(text)}" aria-label="說明">?</button>` : '';
}

/** 「?」按鈕 HTML；找不到說明時回傳空字串。 */
export function qm(key, scope) {
  const t = tip(key, scope);
  return t ? `<button type="button" class="qm" data-tip="${esc(t)}" aria-label="說明：${esc(key)}">?</button>` : '';
}

let pop = null;
function show(btn) {
  if (!pop) { pop = document.createElement('div'); pop.className = 'qm-pop'; pop.setAttribute('role', 'tooltip'); document.body.appendChild(pop); }
  pop.textContent = btn.dataset.tip;
  pop.classList.add('show');
  const r = btn.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 24);
  pop.style.width = `${w}px`;
  const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
  pop.style.left = `${left}px`;
  const h = pop.offsetHeight;
  const below = r.bottom + 8 + h < window.innerHeight;
  pop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - h - 8)}px`;
  pop._btn = btn;
  pop._shownAt = Date.now();
}
function hide() { pop?.classList.remove('show'); if (pop) { pop._btn = null; pop._sticky = false; } }

/** 全域安裝一次：hover（滑鼠）與 click（觸控）都能開。 */
export function initTips() {
  document.addEventListener('mouseover', e => { const b = e.target.closest?.('.qm'); if (b && matchMedia('(hover: hover)').matches) { show(b); pop._hoverAt = Date.now(); pop._sticky = false; } });
  document.addEventListener('mouseout', e => { if (e.target.closest?.('.qm') && matchMedia('(hover: hover)').matches && !pop?._sticky) hide(); });
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.qm');
    if (b) { e.preventDefault(); e.stopPropagation(); const justHovered = pop && Date.now() - (pop._shownAt || 0) < 350;
      if (pop?._btn === b && pop.classList.contains('show') && !justHovered) hide(); else show(b);
      if (pop) { pop._hoverAt = 0; pop._sticky = pop.classList.contains('show'); }
      return; }
    hide();
  }, true);
  window.addEventListener('scroll', () => { if (pop && Date.now() - (pop._shownAt || 0) > 400) hide(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
}
