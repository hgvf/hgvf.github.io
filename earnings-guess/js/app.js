// app.js — 法說會盲猜 frontend. Reads data/index.json + data/calls/<id>.json,
// keeps answers in localStorage (one answer per card per browser).
import { deobfuscate, obfuscate } from './obf.js';
import { drawCallChart } from './chart.js';
import { score, shareText, stats, toCSV, binOf, binsFor, BIN_NAMES, BIN_RANGE, DEADBAND } from './scoring.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '—');
const pct0 = x => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const sign = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
const view = $('#view');
const SENT = { bullish: ['偏多', 'pos'], bearish: ['偏空', 'neg'], neutral: ['中性', ''] };
const SESSION = { BMO: '盤前', AMC: '盤後' };
const WIN = { r1: '1 日', r5: '5 日' };
const BENCH = { sector: '相對產業 ETF', market: '相對大盤 SPY' };
const todayTW = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400); }
function download(name, text, type = 'application/json') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }

// ── storage ──
const LS = { ans: 'eg.answers', set: 'eg.settings' };
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('瀏覽器不允許儲存，作答紀錄不會保留'); } };
const settings = () => ({ window: 'r1', bench: 'sector', hint: false, ...load(LS.set, {}) });
const answers = () => load(LS.ans, {});

// ── data ──
const DEMO = new URLSearchParams(location.search).has('demo');
let INDEX = null;
const cardCache = new Map();
async function loadIndex() {
  if (INDEX) return INDEX;
  if (DEMO) { INDEX = demoIndex(); return INDEX; }
  try {
    const r = await fetch('data/index.json', { cache: 'no-cache' });
    INDEX = r.ok ? (await r.json()).calls || [] : [];
  } catch { INDEX = []; }
  INDEX.sort((a, b) => (b.releasedOn.localeCompare(a.releasedOn)) || b.n - a.n);
  return INDEX;
}
async function loadCard(id) {
  if (cardCache.has(id)) return cardCache.get(id);
  const c = DEMO ? demoCards().find(x => x.id === id) : await fetch(`data/calls/${id}.json`).then(r => (r.ok ? r.json() : null));
  if (!c) throw new Error('找不到這張卡');
  cardCache.set(id, c);
  return c;
}

// ── router ──
async function route() {
  const [, name = 'play', arg] = (location.hash || '#/play').split('/');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name || (name === 'card' && a.dataset.route === 'bank') || (name === 'today' && a.dataset.route === 'play')));
  const ban = $('#banner');
  ban.hidden = !DEMO;
  if (DEMO) ban.innerHTML = '示範模式：卡片內容與答案都是虛構的，作答會記在獨立的紀錄裡。<a href="./" style="text-decoration:underline">離開示範</a>';
  view.innerHTML = '';
  try {
    if (name === 'card') await renderCard(arg);
    else if (name === 'bank') await renderBank();
    else if (name === 'stats') await renderStats();
    else if (name === 'settings') renderSettings();
    else await renderPlayNext();
  } catch (e) { console.error(e); view.innerHTML = `<div class="card empty">出錯了：${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
if (DEMO) { LS.ans = 'eg.answers.demo'; }

async function renderPlayNext() {
  const idx = await loadIndex();
  if (!idx.length) {
    view.innerHTML = `<div class="card empty" style="max-width:none">
      <h2 style="justify-content:center">還沒有上架的卡片</h2>
      <p>法說會反應視窗（t0+19 個交易日）結束、去識別化通過後就會自動上架。</p>
      <p style="margin-top:12px"><a class="btn btn-primary" href="?demo=1#/play">先玩示範卡</a></p></div>`;
    return;
  }
  const A = answers();
  const todo = idx.filter(c => !A[c.id]);
  if (!todo.length) {
    view.innerHTML = `<div class="card empty" style="max-width:none"><h2 style="justify-content:center">全部 ${idx.length} 張都玩過了 🎉</h2>
      <p>新的法說會反應視窗結束後會自動上架。</p><p style="margin-top:12px"><a class="btn btn-primary" href="#/stats">看統計</a> <a class="btn" href="#/bank">回顧題庫</a></p></div>`;
    return;
  }
  // 新上架的優先，其餘隨機
  const fresh = todo.filter(c => c.releasedOn >= idx[0].releasedOn);
  const pool = fresh.length ? fresh : todo;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  history.replaceState(null, '', `#/card/${pick.id}`);
  await renderCard(pick.id, `還有 ${todo.length} 張沒玩${fresh.length ? ' · 新上架' : ''}`);
}

