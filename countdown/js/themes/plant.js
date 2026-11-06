/* themes/plant.js — 「植物生長」: a seed becomes a tree as p rises. The fruit on
   it = hours still to go, ripening green → orange → red. The sun crosses the
   sky. End: every fruit ripens and drops. */

import { C } from '../palette.js';
import { rect, px, disc, ellipse, line, drawText, clamp, lerp, ease, rng } from '../pixel.js';
import { bands, grass, cloud } from './common.js';

const TX = 300, GROUND = 320;
const SLOTS = (() => {
  const r = rng(31), out = [];
  for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, d = 0.25 + r() * 0.6; out.push([Math.cos(a) * d, Math.sin(a) * d * 0.7]); }
  return out;
})();

function sky(g, p, t) {
  const dusk = p > 0.8;
  bands(g, dusk ? [[0, C.blue], [120, C.pink], [230, C.amber]] : [[0, C.sky], [140, C.lightsky]]);
  const a = lerp(Math.PI * 0.92, Math.PI * 0.08, p);
  const sx = 320 + Math.cos(a) * 300, sy = 250 - Math.sin(a) * 190;
  disc(g, sx, sy, 15, dusk ? C.orange : C.amber); disc(g, sx, sy, 12, dusk ? C.amber : C.yellow); rect(g, sx - 6, sy - 7, 4, 3, C.cream);
  cloud(g, (t * 3) % 760 - 60, 74, 1, C.paper, C.lightgray, disc);
  cloud(g, (t * 2 + 420) % 760 - 60, 120, 1, C.paper, C.lightgray, disc);
}

function tree(g, p, t, fruits, ripe) {
  const sway = Math.round(Math.sin(t * 0.8) * 1.5);
  if (p < 0.06) {                                  // seed in soil
    ellipse(g, TX, GROUND + 4, 4, 3, C.darkbrown); px(g, TX - 1, GROUND + 3, C.tan);
    return [];
  }
  if (p < 0.2) {                                   // sprout
    const h = lerp(4, 22, (p - 0.06) / 0.14);
    line(g, TX, GROUND, TX + sway, GROUND - h, C.green, 2);
    ellipse(g, TX - 5 + sway, GROUND - h, 5, 2, C.lime);
    ellipse(g, TX + 5 + sway, GROUND - h - 2, 5, 2, C.green);
    return [];
  }
  const k = clamp((p - 0.2) / 0.6);
  const H = lerp(30, 140, ease(k)), trunkW = Math.round(lerp(3, 14, k));
  rect(g, TX - trunkW / 2, GROUND - H, trunkW, H, C.brown);
  rect(g, TX - trunkW / 2, GROUND - H, Math.max(1, trunkW / 3), H, C.tan);
  line(g, TX, GROUND - H * 0.55, TX - H * 0.28, GROUND - H * 0.8, C.brown, Math.max(2, trunkW / 3));
  line(g, TX, GROUND - H * 0.62, TX + H * 0.3, GROUND - H * 0.86, C.brown, Math.max(2, trunkW / 3));
  const R = lerp(14, 84, ease(k)), cy = GROUND - H - R * 0.25;
  const blob = (dx, dy, rr, col) => ellipse(g, TX + dx * R + sway, cy + dy * R, rr * R, rr * R * 0.78, col);
  blob(0, 0.08, 1, C.darkgreen);
  blob(-0.45, 0.12, 0.62, C.darkgreen); blob(0.48, 0.1, 0.6, C.darkgreen);
  blob(0, -0.02, 0.92, C.green); blob(-0.42, 0.06, 0.55, C.green); blob(0.45, 0.04, 0.55, C.green);
  blob(-0.25, -0.3, 0.38, C.lime); blob(0.2, -0.36, 0.3, C.lime);
  // fruit positions
  const pts = [];
  for (let i = 0; i < Math.min(fruits, SLOTS.length); i++) pts.push([TX + SLOTS[i][0] * R * 0.95 + sway, cy + SLOTS[i][1] * R]);
  if (p >= 0.2) for (const [x, y] of pts) {
    const col = ripe < 0.4 ? C.lime : ripe < 0.75 ? C.amber : C.red;
    disc(g, x, y, 4, C.outline); disc(g, x, y, 3, col); px(g, x - 1, y - 2, C.white); rect(g, x, y - 5, 1, 2, C.darkbrown);
  }
  return pts;
}

let drops = null;

export default {
  id: 'plant',
  name: '植物生長',
  render(g, p, dt, st) {
    sky(g, p, st.t);
    grass(g, GROUND, 17, C.lime, C.green);
    rect(g, TX - 28, GROUND + 1, 56, 6, C.darkbrown);
    const hours = Math.ceil(st.remaining / 3600e3);
    tree(g, p, st.t, hours, p);
    if (p >= 0.2) drawText(g, `樹上 ${hours} 顆果實 = 還剩 ${hours} 小時`, TX, GROUND + 14, C.paper, { align: 'center', outline: C.darkgreen });
    else drawText(g, p < 0.06 ? '一顆種子，跟你一樣剛到公司' : '發芽了', TX, GROUND + 14, C.paper, { align: 'center', outline: C.darkgreen });
  },
  renderEnd(g, t, st) {
    sky(g, 1, st.t);
    grass(g, GROUND, 17, C.lime, C.green);
    const pts = tree(g, 1, st.t, 0, 1);
    if (!drops) {
      drops = SLOTS.slice(0, 9).map(([dx, dy], i) => ({ x: TX + dx * 80, y: 320 - 140 - 21 + dy * 84, vy: 0, delay: 0.3 + i * 0.25, bounced: 0 }));
    }
    const dt = st.dt || 1 / 60;
    for (const d of drops) {
      if (t > d.delay) {
        d.vy += 420 * dt; d.y += d.vy * dt;
        if (d.y > GROUND + 4) { d.y = GROUND + 4; d.vy = d.bounced < 2 ? -d.vy * 0.35 : 0; d.bounced++; }
      }
      disc(g, d.x, d.y, 4, C.outline); disc(g, d.x, d.y, 3, C.red); px(g, d.x - 1, d.y - 2, C.white);
    }
    if (t > 3) drawText(g, '果實全熟了，你也是', TX, 34, C.red, { align: 'center', scale: 2, outline: C.paper });
    return t < 7;
  },
  resetEnd() { drops = null; },
};
