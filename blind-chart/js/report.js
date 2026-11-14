// report.js — 檢討報告 (SDD 7.4). Recomputed from the session every time
// (deterministic), summary cached on the session for the history page.
import { $, $$, esc, fmt, fmtInt, fmtPct, fmtR, sign, download, MARKET_NAME, REGIME_NAME } from './ui.js';
import { getSession, saveSession, allSessions } from './store.js';
import { getPuzzle, getAnswer } from './bank.js';
import { ChartView, lineChart, timeOf } from './chart.js';
import { prepareForPuzzle, buildReport, reportMarkdown, VIOLATIONS } from '../engine/index.js';
import { newSession } from './main.js';
import { qm } from './glossary.js';

export function summarize(rep, s, ans) {
  const costs = {};
  for (const v of rep.violations) costs[v.code] = (costs[v.code] || 0) + (v.cost || 0);
  return {
    score: rep.score, compliance: rep.complianceRate,
    actualRet: rep.stats.actual.returnPct, shadowRet: rep.stats.shadow.returnPct, bhRet: rep.stats.buyHold.returnPct,
    gap: rep.gap, gapPct: rep.gap / s.initialEquity * 100, finalEquity: rep.actual.finalEquity,
    counts: rep.counts, costs, costsR: Object.fromEntries(rep.violations.map(v => [v.code, 0]).map(([k]) => [k, rep.violations.filter(v => v.code === k).reduce((a, v) => a + (v.costR || 0), 0)])),
    symbol: ans?.symbol, name: ans?.name, trades: rep.stats.actual.trades,
  };
}

