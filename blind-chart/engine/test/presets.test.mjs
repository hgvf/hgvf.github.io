// 內建策略的中繼資料：旋鈕路徑、策略變數、說明欄位都要正確，否則策略頁會顯示錯的值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, validateSpec, normalizeSpec, getKnob, setKnob, deepClone, substituteVars } from '../index.js';
import { backtest } from '../backtest.js';
import { puzzles } from './helpers.mjs';

test('每個 preset 都有分類、說明、出處', () => {
  const ids = new Set();
  for (const p of PRESETS) {
    assert.ok(!ids.has(p.id), `重複 id ${p.id}`); ids.add(p.id);
    assert.ok(CATEGORIES.includes(p.category), `${p.id} category`);
    assert.ok(p.idea && p.summary?.entry && p.summary?.exit && p.summary?.sizing, `${p.id} summary`);
    assert.ok(p.source?.ref, `${p.id} source`);
    for (const ind of p.indicators) assert.ok(p.roles?.[ind.id], `${p.id} 缺指標角色說明：${ind.id}`);
  }
});

test('每個旋鈕都指到存在的數值，且預設值在範圍內', () => {
  for (const p of PRESETS) {
    assert.ok(p.knobs?.length >= 3, `${p.id} 旋鈕太少`);
    for (const k of p.knobs) {
      const v = getKnob(p, k.path);
      assert.equal(typeof v, 'number', `${p.id} ${k.path} → ${v}`);
      assert.ok(v >= k.min - 1e-9 && v <= k.max + 1e-9, `${p.id} ${k.path}=${v} 不在 [${k.min}, ${k.max}]`);
      assert.ok(k.label && k.step > 0, `${p.id} ${k.path} label/step`);
    }
  }
});

test('調整旋鈕後策略仍然有效、而且真的改到規則', () => {
  for (const p of PRESETS) {
    for (const k of p.knobs) {
      const s = deepClone(p);
      assert.ok(setKnob(s, k.path, k.max), `${p.id} set ${k.path}`);
      assert.equal(getKnob(s, k.path), k.max);
      assert.deepEqual(validateSpec(s), [], `${p.id} ${k.path}=${k.max}`);
    }
  }
});

test('策略變數 $var 會代入條件式；未定義的變數會被擋下', () => {
  assert.equal(substituteVars('rsi2 < $rsiTh and x > $y', { rsiTh: 5 }), 'rsi2 < 5 and x > $y');
  const rsi = PRESETS.find(p => p.id === 'connors-rsi2-v1');
  assert.equal(normalizeSpec(rsi).entry.signal, 'close > sma200 and rsi2 < 10');
  const bad = { ...deepClone(rsi), vars: {} };
  assert.ok(validateSpec(bad).some(e => /未定義的策略變數/.test(e.message)));
  const nonNum = { ...deepClone(rsi), vars: { rsiTh: 'abc' } };
  assert.ok(validateSpec(nonNum).some(e => e.path === 'vars.rsiTh'));
});

test('快速回測：旋鈕改變會反映在結果上', () => {
  const items = puzzles.map(pz => ({ puzzle: pz, meta: { regime: pz.tags.regime, market: pz.market } }));
  const rsi = PRESETS.find(p => p.id === 'connors-rsi2-v1');
  const a = backtest(items, rsi);
  const loose = deepClone(rsi); setKnob(loose, 'vars.rsiTh', 30);
  const b = backtest(items, loose);
  assert.ok(b.trades > a.trades, `門檻放寬後交易應變多：${a.trades} → ${b.trades}`);
  const bh = backtest(items, 'buyhold');
  assert.equal(bh.exposure, 1);
});
