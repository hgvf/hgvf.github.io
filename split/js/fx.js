// fx.js — tiny canvas effects: confetti, coin arcs, number count-up.
// One full-screen canvas (#fx), one rAF loop that sleeps when idle.
// Everything is skipped under prefers-reduced-motion.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cv = document.getElementById('fx');
const ctx = cv.getContext('2d');
let parts = [];
let running = false;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
}
resize();
addEventListener('resize', resize);

function loop() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const now = performance.now();
  parts = parts.filter(p => p.step(now));
  parts.forEach(p => p.draw(ctx));
  if (parts.length) requestAnimationFrame(loop);
  else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}
function kick() {
  if (!running) { running = true; requestAnimationFrame(loop); }
}

const COLORS = ['#8B5E3C', '#E8A33D', '#D9644A', '#5E9E7A', '#4F7FB8', '#C27BA0', '#F2C94C'];

/** Confetti burst from (x, y) — defaults to top-centre rain. */
export function confetti({ x = innerWidth / 2, y = innerHeight * 0.35, n = 140, spread = 1 } = {}) {
  if (reduce) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (4 + Math.random() * 9) * spread;
    const p = {
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 5,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      c: COLORS[i % COLORS.length], t0: performance.now(), life: 1800 + Math.random() * 1200,
      step(now) {
        this.vy += 0.28; this.vx *= 0.985; this.vy *= 0.985;
        this.x += this.vx; this.y += this.vy; this.r += this.vr;
        return now - this.t0 < this.life && this.y < innerHeight + 40;
      },
      draw(g) {
        const k = 1 - Math.max(0, (performance.now() - this.t0) / this.life - 0.7) / 0.3;
        g.save(); g.globalAlpha = Math.max(0, k);
        g.translate(this.x, this.y); g.rotate(this.r);
        g.fillStyle = this.c; g.fillRect(-this.w / 2, -this.h / 2, this.w, Math.abs(Math.cos(this.r * 2)) * this.h + 1);
        g.restore();
      },
    };
    parts.push(p);
  }
  kick();
}

/** Coins (emoji) arc from element `from` to element `to`. Resolves on landing. */
export function coins(from, to, { n = 6, emoji = '🪙' } = {}) {
  if (reduce || !from || !to) return Promise.resolve();
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const sx = a.left + a.width / 2, sy = a.top + a.height / 2;
  const ex = b.left + b.width / 2, ey = b.top + b.height / 2;
  return new Promise(res => {
    let left = n;
    for (let i = 0; i < n; i++) {
      const delay = i * 55, dur = 650 + Math.random() * 200;
      const lift = 120 + Math.random() * 80, jitter = (Math.random() - 0.5) * 60;
      const t0 = performance.now() + delay;
      parts.push({
        x: sx, y: sy, done: false,
        step(now) {
          const t = Math.min(1, Math.max(0, (now - t0) / dur));
          const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          this.x = sx + (ex - sx) * e + jitter * Math.sin(Math.PI * t);
          this.y = sy + (ey - sy) * e - lift * Math.sin(Math.PI * t);
          this.s = 1 - 0.35 * t; this.vis = now >= t0;
          if (t >= 1 && !this.done) { this.done = true; if (--left === 0) res(); }
          return t < 1;
        },
        draw(g) {
          if (!this.vis) return;
          g.save(); g.font = `${Math.round(22 * this.s)}px serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(emoji, this.x, this.y); g.restore();
        },
      });
    }
    kick();
  });
}

/** Animate an element's text from its current number to `to`. */
export function countUp(el, to, format, dur = 700) {
  if (!el) return;
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  if (reduce || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const tick = now => {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(from + (to - from) * e));
    if (t < 1 && el.dataset.v === String(to)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function buzz(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}
