// play.js — the game screen: chart + portfolio + order panel + trade log.
// State is the action log; every render replays it (engine.simulate) up to the
// cursor, so what you see is exactly what the report will compute.
import { $, $$, esc, fmt, fmtInt, fmtPct, fmtR, sign, toast, sparkline, MARKET_NAME } from './ui.js';
import { getSession, saveSession } from './store.js';
import { getPuzzle } from './bank.js';
import { ChartView } from './chart.js';
import { qm } from './glossary.js';
import { prepareForPuzzle, simulate, INDICATORS, roundLot } from '../engine/index.js';

let G = null;                    // current game
export function stopPlay() {
  if (!G) return;
  clearInterval(G.timer);
  document.removeEventListener('keydown', G.onKey);
  G.chart?.destroy();
  G = null;
}

export async function renderPlay(root, id) {
  const s = await getSession(id);
  if (!s) throw new Error('找不到這個 Session');
  if (s.status === 'done') { location.hash = `#/report/${id}`; return; }
  const puzzle = await getPuzzle(s.puzzleId);
  const ctx = prepareForPuzzle(puzzle, s.spec, { mixed: s.mixed, initialEquity: s.initialEquity });
  const subInds = s.spec.indicators.filter(x => INDICATORS[x.type]?.pane === 'sub');
  const priceInds = s.spec.indicators.filter(x => INDICATORS[x.type]?.pane === 'price' && x.type !== 'swing');
  const banner = !document.getElementById('banner').hidden;
  root.innerHTML = `
  <div class="play${banner ? ' with-banner' : ''}" data-tab="order">
    <section class="card chart-card">
      <div class="chart-head">
        <span class="title">${s.mixed ? '混合盲測' : esc(MARKET_NAME[s.market] || s.market)}</span>
        <span class="tag">${esc(s.spec.name || s.spec.id)}</span>
        ${s.campaign ? `<span class="tag warn">連關 ${s.campaign.index + 1}/${s.campaign.total}</span>` : ''}
        <span class="grow"></span>
        <div class="ind-toggles" id="indToggles">
          ${priceInds.map(x => `<button class="on" data-ov="${esc(x.id)}">${esc(x.id)}</button>`).join('')}
          ${subInds.map(x => `<button data-sub="${esc(x.id)}">${esc(x.id)}</button>`).join('')}
        </div>
      </div>
      <div class="chart-main" id="chartMain"><div class="legend" id="legend"></div></div>
      <div class="chart-sub" id="chartSub" hidden></div>
      <div class="ctrl desk-ctrl" style="padding-top:8px">
        <button class="btn btn-primary" id="bNext">下一根 <kbd>N</kbd></button>
        <button class="btn" id="bPlay">▶ 播放 <kbd>Space</kbd></button>
        <select class="input" id="speed" style="width:auto" title="播放速度（根/秒）">${[1, 2, 4, 8, 16].map(v => `<option value="${v}" ${s.settings.speed == v ? 'selected' : ''}>${v} 根/秒</option>`).join('')}</select>
        <button class="btn" id="bJump">跳到下一事件 <kbd>J</kbd></button>
        <span class="grow" style="flex:1"></span>
        <span class="sub" id="progTxt"></span>
      </div>
    </section>

    <nav class="mobile-tabs" id="mTabs">
      <button data-t="order" class="on">下單</button><button data-t="pf">持倉</button><button data-t="log">紀錄</button>
    </nav>

    <aside class="side">
      <div class="hint" id="hint"></div>
      <section class="card" data-pane="pf" id="pf"></section>
    </aside>

    <div class="bottom">
      <section class="card" data-pane="order" id="order"></section>
      <section class="card" data-pane="log" id="log"></section>
    </div>

    <div class="mobile-bar">
      <button class="btn btn-primary" id="mNext">下一根</button>
      <button class="btn" id="mPlay">▶</button>
      <button class="btn" id="mJump">⏭ 事件</button>
      <button class="btn btn-buy" id="mAct">買進</button>
    </div>
  </div>`;

  G = { s, puzzle, ctx, t: s.cursor, timer: null, qty: null, qtyTouched: false };
  G.chart = new ChartView($('#chartMain'), $('#chartSub'), $('#legend'), { playStart: ctx.playStart, spec: ctx.spec });

  $('#indToggles').addEventListener('click', e => {
    const ov = e.target.closest('[data-ov]'), sb = e.target.closest('[data-sub]');
    if (ov) ov.classList.toggle('on', G.chart.toggleOverlay(ov.dataset.ov));
    if (sb) {
      const on = !sb.classList.contains('on');
      $$('[data-sub]').forEach(b => b.classList.remove('on'));
      if (on) sb.classList.add('on');
      G.chart.setSub(on ? sb.dataset.sub : null);
    }
  });
  $('#mTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    $$('#mTabs button').forEach(x => x.classList.toggle('on', x === b));
    $('.play').dataset.tab = b.dataset.t;
  });
  $('#bNext').onclick = $('#mNext').onclick = () => step();
  $('#bPlay').onclick = $('#mPlay').onclick = () => togglePlay();
  $('#bJump').onclick = $('#mJump').onclick = () => jump();
  $('#speed').onchange = e => { s.settings.speed = +e.target.value; if (G.timer) { togglePlay(); togglePlay(); } save(); };
  $('#mAct').onclick = () => {
    const adv = G.run.advice[G.t];
    if (adv?.hit?.stop && adv.pos) return confirmStop();
    if (adv?.hit?.targets?.length && adv.pos) return confirmTarget();
    if (!adv?.pos) return buy();
    $('.play').dataset.tab = 'order'; $$('#mTabs button').forEach(x => x.classList.toggle('on', x.dataset.t === 'order'));
    $('#order').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  G.onKey = e => {
    if (e.target.matches('input, textarea, select')) { if (e.key === 'Enter') e.target.blur(); return; }
    const k = e.key.toLowerCase();
    if (k === 'n') step();
    else if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'j') jump();
    else if (k === 'b') buy();
    else if (k === 'a') add();
    else if (k === 's') sellQty(G.qty);
    else if (k === 'u') undo();
    else return;
  };
  document.addEventListener('keydown', G.onKey);
  render(true);
}

