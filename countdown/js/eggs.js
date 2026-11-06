/* eggs.js — the easel stage in the bottom-right corner and every timed easter egg.
   An egg is { id, dur, run(g, t, S) } where t is seconds since it started and S is
   the stage (card control + helpers). One egg plays at a time; the rest queue. */

import { C } from './palette.js';
import { rect, px, line, poly, dither, ditherDisc, drawText, drawDigits, makeCanvas, clamp, lerp, ease, outlined } from './pixel.js';
import { animal, ANIMALS, drawCard, easel, bento, bubbleTea, ufo, tear, zee, heart, sweat } from './sprites.js';

export const FEET = 352;
export const EASEL = { x: 538, y: 288 };
const CARD = { x: EASEL.x + 1, y: EASEL.y + 5 };
const AY = FEET - 47;                       // y to draw a 50px animal so its feet sit on FEET
const LOWKEY_BOX = [392, 226, 248, 134];

const miniCache = new Map();
function cardMini(v) {
  let c = miniCache.get(v);
  if (c) return c;
  const { c: cv, g } = makeCanvas(18, 20);
  rect(g, 0, 0, 18, 20, C.paper); rect(g, 0, 0, 18, 5, C.red);
  drawDigits(g, String(v), 9, 8, 1, C.ink, { align: 'center' });
  c = outlined(cv); miniCache.set(v, c); return c;
}

function bubble(g, x, y, text, col = C.ink) {
  const w = text.length * 12 + 10;
  rect(g, x - w / 2, y, w, 18, C.outline);
  rect(g, x - w / 2 + 1, y + 1, w - 2, 16, C.paper);
  poly(g, [[x - 3, y + 17], [x + 3, y + 17], [x, y + 22]], C.paper);
  drawText(g, text, x, y + 2, col, { align: 'center' });
}

/** frame index for an animation at fps */
const fr = (t, fps = 8) => Math.floor(t * fps);

export class Stage {
  constructor(getOpts) {
    this.getOpts = getOpts;     // () => { skins:{duck:true…}, lowkey, reduced, hats }
    this.queue = [];
    this.egg = null;
    this.card = null;           // override while an egg runs: { from, to, phase, hidden, x, y }
    this.value = 9;
    this.alert = false;
    this.idle = { state: 'off', t: 0, x: -60 };
    this.lastAnimal = null;
  }

  get busy() { return !!this.egg; }

  play(egg) {
    if (this.egg && this.egg.id === egg.id) return;
    if (this.queue.length >= 3) this.queue.shift();     // never let a backlog pile up
    this.queue.push(egg);
  }

  pickAnimal() {
    const weights = { duck: 0.4, bear: 0.2, dog: 0.2, cat: 0.2 };
    const pool = ANIMALS.filter(a => a !== this.lastAnimal);
    let total = pool.reduce((s, a) => s + weights[a], 0), r = Math.random() * total;
    for (const a of pool) { r -= weights[a]; if (r <= 0) { this.lastAnimal = a; return a; } }
    this.lastAnimal = pool[0]; return pool[0];
  }

  actor(g, kind, pose, frame, x, y = AY, flip = false, extra = {}) {
    const o = this.getOpts();
    g.drawImage(animal(kind, pose, frame, { skin: o.skins[kind], hat: extra.hat ?? o.hats, flip }), Math.round(x), Math.round(y));
  }

  update(dt, onStart, onEnd) {
    if (!this.egg && this.queue.length) {
      this.egg = this.queue.shift(); this.egg.t = 0; this.card = null;
      onStart && onStart(this.egg);
    }
    if (this.egg) {
      this.egg.t += dt;
      if (this.egg.t >= this.egg.dur) { const e = this.egg; this.egg = null; this.card = null; onEnd && onEnd(e); }
    }
    // idle cat state machine
    const I = this.idle;
    I.t += dt;
    if (I.state === 'walkin') { I.x = Math.min(I.tx, I.x + 38 * dt); if (I.x >= I.tx) { I.state = 'sleep'; I.t = 0; } }
    else if (I.state === 'leave') { I.x += 90 * dt; if (I.x > 700) I.state = 'off'; }
  }

