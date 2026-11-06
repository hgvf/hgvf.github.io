/* sprites.js — the cast (duck, bear, dog, cat) and props, drawn procedurally on
   small pixel grids, cel-shaded, then auto-outlined and cached. Every sprite
   faces right; pass flip:true for the mirrored copy.

   animal(kind, pose, frame, {hat, skin, flip}) → canvas (50×50 incl. outline)
   Poses — duck: walk stand peck flap cry · bear: walk stand hold yawn sip
           dog: walk stand sniff wag carry · cat: walk stand push sit sleep          */

import { C } from './palette.js';
import { makeCanvas, rect, px, ellipse, disc, line, poly, outlined, flipped, silhouette, drawDigits, textSprite } from './pixel.js';

const cache = new Map();
function cached(key, w, h, draw, outline = true) {
  let c = cache.get(key);
  if (c) return c;
  const { c: cv, g } = makeCanvas(w, h);
  draw(g);
  c = outline ? outlined(cv) : cv;
  cache.set(key, c);
  return c;
}
function variant(key, base, fn) {
  let c = cache.get(key);
  if (!c) { c = fn(base); cache.set(key, c); }
  return c;
}

export const ANIMALS = ['duck', 'bear', 'dog', 'cat'];
export const ANIMAL_NAMES = { duck: '鴨子', bear: '熊熊', dog: '狗', cat: '貓' };
export const SKIN_NAMES = { duck: '墨鏡鴨', bear: '睡帽熊', dog: '領巾狗', cat: '蝴蝶結貓' };

export function animal(kind, pose = 'stand', frame = 0, opts = {}) {
  const f = frame | 0;
  const key = `${kind}|${pose}|${f}|${opts.hat ? 1 : 0}|${opts.skin ? 1 : 0}`;
  const base = cached(key, 48, 48, g => DRAW[kind](g, pose, f, opts));
  if (opts.silhouette) return variant(key + '|sil', base, b => silhouette(b, C.darkgray));
  return opts.flip ? variant(key + '|flip', base, flipped) : base;
}

/* ---------- party hat (shared) ---------- */
function partyHat(g, cx, top) {
  poly(g, [[cx - 5, top + 10], [cx + 5, top + 10], [cx, top]], C.pink);
  rect(g, cx - 3, top + 6, 6, 1, C.cyan);
  rect(g, cx - 2, top + 3, 4, 1, C.yellow);
  disc(g, cx, top - 1, 1, C.yellow);
}

