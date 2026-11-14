// indicators.js — IndicatorPlugin registry (SDD 4.2).
// Every compute() is causal: value[i] depends only on bars[0..i]. The
// look-ahead test in test/lookahead.test.mjs checks this for every plugin.
//
// interface IndicatorPlugin<P> {
//   type: string; label: string;
//   paramsSchema: JSONSchema;            // UI form + validation
//   outputs: string[];                   // first output is the default series
//   warmup(p): number;                   // bars needed before values settle
//   compute(bars, p): Record<string, Float64Array>;
//   pane?: 'price' | 'sub';              // chart hint
// }
import { NaNArr } from './util.js';

export const INDICATORS = {};
export function registerIndicator(plugin) { INDICATORS[plugin.type] = plugin; }

const int = (d, min = 1, max = 500) => ({ type: 'integer', default: d, minimum: min, maximum: max });
const num = (d, min = 0, max = 100) => ({ type: 'number', default: d, minimum: min, maximum: max });
const srcSchema = { type: 'string', default: 'close', enum: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume'] };

export function sourceSeries(bars, src = 'close') {
  const { open: o, high: h, low: l, close: c, n } = bars;
  if (src === 'hl2') return Float64Array.from({ length: n }, (_, i) => (h[i] + l[i]) / 2);
  if (src === 'hlc3') return Float64Array.from({ length: n }, (_, i) => (h[i] + l[i] + c[i]) / 3);
  if (src === 'ohlc4') return Float64Array.from({ length: n }, (_, i) => (o[i] + h[i] + l[i] + c[i]) / 4);
  const s = bars[src];
  if (!s) throw new Error(`未知的 source：${src}`);
  return s;
}

// ─── Moving-average primitives (NaN-aware: start at the first full valid window) ───
export function sma(x, len) {
  const n = x.length, out = NaNArr(n);
  let sum = 0, bad = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (Number.isNaN(v)) bad++; else sum += v;
    if (i >= len) { const u = x[i - len]; if (Number.isNaN(u)) bad--; else sum -= u; }
    if (i >= len - 1 && bad === 0) out[i] = sum / len;
  }
  return out;
}
export function wma(x, len) {
  const n = x.length, out = NaNArr(n), denom = len * (len + 1) / 2;
  for (let i = len - 1; i < n; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < len; k++) { const v = x[i - k]; if (Number.isNaN(v)) { ok = false; break; } s += v * (len - k); }
    if (ok) out[i] = s / denom;
  }
  return out;
}
/** Exponential smoothing with alpha, seeded by the SMA of the first `len` valid values. */
function expSmooth(x, len, alpha) {
  const n = x.length, out = NaNArr(n);
  let start = -1, run = 0;
  for (let i = 0; i < n; i++) {           // find first run of `len` consecutive valid values
    run = Number.isNaN(x[i]) ? 0 : run + 1;
    if (run === len) { start = i; break; }
  }
  if (start < 0) return out;
  let s = 0;
  for (let k = start - len + 1; k <= start; k++) s += x[k];
  let prev = s / len;
  out[start] = prev;
  for (let i = start + 1; i < n; i++) {
    const v = x[i];
    if (Number.isNaN(v)) { out[i] = prev; continue; }   // hold through gaps
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}
export const ema = (x, len) => expSmooth(x, len, 2 / (len + 1));
export const rma = (x, len) => expSmooth(x, len, 1 / len);
export function ma(x, len, type = 'sma') {
  if (type === 'ema') return ema(x, len);
  if (type === 'wma') return wma(x, len);
  if (type === 'rma') return rma(x, len);
  return sma(x, len);
}
export function highest(x, len) {
  const n = x.length, out = NaNArr(n);
  for (let i = len - 1; i < n; i++) { let m = -Infinity; for (let k = 0; k < len; k++) m = Math.max(m, x[i - k]); out[i] = m; }
  return out;
}
export function lowest(x, len) {
  const n = x.length, out = NaNArr(n);
  for (let i = len - 1; i < n; i++) { let m = Infinity; for (let k = 0; k < len; k++) m = Math.min(m, x[i - k]); out[i] = m; }
  return out;
}
export function trueRange(bars, mode = 'standard') {
  const { open: o, high: h, low: l, close: c, n } = bars, tr = NaNArr(n);
  for (let i = 0; i < n; i++) {
    const hl = h[i] - l[i];
    if (i === 0 || mode === 'hl') { tr[i] = hl; continue; }
    const pc = c[i - 1];
    if (mode === 'gap_aware') tr[i] = Math.max(hl, Math.abs(o[i] - pc) + hl * 0.5, Math.abs(h[i] - pc), Math.abs(l[i] - pc));
    else tr[i] = Math.max(hl, Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  return tr;
}
export function atrSeries(bars, length = 14, smoothing = 'rma', trMode = 'standard') {
  return ma(trueRange(bars, trMode), length, smoothing);
}

// ─── Built-in plugins ───
registerIndicator({
  type: 'sma', label: 'SMA 簡單均線', pane: 'price', outputs: ['value'],
  paramsSchema: { type: 'object', properties: { length: int(20), source: srcSchema }, required: ['length'] },
  warmup: p => p.length,
  compute: (b, p) => ({ value: sma(sourceSeries(b, p.source), p.length) }),
});
registerIndicator({
  type: 'ema', label: 'EMA 指數均線', pane: 'price', outputs: ['value'],
  paramsSchema: { type: 'object', properties: { length: int(20), source: srcSchema }, required: ['length'] },
  warmup: p => p.length * 3,
  compute: (b, p) => ({ value: ema(sourceSeries(b, p.source), p.length) }),
});
registerIndicator({
  type: 'wma', label: 'WMA 加權均線', pane: 'price', outputs: ['value'],
  paramsSchema: { type: 'object', properties: { length: int(20), source: srcSchema }, required: ['length'] },
  warmup: p => p.length,
  compute: (b, p) => ({ value: wma(sourceSeries(b, p.source), p.length) }),
});
registerIndicator({
  type: 'rma', label: 'RMA（Wilder）均線', pane: 'price', outputs: ['value'],
  paramsSchema: { type: 'object', properties: { length: int(14), source: srcSchema }, required: ['length'] },
  warmup: p => p.length * 3,
  compute: (b, p) => ({ value: rma(sourceSeries(b, p.source), p.length) }),
});
registerIndicator({
  type: 'atr', label: 'ATR 平均真實區間', pane: 'sub', outputs: ['atr'],
  paramsSchema: {
    type: 'object', required: ['length'],
    properties: {
      length: int(14),
      smoothing: { type: 'string', default: 'rma', enum: ['rma', 'sma', 'ema', 'wma'] },
      trMode: { type: 'string', default: 'standard', enum: ['standard', 'hl', 'gap_aware'] },
      asPercent: { type: 'boolean', default: false },
    },
  },
  warmup: p => p.length * 3,
  compute: (b, p) => {
    const a = atrSeries(b, p.length, p.smoothing || 'rma', p.trMode || 'standard');
    if (p.asPercent) for (let i = 0; i < a.length; i++) a[i] = a[i] / b.close[i] * 100;
    return { atr: a };
  },
});
registerIndicator({
  type: 'donchian', label: 'Donchian 通道', pane: 'price', outputs: ['upper', 'lower', 'mid'],
  paramsSchema: { type: 'object', properties: { length: int(20) }, required: ['length'] },
  warmup: p => p.length,
  compute: (b, p) => {
    const upper = highest(b.high, p.length), lower = lowest(b.low, p.length);
    return { upper, lower, mid: upper.map((u, i) => (u + lower[i]) / 2) };
  },
});
registerIndicator({
  type: 'bollinger', label: '布林通道', pane: 'price', outputs: ['upper', 'mid', 'lower', 'width'],
  paramsSchema: {
    type: 'object', required: ['length'],
    properties: { length: int(20), mult: num(2, 0.1, 10), maType: { type: 'string', default: 'sma', enum: ['sma', 'ema'] }, source: srcSchema },
  },
  warmup: p => p.length,
  compute: (b, p) => {
    const x = sourceSeries(b, p.source), len = p.length, mult = p.mult ?? 2;
    const mid = ma(x, len, p.maType || 'sma'), n = x.length;
    const upper = NaNArr(n), lower = NaNArr(n), width = NaNArr(n);
    for (let i = len - 1; i < n; i++) {
      let m = 0; for (let k = 0; k < len; k++) m += x[i - k]; m /= len;
      let v = 0; for (let k = 0; k < len; k++) v += (x[i - k] - m) ** 2;
      const sd = Math.sqrt(v / len);
      if (Number.isNaN(mid[i])) continue;
      upper[i] = mid[i] + mult * sd; lower[i] = mid[i] - mult * sd; width[i] = (upper[i] - lower[i]) / mid[i];
    }
    return { upper, mid, lower, width };
  },
});
registerIndicator({
  type: 'keltner', label: 'Keltner 通道', pane: 'price', outputs: ['upper', 'mid', 'lower'],
  paramsSchema: { type: 'object', properties: { length: int(20), atrLength: int(10), mult: num(2, 0.1, 10) }, required: ['length'] },
  warmup: p => Math.max(p.length, p.atrLength ?? 10) * 3,
  compute: (b, p) => {
    const mid = ema(b.close, p.length), a = atrSeries(b, p.atrLength ?? 10), m = p.mult ?? 2;
    return { upper: mid.map((v, i) => v + m * a[i]), mid, lower: mid.map((v, i) => v - m * a[i]) };
  },
});
registerIndicator({
  type: 'rsi', label: 'RSI', pane: 'sub', outputs: ['rsi'],
  paramsSchema: { type: 'object', properties: { length: int(14), source: srcSchema }, required: ['length'] },
  warmup: p => p.length * 4,
  compute: (b, p) => {
    const x = sourceSeries(b, p.source), n = x.length, up = NaNArr(n), dn = NaNArr(n);
    for (let i = 1; i < n; i++) { const d = x[i] - x[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); }
    const au = rma(up, p.length), ad = rma(dn, p.length);
    return { rsi: au.map((u, i) => (ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i]))) };
  },
});
registerIndicator({
  type: 'macd', label: 'MACD', pane: 'sub', outputs: ['macd', 'signal', 'hist'],
  paramsSchema: { type: 'object', properties: { fast: int(12), slow: int(26), signal: int(9), source: srcSchema } },
  warmup: p => ((p.slow ?? 26) + (p.signal ?? 9)) * 3,
  compute: (b, p) => {
    const x = sourceSeries(b, p.source);
    const f = ema(x, p.fast ?? 12), s = ema(x, p.slow ?? 26);
    const macd = f.map((v, i) => v - s[i]);
    const signal = ema(macd, p.signal ?? 9);
    return { macd, signal, hist: macd.map((v, i) => v - signal[i]) };
  },
});
registerIndicator({
  type: 'kd', label: 'KD 隨機指標', pane: 'sub', outputs: ['k', 'd'],
  paramsSchema: { type: 'object', properties: { length: int(9), kSmooth: int(3, 1, 20), dSmooth: int(3, 1, 20) }, required: ['length'] },
  warmup: p => p.length + (p.kSmooth + p.dSmooth) * 4,
  // 台灣常用算法：RSV = (收 − N 日最低) ÷ (N 日最高 − N 日最低) × 100；
  // K = 前 K × (1 − 1/kSmooth) + RSV / kSmooth；D 同理平滑 K。起始值 50。
  compute: (b, p) => {
    const { high: h, low: l, close: c } = b, n = c.length, L = p.length;
    const k = NaNArr(n), d = NaNArr(n);
    let pk = 50, pd = 50;
    for (let i = L - 1; i < n; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - L + 1; j <= i; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j]; }
      const rsv = hi > lo ? (c[i] - lo) / (hi - lo) * 100 : 50;
      if (!Number.isFinite(rsv)) continue;
      pk = pk + (rsv - pk) / p.kSmooth;
      pd = pd + (pk - pd) / p.dSmooth;
      k[i] = pk; d[i] = pd;
    }
    return { k, d };
  },
});
registerIndicator({
  type: 'adx', label: 'ADX / DMI', pane: 'sub', outputs: ['adx', 'pdi', 'mdi'],
  paramsSchema: { type: 'object', properties: { length: int(14) }, required: ['length'] },
  warmup: p => p.length * 5,
  compute: (b, p) => {
    const { high: h, low: l, n } = b, len = p.length;
    const pdm = NaNArr(n), mdm = NaNArr(n), tr = trueRange(b);
    tr[0] = NaN;
    for (let i = 1; i < n; i++) {
      const upMove = h[i] - h[i - 1], dnMove = l[i - 1] - l[i];
      pdm[i] = upMove > dnMove && upMove > 0 ? upMove : 0;
      mdm[i] = dnMove > upMove && dnMove > 0 ? dnMove : 0;
    }
    const str = rma(tr, len), sp = rma(pdm, len), sm = rma(mdm, len);
    const pdi = sp.map((v, i) => 100 * v / str[i]), mdi = sm.map((v, i) => 100 * v / str[i]);
    const dx = pdi.map((v, i) => { const s = v + mdi[i]; return s === 0 ? 0 : 100 * Math.abs(v - mdi[i]) / s; });
    return { adx: rma(dx, len), pdi, mdi };
  },
});
registerIndicator({
  type: 'supertrend', label: 'SuperTrend', pane: 'price', outputs: ['line', 'dir'],
  paramsSchema: { type: 'object', properties: { atrLength: int(10), mult: num(3, 0.1, 20) } },
  warmup: p => (p.atrLength ?? 10) * 3,
  compute: (b, p) => {
    const { high: h, low: l, close: c, n } = b, a = atrSeries(b, p.atrLength ?? 10), m = p.mult ?? 3;
    const line = NaNArr(n), dir = NaNArr(n);
    let ub = NaN, lb = NaN, d = 1;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(a[i])) continue;
      const mid = (h[i] + l[i]) / 2, bu = mid + m * a[i], bl = mid - m * a[i];
      const pc = i > 0 ? c[i - 1] : c[i];
      ub = Number.isNaN(ub) || bu < ub || pc > ub ? bu : ub;
      lb = Number.isNaN(lb) || bl > lb || pc < lb ? bl : lb;
      if (d === 1 && c[i] < lb) d = -1; else if (d === -1 && c[i] > ub) d = 1;
      dir[i] = d; line[i] = d === 1 ? lb : ub;
    }
    return { line, dir };
  },
});
registerIndicator({
  // Pivot high/low confirmed `right` bars later; the series carries the most
  // recent CONFIRMED pivot forward, so value[i] never depends on bars > i.
  type: 'swing', label: 'Swing 波段高低點', pane: 'price', outputs: ['high', 'low'],
  paramsSchema: { type: 'object', properties: { left: int(5), right: int(5) } },
  warmup: p => (p.left ?? 5) + (p.right ?? 5) + 1,
  compute: (b, p) => {
    const L = p.left ?? 5, R = p.right ?? 5, { high: h, low: l, n } = b;
    const hi = NaNArr(n), lo = NaNArr(n);
    let lastH = NaN, lastL = NaN;
    for (let i = 0; i < n; i++) {
      const k = i - R;                     // candidate pivot confirmed at i
      if (k - L >= 0) {
        let isH = true, isL = true;
        for (let j = k - L; j <= k + R; j++) {
          if (j === k) continue;
          if (j < k ? h[j] >= h[k] : h[j] > h[k]) isH = false;
          if (j < k ? l[j] <= l[k] : l[j] < l[k]) isL = false;
        }
        if (isH) lastH = h[k];
        if (isL) lastL = l[k];
      }
      hi[i] = lastH; lo[i] = lastL;
    }
    return { high: hi, low: lo };
  },
});
registerIndicator({
  type: 'volume_ma', label: '量均線', pane: 'sub', outputs: ['value'],
  paramsSchema: { type: 'object', properties: { length: int(20), field: { type: 'string', default: 'volume', enum: ['volume', 'turnover'] } } },
  warmup: p => p.length ?? 20,
  compute: (b, p) => ({ value: sma(b[p.field || 'volume'], p.length ?? 20) }),
});
registerIndicator({
  // (stock return / benchmark return over `length`) − 1, in %. Needs puzzle.benchmark.
  type: 'rel_strength', label: '相對大盤強度', pane: 'sub', outputs: ['value'],
  paramsSchema: { type: 'object', properties: { benchmark: { type: 'string', default: 'market' }, length: int(60) } },
  warmup: p => (p.length ?? 60) + 1,
  compute: (b, p) => {
    const len = p.length ?? 60, n = b.n, out = NaNArr(n), bm = b.benchmark;
    if (!bm) return { value: out };
    for (let i = len; i < n; i++) out[i] = ((b.close[i] / b.close[i - len]) / (bm[i] / bm[i - len]) - 1) * 100;
    return { value: out };
  },
});

