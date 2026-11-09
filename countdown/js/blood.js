/* blood.js — 「我今天不用上班！」 punishment: blood seeps down from the top of the
   window in chunky pixels while red lines appear one after another. It's a joke,
   but a thorough one. Click (or Esc) to leave once the last line has shown. */

const PX = 4;                                   // css px per blood pixel
const COL = { deep: '#3b0a14', dark: '#7a1c2b', red: '#c8323c', hi: '#e07aa8' };
const OPEN = '今天，為什麼不用上班……';
const CLOSE = ['明天……你逃不掉的。', '我們明天見。準時。', '下次，就沒這麼好運了。'];
const MIDDLE = [
  '不用上班的人，為什麼要點進來？',
  '你是來炫耀的嗎……',
  '我們都還在上班。',
  '我們都看到了。',
  '你的同事正在看著你。',
  '這個倒數，不是為你準備的。',
  '你的位子……還是熱的。',
  '主管剛剛問起你。',
  '你的工作，現在是誰在做？',
  '群組裡有 99+ 則未讀訊息。',
  '你沒有把電腦關機。',
  '你的螢幕保護程式在等你。',
  '印表機在叫你的名字。',
  '會議室裡，有一張空椅子。',
  '今天的會議記錄，寫著你的名字。',
  '你的請假單……真的送出了嗎？',
  '有人在你桌上留了一張紙條。',
  '茶水間的咖啡，已經冷了。',
  '打卡機記得你。',
  '你逃得了今天，逃不了月底。',
  '那封信，你還沒回。',
  '鴨子在等你翻牌。',
  '時間牌沒有人翻……它自己動了。',
  '貓，坐在你的鍵盤上。',
  '連熊都在上班。',
  '你以為關掉分頁就沒事了？',
  '放假的人，不該知道這個網址。',
  '我們會記住今天的。',
  '在辦公室裡，有人小聲說了你的名字。',
  '你的出勤紀錄，多了一個空格。',
];

/** This visit's script: fixed opener, 6 random middle lines, one closer. */
function script() {
  const mid = MIDDLE.slice();
  for (let i = mid.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [mid[i], mid[j]] = [mid[j], mid[i]]; }
  return [OPEN, ...mid.slice(0, 6), CLOSE[(Math.random() * CLOSE.length) | 0]];
}

export function bleed({ reduced = false } = {}) {
  if (document.querySelector('.blood')) return;
  const ov = document.createElement('div');
  ov.className = 'blood' + (reduced ? ' calm' : '');
  ov.setAttribute('role', 'alert');
  const cv = document.createElement('canvas');
  const txt = document.createElement('div'); txt.className = 'blood-text';
  const hint = document.createElement('div'); hint.className = 'blood-hint'; hint.textContent = '（點一下，回去面對你的假日）';
  ov.append(cv, txt, hint);
  document.body.appendChild(ov);

  const W = Math.ceil(innerWidth / PX), H = Math.ceil(innerHeight / PX);
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  // one drip per column; a few become long streaks
  const cols = Array.from({ length: W }, () => {
    const long = Math.random() < 0.16;
    return { len: 0, max: long ? H * (0.35 + Math.random() * 0.6) : 2 + Math.random() * H * 0.08, speed: (long ? 6 : 2) + Math.random() * (long ? 14 : 4), delay: Math.random() * 1.6 };
  });
  // smooth neighbouring columns so drips look like blobs, not noise
  for (let i = 1; i < W - 1; i++) cols[i].max = (cols[i - 1].max + cols[i].max * 2 + cols[i + 1].max) / 4;
  const drops = [];
  const LINES = script();
  const t0 = performance.now();
  let line = -1, raf = 0, done = false;

  function frame(now) {
    const t = (now - t0) / 1000, dt = 1 / 60;
    g.clearRect(0, 0, W, H);
    g.fillStyle = `rgba(11,0,4,${Math.min(0.62, t * 0.08)})`;
    g.fillRect(0, 0, W, H);
    const band = Math.min(H * 0.05, t * 3);
    g.fillStyle = COL.deep; g.fillRect(0, 0, W, Math.ceil(band));
    for (let x = 0; x < W; x++) {
      const c = cols[x];
      if (t > c.delay && c.len < c.max) c.len = Math.min(c.max, c.len + c.speed * dt * (reduced ? 0.6 : 1));
      const L = Math.round(band + c.len);
      g.fillStyle = COL.dark; g.fillRect(x, 0, 1, L);
      if (c.len > 3) { g.fillStyle = COL.red; g.fillRect(x, Math.max(0, L - 2), 1, 2); }
      if (c.max > H * 0.2 && c.len >= c.max - 0.5 && Math.random() < 0.006) drops.push({ x, y: L, v: 0 });
    }
    // bulbous tips on the long streaks
    for (let x = 1; x < W - 1; x++) {
      const c = cols[x];
      if (c.max > H * 0.2 && c.len > 4 && cols[x - 1].len < c.len && cols[x + 1].len <= c.len) {
        const L = Math.round(band + c.len);
        g.fillStyle = COL.red; g.fillRect(x - 1, L - 1, 3, 3);
        g.fillStyle = COL.hi; g.fillRect(x - 1, L - 1, 1, 1);
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.v += 60 * dt; d.y += d.v * dt;
      g.fillStyle = COL.red; g.fillRect(d.x, Math.round(d.y), 1, 2);
      if (d.y > H) drops.splice(i, 1);
    }
    // lines: one every 2.4 s, starting after the blood has had a moment
    const want = Math.min(LINES.length - 1, Math.floor((t - 1.2) / 2.4));
    if (want > line && t > 1.2) {
      line = want;
      txt.textContent = LINES[line];
      txt.classList.remove('in'); void txt.offsetWidth; txt.classList.add('in');
      if (line === LINES.length - 1) setTimeout(() => { done = true; hint.classList.add('show'); }, 1800);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const close = () => {
    if (!done) return;
    ov.classList.add('out');
    setTimeout(() => { cancelAnimationFrame(raf); ov.remove(); removeEventListener('keydown', onKey); }, 700);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', close);
  addEventListener('keydown', onKey);
}
