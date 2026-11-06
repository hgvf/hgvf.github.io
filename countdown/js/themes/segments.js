/* themes/segments.js — shared seven-segment display. Unlit segments are a faint
   ghost, lit ones get a 1px glow rim and a bright core so the time always reads.
   col = [main, glowRim, core]; pass glow:false for flat LCD-style digits. */

import { rect, poly } from '../pixel.js';

const SEG = { a: [1, 0, 0], b: [2, 0, 1], c: [2, 1, 1], d: [1, 2, 0], e: [0, 1, 1], f: [0, 0, 1], g: [1, 1, 0] };
const DIGIT = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };

function segPts(x, y, w, h, t, [cx, cy, vert]) {
  if (!vert) {
    const sx = x + t, sy = y + cy * (h - t) / 2, L = w - t * 2;
    return [[sx, sy + t / 2], [sx + t / 2, sy], [sx + L - t / 2, sy], [sx + L, sy + t / 2], [sx + L - t / 2, sy + t], [sx + t / 2, sy + t]];
  }
  const sx = x + (cx === 0 ? 0 : w - t), sy = y + t / 2 + cy * (h - t) / 2, L = (h - t) / 2 - 1;
  return [[sx + t / 2, sy], [sx + t, sy + t / 2], [sx + t, sy + L - t / 2], [sx + t / 2, sy + L], [sx, sy + L - t / 2], [sx, sy + t / 2]];
}
const shift = (pts, dx, dy) => pts.map(([a, b]) => [a + dx, b + dy]);

/** Width in px of a string drawn with these sizes. */
export function segWidth(str, w = 52, gap = 10, colonW = 22) {
  let n = 0;
  for (const ch of str) n += ch === ':' ? colonW : w + gap;
  return n - gap;
}

/** Draw a seven-segment string. opts: { w, h, t, gap, colonW, ghost, glow, off } */
export function sevenSeg(g, str, x, y, col, opts = {}) {
  const W = opts.w || 52, H = opts.h || 96, T = opts.t || Math.max(3, Math.round(W / 5.2));
  const gap = opts.gap ?? Math.round(W / 5), colonW = opts.colonW || Math.round(W * 0.42);
  const glow = opts.glow !== false, ghost = opts.ghost;
  let cx = opts.align === 'center' ? x - segWidth(str, W, gap, colonW) / 2 : x;
  for (const ch of str) {
    if (ch === ':') {
      const d = Math.max(2, Math.round(T * 1.0)), ox = Math.round((colonW - d) / 2) - Math.round(gap / 3);
      for (const yy of [y + Math.round(H * 0.28), y + Math.round(H * 0.64)]) {
        if (opts.off) { if (ghost) rect(g, cx + ox, yy, d, d, ghost); continue; }
        if (glow) rect(g, cx + ox - 1, yy - 1, d + 2, d + 2, col[1]);
        rect(g, cx + ox, yy, d, d, col[0]);
      }
      cx += colonW; continue;
    }
    const lit = opts.off ? '' : (DIGIT[ch] || '');
    for (const k of Object.keys(SEG)) {
      const pts = segPts(cx, y, W, H, T, SEG[k]);
      if (!lit.includes(k)) { if (ghost) poly(g, pts, ghost); continue; }
      if (glow) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) poly(g, shift(pts, dx, dy), col[1]);
      poly(g, pts, col[0]);
      if (glow && col[2] && T >= 9) {
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        if (SEG[k][2]) rect(g, Math.round((x0 + x1) / 2) - 1, y0 + T / 2, 2, y1 - y0 - T, col[2]);
        else rect(g, x0 + T / 2, Math.round((y0 + y1) / 2) - 1, x1 - x0 - T, 2, col[2]);
      }
    }
    cx += W + gap;
  }
}
