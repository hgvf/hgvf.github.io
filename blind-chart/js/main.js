// main.js — hash router + setup page.
import { $, $$, esc, toast, MARKET_NAME } from './ui.js';
import { loadBank, pickPuzzle, getPuzzle } from './bank.js';
import { getSettings, setSettings, saveSession, allSessions, deleteSession, uid } from './store.js';
import { shortName, rulesBlock, fmtMoney } from './describe.js';
import { allStrategies, strategyById } from './strategies.js';
import { prepareForPuzzle, scanSignals, deepClone, applyRiskLimit, CATEGORIES } from '../engine/index.js';
import { renderPlay, stopPlay } from './play.js';
import { renderReport } from './report.js';
import { renderHistory } from './history.js';
import { renderEditor } from './editor.js';
import { renderGuide } from './guide.js';
import { qm, initTips } from './glossary.js';
import { loadPresetStats } from './presetstats.js';

const view = $('#view');

async function route() {
  stopPlay();
  const [, name = 'setup', arg] = (location.hash || '#/setup').split('/');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name || (name === 'report' && a.dataset.route === 'history') || (name === 'guide' && a.dataset.route === 'editor')));
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
    else if (name === 'guide') await renderGuide(view);
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

const RISK_OPTS = [[0.005, '0.5%'], [0.01, '1%'], [0.02, '2%'], [0.03, '3%'], [0, '照策略']];

