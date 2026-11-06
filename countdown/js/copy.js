/* copy.js — 荒謬時間換算文案引擎.
   Picks an activity whose duration fits in the time left and drops it into a
   template. As the day runs out the activities shrink on their own (Tokyo flight →
   instant noodles), so the subtitle doubles as a progress bar.
   Durations are rough estimates (標示「約」), not facts to quote. */

import { load, save } from './storage.js';
import { zhDuration } from './clock.js';

export const ACTIVITIES = [
  // 3 小時以上
  { id: 'tpe-sin', minutes: 280, text: '從台北飛到新加坡', tag: 'travel' },
  { id: 'tpe-kenting', minutes: 330, text: '從台北開車到墾丁', tag: 'travel' },
  { id: 'titanic', minutes: 195, text: '看完一整部《鐵達尼號》', tag: 'movie' },
  { id: 'tpe-nrt', minutes: 180, text: '從台北飛到東京', tag: 'travel' },
  { id: 'ice', minutes: 180, text: '讓冷凍庫把一盒水結成冰塊', tag: 'home' },
  { id: 'puyuma', minutes: 210, text: '搭普悠瑪從台北到台東', tag: 'travel' },
  { id: 'marathon', minutes: 270, text: '用業餘跑者的速度跑完一場全馬', tag: 'sport' },
  { id: 'mlb', minutes: 160, text: '看完一場大聯盟比賽', tag: 'sport' },
  // 1～3 小時
  { id: 'tpe-icn', minutes: 150, text: '從台北飛到首爾', tag: 'travel' },
  { id: 'nba', minutes: 135, text: '看完一場 NBA 比賽', tag: 'sport' },
  { id: 'elite-marathon', minutes: 122, text: '像頂尖選手一樣跑完全馬', tag: 'sport' },
  { id: 'movie', minutes: 120, text: '看完一部長片', tag: 'movie' },
  { id: 'beef', minutes: 120, text: '燉好一鍋紅燒牛肉', tag: 'food' },
  { id: 'tpe-hkg', minutes: 110, text: '從台北飛到香港', tag: 'travel' },
  { id: 'football', minutes: 105, text: '看完一場足球賽（含中場）', tag: 'sport' },
  { id: 'hsr', minutes: 100, text: '搭高鐵從台北到高雄', tag: 'travel' },
  { id: 'iss', minutes: 92, text: '跟著國際太空站繞地球一圈', tag: 'space' },
  { id: 'prince', minutes: 90, text: '讀完一本《小王子》', tag: 'learn' },
  { id: 'tshirt', minutes: 90, text: '在台灣夏天曬乾一件 T 恤', tag: 'home' },
  { id: 'washer', minutes: 60, text: '讓洗衣機跑完一輪', tag: 'home' },
  { id: 'gym', minutes: 60, text: '練完一整套健身菜單', tag: 'sport' },
  // 10～60 分鐘
  { id: 'got', minutes: 57, text: '看完一集影集', tag: 'tv' },
  { id: 'bannan', minutes: 50, text: '把捷運板南線從頭坐到尾', tag: 'travel' },
  { id: 'album', minutes: 45, text: '聽完一整張專輯', tag: 'music' },
  { id: 'badminton', minutes: 45, text: '打完一場羽球單打', tag: 'sport' },
  { id: 'moba', minutes: 32, text: '打完一場 MOBA 對戰', tag: 'game' },
  { id: 'coffee', minutes: 30, text: '讓一杯熱咖啡放到變涼', tag: 'home' },
  { id: 'nap', minutes: 26, text: '睡一場「科學認證」的完美午覺', tag: 'home' },
  { id: 'sloth', minutes: 25, text: '讓一隻樹懶爬完 100 公尺', tag: 'animal' },
  { id: 'sitcom', minutes: 22, text: '看完一集情境喜劇', tag: 'tv' },
  { id: 'ted', minutes: 18, text: '聽完一場 TED 演講', tag: 'learn' },
  { id: 'snail', minutes: 17, text: '讓一隻蝸牛爬完一公尺', tag: 'animal' },
  { id: 'mask', minutes: 15, text: '敷完一片面膜', tag: 'home' },
  { id: '3000m', minutes: 15, text: '跑完 3000 公尺', tag: 'sport' },
  { id: 'meditate', minutes: 10, text: '好好冥想一次', tag: 'home' },
  { id: 'egg', minutes: 10, text: '煮熟一顆水煮蛋', tag: 'food' },
  { id: 'stairs101', minutes: 11, text: '用登高賽紀錄的速度爬上台北 101', tag: 'extreme' },
  // 10 分鐘內
  { id: 'sunlight', minutes: 8.3, text: '等太陽光跑到地球', tag: 'space' },
  { id: 'skydive', minutes: 7, text: '從兩萬英尺跳傘落地', tag: 'extreme' },
  { id: 'bohemian', minutes: 6, text: '聽完一首搖滾經典', tag: 'music' },
  { id: 'pomelo', minutes: 5, text: '剝完一顆柚子', tag: 'food' },
  { id: 'pushup', minutes: 5, text: '做完 100 下伏地挺身', tag: 'sport' },
  { id: 'noodle', minutes: 3, text: '泡好一碗泡麵', tag: 'food' },
  { id: 'teeth', minutes: 2, text: '照牙醫建議好好刷一次牙', tag: 'home' },
  { id: 'bento-mw', minutes: 2, text: '微波一個便當', tag: 'food' },
  { id: 'milk', minutes: 1.5, text: '微波一杯牛奶', tag: 'food' },
  { id: 'pizza', minutes: 1.5, text: '用窯烤出一片拿坡里披薩', tag: 'food' },
  // 1 分鐘內
  { id: 'chorus', minutes: 0.25, text: '聽完半首副歌', tag: 'music' },
  { id: 'cheetah', minutes: 0.06, text: '讓獵豹衝完一百公尺', tag: 'animal' },
  { id: 'moonlight', minutes: 0.022, text: '等月光跑到地球', tag: 'space' },
  { id: 'say', minutes: 0.03, text: '大喊一聲「我下班了」', tag: 'extreme' },
];

