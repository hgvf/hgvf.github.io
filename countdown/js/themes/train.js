/* themes/train.js — 「高鐵月台」: a departure board counts down the 下班號 while the
   sky outside shifts; in the last stretch the train glides into the platform.
   End: doors open, everyone boards, the train leaves for 「家」. */

import { C } from '../palette.js';
import { rect, px, line, poly, ellipse, drawText, drawDigits, clamp, lerp, ease, rng } from '../pixel.js';
import { hms } from '../clock.js';
import { bands } from './common.js';
import { worker } from '../sprites.js';

const RAIL = 286, PLAT = 300;
const PEOPLE = [[150, C.blue], [196, C.red], [262, C.green], [330, C.purple], [402, C.teal]];

function station(g, p, t, alert) {
  // outside through the windows: day → dusk
  bands(g, p < 0.5 ? [[0, C.sky], [200, C.lightsky]] : p < 0.85 ? [[0, C.blue], [150, C.pink], [230, C.amber]] : [[0, C.navy], [150, C.plum], [230, C.orange]]);
  const r = rng(12);
  for (let x = 0; x < 640; x += 30) { const h = 30 + (r() * 70 | 0); rect(g, x, 250 - h, 26, h, p > 0.85 ? C.plum : C.blue); }
  // roof + window mullions
  rect(g, 0, 0, 640, 120, C.darkgray);
  for (let x = 0; x < 640; x += 80) { rect(g, x, 120, 6, 150, C.gray); }
  rect(g, 0, 118, 640, 4, C.gray);
  for (let x = 10; x < 640; x += 40) rect(g, x, 112, 20, 3, C.cream);          // ceiling lights
  // track
  rect(g, 0, 262, 640, 38, C.darkgray);
  for (let x = 0; x < 640; x += 14) rect(g, x, RAIL - 4, 8, 6, C.brown);
  rect(g, 0, RAIL - 6, 640, 2, C.lightgray); rect(g, 0, RAIL + 2, 640, 2, C.lightgray);
  // platform
  rect(g, 0, PLAT, 640, 60, C.lightgray); rect(g, 0, PLAT, 640, 2, C.paper);
  rect(g, 0, PLAT + 6, 640, 4, C.yellow);
  for (let x = 0; x < 640; x += 6) px(g, x + 2, PLAT + 7, C.amber);
  // departure board
  rect(g, 114, 8, 412, 98, C.outline);
  rect(g, 118, 12, 404, 90, C.ink);
  drawText(g, '班次 下班 1號　開往 家', 130, 16, C.amber);
  const status = p > 0.97 ? '列車進站中' : p > 0.85 ? '即將進站' : alert ? '最後一小時' : '準點';
  drawText(g, status, 510, 16, p > 0.85 || alert ? C.red : C.lime, { align: 'right' });
  rect(g, 126, 32, 388, 1, C.darkgray);
  return status;
}

function trainBody(g, x, t, doors = 0) {
  const y0 = 200, y1 = 276;
  // carriages extend to the right off-screen
  rect(g, x + 40, y0, 1200, y1 - y0, C.paper);
  rect(g, x + 40, y1 - 6, 1200, 6, C.lightgray);
  // nose
  poly(g, [[x + 40, y0], [x + 40, y1], [x - 40, y1], [x - 40, y1 - 14], [x - 10, y0 + 18], [x + 10, y0 + 4]], C.paper);
  poly(g, [[x - 38, y1 - 16], [x - 8, y0 + 20], [x + 14, y0 + 10], [x + 14, y0 + 26], [x - 20, y1 - 16]], C.deepblue);
  px(g, x - 34, y1 - 8, C.yellow); px(g, x - 33, y1 - 8, C.yellow);
  rect(g, x - 40, y1 - 10, 1300, 4, C.orange);
  rect(g, x - 20, y1 - 14, 1300, 2, C.amber);
  // windows + doors
  for (let i = 0; i < 30; i++) {
    const wx = x + 60 + i * 34;
    if (wx > 700) break;
    if (i % 5 === 2) {
      const open = Math.round(doors * 9);
      rect(g, wx - open, y0 + 10, 9, 50, C.lightgray); rect(g, wx + 10 + open, y0 + 10, 9, 50, C.lightgray);
      if (open) rect(g, wx + 9 - open, y0 + 10, open * 2 + 1, 50, C.navy);
      else rect(g, wx + 9, y0 + 10, 1, 50, C.gray);
    } else {
      rect(g, wx, y0 + 12, 24, 18, C.blue); rect(g, wx + 2, y0 + 14, 6, 2, C.lightsky);
    }
  }
}

function people(g, t, gone = 0, panic = false) {
  PEOPLE.forEach(([x, col], i) => {
    if (gone > (i + 1) / PEOPLE.length) return;
    const f = panic ? (t * 10 | 0) + i : 0;
    g.drawImage(worker(col, f, false), Math.round(x + (panic ? Math.sin(t * 3 + i) * 3 : 0)), PLAT + 14);
  });
}

export default {
  id: 'train',
  name: '高鐵月台',
  hud: 'none',
  catSpot: { x: 320, y: 98 },
  render(g, p, dt, st) {
    station(g, p, st.t, st.alert);
    const s = 5;
    const col = st.alert ? C.orange : C.amber;
    drawDigits(g, hms(st.remaining), 320, 44, s, col, { align: 'center', hi: C.yellow, shadow: C.darkred });
    drawText(g, `已完成 ${Math.floor(p * 100)}%`, 130, 84, C.gray);
    const k = clamp((p - 0.86) / 0.14);
    if (k > 0) trainBody(g, lerp(700, 120, ease(k)), st.t);
    people(g, st.t, 0, p > 0.9);
    if (p > 0.92) drawText(g, '請勿跨越黃線', 20, PLAT + 22, C.darkred);
  },
  renderEnd(g, t, st) {
    station(g, 1, st.t, false);
    drawDigits(g, '00:00:00', 320, 44, 5, C.lime, { align: 'center', hi: C.cream, shadow: C.darkgreen });
    const doors = t < 1 ? ease(t) : t < 4 ? 1 : 1 - ease(clamp((t - 4) / 0.6));
    const leave = Math.max(0, t - 4.8);
    const x = 120 - Math.pow(leave, 2.2) * 120;
    trainBody(g, x, st.t, doors);
    people(g, st.t, clamp((t - 1.2) / 2.2));
    if (leave > 0) for (let i = 0; i < 10; i++) rect(g, (i * 71 + leave * 900) % 700 - 30, 206 + i * 7, 40, 1, C.paper);
    if (t > 1.2) drawText(g, t < 4.6 ? '各位旅客，下班號已到站' : '下一站：家', 320, 150, C.yellow, { align: 'center', scale: 2, outline: C.ink });
    return t < 8;
  },
};
