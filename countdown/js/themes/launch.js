/* themes/launch.js — 「發射按鈕」: a big red button under a glass cover on a launch
   console. Near the end the two keys turn, a soldier's hand lifts the glass and a
   finger slowly descends; at 下班 it presses. Cut outside: the 「下班」 missile
   leaves from one leg of the triad (picked per day) — silo, submarine, bomber or
   a mobile launcher. Cartoon only. */

import { C } from '../palette.js';
import { rect, px, disc, ellipse, line, poly, dither, ditherDisc, drawText, labelChars, makeCanvas, clamp, lerp, ease, rng } from '../pixel.js';
import { hms } from '../clock.js';
import { sevenSeg } from './segments.js';
import { bands } from './common.js';

const RED = [C.red, C.darkred, C.pink];
const BX = 320, BY = 258;                       // button centre
const PLATFORMS = [
  { id: 'silo', name: '陸基發射井' },
  { id: 'sub', name: '戰略核潛艇' },
  { id: 'bomber', name: '戰略轟炸機' },
  { id: 'tel', name: '機動發射車' },
];

function bunker(g) {
  rect(g, 0, 0, 640, 360, C.darkgray);
  for (let y = 0; y < 150; y += 30) { rect(g, 0, y, 640, 1, C.ink); for (let x = 15; x < 640; x += 60) px(g, x, y + 4, C.gray); }
  // console (sloped desk)
  poly(g, [[0, 150], [640, 150], [640, 360], [0, 360]], C.gray);
  rect(g, 0, 150, 640, 4, C.lightgray);
  rect(g, 0, 340, 640, 20, C.darkgray);
}

function hazardBase(g) {
  const x0 = 244, y0 = 186, w = 152, h = 144;
  rect(g, x0 - 2, y0 - 2, w + 4, h + 4, C.ink);
  rect(g, x0, y0, w, h, C.yellow);
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  for (let k = -h; k < w; k += 22) poly(g, [[x0 + k, y0 + h], [x0 + k + 10, y0 + h], [x0 + k + 10 + h, y0], [x0 + k + h, y0]], C.ink);
  g.restore();
  rect(g, x0 + 18, y0 + 18, w - 36, h - 36, C.darkgray);
}

function button(g, down = 0, glow = 0) {
  if (glow) ditherDisc(g, BX, BY, 60, C.red, 0.35 * glow);
  ellipse(g, BX, BY + 6, 40, 30, C.ink);
  ellipse(g, BX, BY + 2 + down, 38, 28, C.darkred);
  ellipse(g, BX, BY - 2 + down, 36, 26, C.red);
  ellipse(g, BX - 10, BY - 10 + down, 12, 6, C.pink);
}

/** Glass cover, o = 0 closed … 1 fully up (hinged at the back edge). */
function glass(g, o) {
  const top = lerp(206, 104, o), h = lerp(96, 22, o);
  // hinge struts
  line(g, 272, 198, 268, top + 2, C.lightgray, 2); line(g, 368, 198, 372, top + 2, C.lightgray, 2);
  rect(g, 264, top, 112, h, C.lightsky);
  dither(g, 265, top + 1, 110, h - 2, C.cyan, 0.25);
  dither(g, 265, top + 1, 110, h - 2, C.gray, 0.25);
  rect(g, 266, top + 2, 108, h - 4, C.darkgray);
  dither(g, 266, top + 2, 108, h - 4, C.lightsky, 0.25);
  line(g, 276, top + 6, 296, top + Math.min(h - 6, 40), C.white);
  rect(g, 264, top, 112, 1, C.white); rect(g, 264, top + h - 1, 112, 1, C.lightsky);
  if (o < 0.05) drawText(g, '危險', 320, top + 6, C.red, { align: 'center' });
  return { top, bottom: top + h };
}

/** Soldier's hand coming in from the top-right. mode 'grip' | 'point'. */
function hand(g, x, y, mode) {
  // camo sleeve
  line(g, x + 30, y - 20, 720, y - 190, C.darkgreen, 28);
  line(g, x + 30, y - 20, 720, y - 190, C.green, 20);
  const r = rng(3);
  for (let i = 0; i < 14; i++) { const k = r(); disc(g, lerp(x + 40, 700, k), lerp(y - 26, y - 186, k) + (r() - 0.5) * 12, 3, r() < 0.5 ? C.darkgreen : C.tan); }
  rect(g, x + 14, y - 26, 26, 14, C.tan);                                       // cuff
  // fist
  rect(g, x - 14, y - 14, 36, 26, C.peach);
  rect(g, x - 14, y + 10, 36, 2, C.tan);
  for (let i = 0; i < 3; i++) rect(g, x - 10 + i * 10, y - 12, 1, 18, C.tan);
  if (mode === 'point') { rect(g, x - 14, y + 10, 9, 26, C.peach); rect(g, x - 14, y + 34, 9, 2, C.tan); rect(g, x - 12, y + 31, 5, 3, C.cream); }
  else for (let i = 0; i < 4; i++) rect(g, x - 12 + i * 9, y + 10, 7, 8, C.peach);
}