const last = () => G.ctx.playEnd - 1;
function replay() { G.run = simulate(G.ctx, { mode: 'actual', actions: G.s.actions, upTo: G.t }); return G.run; }
function save() { G.s.cursor = G.t; saveSession(G.s); }

function isEvent(run, t) {
  const a = run.advice[t];
  if (!a) return false;
  return !!(a.entrySignal || a.hit || a.exitAll || a.exitPart || a.addSignal || run.fills.some(f => f.bar === t));
}

function step(n = 1) {
  if (!G) return;
  if (G.t >= last()) return finish();
  G.t = Math.min(G.t + n, last());
  G.qtyTouched = false;
  render();
  save();
  if (G.timer && G.s.settings.hint !== 'none') {
    const a = G.run.advice[G.t];
    if (a?.hit && a.pos) { togglePlay(); toast('盤中觸發停損 / 停利，請確認'); }
    else if (a?.entrySignal) { togglePlay(); toast('進場訊號成立'); }
  }
}
function jump() {
  if (!G) return;
  if (G.t >= last()) return finish();
  let t = G.t;
  const start = performance.now();
  while (t < last()) {
    t++;
    const run = simulate(G.ctx, { mode: 'actual', actions: G.s.actions, upTo: t });
    if (isEvent(run, t) || performance.now() - start > 1500) break;
  }
  G.t = t; G.qtyTouched = false;
  render(); save();
}
function togglePlay() {
  if (!G) return;
  if (G.timer) { clearInterval(G.timer); G.timer = null; }
  else G.timer = setInterval(() => (G && G.t < last() ? step() : togglePlay()), 1000 / (G.s.settings.speed || 4));
  const lbl = G.timer ? '⏸ 暫停' : '▶ 播放';
  $('#bPlay').innerHTML = `${lbl} <kbd>Space</kbd>`;
  $('#mPlay').textContent = G.timer ? '⏸' : '▶';
}