/* ---------- duck ---------- */
function drawDuck(g, pose, f, o) {
  const walk = pose === 'walk';
  const sit = pose === 'cry';
  const bob = walk ? (f % 2) : 0;
  const oy = (sit ? 4 : 0) - bob;
  // legs
  if (!sit) {
    const a = walk ? [0, 2, 0, -2][f % 4] : 0;
    rect(g, 19 + a, 40, 2, 5, C.orange); rect(g, 18 + a, 45, 5, 1, C.orange);
    rect(g, 25 - a, 40, 2, 5, C.orange); rect(g, 24 - a, 45, 5, 1, C.orange);
  } else {
    rect(g, 30, 45, 6, 1, C.orange); rect(g, 13, 45, 5, 1, C.orange);
  }
  // tail
  poly(g, [[8, 27 + oy], [15, 25 + oy], [15, 33 + oy]], C.amber);
  // body (cel: amber rim underneath)
  ellipse(g, 22, 34 + oy, 13, 8, C.amber);
  ellipse(g, 22, 32 + oy, 12, 8, C.yellow);
  ellipse(g, 18, 28 + oy, 5, 2, C.cream);
  // neck + head
  const peck = pose === 'peck';
  const hx = peck ? 34 : 31, hy = (peck ? 24 : 17) + oy;
  ellipse(g, 28, 25 + oy, 5, 5, C.yellow);
  disc(g, hx, hy + 1, 7, C.amber);
  disc(g, hx, hy, 7, C.yellow);
  rect(g, hx - 4, hy - 5, 3, 2, C.cream);
  // beak
  if (peck) {
    rect(g, hx + 4, hy + 2, 4, 6, C.orange); rect(g, hx + 4, hy + 7, 3, 1, C.rust);
  } else if (sit) {
    rect(g, hx + 5, hy, 7, 2, C.orange);            // open, wailing
    rect(g, hx + 5, hy + 2, 6, 1, C.darkred);
    rect(g, hx + 5, hy + 3, 6, 2, C.rust);
  } else {
    rect(g, hx + 5, hy, 7, 3, C.orange); rect(g, hx + 5, hy + 3, 6, 1, C.rust);
  }
  // eye
  if (sit) {
    rect(g, hx + 1, hy - 2, 3, 1, C.ink); px(g, hx + 1, hy - 3, C.ink);       // squeezed ><
    rect(g, hx + 2, hy - 1, 1, 2, C.cyan);
  } else {
    rect(g, hx + 2, hy - 3, 2, 3, C.ink); px(g, hx + 2, hy - 3, C.white);
  }
  rect(g, hx, hy + 2, 2, 1, C.pink);
  // wing
  if (pose === 'flap') {
    const up = f % 2 === 0;
    if (up) poly(g, [[13, 30 + oy], [24, 29 + oy], [11, 15 + oy], [7, 20 + oy]], C.amber);
    else poly(g, [[13, 30 + oy], [24, 29 + oy], [6, 36 + oy], [5, 31 + oy]], C.amber);
    if (up) line(g, 12, 18 + oy, 20, 28 + oy, C.yellow);
  } else if (sit) {
    ellipse(g, 31, 31 + oy, 4, 3, C.amber);               // wing wiping tears
  } else {
    ellipse(g, 19, 32 + oy, 8, 4, C.amber);
    rect(g, 13, 31 + oy, 10, 1, C.yellow);
  }
  if (o.skin && !sit) {                                    // sunglasses
    rect(g, hx - 1, hy - 4, 8, 3, C.ink); rect(g, hx - 6, hy - 4, 5, 1, C.ink);
    px(g, hx + 4, hy - 4, C.white);
  }
  if (o.hat) partyHat(g, hx - 1, hy - 18);
}

/* ---------- bear ---------- */
function drawBear(g, pose, f, o) {
  const walk = pose === 'walk';
  const oy = walk ? -(f % 2) : 0;
  const sleepy = pose === 'hold' && f < 6;
  // legs
  const la = walk ? [0, -2, 0, 2][f % 4] : 0;
  ellipse(g, 16, 44 + Math.min(0, la), 5, 3, C.brown);
  ellipse(g, 32, 44 + Math.min(0, -la), 5, 3, C.brown);
  rect(g, 14, 44 + Math.min(0, la), 4, 2, C.sand); rect(g, 30, 44 + Math.min(0, -la), 4, 2, C.sand);
  // body
  ellipse(g, 24, 36 + oy, 13, 9, C.darkbrown);
  ellipse(g, 24, 35 + oy, 13, 9, C.brown);
  ellipse(g, 24, 37 + oy, 7, 6, C.sand);
  // ears
  disc(g, 14, 9 + oy, 5, C.brown); disc(g, 34, 9 + oy, 5, C.brown);
  disc(g, 14, 9 + oy, 2, C.tan); disc(g, 34, 9 + oy, 2, C.tan);
  // head
  disc(g, 24, 18 + oy, 11, C.darkbrown);
  disc(g, 24, 17 + oy, 11, C.brown);
  rect(g, 17, 9 + oy, 5, 2, C.tan);
  ellipse(g, 24, 22 + oy, 6, 4, C.sand);
  ellipse(g, 24, 20 + oy, 2, 1, C.ink);
  // eyes / mouth
  const closed = sleepy || pose === 'yawn';
  if (closed) {
    rect(g, 16, 16 + oy, 4, 1, C.ink); rect(g, 28, 16 + oy, 4, 1, C.ink);
  } else {
    rect(g, 17, 14 + oy, 2, 3, C.ink); rect(g, 29, 14 + oy, 2, 3, C.ink);
    px(g, 17, 14 + oy, C.white); px(g, 29, 14 + oy, C.white);
  }
  if (pose === 'yawn') {
    const open = [2, 3, 4, 4, 3][f % 5];
    ellipse(g, 24, 24 + oy, 3, open, C.darkred);
    rect(g, 23, 24 + oy + open - 1, 3, 1, C.pink);
  } else {
    px(g, 23, 24 + oy, C.ink); px(g, 25, 24 + oy, C.ink); px(g, 24, 23 + oy, C.ink);
  }
  rect(g, 14, 20 + oy, 2, 1, C.pink); rect(g, 32, 20 + oy, 2, 1, C.pink);
  // arms
  if (pose === 'hold' || pose === 'sip') {
    ellipse(g, 15, 30 + oy, 4, 4, C.brown); ellipse(g, 33, 30 + oy, 4, 4, C.brown);
  } else {
    const sw = walk ? [0, 1, 0, -1][f % 4] : 0;
    ellipse(g, 11, 34 + oy + sw, 4, 6, C.brown); ellipse(g, 37, 34 + oy - sw, 4, 6, C.brown);
  }
  if (o.skin) {                                            // nightcap
    poly(g, [[13, 9 + oy], [35, 9 + oy], [40, 2 + oy], [22, -1 + oy]], C.blue);
    rect(g, 13, 8 + oy, 22, 2, C.lightsky);
    disc(g, 41, 3 + oy, 2, C.paper);
  }
  if (o.hat) partyHat(g, 24, -4 + oy);
}

