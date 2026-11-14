// spec.js — Strategy Spec defaults, JSON Schema and validation (SDD 4.x).
import { INDICATORS, indicatorOutputs, withDefaults } from './indicators.js';
import { STOPS, SIZING, PYRAMID_SIZE } from './plugins.js';
import { compile, ExprError } from './expr.js';
import { deepClone } from './util.js';
import { BASE_FIELDS } from './bars.js';

export const DEFAULT_DISCIPLINE = {
  entryWindowBars: 1, chaseAtr: 0.5, sizeTolerancePct: 10, stopGraceBars: 0,
  allowDiscretionaryExit: true, scoreMissedSignal: true, weights: {},
};

export function normalizeSpec(input) {
  const s = deepClone(input) || {};
  s.direction = s.direction || 'long';
  s.account = { initialEquity: 1000000, lotSize: { TW: 1000, US: 1, JP: 100, KR: 1 }, ...(s.account || {}) };
  s.indicators = (s.indicators || []).map(ind => ({ ...ind, params: withDefaults(INDICATORS[ind.type]?.paramsSchema, ind.params || {}) }));
  s.entry = { cooldownBars: 0, ...(s.entry || {}) };
  s.sizing = { method: 'max_loss_amount', amount: 10000, ...(s.sizing || {}) };
  s.sizing.caps = { cashOnly: true, ...(s.sizing.caps || {}) };
  s.stops = s.stops || [];
  s.targets = s.targets || [];
  s.exitSignals = s.exitSignals || [];
  s.pyramiding = { enabled: false, maxAdds: 0, ...(s.pyramiding || {}) };
  s.discipline = { ...DEFAULT_DISCIPLINE, ...(s.discipline || {}) };
  s.fill = { mode: 'next_open', ...(s.fill || {}) };
  s.costModel = s.costModel || { type: 'none' };
  // 策略變數：條件式裡的 $name 換成 vars.name 的數值（讓門檻可以用旋鈕調整）
  s.vars = { ...(s.vars || {}) };
  const sub = str => (typeof str === 'string' ? substituteVars(str, s.vars) : str);
  s.entry.signal = sub(s.entry.signal);
  s.exitSignals = s.exitSignals.map(x => ({ ...x, expr: sub(x.expr) }));
  s.stops = s.stops.map(x => (x.activateWhen ? { ...x, activateWhen: sub(x.activateWhen) } : x));
  s.targets = s.targets.map(t => ({
    ...t,
    at: t.at?.expr ? { ...t.at, expr: sub(t.at.expr) } : t.at,
    thenStop: t.thenStop?.activateWhen ? { ...t.thenStop, activateWhen: sub(t.thenStop.activateWhen) } : t.thenStop,
  }));
  if (s.pyramiding.trigger) s.pyramiding.trigger = sub(s.pyramiding.trigger);
  return s;
}

/** Replace $name with vars[name]; unknown names are left as-is (validateSpec reports them). */
export function substituteVars(str, vars = {}) {
  return str.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) && Number.isFinite(+vars[k]) ? String(+vars[k]) : m));
}

// ─── Knobs（快速調整旋鈕）的路徑 ───
//   ind:<指標 id>.<參數>     例 ind:dc20.length
//   stop:<停損類型>.<參數>   例 stop:atr_initial.k（第一個該類型的停損）
//   其他用點分路徑，陣列用索引  例 targets.0.at.r、sizing.caps.maxPositionPct、vars.rsiTh
function knobTarget(spec, path, create) {
  let m = /^ind:([^.]+)\.(.+)$/.exec(path);
  if (m) {
    const ind = (spec.indicators || []).find(x => x.id === m[1]);
    if (!ind) return null;
    if (create) ind.params = ind.params || {};
    return ind.params ? [ind.params, m[2], ind] : null;
  }
  m = /^stop:([^.]+)\.(.+)$/.exec(path);
  if (m) {
    const st = (spec.stops || []).find(x => x.type === m[1]);
    if (!st) return null;
    if (create) st.params = st.params || {};
    return st.params ? [st.params, m[2], st] : null;
  }
  const ks = path.split('.');
  let cur = spec;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] == null) { if (!create) return null; cur[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; }
    cur = cur[ks[i]];
  }
  return [cur, ks[ks.length - 1]];
}
/** Current value of a knob (falls back to the plugin default for indicator params). */
export function getKnob(spec, path) {
  const t = knobTarget(spec, path, false);
  if (!t) return undefined;
  const v = t[0][t[1]];
  if (v !== undefined) return v;
  if (t[2]?.type && INDICATORS[t[2].type]) return INDICATORS[t[2].type].paramsSchema.properties?.[t[1]]?.default;
  if (t[2]?.type && STOPS[t[2].type]) return STOPS[t[2].type].paramsSchema.properties?.[t[1]]?.default;
  return undefined;
}
export function setKnob(spec, path, value) {
  const t = knobTarget(spec, path, true);
  if (!t) return false;
  t[0][t[1]] = value;
  return true;
}

