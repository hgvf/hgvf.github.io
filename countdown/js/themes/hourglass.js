/* themes/hourglass.js — 「沙漏」: real-looking sand pile shifts from the top bulb
   to the bottom with p. Every so often the neck clogs; click to shake it loose
   (purely cosmetic — time never stops). End: flips over and the sand turns to gold. */

import { C } from '../palette.js';
import { rect, px, disc, ellipse, line, poly, drawText, clamp, lerp, ease, makeCanvas, rng } from '../pixel.js';
import { bands } from './common.js';

const CX = 320, TOP = 108, NECK = 214, BOT = 318, HALF_W = 58;
let stuck = false, stuckCheck = 0, shakeT = -1, grains = [];
const coins = [];

/** Half-width of the glass at a given y (two bulbs meeting at the neck). */
function widthAt(y) {
  const k = y < NECK ? (NECK - y) / (NECK - TOP) : (y - NECK) / (BOT - NECK);
  return 3 + (HALF_W - 3) * Math.sin(Math.min(1, k) * Math.PI / 2) ** 0.8;
}

function drawGlass(g, p, t, sandCol = C.sand, shadeCol = C.tan) {
  // inside of glass (dark)
  for (let y = TOP; y <= BOT; y++) rect(g, CX - widthAt(y), y, widthAt(y) * 2, 1, C.plum);
  // top sand: fills from the neck upward, surface dips in the middle as it drains
  const topLevel = lerp(NECK - 4, TOP + 22, 1 - p);           // y of sand surface
  if (p < 0.995) for (let y = Math.round(topLevel); y < NECK; y++) {
    const w = widthAt(y);
    const dip = Math.max(0, 1 - (y - topLevel) / 14) * 10 * (1 - p);
    rect(g, CX - w, y, w * 2, 1, sandCol);
    if (dip > 0) rect(g, CX - dip, y, dip * 2, 1, C.plum);
  }
  // bottom pile: a mound whose height grows with p
  const H = lerp(0, 80, Math.sqrt(p));
  for (let y = BOT; y > BOT - H; y--) {
    const k = (BOT - y) / Math.max(1, H);
    const w = Math.min(widthAt(y), (HALF_W - 2) * (1 - k * k) + 2);
    rect(g, CX - w, y, w * 2, 1, sandCol);
    rect(g, CX + w * 0.45, y, w * 0.55, 1, shadeCol);
  }
  // falling stream
  if (p > 0.002 && p < 0.998 && !stuck) {
    for (let y = NECK; y < BOT - H; y++) if ((y + (t * 60 | 0)) % 3) px(g, CX, y, sandCol);
  }
  // glass outline + glints
  for (let y = TOP; y <= BOT; y++) {
    const w = widthAt(y);
    px(g, CX - w - 1, y, C.lightsky); px(g, CX + w, y, C.lightsky);
  }
  for (let y = TOP + 10; y < NECK - 24; y += 1) px(g, CX - widthAt(y) + 5, y, C.white);
  for (let y = NECK + 24; y < BOT - 12; y += 2) px(g, CX - widthAt(y) + 5, y, C.lightsky);
}

function frame(g) {
  rect(g, CX - 82, TOP - 14, 164, 12, C.darkbrown); rect(g, CX - 82, TOP - 14, 164, 3, C.tan);
  rect(g, CX - 82, BOT + 2, 164, 12, C.darkbrown); rect(g, CX - 82, BOT + 2, 164, 3, C.tan);
  for (const x of [CX - 76, CX + 70]) { rect(g, x, TOP - 2, 6, BOT - TOP + 4, C.brown); rect(g, x, TOP - 2, 2, BOT - TOP + 4, C.tan); }
}

