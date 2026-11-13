// scoring.js — 計分（SDD 6.3）與統計（6.4）。純函數，方便測試。
export const BINS = [-0.10, -0.03, 0.03, 0.10];
export const BIN_NAMES = ['大跌', '小跌', '持平', '小漲', '大漲'];
export const BIN_RANGE = ['≤ −10%', '−10 ~ −3%', '−3 ~ +3%', '+3 ~ +10%', '≥ +10%'];
export const DEADBAND = 0.005;

export const binOf = x => (x <= BINS[0] ? 0 : x <= BINS[1] ? 1 : x < BINS[2] ? 2 : x < BINS[3] ? 3 : 4);
/** Allowed bins for a direction: 跑贏 → 持平/小漲/大漲；跑輸 → 大跌/小跌/持平. */
export const binsFor = dir => (dir === 'out' ? [2, 3, 4] : dir === 'under' ? [0, 1, 2] : [0, 1, 2, 3, 4]);

/** guess: { dir, bin, conf (50–100), pick }  ans: deobfuscated answer  setting: { window: r1|r5, bench: sector|market } */
export function score(guess, ans, setting) {
  const e = ans.excess[setting.bench][setting.window];
  const dirScored = Math.abs(e) >= DEADBAND;
  const dirOk = dirScored ? (guess.dir === 'out') === (e > 0) : null;
  const actualBin = binOf(e);
  const binOk = guess.bin === actualBin, binNear = Math.abs(guess.bin - actualBin) === 1;
  const pickOk = guess.pick ? guess.pick === ans.ticker : null;
  const p = guess.conf / 100;
  const brier = dirScored ? (p - (dirOk ? 1 : 0)) ** 2 : null;
  const parts = {
    dir: dirOk ? 10 : 0,
    bin: binOk ? 10 : binNear ? 4 : 0,
    pick: pickOk ? 5 : 0,
    calib: brier == null ? 0 : 10 * (1 - 4 * brier),
  };
  return { e, dirScored, dirOk, actualBin, binOk, binNear, pickOk, brier, parts, total: Math.round((parts.dir + parts.bin + parts.pick + parts.calib) * 10) / 10 };
}

export function shareText(n, r) {
  const m = ok => (ok == null ? '—' : ok ? '○' : '×');
  const bin = r.binOk ? '○' : r.binNear ? '△' : '×';
  return `法說會盲猜 #${n}：方向 ${m(r.dirOk)} 區間 ${bin} 公司 ${m(r.pickOk)}，得分 ${r.total}`;
}

/** records: [{ id, sector, releasedOn, guess, result, hinted, netSentiment, ts }] */
export function stats(records) {
  const formal = records.filter(r => !r.hinted);
  const scored = formal.filter(r => r.result.dirScored);
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const calib = [50, 60, 70, 80, 90].map(lo => {
    const hi = lo === 90 ? 100.01 : lo + 10;
    const xs = scored.filter(r => r.guess.conf >= lo && r.guess.conf < hi);
    return { lo, hi: Math.min(hi, 100), n: xs.length, conf: mean(xs.map(r => r.guess.conf / 100)), hit: mean(xs.map(r => (r.result.dirOk ? 1 : 0))) };
  });
  const bySector = {};
  for (const r of scored) { const s = bySector[r.sector] ||= { n: 0, hit: 0 }; s.n++; s.hit += r.result.dirOk ? 1 : 0; }
  // 你 vs 模型 vs 永遠猜跑贏（同一批非 hinted、方向計分的卡）
  const model = scored.map(r => ((r.netSentiment > 0) === (r.result.e > 0) ? 1 : 0));
  const always = scored.map(r => (r.result.e > 0 ? 1 : 0));
  const days = [...new Set(records.map(r => new Date(r.ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })))].sort();
  const set = new Set(days), key = d => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const d = new Date();
  if (!set.has(key(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (set.has(key(d))) { streak++; d.setDate(d.getDate() - 1); }
  return {
    n: records.length, formal: formal.length, scored: scored.length,
    dirHit: mean(scored.map(r => (r.result.dirOk ? 1 : 0))),
    binHit: mean(formal.map(r => (r.result.binOk ? 1 : 0))),
    pickHit: mean(formal.filter(r => r.guess.pick).map(r => (r.result.pickOk ? 1 : 0))),
    brier: mean(scored.map(r => r.result.brier)),
    total: formal.reduce((s, r) => s + r.result.total, 0),
    streak, calib, bySector,
    vsModel: { you: mean(scored.map(r => (r.result.dirOk ? 1 : 0))), model: mean(model), always: mean(always), n: scored.length },
  };
}

export function toCSV(records) {
  const head = ['id', 'n', 'releasedOn', 'answeredAt', 'sector', 'ticker', 'window', 'bench', 'dir', 'bin', 'conf', 'pick', 'hinted', 'excess', 'dirOk', 'binOk', 'pickOk', 'brier', 'score', 'netSentiment'];
  const rows = records.map(r => [r.id, r.n, r.releasedOn, new Date(r.ts).toISOString(), r.sector, r.ticker, r.setting.window, r.setting.bench, r.guess.dir, r.guess.bin, r.guess.conf, r.guess.pick || '', r.hinted ? 1 : 0,
    r.result.e, r.result.dirOk, r.result.binOk, r.result.pickOk, r.result.brier ?? '', r.result.total, r.netSentiment]);
  return [head, ...rows].map(r => r.map(x => (typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x ?? '')).join(',')).join('\n');
}
