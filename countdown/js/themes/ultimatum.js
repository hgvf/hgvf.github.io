/* themes/ultimatum.js — 「最後通牒」: she is waiting at the door, arms crossed, foot
   tapping, and the speech bubble says exactly how long you have:
   「限你 02:14:33 內出現在門口！」 The 生氣值 bar rises with p.
   End: he sprints in with flowers — 「…還算準時。」 */

import { C } from '../palette.js';
import { rect, px, disc, ellipse, line, poly, ditherDisc, drawText, drawDigits, clamp, lerp, ease } from '../pixel.js';
import { hms } from '../clock.js';
import { heart } from '../sprites.js';

const FLOOR = 312;

function hallway(g) {
  rect(g, 0, 0, 640, 360, C.sand);
  for (let x = 0; x < 640; x += 40) rect(g, x, 0, 2, FLOOR, C.tan);
  rect(g, 0, FLOOR - 40, 640, 4, C.brown);
  rect(g, 0, FLOOR, 640, 48, C.brown);
  for (let x = 0; x < 640; x += 32) rect(g, x, FLOOR, 1, 48, C.darkbrown);
  // door
  rect(g, 66, 108, 112, FLOOR - 108, C.darkbrown);
  rect(g, 72, 114, 100, FLOOR - 114, C.rust);
  rect(g, 82, 126, 80, 70, C.tan); rect(g, 82, 210, 80, 86, C.tan);
  disc(g, 160, 216, 4, C.yellow);
  rect(g, 100, 92, 44, 14, C.darkbrown); drawText(g, '2F', 122, 93, C.cream, { align: 'center' });
  rect(g, 50, FLOOR - 4, 144, 4, C.darkgray);                                   // doormat
}

/** Standing figure; feet at FLOOR. mood 0 calm … 1 furious. */
function girl(g, x, t, mood, soft = false) {
  const tap = !soft && Math.sin(t * 6) > 0.6 ? 2 : 0;
  rect(g, x - 9, FLOOR - 26, 5, 24, C.peach); rect(g, x + 4, FLOOR - 26, 5, 24 - tap, C.peach);
  rect(g, x - 11, FLOOR - 4, 8, 4, C.red); rect(g, x + 3, FLOOR - 4 - tap, 8, 4, C.red);
  poly(g, [[x - 14, FLOOR - 26], [x + 14, FLOOR - 26], [x + 9, FLOOR - 62], [x - 9, FLOOR - 62]], C.purple);  // dress
  rect(g, x - 9, FLOOR - 74, 18, 14, C.purple);
  if (soft) { rect(g, x - 16, FLOOR - 70, 6, 22, C.peach); rect(g, x + 10, FLOOR - 70, 6, 22, C.peach); }
  else { rect(g, x - 15, FLOOR - 64, 30, 6, C.peach); rect(g, x - 15, FLOOR - 64, 30, 1, C.tan); }       // crossed arms
  // head
  disc(g, x, FLOOR - 90, 15, C.darkbrown);
  rect(g, x - 15, FLOOR - 90, 30, 26, C.darkbrown);                              // long hair
  disc(g, x, FLOOR - 88, 11, C.peach);
  rect(g, x - 11, FLOOR - 100, 22, 6, C.darkbrown);                              // fringe
  if (soft) { rect(g, x - 6, FLOOR - 88, 3, 1, C.ink); rect(g, x + 3, FLOOR - 88, 3, 1, C.ink); rect(g, x - 2, FLOOR - 81, 5, 1, C.red); }
  else {
    line(g, x - 7, FLOOR - 92, x - 3, FLOOR - 90, C.ink); line(g, x + 7, FLOOR - 92, x + 3, FLOOR - 90, C.ink);
    px(g, x - 5, FLOOR - 88, C.ink); px(g, x + 5, FLOOR - 88, C.ink);
    rect(g, x - 3, FLOOR - 81, 6, 1, C.darkred);
  }
  if (mood > 0.3 || soft) { rect(g, x - 9, FLOOR - 85, 3, 2, C.pink); rect(g, x + 7, FLOOR - 85, 3, 2, C.pink); }
  if (mood > 0.6 && !soft) for (let i = 0; i < 2; i++) {                        // steam, slow
    const k = (t * 0.4 + i / 2) % 1;
    ditherDisc(g, x + (i ? 14 : -14), FLOOR - 108 - k * 26, 4 + k * 4, C.paper, (1 - k) * 0.7);
  }
}

