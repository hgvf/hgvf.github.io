// bars.js — puzzle bars → float series, and BarView (the anti look-ahead guard).
import { NaNArr } from './util.js';

export const BASE_FIELDS = ['open', 'high', 'low', 'close', 'volume', 'turnover'];
const SHORT = { o: 'open', h: 'high', l: 'low', c: 'close', v: 'volume', to: 'turnover' };

/** Convert a puzzle's integer columns into Float64Arrays keyed by long names.
    Extra keys in puzzle.bars (e.g. future data columns) are kept as-is so
    condition expressions can read them (SDD 8.1 "series registry"). */
export function barsFromPuzzle(puzzle) {
  const scale = puzzle.scale || 1;
  const src = puzzle.bars;
  const n = src.c.length;
  const out = { n };
  for (const [k, arr] of Object.entries(src)) {
    const name = SHORT[k] || k;
    const f = new Float64Array(n);
    const isPrice = k === 'o' || k === 'h' || k === 'l' || k === 'c';
    for (let i = 0; i < n; i++) f[i] = arr[i] == null ? NaN : (isPrice ? arr[i] / scale : arr[i]);
    out[name] = f;
  }
  if (!out.volume) out.volume = NaNArr(n);
  if (!out.turnover) {
    out.turnover = new Float64Array(n);
    for (let i = 0; i < n; i++) out.turnover[i] = out.close[i] * out.volume[i];
  }
  if (puzzle.benchmark?.c) {
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = puzzle.benchmark.c[i] == null ? NaN : puzzle.benchmark.c[i] / scale;
    out.benchmark = b;
  }
  return out;
}

/** Build bars directly from float arrays (tests, synthetic data). */
export function makeBars({ open, high, low, close, volume, turnover, benchmark, ...extra }) {
  const n = close.length;
  const f = a => (a ? Float64Array.from(a) : NaNArr(n));
  const out = { n, open: f(open), high: f(high), low: f(low), close: f(close), volume: f(volume) };
  out.turnover = turnover ? f(turnover) : out.close.map((c, i) => c * out.volume[i]);
  if (benchmark) out.benchmark = f(benchmark);
  for (const [k, v] of Object.entries(extra)) out[k] = f(v);
  return out;
}

/** Read-only window onto series at cursor t. Reading index > t throws — every
    indicator value and condition is evaluated through this at decision time. */
export class BarView {
  constructor(series, t) { this.series = series; this.t = t; }
  get(name, k = 0) {
    const s = this.series[name];
    if (!s) throw new Error(`未知的 series：${name}`);
    const i = this.t - k;
    if (i > this.t) throw new Error(`look-ahead：嘗試讀取 ${name}[${i}] > t=${this.t}`);
    return i < 0 ? NaN : s[i];
  }
  has(name) { return !!this.series[name]; }
}
