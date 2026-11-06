/* themes/kitchen.js — 「廚房計時器」: a magnetic kitchen timer on the range hood,
   a pot that simmers harder as p rises, and the order rail at the top.
   End: 嗶嗶嗶！ the cloche lifts on today's special — 下班. */

import { C } from '../palette.js';
import { rect, px, disc, ellipse, line, poly, ditherDisc, drawText, clamp, lerp, ease } from '../pixel.js';
import { hms } from '../clock.js';
import { sevenSeg } from './segments.js';

const INK_LCD = [C.ink, C.ink, null];

function kitchen(g, p) {
  rect(g, 0, 0, 640, 360, C.paper);
  for (let y = 0; y < 250; y += 16) rect(g, 0, y, 640, 1, C.lightgray);
  for (let x = 0; x < 640; x += 16) rect(g, x, 0, 1, 250, C.lightgray);
  // order rail with tickets
  rect(g, 0, 6, 640, 4, C.gray);
  const tickets = [['#下班', '×1'], ['#準時', '×1'], ['#加班', '×0']];
  tickets.forEach(([a, b], i) => {
    const x = 30 + i * 70;
    rect(g, x, 10, 56, 42, C.cream); rect(g, x, 10, 56, 4, C.red);
    drawText(g, a, x + 4, 16, C.ink); drawText(g, b, x + 4, 32, C.darkgray);
  });
  // counter + stove
  rect(g, 0, 250, 640, 110, C.darkgray);
  rect(g, 0, 250, 640, 8, C.lightgray); rect(g, 0, 258, 640, 2, C.gray);
  rect(g, 400, 250, 220, 8, C.ink);
  for (const x of [440, 560]) { ellipse(g, x, 254, 30, 3, C.darkgray); }
}

function pot(g, x, p, t) {
  // flame grows with p
  const f = 1 + Math.round(p * 4);
  for (let i = -3; i <= 3; i++) poly(g, [[x + i * 7 - 3, 252], [x + i * 7 + 3, 252], [x + i * 7, 252 - f * 2 - (i % 2 ? 1 : 3)]], i % 2 ? C.blue : C.sky);
  rect(g, x - 42, 196, 84, 54, C.gray); rect(g, x - 42, 196, 84, 6, C.lightgray); rect(g, x - 40, 244, 80, 6, C.darkgray);
  rect(g, x - 54, 206, 12, 5, C.darkgray); rect(g, x + 42, 206, 12, 5, C.darkgray);
  // steam: slow, more of it later in the day
  const n = 1 + Math.round(p * 4);
  for (let i = 0; i < n; i++) {
    const k = (t * 0.25 + i / n) % 1;
    ditherDisc(g, x - 20 + i * 10 + Math.sin(k * 6 + i) * 6, 190 - k * 90, 6 + k * 10, C.lightgray, (1 - k) * 0.6);
  }
}

function timer(g, rem, alert, ring = 0, lift = 0) {
  const ox = ring ? Math.round(Math.sin(ring * 30) * 2) : 0;
  const x = 60 + ox, y = 70 - Math.round(lift);
  rect(g, x - 2, y - 2, 324, 172, C.outline);
  rect(g, x, y, 320, 168, alert ? C.pink : C.white);
  rect(g, x, y + 160, 320, 8, C.lightgray);
  rect(g, x + 136, y - 10, 48, 10, C.darkgray);                                // magnet
  drawText(g, '廚房計時器', x + 160, y + 6, C.gray, { align: 'center' });
  rect(g, x + 16, y + 26, 288, 88, C.darkgray);
  rect(g, x + 20, y + 30, 280, 80, C.cream);
  sevenSeg(g, hms(rem), x + 160, y + 42, INK_LCD, { w: 30, h: 56, t: 6, gap: 6, colonW: 14, glow: false, align: 'center' });
  const labels = ['時', '分', '秒', '開始/停止'];
  labels.forEach((l, i) => {
    const bx = x + 18 + i * 62, bw = i === 3 ? 100 : 52;
    rect(g, bx, y + 124, bw, 26, i === 3 ? C.red : C.lightgray);
    rect(g, bx, y + 146, bw, 4, i === 3 ? C.darkred : C.gray);
    drawText(g, l, bx + bw / 2, y + 130, i === 3 ? C.paper : C.ink, { align: 'center' });
  });
}

export default {
  id: 'kitchen',
  name: '廚房計時器',
  hud: 'none',
  catSpot: { x: 220, y: 112 },
  render(g, p, dt, st) {
    kitchen(g, p);
    pot(g, 500, p, st.t);
    timer(g, st.remaining, st.alert);
    if (st.alert) drawText(g, '主廚：最後一小時，備料收尾！', 500, 160, C.red, { align: 'center', outline: C.paper });
  },
  renderEnd(g, t, st) {
    kitchen(g, 1);
    pot(g, 500, 1, st.t);
    timer(g, 0, false, t < 2.5 ? t : 0, ease(clamp((t - 2) / 0.8)) * 52);
    if (t < 2.5) drawText(g, '嗶嗶嗶！', 220, 36, C.red, { align: 'center', scale: 3, outline: C.paper });
    // cloche lifts on the plate
    const k = ease(clamp((t - 2) / 1));
    ellipse(g, 220, 300, 70, 10, C.lightgray); ellipse(g, 220, 298, 66, 8, C.paper);
    if (k > 0.3) { rect(g, 176, 278, 88, 18, C.amber); rect(g, 176, 278, 88, 4, C.yellow); drawText(g, '下班', 220, 279, C.darkred, { align: 'center' }); }
    const cy = lerp(294, 252, k);
    ellipse(g, 220, cy - 18, 56, 28, C.lightgray); ellipse(g, 214, cy - 24, 40, 16, C.paper); rect(g, 164, cy - 12, 112, 6, C.gray);
    disc(g, 220, cy - 48, 5, C.gray);
    if (k >= 1) drawText(g, '今日主餐：下班　出餐！', 220, 318, C.paper, { align: 'center', outline: C.ink });
    return t < 6;
  },
};