function push(a) {
  if (G.t >= last()) { toast('最後一根之後不會再成交，按「下一根」結束本題'); return; }
  G.s.actions.push({ barIndex: G.t, ts: Date.now(), ...a });
  G.qtyTouched = false;
  render(); save();
}
function curQty() { const v = parseInt($('#qty')?.value, 10); return Number.isFinite(v) ? v : G.qty; }
function buy() {
  const adv = G.run.advice[G.t];
  if (adv?.pos) return add();
  if (adv?.pendingOrders?.some(o => o.side === 'buy')) return toast('已有買單等待成交');
  const q = roundLot(curQty(), G.ctx.lot);
  if (!(q > 0)) return toast(`股數需為 ${G.ctx.lot} 的倍數`);
  push({ action: 'buy', qty: q });
}
function add() {
  const adv = G.run.advice[G.t];
  if (!adv?.pos) return buy();
  const q = roundLot(curQty(), G.ctx.lot);
  if (!(q > 0)) return toast('股數不正確');
  push({ action: 'add', qty: q });
}
function sellQty(q, kind) {
  const adv = G.run.advice[G.t];
  if (!adv?.pos) return toast('目前沒有持倉');
  q = Math.min(q >= adv.pos.size ? adv.pos.size : roundLot(q, G.ctx.lot), adv.pos.size);
  if (!(q > 0)) return toast('股數不正確');
  push({ action: 'sell', qty: q, ...(kind ? { kind } : {}) });
}
function confirmStop() { const p = G.run.advice[G.t].pos; sellQty(p.size, 'stop'); }
function confirmTarget() {
  const adv = G.run.advice[G.t];
  for (const th of adv.hit.targets) G.s.actions.push({ barIndex: G.t, ts: Date.now(), action: 'sell', qty: th.qty, kind: 'target' });
  render(); save();
}
function undo() {
  const before = G.s.actions.length;
  G.s.actions = G.s.actions.filter(a => a.barIndex !== G.t);
  if (G.s.actions.length === before) return toast('這一根沒有可撤銷的下單');
  toast('已撤銷本根下單'); render(); save();
}

async function finish() {
  const g = G;
  if (!g || g.finishing) return;
  g.finishing = true;
  if (g.timer) togglePlay();
  g.s.status = 'done';
  g.s.cursor = g.ctx.playEnd - 1;
  g.s.finishedAt = Date.now();
  await saveSession(g.s);
  location.hash = `#/report/${g.s.id}`;
}

// ───────────────────────── rendering ─────────────────────────
function render(first) {
  const run = replay();
  const t = G.t, ctx = G.ctx, adv = run.advice[t] || {};
  const hint = G.s.settings.hint;
  G.chart.update({ ctx, t, run, hint, follow: !first });
  renderHint(adv, run, hint);
  renderPortfolio(adv, run);
  renderOrder(adv, run);
  renderLog(run);
  const i = t - ctx.playStart + 1, n = ctx.playEnd - ctx.playStart;
  $('#progTxt').textContent = `第 ${i} / ${n} 根`;
  const ma = $('#mAct');
  if (adv.hit?.stop && adv.pos) { ma.textContent = '確認停損'; ma.className = 'btn btn-sell'; }
  else if (adv.hit?.targets?.length && adv.pos) { ma.textContent = '確認停利'; ma.className = 'btn btn-warn'; }
  else if (adv.pos) { ma.textContent = '下單 / 賣出'; ma.className = 'btn'; }
  else { ma.textContent = '買進'; ma.className = 'btn btn-buy'; }
  $('#mNext').textContent = t >= last() ? '結束 →' : '下一根';
  $('#bNext').innerHTML = t >= last() ? '結束本題 →' : '下一根 <kbd>N</kbd>';
}