async function renderSetup(root) {
  const bank = await loadBank();
  const st = getSettings();
  const strategies = allStrategies();
  const pstats = await loadPresetStats();
  const sessions = await allSessions();
  const playing = sessions.filter(s => s.status === 'playing');
  const counts = {};
  for (const p of bank.index) counts[p.market] = (counts[p.market] || 0) + 1;
  counts.MIX = bank.index.length;
  const equity = 1000000;
  const groups = [...CATEGORIES.map(c => [c, strategies.filter(s => s.builtin && s.category === c)]),
    ['我的策略', strategies.filter(s => !s.builtin)]].filter(([, l]) => l.length);
  root.innerHTML = `
  <div class="setup-grid">
    <section class="card">
      <h2>開始</h2>
      <div class="field"><span class="lbl">市場 ${qm('mixed')}</span><div class="chips" data-k="market">
        ${['TW', 'US', 'JP', 'KR', 'MIX'].map(m => `<button class="chip${st.market === m ? ' on' : ''}" data-v="${m}">${MARKET_NAME[m]} <span class="sub">${counts[m] || 0}</span></button>`).join('')}
      </div></div>
      <div class="field"><span class="lbl">策略</span>
        <div class="pick-groups" data-k="presetId">
          ${groups.map(([g, l]) => `<div class="pick-row"><span class="pick-cat">${esc(g)}</span><div class="chips">
            ${l.map(s => `<button class="chip chip-s${st.presetId === s.id ? ' on' : ''}" data-v="${esc(s.id)}">${esc(shortName(s))}</button>`).join('')}</div></div>`).join('')}
        </div>
        <div class="pick-info" id="pickInfo"></div>
      </div>
      <div class="field"><span class="lbl">每筆最多賠（1R）${qm('R')}</span><div class="chips" data-k="risk">
        ${RISK_OPTS.map(([v, n]) => `<button class="chip${st.risk === v ? ' on' : ''}" data-v="${v}">${n}</button>`).join('')}
        <span class="sub risk-amt" id="riskAmt"></span>
      </div></div>
      <div class="field"><span class="lbl">K 棒數</span><div class="chips" data-k="playBars">
        ${[120, 250, 500].map(n => `<button class="chip${st.playBars === n ? ' on' : ''}" data-v="${n}">${n} 根</button>`).join('')}
      </div></div>
      <div class="field"><span class="lbl">提示 ${qm('hint')}</span><div class="chips" data-k="hint">
        ${[['full', '線 + 提示'], ['lines', '只有線'], ['none', '不提示']].map(([v, n]) => `<button class="chip${st.hint === v ? ' on' : ''}" data-v="${v}">${n}</button>`).join('')}
      </div></div>
      <div class="field"><span class="lbl">模式 ${qm('campaign')}</span><div class="chips" data-k="mode">
        <button class="chip${st.mode === 'single' ? ' on' : ''}" data-v="single">單題</button>
        <button class="chip${st.mode === 'campaign' ? ' on' : ''}" data-v="campaign">連關</button>
        <select class="input" id="campN" style="width:auto">${[5, 10, 20].map(n => `<option value="${n}" ${st.campaignN === n ? 'selected' : ''}>${n} 題</option>`).join('')}</select>
      </div></div>
      <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="hideDisc" ${st.hideDiscipline ? 'checked' : ''}> <span>結束前不顯示違規次數</span></label>
      <div class="start-row"><button class="btn btn-primary btn-lg" id="btnStart">開始 ▶</button></div>
    </section>
    <aside style="display:grid;gap:var(--gutter)">
      ${playing.length ? `<section class="card">
        <h2>繼續上次</h2>
        <div class="resume">${playing.map(s => `
          <div class="resume-item"><div class="grow"><b>${esc(MARKET_NAME[s.mixed ? 'MIX' : s.market] || s.market)}</b> · ${esc(shortName(s.spec) || s.presetId)}<br><span class="sub">第 ${s.cursor - s.playStart + 1} / ${s.playBars} 根${s.campaign ? ` · 連關 ${s.campaign.index + 1}/${s.campaign.total}` : ''}</span></div>
            <a class="btn btn-sm btn-primary" href="#/play/${s.id}">繼續</a><button class="btn btn-sm" data-del="${s.id}">刪除</button></div>`).join('')}</div>
      </section>` : ''}
      <section class="card">
        <h2>怎麼玩</h2>
        <ul class="howto">
          <li>K 線一根一根往後走，看不到股票代號和日期。</li>
          <li>照選好的策略操作，買、賣、加碼都要自己按。</li>
          <li>碰到停損或停利的那一根要按「確認」，拖到下一根算違規。</li>
          <li>結束後公布是哪檔股票，再跟完全照規則操作的結果比。</li>
        </ul>
        <p class="sub keys"><kbd>N</kbd> 下一根　<kbd>Space</kbd> 播放　<kbd>J</kbd> 下一個事件　<kbd>B</kbd> 買　<kbd>A</kbd> 加碼　<kbd>S</kbd> 賣　<kbd>U</kbd> 撤銷</p>
      </section>
    </aside>
  </div>`;
  const syncInfo = () => {
    const cur = getSettings();
    const s = strategies.find(x => x.id === cur.presetId) || strategies[0];
    const ps = pstats?.presets?.[s.builtin ? s.id : s.basedOn];
    $('#pickInfo', root).innerHTML = `
      <div class="pick-head"><b>${esc(shortName(s))}</b>${s.category ? `<span class="tag">${esc(s.category)}</span>` : ''}
        ${ps ? `<span class="sub">題庫 Sharpe ${ps.sharpe.toFixed(2)} · 勝率 ${Math.round(ps.winRate * 100)}% · 每題約 ${ps.tradesPerPuzzle.toFixed(1)} 筆</span>` : ''}
        <a class="pick-more" href="#/editor/${encodeURIComponent(s.id)}">完整規則 →</a></div>
      ${s.idea ? `<p class="pick-idea">${esc(s.idea)}</p>` : ''}
      ${rulesBlock(s, { risk: cur.risk, equity })}`;
    $('#riskAmt', root).textContent = cur.risk > 0 ? `= ${fmtMoney(equity * cur.risk)}（起始資金 ${fmtMoney(equity)}）` : '用策略自己的設定';
  };
  $$('[data-k]', root).forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    $$('[data-v]', g).forEach(x => x.classList.toggle('on', x === b));
    const k = g.dataset.k, v = b.dataset.v;
    setSettings({ [k]: k === 'playBars' || k === 'risk' ? +v : v });
    if (k === 'presetId' || k === 'risk') syncInfo();
  }));
  syncInfo();
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
  const initialEquity = startEquity ?? spec.account?.initialEquity ?? 1000000;
  const risk = settings.risk ?? 0.01;
  applyRiskLimit(spec, risk, initialEquity);
  const s = {
    id: uid(), createdAt: Date.now(), status: 'playing', risk,
    puzzleId: id, market: puzzle.market, mixed, regime: puzzle.tags?.regime, synthetic: !!puzzle.synthetic,
    presetId: spec.id, spec, settings: { hint: settings.hint, hideDiscipline: !!settings.hideDiscipline, speed: settings.speed || 4 },
    playStart: puzzle.contextBars, playBars: puzzle.playBars, cursor: puzzle.contextBars,
    initialEquity,
    actions: [], campaign: campaign ? { ...campaign, played: [...(campaign.played || []), id] } : null,
  };
  await saveSession(s);
  return s;
}

initTips();
route();
