// report.js — three accounts + counterfactual cost per violation (SDD 7).
import { simulate } from './sim.js';
import { VIOLATIONS } from './violations.js';
import { isNum } from './util.js';

export function accountStats(run, ctx) {
  const eq = run.equity, s = run.start, e = run.end;
  let peak = -Infinity, mdd = 0;
  for (let i = s; i <= e; i++) { peak = Math.max(peak, eq[i]); if (peak > 0) mdd = Math.max(mdd, (peak - eq[i]) / peak); }
  const tr = run.trades;
  const Rs = tr.map(t => t.R).filter(isNum);
  const wins = Rs.filter(r => r > 0), losses = Rs.filter(r => r <= 0);
  const gw = tr.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const gl = -tr.filter(t => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    finalEquity: run.finalEquity, returnPct: (run.finalEquity / ctx.initialEquity - 1) * 100,
    totalR: Rs.reduce((a, b) => a + b, 0), maxDDPct: mdd * 100, trades: tr.length,
    winRate: tr.length ? wins.length / tr.length * 100 : 0, avgWinR: mean(wins), avgLossR: mean(losses),
    expectancyR: mean(Rs), profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
  };
}

export function buyHold(ctx) {
  const { open: O, close: C } = ctx.series;
  const s = ctx.playStart, e = ctx.playEnd - 1;
  const eq = new Float64Array(C.length).fill(NaN);
  for (let i = s; i <= e; i++) eq[i] = ctx.initialEquity * C[i] / C[s];
  return { returnPct: (C[e] / C[s] - 1) * 100, equity: eq, entry: C[s], exit: C[e], note: 'survivorship bias：題庫只含現存標的', ref: O[s] };
}

/** Build modifications object for one violation's counterfactual. */
function modsFor(v, actual, actions) {
  const fractions = {};
  actual.annotated.forEach((a, idx) => { if (a.fraction != null) fractions[idx] = a.fraction; });
  const tradeOf = idx => actual.annotated[idx]?.tradeId;
  const f = v.fix || {};
  const m = { fractions };
  if (f.type === 'drop') m.drop = new Set([f.actionIdx]);
  else if (f.type === 'resize') m.resize = { [f.actionIdx]: f.qty };
  else if (f.type === 'dropTrade') {
    const tid = tradeOf(f.actionIdx);
    m.dropTradeActions = new Set(actions.map((_, i) => i).filter(i => i === f.actionIdx || (tid != null && tradeOf(i) === tid)));
  } else if (f.type === 'autopilot') {
    m.autopilot = { tradeId: f.tradeId, bar: f.bar, phase: f.phase };
    m.drop = new Set(actions.map((a, i) => i).filter(i => tradeOf(i) === f.tradeId && actions[i].barIndex >= f.bar));
  } else if (f.type === 'inject') m.inject = { bar: f.bar, qty: f.qty };
  return m;
}

