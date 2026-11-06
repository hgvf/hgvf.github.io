/* themes/mom.js — 「媽媽的訊息」: a chat thread with Mom that escalates through the
   day. The newest bubble always holds the live countdown:
   「再 02:14:33 不回來就完蛋了！」 End: 「我下班了！！」 → 「好，路上小心 ❤」 */

import { C } from '../palette.js';
import { rect, px, disc, ellipse, poly, drawText, drawDigits, measureDigits, textSprite, clamp } from '../pixel.js';
import { hms } from '../clock.js';

const X0 = 170, X1 = 470, TOP = 10, BOT = 350;
const SCRIPT = [
  [0.0, 'mom', '今天幾點下班？'],
  [0.02, 'me', '照常啊'],
  [0.2, 'mom', '晚餐要吃什麼'],
  [0.38, 'mom', '我煮了你愛吃的滷肉'],
  [0.5, 'me', '好'],
  [0.62, 'mom', '湯要冷了喔'],
  [0.78, 'mom', '你是不是又要加班'],
  [0.9, 'mom', '我數到三喔'],
];

function avatarMom(g, x, y) {
  disc(g, x, y, 12, C.pink);
  disc(g, x, y + 2, 8, C.peach);
  ellipse(g, x, y - 5, 10, 6, C.darkbrown);                     // permed hair
  for (const dx of [-8, -4, 0, 4, 8]) disc(g, x + dx, y - 8, 3, C.darkbrown);
  px(g, x - 3, y + 2, C.ink); px(g, x + 3, y + 2, C.ink);
  rect(g, x - 2, y + 6, 5, 1, C.red);
}

function bubble(g, side, y, lines, big) {
  const left = side === 'mom';
  const pad = 7;
  let w = 0;
  for (const l of lines) w = Math.max(w, l.kind === 'digits' ? measureDigits(l.s, 3) : textSprite(l.s, C.ink).width);
  const h = lines.reduce((s, l) => s + (l.kind === 'digits' ? 26 : 15), 0) + pad * 2 - 2;
  const bx = left ? X0 + 40 : X1 - 14 - w - pad * 2, bw = w + pad * 2;
  const bg = left ? (big ? C.cream : C.paper) : C.lime;
  rect(g, bx, y - h, bw, h, C.outline);
  rect(g, bx + 1, y - h + 1, bw - 2, h - 2, bg);
  if (left) poly(g, [[bx + 1, y - 10], [bx - 6, y - 2], [bx + 8, y - 4]], bg);
  else poly(g, [[bx + bw - 2, y - 10], [bx + bw + 5, y - 2], [bx + bw - 8, y - 4]], bg);
  let ty = y - h + pad;
  for (const l of lines) {
    if (l.kind === 'digits') { drawDigits(g, l.s, bx + pad, ty + 2, 3, C.red, { shadow: C.darkred }); ty += 26; }
    else { drawText(g, l.s, bx + pad, ty - 1, l.col || C.ink); ty += 15; }
  }
  if (left) avatarMom(g, X0 + 22, y - 12);
  return y - h - 8;
}

function phone(g, alert, title) {
  rect(g, 0, 0, 640, 360, C.deepblue);
  for (let y = 0; y < 360; y += 24) rect(g, 0, y, 640, 12, C.navy);
  rect(g, X0 - 10, TOP - 6, X1 - X0 + 20, BOT - TOP + 16, C.outline);
  rect(g, X0 - 6, TOP - 2, X1 - X0 + 12, BOT - TOP + 8, C.ink);
  rect(g, X0, TOP + 28, X1 - X0, BOT - TOP - 28, C.lightgray);
  rect(g, X0, TOP, X1 - X0, 28, alert ? C.red : C.green);
  avatarMom(g, X0 + 18, TOP + 15);
  drawText(g, title, X0 + 36, TOP + 7, C.paper);
  drawText(g, alert ? '生氣中' : '上線中', X1 - 8, TOP + 7, C.paper, { align: 'right' });
}

function thread(g, msgs, startY) {
  let y = startY;
  for (let i = msgs.length - 1; i >= 0 && y > TOP + 60; i--) {
    const [, side, text] = msgs[i];
    y = bubble(g, side, y, [{ s: text }]);
  }
}

export default {
  id: 'mom',
  name: '媽媽的訊息',
  hud: 'none',
  catSpot: { x: 560, y: 120 },
  render(g, p, dt, st) {
    phone(g, st.alert, '媽媽');
    const past = SCRIPT.filter(m => m[0] <= p);
    const tone = p > 0.9 ? '我真的會生氣！' : p > 0.6 ? '不回來就完蛋了！' : '要準時回家吃飯喔';
    const y = bubble(g, 'mom', BOT - 10, [{ s: '再' }, { s: hms(st.remaining), kind: 'digits' }, { s: tone, col: p > 0.6 ? C.red : C.ink }], true);
    thread(g, past, y);
    drawText(g, '已讀', X1 - 10, BOT - 4, C.gray, { align: 'right' });
  },
  renderEnd(g, t, st) {
    phone(g, false, '媽媽');
    const msgs = [...SCRIPT, [1, 'mom', '再 00:00:00 不回來就完蛋了！']];
    if (t > 0.6) msgs.push([1, 'me', '我下班了！！']);
    if (t > 1.8) msgs.push([1, 'mom', '好，路上小心 ❤']);
    if (t > 2.8) msgs.push([1, 'mom', '幫我買醬油']);
    thread(g, msgs, BOT - 10);
    return t < 6;
  },
};
