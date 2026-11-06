/* main.js — bootstrap + frame loop + DOM wiring for 下班倒數計時器.
   Render order per frame: theme → easel/eggs → party animals → particles → HUD →
   finale overlay → idle cat. Time always comes from clock.now(). */

import { C } from './palette.js';
import { W, H, rect, dither, drawDigits, drawText, measureDigits, setFontReady, FONT, clamp, ease } from './pixel.js';
import { now, setWarp, progress, hms, zhDuration } from './clock.js';
import { loadSettings, saveSettings, loadDay, saveDay, freshDay, computeSession, nextWorkStart, todayStr, timeStr, dateStr, at } from './schedule.js';
import { Scheduler } from './events.js';
import { CopyEngine } from './copy.js';
import { Finale, actFor } from './finale.js';
import { Achievements, EGGS, EGG_BY_ID, BADGES } from './achievements.js';
import { Stage, flipEgg, gatheringEgg, lunchEgg, teaEgg, halfEgg, alertEgg, overtimeEgg, ufoEgg, tailEgg } from './eggs.js';
import { THEMES, themeFor, byId } from './themes/index.js';
import { drawOffScene } from './offscene.js';
import { ANIMALS, ANIMAL_NAMES, SKIN_NAMES } from './sprites.js';
import { renderDex, toast, thumb, badgeArt, drawStatsArt, composeShare, shareBlob, drawBrand } from './ui.js';
import { load, save } from './storage.js';

const $ = s => document.querySelector(s);
const HOUR = 3600e3;

/* ---------- state ---------- */
const canvas = $('#stage');
const g = canvas.getContext('2d');
g.imageSmoothingEnabled = false;

let settings = loadSettings();
let day = loadDay(now());
let demo = null;                 // { start, end, theme?, label } — in-memory preview session
let reverse = load('reverse', false);
const sched = new Scheduler();
let demoSched = null;
const copy = new CopyEngine();
const finale = new Finale();
const ach = new Achievements(THEMES.map(t => t.id), id => {
  const b = BADGES.find(x => x.id === id);
  if (b) toast(`成就解鎖：${b.name}`, b.desc, badgeArt(b, false, skinOpts()));
});

const motion = () => settings.motion;
const skinOpts = () => Object.fromEntries(ANIMALS.map(a => [a, ach.skin(a) && settings.skins[a] !== false]));
let hats = false;
const stage = new Stage(() => ({ skins: skinOpts(), lowkey: motion() === 'lowkey', reduced: motion() === 'reduced', hats }));

let lastInput = Date.now();
let prevState = null;
let endT = -1;                   // seconds into the 下班 sequence, -1 = not playing
let endTheme = null;
let statsShown = false;
let subtitle = '';
let lastFrame = performance.now();
let titleBlink = null;
let idleDemo = false;            // preview: summon the idle cat without waiting

const eggOn = id => settings.eggs[id] !== false;

function session() {
  const T = now();
  if (demo) return { start: demo.start, end: demo.end, date: todayStr(T), state: T < demo.end ? 'working' : 'after' };
  if (day.date !== todayStr(T) && !day.pinned) { day = loadDay(T); }
  return computeSession(settings, day, T);
}
const currentTheme = S => demo?.theme ? byId(demo.theme) : themeFor(settings.theme, S.date);

/* ---------- egg triggering ---------- */
function handleEvent(ev) {
  if (!ev) return;
  const k = ev.kind;
  if (k === 'flip') {
    const allowed = ANIMALS.filter(a => eggOn('flip-' + a));
    if (!allowed.length) return;
    let a = stage.pickAnimal();
    if (!allowed.includes(a)) a = allowed[(Math.random() * allowed.length) | 0];
    stage.play(flipEgg(a, ev.from, ev.to));
  } else if (k === 'lastHour') {
    if (eggOn('gathering')) stage.play(gatheringEgg(ev.from, ev.to));
    if (eggOn('alert')) stage.play(alertEgg());
  } else if (k === 'half' && eggOn('half')) stage.play(halfEgg());
  else if (k === 'lunch' && eggOn('lunch')) stage.play(lunchEgg());
  else if (k === 'tea' && eggOn('tea')) stage.play(teaEgg());
  else if (k === 'ufo' && eggOn('ufo')) stage.play(ufoEgg(stage.value));
  else if (k === 'tail' && eggOn('tail')) stage.play(tailEgg());
}