async function renderCard(id, label) {
  const c = await loadCard(id);
  const st = settings();
  const prev = answers()[id];
  const truth = deobfuscate(c.answer);               // sentiments live in the obfuscated answer
  const N = c.highlights.length;
  // step state (not persisted: refreshing restarts the walk-through)
  const q = { shown: prev || st.hint ? N : 1 };
  const mode = prev ? 'reveal' : st.hint ? 'hint' : 'step';
  view.innerHTML = `
  <div class="eg">
    <section class="card eg-card">
      ${label ? `<div class="sub" style="margin-bottom:6px">${esc(label)}</div>` : ''}
      <div class="meta">
        <span class="tag">#${c.n}</span><span class="tag">${esc(c.sector)}</span><span class="tag warn">${SESSION[c.session] || c.session}</span>
        <span class="tag">${esc(c.market)}</span><span class="sub" style="align-self:center">釋出 ${esc(c.releasedOn)}</span>
      </div>
      <div class="call-chart" id="callChart"></div>
      <div class="sub chart-note" id="chartNote"></div>
      <p class="summary">${esc(c.summary)}</p>
      <div class="hl-head"><h3>重點</h3><span class="sub" id="hlProg"></span><div class="hl-dots" id="hlDots"></div></div>
      <div class="hl-list" id="hlList"></div>
      <div id="hlAfter"></div>
      ${priorHTML(c, st, mode === 'step' ? null : truth)}
    </section>
    <aside class="answer" id="answerPane"></aside>
  </div>`;
  bindPrior();
  const allDone = () => mode !== 'step' || q.shown >= N;

  const drawHL = () => {
    $('#hlList').innerHTML = c.highlights.slice(0, q.shown).map((h, i) => {
      const t = truth.sentiments?.[i];
      const cur = mode === 'step' && i === q.shown - 1;
      if (mode === 'hint') return `<div class="hl ${t}"><span class="dot"></span><span>${esc(h.text)}</span><span class="tag ${SENT[t][1]} sent">${SENT[t][0]}</span></div>`;
      if (mode === 'reveal') return `<div class="hl ${t}"><span class="dot"></span><span>${esc(h.text)}</span><span class="tag ${SENT[t][1]} sent">${SENT[t][0]}</span></div>`;
      return `<div class="hl-q${cur ? ' current' : ''}"><div class="hl-q-text"><span class="hl-no">${i + 1}</span>${esc(h.text)}</div></div>`;
    }).join('') + (mode === 'step' && q.shown < N ? `<button class="btn btn-primary hl-next" id="hlNext">下一張 →<span class="sub" style="color:inherit;opacity:.8">（還有 ${N - q.shown} 張）</span></button>` : '');
    $('#hlProg').textContent = mode === 'step' ? `第 ${Math.min(q.shown, N)} / ${N} 張` : mode === 'hint' ? '提示模式：直接顯示情緒' : '情緒標籤已揭曉';
    $('#hlDots').innerHTML = c.highlights.map((_, i) => `<i class="${i < q.shown ? 'seen done' : ''}"></i>`).join('');
    const done = q.shown >= N;
    $('#hlAfter').innerHTML = done && c.watch?.length ? `<h3>待觀察</h3><ul class="watch">${c.watch.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    $('#hlNext') && ($('#hlNext').onclick = () => {
      q.shown++; drawHL(); syncForm();
      $('.hl-q.current')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };
  const syncForm = () => {
    const lock = $('#formLock');
    if (!lock) return;
    const done = allDone();
    lock.hidden = done;
    $('#answerForm').classList.toggle('locked', !done);
    lock.textContent = `先看完 ${N} 張重點（${Math.min(q.shown, N)}/${N}），再來猜股價反應`;
  };
  drawHL();
  drawCallChart($('#callChart'), c, prev ? truth : null, $('#chartNote'), SESSION);
  if (prev) renderReveal(c, prev, truth);
  else { renderForm(c, st, allDone); syncForm(); }
}

function priorHTML(c, st, truth) {
  if (!c.prior?.length) return '';
  const tabs = c.prior.map((p, i) => `<button class="${i ? '' : 'on'}" data-pi="${i}">${esc(p.label)}</button>`).join('');
  const body = (p, i) => {
    const r = p.reaction;
    const ex = r?.excess?.[st.bench]?.[st.window];
    const ps = truth?.priorSentiments?.[i];
    return `<div class="prior-body" data-pb="${i}" ${i ? 'hidden' : ''}>
      ${r ? `<div class="prior-react"><span>當時反應（${SESSION[r.session] || ''}）</span>
        <span>個股 1 日 <b class="${sign(r.r1)}">${pct(r.r1)}</b></span>
        <span>${WIN[st.window]}${BENCH[st.bench].replace('相對', '超額 vs ')} <b class="${sign(ex)}">${pct(ex)}</b></span></div>` : '<p class="sub">（沒有當時的股價反應資料）</p>'}
      <p class="prior-sum">${esc(p.summary)}</p>
      <div class="hl-list">${p.highlights.map((h, k) => { const s = ps?.[k]; return `<div class="hl ${s || ''}"><span class="dot"></span><span>${esc(h.text)}</span>${s ? `<span class="tag ${SENT[s][1]} sent">${SENT[s][0]}</span>` : ''}</div>`; }).join('')}</div>
      ${p.watch?.length ? `<p class="sub" style="margin-top:8px">當時待觀察：${p.watch.map(esc).join('；')}</p>` : ''}
    </div>`;
  };
  return `<details class="prior"><summary>前幾季參考 <span class="sub">同一家公司，已去識別化；季別是相對本季</span></summary>
    <div class="seg prior-tabs">${tabs}</div>${c.prior.map(body).join('')}</details>`;
}
function bindPrior() {
  $$('.prior-tabs button').forEach(b => b.onclick = () => {
    $$('.prior-tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.prior-body').forEach(x => { x.hidden = x.dataset.pb !== b.dataset.pi; });
  });
}

function renderForm(c, st, allDone) {
  const pane = $('#answerPane');
  const g = { dir: null, bin: null, conf: 65, pick: null };
  pane.innerHTML = `
  <section class="card">
    <h2>你的判斷 <span class="sub">${WIN[st.window]} · ${BENCH[st.bench]}${st.hint ? ' · 提示模式（不計正式統計）' : ''}</span></h2>
    <div class="form-lock" id="formLock" hidden></div>
    <div id="answerForm">
    <div class="field"><span class="lbl">1. 方向（超額報酬）</span>
      <div class="seg" id="fDir"><button data-v="out" class="out">跑贏 ▲</button><button data-v="under" class="under">跑輸 ▼</button></div></div>
    <div class="field"><span class="lbl">2. 幅度區間 <span class="sub">需與方向一致，或選持平</span></span>
      <div class="seg bins" id="fBin">${BIN_NAMES.map((n, i) => `<button data-v="${i}" disabled>${n}<small>${BIN_RANGE[i]}</small></button>`).join('')}</div></div>
    <div class="field"><span class="lbl">3. 信心：方向猜對的機率</span>
      <div class="conf"><input type="range" min="50" max="100" step="5" value="65" id="fConf"><b id="fConfV">65%</b></div>
      <span class="sub">高信心猜錯會被 Brier 扣分；|超額| &lt; ${DEADBAND * 100}% 時方向與信心不計分。</span></div>
    <div class="field"><span class="lbl">4. 猜公司（選填，+5）</span>
      <div class="choices" id="fPick">${c.choices.map(t => `<button data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
    <button class="btn btn-primary btn-lg" id="fGo" style="width:100%" disabled>送出並揭曉</button>
    <p class="sub" style="margin-top:8px">同一張卡在這個瀏覽器只能作答一次。</p>
    </div>
  </section>`;
  const sync = () => {
    $$('#fDir button').forEach(b => b.classList.toggle('on', b.dataset.v === g.dir));
    const ok = binsFor(g.dir);
    $$('#fBin button').forEach(b => { const i = +b.dataset.v; b.disabled = !g.dir || !ok.includes(i); b.classList.toggle('on', i === g.bin); });
    $$('#fPick button').forEach(b => b.classList.toggle('on', b.dataset.v === g.pick));
    $('#fGo').disabled = !(g.dir && g.bin != null);
  };
  $('#fDir').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; g.dir = b.dataset.v; if (g.bin != null && !binsFor(g.dir).includes(g.bin)) g.bin = null; sync(); };
  $('#fBin').onclick = e => { const b = e.target.closest('[data-v]'); if (!b || b.disabled) return; g.bin = +b.dataset.v; sync(); };
  $('#fPick').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; g.pick = g.pick === b.dataset.v ? null : b.dataset.v; sync(); };
  $('#fConf').oninput = e => { g.conf = +e.target.value; $('#fConfV').textContent = `${g.conf}%`; };
  $('#fGo').onclick = () => {
    if (answers()[c.id]) return toast('這張卡已經作答過了');
    if (!allDone()) return toast('先看完每一張重點');
    const ans = deobfuscate(c.answer);
    const setting = { window: st.window, bench: st.bench };
    const result = score(g, ans, setting);
    const rec = { id: c.id, n: c.n, releasedOn: c.releasedOn, sector: c.sector, ticker: ans.ticker, guess: { ...g }, setting, hinted: !!st.hint, result, netSentiment: ans.netSentiment, ts: Date.now() };
    const all = answers(); all[c.id] = rec; store(LS.ans, all);
    renderCard(c.id);
  };
  sync();
}

function renderReveal(c, rec, ans) {
  const r = rec.result, s = rec.setting;
  const ex = ans.excess;
  const mark = ok => (ok == null ? '<span class="muted">不計</span>' : ok ? '<span class="pos mark">○</span>' : '<span class="neg mark">×</span>');
  $('#answerPane').innerHTML = `
  <section class="card">
    <div class="reveal-head"><span class="sym">${esc(ans.ticker)}</span><span style="font-weight:600">${esc(ans.company)}</span></div>
    <p class="sub" style="margin:4px 0 12px">${esc(ans.year)} ${esc(ans.quarter)} 法說會 · ${esc(ans.date)} ${SESSION[ans.session]} · 反應日 t0 = ${esc(ans.t0)} · 基準 ${esc(ans.benchmark.sector)} / ${esc(ans.benchmark.market)}</p>
    ${c.chart ? '' : `<svg class="mini" id="mini" viewBox="0 0 400 170" preserveAspectRatio="none"></svg>`}
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th></th><th>跳空</th><th>1 日</th><th>5 日</th><th>20 日</th></tr></thead>
      <tbody>
        <tr><td>個股</td><td class="${sign(ans.returns.gap)}">${pct(ans.returns.gap)}</td><td class="${sign(ans.returns.r1)}">${pct(ans.returns.r1)}</td><td class="${sign(ans.returns.r5)}">${pct(ans.returns.r5)}</td><td class="${sign(ans.returns.r20)}">${pct(ans.returns.r20)}</td></tr>
        <tr><td>超額（產業）</td><td>—</td><td class="${sign(ex.sector.r1)}">${pct(ex.sector.r1)}</td><td class="${sign(ex.sector.r5)}">${pct(ex.sector.r5)}</td><td class="${sign(ex.sector.r20)}">${pct(ex.sector.r20)}</td></tr>
        <tr><td>超額（大盤）</td><td>—</td><td class="${sign(ex.market.r1)}">${pct(ex.market.r1)}</td><td class="${sign(ex.market.r5)}">${pct(ex.market.r5)}</td><td class="${sign(ex.market.r20)}">${pct(ex.market.r20)}</td></tr>
      </tbody></table></div>
    <h3>本題得分 <span class="sub">${WIN[s.window]} · ${BENCH[s.bench]}：超額 ${pct(r.e)}（${BIN_NAMES[r.actualBin]}）${rec.hinted ? ' · 提示模式' : ''}</span></h3>
    <div class="score-lines">
      <div><span>方向：你猜${rec.guess.dir === 'out' ? '跑贏' : '跑輸'} ${mark(r.dirOk)}</span><b>+${r.parts.dir}</b></div>
      <div><span>區間：你猜${BIN_NAMES[rec.guess.bin]} ${r.binOk ? '<span class="pos mark">○</span>' : r.binNear ? '<span class="mark" style="color:var(--warn)">△</span>' : '<span class="neg mark">×</span>'}</span><b>+${r.parts.bin}</b></div>
      <div><span>公司：${rec.guess.pick ? esc(rec.guess.pick) : '未作答'} ${rec.guess.pick ? mark(r.pickOk) : ''}</span><b>+${r.parts.pick}</b></div>
      <div><span>信心 ${rec.guess.conf}%：Brier ${r.brier == null ? '不計' : r.brier.toFixed(3)}</span><b class="${r.parts.calib < 0 ? 'neg' : ''}">${r.parts.calib >= 0 ? '+' : ''}${r.parts.calib.toFixed(1)}</b></div>
      <div style="border-top:1px solid var(--line);padding-top:6px"><span>合計</span><span class="score-total">${r.total}</span></div>
    </div>
    <h3>原卡情緒</h3>
    <p class="sub">net sentiment = <b>${ans.netSentiment > 0 ? '+' : ''}${ans.netSentiment}</b>（模型猜${ans.netSentiment > 0 ? '跑贏' : '跑輸'}${(ans.netSentiment > 0) === (r.e > 0) ? ' ○' : ' ×'}）；每句的標籤已顯示在左邊。</p>
    <div class="choices" style="margin-top:12px">${c.choices.map(t => `<button disabled class="${t === ans.ticker ? 'right' : t === rec.guess.pick ? 'wrong' : ''}">${esc(t)}</button>`).join('')}</div>
    <div class="ctrl" style="margin-top:14px">
      <a class="btn btn-primary" href="#/play" id="bNext">下一題 →</a>
      <button class="btn" id="bShare">複製分享文字</button>
      <a class="btn" href="#/bank">題庫</a>
    </div>
  </section>`;
  if ($('#mini')) drawMini($('#mini'), ans.path, ans.benchPath);
  $('#bShare').onclick = async () => {
    const t = shareText(c.n, r);
    try { await navigator.clipboard.writeText(t); toast('已複製：' + t); } catch { prompt('複製這段文字', t); }
  };
}

function drawMini(svg, a, b) {
  const all = [...a, ...b].filter(Number.isFinite);
  const lo = Math.min(...all), hi = Math.max(...all), W = 400, H = 170, pad = 10;
  const x = i => pad + i / (a.length - 1) * (W - 2 * pad), y = v => H - pad - (v - lo) / (hi - lo || 1) * (H - 2 * pad);
  const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const t0 = x(5);
  svg.innerHTML = `
    <rect x="${t0}" y="0" width="${x(6) - t0}" height="${H}" fill="rgba(217,119,6,.12)"/>
    <line x1="${pad}" x2="${W - pad}" y1="${y(100)}" y2="${y(100)}" stroke="rgba(120,80,30,.25)" stroke-dasharray="3 3"/>
    <path d="${path(b)}" fill="none" stroke="#2563EB" stroke-width="1.6" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>
    <path d="${path(a)}" fill="none" stroke="#8B5E3C" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    <text x="${t0 + 3}" y="14" font-size="11" fill="#92400e">t0</text>`;
}

async function renderBank() {
  const idx = await loadIndex();
  const A = answers();
  const sectors = [...new Set(idx.map(c => c.sector))].sort();
  view.innerHTML = `
  <section class="card" style="margin-bottom:var(--gutter)">
    <h2>題庫 <span class="sub">${idx.length} 張已釋出；未作答的都可以補玩</span></h2>
    <div class="filters">
      <select class="input" id="bSec"><option value="">全部產業</option>${sectors.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select class="input" id="bAns"><option value="">全部</option><option value="todo">未作答</option><option value="done">已作答</option></select>
    </div>
  </section>
  <div class="bank-grid" id="bGrid"></div>
  <button class="btn" id="bMore" style="width:100%;margin-top:var(--gutter)" hidden></button>`;
  // 題庫只讀 index.json（每張卡附 90 字 teaser），一次畫 PAGE 張，不用逐張下載卡片
  const PAGE = 60;
  let shown = PAGE;
  const draw = async () => {
    const sec = $('#bSec').value, an = $('#bAns').value;
    const list = idx.filter(c => (!sec || c.sector === sec) && (!an || (an === 'done') === !!A[c.id]));
    const page = list.slice(0, shown);
    // 舊版 index 沒有 teaser 的卡才去抓卡片本身
    await Promise.all(page.filter(c => c.teaser == null).map(async c => { c.teaser = (await loadCard(c.id).catch(() => null))?.summary?.slice(0, 90) || ''; }));
    $('#bGrid').innerHTML = page.map(c => {
      const a = A[c.id];
      return `<a class="bank-item" href="#/card/${c.id}">
        <div class="row"><span class="tag">#${c.n}</span><span class="tag">${esc(c.sector)}</span><span class="tag warn">${SESSION[c.session]}</span><span class="sub" style="margin-left:auto">${esc(c.releasedOn)}</span></div>
        <div class="t">${esc(c.teaser)}…</div>
        <div class="row">${a ? `<span class="tag pos">已作答 · ${a.result.total} 分</span><span class="sub mono">${esc(a.ticker)}</span>` : '<span class="tag warn">未作答</span>'}</div></a>`;
    }).join('') || '<p class="empty">沒有符合的卡片。</p>';
    $('#bMore').hidden = list.length <= shown;
    $('#bMore').textContent = `再顯示 ${Math.min(PAGE, list.length - shown)} 張（共 ${list.length}）`;
  };
  $('#bMore').onclick = () => { shown += PAGE; draw(); };
  $('#bSec').onchange = $('#bAns').onchange = () => { shown = PAGE; draw(); };
  draw();
}

async function renderStats() {
  const recs = Object.values(answers()).sort((a, b) => a.ts - b.ts);
  const S = stats(recs);
  const f = x => (Number.isFinite(x) ? x.toFixed(3) : '—');
  view.innerHTML = `
  <div class="stats-grid">
    <section class="card"><h2>方向命中率</h2><div class="big">${pct0(S.dirHit)}</div><p class="sub">${S.scored} 題計分（排除 |超額| &lt; 0.5% 與提示模式）</p></section>
    <section class="card"><h2>區間命中率</h2><div class="big">${pct0(S.binHit)}</div><p class="sub">公司命中 ${pct0(S.pickHit)}</p></section>
    <section class="card"><h2>平均 Brier</h2><div class="big">${f(S.brier)}</div><p class="sub">越小越好；永遠填 50% = 0.250</p></section>
    <section class="card"><h2>累計得分</h2><div class="big">${Math.round(S.total)}</div><p class="sub">${S.formal} 題正式作答，${S.n - S.formal} 題提示模式</p></section>
    <section class="card"><h2>連續作答</h2><div class="big">${S.streak} 天</div></section>
    <section class="card"><h2>匯出</h2><div class="ctrl"><button class="btn btn-sm" id="xJson">JSON</button><button class="btn btn-sm" id="xCsv">CSV</button><label class="btn btn-sm">匯入 JSON<input type="file" id="xImp" accept="application/json" hidden></label></div><p class="sub" style="margin-top:8px">匯出後可在其他裝置匯入還原統計，或拿去做因子研究。</p></section>
    <section class="card w6"><h2>校準曲線 <span class="sub">信心分箱 vs 實際命中</span></h2><svg class="calib" id="calib" viewBox="0 0 400 260"></svg></section>
    <section class="card w6"><h2>你 vs 模型 <span class="sub">同一批 ${S.vsModel.n} 題（非提示、方向計分）</span></h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>判斷方式</th><th>方向命中率</th></tr></thead><tbody>
        <tr><td>你</td><td>${pct0(S.vsModel.you)}</td></tr>
        <tr><td>net sentiment &gt; 0 即跑贏</td><td>${pct0(S.vsModel.model)}</td></tr>
        <tr><td>永遠猜跑贏</td><td>${pct0(S.vsModel.always)}</td></tr>
      </tbody></table></div>
      <p class="sub" style="margin-top:8px">這也是法說會情緒分數的小型樣本外檢驗。</p>
      <h3>依產業</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>產業</th><th>題數</th><th>命中率</th></tr></thead><tbody>
        ${Object.entries(S.bySector).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${pct0(v.hit / v.n)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">尚無資料</td></tr>'}
      </tbody></table></div>
    </section>
  </div>`;
  drawCalib($('#calib'), S.calib);
  $('#xJson').onclick = () => download('earnings-guess-answers.json', JSON.stringify(answers(), null, 1));
  $('#xCsv').onclick = () => download('earnings-guess-answers.csv', toCSV(recs), 'text/csv');
  $('#xImp').onchange = async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      const cur = answers(); let n = 0;
      for (const [k, v] of Object.entries(data)) if (!cur[k] && v?.result) { cur[k] = v; n++; }
      store(LS.ans, cur); toast(`匯入 ${n} 筆`); renderStats();
    } catch (err) { toast(`匯入失敗：${err.message}`); }
  };
}

