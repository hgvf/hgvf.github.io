// main.js — hash router + setup page.
import { $, $$, esc, toast, MARKET_NAME } from './ui.js';
import { loadBank, pickPuzzle, getPuzzle } from './bank.js';
import { getSettings, setSettings, saveSession, allSessions, deleteSession, uid } from './store.js';
import { allStrategies, strategyById } from './strategies.js';
import { prepareForPuzzle, scanSignals, deepClone } from '../engine/index.js';
import { renderPlay, stopPlay } from './play.js';
import { renderReport } from './report.js';
import { renderHistory } from './history.js';
import { renderEditor } from './editor.js';
import { qm, initTips } from './glossary.js';

const view = $('#view');

async function route() {
  stopPlay();
  const [, name = 'setup', arg] = (location.hash || '#/setup').split('/');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name || (name === 'report' && a.dataset.route === 'history')));
  view.innerHTML = '';
  view.className = 'view';
  try {
    await bannerForBank();
    if (name === 'play') {
      let id = arg;
      if (!id) { const s = (await allSessions()).find(x => x.status === 'playing'); id = s?.id; }
      if (!id) { location.hash = '#/setup'; return; }
      await renderPlay(view, id);
    } else if (name === 'report') await renderReport(view, arg);
    else if (name === 'history') await renderHistory(view);
    else if (name === 'editor') await renderEditor(view, arg);
    else await renderSetup(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card empty">出錯了：${esc(e.message)}<br><a class="btn btn-sm" href="#/setup" style="margin-top:12px">回到開始</a></div>`;
  }
}
window.addEventListener('hashchange', route);

async function bannerForBank() {
  const b = await loadBank();
  const el = $('#banner');
  if (b.demo) {
    el.hidden = false;
    el.innerHTML = '題庫尚未發佈：目前使用 <b>合成示範題</b>（隨機漫步產生，非真實行情）。真實題庫發佈到 <code>blind-chart-puzzles</code> 分支後會自動切換。';
  } else el.hidden = true;
  return b;
}