function key(g, x, on, label) {
  disc(g, x, 230, 20, C.ink); disc(g, x, 230, 17, C.lightgray); disc(g, x, 230, 6, C.darkgray);
  if (on) { rect(g, x - 18, 227, 36, 6, C.amber); rect(g, x + 14, 223, 10, 14, C.amber); }
  else { rect(g, x - 3, 212, 6, 36, C.amber); rect(g, x - 7, 204, 14, 10, C.amber); }
  drawText(g, label, x, 256, C.ink, { align: 'center' });
  disc(g, x, 278, 5, on ? C.lime : C.darkgreen);
}

function lamps(g, n) {
  ['待命', '授權', '解鎖', '發射'].forEach((l, i) => {
    const x = 160 + i * 106;
    rect(g, x - 34, 160, 68, 20, C.ink);
    rect(g, x - 32, 162, 64, 16, i < n ? (i === 3 ? C.red : C.lime) : C.darkgray);
    drawText(g, l, x, 163, i < n ? C.ink : C.gray, { align: 'center' });
  });
}

function display(g, rem, t) {
  rect(g, 120, 12, 400, 104, C.outline);
  rect(g, 124, 16, 392, 96, C.ink);
  drawText(g, '發射倒數', 136, 20, C.red);
  sevenSeg(g, hms(rem), 320, 40, RED, { w: 36, h: 62, t: 7, gap: 7, colonW: 16, align: 'center' });
}

/* ---------- outside: the launch ---------- */
function missile(g, x, y, flame = 1, t = 0) {
  if (flame > 0) {
    const L = 16 + flame * 22 + Math.sin(t * 9) * 2;
    poly(g, [[x - 6, y + 64], [x + 6, y + 64], [x, y + 64 + L]], C.orange);
    poly(g, [[x - 3, y + 64], [x + 3, y + 64], [x, y + 64 + L * 0.6]], C.yellow);
  }
  rect(g, x - 7, y, 14, 64, C.paper); rect(g, x + 3, y, 4, 64, C.lightgray);
  poly(g, [[x - 7, y], [x + 7, y], [x, y - 18]], C.red);
  poly(g, [[x - 7, y + 46], [x - 15, y + 64], [x - 7, y + 64]], C.darkgray);
  poly(g, [[x + 7, y + 46], [x + 15, y + 64], [x + 7, y + 64]], C.darkgray);
  labelChars(3).forEach((ch, i) => drawText(g, ch, x - 6, y + 6 + i * 14, C.red));
}

function smokeTrail(g, x, y0, y1, k) {
  for (let y = y0; y > y1; y -= 14) ditherDisc(g, x + Math.sin(y * 0.05) * 4, y, 10 + (y0 - y) * 0.06, C.lightgray, 0.6 * k);
}

