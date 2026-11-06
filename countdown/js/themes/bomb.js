/* themes/bomb.js — 「定時炸彈」: a bundle of dynamite with a red LED timer and
   four wires. Sweat appears in the last hour. End: BOOM — and out pops a
   spring-loaded 「下班」 flag. */

import { C } from '../palette.js';
import { rect, px, disc, line, poly, ditherDisc, drawText, clamp, lerp, ease, rng } from '../pixel.js';
import { hms } from '../clock.js';
import { sevenSeg } from './segments.js';
import { Particles } from '../fx.js';

const RED = [C.red, C.darkred, C.pink];

function room(g) {
  rect(g, 0, 0, 640, 360, C.plum);
  const r = rng(6);
  for (let y = 0; y < 300; y += 12) for (let x = (y / 12) % 2 ? -12 : 0; x < 640; x += 24) {
    rect(g, x + 1, y + 1, 22, 10, r() < 0.5 ? C.darkred : C.plum);
    rect(g, x + 1, y + 1, 22, 1, C.purple);
  }
  rect(g, 0, 300, 640, 60, C.darkgray); rect(g, 0, 300, 640, 2, C.gray);
  // a single bare bulb, steady
  line(g, 560, 0, 560, 40, C.ink);
  disc(g, 560, 46, 7, C.cream); ditherDisc(g, 560, 46, 22, C.yellow, 0.2);
}

function bundle(g) {
  for (let i = 0; i < 7; i++) {
    const x = 150 + i * 49;
    rect(g, x, 120, 44, 176, C.darkred);
    rect(g, x + 2, 120, 38, 176, C.red);
    rect(g, x + 6, 120, 6, 176, C.pink);
    rect(g, x, 116, 44, 6, C.sand); rect(g, x + 18, 108, 8, 10, C.paper);
  }
  for (const y of [150, 262]) { rect(g, 146, y, 351, 14, C.ink); rect(g, 146, y, 351, 3, C.darkgray); }
}

function wires(g) {
  const cols = [C.blue, C.yellow, C.green, C.paper];
  cols.forEach((c, i) => {
    let lx = 190 + i * 8, ly = 250;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const x = lerp(190 + i * 8, 420 - i * 30, t), y = 250 + Math.sin(t * Math.PI) * (22 + i * 6);
      line(g, lx, ly, x, y, c, 2); lx = x; ly = y;
    }
  });
}

function timer(g, rem, alert, t) {
  rect(g, 168, 176, 304, 84, C.outline);
  rect(g, 172, 180, 296, 76, C.ink);
  sevenSeg(g, hms(rem), 320, 188, RED, { w: 30, h: 56, t: 6, gap: 6, colonW: 14, align: 'center' });
  // status LEDs (steady, one slow pulse)
  rect(g, 180, 248, 6, 4, C.lime); rect(g, 190, 248, 6, 4, alert ? C.red : C.darkgray);
  rect(g, 454, 248, 6, 4, Math.sin(t * 1.4) > 0 ? C.red : C.darkred);
}

const fx = new Particles(600);
let boomed = false;

export default {
  id: 'bomb',
  name: '定時炸彈',
  hud: 'none',
  catSpot: { x: 320, y: 176 },
  render(g, p, dt, st) {
    room(g);
    bundle(g);
    wires(g);
    timer(g, st.remaining, st.alert, st.t);
    drawText(g, '請勿觸碰 · 下班前不得拆除', 320, 84, C.cream, { align: 'center', outline: C.ink });
    if (st.alert) {
      drawText(g, '要剪哪一條線？！', 320, 100, C.yellow, { align: 'center', outline: C.ink });
      for (let i = 0; i < 3; i++) { const k = (st.t * 0.6 + i / 3) % 1; rect(g, 130 + i * 190, 120 + k * 60, 3, 5, C.lightsky); }
    }
  },
  renderEnd(g, t, st) {
    room(g);
    if (t < 0.35) { bundle(g); wires(g); timer(g, 0, true, st.t); return true; }
    if (!boomed) { boomed = true; fx.burst(320, 200, 'fire', 3); fx.burst(320, 200, 'gold', 3); fx.dust(320, 230, 70, C.gray, 160); }
    // the bundle is gone; a scorch mark remains
    ditherDisc(g, 320, 300, 90, C.ink, 0.5);
    const k = clamp((t - 0.35) / 2.8);
    if (k < 1) {
      const R = lerp(30, 220, ease(k)), d = 1 - k;
      ditherDisc(g, 320, 210, R, C.gray, d * 0.9);
      ditherDisc(g, 320, 210, R * 0.7, C.orange, d * 0.8);
      ditherDisc(g, 320, 210, R * 0.4, C.yellow, d * 0.9);
    }
    fx.update(st.dt || 1 / 60); fx.draw(g);
    if (t < 0.5 && !st.reduced) { g.fillStyle = C.white; g.fillRect(0, 0, 640, 360); }
    // jack-in-the-box flag
    const s = clamp((t - 1.6) / 0.8);
    if (s > 0) {
      const top = lerp(300, 222, ease(s)) + Math.sin(Math.max(0, t - 2.4) * 8) * 6 * Math.exp(-Math.max(0, t - 2.4) * 2);
      for (let y = top + 40; y < 296; y += 6) line(g, 312, y, 328, y + 3, C.lightgray, 2);
      rect(g, 316, top, 4, 40, C.brown);
      poly(g, [[320, top], [384, top + 12], [320, top + 26]], C.lime);
      drawText(g, '下班', 344, top + 6, C.darkgreen, { align: 'center' });
      rect(g, 290, 294, 60, 8, C.darkgray);
      drawText(g, '砰！', 320, 40, C.yellow, { align: 'center', scale: 3, outline: C.ink });
    }
    return t < 7;
  },
  resetEnd() { fx.clear(); boomed = false; },
};