const TEMPLATES = [
  (r, a) => `${r} 已經夠你${a.text}了，你還坐在這。`,
  (r, a) => `${r}，別人已經${a.text}，而你在等下班。`,
  (r, a, n) => n >= 2 ? `還有 ${r}？足夠${a.text} ${n} 次。` : null,
  (r, a) => `剩下的 ${r}，拿去${a.text}都綽綽有餘。`,
];

const DAY = 86400e3;

export class CopyEngine {
  constructor() {
    this.used = load('copyUsed', {});     // id → last shown (ms)
    this.lastTag = null;
    this.choice = null;                   // { a, tpl } — re-rendered live every call
    this.nextAt = 0;
  }

  /** Call every frame; the activity changes every 3–5 min, the numbers stay live. */
  tick(remainingMs, nowMs, force = false) {
    const remMin = remainingMs / 60000;
    if (remMin <= 0) return '下班了！現在去做上面那些事吧。';
    const stale = !this.choice || this.choice.a.minutes > remMin;
    if (force || stale || nowMs >= this.nextAt) {
      this.choice = this.pick(remMin, nowMs);
      this.nextAt = nowMs + (180 + Math.random() * 120) * 1000;
    }
    if (!this.choice) return '連喊一聲「我下班了」的時間都快不夠了。';
    const { a, tpl } = this.choice;
    const r = zhDuration(remainingMs), n = Math.floor(remMin / a.minutes);
    return TEMPLATES[tpl](r, a, n) || TEMPLATES[0](r, a, n);
  }

  pick(remMin, nowMs) {
    const fit = ACTIVITIES.filter(a => a.minutes <= remMin);
    if (!fit.length) return null;
    // prefer activities that use a meaningful chunk of the time left (so it degrades with p)
    const big = fit.filter(a => a.minutes >= remMin * 0.25);
    let pool = big.length >= 3 ? big : fit.slice().sort((a, b) => b.minutes - a.minutes).slice(0, 8);
    const fresh = pool.filter(a => !(this.used[a.id] > nowMs - DAY) && a.tag !== this.lastTag);
    if (fresh.length) pool = fresh;
    else { const alt = pool.filter(a => a.tag !== this.lastTag); if (alt.length) pool = alt; }
    const a = pool[(Math.random() * pool.length) | 0];
    this.used[a.id] = nowMs; this.lastTag = a.tag;
    for (const [k, v] of Object.entries(this.used)) if (v < nowMs - DAY) delete this.used[k];
    save('copyUsed', this.used);
    const n = Math.floor(remMin / a.minutes);
    const options = TEMPLATES.map((t, i) => i).filter(i => i !== 2 || n >= 2);
    return { a, tpl: options[(Math.random() * options.length) | 0] };
  }
}