/** Series names a spec can reference in expressions. */
export function knownSeries(spec, extraFields = []) {
  const set = new Set([...BASE_FIELDS, 'benchmark', ...extraFields]);
  for (const ind of spec.indicators || []) indicatorOutputs(ind).forEach(n => set.add(n));
  return set;
}

/** Validate; returns [{ path, message, pos? }]. Empty array = valid. */
export function validateSpec(raw) {
  const errs = [];
  const E = (path, message, pos) => errs.push({ path, message, pos });
  if (!raw || typeof raw !== 'object') return [{ path: '', message: 'Spec 必須是 JSON 物件' }];
  if (!raw.id || typeof raw.id !== 'string') E('id', '需要字串 id');
  if (raw.direction && !['long', 'short'].includes(raw.direction)) E('direction', 'direction 只能是 long 或 short');
  if (raw.direction === 'short') E('direction', 'v1 只支援 long（short 已保留在 schema）');
  const s = normalizeSpec(raw);
  const ids = new Set();
  s.indicators.forEach((ind, i) => {
    if (!ind.id) E(`indicators[${i}].id`, '指標需要 id');
    else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ind.id)) E(`indicators[${i}].id`, 'id 只能用英數與底線，且不能以數字開頭');
    if (ids.has(ind.id)) E(`indicators[${i}].id`, `重複的指標 id：${ind.id}`);
    ids.add(ind.id);
    const p = INDICATORS[ind.type];
    if (!p) { E(`indicators[${i}].type`, `未知的指標類型：${ind.type}（可用：${Object.keys(INDICATORS).join(', ')}）`); return; }
    for (const [k, sch] of Object.entries(p.paramsSchema.properties || {})) {
      const v = ind.params[k];
      if (v === undefined) continue;
      if ((sch.type === 'integer' && !Number.isInteger(v)) || (sch.type === 'number' && typeof v !== 'number')) E(`indicators[${i}].params.${k}`, `${k} 必須是${sch.type === 'integer' ? '整數' : '數字'}`);
      else if (sch.enum && !sch.enum.includes(v)) E(`indicators[${i}].params.${k}`, `${k} 只能是 ${sch.enum.join(' / ')}`);
      else if (typeof v === 'number' && ((sch.minimum != null && v < sch.minimum) || (sch.maximum != null && v > sch.maximum))) E(`indicators[${i}].params.${k}`, `${k} 超出範圍 ${sch.minimum}–${sch.maximum}`);
    }
  });
  const known = knownSeries(s);
  for (const [k, v] of Object.entries(raw.vars || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) E(`vars.${k}`, '變數名稱只能用英數與底線');
    else if (!Number.isFinite(+v) || v === '' || v === null) E(`vars.${k}`, `變數 $${k} 必須是數字`);
  }
  const ex = (path, src) => {
    const un = /\$([A-Za-z_][A-Za-z0-9_]*)/.exec(src || '');
    if (un) { E(path, `未定義的策略變數 $${un[1]}（在 vars 裡新增）`, un.index); return; }
    try { compile(src, known); } catch (e) { E(path, e.message, e instanceof ExprError ? e.pos : undefined); }
  };
  if (!s.entry.signal) E('entry.signal', '需要進場條件式'); else ex('entry.signal', s.entry.signal);
  if (!SIZING[s.sizing.method]) E('sizing.method', `未知的 sizing.method：${s.sizing.method}`);
  const atrIds = s.indicators.filter(x => x.type === 'atr').map(x => x.id);
  let hasInitial = false;
  s.stops.forEach((st, i) => {
    const p = STOPS[st.type];
    if (!p) { E(`stops[${i}].type`, `未知的停損類型：${st.type}`); return; }
    if (p.kind === 'initial') hasInitial = true;
    const prm = st.params || {};
    if ('atrId' in (p.paramsSchema.properties || {}) && prm.atrId && !atrIds.includes(prm.atrId)) E(`stops[${i}].params.atrId`, `找不到 ATR 指標：${prm.atrId}`);
    if (st.type === 'ma_trailing' && !known.has(prm.maId)) E(`stops[${i}].params.maId`, `找不到均線：${prm.maId}`);
    if (st.type === 'structure' && !ids.has(prm.swingId)) E(`stops[${i}].params.swingId`, `找不到 swing 指標：${prm.swingId}`);
    if (st.activateWhen) ex(`stops[${i}].activateWhen`, st.activateWhen);
  });
  if (!hasInitial) E('stops', '至少需要一個初始停損（atr_initial / pct_initial / structure），R 才有定義');
  if ((s.stops.some(st => /atr/.test(st.type) || st.type === 'chandelier') || s.sizing.method === 'vol_target') && !atrIds.length) E('indicators', '用到 ATR 的規則需要先定義一個 atr 指標');
  s.targets.forEach((t, i) => {
    if (!t.at) E(`targets[${i}].at`, '需要 at：{r} / {atr} / {expr}');
    else if (t.at.expr) ex(`targets[${i}].at.expr`, t.at.expr);
    if (!(t.fraction > 0 && t.fraction <= 1)) E(`targets[${i}].fraction`, 'fraction 需在 (0, 1]');
    if (t.thenStop && !STOPS[t.thenStop.type]) E(`targets[${i}].thenStop.type`, `未知的停損類型：${t.thenStop.type}`);
  });
  s.exitSignals.forEach((x, i) => { if (!x.expr) E(`exitSignals[${i}].expr`, '需要 expr'); else ex(`exitSignals[${i}].expr`, x.expr); });
  if (s.pyramiding.enabled) {
    if (!s.pyramiding.trigger) E('pyramiding.trigger', '啟用加碼需要 trigger'); else ex('pyramiding.trigger', s.pyramiding.trigger);
    const mode = s.pyramiding.size?.mode || 'fraction_of_initial';
    if (!PYRAMID_SIZE[mode]) E('pyramiding.size.mode', `未知的加碼模式：${mode}`);
  }
  if (!['next_open', 'this_close'].includes(s.fill.mode)) E('fill.mode', 'fill.mode 只能是 next_open / this_close');
  return errs;
}