function drawCalib(svg, bins) {
  const W = 400, H = 260, L = 40, B = 30, T = 10, R = 10;
  const x = p => L + (p - 0.5) / 0.5 * (W - L - R), y = p => H - B - p * (H - B - T);
  let s = `<line x1="${x(0.5)}" y1="${y(0.5)}" x2="${x(1)}" y2="${y(1)}" stroke="rgba(120,80,30,.35)" stroke-dasharray="4 4"/>`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(120,80,30,.08)"/><text x="${L - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#9B7E68">${v * 100}%</text>`;
  for (const v of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) s += `<text x="${x(v)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="#9B7E68">${v * 100}%</text>`;
  const pts = bins.filter(b => b.n);
  if (pts.length > 1) s += `<path d="${pts.map((b, i) => `${i ? 'L' : 'M'}${x(b.conf)},${y(b.hit)}`).join('')}" fill="none" stroke="#8B5E3C" stroke-width="2"/>`;
  for (const b of pts) s += `<circle cx="${x(b.conf)}" cy="${y(b.hit)}" r="${3 + Math.min(8, b.n)}" fill="rgba(139,94,60,.25)" stroke="#8B5E3C"/><text x="${x(b.conf)}" y="${y(b.hit) - 12}" font-size="10" text-anchor="middle" fill="#6B4C35">n=${b.n}</text>`;
  if (!pts.length) s += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#9B7E68">作答幾題之後才會出現</text>`;
  s += `<text x="${(L + W) / 2}" y="${H}" font-size="10" text-anchor="middle" fill="#6B4C35"></text>`;
  svg.innerHTML = s;
}

function renderSettings() {
  const st = settings();
  view.innerHTML = `
  <section class="card" style="max-width:none">
    <h2>設定</h2>
    <div class="field"><span class="lbl">猜測視窗</span><div class="chips" data-k="window">${Object.entries(WIN).map(([k, v]) => `<button class="chip${st.window === k ? ' on' : ''}" data-v="${k}">${v}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">基準</span><div class="chips" data-k="bench">${Object.entries(BENCH).map(([k, v]) => `<button class="chip${st.bench === k ? ' on' : ''}" data-v="${k}">${v}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">提示模式</span><div class="chips" data-k="hint"><button class="chip${!st.hint ? ' on' : ''}" data-v="0">關（隱藏情緒標籤）</button><button class="chip${st.hint ? ' on' : ''}" data-v="1">開（顯示情緒標籤，作答標記 hinted，不計正式統計）</button></div></div>
    <p class="sub">設定在作答當下記錄進該題，之後改設定不會改到舊的得分。匯出 / 匯入作答紀錄在「統計」頁。</p>
  </section>`;
  $$('[data-k]').forEach(g => g.onclick = e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    $$('[data-v]', g).forEach(x => x.classList.toggle('on', x === b));
    const k = g.dataset.k;
    store(LS.set, { ...settings(), [k]: k === 'hint' ? b.dataset.v === '1' : b.dataset.v });
  });
}

// ── demo cards (fictional) ──
function demoCards() {
  const mk = (id, n, sector, session, summary, hl, watch, choices, ans) => ({
    id, n, releasedOn: todayTW(), market: 'US', sector, session, summary, highlights: hl.map(h => ({ text: h.text })), watch, choices,
    prior: (DEMO_PRIOR[id] || []).map(p => ({ ...p, highlights: p.highlights.map(h => ({ text: h.text })) })),
    chart: { pre: demoChart(n) },
    answer: obfuscate({ ...ans, session, year: 2026, quarter: 'Q3', benchmark: { sector: ans.etf, market: 'SPY' },
      chartPost: demoPost(ans.returns.r1, ans.returns.r20, n), benchChart: [...demoChart(n + 10).c, ...demoPost(ans.returns.r1 - ans.excess.sector.r1, ans.returns.r20 - ans.excess.sector.r20, n + 10).c],
      sentiments: hl.map(h => h.sentiment), priorSentiments: (DEMO_PRIOR[id] || []).map(p => p.highlights.map(h => h.sentiment)) }),
  });
  const demoChart = seed => {
    let x = 100 * (1 + (seed % 7) / 100), r = seed * 9301 + 49297;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const o = [], h = [], l = [], c = [], v = [];
    for (let i = 0; i < 40; i++) { const op = x * (1 + (rnd() - .5) * .01), cl = op * (1 + (rnd() - .48) * .03); o.push(+op.toFixed(2)); c.push(+cl.toFixed(2)); h.push(+(Math.max(op, cl) * (1 + rnd() * .01)).toFixed(2)); l.push(+(Math.min(op, cl) * (1 - rnd() * .01)).toFixed(2)); v.push(Math.round(70 + rnd() * 70)); x = cl; }
    const k = 100 / c[39]; return { o: o.map(y => +(y * k).toFixed(2)), h: h.map(y => +(y * k).toFixed(2)), l: l.map(y => +(y * k).toFixed(2)), c: c.map(y => +(y * k).toFixed(2)), v };
  };
  const demoPost = (r1, r20, seed) => {
    let r = seed * 7 + 3; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const o = [], h = [], l = [], c = [], v = []; let x = 100 * (1 + r1);
    for (let i = 0; i < 20; i++) { const tgt = 100 * (1 + r1 + (r20 - r1) * i / 19); const op = i ? x : 100 * (1 + r1 * 0.7); const cl = i ? tgt * (1 + (rnd() - .5) * .015) : x; o.push(+op.toFixed(2)); c.push(+cl.toFixed(2)); h.push(+(Math.max(op, cl) * (1 + rnd() * .012)).toFixed(2)); l.push(+(Math.min(op, cl) * (1 - rnd() * .012)).toFixed(2)); v.push(Math.round((i ? 90 : 320) + rnd() * 60)); x = cl; }
    return { o, h, l, c, v };
  };
  const path = (k, j) => Array.from({ length: 26 }, (_, i) => +(100 * (i < 5 ? 1 - (5 - i) * 0.002 : (1 + k) * (1 + j * (i - 5) / 20))).toFixed(2));
  return [
    mk('demo-1', 1, 'Semicap', 'AMC', '本公司本季營收優於 guidance 上緣，先進封裝相關設備訂單創新高；管理層上調下一季指引，但提到某地區客戶需求轉弱。',
      [{ text: '先進封裝設備訂單季增超過 40%', sentiment: 'bullish' }, { text: '某地區營收占比自 35% 降至 27%', sentiment: 'bearish' }, { text: '下一季營收指引中值高於市場預期約 4%', sentiment: 'bullish' }, { text: '毛利率持平，產品組合影響', sentiment: 'neutral' }],
      ['下一年度 WFE 成長幅度', '先進封裝產能擴張時程'], ['DEMOA', 'DEMOB', 'DEMOC', 'DEMOD'],
      { ticker: 'DEMOB', company: '示範設備公司', date: '2026-10-22', t0: '2026-10-23', etf: 'SOXX', returns: { gap: 0.052, r1: 0.071, r5: 0.064, r20: 0.09 }, excess: { sector: { r1: 0.048, r5: 0.031, r20: 0.04 }, market: { r1: 0.062, r5: 0.05, r20: 0.07 } }, path: path(0.07, 0.03), benchPath: path(0.02, 0.01), netSentiment: 1 }),
    mk('demo-2', 2, 'Software', 'AMC', '本公司本季 ARR 成長放緩至 18%，淨留存率下滑；管理層維持全年指引，強調 AI 產品線早期採用良好。',
      [{ text: 'ARR 年增 18%，低於上一季的 22%', sentiment: 'bearish' }, { text: 'NRR 由 115% 降至 110%', sentiment: 'bearish' }, { text: 'AI 附加模組已有 1,200 家客戶試用', sentiment: 'bullish' }, { text: '維持本年度營收指引', sentiment: 'neutral' }],
      ['AI 模組轉付費比例'], ['DEMOE', 'DEMOF', 'DEMOG', 'DEMOH'],
      { ticker: 'DEMOG', company: '示範軟體公司', date: '2026-11-04', t0: '2026-11-05', etf: 'IGV', returns: { gap: -0.12, r1: -0.15, r5: -0.13, r20: -0.08 }, excess: { sector: { r1: -0.142, r5: -0.11, r20: -0.07 }, market: { r1: -0.155, r5: -0.13, r20: -0.09 } }, path: path(-0.15, 0.06), benchPath: path(0.005, 0.01), netSentiment: -1 }),
    mk('demo-3', 3, 'Power', 'BMO', '本公司本季資料中心相關電力設備營收倍增，但交期延長使營收認列遞延；在手訂單創新高。',
      [{ text: '資料中心相關營收年增 105%', sentiment: 'bullish' }, { text: '部分變壓器交期延長至 3 年', sentiment: 'neutral' }, { text: '本季營收略低於市場預期', sentiment: 'bearish' }, { text: '在手訂單金額年增 60%', sentiment: 'bullish' }],
      ['產能擴充進度', '下一季認列節奏'], ['DEMOI', 'DEMOJ', 'DEMOK', 'DEMOL'],
      { ticker: 'DEMOI', company: '示範電力公司', date: '2026-10-29', t0: '2026-10-29', etf: 'XLI', returns: { gap: -0.01, r1: 0.008, r5: 0.02, r20: 0.05 }, excess: { sector: { r1: 0.003, r5: 0.012, r20: 0.03 }, market: { r1: 0.004, r5: 0.015, r20: 0.035 } }, path: path(0.008, 0.04), benchPath: path(0.005, 0.02), netSentiment: 1 }),
  ];
}
const DEMO_PRIOR = {
  'demo-1': [
    { label: '上一季', summary: '本公司上一季營收符合預期，管理層表示先進封裝客戶開始拉貨，但成熟製程需求仍疲弱。', netSentiment: 0,
      highlights: [{ text: '先進封裝相關訂單季增 15%', sentiment: 'bullish' }, { text: '成熟製程客戶延後設備交期', sentiment: 'bearish' }],
      watch: ['先進封裝訂單能否延續'], reaction: { session: 'AMC', gap: 0.01, r1: 0.018, r5: 0.02, excess: { sector: { r1: 0.006, r5: 0.004, r20: 0.01 }, market: { r1: 0.012, r5: 0.01, r20: 0.02 } } } },
    { label: '兩季前', summary: '本公司兩季前下修全年展望，主因某地區出口限制。', netSentiment: -1,
      highlights: [{ text: '某地區營收占比自 45% 降至 38%', sentiment: 'bearish' }], watch: [],
      reaction: { session: 'AMC', gap: -0.06, r1: -0.071, r5: -0.05, excess: { sector: { r1: -0.052, r5: -0.03, r20: -0.01 }, market: { r1: -0.065, r5: -0.04, r20: -0.02 } } } },
  ],
  'demo-2': [
    { label: '上一季', summary: '本公司上一季 ARR 年增 22%，AI 模組進入封測。', netSentiment: 1,
      highlights: [{ text: 'ARR 年增 22%', sentiment: 'bullish' }, { text: '銷售週期拉長', sentiment: 'bearish' }], watch: ['AI 模組上市時程'],
      reaction: { session: 'AMC', gap: 0.03, r1: 0.04, r5: 0.05, excess: { sector: { r1: 0.032, r5: 0.04, r20: 0.03 }, market: { r1: 0.035, r5: 0.045, r20: 0.04 } } } },
  ],
};
function demoIndex() { return demoCards().map(c => ({ id: c.id, n: c.n, releasedOn: c.releasedOn, sector: c.sector, session: c.session, teaser: c.summary.slice(0, 90) })); }

route();