  idleStart(spot) { if (this.idle.state === 'off') Object.assign(this.idle, { state: 'walkin', x: -50, t: 0, tx: spot.x, y: spot.y }); }
  idleWake() { if (this.idle.state === 'walkin' || this.idle.state === 'sleep') { this.idle.state = 'leave'; this.idle.t = 0; } }
  get catAsleep() { return this.idle.state === 'sleep'; }

  /** Draw easel + card + running egg. */
  draw(g, hideEasel = false) {
    const o = this.getOpts();
    const clip = o.lowkey;
    if (clip) { g.save(); g.beginPath(); g.rect(...LOWKEY_BOX); g.clip(); }
    if (!hideEasel) {
      g.drawImage(easel(), EASEL.x - 1, EASEL.y - 1);
      const cs = this.card;
      if (!cs) drawCard(g, CARD.x, CARD.y, this.value, this.value, 1, this.alert);
      else if (!cs.hidden) drawCard(g, cs.x ?? CARD.x, cs.y ?? CARD.y, cs.from, cs.to, cs.phase ?? 0, this.alert);
    }
    if (this.egg) this.egg.run(g, this.egg.t, this);
    if (clip) g.restore();
  }

  /** Idle cat drawn on top of everything (it sleeps on the big digits). */
  drawIdle(g) {
    const I = this.idle;
    if (I.state === 'off') return;
    const y = I.y - 47;
    if (I.state === 'walkin') this.actor(g, 'cat', 'walk', fr(I.t), I.x - 24, y, false, { hat: false });
    else if (I.state === 'sleep') {
      this.actor(g, 'cat', 'sleep', fr(I.t, 2), I.x - 24, y, false, { hat: false });
      for (let i = 0; i < 3; i++) {
        const k = ((I.t * 0.5 + i / 3) % 1);
        if (k < 0.9) g.drawImage(zee(), Math.round(I.x + 14 + k * 14), Math.round(y + 14 - k * 22));
      }
    } else if (I.state === 'leave') this.actor(g, 'cat', 'walk', fr(I.t, 14), I.x - 24, y, false, { hat: false });
  }

  /** Finale: four animals in party hats along the bottom edge; dance > 0 makes them bounce. */
  drawParty(g, t, dance) {
    const xs = [70, 150, 230, 310];
    const poses = { duck: dance ? 'flap' : 'stand', bear: 'stand', dog: dance ? 'wag' : 'stand', cat: dance ? 'stand' : 'sit' };
    ANIMALS.forEach((a, i) => {
      const hop = dance ? Math.abs(Math.sin(t * 5 + i * 0.9)) * 10 * dance : 0;
      const flip = dance ? Math.floor(t * 1.5 + i) % 2 === 0 : false;
      this.actor(g, a, poses[a], fr(t, dance ? 6 : 3) + i, xs[i], AY - hop, flip, { hat: true });
    });
  }
}

/* ---------------- egg factories ---------------- */

export function flipEgg(kind, from, to) {
  const id = 'flip-' + kind;
  return ({ duck: duckFlip, bear: bearFlip, dog: dogFlip, cat: catFlip })[kind](id, from, to);
}

function duckFlip(id, from, to) {
  return {
    id, dur: 8.5, from, to,
    run(g, t, S) {
      const tx = EASEL.x + 38;
      S.card = { from, to, phase: clamp((t - 3.1) / 0.7) };
      if (t < 2.6) S.actor(g, 'duck', 'walk', fr(t), lerp(660, tx, ease(t / 2.6)), AY, true);
      else if (t < 3.9) S.actor(g, 'duck', 'peck', 0, tx - 4, AY + 2, true);
      else if (t < 5.4) { S.actor(g, 'duck', 'flap', fr(t, 6), tx, AY - Math.abs(Math.sin(t * 9)) * 3, true); if (t > 4.2) g.drawImage(heart(), tx + 6, AY - 8 - (t - 4.2) * 8); }
      else S.actor(g, 'duck', 'walk', fr(t), lerp(tx, 680, (t - 5.4) / 3), AY, false);
    },
  };
}

