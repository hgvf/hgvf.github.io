/* fx.js — pixel particle systems: fireworks (rocket → burst → colour-ramp fade),
   confetti ribbons and generic sparks. Particles are 1–2 px squares only. */

import { RAMPS, RAMP_NAMES, C, PALETTE } from './palette.js';

export class Particles {
  constructor(max = 2400) { this.list = []; this.max = max; }
  add(p) { if (this.list.length < this.max) this.list.push(p); }
  get count() { return this.list.length; }
  clear() { this.list.length = 0; }

  /** A rocket that climbs to (tx,ty) then bursts. size 1 small … 3 huge. */
  firework(x, ty, opts = {}) {
    const ramp = opts.ramp || RAMP_NAMES[(Math.random() * RAMP_NAMES.length) | 0];
    const y0 = opts.y0 ?? 360;
    const dur = 0.7 + Math.random() * 0.5;
    this.add({ kind: 'rocket', x, y: y0, vx: (Math.random() - 0.5) * 20, vy: -(y0 - ty) / dur, t: 0, life: dur, ramp, size: opts.size || 2, shape: opts.shape });
  }

  burst(x, y, ramp = 'fire', size = 2, shape) {
    const n = [0, 36, 70, 120][size] || 70;
    const speed = [0, 55, 85, 125][size] || 85;
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2 + Math.random() * 0.08, sp = speed * (0.55 + Math.random() * 0.45);
      if (shape === 'ring') sp = speed;
      if (shape === 'heart') {
        const t = (i / n) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(t), 3), hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        this.add({ kind: 'spark', x, y, vx: hx * speed / 18, vy: hy * speed / 18, t: 0, life: 1.6, ramp: 'pink', drag: 1.6, g: 18, size: 2 });
        continue;
      }
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 1.1 + Math.random() * 0.9, ramp, drag: 1.4, g: 34, size: size >= 3 && i % 3 === 0 ? 2 : 1, twinkle: Math.random() < 0.3 });
    }
    // flash core
    this.add({ kind: 'flash', x, y, t: 0, life: 0.18, r: 4 + size * 3 });
  }

  confetti(n = 30, w = 640) {
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'confetti', x: Math.random() * w, y: -4 - Math.random() * 40, vx: (Math.random() - 0.5) * 16, vy: 22 + Math.random() * 26, t: 0, life: 14, col: PALETTE[[12, 13, 15, 17, 25, 27, 4, 11][(Math.random() * 8) | 0]], ph: Math.random() * 6 });
    }
  }

  dust(x, y, n = 20, col = C.lightgray, spread = 60) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * spread;
      this.add({ kind: 'dust', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 10, t: 0, life: 1 + Math.random() * 1.5, col, size: 1 + (Math.random() * 3 | 0) });
    }
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.t += dt;
      if (p.kind === 'rocket') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (Math.random() < 0.8) this.add({ kind: 'trail', x: p.x, y: p.y, t: 0, life: 0.35 });
        if (p.t >= p.life) { this.burst(p.x, p.y, p.ramp, p.size, p.shape); L.splice(i, 1); continue; }
      } else if (p.kind === 'spark') {
        const k = Math.exp(-(p.drag || 0) * dt);
        p.vx *= k; p.vy = p.vy * k + (p.g || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      } else if (p.kind === 'confetti') {
        p.x += (p.vx + Math.sin(p.t * 3 + p.ph) * 14) * dt; p.y += p.vy * dt;
        if (p.y > 370) p.t = p.life;
      } else if (p.kind === 'dust') {
        p.vx *= Math.exp(-2 * dt); p.vy *= Math.exp(-2 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      if (p.t >= p.life) L.splice(i, 1);
    }
  }

  draw(g) {
    for (const p of this.list) {
      const x = Math.round(p.x), y = Math.round(p.y), k = p.t / p.life;
      if (p.kind === 'rocket') { g.fillStyle = C.cream; g.fillRect(x, y, 1, 2); }
      else if (p.kind === 'trail') { g.fillStyle = k < 0.4 ? C.amber : C.rust; if (k < 0.8) g.fillRect(x, y, 1, 1); }
      else if (p.kind === 'spark') {
        const ramp = RAMPS[p.ramp] || RAMPS.fire;
        const idx = Math.min(ramp.length - 1, Math.floor(k * ramp.length));
        if (p.twinkle && ((p.t * 20) | 0) % 2 && k > 0.5) continue;
        g.fillStyle = ramp[idx];
        g.fillRect(x, y, p.size, p.size);
      } else if (p.kind === 'flash') {
        const r = Math.round(p.r * (1 - k));
        g.fillStyle = C.white; g.fillRect(x - r, y - 1, r * 2 + 1, 3); g.fillRect(x - 1, y - r, 3, r * 2 + 1);
      } else if (p.kind === 'confetti') {
        g.fillStyle = p.col;
        const flip = Math.sin(p.t * 6 + p.ph) > 0;
        g.fillRect(x, y, flip ? 3 : 1, flip ? 1 : 3);
      } else if (p.kind === 'dust') {
        g.fillStyle = p.col;
        if (k < 0.85 || (p.t * 15 | 0) % 2) g.fillRect(x, y, p.size, p.size);
      }
    }
  }
}
