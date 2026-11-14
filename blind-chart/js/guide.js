// guide.js — #/guide：策略 JSON 寫法。指標、停損、部位的表格直接從引擎的登錄表產生，跟程式保持一致。
import { $, esc, toast } from './ui.js';
import { allStrategies } from './strategies.js';
import { saveCustomStrategy } from './store.js';
import { INDICATORS, STOPS, SIZING, POS_VARS, ACCT_VARS, DEFAULT_DISCIPLINE, validateSpec, withDefaults } from '../engine/index.js';
import { tip } from './glossary.js';
import { stratList, bindAside } from './editor.js';
import { prettyJson } from './describe.js';

const EXAMPLE = {
  id: 'my-ema-cross',
  name: '均線交叉（範例）',
  indicators: [
    { id: 'atr14', type: 'atr', params: { length: 14 } },
    { id: 'ema20', type: 'ema', params: { length: 20 } },
    { id: 'ema60', type: 'ema', params: { length: 60 } },
    { id: 'rsi14', type: 'rsi', params: { length: 14 } },
  ],
  vars: { rsiMin: 50 },
  entry: { signal: 'cross_up(ema20, ema60) and rsi14 > $rsiMin', cooldownBars: 3 },
  sizing: { method: 'risk_percent', pct: 0.01, caps: { maxPositionPct: 0.5 } },
  stops: [
    { type: 'atr_initial', params: { atrId: 'atr14', k: 2 } },
    { type: 'chandelier', params: { atrId: 'atr14', k: 3 }, activateWhen: 'pos.unrealizedR >= 1' },
  ],
  targets: [{ at: { r: 3 }, fraction: 0.5 }],
  exitSignals: [{ expr: 'cross_down(ema20, ema60)', fraction: 1 }],
};

const POS_DESC = {
  size: '持有股數', avgPrice: '持有均價', unrealizedR: '目前賺幾 R（以收盤計）', unrealizedPnl: '未實現損益', barsHeld: '持有幾根',
  adds: '已加碼幾次', highestSinceEntry: '買進後最高價', lastAddPrice: '最近一次買進價', entryPrice: '第一筆買價',
  initialStop: '初始停損價', stop: '目前有效停損', riskPerShare: '每股風險（買價 − 初始停損）',
};
const ACCT_DESC = { equity: '帳戶權益', cash: '現金', openRiskR: '全部停損會賠幾 R', openRisk: '全部停損會賠多少' };
const FUNCS = [
  ['cross_up(a, b)', 'a 由下往上穿過 b（前一根 a ≤ b，這根 a > b）'],
  ['cross_down(a, b)', 'a 由上往下穿過 b'],
  ['rising(x, n)', 'x 比前 n 根都高'],
  ['falling(x, n)', 'x 比前 n 根都低'],
  ['highest(x, n)', '最近 n 根（含這根）x 的最大值'],
  ['lowest(x, n)', '最近 n 根 x 的最小值'],
  ['sma(x, n)', '最近 n 根 x 的平均'],
  ['change(x, n)', 'x − n 根前的 x（n 省略 = 1）'],
  ['min(a, b, …) / max(…)', '最小 / 最大值'],
  ['abs(x)', '絕對值'],
  ['nz(x, v)', 'x 算不出來（NaN）時用 v'],
  ['na(x)', 'x 算不出來時為真'],
];
const KIND = { initial: '初始', trailing: '移動', close: '收盤檢查' };

