// @trainer/engine — public surface. Pure ES modules: browser + Node.
export * from './util.js';
export * from './bars.js';
export * from './indicators.js';
export * from './expr.js';
export * from './plugins.js';
export * from './spec.js';
export * from './violations.js';
export * from './sim.js';
export * from './report.js';
export * from './presets.js';
export * from './synthetic.js';
import { barsFromPuzzle } from './bars.js';
import { prepare, simulate } from './sim.js';

/** One-liner used by the app and by gen-puzzles. */
export function prepareForPuzzle(puzzle, spec, opts = {}) {
  const bars = barsFromPuzzle(puzzle);
  return prepare({
    bars, spec, market: opts.mixed ? 'MIX' : puzzle.market,
    lotSize: opts.mixed ? 1 : (opts.lotSize ?? spec.account?.lotSize?.[puzzle.market] ?? puzzle.lotSize ?? 1),
    playStart: puzzle.contextBars, playEnd: puzzle.contextBars + puzzle.playBars,
    initialEquity: opts.initialEquity,
  });
}

/** Signal bars (relative to play start) for a preset, evaluated flat — gen-puzzles uses this. */
export function scanSignals(ctx) {
  const run = simulate(ctx, { mode: 'shadow' });
  return run.signals.map(i => i - ctx.playStart);
}

/** A "perfect student": follows every rule exactly. Used by tests (Actual must equal
    Shadow) and by the UI's 「照規則自動玩」 demo. Returns the action log. */
export function compliantActions(ctx) {
  const actions = [];
  for (let t = ctx.playStart; t < ctx.playEnd; t++) {
    const run = simulate(ctx, { mode: 'actual', actions, upTo: t });
    const adv = run.advice[t];
    if (!adv) continue;
    const pos = adv.pos;
    if (adv.hit?.stop && pos) { actions.push({ barIndex: t, action: 'sell', qty: pos.size, kind: 'stop' }); continue; }
    if (adv.hit?.targets?.length && pos) {
      for (const th of adv.hit.targets) actions.push({ barIndex: t, action: 'sell', qty: th.qty, kind: 'target' });
      continue;
    }
    if (!pos) {
      if (adv.entrySignal && adv.suggest.qty > 0) actions.push({ barIndex: t, action: 'buy', qty: adv.suggest.qty });
      continue;
    }
    if (adv.pendingOrders.length) continue;
    if (adv.exitAll) actions.push({ barIndex: t, action: 'sell', qty: pos.size });
    else if (adv.exitPart) actions.push({ barIndex: t, action: 'sell', qty: adv.exitPart.qty ?? Math.max(1, Math.round(pos.size * adv.exitPart.fraction)) });
    else if (adv.addSignal && adv.addQty > 0) actions.push({ barIndex: t, action: 'add', qty: adv.addQty });
  }
  return actions;
}