function renderHint(adv, run, hint) {
  const el = $('#hint');
  const S = G.ctx.series, t = G.t, msgs = [];
  let cls = '';
  if (hint === 'full') {
    if (adv.hit?.stop && adv.pos) { cls = 'alert'; msgs.push(`<b>盤中跌破${adv.hit.stop.trail ? '移動停利' : '停損'} ${fmt(adv.hit.stop.line)}</b>：規則 → 以 ${fmt(adv.hit.stop.price)} 全部出場（按「確認停損」）`); }
    if (adv.hit?.targets?.length && adv.pos) { cls = cls || 'go'; for (const th of adv.hit.targets) msgs.push(`<b>達停利 ${fmt(th.line)}</b>：規則 → 賣出 ${fmtInt(th.qty)} 股（${Math.round(th.fraction * 100)}%）`); }
    if (adv.exitAll && adv.pos) { cls = 'alert'; msgs.push(`<b>${adv.exitAll.reason === 'time_stop' ? '時間停損' : '收盤跌破移動停損線'}</b>：規則 → 下一根開盤全部出場`); }
    if (adv.exitPart && adv.pos) { cls = cls || 'alert'; msgs.push(`<b>出場訊號成立</b>：規則 → 下一根開盤賣出 ${fmtInt(adv.exitPart.qty)} 股`); }
    if (adv.entrySignal) { cls = 'go'; const g = adv.suggest; msgs.push(`<b>進場訊號成立</b>：建議 ${fmtInt(g.qty)} 股，初始停損 ${fmt(g.stop)}，1R = ${fmtInt(g.R)} 點（帳戶風險 ${fmt(g.riskPct, 2)}%）`); }
    if (adv.addSignal && adv.pos) { cls = cls || 'go'; msgs.push(`<b>加碼條件成立</b>：建議加碼 ${fmtInt(adv.addQty)} 股`); }
    if (!msgs.length) msgs.push(adv.pos ? `持有中。有效停損 ${fmt(adv.pos.stop)}，未實現 ${fmtR(adv.pos.unrealizedR)}。` : '無訊號，觀望。');
    for (const o of adv.openObligations || []) if (o.bar < t && o.type !== 'entry' && adv.pos) { cls = 'alert'; msgs.push(`⚠ 第 ${o.bar - G.ctx.playStart + 1} 根起規則要求出場，你仍持有`); break; }
  } else if (hint === 'lines') {
    msgs.push('提示模式：只有線。');
  } else msgs.push('提示模式：什麼都不畫，檢討報告才會比對。');
  if (adv.pendingOrders?.length) msgs.push(`<span class="sub">掛單：${adv.pendingOrders.map(o => `${o.side === 'buy' ? '買' : '賣'} ${fmtInt(o.qty)}`).join('、')}（下一根開盤成交）</span>`);
  el.className = `hint ${cls}`;
  el.innerHTML = msgs.map(m => `<p>${m}</p>`).join('');
  void S;
}

