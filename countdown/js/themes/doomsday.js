/* themes/doomsday.js — 「末日鐘」: a giant quarter clock face; the minute hand
   creeps from 15 minutes to midnight down to 12. End: midnight strikes, the
   world is fine — you just get to go home. */

import { C } from '../palette.js';
import { rect, px, disc, ring, line, dither, ditherDisc, drawText, clamp, lerp, ease, rng } from '../pixel.js';

const CX = 436, CY = 318, R = 232;

function face(g, p, t, alert) {
  rect(g, 0, 0, 640, 360, C.ink);
  dither(g, 0, 0, 640, 360, alert ? C.darkred : C.plum, 0.25);
  const r = rng(21);
  for (let i = 0; i < 40; i++) rect(g, r() * 640 | 0, r() * 360 | 0, 1, 1, C.darkgray);
  disc(g, CX + 3, CY + 4, R, C.outline);
  disc(g, CX, CY, R, C.cream);
  disc(g, CX, CY, R - 6, C.paper);
  ring(g, CX, CY, R - 2, C.sand);
  ring(g, CX, CY, R - 14, C.lightgray);
  // ticks for the 15 minutes before midnight (and a few past the edge for context)
  for (let m = 0; m <= 20; m++) {
    const a = -Math.PI / 2 - m * Math.PI / 30;
    const big = m % 5 === 0;
    const r0 = R - (big ? 34 : 22), r1 = R - 14;
    line(g, CX + Math.cos(a) * r0, CY + Math.sin(a) * r0, CX + Math.cos(a) * r1, CY + Math.sin(a) * r1, m === 0 ? C.red : C.ink, big ? 3 : 1);
  }
  drawText(g, '12', CX, CY - R + 40, C.red, { align: 'center', scale: 2 });
  drawText(g, '11', CX + Math.cos(-Math.PI / 2 - Math.PI / 6) * (R - 52), CY + Math.sin(-Math.PI / 2 - Math.PI / 6) * (R - 52) - 10, C.ink, { align: 'center', scale: 2 });
  drawText(g, '10', CX + Math.cos(-Math.PI / 2 - Math.PI / 3) * (R - 52), CY + Math.sin(-Math.PI / 2 - Math.PI / 3) * (R - 52) - 10, C.ink, { align: 'center', scale: 2 });
}

function hands(g, M, t) {
  const a = -Math.PI / 2 - M * Math.PI / 30;
  // hour hand barely before 12
  const ah = -Math.PI / 2 - (M / 60) * Math.PI / 6;
  line(g, CX, CY, CX + Math.cos(ah) * 120, CY + Math.sin(ah) * 120, C.darkgray, 7);
  line(g, CX + 2, CY + 2, CX + Math.cos(a) * (R - 30) + 2, CY + Math.sin(a) * (R - 30) + 2, C.lightgray, 5);
  line(g, CX, CY, CX + Math.cos(a) * (R - 30), CY + Math.sin(a) * (R - 30), C.ink, 5);
  line(g, CX + Math.cos(a) * (R - 64), CY + Math.sin(a) * (R - 64), CX + Math.cos(a) * (R - 30), CY + Math.sin(a) * (R - 30), C.red, 5);
  disc(g, CX, CY, 12, C.ink); disc(g, CX, CY, 5, C.red);
}

function header(g, M, alert) {
  rect(g, 14, 96, 168, 82, C.ink); rect(g, 16, 98, 164, 78, alert ? C.darkred : C.navy);
  drawText(g, '末日公報', 98, 102, C.cream, { align: 'center', scale: 2 });
  rect(g, 24, 130, 148, 1, C.gray);
  const mm = Math.floor(M), ss = Math.floor((M - mm) * 60);
  drawText(g, '現在是午夜前', 98, 136, C.lightgray, { align: 'center' });
  drawText(g, `${mm} 分 ${String(ss).padStart(2, '0')} 秒`, 98, 152, C.yellow, { align: 'center' });
}

export default {
  id: 'doomsday',
  name: '末日鐘',
  render(g, p, dt, st) {
    const M = lerp(15, 0, p);
    face(g, p, st.t, st.alert);
    hands(g, M, st.t);
    header(g, M, st.alert);
  },
  renderEnd(g, t, st) {
    face(g, 1, st.t, false);
    hands(g, 0, st.t);
    if (t < 1.2 && !st.reduced) ditherDisc(g, CX, CY - R + 20, 30 + t * 80, C.white, clamp(1 - t / 1.2));
    if (t > 1) {
      rect(g, 14, 96, 300, 92, C.ink); rect(g, 16, 98, 296, 88, C.darkgreen);
      drawText(g, '午夜到了。', 164, 104, C.cream, { align: 'center', scale: 2 });
      if (t > 2) drawText(g, '世界沒毀滅，只是你下班了', 164, 140, C.lime, { align: 'center' });
      if (t > 2.6) drawText(g, '（明天見）', 164, 160, C.lightgray, { align: 'center' });
    }
    return t < 6;
  },
};
