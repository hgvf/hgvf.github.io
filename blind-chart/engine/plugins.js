// plugins.js — Stop / Target / Sizing / PyramidSize plugin registries (SDD 4.4–4.7).
// Each plugin is pure: given the rule-state snapshot it returns a number.
import { roundLot, isNum } from './util.js';

const atrAt = (ctx, id, bar) => {
  const s = ctx.series[id || ctx.defaultAtr];
  return s ? s[bar] : NaN;
};

// ─── Stops ─────────────────────────────────────────────────────────────────
// kind:
//   'initial'  → computed once at fill (fillPrice, signal-bar data); fixed
//   'trailing' → recomputed every close; effective stop only ratchets up
//   'close'    → not an intraday line: checked at the close, exit next open
// line(ctx, pos, i, p) returns the candidate stop for bar i+1 (NaN = none).
export const STOPS = {};
export function registerStop(p) { STOPS[p.type] = p; }

registerStop({
  type: 'atr_initial', label: '初始 ATR 停損', kind: 'initial',
  paramsSchema: { type: 'object', properties: { atrId: { type: 'string' }, k: { type: 'number', default: 2 } } },
  initial: (ctx, entry, sigBar, p) => entry - (p.k ?? 2) * atrAt(ctx, p.atrId, sigBar),
});
registerStop({
  type: 'pct_initial', label: '初始 % 停損', kind: 'initial',
  paramsSchema: { type: 'object', properties: { p: { type: 'number', default: 0.08 } } },
  initial: (ctx, entry, sigBar, p) => entry * (1 - (p.p ?? 0.08)),
});
registerStop({
  type: 'structure', label: '結構停損（swing low − buffer）', kind: 'initial',
  paramsSchema: { type: 'object', properties: { swingId: { type: 'string' }, bufferAtr: { type: 'number', default: 0 }, bufferPct: { type: 'number', default: 0 }, atrId: { type: 'string' }, trail: { type: 'boolean', default: false } } },
  initial: (ctx, entry, sigBar, p) => structLine(ctx, sigBar, p),
  line: (ctx, pos, i, p) => (p.trail ? structLine(ctx, i, p) : NaN),
});
function structLine(ctx, i, p) {
  const s = ctx.series[`${p.swingId}.low`];
  if (!s) return NaN;
  let v = s[i];
  if (p.bufferAtr) v -= p.bufferAtr * atrAt(ctx, p.atrId, i);
  if (p.bufferPct) v *= 1 - p.bufferPct;
  return v;
}
registerStop({
  type: 'atr_trailing', label: 'ATR 移動停損', kind: 'trailing',
  paramsSchema: { type: 'object', properties: { atrId: { type: 'string' }, k: { type: 'number', default: 3 } } },
  line: (ctx, pos, i, p) => ctx.series.close[i] - (p.k ?? 3) * atrAt(ctx, p.atrId, i),
});
registerStop({
  type: 'chandelier', label: 'Chandelier 吊燈停損', kind: 'trailing',
  paramsSchema: { type: 'object', properties: { atrId: { type: 'string' }, k: { type: 'number', default: 3 } } },
  line: (ctx, pos, i, p) => pos.highestSinceEntry - (p.k ?? 3) * atrAt(ctx, p.atrId, i),
});
registerStop({
  type: 'ma_trailing', label: '均線移動停損', kind: 'trailing',
  paramsSchema: { type: 'object', properties: { maId: { type: 'string' }, bufferPct: { type: 'number', default: 0 }, bufferAtr: { type: 'number', default: 0 }, atrId: { type: 'string' }, trigger: { type: 'string', enum: ['close', 'low'], default: 'close' } } },
  line: (ctx, pos, i, p) => maLine(ctx, i, p),
});
export function maLine(ctx, i, p) {
  const s = ctx.series[p.maId];
  if (!s) return NaN;
  let v = s[i];
  if (p.bufferPct) v *= 1 - p.bufferPct;
  if (p.bufferAtr) v -= p.bufferAtr * atrAt(ctx, p.atrId, i);
  return v;
}
registerStop({
  type: 'donchian_trailing', label: 'N 日低點停損', kind: 'trailing',
  paramsSchema: { type: 'object', properties: { length: { type: 'integer', default: 10 } } },
  line: (ctx, pos, i, p) => {
    const L = p.length ?? 10, low = ctx.series.low;
    if (i - L + 1 < 0) return NaN;
    let m = Infinity; for (let k = 0; k < L; k++) m = Math.min(m, low[i - k]);
    return m;
  },
});
registerStop({
  type: 'breakeven', label: '保本停損', kind: 'trailing',
  paramsSchema: { type: 'object', properties: { atR: { type: 'number', default: 1 }, offsetR: { type: 'number', default: 0 }, offsetPct: { type: 'number', default: 0 } } },
  // Sticky trigger: once unrealized R (on the close) reached atR, the line stays.
  line: (ctx, pos, i, p) => {
    if (!(pos.maxCloseR >= (p.atR ?? 1))) return NaN;
    return pos.avgPrice + (p.offsetR ?? 0) * pos.riskPerShare + pos.avgPrice * (p.offsetPct ?? 0);
  },
});
registerStop({
  type: 'step_r', label: '階梯 R 停損', kind: 'trailing',
  paramsSchema: { type: 'object', properties: { stepR: { type: 'number', default: 1 }, moveR: { type: 'number', default: 1 } } },
  line: (ctx, pos, i, p) => {
    const steps = Math.floor((pos.maxCloseR || 0) / (p.stepR ?? 1));
    return steps >= 1 ? pos.initialStop + steps * (p.moveR ?? 1) * pos.riskPerShare : NaN;
  },
});
registerStop({
  type: 'time_stop', label: '時間停損', kind: 'close',
  paramsSchema: { type: 'object', properties: { bars: { type: 'integer', default: 20 }, minR: { type: 'number', default: 0.5 } } },
  check: (ctx, pos, i, p) => pos.barsHeld >= (p.bars ?? 20) && pos.unrealizedR < (p.minR ?? 0.5),
});

