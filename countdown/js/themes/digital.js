/* themes/digital.js — 「電子鐘」: a retro seven-segment desk clock whose glow
   shifts from cold white to warm orange as p rises. End: 00:00:00 blinking.
   Legibility first: unlit segments are a faint ghost on a black panel, lit
   segments get a 1px glow rim and a bright core line. */

import { C } from '../palette.js';
import { rect, px, poly, drawText, rng } from '../pixel.js';
import { hms } from '../clock.js';

const SEG = { a: [1, 0, 0], b: [2, 0, 1], c: [2, 1, 1], d: [1, 2, 0], e: [0, 1, 1], f: [0, 0, 1], g: [1, 1, 0] };
const DIGIT = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
/* [main, glow rim, core] — cool white → warm orange over the day */
const RAMP = [
  [C.paper, C.blue, C.white],
  [C.lightsky, C.blue, C.white],
  [C.cream, C.tan, C.white],
  [C.yellow, C.rust, C.cream],
  [C.amber, C.darkred, C.cream],
  [C.orange, C.darkred, C.yellow],
];
const GHOST = C.navy;
const PANEL = C.ink;

/** Segment polygon points. kind: [col 0..2, row 0..2, vertical?] */
function segPts(x, y, w, h, t, kind) {
  const [cx, cy, vert] = kind;
  if (!vert) {
    const sx = x + t, sy = y + cy * (h - t) / 2, L = w - t * 2;
    return [[sx, sy + t / 2], [sx + t / 2, sy], [sx + L - t / 2, sy], [sx + L, sy + t / 2], [sx + L - t / 2, sy + t], [sx + t / 2, sy + t]];
  }
  const sx = x + (cx === 0 ? 0 : w - t), sy = y + t / 2 + cy * (h - t) / 2, L = (h - t) / 2 - 1;
  return [[sx + t / 2, sy], [sx + t, sy + t / 2], [sx + t, sy + L - t / 2], [sx + t / 2, sy + L], [sx, sy + L - t / 2], [sx, sy + t / 2]];
}
const shift = (pts, dx, dy) => pts.map(([a, b]) => [a + dx, b + dy]);

function litSeg(g, pts, [main, glow, core], vert) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) poly(g, shift(pts, dx, dy), glow);
  poly(g, pts, main);
  // core highlight: a 1–2px line along the segment's long axis
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (vert) rect(g, Math.round((x0 + x1) / 2) - 1, y0 + 5, 2, y1 - y0 - 10, core);
  else rect(g, x0 + 5, Math.round((y0 + y1) / 2) - 1, x1 - x0 - 10, 2, core);
}

function sevenSeg(g, str, x, y, col, blinkOff = false) {
  const W = 52, H = 96, T = 10;
  let cx = x;
  for (const ch of str) {
    if (ch === ':') {
      for (const yy of [y + 26, y + 62]) {
        if (blinkOff) { rect(g, cx + 4, yy, 10, 10, GHOST); continue; }
        rect(g, cx + 3, yy - 1, 12, 12, col[1]); rect(g, cx + 4, yy, 10, 10, col[0]); rect(g, cx + 6, yy + 2, 3, 3, col[2]);
      }
      cx += 22; continue;
    }
    const lit = blinkOff ? '' : (DIGIT[ch] || '');
    for (const k of Object.keys(SEG)) if (!lit.includes(k)) poly(g, segPts(cx, y, W, H, T, SEG[k]), GHOST);
    for (const k of Object.keys(SEG)) if (lit.includes(k)) litSeg(g, segPts(cx, y, W, H, T, SEG[k]), col, SEG[k][2]);
    cx += W + 10;
  }
}

function housing(g, t, label, labelCol = C.sand) {
  rect(g, 0, 0, 640, 360, C.ink);
  const r = rng(4);
  for (let i = 0; i < 70; i++) { g.fillStyle = C.navy; g.fillRect(r() * 640 | 0, r() * 360 | 0, 1, 1); }
  // wood-grain case
  rect(g, 22, 70, 596, 214, C.darkbrown);
  rect(g, 26, 74, 588, 206, C.brown);
  for (let y = 78; y < 278; y += 6) rect(g, 26, y, 588, 1, C.darkbrown);
  rect(g, 38, 90, 564, 164, C.outline);
  rect(g, 40, 92, 560, 160, PANEL);
  for (let y = 93; y < 252; y += 3) rect(g, 40, y, 560, 1, C.outline);        // faint scanlines (behind digits)
  drawText(g, label, 52, 258, labelCol);
  for (let i = 0; i < 3; i++) { rect(g, 520 + i * 22, 260, 14, 8, C.darkgray); rect(g, 520 + i * 22, 260, 14, 2, C.gray); }
  px(g, 580, 77, ((t * 2) | 0) % 2 ? C.red : C.darkred);
  rect(g, 70, 284, 40, 10, C.darkbrown); rect(g, 530, 284, 40, 10, C.darkbrown);
  rect(g, 0, 294, 640, 66, C.darkbrown); rect(g, 0, 294, 640, 3, C.tan);
}

export default {
  id: 'digital',
  name: '電子鐘',
  hud: 'none',
  render(g, p, dt, st) {
    const col = RAMP[Math.min(RAMP.length - 1, Math.floor(p * RAMP.length))];
    housing(g, st.t, st.alert ? '警戒模式 · 最後一小時' : `下班倒數 · 已完成 ${Math.floor(p * 100)}%`, st.alert ? C.orange : C.sand);
    sevenSeg(g, hms(st.remaining), 117, 124, col);
    if (st.alert && ((st.t * 2) | 0) % 2) rect(g, 40, 92, 560, 2, C.red);
  },
  renderEnd(g, t, st) {
    const blink = ((t * 2.5) | 0) % 2 === 1;
    const col = [RAMP[5], RAMP[3], [C.pink, C.purple, C.white], [C.lime, C.green, C.white]][((t * 2.5) | 0) % 4];
    housing(g, st.t, '下班了 · 00:00:00', C.lime);
    sevenSeg(g, '00:00:00', 117, 124, col, blink && !st.reduced);
    return t < 6;
  },
};
