/* themes/command.js — 「特種部隊指揮部」: a war room with radar, route map and
   status meters; the 「下班」 blip closes in on the centre of the radar as p rises.
   End: the red beacon turns green — 任務完成，全員撤離. */

import { C } from '../palette.js';
import { rect, px, disc, ring, line, dither, drawText, drawDigits, clamp, lerp, rng } from '../pixel.js';
import { hms } from '../clock.js';

function room(g, t, alert) {
  rect(g, 0, 0, 640, 360, C.ink);
  for (let x = 0; x < 640; x += 64) { rect(g, x, 0, 62, 270, C.navy); rect(g, x, 0, 62, 1, C.deepblue); }
  dither(g, 0, 0, 640, 270, alert ? C.darkred : C.ink, 0.25);
  // console desk
  rect(g, 0, 276, 640, 84, C.darkgray); rect(g, 0, 276, 640, 3, C.gray); rect(g, 0, 300, 640, 60, C.ink);
  const r = rng(5);
  for (let i = 0; i < 40; i++) {
    const x = 20 + i * 15, y = 284 + (i % 2) * 7;
    const on = Math.sin(t * (0.2 + r() * 0.4) + i) > 0.2;
    rect(g, x, y, 6, 4, on ? [C.lime, C.amber, C.cyan, C.red][i % 4] : C.darkgray);
  }
}

function monitor(g, x, y, w, h, title, col = C.teal) {
  rect(g, x - 4, y - 4, w + 8, h + 8, C.darkgray); rect(g, x - 4, y - 4, w + 8, 2, C.gray);
  rect(g, x, y, w, h, C.ink);
  for (let yy = y + 1; yy < y + h; yy += 3) rect(g, x, yy, w, 1, C.outline);
  drawText(g, title, x + 3, y + 1, col);
  rect(g, x + w / 2 - 6, y + h + 4, 12, 6, C.darkgray);
}

function beacon(g, t, green) {
  rect(g, 18, 14, 28, 6, C.darkgray);
  const on = Math.sin(t * 1.5) > 0;
  disc(g, 32, 10, 9, green ? C.darkgreen : C.darkred);
  disc(g, 32, 10, 7, on ? (green ? C.lime : C.red) : (green ? C.green : C.darkred));
  if (on) { px(g, 29, 7, C.white); }
}

