// util.js — tiny shared helpers (no DOM, no Node APIs: runs in browser and Node).

export const NaNArr = n => new Float64Array(n).fill(NaN);
export const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Deterministic PRNG (mulberry32). Same seed → same stream in every runtime. */
export function rng(seed) {
  let a = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

export function median(arr) {
  const a = Array.from(arr).filter(isNum).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Round a share count down to the lot size (never up: SDD 4.4 "無條件捨去"). */
export function roundLot(qty, lot = 1) {
  if (!isNum(qty) || qty <= 0) return 0;
  lot = lot > 0 ? lot : 1;
  return Math.floor(qty / lot + 1e-9) * lot;
}

/** Light obfuscation for answers (XOR + base64). NOT a security mechanism. */
const KEY = 'hgvf-blind';
export function obfuscate(obj, key = KEY) {
  const s = unescape(encodeURIComponent(JSON.stringify(obj)));
  let out = '';
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return b64enc(out);
}
export function deobfuscate(str, key = KEY) {
  const s = b64dec(str);
  let out = '';
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return JSON.parse(decodeURIComponent(escape(out)));
}
const b64enc = s => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'));
const b64dec = s => (typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'));