/* ---------- dog (shiba-ish) ---------- */
function drawDog(g, pose, f, o) {
  const walk = pose === 'walk';
  const oy = walk ? -(f % 2) : 0;
  // tail (wags in wag / walk)
  const wag = (pose === 'wag' || walk || pose === 'carry') ? [0, 3, 0, -3][f % 4] : 0;
  line(g, 10, 28 + oy, 6 + wag, 19 + oy, C.rust, 3);
  disc(g, 6 + wag, 18 + oy, 2, C.cream);
  // legs
  const a = walk || pose === 'carry' ? [0, 2, 0, -2][f % 4] : 0;
  const leg = (x, d) => { rect(g, x + d, 35 + oy, 3, 8, C.rust); rect(g, x + d, 43, 4, 2, C.cream); };
  leg(12, -a); leg(17, a); leg(26, a); leg(31, -a);
  // body
  ellipse(g, 21, 31 + oy, 13, 7, C.brown);
  ellipse(g, 21, 30 + oy, 13, 7, C.rust);
  ellipse(g, 23, 34 + oy, 9, 3, C.cream);
  rect(g, 13, 25 + oy, 10, 1, C.amber);
  // head
  const sniff = pose === 'sniff';
  const hx = sniff ? 37 : 34, hy = (sniff ? 30 : 20) + oy + (sniff ? f % 2 : 0);
  if (!sniff) ellipse(g, 30, 25 + oy, 5, 5, C.rust);
  poly(g, [[hx - 6, hy - 4], [hx - 4, hy - 12], [hx - 1, hy - 6]], C.rust);
  poly(g, [[hx + 0, hy - 6], [hx + 3, hy - 12], [hx + 5, hy - 3]], C.rust);
  px(g, hx - 4, hy - 8, C.pink); px(g, hx + 3, hy - 8, C.pink);
  disc(g, hx, hy + 1, 7, C.brown);
  disc(g, hx, hy, 7, C.rust);
  ellipse(g, hx + 4, hy + 3, 5, 3, C.cream);
  rect(g, hx + 8, hy + 1, 2, 2, C.ink);
  rect(g, hx + 1, hy - 2, 2, 2, C.ink); px(g, hx + 1, hy - 2, C.white);
  rect(g, hx - 3, hy + 2, 2, 1, C.pink);
  if (pose === 'wag' || walk) { rect(g, hx + 6, hy + 5, 2, 3, C.pink); }
  if (sniff && f % 2) { px(g, hx + 11, hy, C.lightgray); px(g, hx + 12, hy - 2, C.lightgray); }
  if (o.skin) {                                            // red bandana
    poly(g, [[hx - 8, hy + 5], [hx + 1, hy + 6], [hx - 4, hy + 12]], C.red);
    px(g, hx - 5, hy + 7, C.paper); px(g, hx - 3, hy + 8, C.paper);
  }
  if (o.hat) partyHat(g, hx - 1, hy - 20);
}

