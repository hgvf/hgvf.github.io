#!/usr/bin/env node
// gen-puzzles.mjs — segments.jsonl.gz → 題庫（SDD 5.3 步驟 3–5、5.4、5.5）
//
//   node blind-chart/tools/gen-puzzles.mjs --segments build/segments.jsonl.gz --out build/bank [--seed 2026Q4]
//
// Uses the SAME engine as the browser to tag regimes and scan preset signals,
// so the signal bars stored in a puzzle equal what the game draws.
// Output:
//   <out>/index.json              所有題目 id、market、regime、preset 訊號數、長度
//   <out>/puzzles/<id>.json       匿名化題目
//   <out>/answers/<ref>.json      { "a": "<XOR+base64>" }
//   <out>/manifest.json           統計
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PRESETS, prepareForPuzzle, scanSignals, computeIndicators, makeBars, rng, obfuscate, hashStr, median } from '../engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const cfg = JSON.parse(fs.readFileSync(args.config || path.join(HERE, '../config/puzzles.json'), 'utf8'));
const seed = args.seed || cfg.seed;
const out = args.out || 'build/bank';
const R = rng(`puzzles:${seed}`);
const SCALE = 10000;

function anonymize(seg) {
  const n = seg.c.length, base = seg.c[0];
  const q = a => a.map(x => Math.round(x / base * 100 * SCALE));
  const ps = cfg.contextBars, pe = ps + seg.playBars;
  const vm = median(seg.v.slice(ps, pe)) || 1;
  const p = {
    version: 1, market: seg.market, lotSize: seg.lotSize,
    contextBars: cfg.contextBars, playBars: seg.playBars, revealBars: n - pe, scale: SCALE,
    bars: { o: q(seg.o), h: q(seg.h), l: q(seg.l), c: q(seg.c), v: seg.v.map(x => Math.round((x || 0) / vm * 1000)) },
  };
  if (seg.bench?.c?.every(x => x != null)) {
    const b0 = seg.bench.c[0];
    p.benchmark = { c: seg.bench.c.map(x => Math.round(x / b0 * 100 * SCALE)) };
  }
  return p;
}

function regimeOf(seg) {
  const ps = cfg.contextBars, pe = ps + seg.playBars - 1;
  const ret = seg.c[pe] / seg.c[ps] - 1;
  const s = computeIndicators(makeBars({ open: seg.o, high: seg.h, low: seg.l, close: seg.c, volume: seg.v }), [{ id: 'adx', type: 'adx', params: { length: 14 } }]);
  const adx = median(s.adx.slice(ps, pe + 1));
  if (ret >= cfg.regime.upReturn) return { regime: 'up', ret, adx };
  if (ret <= cfg.regime.downReturn) return { regime: 'down', ret, adx };
  if (adx <= cfg.regime.rangeMaxAdx) return { regime: 'range', ret, adx };
  return { regime: ret >= 0 ? 'up' : 'down', ret, adx };
}

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(args.segments).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const cands = { };
  let read = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const seg = JSON.parse(line);
    read++;
    const puzzle = anonymize(seg);
    const reg = regimeOf(seg);
    const presets = {};
    for (const pr of PRESETS) {
      const ctx = prepareForPuzzle(puzzle, pr);
      presets[pr.id] = { signalBars: scanSignals(ctx) };
    }
    const ps = cfg.contextBars;
    const item = { seg, puzzle, reg, presets, start: seg.dates[ps], end: seg.dates[ps + seg.playBars - 1] };
    (cands[seg.market] ||= []).push(item);
  }

  fs.mkdirSync(path.join(out, 'puzzles'), { recursive: true });
  fs.mkdirSync(path.join(out, 'answers'), { recursive: true });
  const index = [];
  const manifest = { seed, generatedAt: new Date().toISOString(), engine: 'blind-chart/engine', read, markets: {} };
  for (const [mk, list] of Object.entries(cands)) {
    // deterministic shuffle
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const size = cfg.poolSize[mk] ?? 600;
    const quota = Object.fromEntries(Object.entries(cfg.regimeQuota).map(([k, v]) => [k, Math.round(size * v)]));
    const taken = { up: 0, down: 0, range: 0 };
    const perSym = {}, spans = {};
    const strategyTarget = Math.round(size * cfg.strategyShare);
    let nStrat = 0, nRand = 0;
    const picked = [];
    const overlaps = (sym, a, b) => (spans[sym] || []).some(([x, y]) => a <= y && x <= b);
    // two passes: strategy-pool candidates first, then random
    for (const pass of ['strategy', 'random']) {
      for (const it of list) {
        if (picked.length >= size) break;
        if (it.used) continue;
        const isStrat = Object.values(it.presets).some(p => p.signalBars.length >= cfg.minSignals);
        if (pass === 'strategy' && (!isStrat || nStrat >= strategyTarget)) continue;
        const r = it.reg.regime;
        if (taken[r] >= quota[r]) continue;
        const sym = it.seg.symbol;
        if ((perSym[sym] || 0) >= cfg.maxPerSymbol) continue;
        if (overlaps(sym, it.start, it.end)) continue;
        it.used = true; taken[r]++; perSym[sym] = (perSym[sym] || 0) + 1;
        (spans[sym] ||= []).push([it.start, it.end]);
        it.pool = pass;
        if (pass === 'strategy') nStrat++; else nRand++;
        picked.push(it);
      }
    }
    for (const it of picked) {
      const h = (hashStr(`${seed}:${it.seg.market}:${it.seg.symbol}:${it.start}`) >>> 0).toString(16).padStart(8, '0');
      const id = `p-${h.slice(0, 6)}`, ref = `a-${(hashStr(id + seed) >>> 0).toString(16).padStart(8, '0').slice(0, 6)}`;
      const ps = cfg.contextBars, pe = ps + it.seg.playBars - 1;
      const pz = { id, ...it.puzzle, tags: { regime: it.reg.regime, presets: it.presets }, answerRef: ref };
      const ans = {
        symbol: it.seg.symbol, name: it.seg.name, market: it.seg.market, sector: it.seg.sector,
        startDate: it.start, endDate: it.end, revealEnd: it.seg.dates[it.seg.dates.length - 1],
        contextStart: it.seg.dates[0],
        priceFactor: it.seg.c[0] / 100,      // real price = scaled price × priceFactor
        buyHoldReturn: it.seg.c[pe] / it.seg.c[ps] - 1,
        benchmark: it.seg.bench?.symbol || null,
      };
      fs.writeFileSync(path.join(out, 'puzzles', `${id}.json`), JSON.stringify(pz));
      fs.writeFileSync(path.join(out, 'answers', `${ref}.json`), JSON.stringify({ a: obfuscate(ans) }));
      index.push({
        id, market: mk, regime: it.reg.regime, playBars: it.seg.playBars, pool: it.pool,
        signals: Object.fromEntries(Object.entries(it.presets).map(([k, v]) => [k, v.signalBars.length])),
      });
    }
    manifest.markets[mk] = { candidates: list.length, picked: picked.length, strategy: nStrat, random: nRand, regimes: taken };
  }
  // shuffle index so file order leaks nothing
  for (let i = index.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [index[i], index[j]] = [index[j], index[i]]; }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ version: 1, seed, presets: PRESETS.map(p => p.id), puzzles: index }));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(JSON.stringify(manifest, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