function renderPortfolio(adv, run) {
  const ctx = G.ctx, t = G.t, S = ctx.series;
  const c = S.close[t], chg = (c / S.close[t - 1] - 1) * 100;
  const a = adv.acct || {}, p = adv.pos;
  const realized = run.trades.filter(x => !x.open).reduce((s, x) => s + x.pnl, 0);
  const eq = Array.from(run.equity.slice(ctx.playStart, t + 1));
  let peak = -Infinity, mdd = 0; for (const v of eq) { peak = Math.max(peak, v); mdd = Math.max(mdd, (peak - v) / peak); }
  const atr = ctx.defaultAtr ? S[ctx.defaultAtr][t] : NaN;
  const nextT = p ? run.targetLines.map(l => l[t]).filter(Number.isFinite).sort((x, y) => x - y)[0] : NaN;
  const nViol = run.violations.length;
  const camp = G.s.campaign;
  $('#pf').innerHTML = `
    <h2>Portfolio <span class="sub">${G.s.mixed ? '' : `每單位 ${ctx.lot} 股`}</span></h2>
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px"><span class="price-big">${fmt(c)}</span><span class="${sign(chg)} mono">${fmtPct(chg)}</span></div>
    <dl class="kv">
      <dt>權益</dt><dd>${fmtInt(a.equity)} <span class="${sign(a.equity - ctx.initialEquity)}">${fmtPct((a.equity / ctx.initialEquity - 1) * 100)}</span></dd>
      <dt>現金 / 市值</dt><dd>${fmtInt(a.cash)} / ${fmtInt(p ? p.size * c : 0)}</dd>
      <dt>持倉</dt><dd>${p ? `${fmtInt(p.size)} 股 @ ${fmt(p.avgPrice)}` : '空手'}</dd>
      ${p ? `<dt>持有 / 加碼</dt><dd>${p.barsHeld} 根 / ${p.adds} 次</dd>
      <dt>未實現 ${qm('unrealized')}</dt><dd class="${sign(p.unrealizedPnl)}">${fmtInt(p.unrealizedPnl)}（${fmtPct((c / p.avgPrice - 1) * 100)}，${fmtR(p.unrealizedR)}）</dd>
      <dt>有效停損 ${qm('effStop')}</dt><dd>${fmt(p.stop)}（${fmtPct((p.stop / c - 1) * 100)}${Number.isFinite(atr) ? `，${fmt((c - p.stop) / atr, 1)} ATR` : ''}）</dd>
      <dt>未保護風險 ${qm('openRisk')}</dt><dd>${fmt(a.openRiskR)}R（${fmt(a.openRisk / a.equity * 100)}%）</dd>
      <dt>下一個目標</dt><dd>${Number.isFinite(nextT) ? `${fmt(nextT)}（${fmtPct((nextT / c - 1) * 100)}）` : '—'}</dd>` : ''}
      <dt>已實現</dt><dd class="${sign(realized)}">本題 ${fmtInt(realized)}${camp ? `　連關 ${fmtInt((camp.realized || 0) + realized)}` : ''}</dd>
      <dt>最大回撤 ${qm('maxDD')}</dt><dd>${fmt(mdd * 100)}%</dd>
      <dt>紀律</dt><dd>${G.s.settings.hideDiscipline ? '<span class="muted">結束後揭曉</span>' : `${nViol ? `<span class="neg">${nViol} 次違規</span>` : '<span class="pos">0 違規</span>'}`}</dd>
    </dl>
    <canvas class="spark" id="spark" style="margin-top:10px"></canvas>
    <div class="progress"><i style="width:${(t - ctx.playStart + 1) / (ctx.playEnd - ctx.playStart) * 100}%"></i></div>`;
  sparkline($('#spark'), eq);
}