function onEggStart(egg) {
  if (demo) return;
  const r = ach.seeEgg(egg.id);
  if (egg.id.startsWith('flip-')) {
    const a = egg.id.slice(5);
    if (ach.flip(a)) toast(`${ANIMAL_NAMES[a]}解鎖新造型！`, SKIN_NAMES[a], thumb([a, 'stand'], false, skinOpts()));
  }
  if (r.isNew && EGG_BY_ID[egg.id]) toast(`新彩蛋：${EGG_BY_ID[egg.id].name}`, '已收進圖鑑', thumb(EGG_BY_ID[egg.id].thumb, false, skinOpts()));
}

function recordSimple(id) {
  if (demo) return;
  const r = ach.seeEgg(id);
  if (r.isNew && EGG_BY_ID[id]) toast(`新彩蛋：${EGG_BY_ID[id].name}`, '已收進圖鑑', thumb(EGG_BY_ID[id].thumb, false, skinOpts()));
}

/* ---------- HUD ---------- */
function drawHud(remaining, p, t, act, label = '距離下班') {
  const lowkey = motion() === 'lowkey';
  const str = hms(remaining);
  const s = 6;
  const w = measureDigits(str, s);
  const pw = Math.max(w + 28, 196), px0 = 320 - pw / 2;
  rect(g, px0 - 2, 2, pw + 4, 86, C.outline);
  rect(g, px0, 4, pw, 82, C.navy);
  dither(g, px0, 4, pw, 82, C.ink, 0.25);
  rect(g, px0, 4, pw, 2, C.deepblue);
  let col = C.yellow, hi = C.cream, yo = 0;
  if (act >= 2) {
    const frac = (remaining / 1000) % 1;
    if (frac > 0.85 && motion() !== 'reduced') { yo = -1; col = C.white; }
  }
  if (act >= 3) { col = ((t * 2) | 0) % 2 ? C.orange : C.yellow; hi = C.cream; }
  if (stage.alert && act === 0) { col = C.amber; hi = C.yellow; }
  drawDigits(g, str, 320, 12 + yo, s, col, { align: 'center', hi, shadow: C.darkred, outline: C.outline });
  if (p != null) {
    drawText(g, label, px0 + 8, 60, C.lightgray);
    drawText(g, `${Math.floor(p * 100)}%`, px0 + pw - 8, 60, C.cream, { align: 'right' });
    rect(g, px0 + 8, 76, pw - 16, 5, C.ink);
    rect(g, px0 + 8, 76, Math.round((pw - 16) * p), 5, stage.alert ? C.red : C.lime);
    rect(g, px0 + 8, 76, Math.round((pw - 16) * p), 1, C.paper);
  } else {
    drawText(g, label, 320, 64, C.lightgray, { align: 'center' });
  }
  void lowkey;
}