function bearFlip(id, from, to) {
  return {
    id, dur: 13, from, to,
    run(g, t, S) {
      const bx = EASEL.x - 2;
      const holding = t >= 3 && t < 10;
      S.card = { from, to, phase: clamp((t - 8.2) / 1.2), hidden: holding };
      if (t < 3) S.actor(g, 'bear', 'walk', fr(t, 6), lerp(670, bx, ease(t / 3)), AY, true);
      else if (holding) {
        const pose = t < 6.3 ? 'hold' : t < 7.8 ? 'yawn' : 'hold';
        const f = pose === 'yawn' ? fr(t - 6.3, 3.3) : (t < 6.3 ? 0 : 8);
        S.actor(g, 'bear', pose, f, bx, AY, false);
        const ph = clamp((t - 8.2) / 1.2), mini = cardMini(ph < 0.5 ? from : to);
        const mh = Math.max(1, Math.round(mini.height * Math.abs(Math.cos(ph * Math.PI))));
        g.drawImage(mini, bx + 15, AY + 26 + (mini.height - mh) / 2, mini.width, mh);
        rect(g, bx + 12, AY + 32, 5, 5, C.brown); rect(g, bx + 33, AY + 32, 5, 5, C.brown);
        if (t < 6.3) for (let i = 0; i < 3; i++) { const k = ((t * 0.6 + i / 3) % 1); g.drawImage(zee(), Math.round(bx + 38 + k * 12), Math.round(AY + 6 - k * 22)); }
        if (t > 6.3 && t < 7.8) drawText(g, '哈～欠', bx + 24, AY - 18, C.paper, { align: 'center', outline: C.ink });
      } else S.actor(g, 'bear', 'walk', fr(t, 6), lerp(bx, 680, (t - 10) / 3), AY, false);
    },
  };
}

function dogFlip(id, from, to) {
  return {
    id, dur: 10, from, to,
    run(g, t, S) {
      const dx = EASEL.x + 34;
      const away = t >= 1.6 && t < 6.4;
      S.card = { from, to, phase: t < 6.4 ? 0 : 1, hidden: away };
      if (t < 1.6) S.actor(g, 'dog', 'walk', fr(t, 14), lerp(660, dx, ease(t / 1.6)), AY, true);
      else if (t < 4) {                                         // run off left with old card
        const x = lerp(dx, -70, (t - 1.6) / 2.4);
        S.actor(g, 'dog', 'carry', fr(t, 14), x, AY, true);
        g.drawImage(cardMini(from), Math.round(x - 6), AY + 18);
      } else if (t < 6.4) {                                     // back from the left with the new one
        const x = lerp(-70, EASEL.x - 46, (t - 4) / 2.4);
        S.actor(g, 'dog', 'carry', fr(t, 14), x, AY, false);
        g.drawImage(cardMini(to), Math.round(x + 38), AY + 18);
      } else if (t < 8) {
        S.actor(g, 'dog', 'wag', fr(t, 10), EASEL.x - 46, AY, false);
        if (t < 7.2) drawText(g, '汪!', EASEL.x - 22, AY - 14, C.paper, { align: 'center', outline: C.ink });
      } else S.actor(g, 'dog', 'walk', fr(t, 14), lerp(EASEL.x - 46, -70, (t - 8) / 2), AY, true);
    },
  };
}

function catFlip(id, from, to) {
  return {
    id, dur: 11, from, to,
    run(g, t, S) {
      const cx = EASEL.x - 44;
      // card: pushed off (falls) → lies on floor → new card slides back up
      let cs;
      if (t < 3.2) cs = { from, to: from, phase: 1 };
      else if (t < 4) { const k = ease((t - 3.2) / 0.8); cs = { from, to: from, phase: 1, x: CARD.x + k * 20, y: CARD.y + k * 34 }; }
      else if (t < 6.4) cs = { from, to: from, phase: 0.62, x: CARD.x + 20, y: CARD.y + 34 };
      else if (t < 7.6) { const k = ease((t - 6.4) / 1.2); cs = { from: to, to, phase: 1, x: CARD.x, y: lerp(CARD.y + 40, CARD.y, k) }; }
      else cs = { from: to, to, phase: 1 };
      S.card = cs;
      if (t < 2.4) S.actor(g, 'cat', 'walk', fr(t), lerp(-60, cx, ease(t / 2.4)), AY, false);
      else if (t < 4) S.actor(g, 'cat', 'push', fr(t - 2.4, 5), cx, AY, false);
      else if (t < 6.4) { S.actor(g, 'cat', 'sit', 0, cx, AY, false); if (t > 4.4) drawText(g, '…', cx + 24, AY - 12, C.paper, { align: 'center', outline: C.ink }); }
      else if (t < 7.6) S.actor(g, 'cat', 'push', fr(t - 6.4, 4), cx, AY, false);
      else if (t < 8.6) S.actor(g, 'cat', 'stand', 7, cx, AY, false);
      else S.actor(g, 'cat', 'walk', fr(t), lerp(cx, -70, (t - 8.6) / 2.4), AY, true);
    },
  };
}