/** JSON Schema (draft-07) — documentation & editor hints. validateSpec() is the source of truth. */
export function specJsonSchema() {
  const exprStr = { type: 'string', description: '條件式（見 SDD 4.3）' };
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Strategy Spec', type: 'object', required: ['id', 'entry', 'stops'],
    properties: {
      id: { type: 'string' }, name: { type: 'string' },
      direction: { enum: ['long', 'short'] },
      account: { type: 'object', properties: { initialEquity: { type: 'number' }, lotSize: { type: 'object' } } },
      indicators: { type: 'array', items: { type: 'object', required: ['id', 'type'], properties: { id: { type: 'string' }, type: { enum: Object.keys(INDICATORS) }, params: { type: 'object' } } } },
      entry: { type: 'object', required: ['signal'], properties: { signal: exprStr, cooldownBars: { type: 'integer' } } },
      sizing: { type: 'object', properties: { method: { enum: Object.keys(SIZING) }, caps: { type: 'object' } } },
      stops: { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { enum: Object.keys(STOPS) }, params: { type: 'object' }, activateWhen: exprStr } } },
      targets: { type: 'array', items: { type: 'object', properties: { at: { type: 'object' }, fraction: { type: 'number' }, thenStop: { type: 'object' } } } },
      exitSignals: { type: 'array', items: { type: 'object', properties: { expr: exprStr, fraction: { type: 'number' } } } },
      pyramiding: { type: 'object' },
      discipline: { type: 'object' },
      fill: { type: 'object', properties: { mode: { enum: ['next_open', 'this_close'] } } },
      costModel: { type: 'object' },
    },
  };
}