function outside(g, t, plat, st) {
  const T = t - 1.1;                         // seconds since the cut
  bands(g, [[0, C.navy], [120, C.purple], [210, C.orange]]);
  let mx = 320, my = 0, flame = 1, ground = null, show = true;
  if (plat === 'silo') {
    rect(g, 0, 300, 640, 60, C.darkgreen); rect(g, 0, 300, 640, 2, C.green);
    rect(g, 270, 292, 100, 10, C.gray);
    const open = ease(clamp(T / 0.9));
    rect(g, 292 - open * 40, 288, 36, 6, C.lightgray); rect(g, 312 + open * 40, 288, 36, 6, C.lightgray);
    ground = 288; my = ground - Math.pow(Math.max(0, T - 0.9), 2) * 80;
  } else if (plat === 'sub') {
    bands(g, [[0, C.navy], [120, C.purple], [200, C.orange], [222, C.deepblue]]);
    for (let x = 0; x < 640; x += 18) rect(g, (x + T * 10) % 660 - 10, 232 + (x % 3) * 12, 8, 1, C.blue);
    poly(g, [[120, 222], [200, 222], [190, 210], [150, 210]], C.ink); rect(g, 160, 198, 18, 12, C.ink);
    ground = 222; my = ground - Math.pow(Math.max(0, T - 0.6), 2) * 80;
    if (T > 0.6 && T < 2.2) ditherDisc(g, 320, 224, 10 + (T - 0.6) * 30, C.paper, 0.6 * (1 - (T - 0.6) / 1.6));
  } else if (plat === 'bomber') {
    rect(g, 0, 320, 640, 40, C.plum);
    const bx = lerp(-120, 760, clamp(T / 4));
    poly(g, [[bx - 60, 120], [bx + 60, 120], [bx + 10, 100], [bx - 10, 100]], C.ink);          // flying wing
    poly(g, [[bx - 60, 120], [bx - 40, 126], [bx, 118], [bx + 40, 126], [bx + 60, 120]], C.ink);
    const relX = lerp(-120, 760, 1.4 / 4);
    if (T < 1.4) show = false;
    else { const k = T - 1.4; mx = relX + k * 20; my = 124 - k * k * 60; flame = clamp(k / 0.3); }
  } else {
    rect(g, 0, 300, 640, 60, C.tan); rect(g, 0, 300, 640, 2, C.sand);
    rect(g, 200, 268, 200, 24, C.darkgreen); rect(g, 380, 252, 40, 40, C.darkgreen); rect(g, 388, 258, 24, 12, C.lightsky);
    for (let i = 0; i < 5; i++) { disc(g, 216 + i * 40, 294, 9, C.ink); disc(g, 216 + i * 40, 294, 4, C.gray); }
    if (T < 1.8) {                                // erector raises the missile
      const raise = ease(clamp(T / 1.4));
      const { c, g: mg } = makeCanvas(40, 110);
      missile(mg, 20, 22, 0);
      g.save(); g.translate(220, 268); g.rotate(Math.PI / 2 * (1 - raise)); g.drawImage(c, -20, -96); g.restore();
      show = false;
    } else { ground = 268 - 74; mx = 220; my = ground - Math.pow(T - 1.8, 2) * 80; }
  }
  if (show) {
    if (ground != null && my < ground - 70) smokeTrail(g, mx, ground + 40, my + 74, 1);
    if (ground != null && plat !== 'tel') { g.save(); g.beginPath(); g.rect(0, 0, 640, ground); g.clip(); }
    missile(g, mx, my, flame, st.t);
    if (ground != null && plat !== 'tel') g.restore();
  }
  if (T > 2.6) {
    drawText(g, '下班飛彈 發射成功', 320, 34, C.yellow, { align: 'center', scale: 2, outline: C.ink });
    drawText(g, `發射平台：${PLATFORMS.find(q => q.id === plat).name}`, 320, 70, C.cream, { align: 'center', outline: C.ink });
  }
}

let plat = null;

export default {
  id: 'launch',
  name: '發射按鈕',
  hud: 'none',
  catSpot: { x: 320, y: 40 },
  render(g, p, dt, st) {
    bunker(g);
    display(g, st.remaining, st.t);
    const keyA = p > 0.8, keyB = p > 0.86;
    key(g, 110, keyA, '鑰匙 A'); key(g, 530, keyB, '鑰匙 B');
    hazardBase(g);
    button(g);
    const o = ease(clamp((p - 0.88) / 0.06));
    const gl = glass(g, o);
    lamps(g, 1 + (keyA && keyB ? 1 : 0) + (o >= 1 ? 1 : 0));
    // the hand: lifts the glass, then points and descends
    if (p > 0.86 && p < 0.94) hand(g, 360, gl.bottom + 6, 'grip');
    else if (p >= 0.94) {
      const k = ease(clamp((p - 0.94) / 0.06));
      hand(g, lerp(360, BX + 10, k), lerp(gl.bottom - 10, BY - 70, k), 'point');
    }
    if (st.alert) drawText(g, p > 0.8 ? '授權碼確認中…' : '最後一小時 · 全員就位', 320, 132, C.yellow, { align: 'center', outline: C.ink });
  },
  renderEnd(g, t, st) {
    if (!plat) plat = PLATFORMS[new Date(st.now).getDate() % PLATFORMS.length].id;
    if (t < 1.1) {
      bunker(g);
      display(g, 0, st.t);
      key(g, 110, true, '鑰匙 A'); key(g, 530, true, '鑰匙 B');
      hazardBase(g);
      const press = t < 0.3 ? t / 0.3 : 1;
      button(g, Math.round(press * 4), press);
      glass(g, 1);
      lamps(g, 4);
      hand(g, BX + 10, BY - 70 + press * 14, 'point');
      if (t > 0.7) dither(g, 0, 0, 640, 360, C.ink, clamp((t - 0.7) / 0.4));
      return true;
    }
    outside(g, t, plat, st);
    return t < 8;
  },
  resetEnd() { plat = null; },
};
