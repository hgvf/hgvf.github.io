#!/usr/bin/env node
// backtest-presets.mjs — 每個內建策略在整個題庫上跑「影子帳戶」（完全照規則），彙整成
// config/preset-stats.json，策略頁顯示用。
//
//   node blind-chart/tools/backtest-presets.mjs --bank <題庫資料夾> [--out blind-chart/config/preset-stats.json] [--limit N]
//
// 題庫資料夾 = blind-chart-puzzles 分支的內容（index.json + puzzles/）：
//   git archive origin/blind-chart-puzzles | tar -x -C /tmp/bank
//
// 指標定義（每題都是獨立的一段，起始權益相同、互不延續）：
//   Sharpe    — 所有題目可操作區間的「日報酬」合併後 mean / std × √252（空手的日子報酬 = 0）
//   年化報酬  — 每題報酬換算成 252 根的年化值，再取平均
//   MaxDD     — 每題可操作區間內權益最大回撤，取中位數與 90 百分位（較差的一端）
//   曝險      — 持有部位的 K 棒比例
// 沒有交易成本、滑價與稅（引擎的 costModel = none）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, prepareForPuzzle, simulate } from '../engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
if (!args.bank) { console.error('需要 --bank <題庫資料夾>'); process.exit(1); }
const out = args.out || path.join(HERE, '../config/preset-stats.json');
const index = JSON.parse(fs.readFileSync(path.join(args.bank, 'index.json'), 'utf8'));
const list = index.puzzles.slice(0, args.limit ? +args.limit : undefined);

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const r4 = x => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);

function newAcc() { return { daily: [], ann: [], ret: [], mdd: [], exp: [], R: [], gw: 0, gl: 0, trades: 0, byRegime: {}, byMarket: {} }; }

function record(acc, meta, eq, start, end, inPos, trades, base) {
  const daily = [];
  let prev = base, peak = base, mdd = 0;
  for (let i = start; i <= end; i++) {
    daily.push(eq[i] / prev - 1);
    prev = eq[i];
    peak = Math.max(peak, eq[i]);
    mdd = Math.max(mdd, (peak - eq[i]) / peak);
  }
  const ret = eq[end] / base - 1;
  const ann = Math.pow(1 + ret, 252 / (end - start + 1)) - 1;
  acc.daily.push(...daily); acc.ann.push(ann); acc.ret.push(ret); acc.mdd.push(mdd); acc.exp.push(inPos);
  for (const t of trades) { acc.trades++; acc.R.push(t.R); if (t.pnl > 0) acc.gw += t.pnl; else acc.gl -= t.pnl; }
  const g = (acc.byRegime[meta.regime] ||= { ann: [], daily: [], mdd: [] });
  g.ann.push(ann); g.daily.push(...daily); g.mdd.push(mdd);
  (acc.byMarket[meta.market] ||= []).push(ann);
}

function summarize(acc, n) {
  const wins = acc.R.filter(r => r > 0), losses = acc.R.filter(r => r <= 0);
  const sharpe = d => (std(d) > 0 ? mean(d) / std(d) * Math.sqrt(252) : 0);
  return {
    puzzles: n,
    sharpe: r4(sharpe(acc.daily)),
    annReturn: r4(mean(acc.ann)),
    medianAnnReturn: r4(q(acc.ann, 0.5)),
    profitablePct: r4(acc.ret.filter(x => x > 0).length / acc.ret.length),
    maxDDMedian: r4(q(acc.mdd, 0.5)),
    maxDDP90: r4(q(acc.mdd, 0.9)),
    maxDDWorst: r4(Math.max(...acc.mdd)),
    exposure: r4(mean(acc.exp)),
    trades: acc.trades,
    tradesPerPuzzle: r4(acc.trades / n),
    winRate: acc.R.length ? r4(wins.length / acc.R.length) : null,
    avgWinR: r4(mean(wins)), avgLossR: r4(mean(losses)), expectancyR: r4(mean(acc.R)),
    profitFactor: acc.gl > 0 ? r4(acc.gw / acc.gl) : null,
    // 依題目盤勢（多頭 / 空頭 / 盤整）分開看：趨勢策略的價值多半在空頭時少虧
    byRegime: Object.fromEntries(Object.entries(acc.byRegime).map(([k, v]) => [k, { puzzles: v.ann.length, sharpe: r4(sharpe(v.daily)), annReturn: r4(mean(v.ann)), maxDDMedian: r4(q(v.mdd, 0.5)) }])),
    byMarket: Object.fromEntries(Object.entries(acc.byMarket).map(([k, v]) => [k, r4(mean(v))])),
  };
}

const accs = Object.fromEntries(PRESETS.map(p => [p.id, newAcc()]));
const bh = newAcc();
const t0 = Date.now();
list.forEach((meta, k) => {
  const pz = JSON.parse(fs.readFileSync(path.join(args.bank, 'puzzles', `${meta.id}.json`), 'utf8'));
  let ctxAny = null;
  for (const preset of PRESETS) {
    const ctx = prepareForPuzzle(pz, preset);
    ctxAny = ctx;
    const run = simulate(ctx, { mode: 'shadow' });
    let inPos = 0;
    for (let i = run.start; i <= run.end; i++) if (run.advice[i]?.pos) inPos++;
    record(accs[preset.id], meta, run.equity, run.start, run.end, inPos / (run.end - run.start + 1), run.trades, ctx.initialEquity);
  }
  // Buy & hold：可操作區間第一根收盤買進、持有到最後
  const C = ctxAny.series.close, s = ctxAny.playStart, e = ctxAny.playEnd - 1;
  const eq = new Float64Array(C.length); for (let i = s; i <= e; i++) eq[i] = C[i] / C[s] * 1e6;
  record(bh, meta, eq, s + 1, e, 1, [], 1e6);
  if ((k + 1) % 200 === 0) console.error(`${k + 1}/${list.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
});

const result = {
  generatedAt: new Date().toISOString(),
  bankSeed: index.seed,
  puzzles: list.length,
  method: '影子帳戶（完全照規則）在題庫每一題的可操作區間回測；每題獨立、起始權益相同；無交易成本。題庫的多頭 / 空頭 / 盤整各約 1/3，比真實市場更偏空，絕對報酬會比長期實際偏低。',
  buyHold: summarize(bh, list.length),
  presets: Object.fromEntries(PRESETS.map(p => [p.id, summarize(accs[p.id], list.length)])),
};
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`);
