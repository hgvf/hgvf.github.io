/* themes/meteor.js — 招牌主題「隕石墜落」.
   p 0 → 1: a speck far out in space grows, catches fire entering the atmosphere,
   the sky warms to red and the office workers go from strolling to running in
   circles. End: direct hit on the company building, dust, and a 「下班」 sign. */

import { C } from '../palette.js';
import { rect, px, disc, ellipse, line, poly, ditherDisc, dither, drawText, clamp, lerp, ease, rng } from '../pixel.js';
import { worker, sweat } from '../sprites.js';
import { bands, stars } from './common.js';
import { Particles } from '../fx.js';

const BX = 250, BW = 80, BTOP = 196, ROAD = 330;
const START = [604, 24], STOP = [300, 158], IMPACT = [290, 214];
const WORKER_COLS = [C.blue, C.red, C.green, C.purple, C.teal, C.rust];

const city = (() => {
  const r = rng(42), out = [];
  let x = -10;
  while (x < 650) {
    const w = 24 + (r() * 36 | 0), h = 30 + (r() * 70 | 0);
    if (x + w < BX - 6 || x > BX + BW + 6) out.push({ x, w, h, seed: r() * 1e6 | 0 });
    x += w + 2 + (r() * 6 | 0);
  }
  return out;
})();
const workers = (() => {
  const r = rng(9);
  return Array.from({ length: 7 }, (_, i) => ({ x: 150 + i * 46 + r() * 20, ph: r() * 6, col: WORKER_COLS[i % WORKER_COLS.length], speed: 6 + r() * 6 }));
})();

function meteorAt(p) {
  const e = Math.pow(p, 1.7);
  return { x: lerp(START[0], STOP[0], e), y: lerp(START[1], STOP[1], e), r: lerp(0.6, 22, Math.pow(p, 2.1)) };
}

function drawMeteor(g, x, y, r, heat, t) {
  const dirx = 0.913, diry = -0.408;                         // trail points back up-right
  if (heat > 0) {
    ditherDisc(g, x, y, r * 2.1, C.amber, 0.22 * heat);
    ditherDisc(g, x, y, r * 1.5, C.orange, 0.4 * heat);
    const N = 9, len = r * (1.2 + heat * 4.2);
    const cols = [C.darkred, C.red, C.red, C.orange, C.orange, C.amber, C.yellow, C.cream, C.white];
    for (let i = N - 1; i >= 0; i--) {
      const k = i / (N - 1);
      const j = Math.sin(t * 23 + i * 1.7) * r * 0.12;
      const cx = x + dirx * len * k + diry * j, cy = y + diry * len * k - dirx * j;
      disc(g, cx, cy, Math.max(1, r * (1.15 - k * 0.85)), cols[N - 1 - i]);
    }
  }
  if (r < 1.5) { px(g, x, y, heat > 0 ? C.amber : C.pink); return; }
  disc(g, x + 1, y + 1, r, C.darkbrown);
  disc(g, x, y, r, C.brown);
  const rr = rng(7);
  const rot = t * 0.15;
  for (let i = 0; i < 6; i++) {
    const a = rr() * 6.28 + rot, d = rr() * r * 0.6, cr = Math.max(1, r * (0.12 + rr() * 0.14));
    disc(g, x + Math.cos(a) * d, y + Math.sin(a) * d, cr, C.darkbrown);
    px(g, x + Math.cos(a) * d - cr * 0.4, y + Math.sin(a) * d - cr * 0.4, C.tan);
  }
  ellipse(g, x - r * 0.35, y - r * 0.4, r * 0.3, r * 0.18, C.tan);
  if (heat > 0.3) {                                          // glowing leading edge
    for (let a = 2.2; a < 4.4; a += 0.08) {
      px(g, x + Math.cos(a + 1.2) * r, y + Math.sin(a + 1.2) * r, heat > 0.7 ? C.yellow : C.orange);
    }
  }
}

function drawCity(g, p, t, glow) {
  for (const b of city) {
    const top = ROAD - b.h;
    rect(g, b.x, top, b.w, b.h, glow > 0.5 ? C.plum : C.navy);
    rect(g, b.x, top, b.w, 1, glow > 0.5 ? C.purple : C.deepblue);
    const r = rng(b.seed);
    for (let wy = top + 5; wy < ROAD - 6; wy += 7) for (let wx = b.x + 3; wx < b.x + b.w - 3; wx += 6) {
      const on = r() < 0.35 + p * 0.35;
      if (on) { g.fillStyle = r() < 0.15 ? C.cream : C.amber; g.fillRect(wx, wy, 2, 3); }
    }
  }
}

