// 未來函數測試：改動 t 之後的資料，t 當下所有線與訊號不變（SDD 8.3）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBars, computeIndicators, syntheticOHLC, INDICATORS, prepare, simulate, PRESETS } from '../index.js';

const d = syntheticOHLC(500, 9);
const t = 330;
const mutated = Object.fromEntries(Object.entries(d).map(([k, a]) => [k, a.map((v, i) => (i > t ? v * (1.3 + (i % 7) * 0.05) : v))]));

test('indicators are causal', () => {
  const b1 = makeBars({ ...d, benchmark: d.close }), b2 = makeBars({ ...mutated, benchmark: mutated.close });
  for (const type of Object.keys(INDICATORS)) {
    const params = type === 'swing' ? { left: 3, right: 3 } : {};
    const s1 = computeIndicators(b1, [{ id: 'x', type, params }]), s2 = computeIndicators(b2, [{ id: 'x', type, params }]);
    for (const [k, arr] of Object.entries(s1)) {
      if (!k.startsWith('x')) continue;
      for (let i = 0; i <= t; i++) {
        const a = arr[i], b = s2[k][i];
        assert.ok((Number.isNaN(a) && Number.isNaN(b)) || a === b, `${k}[${i}] changed: ${a} → ${b}`);
      }
    }
  }
});

test('rule lines and advice at t do not depend on bars > t', () => {
  for (const preset of PRESETS) {
    const mk = src => prepare({ bars: makeBars(src), spec: preset, market: 'US', playStart: 250, playEnd: 500 });
    const c1 = mk(d), c2 = mk(mutated);
    const r1 = simulate(c1, { mode: 'shadow', upTo: t }), r2 = simulate(c2, { mode: 'shadow', upTo: t });
    assert.deepEqual(Array.from(r1.stopLine.slice(0, t + 1)), Array.from(r2.stopLine.slice(0, t + 1)), preset.id);
    assert.deepEqual(r1.signals, r2.signals);
    assert.equal(JSON.stringify(r1.advice[t]), JSON.stringify(r2.advice[t]));
  }
});
