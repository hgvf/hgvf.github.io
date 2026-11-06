/* finale.js — the last five minutes, in four acts that only ever escalate:
     5:00→3:00 暖場  sparse fireworks, animals in party hats line up
     3:00→1:00 升溫  double the fireworks, confetti, pulsing digits, animals dance
     1:00→0:10 衝刺  shake, pulsing edge glow, slogans, hotter colours
     0:10→0:00 倒數  full-screen digits, one big firework per second, click for more
   then 下班: theme ending + every firework at once. No sound, ever. */

import { C } from './palette.js';
import { Particles } from './fx.js';
import { dither, drawDigits, drawText, clamp } from './pixel.js';

export const ACTS = [
  { id: 0, name: '' },
  { id: 1, name: '暖場', from: 300, to: 180 },
  { id: 2, name: '升溫', from: 180, to: 60 },
  { id: 3, name: '衝刺', from: 60, to: 10 },
  { id: 4, name: '倒數', from: 10, to: 0 },
];
/* Last-minute slogans: a fresh shuffle every day, a new line every 4 s.
   The first few always set up, the last few always land. */
const SLOGAN_OPEN = ['全員注意：最後一分鐘！', '收東西！', '關電腦！'];
const SLOGAN_MID = [
  '不要看手機！', '實行無線電靜默！', '別跟主管對到眼！', '外套穿起來！', '保持低姿態！',
  '假裝很忙！', '耳機戴上！', '別回任何訊息！', '鍵盤離手！', '不要接電話！', '視線保持在螢幕上！',
  '水杯帶走！', '充電線拔起來！', '悄悄把椅子推進去！', '不要在群組說話！', '別讓任何人看到你在笑！',
  '腳尖朝向門口！', '電梯已經在路上了！', '準備打卡！', '包包背好！', '別問「還有什麼要幫忙的嗎」！',
  '靜音模式開啟！', '不要點開那封信！', '燈號轉綠前不准動！', '撤退路線確認！',
];
const SLOGAN_CLOSE = ['倒數十秒！', '衝啊！！'];

export function actFor(remainingMs) {
  const s = remainingMs / 1000;
  if (s > 300) return 0;
  if (s > 180) return 1;
  if (s > 60) return 2;
  if (s > 10) return 3;
  return 4;
}

export class Finale {
  constructor() {
    this.fx = new Particles(2600);
    this.acc = 0;
    this.lastSecond = null;
    this.endT = -1;            // seconds since 下班, -1 = not ended
  }
  reset() { this.fx.clear(); this.acc = 0; this.lastSecond = null; this.endT = -1; }

  /** Spawn area: full screen, or the HUD box in 低調 mode. */
  area(lowkey) { return lowkey ? { x0: 220, x1: 420, top: 8, low: 60, y0: 80 } : { x0: 40, x1: 600, top: 40, low: 200, y0: 360 }; }

  launch(n, size, lowkey, rampFor) {
    const A = this.area(lowkey);
    for (let i = 0; i < n; i++) {
      const x = A.x0 + Math.random() * (A.x1 - A.x0);
      this.fx.firework(x, A.top + Math.random() * (A.low - A.top), { y0: A.y0, size: lowkey ? 1 : size, ramp: rampFor ? rampFor() : undefined, shape: !lowkey && size >= 3 && Math.random() < 0.2 ? (Math.random() < 0.5 ? 'heart' : 'ring') : undefined });
    }
  }

  /** Called every frame while working (remaining > 0) or after the end. */
  update(dt, remainingMs, o) {
    const act = remainingMs > 0 ? actFor(remainingMs) : 5;
    const lowkey = o.lowkey, reduced = o.reduced;
    const thin = reduced ? 0.4 : 1;
    const s = remainingMs / 1000;
    if (act === 0) { this.fx.update(dt); return act; }
    const heat = () => {
      if (s > 120) return ['cyan', 'lime', 'sky'][(Math.random() * 3) | 0];
      if (s > 40) return ['gold', 'pink', 'lime'][(Math.random() * 3) | 0];
      return ['fire', 'gold', 'pink'][(Math.random() * 3) | 0];
    };
    const rate = [0, 0.45, 1.0, 2.2, 0, 3][act] * thin;
    this.acc += dt * rate;
    while (this.acc >= 1) { this.acc -= 1; this.launch(1, act >= 3 ? 2 : 1, lowkey, heat); }
    if (act >= 2 && !lowkey && Math.random() < dt * (act === 2 ? 2 : 4) * thin) this.fx.confetti(act === 2 ? 4 : 8);
    if (act === 4) {
      const sec = Math.ceil(s);
      if (sec !== this.lastSecond) { this.lastSecond = sec; this.launch(reduced ? 1 : 2, 3, lowkey, () => 'fire'); }
    }
    if (act === 5) {
      if (this.endT < 0) {
        this.endT = 0;
        this.launch(reduced ? 3 : 10, 3, lowkey);
        if (!lowkey) this.fx.confetti(reduced ? 30 : 90);
      }
      this.endT += dt;
      if (this.endT < 9 && Math.random() < dt * (reduced ? 1 : 4)) this.launch(1, 2 + (Math.random() < 0.4 ? 1 : 0), lowkey);
    }
    this.fx.update(dt);
    return act;
  }

  click(x, y, lowkey) {
    if (lowkey) return;
    this.fx.firework(x, Math.max(30, y), { size: 3 });
  }

  drawParticles(g) { this.fx.draw(g); }

  /** Overlays drawn above the HUD: edge glow (act 3+), giant digits (act 4). */
  drawOverlay(g, remainingMs, t, o) {
    const act = actFor(remainingMs);
    if (remainingMs <= 0) return;
    if (act >= 3 && !o.lowkey) {
      const pulse = o.reduced ? 0.35 : 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(t * 6));
      const col = act === 4 ? C.red : C.amber;
      dither(g, 0, 0, 640, 8, col, pulse); dither(g, 0, 352, 640, 8, col, pulse);
      dither(g, 0, 8, 8, 344, col, pulse); dither(g, 632, 8, 8, 344, col, pulse);
    }
    if (act === 4 && !o.lowkey) {
      const sec = Math.max(1, Math.ceil(remainingMs / 1000));
      const frac = (remainingMs / 1000) % 1;
      const s = o.reduced ? 20 : 20 + Math.round(clamp((frac - 0.8) / 0.2) * 3);
      dither(g, 0, 0, 640, 360, C.ink, 0.5);
      drawDigits(g, String(sec), 320, 180 - s * 3.5, s, sec <= 3 ? C.red : C.yellow, { align: 'center', hi: sec <= 3 ? C.pink : C.cream, shadow: C.darkred, outline: C.outline });
      drawText(g, '點畫面加放煙火', 320, 336, C.paper, { align: 'center', outline: C.ink });
    }
  }

  slogan(remainingMs) {
    const s = remainingMs / 1000;
    if (s > 60 || s <= 0) return null;
    if (s <= 10) return SLOGAN_CLOSE[s > 5 ? 0 : 1];
    if (!this._slogans || this._sloganDay !== new Date().toDateString()) {
      this._sloganDay = new Date().toDateString();
      const mid = SLOGAN_MID.slice();
      let h = 0; for (const ch of this._sloganDay) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      for (let i = mid.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [mid[i], mid[j]] = [mid[j], mid[i]]; }
      this._slogans = [...SLOGAN_OPEN, ...mid];
    }
    const i = Math.floor((60 - s) / 4);               // 60→10 s = 12–13 lines
    return this._slogans[Math.min(this._slogans.length - 1, i)];
  }
}
