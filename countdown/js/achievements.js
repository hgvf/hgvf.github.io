/* achievements.js — 彩蛋圖鑑, per-animal flip counts (unlock outfits) and badges.
   Records live in localStorage; export/import as JSON to move between machines. */

import { load, save } from './storage.js';
import { todayStr } from './schedule.js';

export const EGGS = [
  { id: 'flip-duck', name: '鴨子翻牌', hint: '有隻黃色的傢伙走路搖搖擺擺', thumb: ['duck', 'peck'] },
  { id: 'flip-bear', name: '熊熊翻牌', hint: '某隻動物好像很睏', thumb: ['bear', 'yawn'] },
  { id: 'flip-dog', name: '狗狗翻牌', hint: '有人叼著東西跑來跑去', thumb: ['dog', 'wag'] },
  { id: 'flip-cat', name: '貓咪翻牌', hint: '桌上的東西好像會掉下去', thumb: ['cat', 'push'] },
  { id: 'gathering', name: '最後一小時集合', hint: '最後一小時，大家好像有約', thumb: ['duck', 'flap'] },
  { id: 'lunch', name: '便當從天而降', hint: '中午十二點，抬頭看看', thumb: ['dog', 'sniff'] },
  { id: 'tea', name: '熊熊偷喝下午茶', hint: '下午三點，有人嘴饞', thumb: ['bear', 'sip'] },
  { id: 'half', name: '已經過一半了', hint: '撐到一半的時候', thumb: ['duck', 'stand'] },
  { id: 'alert', name: '警戒模式', hint: '只剩最後一小時', thumb: ['dog', 'stand'] },
  { id: 'overtime', name: '加班之淚', hint: '按下那顆不該按的按鈕', thumb: ['duck', 'cry'] },
  { id: 'idle-cat', name: '貓躺在數字上', hint: '放著不動久一點', thumb: ['cat', 'sleep'] },
  { id: 'ufo', name: 'UFO 綁架時間牌', hint: '稀有：天上好像有東西', thumb: ['ufo'] },
  { id: 'tail', name: '狗追自己的尾巴', hint: '稀有：有隻狗很無聊', thumb: ['dog', 'walk'] },
  { id: 'shake', name: '搖一搖沙漏', hint: '某個主題裡，沙好像卡住了', thumb: ['cat', 'sit'] },
  { id: 'finale', name: '下班煙火秀', hint: '撐到最後一秒', thumb: ['bear', 'stand'] },
];
export const EGG_BY_ID = Object.fromEntries(EGGS.map(e => [e.id, e]));

export const BADGES = [
  { id: 'zoo', name: '動物園園長', desc: '四種動物都來翻過牌', thumb: ['duck', 'flap'] },
  { id: 'together', name: '全員到齊', desc: '看過最後一小時四隻動物集合翻牌', thumb: ['bear', 'hold'] },
  { id: 'rare', name: '稀客', desc: '看過任一稀有事件', thumb: ['ufo'] },
  { id: 'tears', name: '加班之淚', desc: '第一次按 +30 分鐘，看到鴨子哭', thumb: ['duck', 'cry'] },
  { id: 'catnap', name: '被貓佔據', desc: '掛機觸發貓躺在數字上', thumb: ['cat', 'sleep'] },
  { id: 'fed', name: '吃飽喝足', desc: '便當與下午茶彩蛋都看過', thumb: ['dog', 'sniff'] },
  { id: 'first', name: '第一次下班', desc: '完整看完一次下班煙火', thumb: ['bear', 'stand'] },
  { id: 'attendance', name: '全勤', desc: '連續 5 個上班日都開著看到下班', thumb: ['dog', 'wag'] },
  { id: 'collector', name: '主題收藏家', desc: '每個主題都看過一次完整結局', thumb: ['cat', 'sit'] },
];

export const SKIN_AT = 6;      // flips needed to unlock an animal's outfit