// ─── Targets: price at which a fraction is taken (intraday high ≥ price) ───
export function targetPrice(ctx, pos, i, t, compiled) {
  const at = t.at || {};
  if (isNum(at.r)) return pos.entryPrice + at.r * pos.riskPerShare;
  if (isNum(at.atr)) return pos.entryPrice + at.atr * atrAt(ctx, at.atrId, pos.signalBar);
  if (at.expr && compiled) return compiled.eval(ctx.evalCtx(i, pos));
  return NaN;
}

// ─── Sizing ────────────────────────────────────────────────────────────────
// qty(input) where input = { equity, cash, price, stop, atr, p }
export const SIZING = {};
export function registerSizing(p) { SIZING[p.method] = p; }
const dist = x => Math.max(x.price - x.stop, 1e-9);
registerSizing({ method: 'max_loss_amount', label: '固定最大虧損金額', paramsSchema: { type: 'object', properties: { amount: { type: 'number', default: 10000 } } }, qty: x => x.p.amount / dist(x) });
registerSizing({ method: 'risk_percent', label: '帳戶 % 風險', paramsSchema: { type: 'object', properties: { pct: { type: 'number', default: 0.01 } } }, qty: x => x.equity * x.p.pct / dist(x) });
registerSizing({ method: 'total_cost', label: '固定總成本', paramsSchema: { type: 'object', properties: { cost: { type: 'number', default: 100000 } } }, qty: x => x.p.cost / x.price });
registerSizing({ method: 'percent_equity', label: '帳戶 % 部位', paramsSchema: { type: 'object', properties: { pct: { type: 'number', default: 0.2 } } }, qty: x => x.equity * x.p.pct / x.price });
registerSizing({ method: 'fixed_shares', label: '固定股數', paramsSchema: { type: 'object', properties: { shares: { type: 'number', default: 1000 } } }, qty: x => x.p.shares });
registerSizing({ method: 'vol_target', label: '波動度目標', paramsSchema: { type: 'object', properties: { targetVolPct: { type: 'number', default: 0.01 }, atrId: { type: 'string' } } }, qty: x => x.equity * x.p.targetVolPct / Math.max(x.atr, 1e-9) });

/** Suggested entry size with caps & lot rounding. Returns { qty, riskPerShare, R }
    caps: maxPositionPct（單筆市值上限）、maxRiskPct（每筆最多賠帳戶幾 %）、cashOnly、maxOpenRiskR */
export function sizeEntry(spec, x, lot) {
  const s = spec.sizing || {};
  const plugin = SIZING[s.method] || SIZING.max_loss_amount;
  let q = plugin.qty({ ...x, p: { ...s, amount: s.amount ?? 10000 } });
  const caps = s.caps || {};
  if (isNum(caps.maxPositionPct)) q = Math.min(q, x.equity * caps.maxPositionPct / x.price);
  if (isNum(caps.maxRiskPct)) q = Math.min(q, x.equity * caps.maxRiskPct / dist(x));   // 每筆最多賠（開始頁設定）
  if (caps.cashOnly !== false) q = Math.min(q, x.cash / x.price);
  if (isNum(caps.maxOpenRiskR) && s.method === 'max_loss_amount' && isNum(s.amount)) {
    q = Math.min(q, caps.maxOpenRiskR * s.amount / dist(x));
  }
  q = roundLot(q, lot);
  return { qty: q, riskPerShare: x.price - x.stop, R: q * (x.price - x.stop) };
}

// ─── Pyramid add size ──────────────────────────────────────────────────────
export const PYRAMID_SIZE = {
  fraction_of_initial: (pos, v) => pos.initialShares * (v ?? 0.5),
  pyramid_decreasing: (pos, v) => pos.initialShares * Math.pow(v ?? 0.5, pos.adds),
  risk_based: (pos, v, price, stop) => (v ?? 0.5) * pos.R0 / Math.max(price - stop, 1e-9),
};

/** 開始頁的「每筆最多賠」：把它套到策略的部位規則。
    依風險決定股數的方法（risk_percent / max_loss_amount）直接改成這個風險；
    其他方法（固定比例、波動度…）保留原算法，再加上「每筆最多賠」上限。 */
export function applyRiskLimit(spec, pct, equity) {
  if (!(pct > 0)) return spec;
  const s = spec.sizing = { method: 'max_loss_amount', amount: 10000, ...(spec.sizing || {}) };
  s.caps = { ...(s.caps || {}), maxRiskPct: pct };
  if (s.method === 'risk_percent') s.pct = pct;
  else if (s.method === 'max_loss_amount') s.amount = Math.round(equity * pct);
  return spec;
}