export function gatheringEgg(from, to) {
  const spots = { cat: EASEL.x - 150, duck: EASEL.x - 100, dog: EASEL.x - 50, bear: EASEL.x + 44 };
  return {
    id: 'gathering', dur: 14, from, to,
    run(g, t, S) {
      S.card = { from, to, phase: clamp((t - 6) / 0.8) };
      ANIMALS.forEach((a, i) => {
        const fromRight = a === 'bear';
        const sx = fromRight ? 690 : -70, tx = spots[a];
        const arrive = 2.6 + i * 0.4;
        let x, pose, f = fr(t, 8) + i, flip = fromRight, y = AY;
        if (t < arrive) { x = lerp(sx, tx, ease(t / arrive)); pose = 'walk'; }
        else if (t < 11) {
          x = tx; flip = tx > EASEL.x;
          const jump = t > 5.4 && t < 7.4 ? Math.abs(Math.sin((t - 5.4) * Math.PI * 1.5)) * 14 : 0;
          y = AY - jump;
          pose = { duck: t > 6 ? 'flap' : 'stand', bear: 'stand', dog: t > 6 ? 'wag' : 'stand', cat: 'stand' }[a];
        } else { x = lerp(tx, fromRight ? 700 : -80, (t - 11) / 3); pose = 'walk'; flip = !fromRight; }
        S.actor(g, a, pose, f, x, y, flip);
      });
      if (t > 6.4 && t < 10) {
        drawText(g, '最後一小時！', EASEL.x - 60, AY - 34, C.yellow, { align: 'center', outline: C.ink, scale: 1 });
        for (let i = 0; i < 5; i++) g.drawImage(heart(), EASEL.x - 140 + i * 40, Math.round(AY - 10 - ((t - 6.4) * 10 + i * 7) % 30));
      }
    },
  };
}

export function lunchEgg() {
  return {
    id: 'lunch', dur: 10,
    run(g, t, S) {
      const bx = EASEL.x - 100;
      const fall = clamp(t / 1.1);
      let by = lerp(-20, FEET - 16, fall * fall);
      if (t > 1.1 && t < 1.4) by -= Math.sin((t - 1.1) / 0.3 * Math.PI) * 6;
      const carried = t > 7;
      if (!carried) g.drawImage(bento(), bx, Math.round(by));
      if (t > 1.2 && t < 2.6) bubble(g, bx + 12, FEET - 50, '午休！');
      if (t < 1.8) return;
      if (t < 3.4) S.actor(g, 'dog', 'walk', fr(t, 12), lerp(670, bx + 24, ease((t - 1.8) / 1.6)), AY, true);
      else if (t < 5.6) { S.actor(g, 'dog', 'sniff', fr(t, 4), bx + 20, AY, true); if (t > 4.5) drawText(g, '嗅嗅', bx + 44, AY - 6, C.paper, { outline: C.ink }); }
      else if (t < 7) { S.actor(g, 'dog', 'wag', fr(t, 10), bx + 20, AY, true); g.drawImage(heart(), bx + 30, Math.round(AY - (t - 5.6) * 12)); }
      else { const x = lerp(bx + 20, 680, (t - 7) / 3); S.actor(g, 'dog', 'carry', fr(t, 14), x, AY, false); g.drawImage(bento(), Math.round(x + 34), AY + 22); }
    },
  };
}

