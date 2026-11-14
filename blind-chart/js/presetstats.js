// presetstats.js — 內建策略在題庫上的回測（tools/backtest-presets.mjs 產生的
// config/preset-stats.json，約 15 KB），只在策略頁 / 開始頁載入一次。
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

export const fmtPct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
export const fmtAbs = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const fmtNum = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
export const fmtR = x => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`);
export const sgn = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
export const REGIME = { up: '多頭', down: '空頭', range: '盤整' };

/** 一行重點數字 */
export function statLine(id, stats) {
  const s = stats?.presets?.[id];
  if (!s) return '';
  return `<div class="stat-line">
    <span>題庫 Sharpe ${qm('sharpe')} <b class="${sgn(s.sharpe)}">${fmtNum(s.sharpe)}</b></span>
    <span>勝率 <b>${fmtAbs(s.winRate, 0)}</b></span>
    <span>每題 <b>${fmtNum(s.tradesPerPuzzle, 1)}</b> 筆</span>
    <span>平均持有 <b>${s.avgHoldBars == null ? '—' : Math.round(s.avgHoldBars)}</b> 根</span>
  </div>`;
}

/** 題庫回測表：本策略 vs 買進持有，加分盤勢。 */
export function backtestTablesHTML(id, stats) {
  const s = stats?.presets?.[id];
  const b = stats?.buyHold;
  if (!s) return '<p class="sub">自訂策略沒有題庫回測，請用右邊的快速回測。</p>';
  const row = (label, key, f, tipKey, colored) => {
    const a = s?.[key], c = b?.[key];
    return `<tr><td>${label} ${tipKey ? qm(tipKey) : ''}</td><td class="mono ${colored ? sgn(a) : ''}">${f(a)}</td><td class="mono muted">${f(c)}</td></tr>`;
  };
  return `
    <h3>題庫回測 ${qm('shadow')} <span class="sub">${(stats.puzzles || 0).toLocaleString()} 題 · 照規則 · 不計成本</span></h3>
    <div class="si-tables">
      <div class="tbl-wrap"><table class="tbl si-tbl">
        <thead><tr><th></th><th>本策略</th><th>買進持有</th></tr></thead>
        <tbody>
          ${row('Sharpe', 'sharpe', x => fmtNum(x), 'sharpe', true)}
          ${row('平均年化報酬', 'annReturn', x => fmtPct(x), 'annReturn', true)}
          ${row('最大回撤（中位數）', 'maxDDMedian', x => fmtAbs(x), 'maxDD')}
          ${row('最大回撤（較差 10%）', 'maxDDP90', x => fmtAbs(x), 'maxDDP90')}
          ${row('曝險', 'exposure', x => fmtAbs(x, 0), 'exposure')}
          ${row('每題交易次數', 'tradesPerPuzzle', x => fmtNum(x, 1))}
          ${row('平均持有', 'avgHoldBars', x => (x == null ? '—' : `${x.toFixed(0)} 根`), 'avgHold')}
          ${row('勝率', 'winRate', x => fmtAbs(x, 0), 'winRate')}
          ${row('期望值（R / 筆）', 'expectancyR', fmtR, 'expectancy', true)}
          ${row('Profit factor', 'profitFactor', x => fmtNum(x), 'profitFactor')}
        </tbody></table></div>
      <div class="tbl-wrap"><table class="tbl si-tbl">
        <thead><tr><th>盤勢 ${qm('regime')}</th><th>Sharpe</th><th>年化</th><th>買進持有</th></tr></thead>
        <tbody>${['up', 'down', 'range'].map(k => {
          const r = s.byRegime?.[k], h = b?.byRegime?.[k];
          return r ? `<tr><td>${REGIME[k]} <span class="sub">${r.puzzles} 題</span></td><td class="mono ${sgn(r.sharpe)}">${fmtNum(r.sharpe)}</td><td class="mono ${sgn(r.annReturn)}">${fmtPct(r.annReturn)}</td><td class="mono muted">${fmtPct(h?.annReturn)}</td></tr>` : '';
        }).join('')}</tbody></table></div>
    </div>`;
}