const code = s => `<code>${esc(s)}</code>`;
const params = schema => Object.entries(withDefaults(schema, {})).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join('、') || '—';
const tbl = (head, rows) => `<div class="tbl-wrap"><table class="tbl gd-tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

export async function renderGuide(root) {
  const ok = !validateSpec(EXAMPLE).length;
  const sections = [
    ['ex', '範例'], ['top', '欄位'], ['expr', '條件式'], ['ind', '指標'], ['stop', '停損'], ['size', '部位'], ['tgt', '停利與賣出'], ['pyr', '加碼'], ['disc', '違規判定'], ['err', '常見錯誤'],
  ];
  root.innerHTML = `
  <div class="editor editor-ov">
    ${stratList(allStrategies(), null, 'guide')}
    <div class="ed-main gd">
      <section class="card">
        <h2>策略 JSON 寫法</h2>
        <nav class="gd-toc">${sections.map(([k, n]) => `<a href="#gd-${k}" data-jump="gd-${k}">${n}</a>`).join('')}</nav>
      </section>

      <section class="card" id="gd-ex">
        <h2>範例</h2>
        <p>20 日均線往上穿過 60 日均線、而且 RSI 高於 50 就買；停損 2 倍 ATR，賺 1R 後改用移動停利，3R 先賣一半，均線死叉全賣。</p>
        <pre class="gd-code">${esc(prettyJson(EXAMPLE))}</pre>
        <div class="ctrl" style="margin-top:8px">
          <button class="btn btn-primary btn-sm" id="gdUse" ${ok ? '' : 'disabled'}>用這個範例新增策略</button>
          <button class="btn btn-sm" id="gdCopy">複製</button>
        </div>
      </section>

      <section class="card" id="gd-top">
        <h2>欄位</h2>
        ${tbl(['欄位', '必填', '內容', '預設'], [
          [code('id'), '✓', '英數、底線、減號，不能和其他策略重複', '—'],
          [code('name') + ' / ' + code('short'), '', '名稱 / 短名稱（清單用）', '—'],
          [code('indicators'), '', '用到的指標，見「指標」', '[]'],
          [code('vars'), '', '條件式裡的 <code>$名稱</code> → 數字', '{}'],
          [code('entry.signal'), '✓', '買進條件。收盤後成立，下一根開盤買', '—'],
          [code('entry.cooldownBars'), '', '賣出後幾根內不再買', '0'],
          [code('sizing'), '', '每筆買多少，見「部位」', 'max_loss_amount 10000'],
          [code('stops'), '✓', '停損，至少一條初始停損', '—'],
          [code('targets'), '', '分批停利', '[]'],
          [code('exitSignals'), '', '賣出條件', '[]'],
          [code('pyramiding'), '', '加碼', '不加碼'],
          [code('fill.mode'), '', '<code>next_open</code> 下一根開盤成交、<code>this_close</code> 當根收盤成交', 'next_open'],
          [code('discipline'), '', '什麼算違規', '見「違規判定」'],
          [code('account'), '', '<code>initialEquity</code> 起始資金、<code>lotSize</code> 各市場交易單位', '1,000,000；台股 1000 股'],
        ])}
      </section>

      <section class="card" id="gd-expr">
        <h2>條件式</h2>
        <p>用在 <code>entry.signal</code>、<code>exitSignals[].expr</code>、<code>stops[].activateWhen</code>、<code>pyramiding.trigger</code>。每根 K 棒收盤後計算一次，只看得到這根和之前的資料。</p>
        ${tbl(['寫法', '意思', '例'], [
          [code('open high low close volume'), '這根的價格、成交量', code('close > open')],
          [code('指標 id'), '指標的第一個輸出', code('ema20')],
          [code('id.輸出'), '多輸出指標的某一條', code('dc20.upper') + '、' + code('macd.signal')],
          [code('x[n]'), 'n 根前的值', code('close[1]') + ' 前一根收盤'],
          [code('+ - * /'), '四則運算', code('close > ema20 * 1.02')],
          [code('> < >= <= == !='), '比較', ''],
          [code('and or not ( )'), '組合條件', code('a > b and (c or not d)')],
          [code('$名稱'), '換成 vars 裡的數字', code('rsi14 < $rsiTh')],
        ])}
        <h3>函數</h3>
        ${tbl(['函數', '意思'], FUNCS.map(([f, d]) => [code(f), d]))}
        <h3>持有中的部位（<code>pos.</code>）與帳戶（<code>acct.</code>）</h3>
        ${tbl(['變數', '意思'], [...POS_VARS.map(v => [code('pos.' + v), POS_DESC[v] || '']), ...ACCT_VARS.map(v => [code('acct.' + v), ACCT_DESC[v] || ''])])}
      </section>

      <section class="card" id="gd-ind">
        <h2>指標</h2>
        <p>寫法：<code>{ "id": "ema20", "type": "ema", "params": { "length": 20 } }</code>。<code>id</code> 自己取（英數、底線，不能數字開頭），條件式用它引用。params 沒寫就用預設值。</p>
        ${tbl(['type', '名稱', 'params（預設）', '條件式怎麼用'], Object.entries(INDICATORS).map(([k, p]) => [
          code(k), esc(p.label), `<span class="mono">${esc(params(p.paramsSchema))}</span>`,
          p.outputs.length > 1 ? p.outputs.map(o => code(`id.${o}`)).join(' ') + `<br><span class="sub">只寫 id = id.${esc(p.outputs[0])}</span>` : code('id'),
        ]))}
      </section>

      <section class="card" id="gd-stop">
        <h2>停損</h2>
        <p>寫法：<code>{ "type": "atr_initial", "params": { "atrId": "atr14", "k": 2 } }</code>。可以寫很多條，取最高的那條，而且只往上移。加 <code>activateWhen</code> 可以讓某條停損在條件成立後才生效，例 <code>"pos.unrealizedR >= 2"</code>。</p>
        <p><b>至少要有一條初始停損</b>（<code>atr_initial</code>、<code>pct_initial</code> 或 <code>structure</code>），1R 才算得出來。</p>
        ${tbl(['type', '種類', 'params（預設）', '說明'], Object.entries(STOPS).map(([k, p]) => [code(k), KIND[p.kind] || '', `<span class="mono">${esc(params(p.paramsSchema))}</span>`, esc(tip(k) || p.label)]))}
      </section>

      <section class="card" id="gd-size">
        <h2>部位</h2>
        <p>寫法：<code>{ "method": "risk_percent", "pct": 0.01, "caps": { "maxPositionPct": 0.4 } }</code>。股數會無條件捨去到交易單位（台股 1000 股）。遊戲裡會再套用開始頁的「每筆最多賠」。</p>
        ${tbl(['method', '名稱', '參數（預設）', '算法'], Object.entries(SIZING).map(([k, p]) => [code(k), esc(p.label), `<span class="mono">${esc(params(p.paramsSchema))}</span>${k === 'vol_target' ? '<span class="mono">、atrId</span>' : ''}`, esc(tip(k) || '')]))}
        <h3><code>caps</code> 上限</h3>
        ${tbl(['欄位', '意思'], [
          [code('maxPositionPct'), '單筆市值最多佔帳戶幾成（0.4 = 40%）'],
          [code('maxRiskPct'), '每筆最多賠帳戶幾 %（開始頁會自動填）'],
          [code('maxOpenRiskR'), '全部部位一起停損最多賠幾 R'],
          [code('cashOnly'), '只用現金、不融資（預設 true）'],
        ])}
      </section>

      <section class="card" id="gd-tgt">
        <h2>停利與賣出</h2>
        <h3><code>targets</code> 分批停利（盤中碰到就賣）</h3>
        ${tbl(['欄位', '意思', '例'], [
          [code('at.r'), '買價 + 幾 R', code('{ "at": { "r": 2 }, "fraction": 0.5 }')],
          [code('at.atr') + ' + ' + code('at.atrId'), '買價 + 幾倍 ATR', code('{ "at": { "atr": 3, "atrId": "atr14" }, "fraction": 0.3 }')],
          [code('at.expr'), '用條件式算出的價格', code('{ "at": { "expr": "bb.upper" }, "fraction": 1 }')],
          [code('fraction'), '賣出比例（0–1）', ''],
          [code('thenStop'), '碰到後改用另一條停損（寫法同 stops）', code('{ "type": "breakeven" }')],
        ])}
        <h3><code>exitSignals</code> 賣出條件（收盤成立，下一根開盤賣）</h3>
        ${tbl(['欄位', '意思'], [[code('expr'), '條件式'], [code('fraction'), '賣出比例，1 = 全賣']])}
      </section>

      <section class="card" id="gd-pyr">
        <h2>加碼</h2>
        ${tbl(['欄位', '意思'], [
          [code('enabled'), 'true 才會加碼'],
          [code('maxAdds'), '最多加碼幾次'],
          [code('trigger'), '加碼條件式，例 <code>pos.unrealizedR >= 1 and close > pos.lastAddPrice + 0.5 * atr14</code>'],
          [code('size.mode'), '<code>fraction_of_initial</code> 第一筆的幾倍、<code>pyramid_decreasing</code> 每次遞減、<code>risk_based</code> 每次加幾 R 風險'],
          [code('size.value'), '上面的倍數或 R（預設 0.5）'],
          [code('onAdd.moveStop'), '<code>{ "type": "breakeven" }</code> 加碼後停損拉到成本'],
          [code('riskCap.maxOpenRiskR'), '加碼後全部停損最多賠幾 R'],
        ])}
        <p class="sub">賠錢時加碼（攤平）在遊戲裡算違規。</p>
      </section>

      <section class="card" id="gd-disc">
        <h2>違規判定 <span class="sub">discipline，只影響紀律分數</span></h2>
        ${tbl(['欄位', '預設', '意思'], [
          ['entryWindowBars', 'entryWindowBars'], ['chaseAtr', 'chaseAtr'], ['sizeTolerancePct', 'sizeTolerancePct'], ['stopGraceBars', 'stopGraceBars'], ['allowDiscretionaryExit', 'allowDiscretionaryExit'],
        ].map(([k]) => [code(k), `<span class="mono">${esc(String(DEFAULT_DISCIPLINE[k]))}</span>`, esc(tip(k) || '')]))}
      </section>

      <section class="card" id="gd-err">
        <h2>常見錯誤</h2>
        ${tbl(['錯誤訊息', '怎麼改'], [
          ['至少需要一個初始停損', '加一條 <code>atr_initial</code> / <code>pct_initial</code> / <code>structure</code>'],
          ['用到 ATR 的規則需要先定義一個 atr 指標', '在 indicators 加 <code>{ "id": "atr14", "type": "atr" }</code>，停損的 <code>atrId</code> 填它'],
          ['未知的變數', '條件式裡的名稱沒有在 indicators 定義，或多輸出指標沒寫 <code>.輸出</code>'],
          ['未定義的策略變數 $x', '在 <code>vars</code> 加上 <code>"x": 數字</code>'],
          ['id 只能用英數與底線', '指標 id 不能有空白、減號，也不能數字開頭（<code>ema20</code> 可以、<code>20ema</code> 不行）'],
        ])}
      </section>
    </div>
  </div>`;
  bindAside(root);
  root.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#gdCopy').onclick = async () => { try { await navigator.clipboard.writeText(prettyJson(EXAMPLE)); toast('已複製'); } catch { toast('複製失敗'); } };
  $('#gdUse').onclick = () => {
    const s = { ...EXAMPLE, id: `${EXAMPLE.id}-${Date.now().toString(36).slice(-4)}`, short: '均線交叉（範例）' };
    saveCustomStrategy(s);
    location.hash = `#/editor/${encodeURIComponent(s.id)}`;
  };
}