export function teaEgg() {
  return {
    id: 'tea', dur: 11,
    run(g, t, S) {
      const cx = EASEL.x - 92;
      const slide = ease(clamp(t / 1.4));
      const cupX = lerp(-20, cx, slide);
      const bx = cx + 10;
      const sipping = t > 4 && t < 7;
      if (!sipping) g.drawImage(bubbleTea(), Math.round(cupX), FEET - 26);
      if (t > 0.6 && t < 2.6) bubble(g, cx + 7, FEET - 60, '下午茶');
      if (t < 2) return;
      if (t < 4) S.actor(g, 'bear', 'walk', fr(t, 6), lerp(680, bx, ease((t - 2) / 2)), AY, true);
      else if (sipping) {
        S.actor(g, 'bear', 'sip', 0, bx, AY, false);
        g.drawImage(bubbleTea(), bx + 17, AY + 20);
        drawText(g, '啾～', bx + 44, AY + 4, C.paper, { outline: C.ink });
      } else if (t < 8.2) { S.actor(g, 'bear', 'stand', 0, bx, AY, false); g.drawImage(sweat(), bx + 40, AY + 4); drawText(g, '沒喝喔', bx + 24, AY - 16, C.paper, { align: 'center', outline: C.ink }); }
      else S.actor(g, 'bear', 'walk', fr(t, 8), lerp(bx, 690, (t - 8.2) / 2.8), AY, false);
    },
  };
}

function banner(g, S, t, dur, text, col, sub) {
  const lowkey = S.getOpts().lowkey;
  const k = Math.min(ease(t / 0.5), ease((dur - t) / 0.5));
  if (lowkey) {
    const y = lerp(380, 236, k);
    rect(g, 400, y, 232, 30, C.outline); rect(g, 401, y + 1, 230, 28, col);
    drawText(g, text, 516, y + 8, C.paper, { align: 'center' });
    return;
  }
  const y = lerp(-50, 74, k);
  rect(g, 120, y, 400, 46, C.outline);
  rect(g, 121, y + 1, 398, 44, col);
  rect(g, 121, y + 1, 398, 3, C.paper);
  poly(g, [[120, y + 6], [96, y + 6], [106, y + 24], [96, y + 42], [120, y + 42]], col);
  poly(g, [[520, y + 6], [544, y + 6], [534, y + 24], [544, y + 42], [520, y + 42]], col);
  drawText(g, text, 320, y + 6, C.paper, { align: 'center', scale: 2, outline: C.outline });
  if (sub) drawText(g, sub, 320, y + 50, C.paper, { align: 'center', outline: C.outline });
}

export function halfEgg() {
  return {
    id: 'half', dur: 6,
    run(g, t, S) {
      if (!S.getOpts().reduced && !S.getOpts().lowkey && t < 1.6) dither(g, 0, 0, 640, 360, C.white, 0.5 * (1 - t / 1.6));
      banner(g, S, t, 6, '已經過一半了！', C.green, '剩下的一半，應該…也撐得過去');
    },
  };
}

export function alertEgg() {
  return {
    id: 'alert', dur: 6,
    run(g, t, S) {
      const on = S.getOpts().reduced ? true : ((t * 4) | 0) % 2;
      banner(g, S, t, 6, on ? '警戒模式啟動' : '最後一小時', C.darkred, '所有單位注意：準備下班');
    },
  };
}

export function overtimeEgg(from, to) {
  return {
    id: 'overtime', dur: 12, from, to,
    run(g, t, S) {
      const tx = EASEL.x + 38;
      S.card = { from, to, phase: clamp((t - 2.6) / 0.7) };
      if (t < 2.2) S.actor(g, 'duck', 'walk', fr(t, 6), lerp(660, tx, ease(t / 2.2)), AY, true);
      else if (t < 3.4) S.actor(g, 'duck', 'peck', 0, tx - 4, AY + 2, true);
      else if (t < 9.6) {
        S.actor(g, 'duck', 'cry', fr(t, 4), tx + 4, AY, true);
        for (let i = 0; i < 6; i++) {
          const k = ((t * 1.3 + i / 6) % 1);
          const side = i % 2 ? 1 : -1;
          g.drawImage(tear(), Math.round(tx + 18 + side * (4 + k * 10)), Math.round(AY + 14 + k * 26));
        }
        if (((t * 2) | 0) % 2) drawText(g, '嗚嗚…', tx + 20, AY - 16, C.lightsky, { align: 'center', outline: C.ink });
        if (t < 5) bubble(g, EASEL.x - 40, AY - 22, '+30 分鐘', C.red);
      } else S.actor(g, 'duck', 'walk', fr(t, 4), lerp(tx, 680, (t - 9.6) / 2.4), AY, false);
    },
  };
}

