// ui.js — tiny DOM / format helpers.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('zh-TW');
export const fmtInt = x => (Number.isFinite(x) ? nf.format(Math.round(x)) : '—');
export const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
export const fmtPct = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}%` : '—');
export const fmtR = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}R` : '—');
export const sign = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
export function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function sparkline(canvas, values, color = '#8B5E3C') {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 300, h = canvas.clientHeight || 44;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  g.beginPath();
  v.forEach((x, i) => { const px = i / (v.length - 1) * w, py = h - 3 - (x - lo) / span * (h - 6); i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.strokeStyle = color; g.lineWidth = 1.6; g.stroke();
  g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fillStyle = color + '22'; g.fill();
}
export const MARKET_NAME = { TW: '台股', US: '美股', JP: '日股', KR: '韓股', MIX: '混合盲測' };
export const REGIME_NAME = { up: '多頭', down: '空頭', range: '盤整' };
