/* themes/digital.js — 「電子鐘」: a retro seven-segment desk clock whose glow
   shifts from cold white to warm orange as p rises. End: 00:00:00 blinking. */

import { C } from '../palette.js';
import { rect, px, poly, drawText, dither, rng } from '../pixel.js';
import { hms } from '../clock.js';

const SEG = { a: [1, 0, 0], b: [2, 0, 1], c: [2, 1, 1], d: [1, 2, 0], e: [0, 1, 1], f: [0, 0, 1], g: [1, 1, 0] };
const DIGIT = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
const RAMP = [C.paper, C.lightsky, C.cream, C.yellow, C.amber, C.orange];
const DIM = C.darkgray;

/** One segment as a hexagonal bar. kind: [col 0..2, row 0..2, vertical?] */
function seg(g, x, y, w, h, t, kind, col) {
  const [cx, cy, vert] = kind;
  if (!vert) {
    const sx = x + t, sy = y + cy * (h - t) / 2, L = w - t * 2;
    poly(g, [[sx, sy + t / 2], [sx + t / 2, sy], [sx + L - t / 2, sy], [sx + L, sy + t / 2], [sx + L - t / 2, sy + t], [sx + t / 2, sy + t]], col);
  } else {
    const sx = x + (cx === 0 ? 0 : w - t), sy = y + t / 2 + cy * (h - t) / 2, L = (h - t) / 2 - 1;
    poly(g, [[sx + t / 2, sy], [sx + t, sy + t / 2], [sx + t, sy + L - t / 2], [sx + t / 2, sy + L], [sx, sy + L - t / 2], [sx, sy + t / 2]], col);
  }
}

function sevenSeg(g, str, x, y, col, blinkOff = false) {
  const W = 52, H = 96, T = 10;
  let cx = x;
  for (const ch of str) {
    if (ch === ':') {
      const on = !blinkOff;
      rect(g, cx + 4, y + 26, 10, 10, on ? col : DIM); rect(g, cx + 4, y + 62, 10, 10, on ? col : DIM);
      cx += 22; continue;
    }
    const lit = DIGIT[ch] || '';
    for (const k of Object.keys(SEG)) seg(g, cx, y, W, H, T, SEG[k], !blinkOff && lit.includes(k) ? col : DIM);
    cx += W + 10;
  }
}

function housing(g, col, t, label) {
  rect(g, 0, 0, 640, 360, C.ink);
  const r = rng(4);
  for (let i = 0; i < 70; i++) { g.fillStyle = C.navy; g.fillRect(r() * 640 | 0, r() * 360 | 0, 1, 1); }
  // wood-grain case
  rect(g, 22, 70, 596, 214, C.darkbrown);
  rect(g, 26, 74, 588, 206, C.brown);
  for (let y = 78; y < 278; y += 6) rect(g, 26, y, 588, 1, C.darkbrown);
  rect(g, 40, 92, 560, 160, C.ink);
  rect(g, 42, 94, 556, 156, C.navy);
  dither(g, 42, 94, 556, 156, C.ink, 0.5);
  for (let y = 95; y < 250; y += 3) rect(g, 42, y, 556, 1, C.ink);        // scanlines
  drawText(g, label, 52, 256, C.sand);
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
    housing(g, col, st.t, st.alert ? '警戒模式 · 最後一小時' : `下班倒數 · 已完成 ${Math.floor(p * 100)}%`);
    sevenSeg(g, hms(st.remaining), 117, 124, col);
    if (st.alert && ((st.t * 2) | 0) % 2) rect(g, 42, 94, 556, 2, C.red);
  },
  renderEnd(g, t, st) {
    const blink = ((t * 2.5) | 0) % 2 === 1;
    const col = [C.orange, C.yellow, C.pink, C.lime][((t * 2.5) | 0) % 4];
    housing(g, col, st.t, '下班了 · 00:00:00');
    sevenSeg(g, '00:00:00', 117, 124, col, blink && !st.reduced);
    return t < 6;
  },
};
