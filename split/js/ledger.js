// ledger.js — pure bookkeeping logic for 旅遊分帳 (no DOM, no Firebase).
//
// All money is stored as integers in the currency's minor unit (TWD/JPY: 1,
// USD: cents) so splits never drift by floating-point error.
//
// Expense record (table.expenses[id]):
//   { kind: 'expense', amount, title, cat, ts, payer, among: [memberId],
//     custom?: { memberId: amount } }   // custom → unequal split, sums to amount
//   { kind: 'transfer', amount, ts, payer: fromId, to: toId }   // 還款紀錄

export const CURRENCIES = {
  TWD: { sym: 'NT$', dec: 0, label: '新台幣' },
  JPY: { sym: '¥',   dec: 0, label: '日圓' },
  KRW: { sym: '₩',   dec: 0, label: '韓元' },
  USD: { sym: 'US$', dec: 2, label: '美元' },
  EUR: { sym: '€',   dec: 2, label: '歐元' },
  HKD: { sym: 'HK$', dec: 2, label: '港幣' },
  THB: { sym: '฿',   dec: 2, label: '泰銖' },
  CNY: { sym: '¥',   dec: 2, label: '人民幣' },
};

export const CATEGORIES = [
  { id: 'food',     emoji: '🍜', label: '餐飲' },
  { id: 'traffic',  emoji: '🚕', label: '交通' },
  { id: 'stay',     emoji: '🏨', label: '住宿' },
  { id: 'ticket',   emoji: '🎟️', label: '門票' },
  { id: 'shop',     emoji: '🛍️', label: '購物' },
  { id: 'drink',    emoji: '🍺', label: '飲料' },
  { id: 'other',    emoji: '✨', label: '其他' },
];
export const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

export const cur = code => CURRENCIES[code] || CURRENCIES.TWD;

/** "1,234.5" → 123450 (minor units). Returns NaN for junk / negatives. */
export function toMinor(text, code) {
  const { dec } = cur(code);
  const s = String(text ?? '').replace(/[,\s]/g, '');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return NaN;
  return Math.round(parseFloat(s) * 10 ** dec);
}