export async function renderReport(root, id) {
  const s = await getSession(id);
  if (!s) throw new Error('找不到這個 Session');
  const puzzle = await getPuzzle(s.puzzleId);
  const ans = await getAnswer(puzzle).catch(() => null);
  const ctx = prepareForPuzzle(puzzle, s.spec, { mixed: s.mixed, initialEquity: s.initialEquity });
  const rep = buildReport(ctx, s.actions);
  if (s.status === 'done') {
    s.result = summarize(rep, s, ans);
    if (s.campaign && !s.campaign.realizedSaved) s.campaign.realizedSaved = true;
    await saveSession(s);
  }
  const A = rep.stats.actual, Sh = rep.stats.shadow, ps = ctx.playStart;
  const history = (await allSessions()).filter(x => x.id !== s.id && x.result?.costs);
  const histAvg = code => {
    const xs = history.filter(x => x.result.counts?.[code]).map(x => x.result.costs[code] / x.result.counts[code]);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  const scoreColor = rep.score >= 85 ? 'var(--pos)' : rep.score >= 60 ? 'var(--warn)' : 'var(--neg)';
  const bar = b => b - ps + 1;
  const pf = ans?.priceFactor;
  const camp = s.campaign;
  const isLastOfCampaign = camp && camp.index + 1 >= camp.total;

  root.innerHTML = `
  <div class="rep">
    <section class="card w8">
      <div class="reveal">
        <div>
          <div class="sub">${esc(MARKET_NAME[s.market] || s.market)}${s.regime ? ` · ${REGIME_NAME[s.regime] || s.regime}` : ''}${s.synthetic ? ' · 合成示範題' : ''}</div>
          <div class="sym">${esc(ans?.symbol || '???')} <span style="font-size:1.1rem;font-weight:600">${esc(ans?.name || '')}</span></div>
          <div class="sub">${esc(ans?.startDate || '')} → ${esc(ans?.endDate || '')}${ans?.sector ? ` · ${esc(ans.sector)}` : ''}${Number.isFinite(pf) ? ` · 真實價 = 畫面價 × ${fmt(pf, 4)}` : ''}</div>
        </div>
        <div style="flex:1"></div>
        <div style="text-align:center"><div class="score-ring" style="--p:${rep.score};--c:${scoreColor}"><span>${rep.score}</span></div><div class="sub" style="margin-top:4px">紀律分數 ${qm('score')}</div></div>
        <div class="kv" style="min-width:220px">
          <dt>規則遵守率 ${qm('compliance')}</dt><dd>${fmt(rep.complianceRate, 0)}%</dd>
          <dt>Shadow − Actual ${qm('shadow')}</dt><dd class="${sign(-rep.gap)}">${fmtInt(rep.gap)} 點</dd>
          <dt>違規代價合計 ${qm('cost')}</dt><dd>${fmtInt(rep.sumCost)}</dd>
          <dt>交互殘差 ${qm('interaction')}</dt><dd>${fmtInt(rep.interaction)}</dd>
        </div>
      </div>
      <div class="chart-main" id="repChart" style="height:340px;margin-top:12px"></div>
      <p class="sub" style="margin-top:6px">灰色 K 棒：題目結束後的 ${puzzle.revealBars} 根　○ 該做沒做</p>
    </section>

    <section class="card w4">
      <h2>結果總表</h2>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th></th><th>Actual</th><th>Shadow</th><th>Buy&amp;hold</th></tr></thead>
        <tbody>
          <tr><td>報酬 %</td><td class="${sign(A.returnPct)}">${fmtPct(A.returnPct)}</td><td class="${sign(Sh.returnPct)}">${fmtPct(Sh.returnPct)}</td><td class="${sign(rep.stats.buyHold.returnPct)}">${fmtPct(rep.stats.buyHold.returnPct)}</td></tr>
          <tr><td>總 R ${qm('totalR')}</td><td>${fmtR(A.totalR)}</td><td>${fmtR(Sh.totalR)}</td><td>—</td></tr>
          <tr><td>最大回撤 ${qm('maxDD')}</td><td>${fmt(A.maxDDPct)}%</td><td>${fmt(Sh.maxDDPct)}%</td><td>—</td></tr>
          <tr><td>交易次數</td><td>${A.trades}</td><td>${Sh.trades}</td><td>1</td></tr>
          <tr><td>勝率</td><td>${fmt(A.winRate, 0)}%</td><td>${fmt(Sh.winRate, 0)}%</td><td>—</td></tr>
          <tr><td>平均賺 / 賠</td><td>${fmtR(A.avgWinR)} / ${fmtR(A.avgLossR)}</td><td>${fmtR(Sh.avgWinR)} / ${fmtR(Sh.avgLossR)}</td><td>—</td></tr>
          <tr><td>期望值 R/筆 ${qm('expectancy')}</td><td>${fmtR(A.expectancyR)}</td><td>${fmtR(Sh.expectancyR)}</td><td>—</td></tr>
          <tr><td>Profit factor ${qm('profitFactor')}</td><td>${fmt(A.profitFactor)}</td><td>${fmt(Sh.profitFactor)}</td><td>—</td></tr>
        </tbody></table></div>
      <div class="ctrl" style="margin-top:12px">
        ${camp && !isLastOfCampaign ? '<button class="btn btn-primary" id="bNextCamp">連關下一題 →</button>' : '<a class="btn btn-primary" href="#/setup">再來一題</a>'}
        <button class="btn btn-sm" id="bMd">匯出 Markdown</button>
      </div>
      ${camp ? `<p class="sub" style="margin-top:10px">連關 ${camp.index + 1}/${camp.total} · 結束權益 ${fmtInt(rep.actual.finalEquity)}${isLastOfCampaign ? ' · 連關完成，綜合報告在「歷史」' : ''}</p>` : ''}
    </section>

    <section class="card w7">
      <h2>權益曲線 <span class="sub">你（棕）· 照規則（藍）· 買進持有（灰）· ▼ 違規</span></h2>
      <div class="rep-chart" id="eqChart"></div>
    </section>
    <section class="card w5">
      <h2>R 分佈 <span class="sub">你（棕）· 照規則（藍）</span></h2>
      ${histogramHTML(rep.rHist)}
      <h3>違規次數</h3>
      <div class="chips">${Object.entries(rep.counts).map(([c, n]) => `<span class="tag neg">${esc(VIOLATIONS[c]?.name || c)} × ${n}</span>`).join('') || '<span class="tag pos">沒有違規</span>'}</div>
    </section>

    <section class="card">
      <h2>違規清單 ${qm('counterfactual')} <span class="sub">依代價排序，點一下跳到那根</span></h2>
      ${rep.violations.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>違規</th><th>第幾根</th><th>規則要求</th><th>你做了</th><th>代價（點）</th><th>代價（R）</th></tr></thead><tbody>
        ${rep.violations.map(v => `<tr class="click" data-bar="${v.bar}"><td><span class="tag ${v.cost < 0 ? 'warn' : 'neg'}">${esc(v.name)}</span> <span class="sub mono">${v.code}</span></td><td>${bar(v.bar)}</td><td style="text-align:left;white-space:normal">${esc(v.required || '')}</td><td style="text-align:left;white-space:normal">${esc(v.did || '')}</td><td class="mono ${sign(-v.cost)}">${fmtInt(v.cost)}</td><td class="mono">${fmt(v.costR)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">完全照規則，沒有違規</p>'}
    </section>

    <section class="card w6">
      <h2>違規但賺錢 <span class="sub">運氣</span></h2>
      ${rep.lucky.length ? rep.lucky.map(v => { const h = histAvg(v.code); return `<div class="callout" style="margin-bottom:8px"><b>${esc(v.name)}</b>（第 ${bar(v.bar)} 根）讓你多賺 ${fmtInt(-v.cost)} 點。${Number.isFinite(h) ? `同類違規過去平均代價 <b class="${sign(-h)}">${fmtInt(h)}</b> 點。` : ''}</div>`; }).join('') : '<p class="sub">沒有。</p>'}
    </section>
    <section class="card w6">
      <h2>遵守但賠錢 <span class="sub">策略的正常成本</span></h2>
      ${rep.compliantLosers.length ? `<div class="chips">${rep.compliantLosers.map(t => `<span class="tag">${bar(t.entryBar)}→${bar(t.exitBar)}：${fmtR(t.R)}</span>`).join('')}</div>` : '<p class="sub">沒有。</p>'}
    </section>

    <section class="card">
      <h2>逐筆交易</h2>
      ${tradesTable(rep, ps)}
    </section>
  </div>`;

  // reveal chart
  const cv = new ChartView($('#repChart'), document.createElement('div'), null, { playStart: ps, spec: ctx.spec });
  const vMarks = rep.violations.map(v => ({ time: timeOf(v.bar), position: 'aboveBar', color: '#DC2626', shape: 'circle', text: v.code }));
  const missed = rep.violations.filter(v => v.code === 'MISSED_SIGNAL').map(v => ({ time: timeOf(v.bar), position: 'belowBar', color: 'rgba(22,163,74,.55)', shape: 'circle', text: '○ 應買' }));
  cv.update({ ctx, t: ctx.playEnd - 1, revealTo: Math.min(ctx.series.close.length - 1, ctx.playEnd - 1 + puzzle.revealBars), run: rep.actual, hint: 'full', markers: [...vMarks, ...missed] });
  cv.focus(ctx.playEnd - 1 + puzzle.revealBars, ctx.playEnd - ps + puzzle.revealBars + 20);
  $$('tr[data-bar]', root).forEach(tr => tr.onclick = () => { cv.focus(+tr.dataset.bar + 20, 80); $('#repChart').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

  // equity chart
  const pts = arr => { const o = []; for (let i = ps; i < ctx.playEnd; i++) if (Number.isFinite(arr[i])) o.push({ x: i, y: (arr[i] / ctx.initialEquity - 1) * 100 }); return o; };
  lineChart($('#eqChart'), [
    { data: pts(rep.actual.equity), color: '#8B5E3C', title: 'Actual' },
    { data: pts(rep.shadow.equity), color: '#2563EB', title: 'Shadow', style: 2 },
    { data: pts(rep.buyHold.equity), color: '#9B7E68', title: 'B&H', width: 1, style: 1 },
  ], { markers: rep.violations.map(v => ({ x: v.bar, position: 'aboveBar', color: '#DC2626', shape: 'arrowDown', text: v.code.slice(0, 6) })), xLabel: b => `#${b - ps + 1}` });

  $('#bMd').onclick = () => download(`blind-chart-${s.id}.md`, reportMarkdown(rep, { ...ans, strategy: s.spec.name }), 'text/markdown');
  $('#bNextCamp') && ($('#bNextCamp').onclick = async e => {
    e.target.disabled = true;
    const realized = (camp.realized || 0) + (rep.actual.finalEquity - s.initialEquity);
    const next = await newSession({ ...(camp.settings || { market: s.mixed ? 'MIX' : s.market, presetId: s.presetId, playBars: s.playBars, hint: s.settings.hint, hideDiscipline: s.settings.hideDiscipline }), risk: camp.settings?.risk ?? s.risk ?? 0 },
      { ...camp, index: camp.index + 1, realized }, rep.actual.finalEquity);
    location.hash = `#/play/${next.id}`;
  });
}

function histogramHTML(h) {
  const a = h.actual, b = h.shadow;
  const max = Math.max(1, ...a.map(x => x.n), ...b.map(x => x.n));
  const lbl = x => (x.lo === -Infinity ? `<${x.hi}` : x.hi === Infinity ? `≥${x.lo}` : `${x.lo}`);
  return `<div class="hist">${a.map((x, i) => `<div class="col" title="${lbl(x)}R：Actual ${x.n} / Shadow ${b[i].n}"><i style="height:${x.n / max * 100}%;background:#8B5E3C"></i><i style="height:${b[i].n / max * 100}%;background:#2563EB"></i></div>`).join('')}</div>
    <div class="hist-x">${a.map(x => `<span>${lbl(x)}</span>`).join('')}</div>`;
}

function tradesTable(rep, ps) {
  const sh = rep.shadow.trades;
  const match = t => sh.find(x => x.entryBar <= (t.exitBar ?? Infinity) && (x.exitBar ?? Infinity) >= t.entryBar);
  if (!rep.actual.trades.length) return '<p class="sub">這題沒有進場。</p>';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>批</th><th>進場</th><th>進場價</th><th>初始停損</th><th>加碼</th><th>分批出場</th><th>MAE ${qm('mae')}</th><th>MFE ${qm('mfe')}</th><th>結果</th><th>對應 Shadow</th><th>違規</th></tr></thead><tbody>
  ${rep.actual.trades.map(t => {
    const m = match(t), v = rep.violations.filter(x => x.tradeId === t.id);
    const exits = t.fills.filter(f => f.side === 'sell').map(f => `${f.bar - ps + 1}:${fmtInt(f.qty)}@${fmt(f.price)}`).join(' ');
    return `<tr class="click" data-bar="${t.entryBar}"><td>#${t.id}</td><td>${t.entryBar - ps + 1}</td><td class="mono">${fmt(t.entryPrice)}</td><td class="mono">${fmt(t.initialStop)}</td><td>${t.adds}</td><td class="mono" style="text-align:left">${exits || '—'}</td>
      <td class="mono neg">${fmtR(t.mae)}</td><td class="mono pos">${fmtR(t.mfe)}</td><td class="mono ${sign(t.R)}">${fmtR(t.R)}${t.open ? '*' : ''}</td>
      <td class="mono">${m ? `${m.entryBar - ps + 1}→${(m.exitBar ?? 0) - ps + 1} ${fmtR(m.R)}` : '—'}</td>
      <td>${v.map(x => `<span class="tag neg">${esc(x.name)}</span>`).join(' ') || '<span class="tag pos">合規</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
