// sim.js — deterministic account replay (SDD 4.1, 6.4, 7.1).
//
// One function, three uses:
//   mode 'actual'  — replay the player's action log, detect violations
//   mode 'shadow'  — ignore the log; every entry / exit / add follows the rules
//   mode 'actual' + mods — counterfactual: the action log with one violation
//                          replaced by the rule's action (see report.js)
//
// Timing (all accounts share it):
//   decision point = after bar t closes. Indicators only see bars ≤ t (BarView).
//   market orders fill at open[t+1] (fill.mode next_open) or close[t] (this_close).
//   the stop computed at close t is a resting line for bar t+1: low ≤ stop → exit
//   at min(stop, open). Targets likewise: high ≥ target → max(target, open).
//   stop beats target when both trigger on the same bar.
//   The player cannot place resting orders, so a stop / target hit on bar t is
//   "confirmed" by selling with kind:'stop' / kind:'target' at decision t — it then
//   fills at the line price, exactly like the shadow account. Confirming later
//   (after stopGraceBars) is a market sell at the next open + a violation.
import { BarView } from './bars.js';
import { computeIndicators } from './indicators.js';
import { compile } from './expr.js';
import { normalizeSpec, knownSeries } from './spec.js';
import { STOPS, maLine, targetPrice, sizeEntry, PYRAMID_SIZE } from './plugins.js';
import { roundLot, isNum } from './util.js';
import { VIOLATIONS } from './violations.js';

/** Prepare everything that does not depend on the action log (cache per puzzle+spec). */
export function prepare({ bars, spec: rawSpec, market, lotSize, playStart, playEnd, initialEquity }) {
  const spec = normalizeSpec(rawSpec);
  const series = computeIndicators(bars, spec.indicators);
  const known = knownSeries(spec, Object.keys(series));
  const C = src => (src ? compile(src, known) : null);
  const lot = lotSize ?? spec.account.lotSize?.[market] ?? 1;
  const defaultAtr = spec.discipline.atrId || spec.indicators.find(x => x.type === 'atr')?.id;
  const ctx = {
    bars, spec, series, lot, market, defaultAtr,
    playStart: playStart ?? 0, playEnd: playEnd ?? bars.n,
    initialEquity: initialEquity ?? spec.account.initialEquity,
    compiled: {
      entry: C(spec.entry.signal),
      exits: spec.exitSignals.map(x => C(x.expr)),
      stopsAct: spec.stops.map(s => C(s.activateWhen)),
      targets: spec.targets.map(t => C(t.at?.expr)),
      thenStopAct: spec.targets.map(t => C(t.thenStop?.activateWhen)),
      pyramid: spec.pyramiding.enabled ? C(spec.pyramiding.trigger) : null,
    },
  };
  ctx.evalCtx = (i, pos, acct) => ({ view: new BarView(series, i), state: { pos: pos ? posVars(ctx, pos, i) : flatPos(), acct: acct || {} } });
  return ctx;
}

const flatPos = () => ({ size: 0, avgPrice: NaN, unrealizedR: 0, unrealizedPnl: 0, barsHeld: 0, adds: 0, highestSinceEntry: NaN, lastAddPrice: NaN, entryPrice: NaN, initialStop: NaN, stop: NaN, riskPerShare: NaN });
function posVars(ctx, p, i) {
  const c = ctx.series.close[i];
  return {
    size: p.size, avgPrice: p.avgPrice, unrealizedPnl: (c - p.avgPrice) * p.size,
    unrealizedR: p.R0 > 0 ? (c - p.avgPrice) * p.size / p.R0 : 0,
    barsHeld: p.barsHeld, adds: p.adds, highestSinceEntry: p.highestSinceEntry, lastAddPrice: p.lastAddPrice,
    entryPrice: p.entryPrice, initialStop: p.initialStop, stop: p.stop, riskPerShare: p.riskPerShare,
  };
}

/** Initial stop for a hypothetical entry at `price` decided on bar `sigBar`. */
export function initialStopFor(ctx, price, sigBar) {
  let best = NaN;
  for (const st of ctx.spec.stops) {
    const p = STOPS[st.type];
    if (p?.kind !== 'initial' && !(p?.initial)) continue;
    if (st.activateWhen) continue;           // conditional stops are never initial
    const v = p.initial(ctx, price, sigBar, st.params || {});
    if (isNum(v) && v < price) best = isNum(best) ? Math.max(best, v) : v;
  }
  if (!isNum(best)) best = price * 0.92;      // no valid initial stop → 8% fallback so R stays defined
  return best;
}