function boy(g, x, t, running) {
  const f = running ? Math.sin(t * 16) : 0;
  rect(g, x - 7 + f * 3, FLOOR - 28, 5, 28, C.navy); rect(g, x + 2 - f * 3, FLOOR - 28, 5, 28, C.navy);
  rect(g, x - 11, FLOOR - 66, 22, 40, C.blue);
  disc(g, x, FLOOR - 82, 12, C.peach);
  rect(g, x - 12, FLOOR - 96, 24, 8, C.ink);
  px(g, x - 5, FLOOR - 83, C.ink); px(g, x + 4, FLOOR - 83, C.ink);
  // bouquet held out in front (facing left)
  rect(g, x - 26, FLOOR - 58, 18, 5, C.peach);
  poly(g, [[x - 30, FLOOR - 56], [x - 22, FLOOR - 56], [x - 26, FLOOR - 40]], C.green);
  for (const [dx, dy, c] of [[-32, -66, C.red], [-26, -70, C.pink], [-20, -66, C.yellow], [-28, -61, C.red], [-22, -61, C.pink]]) disc(g, x + dx, FLOOR + dy, 3, c);
}

function speech(g, rem, p, alert) {
  const x = 236, y = 30, w = 380, h = 150;
  rect(g, x, y, w, h, C.outline); rect(g, x + 2, y + 2, w - 4, h - 4, C.paper);
  poly(g, [[x + 30, y + h - 2], [x + 64, y + h - 2], [x + 10, y + h + 40]], C.paper);
  line(g, x + 30, y + h, x + 10, y + h + 40, C.outline); line(g, x + 64, y + h - 1, x + 10, y + h + 40, C.outline);
  drawText(g, '限你', x + 18, y + 12, C.ink, { scale: 2 });
  drawDigits(g, hms(rem), x + w / 2 + 20, y + 46, 5, alert ? C.red : C.darkred, { align: 'center', shadow: C.lightgray });
  drawText(g, '內出現在門口！', x + w - 18, y + 92, C.ink, { align: 'right', scale: 2 });
  const line2 = p > 0.9 ? '你完了。' : p > 0.7 ? '我在數了。' : p > 0.4 ? '你最好準時。' : '我等你喔～';
  drawText(g, line2, x + 18, y + 124, p > 0.7 ? C.red : C.gray);
  // 生氣值
  drawText(g, '生氣值', x + w - 150, y + 124, C.gray);
  rect(g, x + w - 100, y + 128, 82, 8, C.lightgray);
  rect(g, x + w - 100, y + 128, Math.round(82 * p), 8, p > 0.7 ? C.red : C.amber);
}

export default {
  id: 'ultimatum',
  name: '最後通牒',
  hud: 'none',
  catSpot: { x: 430, y: 132 },
  render(g, p, dt, st) {
    hallway(g);
    girl(g, 218, st.t, p);
    speech(g, st.remaining, p, st.alert);
  },
  renderEnd(g, t, st) {
    hallway(g);
    const arrive = ease(clamp(t / 1.6));
    const soft = t > 1.8;
    girl(g, 218, st.t, 1, soft);
    boy(g, lerp(700, 290, arrive), st.t, t < 1.6);
    if (soft) {
      for (let i = 0; i < 4; i++) g.drawImage(heart(), 226 + i * 18, Math.round(FLOOR - 130 - ((t - 1.8) * 14 + i * 9) % 40));
      const x = 236, y = 30;
      rect(g, x, y, 300, 70, C.outline); rect(g, x + 2, y + 2, 296, 66, C.paper);
      drawText(g, '……還算準時。', x + 150, y + 12, C.ink, { align: 'center', scale: 2 });
      drawText(g, '花很漂亮，原諒你。', x + 150, y + 44, C.pink, { align: 'center' });
    }
    return t < 6;
  },
};