function renderOrder(adv, run) {
  const p = adv.pos, lot = G.ctx.lot;
  if (!G.qtyTouched) G.qty = p ? (adv.addSignal ? adv.addQty : p.size) : (adv.suggest?.qty || lot);
  const pend = adv.pendingOrders || [];
  const thisBar = G.s.actions.filter(a => a.barIndex === G.t);
  const sug = adv.suggest;
  const sugR = !p && sug ? `建議 ${fmtInt(sug.qty)} 股 · 1R = ${fmtInt(sug.R)} · 風險 ${fmt(sug.riskPct)}%` : p && adv.addSignal ? `建議加碼 ${fmtInt(adv.addQty)} 股` : p ? `持有 ${fmtInt(p.size)} 股` : '';
  const stopBtn = adv.hit?.stop && p ? `<button class="btn btn-sell btn-lg" id="oStop">確認停損 @ ${fmt(adv.hit.stop.price)}</button>` : '';
  const tgtBtn = adv.hit?.targets?.length && p ? `<button class="btn btn-warn btn-lg" id="oTgt">確認停利 @ ${fmt(adv.hit.targets[0].price)}（${fmtInt(adv.hit.targets.reduce((s, x) => s + x.qty, 0))} 股）</button>` : '';
  $('#order').innerHTML = `
    <h2>下單 ${qm('R')} <span class="sub">${G.ctx.spec.fill.mode === 'this_close' ? '本根收盤成交' : '下一根開盤成交'}</span></h2>
    <div class="order-grid">
      ${stopBtn}${tgtBtn}
      <div class="qty-row">
        <input class="input" id="qty" type="number" inputmode="numeric" min="0" step="${lot}" value="${G.qty}">
        <span class="sub" style="white-space:nowrap">股</span>
      </div>
      <div class="sub">${sugR}</div>
      <div class="ctrl">
        ${p ? `<button class="btn btn-buy" id="oAdd">加碼 <kbd>A</kbd></button>` : `<button class="btn btn-buy" id="oBuy">買進 <kbd>B</kbd></button>`}
        ${p ? `<button class="btn btn-sell" id="oSell">賣出 <kbd>S</kbd></button>` : ''}
      </div>
      ${p ? `<div class="sell-row"><button class="btn btn-sm" data-f="0.25">賣 25%</button><button class="btn btn-sm" data-f="0.5">賣 50%</button><button class="btn btn-sm" data-f="1">全部</button></div>` : ''}
      ${pend.length || thisBar.length ? `<div class="pending">本根下單：${thisBar.map(a => `${a.action === 'sell' ? '賣' : a.action === 'add' ? '加碼' : '買'} ${fmtInt(a.qty)}${a.kind ? `（${a.kind === 'stop' ? '停損' : '停利'}）` : ''}`).join('、') || '—'}
        ${thisBar.length ? '<button class="btn btn-sm" id="oUndo">撤銷 <kbd>U</kbd></button>' : ''}</div>` : ''}
    </div>`;
  const q = $('#qty');
  q.oninput = () => { G.qtyTouched = true; G.qty = parseInt(q.value, 10) || 0; };
  $('#oBuy') && ($('#oBuy').onclick = buy);
  $('#oAdd') && ($('#oAdd').onclick = add);
  $('#oSell') && ($('#oSell').onclick = () => sellQty(curQty()));
  $('#oStop') && ($('#oStop').onclick = confirmStop);
  $('#oTgt') && ($('#oTgt').onclick = confirmTarget);
  $('#oUndo') && ($('#oUndo').onclick = undo);
  $$('[data-f]', $('#order')).forEach(b => b.onclick = () => sellQty(+b.dataset.f >= 1 ? p.size : p.size * +b.dataset.f));
  void run;
}

function renderLog(run) {
  const ps = G.ctx.playStart, hide = G.s.settings.hideDiscipline;
  const rows = run.trades.slice().reverse().map(tr => {
    const buys = tr.fills.filter(f => f.side === 'buy'), sells = tr.fills.filter(f => f.side === 'sell');
    const v = run.violations.filter(x => x.tradeId === tr.id);
    return `<tr class="click" data-bar="${tr.entryBar}">
      <td>#${tr.id}</td><td>${tr.entryBar - ps + 1}</td><td class="mono">${fmt(tr.entryPrice)}</td>
      <td>${buys.length - 1 || '—'}</td><td>${sells.map(f => `${f.bar - ps + 1}:${fmtInt(f.qty)}`).join(' ') || '—'}</td>
      <td class="mono ${sign(tr.R)}">${fmtR(tr.R)}${tr.open ? '*' : ''}</td>
      <td>${hide ? '—' : v.length ? `<span class="tag neg">${v.map(x => esc(x.name)).join('、')}</span>` : '<span class="tag pos">合規</span>'}</td></tr>`;
  }).join('');
  $('#log').innerHTML = `<h2>交易紀錄 <span class="sub">* 尚未出場，以現價計</span></h2>
    ${rows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>批</th><th>進場根</th><th>進場價</th><th>加碼</th><th>出場（根:股）</th><th>結果</th><th>合規</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="sub">還沒有交易。</p>'}`;
  $$('tr[data-bar]', $('#log')).forEach(tr => tr.onclick = () => G.chart.focus(+tr.dataset.bar, 60));
}