/** minor → "1,234.50" (no symbol). */
export function fmtNum(minor, code) {
  const { dec } = cur(code);
  return (minor / 10 ** dec).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export const fmt = (minor, code) => `${cur(code).sym}${fmtNum(minor, code)}`;

// Small stable hash so the leftover minor units of an equal split rotate
// between members across expenses instead of always landing on the first one.
function hash(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** How much each member owes for one expense: { memberId: minor }. */
export function sharesOf(exp, id = '') {
  if (exp.kind === 'transfer') return {};
  if (exp.custom && Object.keys(exp.custom).length) return { ...exp.custom };
  const among = exp.among?.length ? exp.among : [exp.payer];
  const n = among.length;
  const base = Math.floor(exp.amount / n);
  let rem = exp.amount - base * n;
  const out = {};
  among.forEach(m => { out[m] = base; });
  const start = hash(id) % n;
  for (let i = 0; rem > 0; i++, rem--) out[among[(start + i) % n]] += 1;
  return out;
}

/* ── Multi-currency ──────────────────────────────────────────────
   Each expense carries its own `cur` (falls back to the table's main
   currency). Balances are kept per currency; to settle in one go the
   user enters rates (`table.rates[cur]` = main-currency units per 1 unit
   of `cur`) and everything is converted into the main currency. */
export const curOf = (e, t) => (e?.cur && CURRENCIES[e.cur] ? e.cur : (t.currency || 'TWD'));

/** Currencies used by the table, main currency first. */
export function usedCurrencies(t) {
  const set = new Set([t.currency || 'TWD']);
  Object.values(t.expenses || {}).forEach(e => { if (e && e.amount > 0) set.add(curOf(e, t)); });
  return [...set];
}
export function rateOf(t, c) {
  if (c === (t.currency || 'TWD')) return 1;
  const r = Number(t.rates?.[c]);
  return r > 0 && Number.isFinite(r) ? r : null;
}
/** minor units of `c` → minor units of the main currency (null if no rate). */
export function toBase(t, minor, c) {
  const r = rateOf(t, c);
  if (r == null) return null;
  return Math.round(minor / 10 ** cur(c).dec * r * 10 ** cur(t.currency).dec);
}

const zero = () => ({ paid: 0, share: 0, sent: 0, recv: 0, net: 0 });

/** Per-member totals in one currency. net > 0 → others owe them; net < 0 → they owe. */
export function balances(table, c = table.currency || 'TWD') {
  const res = {};
  (table.members || []).forEach(m => { res[m.id] = zero(); });
  const get = id => (res[id] ||= zero());
  Object.entries(table.expenses || {}).forEach(([id, e]) => {
    if (!e || !(e.amount > 0) || curOf(e, table) !== c) return;
    if (e.kind === 'transfer') {
      get(e.payer).sent += e.amount;
      get(e.to).recv += e.amount;
      return;
    }
    get(e.payer).paid += e.amount;
    Object.entries(sharesOf(e, id)).forEach(([m, v]) => { get(m).share += v; });
  });
  Object.values(res).forEach(r => { r.net = r.paid - r.share + r.sent - r.recv; });
  return res;
}

/** { cur: balances } for every used currency. */
export function balancesByCur(table) {
  return Object.fromEntries(usedCurrencies(table).map(c => [c, balances(table, c)]));
}

/** Everything converted into the main currency with the table's rates.
    Currencies without a rate are listed in `missing` and left out.
    Rounding residue is pushed onto the largest balance so nets sum to 0. */
export function combined(table) {
  const by = balancesByCur(table);
  const missing = [];
  const bal = {};
  (table.members || []).forEach(m => { bal[m.id] = zero(); });
  Object.entries(by).forEach(([c, b]) => {
    if (rateOf(table, c) == null) { missing.push(c); return; }
    Object.entries(b).forEach(([m, r]) => {
      const o = (bal[m] ||= zero());
      ['paid', 'share', 'sent', 'recv', 'net'].forEach(k => { o[k] += toBase(table, r[k], c); });
    });
  });
  const ids = Object.keys(bal);
  const residue = ids.reduce((s, m) => s + bal[m].net, 0);
  if (residue && ids.length) {
    const top = ids.slice().sort((a, b) => Math.abs(bal[b].net) - Math.abs(bal[a].net) || (a < b ? -1 : 1))[0];
    bal[top].net -= residue;
  }
  return { bal, missing, complete: !missing.length, by };
}

/** Greedy settle-up: biggest debtor pays biggest creditor until all zero.
    Gives at most n-1 transfers. Returns [{ from, to, amount }]. */
export function settle(bal) {
  const cred = [], debt = [];
  Object.entries(bal).forEach(([id, b]) => {
    if (b.net > 0) cred.push({ id, v: b.net });
    else if (b.net < 0) debt.push({ id, v: -b.net });
  });
  const out = [];
  const byV = (a, b) => b.v - a.v || (a.id < b.id ? -1 : 1);
  while (cred.length && debt.length) {
    cred.sort(byV); debt.sort(byV);
    const c = cred[0], d = debt[0];
    const x = Math.min(c.v, d.v);
    out.push({ from: d.id, to: c.id, amount: x });
    c.v -= x; d.v -= x;
    if (!c.v) cred.shift();
    if (!d.v) debt.shift();
  }
  return out;
}

/** Totals for the summary tab. `totals` is per currency; `total`, `byCat`
    and `byDay` are in the main currency (currencies in `missing` excluded). */
export function stats(table) {
  const exps = Object.entries(table.expenses || {})
    .filter(([, e]) => e && e.kind !== 'transfer' && e.amount > 0);
  const totals = {}, byCat = {}, byDay = {}, missing = new Set();
  let total = 0;
  exps.forEach(([, e]) => {
    const c = curOf(e, table);
    totals[c] = (totals[c] || 0) + e.amount;
    const v = toBase(table, e.amount, c);
    if (v == null) { missing.add(c); return; }
    total += v;
    byCat[e.cat || 'other'] = (byCat[e.cat || 'other'] || 0) + v;
    const d = dayKey(e.ts, e.tz);
    byDay[d] = (byDay[d] || 0) + v;
  });
  return { total, totals, count: exps.length, byCat, byDay, missing: [...missing] };
}

/* ── Time zones ──────────────────────────────────────────────────
   Each expense stores the IANA zone it was recorded in (`tz`). Times and
   day grouping are shown in that zone, so a Tokyo dinner stays on the
   Tokyo date even when viewed from Taipei. */
export const deviceTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};
export function validTz(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
const safeTz = tz => (validTz(tz) ? tz : deviceTz());
const _fmtCache = new Map();
function partsIn(ts, tz) {
  tz = safeTz(tz);
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    _fmtCache.set(tz, f);
  }
  const o = {};
  const d = new Date(ts);
  f.formatToParts(Number.isFinite(d.getTime()) ? d : new Date(0)).forEach(p => { o[p.type] = p.value; });
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
/** Minutes east of UTC for `tz` at instant `ts` (Asia/Taipei → 480). */
export function tzOffsetMin(ts, tz) {
  const p = partsIn(ts, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000) / 60000);
}
/** "2026-11-11T19:30" wall-clock in `tz` → epoch ms. */
export function wallToTs(wall, tz) {
  const m = String(wall).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  let ts = guess - tzOffsetMin(guess, tz) * 60000;
  ts = guess - tzOffsetMin(ts, tz) * 60000;      // second pass settles DST edges
  return ts;
}
const p2 = n => String(n).padStart(2, '0');
/** epoch ms → "2026-11-11T19:30" wall-clock in `tz` (for <input type=datetime-local>). */
export function tsToWall(ts, tz) {
  const p = partsIn(ts, tz);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}`;
}
export function dayKey(ts, tz) {
  const p = partsIn(ts, tz);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}
export function hhmm(ts, tz) { const p = partsIn(ts, tz); return `${p2(p.h)}:${p2(p.mi)}`; }
export function gmtLabel(ts, tz) {
  const o = tzOffsetMin(ts, tz), sign = o < 0 ? '−' : '+', a = Math.abs(o);
  return `GMT${sign}${Math.floor(a / 60)}${a % 60 ? ':' + p2(a % 60) : ''}`;
}

// Friendly names for zones a Taiwan-based traveller is likely to pick.
export const COMMON_TZ = [
  ['Asia/Taipei', '台北'], ['Asia/Tokyo', '東京'], ['Asia/Seoul', '首爾'], ['Asia/Hong_Kong', '香港'],
  ['Asia/Shanghai', '上海'], ['Asia/Bangkok', '曼谷'], ['Asia/Ho_Chi_Minh', '胡志明市'], ['Asia/Singapore', '新加坡'],
  ['Asia/Kuala_Lumpur', '吉隆坡'], ['Asia/Manila', '馬尼拉'], ['Asia/Dubai', '杜拜'], ['Australia/Sydney', '雪梨'],
  ['Pacific/Auckland', '奧克蘭'], ['Europe/London', '倫敦'], ['Europe/Paris', '巴黎'], ['Europe/Berlin', '柏林'],
  ['Europe/Rome', '羅馬'], ['Europe/Istanbul', '伊斯坦堡'], ['America/New_York', '紐約'], ['America/Chicago', '芝加哥'],
  ['America/Los_Angeles', '洛杉磯'], ['America/Vancouver', '溫哥華'], ['Pacific/Honolulu', '夏威夷'],
];
export function tzName(tz) {
  return COMMON_TZ.find(([z]) => z === tz)?.[1] || String(tz).split('/').pop().replace(/_/g, ' ');
}
export function allTimeZones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return COMMON_TZ.map(([z]) => z); }
}
