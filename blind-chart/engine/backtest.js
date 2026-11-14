// backtest.js — 影子帳戶在多個題目上的回測彙整。tools/backtest-presets.mjs（整個題庫）
// 與策略頁的「快速回測」（一小組樣本題）共用，確保兩邊的指標定義一致。
//
// 指標定義（每題獨立、起始權益相同、無交易成本）：
//   sharpe       所有題目可操作區間的日報酬合併後 mean / std × √252（空手的日子報酬 = 0）
//   annReturn    每題報酬換算成 252 根的年化值，取平均（medianAnnReturn 取中位數）
//   maxDD*       每題可操作區間的最大回撤，取中位數 / 90 百分位 / 最差
//   exposure     持有部位的 K 棒比例
//   avgHoldBars  每筆交易平均持有幾根
import { prepareForPuzzle } from './index.js';
import { simulate } from './sim.js';

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const r4 = x => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const sharpeOf = d => (d.length && std(d) > 0 ? mean(d) / std(d) * Math.sqrt(252) : 0);

function curve(eq, start, end, base) {
  const daily = [];
  let prev = base, peak = base, mdd = 0;
  for (let i = start; i <= end; i++) {
    daily.push(eq[i] / prev - 1);
    prev = eq[i];
    peak = Math.max(peak, eq[i]);
    mdd = Math.max(mdd, (peak - eq[i]) / peak);
  }
  const ret = eq[end] / base - 1;
  return { daily, ret, mdd, ann: Math.pow(1 + ret, 252 / (end - start + 1)) - 1 };
}

/** One puzzle, one spec → per-puzzle record (shadow account). */
export function runPuzzle(puzzle, spec) {
  const ctx = prepareForPuzzle(puzzle, spec);
  const run = simulate(ctx, { mode: 'shadow' });
  let inPos = 0;
  for (let i = run.start; i <= run.end; i++) if (run.advice[i]?.pos) inPos++;
  return {
    ...curve(run.equity, run.start, run.end, ctx.initialEquity),
    exposure: inPos / (run.end - run.start + 1),
    trades: run.trades.map(t => ({ R: t.R, pnl: t.pnl, hold: (t.exitBar ?? run.end) - t.entryBar + 1 })),
  };
}

/** Buy & hold over the same playable window (buy at the first playable close). */
export function runBuyHold(puzzle) {
  const ctx = prepareForPuzzle(puzzle, { id: 'bh', entry: { signal: 'close > 0' }, stops: [{ type: 'pct_initial' }] });
  const C = ctx.series.close, s = ctx.playStart, e = ctx.playEnd - 1;
  const eq = new Float64Array(C.length);
  for (let i = s; i <= e; i++) eq[i] = C[i] / C[s];
  return { ...curve(eq, s + 1, e, 1), exposure: 1, trades: [] };
}

export function newAccumulator() {
  return { n: 0, daily: [], ann: [], ret: [], mdd: [], exp: [], R: [], hold: [], gw: 0, gl: 0, byRegime: {}, byMarket: {} };
}

export function addRecord(acc, rec, meta = {}) {
  acc.n++;
  for (const d of rec.daily) acc.daily.push(d);
  acc.ann.push(rec.ann); acc.ret.push(rec.ret); acc.mdd.push(rec.mdd); acc.exp.push(rec.exposure);
  for (const t of rec.trades) {
    acc.R.push(t.R); acc.hold.push(t.hold);
    if (t.pnl > 0) acc.gw += t.pnl; else acc.gl -= t.pnl;
  }
  if (meta.regime) {
    const g = (acc.byRegime[meta.regime] ||= { ann: [], daily: [], mdd: [] });
    g.ann.push(rec.ann); for (const d of rec.daily) g.daily.push(d); g.mdd.push(rec.mdd);
  }
  if (meta.market) (acc.byMarket[meta.market] ||= []).push(rec.ann);
}

export function summarize(acc) {
  const R = acc.R.filter(Number.isFinite);
  const wins = R.filter(r => r > 0), losses = R.filter(r => r <= 0);
  return {
    puzzles: acc.n,
    sharpe: r4(sharpeOf(acc.daily)),
    annReturn: r4(mean(acc.ann)),
    medianAnnReturn: r4(q(acc.ann, 0.5)),
    profitablePct: r4(acc.ret.filter(x => x > 0).length / (acc.ret.length || 1)),
    maxDDMedian: r4(q(acc.mdd, 0.5)),
    maxDDP90: r4(q(acc.mdd, 0.9)),
    maxDDWorst: r4(acc.mdd.length ? Math.max(...acc.mdd) : NaN),
    exposure: r4(mean(acc.exp)),
    trades: R.length,
    tradesPerPuzzle: r4(R.length / (acc.n || 1)),
    avgHoldBars: R.length ? r4(mean(acc.hold)) : null,
    winRate: R.length ? r4(wins.length / R.length) : null,
    avgWinR: r4(mean(wins)), avgLossR: r4(mean(losses)), expectancyR: r4(mean(R)),
    profitFactor: acc.gl > 0 ? r4(acc.gw / acc.gl) : null,
    byRegime: Object.fromEntries(Object.entries(acc.byRegime).map(([k, v]) => [k, { puzzles: v.ann.length, sharpe: r4(sharpeOf(v.daily)), annReturn: r4(mean(v.ann)), maxDDMedian: r4(q(v.mdd, 0.5)) }])),
    byMarket: Object.fromEntries(Object.entries(acc.byMarket).map(([k, v]) => [k, r4(mean(v))])),
  };
}

/** Convenience: many puzzles × one spec. items = [{ puzzle, meta }] */
export function backtest(items, spec) {
  const acc = newAccumulator();
  for (const { puzzle, meta } of items) addRecord(acc, spec === 'buyhold' ? runBuyHold(puzzle) : runPuzzle(puzzle, spec), meta || {});
  return summarize(acc);
}
