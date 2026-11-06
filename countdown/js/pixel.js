/* pixel.js — integer-only drawing primitives, sprite post-processing (auto outline,
   flip, silhouette), the bitmap digit font and crisp pixel text (Cubic 11).
   Everything renders at logical resolution; the stage is scaled up by whole numbers. */

import { C } from './palette.js';

export const W = 640;
export const H = 360;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

export const rect = (g, x, y, w, h, col) => {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = col;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
export const px = (g, x, y, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), 1, 1); };

/** Filled ellipse, one fillRect per scanline so edges stay on the pixel grid. */
export function ellipse(g, cx, cy, rx, ry, col) {
  cx = Math.round(cx); cy = Math.round(cy);
  rx = Math.max(0, rx); ry = Math.max(0, ry);
  g.fillStyle = col;
  const R = Math.round(ry);
  for (let dy = -R; dy <= R; dy++) {
    const t = dy / (ry + 0.5);
    const hw = Math.floor((rx + 0.5) * Math.sqrt(Math.max(0, 1 - t * t)));
    g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}
export const disc = (g, cx, cy, r, col) => ellipse(g, cx, cy, r, r, col);

/** 1px ring. */
export function ring(g, cx, cy, r, col) {
  cx = Math.round(cx); cy = Math.round(cy);
  g.fillStyle = col;
  const steps = Math.max(12, Math.ceil(r * 7));
  let lx = null, ly = null;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (x !== lx || y !== ly) g.fillRect(x, y, 1, 1);
    lx = x; ly = y;
  }
}

/** Bresenham line, optional thickness (square brush). */
export function line(g, x0, y0, x1, y1, col, t = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  g.fillStyle = col;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = Math.floor(t / 2);
  for (let guard = 0; guard < 4000; guard++) {
    g.fillRect(x0 - o, y0 - o, t, t);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Filled polygon via scanline (even-odd), integer rows. */
export function poly(g, pts, col) {
  g.fillStyle = col;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  minY = Math.round(minY); maxY = Math.round(maxY);
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.round(xs[i]), b = Math.round(xs[i + 1]);
      if (b > a) g.fillRect(a, y, b - a, 1);
    }
  }
}

/** Ordered 2x2 dither fill — used for soft glows without leaving the palette. */
export function dither(g, x, y, w, h, col, density = 0.5) {
  g.fillStyle = col;
  const M = [0, 2, 3, 1];
  const th = density * 4;
  x = Math.round(x); y = Math.round(y);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (M[((y + j) & 1) * 2 + ((x + i) & 1)] < th) g.fillRect(x + i, y + j, 1, 1);
  }
}

/** Dithered disc (for halos / dust). */
export function ditherDisc(g, cx, cy, r, col, density = 0.5) {
  cx = Math.round(cx); cy = Math.round(cy);
  g.fillStyle = col;
  const M = [0, 2, 3, 1], th = density * 4, R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const x = cx + dx, y = cy + dy;
    if (M[(y & 1) * 2 + (x & 1)] < th) g.fillRect(x, y, 1, 1);
  }
}

/* ---------- sprite post-processing ---------- */

const hexToRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Add a 1px outline around every opaque pixel. Returns a canvas 2px larger. */
export function outlined(src, col = C.outline, diagonal = false) {
  const w = src.width, h = src.height;
  const { c, g } = makeCanvas(w + 2, h + 2);
  g.drawImage(src, 1, 1);
  const img = g.getImageData(0, 0, w + 2, h + 2), d = img.data;
  const [r, gg, b] = hexToRgb(col);
  const W2 = w + 2, H2 = h + 2;
  const solid = new Uint8Array(W2 * H2);
  for (let i = 0; i < W2 * H2; i++) solid[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = y * W2 + x;
    if (solid[i]) { d[i * 4 + 3] = 255; continue; }
    d[i * 4 + 3] = 0;
    const n = (xx, yy) => xx >= 0 && yy >= 0 && xx < W2 && yy < H2 && solid[yy * W2 + xx];
    let hit = n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1);
    if (!hit && diagonal) hit = n(x - 1, y - 1) || n(x + 1, y - 1) || n(x - 1, y + 1) || n(x + 1, y + 1);
    if (hit) { d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function flipped(src) {
  const { c, g } = makeCanvas(src.width, src.height);
  g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return c;
}

export function silhouette(src, col = C.darkgray) {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = col; g.fillRect(0, 0, src.width, src.height);
  return c;
}

/** Draw a sprite canvas at integer position, optional integer scale. */
export function blit(g, src, x, y, scale = 1) {
  g.drawImage(src, Math.round(x), Math.round(y), src.width * scale, src.height * scale);
}

/* ---------- bitmap digit font (5x7) ---------- */

const GLYPHS = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '.', '#', '.', '#', '.', '.'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
};
const glyphCache = new Map();

function glyph(ch, s, col, hi, shadow, outlineCol) {
  const key = `${ch}|${s}|${col}|${hi}|${shadow}|${outlineCol}`;
  let c = glyphCache.get(key);
  if (c) return c;
  const rows = GLYPHS[ch] || GLYPHS[' '];
  const gw = rows[0].length, sh = shadow ? Math.max(1, Math.round(s / 3)) : 0;
  const { c: cv, g } = makeCanvas(gw * s, 7 * s + sh);
  const cells = (color, oy) => {
    g.fillStyle = color;
    rows.forEach((r, y) => { for (let x = 0; x < gw; x++) if (r[x] === '#') g.fillRect(x * s, y * s + oy, s, s); });
  };
  if (shadow) cells(shadow, sh);
  cells(col, 0);
  if (hi) {
    // two-tone arcade look: upper ~40% of the glyph in the highlight colour
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = hi; g.fillRect(0, 0, gw * s, Math.round(7 * s * 0.42));
    if (shadow) { g.fillStyle = shadow; g.fillRect(0, 7 * s, gw * s, sh); }
    g.globalCompositeOperation = 'source-over';
  }
  c = outlineCol ? outlined(cv, outlineCol) : cv;
  glyphCache.set(key, c);
  return c;
}

export function measureDigits(str, s = 1) {
  let w = 0;
  for (const ch of str) w += ((GLYPHS[ch] || GLYPHS[' '])[0].length + 1) * s;
  return Math.max(0, w - s);
}

/** Draw digits; returns width. opts: {hi, shadow, outline, align:'left'|'center'|'right'} */
export function drawDigits(g, str, x, y, s, col, opts = {}) {
  const w = measureDigits(str, s);
  let cx = opts.align === 'center' ? x - Math.floor(w / 2) : opts.align === 'right' ? x - w : x;
  const o = opts.outline ? 1 : 0;
  for (const ch of str) {
    const gl = glyph(ch, s, col, opts.hi || null, opts.shadow || null, opts.outline || null);
    g.drawImage(gl, Math.round(cx) - o, Math.round(y) - o);
    cx += ((GLYPHS[ch] || GLYPHS[' '])[0].length + 1) * s;
  }
  return w;
}

/* ---------- pixel text (Cubic 11, thresholded so no anti-aliasing survives) ---------- */

export const FONT = 'Cubic11';
const textCache = new Map();
let fontReady = false;
export function setFontReady() { fontReady = true; textCache.clear(); }

/** Render a string to a crisp sprite. size 12 = native Cubic 11 grid. */
export function textSprite(str, col, opts = {}) {
  const size = opts.size || 12;
  const key = `${str}|${col}|${size}|${opts.outline || ''}|${fontReady}`;
  let c = textCache.get(key);
  if (c) return c;
  const probe = makeCanvas(1, 1).g;
  probe.font = `${size}px ${FONT}, monospace`;
  const w = Math.ceil(probe.measureText(str).width) + 2;
  const { c: cv, g } = makeCanvas(w, size + 4);
  g.font = `${size}px ${FONT}, monospace`;
  g.textBaseline = 'top';
  g.fillStyle = col;
  g.fillText(str, 0, 1);
  const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
  g.putImageData(img, 0, 0);
  c = opts.outline ? outlined(cv, opts.outline, true) : cv;
  if (textCache.size > 600) textCache.clear();
  textCache.set(key, c);
  return c;
}

/** Draw pixel text. opts: {scale, align, outline, size}. Returns drawn width. */
export function drawText(g, str, x, y, col, opts = {}) {
  const s = opts.scale || 1;
  const sp = textSprite(str, col, opts);
  const w = sp.width * s;
  const dx = opts.align === 'center' ? x - Math.floor(w / 2) : opts.align === 'right' ? x - w : x;
  g.drawImage(sp, Math.round(dx), Math.round(y), sp.width * s, sp.height * s);
  return w;
}

/* ---------- misc ---------- */

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const ease = t => 1 - Math.pow(1 - clamp(t), 3);

/** Deterministic PRNG (mulberry32) so scenes don't flicker frame to frame. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
