/* clock.js — the single time source. Everything derives from now(); nothing counts
   seconds down with setInterval, so a throttled background tab never drifts.
   A "warp" (demo fast-forward, ?speed=N) scales real time around an anchor. */

let warp = null;

export function now() {
  if (!warp) return Date.now();
  return warp.base + (Date.now() - warp.real0) * warp.speed;
}

export function setWarp(speed, base = Date.now()) {
  warp = speed && speed !== 1 ? { base, real0: Date.now(), speed } : null;
}
export const getWarp = () => warp;

/** Progress 0 → 1 between start and end, plus the remaining milliseconds. */
export function progress(session, t = now()) {
  const total = Math.max(1, session.end - session.start);
  const remaining = Math.max(0, session.end - t);
  const p = Math.min(1, Math.max(0, (t - session.start) / total));
  return { p, remaining, elapsed: Math.max(0, t - session.start), total };
}

export function hms(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** Human Chinese duration for copy: "2 小時 14 分鐘" / "14 分鐘" / "40 秒". */
export function zhDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h} 小時 ${mm} 分鐘` : `${h} 小時`;
}
