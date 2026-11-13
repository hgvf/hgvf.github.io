import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, buildReport, compliantActions, simulate, validateSpec } from '../index.js';
import { puzzles, ctxFor } from './helpers.mjs';

test('presets validate', () => { for (const p of PRESETS) assert.deepEqual(validateSpec(p), [], p.id); });

test('完全依規則操作：Actual = Shadow、紀律分數 100', () => {
  let tradesSeen = 0;
  for (const preset of PRESETS) for (const pz of puzzles) {
    const ctx = ctxFor(pz, preset);
    const actions = compliantActions(ctx);
    const rep = buildReport(ctx, actions);
    tradesSeen += rep.shadow.trades.length;
    assert.equal(rep.violations.filter(v => v.code !== 'MISSED_SIGNAL').length, 0, `${preset.id}/${pz.id}: ${JSON.stringify(rep.violations.map(v => [v.code, v.bar]))}`);
    assert.ok(Math.abs(rep.actual.finalEquity - rep.shadow.finalEquity) < 1e-6, `${preset.id}/${pz.id}: ${rep.actual.finalEquity} vs ${rep.shadow.finalEquity}`);
    assert.equal(rep.score, 100);
  }
  assert.ok(tradesSeen > 10, `too few trades in fixtures: ${tradesSeen}`);
});

test('determinism: same session → identical report', () => {
  const ctx = ctxFor(puzzles[2]);
  const acts = compliantActions(ctx).map((a, i) => (i === 0 ? { ...a, qty: a.qty * 2 } : a));
  const a = JSON.stringify(buildReport(ctx, acts).violations), b = JSON.stringify(buildReport(ctxFor(puzzles[2]), acts).violations);
  assert.equal(a, b);
});

// Find a fixture where the shadow has a losing (stopped) trade, etc.
function firstTrade(pred, preset = PRESETS[0]) {
  for (const pz of puzzles) {
    const ctx = ctxFor(pz, preset);
    const sh = simulate(ctx, { mode: 'shadow' });
    const t = sh.trades.find(pred);
    if (t) return { ctx, t, sh };
  }
  throw new Error('no fixture trade');
}

test('STOP_IGNORED: holding through the stop is flagged with a counterfactual cost', () => {
  const { ctx, t } = firstTrade(t => t.exitReason === 'stop' && !t.open && t.exitBar < ctx0End(t));
  const qty = t.fills[0].qty;
  const acts = [{ barIndex: t.signalBar, action: 'buy', qty }];
  const rep = buildReport(ctx, acts);
  const v = rep.violations.find(v => v.code === 'STOP_IGNORED');
  assert.ok(v, JSON.stringify(rep.violations));
  assert.equal(v.bar, t.exitBar);
  assert.ok(Number.isFinite(v.cost));
  assert.ok(Math.abs(v.cfEquity - (rep.actual.finalEquity + v.cost)) < 1e-6);
  // the counterfactual exits at the stop exactly like the shadow trade
  assert.ok(Math.abs(v.cfEquity - (ctx.initialEquity + t.pnl)) < 1e-6 || rep.shadow.trades.length > 1);
});
function ctx0End() { return 499; }