/* ---------- cat (grey tabby) ---------- */
function drawCat(g, pose, f, o) {
  if (pose === 'sleep') return drawCatSleep(g, f, o);
  const walk = pose === 'walk';
  const sit = pose === 'sit' || pose === 'push';
  const oy = walk ? -(f % 2) : 0;
  const sway = [0, 1, 2, 1][f % 4];
  if (sit) {
    // tail on ground curling forward
    line(g, 12, 44, 30, 44, C.gray, 3);
    // body upright
    ellipse(g, 20, 35, 10, 10, C.darkgray);
    ellipse(g, 20, 34, 10, 10, C.gray);
    ellipse(g, 23, 37, 5, 6, C.lightgray);
    rect(g, 12, 28, 4, 1, C.darkgray); rect(g, 11, 32, 4, 1, C.darkgray);
    rect(g, 22, 44, 4, 2, C.paper); rect(g, 16, 44, 4, 2, C.paper);
  } else {
    line(g, 9, 30 + oy, 4 + sway, 17 + oy, C.gray, 3);
    rect(g, 3 + sway, 15 + oy, 3, 2, C.darkgray);
    const a = walk ? [0, 2, 0, -2][f % 4] : 0;
    const leg = (x, d) => { rect(g, x + d, 36 + oy, 3, 8, C.gray); rect(g, x + d, 43, 3, 2, C.paper); };
    leg(12, -a); leg(16, a); leg(25, a); leg(29, -a);
    ellipse(g, 21, 33 + oy, 12, 6, C.darkgray);
    ellipse(g, 21, 32 + oy, 12, 6, C.gray);
    ellipse(g, 23, 35 + oy, 8, 2, C.lightgray);
    for (const sx of [13, 18, 23]) rect(g, sx, 27 + oy, 2, 3, C.darkgray);
  }
  const hx = sit ? 24 : 33, hy = (sit ? 19 : 24) + oy;
  poly(g, [[hx - 7, hy - 3], [hx - 5, hy - 12], [hx - 1, hy - 6]], C.gray);
  poly(g, [[hx + 1, hy - 6], [hx + 5, hy - 12], [hx + 7, hy - 3]], C.gray);
  px(g, hx - 5, hy - 8, C.pink); px(g, hx + 5, hy - 8, C.pink);
  disc(g, hx, hy + 1, 7, C.darkgray);
  disc(g, hx, hy, 7, C.gray);
  rect(g, hx - 1, hy - 6, 2, 3, C.darkgray);
  // eyes (yellow with slit)
  const blink = pose === 'stand' && f % 8 === 7;
  if (blink) { rect(g, hx - 4, hy - 1, 3, 1, C.ink); rect(g, hx + 2, hy - 1, 3, 1, C.ink); }
  else {
    rect(g, hx - 4, hy - 2, 3, 3, C.yellow); rect(g, hx + 2, hy - 2, 3, 3, C.yellow);
    rect(g, hx - 3, hy - 2, 1, 3, C.ink); rect(g, hx + 3, hy - 2, 1, 3, C.ink);
  }
  px(g, hx, hy + 2, C.pink);
  px(g, hx - 1, hy + 3, C.ink); px(g, hx + 1, hy + 3, C.ink);
  line(g, hx - 9, hy + 1, hx - 5, hy + 2, C.lightgray); line(g, hx + 5, hy + 2, hx + 9, hy + 1, C.lightgray);
  if (pose === 'push') {
    const reach = [0, 3, 6, 6, 3][f % 5];
    rect(g, hx + 2, 32, 6 + reach, 3, C.gray); rect(g, hx + 7 + reach, 31, 3, 4, C.paper);
  }
  if (o.skin) { poly(g, [[hx + 4, hy - 9], [hx + 10, hy - 12], [hx + 10, hy - 6]], C.pink); poly(g, [[hx + 4, hy - 9], [hx - 1, hy - 13], [hx - 1, hy - 6]], C.pink); px(g, hx + 4, hy - 9, C.red); }
  if (o.hat) partyHat(g, hx, hy - 20);
}