function radar(g, cx, cy, R, p, t, green) {
  const c1 = green ? C.lime : C.cyan, c2 = green ? C.green : C.teal, c3 = green ? C.darkgreen : C.deepblue;
  disc(g, cx, cy, R, C.outline);
  for (let k = 1; k <= 3; k++) ring(g, cx, cy, R * k / 3, c3);
  line(g, cx - R, cy, cx + R, cy, c3); line(g, cx, cy - R, cx, cy + R, c3);
  const a = t * 1.8;
  for (let i = 10; i >= 0; i--) {
    const aa = a - i * 0.06;
    line(g, cx, cy, cx + Math.cos(aa) * R, cy + Math.sin(aa) * R, i < 2 ? c1 : i < 6 ? c2 : c3);
  }
  // blips
  const bearing = -0.7;
  const d = R * lerp(0.92, 0.04, p);
  const bx = cx + Math.cos(bearing) * d, by = cy + Math.sin(bearing) * d;
  const since = ((a - bearing) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  if (since < 2.2 || green) { rect(g, bx - 1, by - 1, 3, 3, since < 0.6 ? C.white : c1); drawText(g, '下班', bx + 4, by - 6, c1); }
  rect(g, cx - 1, cy - 1, 3, 3, C.yellow);
  const r = rng(77);
  for (let i = 0; i < 6; i++) { const ba = r() * 6.28, bd = r() * R * 0.9; const s2 = ((a - ba) % 6.28 + 6.28) % 6.28; if (s2 < 1.5) px(g, cx + Math.cos(ba) * bd, cy + Math.sin(ba) * bd, c2); }
}

function mapScreen(g, x, y, w, h, p, t) {
  for (let gx = x + 6; gx < x + w; gx += 12) for (let gy = y + 14; gy < y + h; gy += 2) px(g, gx, gy, C.deepblue);
  for (let gy = y + 18; gy < y + h; gy += 12) for (let gx = x; gx < x + w; gx += 2) px(g, gx, gy, C.deepblue);
  const pts = [[x + 14, y + h - 16], [x + 50, y + h - 40], [x + 82, y + 46], [x + 120, y + 60], [x + w - 16, y + 24]];
  for (let i = 0; i < pts.length - 1; i++) line(g, ...pts[i], ...pts[i + 1], C.teal);
  // marker at p along the polyline
  let total = 0; const seg = [];
  for (let i = 0; i < pts.length - 1; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(L); total += L; }
  let dist = total * p, i = 0;
  while (i < seg.length - 1 && dist > seg[i]) { dist -= seg[i]; i++; }
  const k = Math.min(1, dist / seg[i]);
  const mx = lerp(pts[i][0], pts[i + 1][0], k), my = lerp(pts[i][1], pts[i + 1][1], k);
  drawText(g, '公司', pts[0][0] - 6, pts[0][1] + 2, C.lightgray);
  drawText(g, '家', pts[4][0] - 4, pts[4][1] - 15, C.lime);
  if (((t * 3) | 0) % 2) { rect(g, mx - 2, my - 2, 5, 5, C.yellow); }
  rect(g, mx - 1, my - 1, 3, 3, C.red);
}

function meters(g, x, y, w, p, t) {
  const rows = [['士氣', lerp(0.2, 1, p), C.lime], ['咖啡因', 0.3 + 0.6 * Math.abs(Math.sin(t * 0.05 + p * 9)), C.amber], ['耐心', lerp(0.95, 0.08, p), C.red]];
  rows.forEach(([label, v, col], i) => {
    const yy = y + 18 + i * 24;
    drawText(g, label, x + 4, yy, C.lightgray);
    rect(g, x + 54, yy + 3, w - 62, 8, C.darkgray);
    rect(g, x + 54, yy + 3, Math.round((w - 62) * clamp(v)), 8, col);
  });
  drawText(g, 'LOG> 一切正常 (大概)', x + 4, y + 92, C.teal);
}

export default {
  id: 'command',
  name: '特種部隊指揮部',
  hud: 'none',
  render(g, p, dt, st) {
    room(g, st.t, st.alert);
    beacon(g, st.t, false);
    drawText(g, '下班作戰指揮部', 56, 4, C.lightgray, { outline: C.ink });
    monitor(g, 34, 64, 170, 120, '路線追蹤');
    monitor(g, 226, 36, 188, 188, '雷達');
    monitor(g, 436, 64, 170, 120, '部隊狀態');
    mapScreen(g, 34, 64, 170, 120, p, st.t);
    radar(g, 320, 134, 80, p, st.t, false);
    meters(g, 436, 64, 170, p, st.t);
    // radio subtitle
    rect(g, 90, 232, 460, 42, C.outline); rect(g, 92, 234, 456, 38, C.ink);
    drawText(g, '無線電', 100, 236, C.red);
    drawText(g, '目標距離下班', 100, 252, C.cyan);
    drawDigits(g, hms(st.remaining), 186, 240, 4, st.alert ? C.orange : C.cyan, { hi: C.white, outline: C.outline });
    drawDigits(g, `${Math.floor(p * 100)}%`, 540, 250, 2, C.teal, { align: 'right' });
  },
  renderEnd(g, t, st) {
    room(g, st.t, false);
    beacon(g, st.t, true);
    drawText(g, '下班作戰指揮部', 56, 4, C.lime, { outline: C.ink });
    monitor(g, 34, 64, 170, 120, '路線追蹤', C.lime);
    monitor(g, 226, 36, 188, 188, '雷達', C.lime);
    monitor(g, 436, 64, 170, 120, '部隊狀態', C.lime);
    mapScreen(g, 34, 64, 170, 120, 1, st.t);
    radar(g, 320, 134, 80, 1, st.t, true);
    meters(g, 436, 64, 170, 1, st.t);
    rect(g, 90, 232, 460, 42, C.outline); rect(g, 92, 234, 456, 38, C.darkgreen);
    const msg = '任務完成，全員撤離';
    drawText(g, msg.slice(0, Math.min(msg.length, (t * 8) | 0)), 320, 240, C.lime, { align: 'center', scale: 2 });
    return t < 6;
  },
};
