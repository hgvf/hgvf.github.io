import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, checkExpr, makeBars, BarView } from '../index.js';

const series = { close: Float64Array.from([1, 2, 3, 2, 5]), ema20: Float64Array.from([1, 1, 2, 2, 3]), 'dc20.upper': Float64Array.from([2, 2, 3, 4, 4]) };
const known = new Set(Object.keys(series));
const at = (src, t, state) => compile(src, known).eval({ view: new BarView(series, t), state });

test('arithmetic, comparison, logic', () => {
  assert.equal(at('close * 2 + 1', 4), 11);
  assert.equal(at('close > ema20 and not (close < 1)', 4), 1);
  assert.equal(at('close[1] == 2 or false', 4), 1);
  assert.equal(at('-close[2] + abs(-3)', 4), 0);
});
test('functions', () => {
  assert.equal(at('cross_up(close, dc20.upper[1])', 4), 1);   // 5 > 4 and 2 <= 3
  assert.equal(at('highest(close, 3)', 4), 5);
  assert.equal(at('lowest(close, 3)', 4), 2);
  assert.equal(at('rising(close, 1)', 4), 1);
  assert.equal(at('falling(close, 1)', 3), 1);
  assert.equal(at('max(close, ema20, 10)', 4), 10);
});
test('pos / acct variables', () => {
  assert.equal(at('pos.unrealizedR >= 1 and acct.equity > 0', 4, { pos: { unrealizedR: 1.2 }, acct: { equity: 5 } }), 1);
});
test('errors carry positions', () => {
  assert.equal(checkExpr('close > foo', known).pos, 8);
  assert.equal(checkExpr('close > (ema20', known).message, '這裡應該是「)」');
  assert.ok(checkExpr('close[-1]', known));
  assert.ok(checkExpr('pos.bogus > 1', known).message.includes('未知的部位變數'));
  assert.ok(checkExpr('eval(1)', known).message.includes('未知的函數'));
  assert.equal(checkExpr('close > 1 and', known).message, '運算式不完整');
});
test('BarView refuses look-ahead', () => {
  const v = new BarView(series, 2);
  assert.equal(v.get('close', 0), 3);
  assert.throws(() => v.get('close', -1), /look-ahead/);
});