function drawCatSleep(g, f, o) {
  const breath = f % 4 < 2 ? 0 : 1;
  ellipse(g, 23, 39 - breath, 16, 6 + breath, C.darkgray);
  ellipse(g, 23, 38 - breath, 16, 6 + breath, C.gray);
  for (const sx of [14, 19, 24, 29]) rect(g, sx, 33 - breath, 2, 3, C.darkgray);
  line(g, 8, 44, 34, 44, C.gray, 3);                       // tail wrapped in front
  rect(g, 30, 43, 4, 2, C.darkgray);
  const hx = 37, hy = 37;
  poly(g, [[hx - 6, hy - 3], [hx - 4, hy - 10], [hx - 1, hy - 5]], C.gray);
  poly(g, [[hx + 1, hy - 5], [hx + 4, hy - 10], [hx + 6, hy - 3]], C.gray);
  disc(g, hx, hy + 1, 6, C.darkgray);
  disc(g, hx, hy, 6, C.gray);
  rect(g, hx - 4, hy, 3, 1, C.ink); rect(g, hx + 2, hy, 3, 1, C.ink);
  px(g, hx, hy + 2, C.pink);
  if (o.skin) { poly(g, [[hx + 3, hy - 8], [hx + 8, hy - 11], [hx + 8, hy - 5]], C.pink); px(g, hx + 3, hy - 8, C.red); }
  if (o.hat) partyHat(g, hx, hy - 18);
}

const DRAW = { duck: drawDuck, bear: drawBear, dog: drawDog, cat: drawCat };

/* ---------- the hour card ("時間牌") ---------- */

/** Card face (40×46 + outline) showing "還剩 N 小時". */
export function cardFace(value, alert = false) {
  const v = String(Math.max(0, value));
  return cached(`card|${v}|${alert}`, 40, 46, g => {
    rect(g, 0, 2, 40, 44, C.lightgray);
    rect(g, 0, 0, 40, 44, C.paper);
    rect(g, 0, 0, 40, 13, alert ? C.darkred : C.red);
    rect(g, 2, 13, 36, 1, C.lightgray);
    g.drawImage(textSprite('還剩', C.paper), 8, 0);
    drawDigits(g, v, 20, 16, 2, C.ink, { align: 'center', hi: C.darkgray });
    g.drawImage(textSprite('小時', C.darkgray), 8, 30);
    px(g, 3, 3, C.yellow); px(g, 36, 3, C.yellow);
  });
}

/** Easel the card hangs on; card origin = (x+2, y+6). Feet rest on y+64. */
export function easel() {
  return cached('easel', 44, 64, g => {
    line(g, 4, 6, 0, 63, C.brown, 3);
    line(g, 40, 6, 44, 63, C.brown, 3);
    rect(g, 2, 2, 40, 4, C.tan);
    rect(g, 2, 5, 40, 1, C.brown);
    rect(g, 6, 54, 32, 3, C.brown);
  });
}

/** Draw the card squashed vertically for a flip (phase 0..1; old→new at 0.5). */
export function drawCard(g, x, y, from, to, phase = 1, alert = false) {
  const face = cardFace(phase < 0.5 ? from : to, alert);
  const k = Math.abs(Math.cos(Math.min(1, Math.max(0, phase)) * Math.PI));
  const h = Math.max(1, Math.round(face.height * k));
  g.drawImage(face, Math.round(x), Math.round(y + (face.height - h) / 2), face.width, h);
}

