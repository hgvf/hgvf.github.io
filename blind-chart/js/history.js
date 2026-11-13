// history.js — 歷史頁 (SDD 7.5): trends, most frequent / most expensive mistakes.
import { $, $$, esc, fmt, fmtInt, fmtPct, sign, download, toast, MARKET_NAME, REGIME_NAME } from './ui.js';
import { allSessions, saveSession, deleteSession } from './store.js';
import { lineChart } from './chart.js';
import { VIOLATIONS } from '../engine/index.js';

export async function renderHistory(root) {
  const all = (await allSessions()).filter(s => s.status === 'done' && s.result);
  const f = { strategy: '', market: '', regime: '' };
  const strategies = [...new Set(all.map(s => s.presetId))];
  root.innerHTML = `
  <div class="hist-grid">
    <section class="card" style="grid-column:1/-1">
      <h2>歷史 <span class="sub">${all.length} 個完成的 Session</span></h2>
      <div class="filters">
        <select class="input" data-f="strategy"><option value="">全部策略</option>${strategies.map(x => `<option>${esc(x)}</option>`).join('')}</select>
        <select class="input" data-f="market"><option value="">全部市場</option>${['TW', 'US', 'JP', 'KR', 'MIX'].map(m => `<option value="${m}">${MARKET_NAME[m]}</option>`).join('')}</select>
        <select class="input" data-f="regime"><option value="">全部盤勢</option>${Object.entries(REGIME_NAME).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <span style="flex:1"></span>
        <button class="btn btn-sm" id="hExport">匯出全部 JSON</button>
        <label class="btn btn-sm">匯入<input type="file" id="hImport" accept="application/json" hidden></label>
      </div>
      <div id="hBody"></div>
    </section>
  </div>`;
  $$('[data-f]', root).forEach(sel => sel.onchange = () => { f[sel.dataset.f] = sel.value; draw(); });
  $('#hExport').onclick = async () => download('blind-chart-sessions.json', JSON.stringify(await allSessions(), null, 1));
  $('#hImport').onchange = async e => {
    try {
      const list = JSON.parse(await e.target.files[0].text());
      for (const s of Array.isArray(list) ? list : [list]) if (s.id && s.actions) await saveSession(s);
      toast('已匯入'); renderHistory(root);
    } catch (err) { toast(`匯入失敗：${err.message}`); }
  };
  draw();

  function draw() {
    const list = all.filter(s => (!f.strategy || s.presetId === f.strategy) && (!f.market || (s.mixed ? 'MIX' : s.market) === f.market) && (!f.regime || s.regime === f.regime))
      .sort((a, b) => (a.finishedAt || a.updatedAt) - (b.finishedAt || b.updatedAt));
    const body = $('#hBody');
    if (!list.length) { body.innerHTML = '<p class="empty">還沒有完成的 Session。</p>'; return; }
    // per violation type
    const agg = {};
    for (const s of list) for (const [c, n] of Object.entries(s.result.counts || {})) {
      const a = agg[c] ||= { n: 0, sessions: 0, cost: 0 };
      a.n += n; a.sessions++; a.cost += s.result.costs?.[c] || 0;
    }
    const rows = Object.entries(agg).map(([c, a]) => ({ c, ...a, rate: a.sessions / list.length, avg: a.cost / a.n })).sort((x, y) => y.cost - x.cost);
    const most = rows.slice().sort((a, b) => b.n - a.n)[0], costly = rows[0];
    const avg = k => list.reduce((s, x) => s + (x.result[k] || 0), 0) / list.length;
    const camps = {};
    for (const s of list) if (s.campaign) (camps[s.campaign.id] ||= []).push(s);
    body.innerHTML = `
      <div class="kv" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr) minmax(80px,auto));margin-bottom:14px">
        <dt>平均紀律分數</dt><dd>${fmt(avg('score'), 1)}</dd>
        <dt>平均 Shadow − Actual</dt><dd>${fmtPct(avg('gapPct'))}</dd>
        <dt>平均報酬（你）</dt><dd class="${sign(avg('actualRet'))}">${fmtPct(avg('actualRet'))}</dd>
        <dt>平均報酬（規則）</dt><dd class="${sign(avg('shadowRet'))}">${fmtPct(avg('shadowRet'))}</dd>
      </div>
      ${costly ? `<div class="callout" style="margin-bottom:12px">你最常犯：<b>${esc(VIOLATIONS[most.c]?.name || most.c)}</b>（${most.n} 次）　最貴的錯：<b>${esc(VIOLATIONS[costly.c]?.name || costly.c)}</b>（累計 ${fmtInt(costly.cost)} 點，平均每次 ${fmtInt(costly.avg)}）</div>` : ''}
      <div class="hist-grid">
        <div><h3>紀律分數與 Shadow − Actual（% 初始權益）</h3><div class="rep-chart" id="hTrend"></div></div>
        <div><h3>各違規類型</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>違規</th><th>次數</th><th>發生率</th><th>平均代價</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${esc(VIOLATIONS[r.c]?.name || r.c)}</td><td>${r.n}</td><td>${fmt(r.rate * 100, 0)}%</td><td class="mono ${sign(-r.avg)}">${fmtInt(r.avg)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">沒有違規紀錄</td></tr>'}
        </tbody></table></div></div>
      </div>
      ${Object.keys(camps).length ? `<h3>連關</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>連關</th><th>題數</th><th>起始 → 結束權益</th><th>平均分數</th><th>合計 Shadow − Actual</th></tr></thead><tbody>
        ${Object.values(camps).map(c => { c.sort((a, b) => a.campaign.index - b.campaign.index); const l = c[c.length - 1]; return `<tr><td>${esc(c[0].campaign.id.slice(-5))}</td><td>${c.length}/${c[0].campaign.total}</td><td class="mono">${fmtInt(c[0].initialEquity)} → ${fmtInt(l.result.finalEquity)}</td><td>${fmt(c.reduce((a, s) => a + s.result.score, 0) / c.length, 1)}</td><td class="mono">${fmtInt(c.reduce((a, s) => a + s.result.gap, 0))}</td></tr>`; }).join('')}
      </tbody></table></div>` : ''}
      <h3>Session</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>完成</th><th>標的</th><th>市場</th><th>盤勢</th><th>策略</th><th>分數</th><th>你</th><th>規則</th><th>B&amp;H</th><th>違規</th><th></th></tr></thead><tbody>
        ${list.slice().reverse().map(s => `<tr class="click" data-id="${s.id}"><td>${new Date(s.finishedAt || s.updatedAt).toLocaleDateString('zh-TW')}</td><td>${esc(s.result.symbol || '?')}</td><td>${esc(MARKET_NAME[s.mixed ? 'MIX' : s.market] || s.market)}</td><td>${esc(REGIME_NAME[s.regime] || '—')}</td><td>${esc(s.presetId)}</td>
          <td>${s.result.score}</td><td class="${sign(s.result.actualRet)}">${fmtPct(s.result.actualRet)}</td><td class="${sign(s.result.shadowRet)}">${fmtPct(s.result.shadowRet)}</td><td>${fmtPct(s.result.bhRet)}</td>
          <td>${Object.values(s.result.counts || {}).reduce((a, b) => a + b, 0)}</td><td><button class="btn btn-sm" data-del="${s.id}">刪除</button></td></tr>`).join('')}
      </tbody></table></div>`;
    lineChart($('#hTrend'), [
      { data: list.map((s, i) => ({ x: i, y: s.result.score })), color: '#8B5E3C', title: '分數' },
      { data: list.map((s, i) => ({ x: i, y: s.result.gapPct })), color: '#2563EB', title: 'Shadow−Actual %' },
    ], { xLabel: i => `#${i + 1}` });
    $$('tr[data-id]', body).forEach(tr => tr.onclick = e => { if (!e.target.closest('[data-del]')) location.hash = `#/report/${tr.dataset.id}`; });
    $$('[data-del]', body).forEach(b => b.onclick = async () => { if (confirm('刪除這個 Session？')) { await deleteSession(b.dataset.del); renderHistory(root); } });
  }
}