/* ---------- frame ---------- */
function frame(ts) {
  const dt = Math.min(0.1, (ts - lastFrame) / 1000);
  lastFrame = ts;
  const T = now();
  const S = session();
  const theme = currentTheme(S);
  const t = ts / 1000;
  const reduced = motion() === 'reduced', lowkey = motion() === 'lowkey';
  const st = { t, now: T, dt, alert: false, remaining: 0, reduced, lowkey };
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;

  checkTransition(S);

  if (S.state === 'working') {
    const { p, remaining } = progress(S, T);
    const sch = demo ? demoSched : sched;
    sch.setSession(S);
    handleEvent(sch.poll(T));
    stage.value = Math.max(1, Math.ceil(remaining / HOUR));
    stage.alert = remaining <= HOUR;
    st.alert = stage.alert; st.remaining = remaining;
    const act = finale.update(dt, remaining, { lowkey, reduced });
    hats = act >= 1;
    stage.update(dt, onEggStart);
    // idle cat
    const idleMs = Date.now() - lastInput;
    if (stage.idle.state === 'leave') idleDemo = false;
    if (eggOn('idle-cat') && (idleMs > settings.idleMinutes * 60e3 || idleDemo) && !stage.busy && act === 0) {
      stage.idleStart(theme.hud === 'none' ? { x: 320, y: theme.id === 'digital' ? 126 : 240 } : { x: 320, y: 58 });
    }
    if (stage.catAsleep && !stage._catRecorded) { stage._catRecorded = true; recordSimple('idle-cat'); }
    if (!stage.catAsleep && stage.idle.state === 'off') stage._catRecorded = false;

    const shake = act === 3 && !reduced && !lowkey ? [((t * 30) | 0) % 2 ? 1 : -1, ((t * 23) | 0) % 2 ? 1 : 0] : [0, 0];
    g.setTransform(1, 0, 0, 1, shake[0], shake[1]);
    theme.render(g, p, dt, st);
    stage.draw(g);
    if (act >= 1 && !lowkey && !stage.busy) stage.drawParty(g, t, act >= 2 ? 1 : 0);
    finale.drawParticles(g);
    if (theme.hud !== 'none' || act >= 1) drawHud(remaining, p, t, act);
    finale.drawOverlay(g, remaining, t, { lowkey, reduced });
    stage.drawIdle(g);
    g.setTransform(1, 0, 0, 1, 0, 0);

    const slogan = finale.slogan(remaining);
    setSubtitle(slogan || copy.tick(remaining, T), !!slogan);
    showOff(false);
  } else if (endT >= 0) {
    // 下班 sequence: theme ending + fireworks + 「下班了！」 + stats card
    endT += dt;
    st.dt = dt;
    const playing = endTheme.renderEnd(g, endT, st);
    finale.update(dt, 0, { lowkey, reduced });
    stage.value = 0;
    if (!lowkey) stage.drawParty(g, t, 1);
    finale.drawParticles(g);
    const k = ease(clamp((endT - 0.9) / 0.6));
    if (k > 0) {
      const y = Math.round(150 - (1 - k) * 60 + (reduced ? 0 : Math.sin(t * 4) * 3));
      drawText(g, '下班了！', 320, y, C.yellow, { align: 'center', scale: 4, outline: C.outline });
    }
    setSubtitle(endT < 1 ? '……' : '下班了！今天也辛苦了。', true);
    if (endT > 4.5 && !statsShown) { statsShown = true; openStats(); }
    if (!playing && endT > 30 && !$('#dlgStats').open) { endT = -1; }
    showOff(false);
  } else {
    // after hours / weekend / before work
    stage.update(dt);
    drawOffScene(g, t, S.state, skinOpts());
    const target = S.state === 'before' ? S.start : nextWorkStart(settings, T);
    if (S.state === 'before' || reverse) drawHud(target - T, null, t, 0, S.state === 'before' ? '距離上班（還能睡）' : '距離下一個上班日');
    finale.fx.update(dt);            // let leftover sparks fade; no new launches here
    finale.drawParticles(g);
    showOff(true, S);
    setSubtitle(S.state === 'before'
      ? `還有 ${zhDuration(S.start - T)} 才上班，現在打開是想提早難過嗎？`
      : reverse ? `距離下一個上班日還有 ${zhDuration(target - T)}。好好享受。` : '倒數結束了。去吃飯、去睡覺、去做任何不是上班的事。');
  }
  requestAnimationFrame(frame);
}

