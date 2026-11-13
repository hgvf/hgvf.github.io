// bank.js — where puzzles come from.
//   1. ./puzzles/index.json          (if the site ever switches to deploy-pages, SDD 5.6)
//   2. orphan branch blind-chart-puzzles via raw.githubusercontent.com (current setup)
//   3. synthetic demo bank (engine/synthetic.js) — when nothing is published yet
import { syntheticPuzzle, deobfuscate } from '../engine/index.js';

export const SOURCES = [
  './puzzles/',
  'https://raw.githubusercontent.com/hgvf/hgvf.github.io/blind-chart-puzzles/',
];
let state = null;

export async function loadBank() {
  if (state) return state;
  for (const base of SOURCES) {
    try {
      const r = await fetch(base + 'index.json', { cache: 'no-cache' });
      if (!r.ok) continue;
      const idx = await r.json();
      if (!idx?.puzzles?.length) continue;
      state = { base, demo: false, index: idx.puzzles, seed: idx.seed, presets: idx.presets };
      return state;
    } catch { /* try next */ }
  }
  const markets = ['TW', 'US', 'JP', 'KR'];
  const index = Array.from({ length: 400 }, (_, i) => ({ id: `demo-${i + 1}`, market: markets[i % 4], regime: '?', playBars: 250, pool: 'random', signals: {} }));
  state = { base: null, demo: true, index };
  return state;
}

const cache = new Map();
export async function getPuzzle(id, opts = {}) {
  if (cache.has(id)) return cache.get(id);
  let pz;
  if (id.startsWith('demo-')) {
    const n = parseInt(id.slice(5), 10);
    const m = ['TW', 'US', 'JP', 'KR'][(n - 1) % 4];
    pz = syntheticPuzzle(n, { market: m, lotSize: { TW: 1000, US: 1, JP: 100, KR: 1 }[m], playBars: opts.playBars || 250 });
    pz.id = id;
  } else {
    const b = await loadBank();
    const r = await fetch(`${b.base}puzzles/${id}.json`);
    if (!r.ok) throw new Error(`題目載入失敗：${id}`);
    pz = await r.json();
  }
  cache.set(id, pz);
  return pz;
}

export async function getAnswer(pz) {
  if (pz.answer) return deobfuscate(pz.answer);
  const b = await loadBank();
  const r = await fetch(`${b.base}answers/${pz.answerRef}.json`);
  if (!r.ok) throw new Error('答案載入失敗');
  return deobfuscate((await r.json()).a);
}

/** Pick a puzzle id for the chosen market / preset / length, avoiding ones already played. */
export function pickPuzzle(bank, { market, presetId, playBars, played = new Set(), minSignals = 3, rnd = Math.random }) {
  let pool = bank.index.filter(p => (market === 'MIX' || p.market === market) && !played.has(p.id));
  if (!bank.demo) {
    const byLen = pool.filter(p => p.playBars === playBars);
    if (byLen.length) pool = byLen;
    const strat = pool.filter(p => (p.signals?.[presetId] ?? 0) >= minSignals);
    if (strat.length) pool = strat;               // 策略池；自訂策略落到隨機池，載入後再檢查訊號數
  }
  if (!pool.length) pool = bank.index.filter(p => market === 'MIX' || p.market === market);
  return pool[Math.floor(rnd() * pool.length)]?.id;
}