registerIndicator({
  // Rate of change: (close / close[n] − 1) × 100
  type: 'roc', label: 'ROC 變動率', pane: 'sub', outputs: ['value'],
  paramsSchema: { type: 'object', properties: { length: int(20), source: srcSchema }, required: ['length'] },
  warmup: p => p.length + 1,
  compute: (b, p) => {
    const x = sourceSeries(b, p.source), n = x.length, out = NaNArr(n);
    for (let i = p.length; i < n; i++) out[i] = (x[i] / x[i - p.length] - 1) * 100;
    return { value: out };
  },
});
registerIndicator({
  // Clenow-style momentum: least-squares fit of ln(close) over `length` bars.
  //   slope = annualised % trend ((e^(β·252) − 1) × 100), r2 = fit quality, adj = slope × r2
  type: 'linreg', label: '指數迴歸動能（Clenow）', pane: 'sub', outputs: ['adj', 'slope', 'r2'],
  paramsSchema: { type: 'object', properties: { length: int(90, 10, 500) }, required: ['length'] },
  warmup: p => p.length,
  compute: (b, p) => {
    const L = p.length, c = b.close, n = c.length;
    const adj = NaNArr(n), slope = NaNArr(n), r2 = NaNArr(n);
    const xm = (L - 1) / 2;
    let sxx = 0; for (let k = 0; k < L; k++) sxx += (k - xm) ** 2;
    for (let i = L - 1; i < n; i++) {
      let ym = 0, ok = true;
      for (let k = 0; k < L; k++) { const v = c[i - L + 1 + k]; if (!(v > 0)) { ok = false; break; } ym += Math.log(v); }
      if (!ok) continue;
      ym /= L;
      let sxy = 0, syy = 0;
      for (let k = 0; k < L; k++) { const dy = Math.log(c[i - L + 1 + k]) - ym; sxy += (k - xm) * dy; syy += dy * dy; }
      const beta = sxy / sxx;
      const rr = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
      slope[i] = (Math.exp(beta * 252) - 1) * 100;
      r2[i] = rr;
      adj[i] = slope[i] * rr;
    }
    return { adj, slope, r2 };
  },
});

