/* themes/common.js — shared scenery helpers: banded + dithered sky gradients,
   twinkling stars, grass strips. All in palette colours. */

import { C } from '../palette.js';
import { rect, dither, rng } from '../pixel.js';

/** Vertical gradient from palette stops [[y, colour], …] with dithered seams. */
export function bands(g, stops, x = 0, w = 640) {
  for (let i = 0; i < stops.length; i++) {
    const [y0, col] = stops[i];
    const y1 = i + 1 < stops.length ? stops[i + 1][0] : 360;
    rect(g, x, y0, w, y1 - y0, col);
  }
  for (let i = 1; i < stops.length; i++) {
    const [y, col] = stops[i];
    const prev = stops[i - 1][1];
    // fade next colour up into the previous band, and previous down into the next
    dither(g, x, y - 6, w, 3, col, 0.25);
    dither(g, x, y - 3, w, 3, col, 0.5);
    dither(g, x, y, w, 3, prev, 0.5);
    dither(g, x, y + 3, w, 3, prev, 0.25);
  }
}

const starCache = new Map();
export function stars(g, seed, n, t, yMax = 260, dim = 0) {
  let list = starCache.get(seed + ':' + n);
  if (!list) {
    const r = rng(seed);
    list = Array.from({ length: n }, () => ({ x: r() * 640 | 0, y: r() * yMax | 0, b: r(), ph: r() * 6 }));
    starCache.set(seed + ':' + n, list);
  }
  for (const s of list) {
    const tw = Math.sin(t * (1 + s.b * 2) + s.ph);
    if (s.b < dim) continue;
    if (s.b > 0.92) {
      g.fillStyle = tw > 0.3 ? C.white : C.lightsky;
      g.fillRect(s.x, s.y, 1, 1);
      if (tw > 0.6) { g.fillStyle = C.lightsky; g.fillRect(s.x - 1, s.y, 3, 1); g.fillRect(s.x, s.y - 1, 1, 3); }
    } else {
      g.fillStyle = tw > -0.2 ? (s.b > 0.6 ? C.lightgray : C.gray) : C.darkgray;
      g.fillRect(s.x, s.y, 1, 1);
    }
  }
}

/** Grass strip with tufts; top edge at y. */
export function grass(g, y, seed = 7, top = C.green, body = C.darkgreen) {
  rect(g, 0, y, 640, 360 - y, body);
  rect(g, 0, y, 640, 2, top);
  const r = rng(seed);
  for (let i = 0; i < 90; i++) {
    const x = r() * 640 | 0, h = 1 + (r() * 3 | 0);
    rect(g, x, y - h, 1, h, top);
  }
  for (let i = 0; i < 140; i++) {
    g.fillStyle = r() < 0.5 ? top : C.ink;
    g.fillRect(r() * 640 | 0, y + 3 + (r() * (357 - y) | 0), 1, 1);
  }
}

/** Little cloud made of discs. */
export function cloud(g, x, y, s, col, shade, disc) {
  disc(g, x, y + 2, 7 * s, shade);
  disc(g, x + 9 * s, y - 2 * s + 2, 9 * s, shade);
  disc(g, x + 20 * s, y + 2, 7 * s, shade);
  disc(g, x, y, 7 * s, col);
  disc(g, x + 9 * s, y - 2 * s, 9 * s, col);
  disc(g, x + 20 * s, y, 7 * s, col);
  rect(g, x - 7 * s, y + 3 * s, 34 * s, 4 * s, col);
}
