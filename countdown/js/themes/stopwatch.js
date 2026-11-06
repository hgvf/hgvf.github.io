/* themes/stopwatch.js — 「碼表」: a big chrome stopwatch above a running track.
   The sweep hand counts the seconds down, the sub-dial the minutes, and the
   readout shows the exact time left. End: click — 完賽, chequered flag. */

import { C } from '../palette.js';
import { rect, px, disc, ring, line, poly, drawText, drawDigits, clamp, ease } from '../pixel.js';
import { hms } from '../clock.js';
import { bands } from './common.js';

const CX = 320, CY = 186, R = 116;

function track(g) {
  bands(g, [[0, C.sky], [140, C.lightsky]]);
  rect(g, 0, 210, 640, 40, C.green);
  for (let x = 0; x < 640; x += 3) px(g, x, 210 + (x * 7) % 40, C.lime);
  rect(g, 0, 250, 640, 110, C.rust);
  for (const y of [262, 286, 312, 340]) rect(g, 0, y, 640, 2, C.paper);
  drawText(g, '1', 20, 266, C.paper); drawText(g, '2', 20, 290, C.paper); drawText(g, '3', 20, 316, C.paper);
}

function watch(g, rem, alert, pressed = 0) {
  // crown + side buttons
  rect(g, CX - 14, CY - R - 34 + pressed * 6, 28, 16, C.lightgray); rect(g, CX - 14, CY - R - 34 + pressed * 6, 28, 3, C.white);
  rect(g, CX - 8, CY - R - 20, 16, 12, C.gray);
  ring(g, CX, CY - R - 44 + pressed * 6, 9, C.gray); ring(g, CX, CY - R - 44 + pressed * 6, 8, C.lightgray);
  for (const s of [-1, 1]) { const a = -Math.PI / 2 + s * 0.6; rect(g, CX + Math.cos(a) * (R + 4) - 7, CY + Math.sin(a) * (R + 4) - 7, 14, 14, C.gray); }
  disc(g, CX + 4, CY + 6, R + 6, C.outline);
  disc(g, CX, CY, R + 6, C.gray);
  disc(g, CX, CY, R + 3, C.lightgray);
  disc(g, CX - 2, CY - 2, R, C.white);
  disc(g, CX, CY, R - 6, alert ? C.cream : C.paper);
  for (let i = 0; i < 60; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 30, big = i % 5 === 0;
    const r0 = R - (big ? 20 : 12);
    line(g, CX + Math.cos(a) * r0, CY + Math.sin(a) * r0, CX + Math.cos(a) * (R - 8), CY + Math.sin(a) * (R - 8), big ? C.ink : C.gray, big ? 2 : 1);
    if (big) drawText(g, String(i === 0 ? 60 : i), CX + Math.cos(a) * (R - 32), CY + Math.sin(a) * (R - 32) - 6, C.darkgray, { align: 'center' });
  }
  // minute sub-dial
  const sx = CX, sy = CY - 44;
  disc(g, sx, sy, 22, C.lightgray); disc(g, sx, sy, 20, C.paper);
  for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + i * Math.PI / 6; px(g, sx + Math.cos(a) * 17, sy + Math.sin(a) * 17, C.gray); }
  const secs = Math.ceil(rem / 1000);
  const ma = -Math.PI / 2 + ((secs / 60) % 60) / 60 * Math.PI * 2;
  line(g, sx, sy, sx + Math.cos(ma) * 15, sy + Math.sin(ma) * 15, C.ink, 2);
  // readout (the time you actually read)
  rect(g, CX - 82, CY + 26, 164, 40, C.ink);
  rect(g, CX - 80, CY + 28, 160, 36, C.navy);
  drawDigits(g, hms(rem), CX, CY + 33, 3, alert ? C.orange : C.cyan, { align: 'center', hi: C.white });
  // sweep hand: one turn per minute of time left
  const fa = -Math.PI / 2 + ((rem / 1000) % 60) / 60 * Math.PI * 2;
  line(g, CX - Math.cos(fa) * 16, CY - Math.sin(fa) * 16, CX + Math.cos(fa) * (R - 14), CY + Math.sin(fa) * (R - 14), C.red, 2);
  disc(g, CX, CY, 6, C.red); disc(g, CX, CY, 2, C.ink);
}

export default {
  id: 'stopwatch',
  name: '碼表',
  hud: 'none',
  catSpot: { x: 320, y: 254 },
  render(g, p, dt, st) {
    track(g);
    watch(g, st.remaining, st.alert);
    drawText(g, `下班馬拉松 · 已跑 ${Math.floor(p * 100)}%`, 20, 20, C.navy);
    if (st.alert) drawText(g, '最後一圈！', 620, 20, C.red, { align: 'right', scale: 2 });
  },
  renderEnd(g, t, st) {
    track(g);
    watch(g, 0, false, t < 0.4 ? 1 : 0);
    if (t > 0.6) {
      // chequered flag on a pole, waving gently
      const fx = 470, fy = 40;
      rect(g, fx, fy, 4, 160, C.darkgray);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
        const wave = Math.round(Math.sin(t * 3 + i * 0.7) * 3);
        rect(g, fx + 4 + i * 12, fy + j * 12 + wave, 12, 12, (i + j) % 2 ? C.ink : C.paper);
      }
      drawText(g, '完賽！', 180, 40, C.red, { align: 'center', scale: 3, outline: C.paper });
    }
    return t < 6;
  },
};