export function ufoEgg(value) {
  return {
    id: 'ufo', dur: 13,
    run(g, t, S) {
      const hx = EASEL.x + 20, hy = 190;
      let ux, uy;
      if (t < 2) { ux = lerp(-60, hx, ease(t / 2)); uy = lerp(40, hy, ease(t / 2)); }
      else if (t < 4.4) { ux = hx; uy = hy + Math.sin(t * 3) * 2; }
      else if (t < 7.6) { const k = (t - 4.4) / 3.2; ux = hx - 220 * Math.sin(k * Math.PI); uy = hy - 70 * Math.sin(k * Math.PI * 2) - 30 * Math.sin(k * Math.PI); }
      else if (t < 10) { ux = hx; uy = hy + Math.sin(t * 3) * 2; }
      else { ux = lerp(hx, 720, ease((t - 10) / 3)); uy = lerp(hy, -40, ease((t - 10) / 3)); }
      const beam = (t > 2 && t < 4.4) || (t > 7.6 && t < 9.6);
      if (beam) {
        poly(g, [[ux - 6, uy + 18], [ux + 6, uy + 18], [ux + 30, FEET - 6], [ux - 30, FEET - 6]], C.cyan);
        dither(g, ux - 30, uy + 18, 60, FEET - uy - 24, C.lightsky, 0.25);
      }
      // card: lifted into the UFO, carried, dropped back
      let cs;
      if (t < 2.4) cs = { from: value, to: value, phase: 1 };
      else if (t < 4.4) { const k = ease((t - 2.4) / 2); cs = { from: value, to: value, phase: 1, y: lerp(CARD.y, uy + 10, k) }; }
      else if (t < 7.8) cs = { from: value, to: value, phase: 1, hidden: true };
      else if (t < 9.6) { const k = ease((t - 7.8) / 1.8); cs = { from: value, to: value, phase: 1, y: lerp(uy + 10, CARD.y, k) }; }
      else cs = { from: value, to: value, phase: 1 };
      S.card = cs;
      if (t >= 4.4 && t < 7.8) g.drawImage(cardMini(value), Math.round(ux - 9), Math.round(uy + 16));
      g.drawImage(ufo(fr(t, 6)), Math.round(ux - 24), Math.round(uy));
      if (t > 4.6 && t < 6.4) bubble(g, ux, uy - 26, '借看一下', C.purple);
      if (t > 9.6 && t < 10.6) bubble(g, ux, uy - 26, '還你', C.purple);
    },
  };
}

export function tailEgg() {
  return {
    id: 'tail', dur: 9,
    run(g, t, S) {
      const cx = EASEL.x - 150;
      if (t < 1.6) S.actor(g, 'dog', 'walk', fr(t, 12), lerp(680, cx, ease(t / 1.6)), AY, true);
      else if (t < 6) {
        const a = (t - 1.6) * 9;
        const flip = Math.floor((t - 1.6) / 0.18) % 2 === 0;
        S.actor(g, 'dog', 'walk', fr(t, 16), cx + Math.cos(a) * 12, AY + Math.sin(a) * 2, flip);
        if (t > 3) drawText(g, '尾巴別跑！', cx + 24, AY - 18, C.paper, { align: 'center', outline: C.ink });
      } else if (t < 7) {
        S.actor(g, 'dog', 'stand', 0, cx, AY, true);
        for (let i = 0; i < 3; i++) { const a = t * 6 + i * 2.1; px(g, cx + 34 + Math.cos(a) * 8, AY + 8 + Math.sin(a) * 3, C.yellow); }
      } else S.actor(g, 'dog', 'walk', fr(t, 8), lerp(cx, -70, (t - 7) / 2), AY + Math.sin(t * 10) * 1, true);
    },
  };
}