/** Compute every indicator in a spec. Returns { seriesName: Float64Array }.
    Naming: multi-output → `${id}.${out}`; the first output is also exposed
    as bare `${id}` (so `atr14`, `ema20` work as in the SDD examples). */
export function computeIndicators(bars, indicatorSpecs = []) {
  const series = {};
  for (const f of ['open', 'high', 'low', 'close', 'volume', 'turnover']) series[f] = bars[f];
  for (const [k, v] of Object.entries(bars)) if (v instanceof Float64Array && !series[k]) series[k] = v;
  for (const ind of indicatorSpecs) {
    const plugin = INDICATORS[ind.type];
    if (!plugin) throw new Error(`未知的指標類型：${ind.type}`);
    const params = withDefaults(plugin.paramsSchema, ind.params || {});
    const out = plugin.compute(bars, params);
    plugin.outputs.forEach((o, idx) => {
      series[`${ind.id}.${o}`] = out[o];
      if (idx === 0) series[ind.id] = out[o];
    });
  }
  return series;
}

export function indicatorOutputs(ind) {
  const plugin = INDICATORS[ind.type];
  if (!plugin) return [];
  return [ind.id, ...plugin.outputs.map(o => `${ind.id}.${o}`)];
}

export function withDefaults(schema, params) {
  const out = { ...params };
  for (const [k, s] of Object.entries(schema?.properties || {})) if (out[k] === undefined && s.default !== undefined) out[k] = s.default;
  return out;
}

export function maxWarmup(indicatorSpecs = []) {
  let w = 0;
  for (const ind of indicatorSpecs) {
    const p = INDICATORS[ind.type];
    if (p) w = Math.max(w, p.warmup(withDefaults(p.paramsSchema, ind.params || {})));
  }
  return w;
}