async function renderSetup(root) {
  const bank = await loadBank();
  const st = getSettings();
  const strategies = allStrategies();
  const sessions = await allSessions();
  const playing = sessions.filter(s => s.status === 'playing');
  const counts = {};
  for (const p of bank.index) counts[p.market] = (counts[p.market] || 0) + 1;
  counts.MIX = bank.index.length;
  root.innerHTML = `
  <div class="setup-grid">
    <section class="card">
      <h2>開始新的 Session <span class="sub">題目隱藏代號與日期，價格已縮放</span></h2>
      <div class="field"><span class="lbl">市場 ${qm('mixed')}</span><div class="chips" data-k="market">
        ${['TW', 'US', 'JP', 'KR', 'MIX'].map(m => `<button class="chip${st.market === m ? ' on' : ''}" data-v="${m}">${MARKET_NAME[m]} <span class="sub">${counts[m] || 0}</span></button>`).join('')}
      </div></div>
      <div class="field"><span class="lbl">策略 <a class="sub" href="#/editor" style="margin-left:6px;text-decoration:underline">編輯 / 新增</a></span>
        <div class="preset-list" data-k="presetId">
          ${strategies.map(s => `<button class="preset${st.presetId === s.id ? ' on' : ''}" data-v="${esc(s.id)}"><b>${esc(s.name || s.id)}</b><span>${esc(s.entry?.signal || '')}</span>${s.builtin ? '' : '<span class="tag">自訂</span>'}</button>`).join('')}
        </div></div>
      <div class="field"><span class="lbl">可操作 K 棒數</span><div class="chips" data-k="playBars">
        ${[120, 250, 500].map(n => `<button class="chip${st.playBars === n ? ' on' : ''}" data-v="${n}">${n} 根</button>`).join('')}
      </div></div>
      <div class="field"><span class="lbl">提示強度 ${qm('hint')}</span><div class="chips" data-k="hint">
        ${[['full', '線 + 提示列'], ['lines', '只有線'], ['none', '什麼都不畫']].map(([v, n]) => `<button class="chip${st.hint === v ? ' on' : ''}" data-v="${v}">${n}</button>`).join('')}
      </div></div>
      <div class="field"><span class="lbl">模式 ${qm('campaign')}</span><div class="chips" data-k="mode">
        <button class="chip${st.mode === 'single' ? ' on' : ''}" data-v="single">單題</button>
        <button class="chip${st.mode === 'campaign' ? ' on' : ''}" data-v="campaign">連關</button>
        <select class="input" id="campN" style="width:auto">${[5, 10, 20].map(n => `<option value="${n}" ${st.campaignN === n ? 'selected' : ''}>${n} 題</option>`).join('')}</select>
        <span class="sub" style="align-self:center">連關：權益延續到下一題，最後出綜合報告</span>
      </div></div>
      <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="hideDisc" ${st.hideDiscipline ? 'checked' : ''}> <span>結束前隱藏即時違規計數</span></label>
      <div class="start-row">
        <button class="btn btn-primary btn-lg" id="btnStart">開始 ▶</button>
        <span class="sub">快捷鍵：<kbd>N</kbd> 下一根　<kbd>Space</kbd> 播放　<kbd>J</kbd> 下一事件　<kbd>B</kbd> 買　<kbd>A</kbd> 加碼　<kbd>S</kbd> 賣　<kbd>U</kbd> 撤銷本根</span>
      </div>
    </section>
    <aside style="display:grid;gap:var(--gutter)">
      <section class="card">
        <h2>繼續上次 <span class="sub">${playing.length} 個未完成</span></h2>
        <div class="resume">${playing.length ? playing.map(s => `
          <div class="resume-item"><div class="grow"><b>${esc(MARKET_NAME[s.mixed ? 'MIX' : s.market] || s.market)}</b> · ${esc(s.spec?.name || s.presetId)}<br><span class="sub">第 ${s.cursor - s.playStart + 1} / ${s.playBars} 根${s.campaign ? ` · 連關 ${s.campaign.index + 1}/${s.campaign.total}` : ''}</span></div>
            <a class="btn btn-sm btn-primary" href="#/play/${s.id}">繼續</a><button class="btn btn-sm" data-del="${s.id}">刪除</button></div>`).join('') : '<p class="sub">沒有未完成的 Session。</p>'}</div>
      </section>
      <section class="card">
        <h2>匯入 Session</h2>
        <p class="sub" style="margin-bottom:8px">匯入其他裝置匯出的 Session JSON（含策略 spec 與 action log），可重現同一份報告。</p>
        <input type="file" id="importFile" accept="application/json" class="input">
      </section>
      <section class="card">
        <h2>怎麼玩</h2>
        <div class="callout">
          逐根推進，系統依策略即時畫出停損（紅）、停利（綠）、均價（灰）、加碼觸發（藍）。<b>所有成交都要你親手按</b>：下單預設下一根開盤成交；
          盤中觸發停損 / 停利的那一根要按「確認停損 / 停利」才會以線價成交，晚一根就算違規。結束後揭曉代號，並和「完全照規則」的影子帳戶比較。
        </div>
      </section>
    </aside>
  </div>`;
  $$('[data-k]', root).forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    $$('[data-v]', g).forEach(x => x.classList.toggle('on', x === b));
    const k = g.dataset.k, v = b.dataset.v;
    setSettings({ [k]: k === 'playBars' ? +v : v });
  }));
  $('#campN', root).addEventListener('change', e => setSettings({ campaignN: +e.target.value }));
  $('#hideDisc', root).addEventListener('change', e => setSettings({ hideDiscipline: e.target.checked }));
  $$('[data-del]', root).forEach(b => b.addEventListener('click', async () => { await deleteSession(b.dataset.del); route(); }));
  $('#btnStart', root).addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const s = getSettings();
      const sess = await newSession(s, s.mode === 'campaign' ? { id: uid('c'), index: 0, total: s.campaignN, played: [], settings: s } : null);
      location.hash = `#/play/${sess.id}`;
    } catch (err) { console.error(err); toast(err.message); e.target.disabled = false; }
  });
  $('#importFile', root).addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const s = JSON.parse(await f.text());
      if (!s.puzzleId || !Array.isArray(s.actions) || !s.spec) throw new Error('不是 Session JSON');
      s.id = s.id || uid(); await saveSession(s);
      toast('已匯入'); location.hash = s.status === 'done' ? `#/report/${s.id}` : `#/play/${s.id}`;
    } catch (err) { toast(`匯入失敗：${err.message}`); }
  });
}

/** Create and save a session. campaign: { id, index, total, played[], settings } */
export async function newSession(settings, campaign = null, startEquity) {
  const bank = await loadBank();
  const spec = deepClone(strategyById(settings.presetId));
  delete spec.builtin;
  const mixed = settings.market === 'MIX';
  const played = new Set([...(campaign?.played || []), ...(await allSessions()).map(s => s.puzzleId)]);
  let puzzle = null, id = null;
  for (let tries = 0; tries < 8; tries++) {
    id = pickPuzzle(bank, { market: settings.market, presetId: spec.id, playBars: settings.playBars, played });
    if (!id) throw new Error('沒有可用的題目');
    puzzle = await getPuzzle(id);
    const known = puzzle.tags?.presets?.[spec.id];
    const nSig = known ? known.signalBars.length : scanSignals(prepareForPuzzle(puzzle, spec, { mixed })).length;
    if (nSig >= 3 || tries === 7) break;     // 隨機池：訊號數低於 minSignals 自動換下一題
    played.add(id);
  }
  const s = {
    id: uid(), createdAt: Date.now(), status: 'playing',
    puzzleId: id, market: puzzle.market, mixed, regime: puzzle.tags?.regime, synthetic: !!puzzle.synthetic,
    presetId: spec.id, spec, settings: { hint: settings.hint, hideDiscipline: !!settings.hideDiscipline, speed: settings.speed || 4 },
    playStart: puzzle.contextBars, playBars: puzzle.playBars, cursor: puzzle.contextBars,
    initialEquity: startEquity ?? spec.account?.initialEquity ?? 1000000,
    actions: [], campaign: campaign ? { ...campaign, played: [...(campaign.played || []), id] } : null,
  };
  await saveSession(s);
  return s;
}

initTips();
route();