function drawBuilding(g, p, t) {
  const shake = p > 0.88 ? (((t * 28) | 0) % 2 ? 1 : -1) * Math.ceil((p - 0.88) * 12) : 0;
  const x = BX + shake;
  rect(g, x, BTOP, BW, ROAD - BTOP, C.lightgray);
  rect(g, x + BW - 10, BTOP, 10, ROAD - BTOP, C.gray);
  rect(g, x, BTOP, BW, 3, C.paper);
  // billboard + antenna
  rect(g, x + 14, BTOP - 20, 44, 18, C.darkgray);
  rect(g, x + 16, BTOP - 18, 40, 14, C.navy);
  drawText(g, '公司', x + 36, BTOP - 18, C.yellow, { align: 'center' });
  line(g, x + 64, BTOP, x + 64, BTOP - 26, C.gray);
  if (((t * 2) | 0) % 2) disc(g, x + 64, BTOP - 27, 1, C.red);
  // windows
  const panic = clamp((p - 0.82) / 0.18);
  const r = rng(3);
  for (let wy = BTOP + 8, row = 0; wy < ROAD - 18; wy += 12, row++) {
    for (let wx = x + 6, col = 0; wx < x + BW - 14; wx += 11, col++) {
      const lit = r() < 0.7;
      const flick = panic > 0 && Math.sin(t * 17 + row * 3 + col) > 1 - panic * 1.4;
      rect(g, wx, wy, 7, 8, lit && !flick ? C.yellow : C.deepblue);
      rect(g, wx, wy + 8, 7, 1, C.gray);
      if (lit && !flick && r() < 0.35) {             // a tiny colleague at the window
        const look = p > 0.55;
        rect(g, wx + 2, wy + 3, 3, 3, C.peach);
        if (look) px(g, wx + 3, wy + 3, C.ink);
        if (panic > 0.3 && (row + col) % 2) { rect(g, wx + 1, wy + 1, 1, 3, C.peach); rect(g, wx + 5, wy + 1, 1, 3, C.peach); }
      }
    }
  }
  // door
  rect(g, x + 28, ROAD - 16, 18, 16, C.deepblue);
  rect(g, x + 36, ROAD - 16, 1, 16, C.lightsky);
  rect(g, x + 24, ROAD - 18, 26, 2, C.darkgray);
}

function drawRoad(g) {
  rect(g, 0, ROAD, 640, 30, C.darkgreen);
  rect(g, 0, ROAD, 640, 8, C.darkgray);
  rect(g, 0, ROAD, 640, 1, C.gray);
  for (let x = 4; x < 640; x += 20) rect(g, x, ROAD + 4, 9, 1, C.lightgray);
  rect(g, 0, ROAD + 8, 640, 2, C.green);
  const r = rng(11);
  for (let i = 0; i < 120; i++) { g.fillStyle = r() < 0.5 ? C.green : C.ink; g.fillRect(r() * 640 | 0, ROAD + 11 + (r() * 18 | 0), 1, 1); }
}

function drawWorkers(g, p, t, party = 0) {
  const look = clamp((p - 0.55) / 0.15), panic = clamp((p - 0.78) / 0.15);
  workers.forEach((w, i) => {
    const isPanic = panic > i / workers.length;
    let x = w.x, y = ROAD - 12, frame = 0;
    if (party) { y -= Math.abs(Math.sin(t * 7 + i)) * 8; frame = (t * 8 | 0); }
    else if (isPanic) { x += Math.sin(t * 3.2 + w.ph) * 26; frame = (t * 14 | 0) + i; }
    else if (look < 0.5 || i % 2) { x += Math.sin(t * 0.25 * (w.speed / 8) + w.ph) * 14; frame = (t * 5 | 0) + i; }
    g.drawImage(worker(w.col, frame, isPanic || !!party), Math.round(x), y);
    if (isPanic && !party && ((t * 3 + i) | 0) % 2) g.drawImage(sweat(), Math.round(x) + 7, y - 3);
    if (!party && look >= 0.5 && !isPanic && i % 2 === 0) drawText(g, '?', x + 1, y - 13, C.paper);
    if (isPanic && !party && i % 3 === 0) drawText(g, '!', x + 2, y - 14, C.yellow);
  });
}

function sky(g, p, t, alert) {
  const glow = clamp((p - 0.55) / 0.4);
  bands(g, [
    [0, C.ink],
    [70, C.navy],
    [170, glow > 0.3 ? C.plum : C.deepblue],
    [240, glow > 0.65 ? C.darkred : glow > 0.2 ? C.plum : C.deepblue],
    [290, glow > 0.85 ? C.red : glow > 0.4 ? C.darkred : C.plum],
  ]);
  stars(g, 5, 160, t, 250, glow * 0.85);
  if (alert) dither(g, 0, 0, 640, 12, C.darkred, 0.25);
  return glow;
}