function checkTransition(S) {
  if (prevState === 'working' && S.state === 'after') {
    endT = 0; statsShown = false;
    endTheme = currentTheme(S);
    endTheme.resetEnd && endTheme.resetEnd();
    if (!demo) {
      ach.seeEgg('finale');
      const fresh = ach.finishDay(S.date, endTheme.id);
      ach.today.endedAt = now();
      ach.today.workedMs = S.end - S.start;
      save('today', ach.today);
      void fresh;
    }
    notifyEnd();
  }
  if (S.state === 'working' && prevState !== 'working') { finale.reset(); endT = -1; }
  prevState = S.state;
}

function setSubtitle(text, big = false) {
  if (text === subtitle) return;
  subtitle = text;
  const el = $('#copy');
  el.textContent = text;
  el.classList.toggle('big', big);
}

let offShown = null;
function showOff(on, S) {
  const panel = $('#offPanel');
  const key = on ? `${S.state}|${reverse}` : 'none';
  if (key === offShown) return;
  offShown = key;
  panel.hidden = !on;
  if (!on) return;
  panel.classList.toggle('compact', reverse || S.state === 'before');
  const titles = {
    after: ['你已經下班了，為什麼還開著', '關掉分頁吧。真的。'],
    weekend: ['今天不用上班，為什麼還開著', '放假就好好放假。'],
    before: ['還沒上班', '倒數會在上班時間自動開始。'],
  };
  const [h, p] = titles[S.state] || titles.after;
  $('#offTitle').textContent = h;
  $('#offSub').textContent = p;
  $('#offReverse').textContent = reverse ? '關掉反向倒數' : '反向倒數到下一個上班日';
  $('#offReverse').hidden = S.state === 'before';
}

/* ---------- notifications / title / wake lock ---------- */
function notifyEnd() {
  if (!document.hidden) return;
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('下班了！', { body: '倒數結束，可以走了。', icon: 'assets/icon-192.png' }); } catch { /* ignore */ }
  clearInterval(titleBlink);
  let on = false;
  titleBlink = setInterval(() => { on = !on; document.title = on ? '★ 下班了！★' : '下班倒數計時器'; }, 900);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { clearInterval(titleBlink); titleBlink = null; requestWake(); lastInput = Date.now(); }
});
// background tick: rAF pauses in hidden tabs, so title + end detection run here too
setInterval(() => {
  const S = session();
  if (document.hidden) checkTransition(S);
  if (titleBlink) return;
  if (S.state === 'working') document.title = `${hms(S.end - now())} · 下班倒數`;
  else document.title = '下班倒數計時器';
}, 1000);

let wakeLock = null;
async function requestWake() {
  try { if ('wakeLock' in navigator && !document.hidden && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* unsupported / denied */ }
}

/* ---------- canvas sizing: whole-number scaling in device pixels ---------- */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const wrap = $('#stageWrap');
  const availW = wrap.clientWidth;
  const reserved = document.fullscreenElement ? 120 : 190;
  const availH = Math.max(200, window.innerHeight - reserved);
  let k = Math.floor(Math.min(availW * dpr / W, availH * dpr / H));
  let cssW;
  if (k >= 2) cssW = (W * k) / dpr;
  else cssW = Math.min(availW, availH * W / H);           // tiny screens: fit (still pixelated)
  canvas.style.width = cssW + 'px';
  canvas.style.height = (cssW * H / W) + 'px';
}
window.addEventListener('resize', resize);

/* ---------- input ---------- */
['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, () => { lastInput = Date.now(); stage.idleWake(); }, { passive: true }));

canvas.addEventListener('click', e => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  const S = session();
  const lowkey = motion() === 'lowkey';
  if (S.state !== 'working') { if (endT >= 0 || S.state === 'after') finale.click(x, y, lowkey); return; }
  const rem = S.end - now();
  if (actFor(rem) >= 4) { finale.click(x, y, lowkey); return; }
  const theme = currentTheme(S);
  if (theme.click) { const res = theme.click(x, y); if (res === 'unstuck') recordSimple('shake'); }
});

