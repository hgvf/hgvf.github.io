// presetstats.js — 內建策略在題庫上的回測結果（tools/backtest-presets.mjs 產生的
// config/preset-stats.json），策略頁與開始頁顯示用。
import { esc } from './ui.js';
import { qm } from './glossary.js';

let cache = null;
export async function loadPresetStats() {
  if (cache) return cache;
  try {
    const r = await fetch('config/preset-stats.json', { cache: 'no-cache' });
    cache = r.ok ? await r.json() : {};
  } catch { cache = {}; }
  return cache;
}

const pct = (x, d = 1) => (x == null ? '—' : `${x >= 0 && x !== 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const pctAbs = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 2) => (x == null ? '—' : x.toFixed(d));
const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');

/** 小標籤：Sharpe（策略清單用） */
export function sharpeChip(stats, id) {
  const s = stats?.presets?.[id];
  if (!s) return '';
  return `<span class="sh-chip ${cls(s.sharpe)}" title="題庫回測 Sharpe">${num(s.sharpe)}</span>`;
}

const REG = { up: '多頭', down: '空頭', range: '盤整' };

/** 策略介紹卡：進出場、艙位、出處、題庫回測。spec 可以是內建 preset 或自訂策略。 */
export function strategyInfoHTML(spec, stats) {
  const sm = spec.summary || {};
  const src = spec.source || {};
  const s = stats?.presets?.[spec.id];
  const b = stats?.buyHold;
  const row = (label, key, f, tipKey, better) => {
    const a = s?.[key], c = b?.[key];
    return `<tr><td>${label} ${tipKey ? qm(tipKey) : ''}</td><td class="mono ${better ? cls(a) : ''}">${f(a)}</td><td class="mono muted">${f(c)}</td></tr>`;
  };
  const backtest = s ? `
    <h3>在你的題庫回測 ${qm('shadow')} <span class="sub">${stats.puzzles.toLocaleString()} 題 · 影子帳戶完全照規則 · 無交易成本</span></h3>
    <div class="si-tables">
      <div class="tbl-wrap"><table class="tbl si-tbl">
        <thead><tr><th>指標</th><th>本策略</th><th>買進持有</th></tr></thead>
        <tbody>
          ${row('Sharpe', 'sharpe', x => num(x), 'sharpe', true)}
          ${row('平均年化報酬', 'annReturn', x => pct(x), 'annReturn', true)}
          ${row('最大回撤（中位數）', 'maxDDMedian', x => pctAbs(x), 'maxDD')}
          ${row('最大回撤（較差 10%）', 'maxDDP90', x => pctAbs(x), 'maxDDP90')}
          ${row('曝險（持有天數比例）', 'exposure', x => pctAbs(x, 0), 'exposure')}
          ${row('每題交易次數', 'tradesPerPuzzle', x => num(x, 1))}
          ${row('勝率', 'winRate', x => pctAbs(x, 0), 'winRate')}
          ${row('期望值（R / 筆）', 'expectancyR', x => (x == null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`), 'expectancy', true)}
          ${row('Profit factor', 'profitFactor', x => num(x), 'profitFactor')}
        </tbody></table></div>
      <div class="tbl-wrap"><table class="tbl si-tbl">
        <thead><tr><th>盤勢 ${qm('regime')}</th><th>Sharpe</th><th>年化</th><th>買進持有</th></tr></thead>
        <tbody>${['up', 'down', 'range'].map(k => {
          const r = s.byRegime?.[k], h = b?.byRegime?.[k];
          return r ? `<tr><td>${REG[k]} <span class="sub">${r.puzzles}</span></td><td class="mono ${cls(r.sharpe)}">${num(r.sharpe)}</td><td class="mono ${cls(r.annReturn)}">${pct(r.annReturn)}</td><td class="mono muted">${pct(h?.annReturn)}</td></tr>` : '';
        }).join('')}</tbody></table></div>
    </div>
    <p class="sub si-note">${esc(stats.method || '')} 依單筆風險決定部位的策略平時只用一小部分資金，報酬與回撤的絕對值都會很小；比較時以 Sharpe（不受部位大小影響）為主。</p>`
    : `<p class="sub" style="margin-top:10px">${spec.builtin === false || !stats?.presets ? '' : ''}這個策略還沒有題庫回測數字（自訂策略或新增的 preset）。內建 preset 的數字由 <code>tools/backtest-presets.mjs</code> 產生。</p>`;
  return `
    <div class="si-head">${spec.category ? `<span class="tag">${esc(spec.category)}</span>` : ''}<h2>${esc(spec.name || spec.id)}</h2></div>
    ${sm.entry || sm.exit || sm.sizing ? `<dl class="si-rules">
      ${sm.entry ? `<dt>進場</dt><dd>${esc(sm.entry)}</dd>` : ''}
      ${sm.exit ? `<dt>出場</dt><dd>${esc(sm.exit)}</dd>` : ''}
      ${sm.sizing ? `<dt>艙位控管 ${qm('R')}</dt><dd>${esc(sm.sizing)}</dd>` : ''}
    </dl>` : `<p class="sub">進場條件：<code>${esc(spec.entry?.signal || '')}</code></p>`}
    ${src.ref ? `<div class="si-source">
      <div><b>出處</b>　${esc(src.ref)}</div>
      ${src.claim ? `<div><b>原文 / 第三方報告</b>　${esc(src.claim)}</div>` : ''}
      ${src.note ? `<div><b>本站改寫</b>　${esc(src.note)}</div>` : ''}
    </div>` : ''}
    ${backtest}`;
}