/**
 * simulate(ctx, { mode, actions, upTo, mods })
 *   actions: [{ barIndex, action:'buy'|'add'|'sell', qty, kind?:'market'|'stop'|'target', ts? }]
 *   mods (counterfactual): { dropTrade, drop:Set<idx>, resize:{idx:qty}, autopilot:{tradeId,bar,phase}, inject:{bar,qty} }
 * Returns per-bar arrays + trades + violations (actual mode only).
 */
export function simulate(ctx, { mode = 'actual', actions = [], upTo, mods = null } = {}) {
  const { series: S, spec, lot, compiled: K } = ctx;
  const { open: O, high: H, low: L, close: Cl } = S;
  const start = ctx.playStart, last = ctx.playEnd - 1;
  const end = Math.min(upTo ?? last, last);
  const disc = spec.discipline;
  const isActual = mode === 'actual';
  const detect = isActual && !mods;
  const cashOnly = spec.sizing.caps?.cashOnly !== false;
  const fillMode = spec.fill.mode;

  const st = {
    cash: ctx.initialEquity, pos: null, pending: [], trades: [], tradeSeq: 0,
    lastExit: { bar: -Infinity, reason: null }, lastSignalBar: -Infinity,
  };
  const n = S.close.length;
  const out = {
    mode, start, end,
    equity: new Float64Array(n).fill(NaN), cash: new Float64Array(n).fill(NaN),
    stopLine: new Float64Array(n).fill(NaN), targetLines: [], avgLine: new Float64Array(n).fill(NaN),
    addTrigger: new Float64Array(n).fill(NaN),
    advice: [], fills: [], signals: [], hits: [], violations: [], obligations: [], annotated: [],
  };
  for (let k = 0; k < spec.targets.length; k++) out.targetLines.push(new Float64Array(n).fill(NaN));

  // Player actions grouped by bar (with their original index), after mods.
  const byBar = new Map();
  actions.forEach((a, idx) => {
    if (mods?.drop?.has(idx)) return;
    if (mods?.dropTradeActions?.has(idx)) return;
    let a2 = { ...a, idx };
    if (mods?.resize && mods.resize[idx] != null) a2.qty = mods.resize[idx];
    if (!byBar.has(a.barIndex)) byBar.set(a.barIndex, []);
    byBar.get(a.barIndex).push(a2);
  });
  const annot = actions.map(() => ({}));
  out.annotated = annot;

  const acctVars = i => {
    const p = st.pos, c = Cl[i];
    const eq = st.cash + (p ? p.size * c : 0);
    const risk = p ? Math.max(0, p.avgPrice - (isNum(p.stop) ? p.stop : p.initialStop)) * p.size : 0;
    return { equity: eq, cash: st.cash, openRisk: risk, openRiskR: p && p.R0 > 0 ? risk / p.R0 : 0 };
  };
  const openRiskR = p => (p && p.R0 > 0 ? Math.max(0, p.avgPrice - (isNum(p.stop) ? p.stop : p.initialStop)) * p.size / p.R0 : 0);

  // ── order execution primitives ──
  function buy(i, price, qty, info) {
    if (cashOnly) qty = Math.min(qty, roundLot(st.cash / price, lot));
    qty = roundLot(qty, lot);
    if (qty <= 0) return null;
    st.cash -= qty * price;
    let p = st.pos;
    if (!p) {
      const sigBar = info.signalBar ?? i;
      let stop = initialStopFor(ctx, price, sigBar);
      if (!(stop < price)) stop = price * 0.999;
      const rps = price - stop;
      p = st.pos = {
        tradeId: ++st.tradeSeq, size: qty, avgPrice: price, entryPrice: price, entryBar: i, signalBar: sigBar,
        initialStop: stop, riskPerShare: rps, initialShares: qty, R0: rps * qty, adds: 0, lastAddPrice: price,
        highestSinceEntry: H[i], lowestSinceEntry: L[i], maxCloseR: 0, barsHeld: 0,
        stop, active: spec.stops.map(s => !s.activateWhen), extra: [], floor: NaN,
        targetsDone: spec.targets.map(() => false), targetPx: [], autopilot: !!info.autopilot,
        fills: [], obligStop: null, violated: {},
      };
      p.targetPx = spec.targets.map((t, k) => targetPrice(ctx, p, sigBar, t, K.targets[k]));
      st.trades.push(p);
    } else {
      p.avgPrice = (p.avgPrice * p.size + price * qty) / (p.size + qty);
      p.size += qty; p.adds++; p.lastAddPrice = price;
      if (spec.pyramiding.onAdd?.moveStop?.type === 'breakeven') p.floor = Math.max(isNum(p.floor) ? p.floor : -Infinity, p.avgPrice);
      if (isNum(p.floor)) p.stop = Math.max(p.stop, p.floor);
    }
    const f = { bar: i, side: 'buy', qty, price, kind: p.fills.length ? 'add' : 'entry', reason: info.reason, actionIdx: info.actionIdx, tradeId: p.tradeId, auto: !!info.auto };
    p.fills.push(f); out.fills.push(f);
    if (info.actionIdx != null) annot[info.actionIdx].tradeId = p.tradeId;
    return f;
  }
  function sell(i, price, qty, info) {
    const p = st.pos;
    if (!p) return null;
    const before = p.size;
    qty = qty >= p.size ? p.size : roundLot(qty, lot);
    if (qty <= 0) return null;
    st.cash += qty * price;
    p.size -= qty;
    const f = { bar: i, side: 'sell', qty, price, kind: p.size === 0 ? 'exit' : 'partial', reason: info.reason, actionIdx: info.actionIdx, tradeId: p.tradeId, auto: !!info.auto };
    p.fills.push(f); out.fills.push(f);
    if (info.actionIdx != null) { annot[info.actionIdx].tradeId = p.tradeId; annot[info.actionIdx].fraction = qty / before; }
    if (p.size === 0) closeTrade(i, info.reason);
    return f;
  }
  function closeTrade(i, reason) {
    const p = st.pos;
    p.exitBar = i; p.exitReason = reason; p.open = false;
    finalizeTrade(p);
    st.lastExit = { bar: i, reason };
    st.pos = null;
    st.pending = st.pending.filter(o => o.side === 'buy');
  }
  function finalizeTrade(p, markPrice) {
    let pnl = 0;
    for (const f of p.fills) pnl += (f.side === 'sell' ? 1 : -1) * f.qty * f.price;
    if (markPrice != null) pnl += p.size * markPrice;
    p.pnl = pnl;
    p.R = p.R0 > 0 ? pnl / p.R0 : 0;
    p.mae = p.riskPerShare > 0 ? (p.lowestSinceEntry - p.entryPrice) / p.riskPerShare : 0;
    p.mfe = p.riskPerShare > 0 ? (p.highestSinceEntry - p.entryPrice) / p.riskPerShare : 0;
  }
  const sellQtyFor = (p, fraction) => {
    const q = roundLot(p.size * fraction, lot);
    return fraction >= 0.999 || q >= p.size || q <= 0 ? p.size : q;
  };
  function placeMarket(i, side, qty, info) {
    if (fillMode === 'this_close') return side === 'buy' ? buy(i, Cl[i], qty, info) : sell(i, Cl[i], qty, info);
    st.pending.push({ side, qty, ...info, placedBar: i });
    return 'pending';
  }

  // Suggested entry (for advice + size checks), entry at close[i].
  function suggestEntry(i) {
    const price = Cl[i];
    const stop = initialStopFor(ctx, price, i);
    const a = acctVars(i);
    const atr = ctx.defaultAtr ? S[spec.sizing.atrId || ctx.defaultAtr][i] : NaN;
    const r = sizeEntry(spec, { equity: a.equity, cash: a.cash, price, stop, atr }, lot);
    return { ...r, price, stop, riskPct: a.equity > 0 ? r.R / a.equity * 100 : 0 };
  }
  function suggestAdd(i, p) {
    const pyr = spec.pyramiding, price = Cl[i];
    const mode2 = pyr.size?.mode || 'fraction_of_initial';
    let q = PYRAMID_SIZE[mode2](p, pyr.size?.value, price, p.stop);
    const cap = pyr.riskCap?.maxOpenRiskR ?? spec.sizing.caps?.maxOpenRiskR;
    if (isNum(cap) && p.R0 > 0) {
      const newAvg = (qq) => (p.avgPrice * p.size + price * qq) / (p.size + qq);
      const stopAfter = (qq) => (pyr.onAdd?.moveStop?.type === 'breakeven' ? Math.max(p.stop, newAvg(qq)) : p.stop);
      const riskAfter = (qq) => Math.max(0, newAvg(qq) - stopAfter(qq)) * (p.size + qq) / p.R0;
      while (q > 0 && riskAfter(q) > cap + 1e-9) q = roundLot(q * 0.8, lot) || 0;
    }
    if (cashOnly) q = Math.min(q, st.cash / price);
    return roundLot(q, lot);
  }

  // Recompute lines for the next bar after decisions at close i.
  function updateLines(i) {
    const p = st.pos;
    if (!p) return;
    const ev = ctx.evalCtx(i, p, acctVars(i));
    let best = p.stop;
    const take = v => { if (isNum(v)) best = isNum(best) ? Math.max(best, v) : v; };
    spec.stops.forEach((s, k) => {
      if (!p.active[k] && K.stopsAct[k]?.test(ev)) p.active[k] = true;
      if (!p.active[k]) return;
      const pl = STOPS[s.type];
      if (pl.kind === 'initial' && s.activateWhen && pl.initial) take(pl.initial(ctx, p.entryPrice, p.signalBar, s.params || {}));
      if (pl.line && !(s.type === 'ma_trailing' && (s.params?.trigger ?? 'close') === 'close')) take(pl.line(ctx, p, i, s.params || {}));
    });
    for (const x of p.extra) {
      if (!x.active && (!x.act || x.act.test(ev))) x.active = true;
      if (!x.active) continue;
      const pl = STOPS[x.type];
      if (pl?.line) take(pl.line(ctx, p, i, x.params || {}));
    }
    if (isNum(p.floor)) take(p.floor);
    p.stop = best;
    spec.targets.forEach((t, k) => { if (!p.targetsDone[k] && t.at?.expr) p.targetPx[k] = K.targets[k].eval(ev); });
  }

  const obligations = [];   // actual mode: open rule obligations
  const addViolation = (code, i, extra) => {
    const def = VIOLATIONS[code];
    const w = disc.weights?.[code] ?? def.weight;
    const v = { code, name: def.name, bar: i, weight: code === 'MISSED_SIGNAL' && disc.scoreMissedSignal === false ? 0 : w, ...extra };
    out.violations.push(v);
    return v;
  };

  // ── main loop ──
  for (let i = start; i <= end; i++) {
    const hit = { stop: null, targets: [] };
    // Phase A — open / intraday of bar i
    if (i > start) {
      const pend = st.pending; st.pending = [];
      for (const o of pend) {
        const f = o.side === 'buy' ? buy(i, O[i], o.qty, o) : sell(i, O[i], o.fraction != null && st.pos ? sellQtyFor(st.pos, o.fraction) : o.qty, o);
        if (f && f.side === 'buy' && detect && o.actionIdx != null) postFillChecks(i, f, o);
      }
      const p = st.pos;
      if (p) {
        if (mods?.autopilot && mods.autopilot.phase === 'A' && mods.autopilot.bar === i && mods.autopilot.tradeId === p.tradeId) p.autopilot = true;
        out.stopLine[i] = p.stop;
        if (isNum(p.stop) && L[i] <= p.stop) {
          hit.stop = { price: Math.min(p.stop, O[i]), line: p.stop, trail: p.stop >= p.avgPrice };
        } else {
          spec.targets.forEach((t, k) => {
            const px = p.targetPx[k];
            if (!p.targetsDone[k] && isNum(px) && H[i] >= px) hit.targets.push({ k, price: Math.max(px, O[i]), line: px, fraction: t.fraction, qty: sellQtyFor(p, t.fraction) });
          });
        }
        if (mode === 'shadow' || p.autopilot) {
          if (hit.stop) sell(i, hit.stop.price, p.size, { reason: hit.stop.trail ? 'trail' : 'stop', auto: true });
          else for (const th of hit.targets) { if (!st.pos) break; sell(i, th.price, sellQtyFor(st.pos, th.fraction), { reason: 'target', auto: true }); markTarget(st.pos || p, th.k); }
        } else if (hit.stop || hit.targets.length) {
          // player must confirm; open obligations
          if (hit.stop) obligations.push({ type: 'stop', bar: i, deadline: i + disc.stopGraceBars, tradeId: p.tradeId, price: hit.stop.price, trail: hit.stop.trail, phase: 'A' });
          for (const th of hit.targets) {
            obligations.push({ type: 'target', bar: i, deadline: i + disc.stopGraceBars, tradeId: p.tradeId, k: th.k, need: th.qty, sold: 0, price: th.price, phase: 'A' });
            markTarget(p, th.k);
          }
        }
      }
      if (hit.stop || hit.targets.length) out.hits[i] = hit;
    }

    // Phase B — decision after close i
    let p = st.pos;
    if (p) {
      p.highestSinceEntry = Math.max(p.highestSinceEntry, H[i]);
      p.lowestSinceEntry = Math.min(p.lowestSinceEntry, L[i]);
      p.barsHeld = i - p.entryBar;
      if (p.riskPerShare > 0) p.maxCloseR = Math.max(p.maxCloseR, (Cl[i] - p.entryPrice) / p.riskPerShare);
      if (mods?.autopilot && mods.autopilot.phase === 'B' && mods.autopilot.bar === i && mods.autopilot.tradeId === p.tradeId) p.autopilot = true;
    }
    const acct = acctVars(i);
    const ev = ctx.evalCtx(i, p, acct);
    const adv = { bar: i, flat: !p, hit: (hit.stop || hit.targets.length) ? hit : null };
    const hasPendingBuy = st.pending.some(o => o.side === 'buy');
    if (!p) {
      const cooled = i - st.lastExit.bar > (spec.entry.cooldownBars || 0);
      adv.entrySignal = !hasPendingBuy && cooled && K.entry.test(ev);
      adv.suggest = suggestEntry(i);
      if (adv.entrySignal) { st.lastSignalBar = i; out.signals.push(i); }
    } else {
      adv.exitAll = null; adv.exitPart = null;
      spec.stops.forEach((s, k) => {
        const pl = STOPS[s.type];
        if (!p.active[k] && K.stopsAct[k]?.test(ev)) p.active[k] = true;
        if (!p.active[k]) return;
        if (pl.kind === 'close' && pl.check(ctx, posVars(ctx, p, i), i, s.params || {})) adv.exitAll = adv.exitAll || { reason: 'time_stop', type: s.type };
        if (s.type === 'ma_trailing' && (s.params?.trigger ?? 'close') === 'close') {
          const line = maLine(ctx, i, s.params || {});
          out.stopLine[i] = Math.max(isNum(out.stopLine[i]) ? out.stopLine[i] : -Infinity, line);
          if (Cl[i] < line) adv.exitAll = adv.exitAll || { reason: Cl[i] >= p.avgPrice ? 'trail' : 'stop', type: s.type, line };
        }
      });
      if (!adv.exitAll) {
        spec.exitSignals.forEach((x, k) => { if (!adv.exitPart && K.exits[k].test(ev)) adv.exitPart = { reason: 'exit_signal', fraction: x.fraction ?? 1, k, qty: sellQtyFor(p, x.fraction ?? 1) }; });
      }
      const pyr = spec.pyramiding;
      adv.addSignal = !!(pyr.enabled && p.adds < (pyr.maxAdds ?? 0) && K.pyramid?.test(ev));
      adv.addQty = adv.addSignal ? suggestAdd(i, p) : 0;
    }

    // Close-based obligations (actual mode)
    if (isActual && !mods && p && !p.autopilot && (adv.exitAll || adv.exitPart)) {
      const reason = adv.exitAll ? adv.exitAll.reason : 'exit_signal';
      const all = !!adv.exitAll || adv.exitPart.fraction >= 0.999;
      const code = reason === 'exit_signal' ? 'EXIT_SIGNAL_IGNORED' : reason === 'trail' ? 'TRAIL_IGNORED' : 'STOP_IGNORED';
      const open = obligations.some(o => !o.done && o.tradeId === p.tradeId && o.type === 'exit');
      if (!open && !p.violated[code] && !(all && p.violated._exitAll)) obligations.push({ type: 'exit', all, bar: i, deadline: i + disc.stopGraceBars, tradeId: p.tradeId, reason, trail: reason === 'trail', code, need: all ? undefined : sellQtyFor(p, adv.exitPart.fraction), sold: 0, phase: 'B' });
    }
    if (detect && !p && adv.entrySignal && adv.suggest.qty > 0) obligations.push({ type: 'entry', bar: i, deadline: i + disc.entryWindowBars, qty: adv.suggest.qty, phase: 'B' });

    // Actions
    const autoNow = mode === 'shadow' || (p && p.autopilot);
    if (autoNow) {
      if (!p && mode === 'shadow' && adv.entrySignal && adv.suggest.qty > 0) placeMarket(i, 'buy', adv.suggest.qty, { reason: 'signal', signalBar: i, auto: true, autopilot: true });
      else if (p) autoManage(i, p, adv, hit);
    }
    if (mods?.inject && mods.inject.bar === i && !p && !hasPendingBuy) {
      placeMarket(i, 'buy', mods.inject.qty, { reason: 'signal', signalBar: i, auto: true, autopilot: true });
    }
    if (mode !== 'shadow') {
      for (const a of byBar.get(i) || []) {
        const cur = st.pos;
        if (cur && cur.autopilot) continue;                 // counterfactual: rules own this trade
        if (st.pending.some(o => o.autopilot)) continue;
        applyPlayer(i, a, adv, hit);
      }
    }

    // Obligation deadlines (actual)
    if (detect) checkObligations(i);

    updateLines(i);
    p = st.pos;
    if (p) {
      out.avgLine[i] = p.avgPrice;
      if (!isNum(out.stopLine[i]) || p.stop > out.stopLine[i]) out.stopLine[i] = p.stop;   // line for bar i+1, drawn at i
      spec.targets.forEach((t, k) => { if (!p.targetsDone[k]) out.targetLines[k][i] = p.targetPx[k]; });
      if (spec.pyramiding.enabled && p.adds < (spec.pyramiding.maxAdds ?? 0)) {
        const m = /pos\.lastAddPrice\s*\+\s*([\d.]+)\s*\*\s*([A-Za-z_][\w.]*)/.exec(spec.pyramiding.trigger || '');
        if (m && S[m[2]]) out.addTrigger[i] = p.lastAddPrice + parseFloat(m[1]) * S[m[2]][i];
      }
    }
    adv.pos = p ? posVars(ctx, p, i) : null;
    adv.acct = acctVars(i);
    adv.pendingOrders = st.pending.map(o => ({ side: o.side, qty: o.qty, fraction: o.fraction }));
    adv.openObligations = obligations.filter(o => !o.done && o.bar <= i).map(o => ({ ...o }));
    out.advice[i] = adv;
    out.equity[i] = st.cash + (p ? p.size * Cl[i] : 0);
    out.cash[i] = st.cash;
  }

  // mark open trade at the final close
  if (st.pos) { st.pos.open = true; st.pos.exitBar = end; finalizeTrade(st.pos, Cl[end]); }
  out.trades = st.trades.map(t => ({
    id: t.tradeId, entryBar: t.entryBar, signalBar: t.signalBar, exitBar: t.exitBar, exitReason: t.exitReason, open: !!t.open,
    entryPrice: t.entryPrice, initialStop: t.initialStop, riskPerShare: t.riskPerShare, R0: t.R0, initialShares: t.initialShares,
    adds: t.adds, pnl: t.pnl, R: t.R, mae: t.mae, mfe: t.mfe, fills: t.fills, auto: t.autopilot,
  }));
  out.finalEquity = out.equity[end];
  out.obligations = obligations;
  out.position = st.pos ? posVars(ctx, st.pos, end) : null;
  out.lastAdvice = out.advice[end];
  return out;

  // ── helpers needing closure state ──
  function markTarget(p, k) {
    p.targetsDone[k] = true;
    const t = spec.targets[k];
    if (t.thenStop) p.extra.push({ ...t.thenStop, act: K.thenStopAct[k], active: !t.thenStop.activateWhen });
  }
  function autoManage(i, p, adv) {
    if (adv.exitAll) { placeMarket(i, 'sell', p.size, { reason: adv.exitAll.reason, auto: true, fraction: 1 }); return; }
    if (adv.exitPart) { placeMarket(i, 'sell', sellQtyFor(p, adv.exitPart.fraction), { reason: 'exit_signal', auto: true, fraction: adv.exitPart.fraction }); return; }
    if (adv.addSignal && adv.addQty > 0 && !st.pending.length) placeMarket(i, 'buy', adv.addQty, { reason: 'pyramid', auto: true, signalBar: i });
  }
  function applyPlayer(i, a, adv, hit) {
    const p = st.pos;
    const side = a.action === 'sell' ? 'sell' : 'buy';
    const info = { actionIdx: a.idx, reason: side === 'buy' ? (p ? 'add' : 'entry') : 'manual', signalBar: i };
    if (side === 'buy') {
      if (detect) preBuyChecks(i, a, adv, p);
      if (!p && st.pending.some(o => o.side === 'buy')) { placeMarket(i, 'buy', a.qty, info); return; }
      const r = placeMarket(i, 'buy', a.qty, info);
      if (r && r !== 'pending' && detect) postFillChecks(i, r, info);
      return;
    }
    if (!p) return;
    // sells: fraction-based in counterfactual replays so they scale with the position
    let qty = mods && actions[a.idx] && annotFraction(a.idx) != null ? sellQtyFor(p, annotFraction(a.idx)) : a.qty;
    const obl = obligations.filter(o => !o.done && o.tradeId === p.tradeId && o.bar <= i && o.type !== 'entry');
    const ruleWantsOut = obl.length || adv.exitAll || adv.exitPart || hit.stop || hit.targets.length || Cl[i] <= p.stop ||
      p.violated.STOP_IGNORED || p.violated.TRAIL_IGNORED || p.violated.EXIT_SIGNAL_IGNORED;
    if (detect && !ruleWantsOut && disc.allowDiscretionaryExit === false) {
      addViolation('EARLY_EXIT', i, { tradeId: p.tradeId, actionIdx: a.idx, required: '規則未觸發任何出場', did: `賣出 ${qty} 股`, fix: { type: 'autopilot', tradeId: p.tradeId, bar: i, phase: 'B' } });
    }
    if (a.kind === 'stop' && hit.stop) { sell(i, hit.stop.price, p.size >= qty ? qty : p.size, { ...info, reason: hit.stop.trail ? 'trail' : 'stop' }); creditSell(i, qty); return; }
    if (a.kind === 'target' && hit.targets.length) {
      hit._k = (hit._k || 0);
      const th = hit.targets[Math.min(hit._k++, hit.targets.length - 1)];
      sell(i, th.price, qty, { ...info, reason: 'target' }); creditSell(i, qty); return;
    }
    const reason = adv.exitAll?.reason || (adv.exitPart ? 'exit_signal' : obl[0]?.type === 'stop' ? (obl[0].trail ? 'trail' : 'stop') : 'manual');
    placeMarket(i, 'sell', qty, { ...info, reason, fraction: mods ? annotFraction(a.idx) : undefined });
    creditSell(i, qty);
  }
  function annotFraction(idx) { return mods?.fractions?.[idx]; }
  function creditSell(i, qty) {
    for (const o of obligations) {
      if (o.done || o.bar > i || o.type === 'entry') continue;
      if (o.need != null) { o.sold += qty; if (o.sold >= o.need * 0.999) o.done = true; }
    }
  }
  function preBuyChecks(i, a, adv, p) {
    if (!p) {
      const w = disc.entryWindowBars;
      const okSignal = st.lastSignalBar > st.lastExit.bar && i - st.lastSignalBar <= w;
      const sug = adv.suggest;
      if (!okSignal) {
        const revenge = (st.lastExit.reason === 'stop' || st.lastExit.reason === 'trail') && i - st.lastExit.bar <= 3;
        const code = revenge ? 'REVENGE' : 'NO_SIGNAL_ENTRY';
        addViolation(code, i, { actionIdx: a.idx, required: '無進場訊號，規則：不進場', did: `買進 ${a.qty} 股`, fix: { type: 'dropTrade', actionIdx: a.idx } });
      } else {
        for (const o of obligations) if (o.type === 'entry' && !o.done) o.done = true;
        sizeCheck(i, a, sug?.qty, '進場');
      }
      annot[a.idx].signalOk = okSignal;
      annot[a.idx].signalBar = okSignal ? st.lastSignalBar : null;
      return;
    }
    const pv = posVars(ctx, p, i);
    if (pv.unrealizedR < 0) {
      addViolation('AVERAGE_DOWN', i, { tradeId: p.tradeId, actionIdx: a.idx, required: '虧損中不加碼', did: `加碼 ${a.qty} 股（未實現 ${pv.unrealizedR.toFixed(2)}R）`, fix: { type: 'drop', actionIdx: a.idx } });
    } else if (!adv.addSignal) {
      const why = !spec.pyramiding.enabled ? '策略未啟用加碼' : p.adds >= (spec.pyramiding.maxAdds ?? 0) ? `已達加碼上限 ${spec.pyramiding.maxAdds} 次` : '加碼條件未成立';
      addViolation('ADD_OFF_RULE', i, { tradeId: p.tradeId, actionIdx: a.idx, required: why, did: `加碼 ${a.qty} 股`, fix: { type: 'drop', actionIdx: a.idx } });
    } else sizeCheck(i, a, adv.addQty, '加碼');
  }
  function sizeCheck(i, a, sug, label) {
    if (!(sug > 0)) return;
    const dev = (a.qty - sug) / sug * 100;
    if (Math.abs(dev) > disc.sizeTolerancePct) {
      addViolation(dev > 0 ? 'OVERSIZE' : 'UNDERSIZE', i, { actionIdx: a.idx, required: `${label}建議 ${sug} 股`, did: `${a.qty} 股（${dev > 0 ? '+' : ''}${dev.toFixed(0)}%）`, fix: { type: 'resize', actionIdx: a.idx, qty: sug } });
    }
  }
  function postFillChecks(i, f, o) {
    const p = st.pos;
    if (!p || o.actionIdx == null) return;
    const an = annot[o.actionIdx];
    if (f.kind === 'entry' && an.signalOk && ctx.defaultAtr) {
      const sb = an.signalBar, atr = S[ctx.defaultAtr][sb];
      const lim = Cl[sb] + disc.chaseAtr * atr;
      if (isNum(lim) && f.price > lim + 1e-9) addViolation('CHASE', i, { tradeId: p.tradeId, actionIdx: o.actionIdx, required: `成交價 ≤ ${lim.toFixed(2)}（訊號價 + ${disc.chaseAtr} ATR）`, did: `成交 ${f.price.toFixed(2)}`, fix: { type: 'dropTrade', actionIdx: o.actionIdx } });
    }
    const cap = f.kind === 'add' ? (spec.pyramiding.riskCap?.maxOpenRiskR ?? spec.sizing.caps?.maxOpenRiskR) : spec.sizing.caps?.maxOpenRiskR;
    const r = openRiskR(p);
    if (isNum(cap) && r > cap + 1e-6) {
      addViolation('RISK_CAP', i, { tradeId: p.tradeId, actionIdx: o.actionIdx, required: `未保護風險 ≤ ${cap}R`, did: `成交後 ${r.toFixed(2)}R`, fix: f.kind === 'add' ? { type: 'drop', actionIdx: o.actionIdx } : { type: 'resize', actionIdx: o.actionIdx, qty: suggestEntryQtyCache(o.actionIdx) } });
    }
  }
  function suggestEntryQtyCache(idx) { return out.advice[actions[idx].barIndex]?.suggest?.qty ?? actions[idx].qty; }
  function checkObligations(i) {
    const p = st.pos;
    for (const o of obligations) {
      if (o.done || o.deadline !== i) continue;
      if (o.type === 'entry') {
        const entered = (p && p.entryBar >= o.bar - 1) || st.pending.some(x => x.side === 'buy') || st.trades.some(t => t.signalBar >= o.bar && t.signalBar <= i);
        if (!entered) addViolation('MISSED_SIGNAL', o.bar, { required: `訊號成立：買進 ${o.qty} 股`, did: '未進場', fix: { type: 'inject', bar: o.bar, qty: o.qty } });
        o.done = true; continue;
      }
      const sameTradeOpen = p && p.tradeId === o.tradeId;
      const pendSell = st.pending.filter(x => x.side === 'sell').reduce((s, x) => s + x.qty, 0);
      if (!sameTradeOpen) { o.done = true; continue; }
      if (o.type === 'stop' || (o.type === 'exit' && o.all)) {
        if (pendSell >= p.size) { o.done = true; continue; }
        const tr = st.trades.find(t => t.tradeId === o.tradeId);
        const code = o.code || (o.trail ? 'TRAIL_IGNORED' : 'STOP_IGNORED');
        if (!tr.violated[code] && !tr.violated._exitAll) {
          tr.violated[code] = true; tr.violated._exitAll = true;
          addViolation(code, o.bar, { tradeId: o.tradeId, required: o.type === 'stop' ? `停損 ${o.price.toFixed(2)} 觸發：全部出場` : `出場條件成立（${o.reason}）：下一根開盤出場`, did: '仍持有', fix: { type: 'autopilot', tradeId: o.tradeId, bar: o.bar, phase: o.phase } });
        }
        o.done = true;
      } else {
        if (o.sold + pendSell >= o.need * 0.999) { o.done = true; continue; }
        const tr = st.trades.find(t => t.tradeId === o.tradeId);
        const code = o.type === 'target' ? 'TARGET_IGNORED' : 'EXIT_SIGNAL_IGNORED';
        const key = o.type === 'target' ? code + o.k : code;
        if (!tr.violated[key]) {
          tr.violated[key] = true;
          addViolation(code, o.bar, { tradeId: o.tradeId, required: o.type === 'target' ? `停利 ${o.price.toFixed(2)}：賣出 ${o.need} 股` : `出場訊號：賣出 ${o.need} 股`, did: `只賣 ${o.sold} 股`, fix: { type: 'autopilot', tradeId: o.tradeId, bar: o.bar, phase: o.phase } });
        }
        o.done = true;
      }
    }
  }
}