/* ---------- overtime ---------- */
$('#btnOvertime').addEventListener('click', () => {
  const S0 = session();
  if (S0.state !== 'working' && endT < 0) { toast('現在不是上班時間', '沒有班可以加，恭喜。'); return; }
  const before = Math.max(1, Math.ceil((S0.end - now()) / HOUR));
  if (demo) demo.end += 30 * 60e3;
  else { day.extraMinutes = (day.extraMinutes || 0) + 30; saveDay(day); }
  const S = session();
  const after = Math.max(1, Math.ceil((S.end - now()) / HOUR));
  endT = -1; prevState = 'working';
  if (eggOn('overtime')) { stage.queue.unshift(overtimeEgg(before, after)); }
  toast('下班時間 +30 分鐘', `新的下班時間 ${timeStr(new Date(S.end))}`);
});

/* ---------- off-work panel ---------- */
$('#offReverse').addEventListener('click', () => { reverse = !reverse; save('reverse', reverse); offShown = null; });
$('#offPunch').addEventListener('click', () => {
  const T = now();
  day = { ...freshDay(todayStr(T)), punch: timeStr(new Date(T)), working: true };
  saveDay(day); offShown = null; demo = null; endT = -1;
  toast('打卡成功', `${day.punch} 上班，今天也加油。`);
  requestWake();
});