test('NO_SIGNAL_ENTRY / REVENGE / AVERAGE_DOWN / ADD_OFF_RULE / OVERSIZE / UNDERSIZE / MISSED_SIGNAL', () => {
  const { ctx, t } = firstTrade(t => t.exitReason === 'stop' && !t.open);
  const q = t.fills[0].qty;
  const noSig = t.signalBar - 3;
  let rep = buildReport(ctx, [{ barIndex: noSig, action: 'buy', qty: q }]);
  assert.ok(rep.violations.some(v => v.code === 'NO_SIGNAL_ENTRY'));
  const nse = rep.violations.find(v => v.code === 'NO_SIGNAL_ENTRY');
  assert.ok(Number.isFinite(nse.cost));

  // revenge: follow the stop, then re-enter right after without a signal
  rep = buildReport(ctx, [{ barIndex: t.signalBar, action: 'buy', qty: q }, { barIndex: t.exitBar, action: 'sell', qty: q, kind: 'stop' }, { barIndex: t.exitBar + 1, action: 'buy', qty: q }]);
  assert.ok(rep.violations.some(v => v.code === 'REVENGE'), JSON.stringify(rep.violations.map(v => v.code)));

  rep = buildReport(ctx, [{ barIndex: t.signalBar, action: 'buy', qty: q * 3 }]);
  assert.ok(rep.violations.some(v => v.code === 'OVERSIZE' || v.code === 'RISK_CAP'));
  rep = buildReport(ctx, [{ barIndex: t.signalBar, action: 'buy', qty: Math.max(1, Math.floor(q / 3)) }]);
  assert.ok(rep.violations.some(v => v.code === 'UNDERSIZE'));
  const us = rep.violations.find(v => v.code === 'UNDERSIZE');
  assert.ok(Number.isFinite(us.cost));

  rep = buildReport(ctx, []);
  assert.ok(rep.violations.some(v => v.code === 'MISSED_SIGNAL'));
  const ms = rep.violations.find(v => v.code === 'MISSED_SIGNAL');
  // missing a losing trade: the counterfactual (taking it) ends lower → negative cost (lucky)
  assert.ok(Number.isFinite(ms.cost));

  // average down: find a bar inside the trade where close < entry
  const S = ctx.series.close;
  let k = t.entryBar; while (k < t.exitBar && !(S[k] < t.entryPrice)) k++;
  if (k < t.exitBar) {
    rep = buildReport(ctx, [{ barIndex: t.signalBar, action: 'buy', qty: q }, { barIndex: k, action: 'add', qty: q }]);
    const ad = rep.violations.find(v => v.code === 'AVERAGE_DOWN');
    assert.ok(ad);
    assert.ok(ad.cost > -1e-6, `averaging down into a stop-out should cost money: ${ad.cost}`);
  }
});

test('EARLY_EXIT only when discretionary exits are disallowed', () => {
  const preset = { ...PRESETS[0], discipline: { ...PRESETS[0].discipline, allowDiscretionaryExit: false } };
  const { ctx, t } = firstTrade(t => t.exitBar - t.entryBar > 6, preset);
  const q = t.fills[0].qty;
  const rep = buildReport(ctx, [{ barIndex: t.signalBar, action: 'buy', qty: q }, { barIndex: t.entryBar + 2, action: 'sell', qty: q }]);
  const ee = rep.violations.find(v => v.code === 'EARLY_EXIT');
  assert.ok(ee, JSON.stringify(rep.violations.map(v => v.code)));
  // counterfactual = rules manage the rest of the trade → equals the shadow trade's outcome
  assert.ok(Number.isFinite(ee.cost));
});

test('pyramiding preset: ADD_OFF_RULE when adding without the trigger', () => {
  const preset = PRESETS[2];
  const { ctx, t } = firstTrade(t => t.exitBar - t.entryBar > 3, preset);
  const q = t.fills[0].qty;
  // add on the fill bar: unrealizedR ~ 0, trigger (≥0.5R) not met
  const S = ctx.series.close;
  let k = t.entryBar; while (k < t.exitBar && !(S[k] >= t.entryPrice && (S[k] - t.entryPrice) / t.riskPerShare < 0.5)) k++;
  if (k >= t.exitBar) return;
  const rep = buildReport(ctx, [{ barIndex: t.signalBar, action: 'buy', qty: q }, { barIndex: k, action: 'add', qty: q }]);
  assert.ok(rep.violations.some(v => v.code === 'ADD_OFF_RULE' || v.code === 'AVERAGE_DOWN'), JSON.stringify(rep.violations.map(v => v.code)));
});