const EMPTY = { eggs: {}, flips: { duck: 0, bear: 0, dog: 0, cat: 0 }, badges: {}, days: [], themesEnded: [] };

export class Achievements {
  constructor(themeIds, onUnlock = () => {}) {
    this.themeIds = themeIds;
    this.onUnlock = onUnlock;
    this.r = { ...EMPTY, ...load('ach', EMPTY) };
    this.r.flips = { ...EMPTY.flips, ...(this.r.flips || {}) };
    this.loadToday();
  }
  loadToday() {
    const t = load('today', null);
    this.today = t && t.date === todayStr() ? t : { date: todayStr(), eggs: [], animals: [], flips: {}, unlocked: [] };
  }
  persist() { save('ach', this.r); save('today', this.today); }

  seen(id) { return !!this.r.eggs[id]; }
  has(badge) { return !!this.r.badges[badge]; }
  skin(animal) { return (this.r.flips[animal] || 0) >= SKIN_AT; }

  /** Record that an egg played. Returns newly unlocked badge ids. */
  seeEgg(id) {
    if (this.today.date !== todayStr()) this.loadToday();
    const e = this.r.eggs[id] || { first: Date.now(), count: 0 };
    const isNew = !this.r.eggs[id];
    e.count++;
    this.r.eggs[id] = e;
    if (!this.today.eggs.includes(id)) this.today.eggs.push(id);
    const out = this.check();
    this.persist();
    return { isNew, badges: out };
  }

  flip(animal) {
    const before = this.skin(animal);
    this.r.flips[animal] = (this.r.flips[animal] || 0) + 1;
    if (!this.today.animals.includes(animal)) this.today.animals.push(animal);
    this.today.flips = this.today.flips || {};
    this.today.flips[animal] = (this.today.flips[animal] || 0) + 1;
    this.persist();
    return !before && this.skin(animal);           // true → outfit just unlocked
  }

  finishDay(date, themeId) {
    if (!this.r.days.includes(date)) this.r.days.push(date);
    this.r.days = this.r.days.slice(-60);
    if (!this.r.themesEnded.includes(themeId)) this.r.themesEnded.push(themeId);
    const out = this.check();
    this.persist();
    return out;
  }

  check() {
    const E = id => !!this.r.eggs[id];
    const rules = {
      zoo: ['flip-duck', 'flip-bear', 'flip-dog', 'flip-cat'].every(E),
      together: E('gathering'),
      rare: E('ufo') || E('tail'),
      tears: E('overtime'),
      catnap: E('idle-cat'),
      fed: E('lunch') && E('tea'),
      first: E('finale'),
      attendance: this.streak() >= 5,
      collector: this.themeIds.every(id => this.r.themesEnded.includes(id)),
    };
    const fresh = [];
    for (const [id, ok] of Object.entries(rules)) {
      if (ok && !this.r.badges[id]) { this.r.badges[id] = Date.now(); fresh.push(id); this.today.unlocked.push(id); this.onUnlock(id); }
    }
    return fresh;
  }

  /** Consecutive finished weekdays ending at the latest finished day. */
  streak() {
    const set = new Set(this.r.days);
    if (!this.r.days.length) return 0;
    const last = this.r.days.slice().sort().pop();
    const [y, m, d] = last.split('-').map(Number);
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const dt = new Date(y, m - 1, d - i);
      if (dt.getDay() === 0 || dt.getDay() === 6) continue;
      if (set.has(todayStr(dt.getTime()))) n++; else break;
    }
    return n;
  }

  exportJSON() { return JSON.stringify({ app: 'offwork-countdown', v: 1, ach: this.r }, null, 2); }
  importJSON(text) {
    const o = JSON.parse(text);
    if (!o || !o.ach || typeof o.ach !== 'object') throw new Error('格式不對');
    this.r = { ...EMPTY, ...o.ach, flips: { ...EMPTY.flips, ...(o.ach.flips || {}) } };
    this.persist();
  }
}
