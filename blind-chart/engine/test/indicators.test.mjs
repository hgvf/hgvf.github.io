// Indicator values vs naive reference formulas (SDD 8.3: 誤差 < 1e-6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBars, computeIndicators, syntheticOHLC, INDICATORS } from '../index.js';

const d = syntheticOHLC(400, 5);
const bars = makeBars(d);
const C = d.close, H = d.high, L = d.low;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

function refSMA(x, n, i) { let s = 0; for (let k = 0; k < n; k++) s += x[i - k]; return s / n; }
function refEMA(x, n, alpha) { const out = []; let prev; for (let i = 0; i < x.length; i++) { if (i < n - 1) { out.push(NaN); continue; } if (i === n - 1) { prev = refSMA(x, n, i); } else prev = alpha * x[i] + (1 - alpha) * prev; out.push(prev); } return out; }
function refTR(i) { return i === 0 ? H[0] - L[0] : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])); }

test('sma / ema / rma match reference', () => {
  const s = computeIndicators(bars, [{ id: 's', type: 'sma', params: { length: 20 } }, { id: 'e', type: 'ema', params: { length: 20 } }, { id: 'r', type: 'rma', params: { length: 14 } }]);
  const e = refEMA(C, 20, 2 / 21), r = refEMA(C, 14, 1 / 14);
  for (let i = 19; i < 400; i++) { near(s.s[i], refSMA(C, 20, i), 'sma'); near(s.e[i], e[i], 'ema'); }
  for (let i = 13; i < 400; i++) near(s.r[i], r[i], 'rma');
  assert.ok(Number.isNaN(s.s[18]));
});

test('atr (Wilder) matches reference', () => {
  const s = computeIndicators(bars, [{ id: 'a', type: 'atr', params: { length: 14 } }]);
  const tr = C.map((_, i) => refTR(i));
  const ref = refEMA(tr, 14, 1 / 14);
  for (let i = 13; i < 400; i++) near(s.a[i], ref[i], 'atr');
  const p = computeIndicators(bars, [{ id: 'a', type: 'atr', params: { length: 14, asPercent: true } }]);
  near(p.a[200], ref[200] / C[200] * 100, 'atr%');
});

test('donchian / bollinger / rsi', () => {
  const s = computeIndicators(bars, [
    { id: 'dc', type: 'donchian', params: { length: 20 } },
    { id: 'bb', type: 'bollinger', params: { length: 20, mult: 2 } },
    { id: 'rsi', type: 'rsi', params: { length: 14 } },
  ]);
  const i = 250;
  near(s['dc.upper'][i], Math.max(...H.slice(i - 19, i + 1)), 'dc upper');
  near(s['dc.lower'][i], Math.min(...L.slice(i - 19, i + 1)), 'dc lower');
  const w = C.slice(i - 19, i + 1), m = w.reduce((a, b) => a + b) / 20, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  near(s['bb.upper'][i], m + 2 * sd, 'bb upper');
  // RSI via Wilder
  const up = [NaN], dn = [NaN];
  for (let k = 1; k < 400; k++) { up.push(Math.max(C[k] - C[k - 1], 0)); dn.push(Math.max(C[k - 1] - C[k], 0)); }
  const au = refEMA(up.slice(1), 14, 1 / 14), ad = refEMA(dn.slice(1), 14, 1 / 14);
  near(s.rsi[i], 100 - 100 / (1 + au[i - 1] / ad[i - 1]), 'rsi');
});

test('every plugin returns declared outputs with correct length', () => {
  const b2 = makeBars({ ...d, benchmark: d.close.map((x, i) => 100 + i * 0.1) });
  for (const [type, p] of Object.entries(INDICATORS)) {
    const s = computeIndicators(b2, [{ id: 'x', type, params: {} }]);
    for (const o of p.outputs) assert.equal(s[`x.${o}`].length, 400, `${type}.${o}`);
    assert.ok(Number.isFinite(s.x[399]), `${type} last value finite`);
  }
});
