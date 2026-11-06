/* offscene.js — the 「你已經下班了，為什麼還開著」 scene: a quiet night street,
   the four animals asleep under a street lamp. Used for after-hours, weekends
   and before work; the HUD on top shows the reverse countdown. */

import { C } from './palette.js';
import { rect, px, disc, line, ditherDisc, drawText, rng } from './pixel.js';
import { bands, stars } from './themes/common.js';
import { animal, zee } from './sprites.js';

const houses = (() => {
  const r = rng(88), out = [];
  for (let x = -6; x < 650;) { const w = 40 + (r() * 40 | 0), h = 40 + (r() * 60 | 0); out.push({ x, w, h, s: r() * 1e6 | 0 }); x += w + 4; }
  return out;
})();

export function drawOffScene(g, t, mode, skins) {
  bands(g, [[0, C.ink], [120, C.navy], [250, C.deepblue]]);
  stars(g, 99, 200, t, 240);
  disc(g, 520, 70, 22, C.cream); disc(g, 512, 64, 20, C.navy);       // crescent moon
  for (const h of houses) {
    const top = 318 - h.h;
    rect(g, h.x, top, h.w, h.h, C.plum);
    rect(g, h.x, top, h.w, 2, C.purple);
    const r = rng(h.s);
    for (let y = top + 8; y < 310; y += 12) for (let x = h.x + 6; x < h.x + h.w - 6; x += 10) if (r() < 0.18) rect(g, x, y, 4, 5, C.amber);
  }
  rect(g, 0, 318, 640, 42, C.darkgray); rect(g, 0, 318, 640, 2, C.gray);
  for (let x = 10; x < 640; x += 24) rect(g, x, 336, 10, 1, C.gray);
  // street lamp + pool of light
  ditherDisc(g, 420, 336, 70, C.amber, 0.18);
  rect(g, 466, 190, 4, 130, C.ink); rect(g, 440, 186, 30, 4, C.ink); rect(g, 434, 190, 14, 6, C.yellow);
  ditherDisc(g, 440, 198, 18, C.yellow, 0.3);
  // sleeping animals in the light
  const o = k => ({ skin: skins[k] });
  g.drawImage(animal('cat', 'sleep', (t * 2) | 0, o('cat')), 330, 352 - 47);
  g.drawImage(animal('bear', 'hold', 0, o('bear')), 372, 352 - 47);
  g.drawImage(animal('dog', 'stand', 0, o('dog')), 418, 352 - 47);
  g.drawImage(animal('duck', 'stand', 0, o('duck')), 462, 352 - 47);
  for (let i = 0; i < 3; i++) { const k = ((t * 0.4 + i / 3) % 1); g.drawImage(zee(), Math.round(400 + k * 16), Math.round(300 - k * 26)); }
  const label = mode === 'before' ? '還沒上班，大家還在睡' : mode === 'weekend' ? '今天放假，大家都在睡' : '大家都下班了';
  drawText(g, label, 420, 268, C.cream, { align: 'center', outline: C.ink });
}