/** Full post-game report. */
export function buildReport(ctx, actions, { withCounterfactual = true } = {}) {
  const actual = simulate(ctx, { mode: 'actual', actions });
  const shadow = simulate(ctx, { mode: 'shadow' });
  const bh = buyHold(ctx);
  const A = accountStats(actual, ctx), Sh = accountStats(shadow, ctx);

  const violations = actual.violations.map(v => ({ ...v }));
  if (withCounterfactual) {
    for (const v of violations) {
      const cf = simulate(ctx, { mode: 'actual', actions, mods: modsFor(v, actual, actions) });
      v.cfEquity = cf.finalEquity;
      // cost > 0: the violation cost you money (counterfactual − actual).
      // (SDD 7.1 writes Actual − CF; we flip the sign so "代價" reads positive when it hurt.)
      v.cost = cf.finalEquity - actual.finalEquity;
      v.costR = shadowR(ctx, shadow) ? v.cost / shadowR(ctx, shadow) : 0;
    }
  }
  const sumCost = violations.reduce((a, v) => a + (v.cost || 0), 0);
  const gap = shadow.finalEquity - actual.finalEquity;            // >0 = rules beat you
  const penalty = violations.reduce((a, v) => a + (v.weight || 0), 0);
  const required = actual.signals.length + actual.obligations.filter(o => o.type !== 'entry').length + actions.length;
  const nonCompliant = violations.length;
  const counts = {};
  for (const v of violations) counts[v.code] = (counts[v.code] || 0) + 1;
  return {
    actual, shadow, buyHold: bh,
    stats: { actual: A, shadow: Sh, buyHold: { returnPct: bh.returnPct } },
    violations: violations.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)),
    lucky: violations.filter(v => (v.cost ?? 0) < 0),
    compliantLosers: actual.trades.filter(t => t.R < 0 && !violations.some(v => v.tradeId === t.id)),
    gap, sumCost, interaction: gap - sumCost,
    score: Math.max(0, 100 - penalty), penalty,
    complianceRate: required ? Math.max(0, (required - nonCompliant) / required) * 100 : 100,
    counts,
    rHist: { actual: histogram(actual.trades.map(t => t.R)), shadow: histogram(shadow.trades.map(t => t.R)) },
  };
}
const shadowR = (ctx) => ctx.spec.sizing.method === 'max_loss_amount' ? ctx.spec.sizing.amount : ctx.initialEquity * 0.01;

export function histogram(Rs, edges = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 5]) {
  const bins = edges.slice(0, -1).map((lo, k) => ({ lo, hi: edges[k + 1], n: 0 }));
  bins.unshift({ lo: -Infinity, hi: edges[0], n: 0 });
  bins.push({ lo: edges[edges.length - 1], hi: Infinity, n: 0 });
  for (const r of Rs) { if (!isNum(r)) continue; const b = bins.find(b => r >= b.lo && r < b.hi); if (b) b.n++; }
  return bins;
}

export function violationName(code) { return VIOLATIONS[code]?.name || code; }

/** Markdown export of a report (SDD 7.5). */
export function reportMarkdown(rep, meta = {}) {
  const f = (x, d = 2) => (isNum(x) ? x.toFixed(d) : '—');
  const row = (k, a, s, b) => `| ${k} | ${a} | ${s} | ${b} |`;
  const A = rep.stats.actual, S = rep.stats.shadow;
  const lines = [
    `# 盲測 K 線檢討報告${meta.symbol ? ` — ${meta.symbol} ${meta.name || ''}` : ''}`, '',
    meta.startDate ? `期間：${meta.startDate} → ${meta.endDate}　策略：${meta.strategy || ''}` : '', '',
    `**紀律分數 ${rep.score}**　規則遵守率 ${f(rep.complianceRate, 0)}%　Shadow − Actual = ${f(rep.gap, 0)} 點`, '',
    '| 指標 | Actual | Shadow | Buy & hold |', '|---|---|---|---|',
    row('報酬 %', f(A.returnPct), f(S.returnPct), f(rep.stats.buyHold.returnPct)),
    row('總 R', f(A.totalR), f(S.totalR), '—'),
    row('最大回撤 %', f(A.maxDDPct), f(S.maxDDPct), '—'),
    row('交易次數', A.trades, S.trades, '—'),
    row('勝率 %', f(A.winRate, 0), f(S.winRate, 0), '—'),
    row('期望值 R/筆', f(A.expectancyR), f(S.expectancyR), '—'), '',
    '## 違規清單（依代價排序）', '', '| 代碼 | 名稱 | 第幾根 | 規則 | 你做了 | 代價 |', '|---|---|---|---|---|---|',
    ...rep.violations.map(v => `| ${v.code} | ${v.name} | ${v.bar} | ${v.required || ''} | ${v.did || ''} | ${f(v.cost, 0)} |`),
    '', `交互殘差：${f(rep.interaction, 0)}`,
  ];
  return lines.join('\n');
}