function room(g, t) {
  bands(g, [[0, C.plum], [200, C.purple], [326, C.darkbrown]]);
  // window with night city
  rect(g, 470, 70, 120, 100, C.darkbrown); rect(g, 476, 76, 108, 88, C.navy);
  for (let i = 0; i < 9; i++) rect(g, 482 + i * 11, 130 - (i * 23 % 40), 9, 34 + (i * 23 % 40), C.deepblue);
  rect(g, 528, 76, 4, 88, C.darkbrown); rect(g, 476, 118, 108, 4, C.darkbrown);
  disc(g, 500, 94, 6, C.cream);
  // bookshelf
  rect(g, 40, 80, 110, 160, C.darkbrown);
  for (let s = 0; s < 4; s++) {
    rect(g, 44, 116 + s * 40, 102, 4, C.brown);
    const r = rng(s + 3);
    for (let x = 46; x < 140;) { const w = 5 + (r() * 6 | 0), h = 18 + (r() * 14 | 0); rect(g, x, 116 + s * 40 - h, w, h, [C.red, C.blue, C.green, C.amber, C.teal][(r() * 5) | 0]); x += w + 1; }
  }
  rect(g, 0, 326, 640, 34, C.darkbrown); rect(g, 0, 326, 640, 3, C.brown);
}

export default {
  id: 'hourglass',
  name: '沙漏',
  render(g, p, dt, st) {
    // every ~5 minutes of real time there's a chance the neck clogs
    const slot = Math.floor(st.now / 300000);
    if (slot !== stuckCheck) { stuckCheck = slot; if (!st.reduced && rng(slot)() < 0.3 && p < 0.97) stuck = true; }
    room(g, st.t);
    let ox = 0;
    if (shakeT >= 0) { shakeT += dt; ox = Math.round(Math.sin(shakeT * 50) * 4 * (1 - shakeT / 0.7)); if (shakeT > 0.7) shakeT = -1; }
    g.save(); g.translate(ox, 0);
    frame(g);
    drawGlass(g, p, st.t);
    g.restore();
    if (stuck) {
      const bob = Math.round(Math.sin(st.t * 4) * 2);
      rect(g, CX + 70, 160 + bob, 104, 34, C.paper); rect(g, CX + 70, 194 + bob, 104, 2, C.lightgray);
      poly(g, [[CX + 72, 178 + bob], [CX + 72, 190 + bob], [CX + 62, 192 + bob]], C.paper);
      drawText(g, '沙卡住了…', CX + 122, 162 + bob, C.ink, { align: 'center' });
      drawText(g, '點一下搖一搖', CX + 122, 177 + bob, C.red, { align: 'center' });
    }
  },
  click(x, y) {
    if (Math.abs(x - CX) < 100 && y > TOP - 20 && y < BOT + 20) { shakeT = 0; const was = stuck; stuck = false; return was ? 'unstuck' : 'shake'; }
    return null;
  },
  renderEnd(g, t, st) {
    room(g, st.t);
    const FLIP = 1.4;
    if (t < FLIP) {
      const a = ease(t / FLIP) * Math.PI;
      const { c, g: og } = makeCanvas(640, 360);
      frame(og); drawGlass(og, 1, st.t);
      g.save(); g.translate(CX, NECK); g.rotate(a); g.drawImage(c, -CX, -NECK); g.restore();
      return true;
    }
    frame(g);
    const k = clamp((t - FLIP) / 3);
    drawGlass(g, 1 - k, st.t, C.yellow, C.amber);
    // coins spill out at the bottom and pile up
    if (coins.length < 70 && Math.random() < 0.6 && t < 6) coins.push({ x: CX + (Math.random() - 0.5) * 30, y: BOT, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 80, rest: false });
    const dt = st.dt || 1 / 60;
    for (const c of coins) {
      if (!c.rest) { c.vy += 300 * dt; c.x += c.vx * dt; c.y += c.vy * dt; if (c.y > 340) { c.y = 340 - (Math.random() * 6 | 0); c.rest = true; } }
      ellipse(g, c.x, c.y, 4, 3, C.amber); ellipse(g, c.x, c.y - 1, 4, 2, C.yellow); px(g, c.x - 1, c.y - 2, C.white);
    }
    if (t > 3) drawText(g, '沙子變成金幣了！', CX, 30, C.yellow, { align: 'center', scale: 2, outline: C.ink });
    return t < 8;
  },
  resetEnd() { coins.length = 0; },
};
