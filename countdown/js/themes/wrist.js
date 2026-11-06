/* themes/wrist.js — 「手臂倒數」: time glows green under the skin of a forearm, the
   only currency left. The last hour turns it red. End: the clock runs out and,
   instead of anything dramatic, you are simply 自由了. */

import { C } from '../palette.js';
import { rect, poly, ellipse, dither, ditherDisc, drawText, clamp, ease, rng } from '../pixel.js';
import { hms } from '../clock.js';
import { sevenSeg, segWidth } from './segments.js';
import { bands } from './common.js';

const GREEN = [C.lime, C.green, C.white];
const RED = [C.red, C.darkred, C.pink];
const GOLD = [C.yellow, C.amber, C.white];

function backdrop(g, t) {
  bands(g, [[0, C.ink], [140, C.navy], [300, C.deepblue]]);
  const r = rng(51);
  for (let i = 0; i < 12; i++) { const x = r() * 640 | 0, h = 60 + (r() * 140 | 0); rect(g, x, 300 - h, 30 + (r() * 30 | 0), h, C.outline); }
  rect(g, 0, 300, 640, 60, C.ink);
  drawText(g, '時間就是貨幣 · 別浪費在辦公室', 320, 24, C.gray, { align: 'center' });
}

function arm(g, bob) {
  const y = 150 + bob;
  // forearm (palm up), tapering toward the wrist
  poly(g, [[-10, y - 4], [440, y + 10], [440, y + 86], [-10, y + 100]], C.tan);
  poly(g, [[-10, y - 6], [440, y + 8], [440, y + 76], [-10, y + 90]], C.peach);
  poly(g, [[-10, y - 6], [440, y + 8], [440, y + 14], [-10, y + 2]], C.cream);
  for (let x = 40; x < 420; x += 70) rect(g, x, y + 70, 24, 1, C.tan);          // a few skin lines
  // hand
  ellipse(g, 478, y + 49, 46, 40, C.tan);
  ellipse(g, 476, y + 46, 44, 38, C.peach);
  for (let i = 0; i < 4; i++) {
    const fy = y + 18 + i * 17;
    ellipse(g, 540 + (i === 0 || i === 3 ? -6 : 0), fy + 2, 34, 8, C.tan);
    ellipse(g, 538 + (i === 0 || i === 3 ? -6 : 0), fy, 34, 7, C.peach);
  }
  poly(g, [[452, y + 6], [500, y - 26], [512, y - 18], [478, y + 18]], C.peach);  // thumb
  rect(g, 446, y + 40, 24, 1, C.tan); rect(g, 452, y + 56, 30, 1, C.tan);
  return y;
}

function display(g, str, y, col, glowCol) {
  const w = segWidth(str, 34, 7, 16);
  rect(g, 220 - w / 2 - 8, y + 24, w + 16, 66, glowCol === C.green ? C.darkgreen : glowCol === C.darkred ? C.plum : C.rust);  // the window under the skin
  sevenSeg(g, str, 220, y + 30, col, { w: 34, h: 54, t: 6, gap: 7, colonW: 16, align: 'center' });
}

export default {
  id: 'wrist',
  name: '手臂倒數',
  hud: 'none',
  catSpot: { x: 220, y: 156 },
  render(g, p, dt, st) {
    backdrop(g, st.t);
    const y = arm(g, Math.round(Math.sin(st.t * 0.8) * 1.5));
    const red = st.alert;
    display(g, hms(st.remaining), y, red ? RED : GREEN, red ? C.darkred : C.green);
    drawText(g, red ? '餘額不足 · 最後一小時' : `今日餘額 · 已花掉 ${Math.floor(p * 100)}%`, 220, y + 110, red ? C.pink : C.lime, { align: 'center', outline: C.ink });
  },
  renderEnd(g, t, st) {
    backdrop(g, st.t);
    const lift = ease(clamp((t - 1.5) / 1.2)) * -30;
    const y = arm(g, Math.round(lift));
    const gold = t > 1;
    display(g, '00:00:00', y, gold ? GOLD : RED, gold ? C.amber : C.darkred);
    if (t > 2.4) drawText(g, '時間歸零，你自由了', 320, 300, C.yellow, { align: 'center', scale: 2, outline: C.ink });
    return t < 6;
  },
};