/* ---------- props ---------- */

export const bento = () => cached('bento', 24, 16, g => {
  rect(g, 0, 4, 24, 12, C.darkred); rect(g, 0, 4, 24, 10, C.red);
  rect(g, 1, 0, 22, 5, C.ink); rect(g, 2, 1, 20, 3, C.darkgray);
  rect(g, 3, 7, 7, 5, C.paper); rect(g, 11, 7, 5, 5, C.amber); rect(g, 17, 7, 5, 5, C.green);
  px(g, 6, 9, C.red); rect(g, 12, 8, 3, 1, C.cream);
  line(g, 2, 0, 22, -0, C.tan);
});

export const bubbleTea = () => cached('tea', 14, 24, g => {
  rect(g, 8, 0, 2, 6, C.pink);
  rect(g, 1, 5, 12, 2, C.lightgray);
  poly(g, [[2, 7], [12, 7], [11, 23], [3, 23]], C.lightsky);
  poly(g, [[3, 10], [11, 10], [10, 22], [4, 22]], C.tan);
  for (const [x, y] of [[4, 20], [6, 19], [8, 20], [5, 17], [9, 18]]) rect(g, x, y, 2, 2, C.ink);
  rect(g, 4, 11, 1, 6, C.sand);
});

export function ufo(frame = 0) {
  return cached(`ufo|${frame % 3}`, 48, 20, g => {
    ellipse(g, 24, 7, 9, 7, C.lightsky); rect(g, 18, 4, 3, 2, C.white);
    ellipse(g, 24, 13, 23, 5, C.darkgray);
    ellipse(g, 24, 12, 23, 4, C.lightgray);
    rect(g, 2, 12, 44, 1, C.gray);
    for (let i = 0; i < 5; i++) px(g, 6 + i * 9, 14, (i + frame) % 3 === 0 ? C.yellow : C.red);
    ellipse(g, 24, 17, 8, 2, C.gray);
  });
}

export const tear = () => cached('tear', 3, 4, g => { px(g, 1, 0, C.cyan); rect(g, 0, 1, 3, 3, C.cyan); px(g, 0, 1, C.white); }, false);
export const zee = () => cached('zee', 5, 5, g => { rect(g, 0, 0, 5, 1, C.paper); line(g, 4, 1, 0, 4, C.paper); rect(g, 0, 4, 5, 1, C.paper); }, false);
export const heart = () => cached('heart', 7, 6, g => {
  rect(g, 1, 0, 2, 1, C.pink); rect(g, 4, 0, 2, 1, C.pink); rect(g, 0, 1, 7, 2, C.pink);
  rect(g, 1, 3, 5, 1, C.pink); rect(g, 2, 4, 3, 1, C.pink); px(g, 3, 5, C.pink); px(g, 1, 1, C.white);
}, false);
export const sweat = () => cached('sweat', 3, 5, g => { px(g, 1, 0, C.lightsky); rect(g, 0, 1, 3, 4, C.lightsky); px(g, 0, 1, C.white); }, false);

/** Small office worker for the meteor town (4 frames). */
export function worker(color, frame = 0, panic = false) {
  return cached(`worker|${color}|${frame % 4}|${panic}`, 7, 12, g => {
    const a = [0, 1, 0, -1][frame % 4];
    rect(g, 2, 0, 3, 3, C.peach);
    rect(g, 2, 0, 3, 1, C.darkbrown);
    rect(g, 1, 3, 5, 5, color);
    rect(g, 3, 3, 1, 3, C.paper);
    if (panic) { rect(g, 0, 0 + a, 1, 4, C.peach); rect(g, 6, 0 - a, 1, 4, C.peach); }
    else { rect(g, 0, 4, 1, 3, C.peach); rect(g, 6, 4, 1, 3, C.peach); }
    rect(g, 2 + a, 8, 1, 4, C.navy); rect(g, 4 - a, 8, 1, 4, C.navy);
  }, false);
}