const fx = new Particles(800);
let lastEndT = 0;

export default {
  id: 'meteor',
  name: '隕石墜落',
  render(g, p, dt, st) {
    const glow = sky(g, p, st.t, st.alert);
    drawCity(g, p, st.t, glow);
    const m = meteorAt(p);
    const heat = clamp((p - 0.5) / 0.35);
    drawMeteor(g, m.x, m.y, m.r, heat, st.t);
    drawBuilding(g, p, st.t);
    drawRoad(g);
    drawWorkers(g, p, st.t);
  },
  /** t = seconds since 下班. Returns false once the animation has settled. */
  renderEnd(g, t, st) {
    if (t < lastEndT) fx.clear();
    lastEndT = t;
    const dt = st.dt || 1 / 60;
    sky(g, 1, st.t, false);
    drawCity(g, 1, st.t, 1);
    const HIT = 0.7;
    if (t < HIT) {
      const k = ease(t / HIT);
      drawMeteor(g, lerp(STOP[0], IMPACT[0], k), lerp(STOP[1], IMPACT[1], k), lerp(22, 26, k), 1, st.t);
      drawBuilding(g, 1, st.t);
      drawRoad(g);
      drawWorkers(g, 1, st.t);
      return true;
    }
    if (!this._hit || t - HIT < 0.05) {
      this._hit = true;
      if (fx.count === 0) {
        fx.dust(IMPACT[0], 300, 90, C.lightgray, 160);
        fx.dust(IMPACT[0], 300, 50, C.amber, 120);
        fx.burst(IMPACT[0], 260, 'fire', 3);
      }
    }
    drawRoad(g);
    // rubble + embers
    poly(g, [[228, ROAD], [246, 300], [270, 292], [300, 286], [322, 296], [350, ROAD]], C.darkgray);
    poly(g, [[244, ROAD], [262, 306], [290, 298], [318, 308], [334, ROAD]], C.gray);
    for (let i = 0; i < 14; i++) {
      const ex = 246 + (i * 37) % 96, ey = 304 + (i * 13) % 22;
      if (Math.sin(st.t * 6 + i) > 0) px(g, ex, ey, i % 2 ? C.orange : C.yellow);
    }
    rect(g, 256, 312, 10, 6, C.lightgray); rect(g, 300, 316, 12, 5, C.lightgray); rect(g, 280, 318, 8, 4, C.paper);
    // sign rises from the rubble
    const s = clamp((t - 2.6) / 1.2);
    if (s > 0) {
      const sy = lerp(330, 238, ease(s));
      rect(g, 287, sy + 34, 4, ROAD - sy - 34, C.brown);
      rect(g, 253, sy, 72, 36, C.darkgreen);
      rect(g, 255, sy + 2, 68, 32, C.green);
      rect(g, 257, sy + 4, 64, 28, C.darkgreen);
      drawText(g, '下班', 289, sy + 5, C.paper, { align: 'center', scale: 2 });
      if (s >= 1) for (let i = 0; i < 6; i++) {
        const a = st.t * 1.5 + i * 1.05, sx = 289 + Math.cos(a) * 52, sy2 = sy + 18 + Math.sin(a) * 30;
        if ((st.t * 4 + i | 0) % 2) { px(g, sx, sy2, C.yellow); px(g, sx - 1, sy2, C.cream); px(g, sx + 1, sy2, C.cream); px(g, sx, sy2 - 1, C.cream); px(g, sx, sy2 + 1, C.cream); }
      }
    }
    // dust cloud (fades)
    const d = clamp((t - HIT) / 3.6);
    if (d < 1) {
      const R = lerp(16, 92, ease(Math.min(1, d * 1.6)));
      const dens = d < 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
      const blobs = [[0, 0, 1], [-0.7, 0.25, 0.7], [0.75, 0.2, 0.75], [-0.3, -0.5, 0.65], [0.35, -0.45, 0.6], [0, 0.4, 0.8]];
      for (const [ox, oy, k] of blobs) {
        ditherDisc(g, IMPACT[0] + ox * R, 290 + oy * R * 0.6, R * k * 0.62, C.gray, dens * 0.9);
        ditherDisc(g, IMPACT[0] + ox * R - 2, 286 + oy * R * 0.6, R * k * 0.48, C.lightgray, dens * 0.85);
      }
    }
    fx.update(dt); fx.draw(g);
    drawWorkers(g, 1, st.t, t > 3 ? 1 : 0);
    if (t - HIT < 0.16 && !st.reduced) { g.fillStyle = C.white; g.fillRect(0, 0, 640, 360); }
    return t < 8;
  },
  resetEnd() { fx.clear(); this._hit = false; lastEndT = 0; },
};
