// synthetic.js — regime-switching random-walk puzzles, used when the real
// puzzle bank is not published yet (demo mode) and in tests. Same schema as
// tools/gen-puzzles output.
import { rng, obfuscate } from './util.js';

export function syntheticOHLC(n, seed, start = 100) {
  const r = rng(seed);
  const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const o = [], h = [], l = [], c = [], v = [];
  let px = start, drift = 0, vol = 0.018, left = 0;
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) { drift = (r() - 0.45) * 0.004; vol = 0.01 + r() * 0.025; left = 30 + Math.floor(r() * 90); }
    const gap = gauss() * vol * 0.3;
    const op = px * (1 + gap);
    const cl = op * (1 + drift + gauss() * vol);
    const hi = Math.max(op, cl) * (1 + Math.abs(gauss()) * vol * 0.5);
    const lo = Math.min(op, cl) * (1 - Math.abs(gauss()) * vol * 0.5);
    o.push(op); h.push(hi); l.push(lo); c.push(cl);
    v.push(Math.round(1e6 * (0.5 + r()) * (1 + Math.abs(cl / op - 1) * 20)));
    px = cl;
  }
  return { open: o, high: h, low: l, close: c, volume: v };
}

export function syntheticPuzzle(seed, { contextBars = 250, playBars = 250, revealBars = 60, market = 'US', lotSize = 1 } = {}) {
  const n = contextBars + playBars + revealBars;
  const d = syntheticOHLC(n, seed);
  const base = d.close[0], scale = 10000;
  const q = a => a.map(x => Math.round(x / base * 100 * scale));
  const vm = [...d.volume].sort((a, b) => a - b)[d.volume.length >> 1];
  const id = `demo-${seed}`;
  const e = contextBars + playBars - 1;
  return {
    id, version: 1, market, lotSize, contextBars, playBars, revealBars, scale, synthetic: true,
    bars: { o: q(d.open), h: q(d.high), l: q(d.low), c: q(d.close), v: d.volume.map(x => Math.round(x / vm * 1000)) },
    tags: { regime: d.close[e] > d.close[contextBars] * 1.1 ? 'up' : d.close[e] < d.close[contextBars] * 0.9 ? 'down' : 'range', presets: {} },
    answer: obfuscate({ symbol: `SYNTH-${seed}`, name: '合成資料（示範題）', market, startDate: '—', endDate: '—', priceFactor: base / 100, buyHoldReturn: d.close[e] / d.close[contextBars] - 1 }),
  };
}