/* ---------- settings dialog ---------- */
const form = $('#formSettings');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
$('#themeSelect').innerHTML = THEMES.map(t => `<option value="${t.id}">${t.name}</option>`).join('') + '<option value="random">每天隨機</option>';
$('#workdays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" name="wd" value="${d}"> ${WEEK[d]}</label>`).join('');
$('#eggToggles').innerHTML = EGGS.filter(e => e.id !== 'finale').map(e => `<label><input type="checkbox" name="egg" value="${e.id}"> ${e.name}</label>`).join('');

function fillForm() {
  const T = now();
  const S = computeSession(settings, day, T);
  form.date.value = day.date;
  form.start.value = day.punch || settings.startTime;
  form.rule.value = settings.rule.type;
  form.hours.value = settings.rule.hours || 9;
  form.fixedTime.value = settings.fixedTime || '18:00';
  form.manualEnd.value = day.manualEnd || `${day.date}T${timeStr(new Date(S.end))}`;
  form.lunchCounted.checked = settings.lunch.counted;
  form.lunchMinutes.value = settings.lunch.minutes;
  form.theme.value = settings.theme;
  form.motion.value = settings.motion;
  form.idleMinutes.value = settings.idleMinutes;
  form.querySelectorAll('[name=wd]').forEach(cb => { cb.checked = settings.workdays.includes(Number(cb.value)); });
  form.querySelectorAll('[name=egg]').forEach(cb => { cb.checked = eggOn(cb.value); });
}
function openSettings() { fillForm(); $('#dlgSettings').showModal(); }

$('#btnPunch').addEventListener('click', () => {
  const d = new Date(now());
  form.start.value = timeStr(d);
  form.date.value = dateStr(d);
});
$('#btnCancel').addEventListener('click', () => $('#dlgSettings').close());
form.addEventListener('submit', e => {
  e.preventDefault();
  const startVal = form.start.value || settings.startTime;
  settings = {
    ...settings,
    configured: true,
    startTime: startVal,
    rule: { type: form.rule.value, hours: Number(form.hours.value) || 9 },
    fixedTime: form.fixedTime.value || '18:00',
    lunch: { counted: form.lunchCounted.checked, minutes: Number(form.lunchMinutes.value) || 0 },
    theme: form.theme.value,
    motion: form.motion.value,
    idleMinutes: Math.max(1, Number(form.idleMinutes.value) || 5),
    workdays: [...form.querySelectorAll('[name=wd]:checked')].map(cb => Number(cb.value)),
    eggs: Object.fromEntries([...form.querySelectorAll('[name=egg]')].map(cb => [cb.value, cb.checked])),
  };
  const date = form.date.value || todayStr(now());
  const sameDay = date === day.date;
  day = {
    ...(sameDay ? day : freshDay(date)),
    date,
    punch: startVal,
    manualEnd: form.rule.value === 'manual' ? form.manualEnd.value : null,
    pinned: date !== todayStr(now()),
    working: true,
  };
  saveSettings(settings); saveDay(day);
  demo = null; setWarp(1); $('#demoChip').hidden = true;
  endT = -1; prevState = null; offShown = null;
  $('#dlgSettings').close();
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
  requestWake();
  const S = session();
  if (S.state === 'working') toast('開始倒數', `${timeStr(new Date(S.end))} 下班，還有 ${zhDuration(S.end - now())}`);
});

/* ---------- demo / preview ---------- */
function startDemo(kind) {
  $('#dlgSettings').close();
  const T = Date.now();
  setWarp(1);
  const base = { start: T - 4 * HOUR, end: T + 3.5 * HOUR, label: '預覽模式' };
  demoSched = new Scheduler();
  demoSched.fired = { date: 'demo', ids: [] };
  if (kind === 'last5') demo = { ...base, start: T - 9 * HOUR, end: T + 5 * 60e3 + 3e3, label: '預覽：最後 5 分鐘' };
  else if (kind === 'last15') demo = { ...base, start: T - 9 * HOUR, end: T + 15e3, label: '預覽：最後 15 秒' };
  else if (kind === 'day') {
    demo = { start: T, end: T + 9 * HOUR, label: '預覽：整天快轉 ×600' };
    setWarp(600, T);
  } else {
    demo = { ...base, label: '預覽：彩蛋' };
  }
  // silence every real event in the demo session (except the full-day fast-forward)
  if (kind !== 'day') {
    demoSched.setSession({ ...demo, date: todayStr(T) });
    demoSched.fired.ids = demoSched.events.map(e => e.id);
  }
  stage.queue.length = 0; stage.egg = null; stage.card = null;
  finale.reset(); endT = -1; prevState = 'working';
  const v = Math.max(1, Math.ceil((demo.end - T) / HOUR));
  const eggs = {
    'flip-duck': () => flipEgg('duck', v + 1, v), 'flip-bear': () => flipEgg('bear', v + 1, v),
    'flip-dog': () => flipEgg('dog', v + 1, v), 'flip-cat': () => flipEgg('cat', v + 1, v),
    gathering: () => gatheringEgg(2, 1), lunch: lunchEgg, tea: teaEgg, ufo: () => ufoEgg(v), tail: tailEgg,
  };
  if (eggs[kind]) stage.play(eggs[kind]());
  if (kind === 'idle') idleDemo = true;
  $('#demoLabel').textContent = demo.label;
  $('#demoChip').hidden = false;
}
document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => startDemo(b.dataset.demo)));
$('#demoExit').addEventListener('click', () => {
  demo = null; setWarp(1); $('#demoChip').hidden = true;
  stage.queue.length = 0; stage.egg = null; stage.card = null; stage.idleWake();
  finale.reset(); endT = -1; prevState = null;
});

