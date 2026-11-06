/* themes/rocket.js — 「火箭升空」: fuel loads and a pre-flight checklist ticks
   off as p rises; the sky turns from noon to dusk. End: ignition and lift-off. */

import { C } from '../palette.js';
import { rect, px, disc, line, poly, ditherDisc, drawText, clamp, lerp, ease } from '../pixel.js';
import { bands, grass, cloud } from './common.js';

const CHECKS = ['燃料加注', '引擎檢查', '導航校正', '天氣確認', '打卡紀錄', '心理準備'];
const RX = 352, BASE = 306;

function skyFor(p) {
  if (p < 0.4) return [[0, C.blue], [120, C.sky], [230, C.lightsky]];
  if (p < 0.75) return [[0, C.deepblue], [110, C.blue], [200, C.pink], [260, C.amber]];
  return [[0, C.navy], [100, C.plum], [190, C.purple], [250, C.orange]];
}

function drawRocket(g, x, y, t, flame = 0) {
  // flame
  if (flame > 0) {
    const L = 18 + flame * 40 + Math.sin(t * 40) * 4;
    poly(g, [[x - 10, y + 4], [x + 10, y + 4], [x, y + 4 + L]], C.orange);
    poly(g, [[x - 6, y + 4], [x + 6, y + 4], [x, y + 4 + L * 0.7]], C.yellow);
    poly(g, [[x - 3, y + 4], [x + 3, y + 4], [x, y + 4 + L * 0.4]], C.white);
  }
  // body
  rect(g, x - 12, y - 92, 24, 92, C.lightgray);
  rect(g, x - 12, y - 92, 16, 92, C.paper);
  poly(g, [[x - 12, y - 92], [x + 12, y - 92], [x, y - 122]], C.red);
  poly(g, [[x - 12, y - 92], [x, y - 92], [x, y - 122]], C.pink);
  rect(g, x - 12, y - 40, 24, 4, C.red);
  rect(g, x - 12, y - 8, 24, 8, C.darkgray);
  disc(g, x, y - 66, 7, C.darkgray); disc(g, x, y - 66, 5, C.lightsky); px(g, x - 2, y - 68, C.white);
  poly(g, [[x - 12, y - 30], [x - 24, y + 2], [x - 12, y - 6]], C.red);
  poly(g, [[x + 12, y - 30], [x + 24, y + 2], [x + 12, y - 6]], C.darkred);
  drawText(g, '下', x - 6, y - 56, C.blue);
  drawText(g, '班', x - 6, y - 44, C.blue);
  rect(g, x - 8, y, 16, 4, C.gray);
}

function drawTower(g, p, t) {
  const tx = 300;
  rect(g, tx - 14, 150, 4, BASE - 150, C.rust);
  rect(g, tx + 10, 150, 4, BASE - 150, C.rust);
  for (let y = 156; y < BASE; y += 14) { line(g, tx - 12, y, tx + 12, y + 12, C.rust); line(g, tx + 12, y, tx - 12, y + 12, C.rust); }
  rect(g, tx - 16, 146, 32, 6, C.darkgray);
  if ((t * 1.5 | 0) % 2) disc(g, tx, 143, 2, C.red);
  // fuel arm + gauge
  rect(g, tx + 14, 220, RX - tx - 26, 3, C.gray);
  rect(g, tx - 40, 170, 14, 100, C.ink);
  rect(g, tx - 38, 172, 10, 96, C.darkgray);
  const h = Math.round(96 * p);
  rect(g, tx - 38, 268 - h, 10, h, p > 0.9 ? C.lime : p > 0.5 ? C.yellow : C.amber);
  for (let y = 180; y < 268; y += 12) rect(g, tx - 38, y, 3, 1, C.ink);
  drawText(g, '燃料', tx - 33, 272, C.paper, { align: 'center', outline: C.ink });
  drawText(g, `${Math.floor(p * 100)}%`, tx - 33, 156, C.paper, { align: 'center', outline: C.ink });
}

function drawChecklist(g, p) {
  rect(g, 24, 120, 124, 132, C.ink);
  rect(g, 26, 122, 120, 128, C.navy);
  drawText(g, '發射檢查清單', 86, 126, C.yellow, { align: 'center' });
  rect(g, 30, 141, 112, 1, C.blue);
  CHECKS.forEach((label, i) => {
    const done = p >= (i + 1) / (CHECKS.length + 1);
    const y = 148 + i * 16;
    rect(g, 34, y + 2, 9, 9, C.paper); rect(g, 35, y + 3, 7, 7, done ? C.green : C.navy);
    if (done) { line(g, 36, y + 6, 38, y + 8, C.paper); line(g, 38, y + 8, 41, y + 4, C.paper); }
    drawText(g, label, 48, y, done ? C.lime : C.lightgray);
  });
}

function scene(g, p, t) {
  bands(g, skyFor(p));
  if (p < 0.75) {
    cloud(g, (t * 4) % 760 - 60, 60, 1, C.paper, C.lightgray, disc);
    cloud(g, (t * 2.5 + 380) % 760 - 60, 100, 1, C.paper, C.lightgray, disc);
  }
  // distant hills
  for (let x = 0; x < 640; x += 2) {
    const h = 22 + Math.sin(x * 0.02) * 10 + Math.sin(x * 0.053) * 6;
    rect(g, x, BASE - h, 2, h, p > 0.75 ? C.plum : C.green);
  }
  grass(g, BASE, 13, C.lime, C.green);
  rect(g, 220, BASE - 6, 220, 8, C.darkgray);
  rect(g, 220, BASE - 6, 220, 2, C.lightgray);
}

export default {
  id: 'rocket',
  name: '火箭升空',
  render(g, p, dt, st) {
    scene(g, p, st.t);
    drawTower(g, p, st.t);
    drawChecklist(g, p);
    // venting vapour grows with fuel
    const vent = clamp((p - 0.3) / 0.7);
    for (let i = 0; i < 4; i++) {
      const k = ((st.t * 0.6 + i / 4) % 1);
      ditherDisc(g, RX + 18 + k * 30, BASE - 20 - k * 16, 3 + k * 8 * vent, C.paper, (1 - k) * vent * 0.8);
    }
    drawRocket(g, RX, BASE - 6, st.t, 0);
    if (st.alert) drawText(g, 'T-1 小時', RX, 160, C.red, { align: 'center', outline: C.paper });
  },
  renderEnd(g, t, st) {
    scene(g, 1, st.t);
    drawTower(g, 1, st.t);
    drawChecklist(g, 1);
    const lift = Math.max(0, t - 1.2);
    const y = BASE - 6 - Math.pow(lift, 2.1) * 30;
    const flame = clamp(t / 1.2);
    // smoke billows
    for (let i = 0; i < 10; i++) {
      const a = i / 10, r = (8 + t * 14) * (0.6 + a * 0.5);
      ditherDisc(g, RX + (a - 0.5) * (40 + t * 60), BASE - 4 - Math.sin(a * 3.1) * 6, Math.min(48, r), C.lightgray, clamp(1 - (t - 4) / 4) * 0.9);
    }
    const shake = t < 2.5 && !st.reduced ? ((st.t * 30 | 0) % 2) : 0;
    drawRocket(g, RX + shake, y, st.t, flame);
    if (t > 2.2) drawText(g, '你終於離開這個星球了', 320, 70, C.yellow, { align: 'center', scale: 2, outline: C.ink });
    return t < 8;
  },
};