/* ---------- data ---------- */
$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([ach.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `offwork-achievements-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
});
$('#fileImport').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { ach.importJSON(await f.text()); toast('匯入完成', '圖鑑與成就已更新'); }
  catch (err) { toast('匯入失敗', String(err.message || err)); }
  e.target.value = '';
});
$('#btnResetDay').addEventListener('click', () => {
  day = freshDay(todayStr(now())); saveDay(day);
  sched.key = ''; save('fired', { date: '', ids: [] }); sched.fired = { date: '', ids: [] };
  $('#dlgSettings').close(); toast('今天已重設', '上班時間回到預設值');
});

/* ---------- dex ---------- */
let dexTab = 'eggs';
function openDex() { renderDex(dexTab, ach, skinOpts(), toggleSkin); $('#dlgDex').showModal(); }
function toggleSkin(a, on) { settings.skins = { ...settings.skins, [a]: on }; saveSettings(settings); renderDex(dexTab, ach, skinOpts(), toggleSkin); }
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  dexTab = b.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  renderDex(dexTab, ach, skinOpts(), toggleSkin);
}));
$('#dexClose').addEventListener('click', () => $('#dlgDex').close());

/* ---------- stats card ---------- */
function openStats() {
  const td = ach.today;
  const S = session();
  const worked = demo ? (demo.end - demo.start) : (td.workedMs || (S.end - S.start));
  const flips = td.flips || {};
  drawStatsArt($('#statsArt'), flips, skinOpts());
  const animals = ANIMALS.filter(a => flips[a]).map(a => `${ANIMAL_NAMES[a]} ×${flips[a]}`).join('、') || '今天沒有動物來翻牌';
  const unlocked = (td.unlocked || []).map(id => BADGES.find(b => b.id === id)?.name).filter(Boolean);
  $('#statsList').innerHTML = [
    `今天撐了 <b>${zhDuration(worked)}</b>`,
    `看過 <b>${(td.eggs || []).length}</b> 個彩蛋`,
    `來翻牌的動物：<b>${animals}</b>`,
    `本日新解鎖成就：<b>${unlocked.length ? unlocked.join('、') : '沒有，明天再來'}</b>`,
    demo ? '<span style="color:#8a8b94">（預覽模式，不列入紀錄）</span>' : `連續上班：<b>${ach.streak()}</b> 天`,
  ].map(s => `<li>${s}</li>`).join('');
  $('#dlgStats').showModal();
}
$('#statsClose').addEventListener('click', () => { $('#dlgStats').close(); endT = -1; });
$('#statsShare').addEventListener('click', async () => {
  const lines = [...$('#statsList').querySelectorAll('li')].map(li => li.textContent).slice(0, 3).join(' · ');
  const blob = await composeShare(canvas, `下班了！${lines}`);
  shareBlob(blob, `offwork-${todayStr()}.png`);
});

/* ---------- topbar ---------- */
$('#btnSettings').addEventListener('click', openSettings);
$('#btnDex').addEventListener('click', openDex);
$('#btnShare').addEventListener('click', async () => {
  const blob = await composeShare(canvas, subtitle);
  const r = await shareBlob(blob, `offwork-${todayStr()}.png`);
  if (r === 'downloaded') toast('截圖已下載', '貼到群組吧');
});
$('#btnFull').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('#app').requestFullscreen();
  } catch { toast('這個瀏覽器不支援全螢幕', ''); }
  requestWake();
  setTimeout(resize, 120);
});
document.addEventListener('fullscreenchange', () => { $('#btnFull').textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕'; setTimeout(resize, 60); });

/* debug handle (handy in devtools; not used by the app) */
window.__offwork = { stage, finale, ach, get settings() { return settings; }, get lastInput() { return lastInput; } };

/* ---------- boot ---------- */
async function boot() {
  drawBrand($('#brandIcon'));
  if (!settings.configured && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) settings.motion = 'reduced';
  try { await Promise.race([document.fonts.load(`12px ${FONT}`), new Promise(r => setTimeout(r, 2500))]); } catch { /* fallback font */ }
  if (document.fonts && document.fonts.check(`12px ${FONT}`)) setFontReady();
  resize();
  const params = new URLSearchParams(location.search);
  if (params.get('demo')) startDemo(params.get('demo'));
  if (params.get('theme')) { settings.theme = params.get('theme'); }
  requestAnimationFrame(t => { lastFrame = t; frame(t); });
  if (!settings.configured && !params.get('demo')) openSettings();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
