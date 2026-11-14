// editor.js — 策略頁。
//   #/editor        總覽：三種類型、所有內建策略的題庫回測比較
//   #/editor/<id>   單一策略：規則 / 調整 / 進階編輯 / 回測 / JSON；右側：快速回測、背景區預覽
// 網站負擔：回測數字來自預先算好的 config/preset-stats.json；快速回測的題目只在按下按鈕後才下載。
import { $, $$, esc, toast, download } from './ui.js';
import { allStrategies } from './strategies.js';
import { saveCustomStrategy, deleteCustomStrategy, allSessions, setSettings } from './store.js';
import {
  INDICATORS, STOPS, SIZING, PRESETS, CATEGORIES, POS_VARS, ACCT_VARS,
  validateSpec, deepClone, prepare, barsFromPuzzle, simulate, maxWarmup, normalizeSpec, knownSeries, getKnob, setKnob, rng, presetById,
} from '../engine/index.js';
import { backtest } from '../engine/backtest.js';
import { getPuzzle, loadBank } from './bank.js';
import { ChartView } from './chart.js';
import { qm, qmText } from './glossary.js';
import { loadPresetStats, statLine, backtestTablesHTML, fmtPct, fmtAbs, fmtNum, sgn } from './presetstats.js';
import { shortName, rulesBlock, prettyJson } from './describe.js';

const META_KEYS = ['short', 'category', 'level', 'idea', 'plain', 'roles', 'knobs', 'basedOn'];
const TABS = [['rules', '規則'], ['tune', '調整'], ['edit', '進階編輯'], ['bt', '回測'], ['json', 'JSON']];
const CAT_INFO = {
  趨勢跟隨: { idea: '跟著已經在走的方向，不猜頂底。', good: '大波段、單邊行情', bad: '盤整來回洗', win: '25–40%' },
  動能突破: { idea: '強的股票傾向繼續強。', good: '主升段', bad: '假突破、追高', win: '30–40%' },
  均值回歸: { idea: '多頭裡的短線急跌常會彈回來，快進快出。', good: '多頭回檔、盤整', bad: '一路跌的空頭', win: '55–75%' },
};

let chart = null;
let previewTimer = null;
const QB = { items: null, loading: null, cache: new Map() };     // 快速回測樣本（只在按下按鈕後下載）

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function stratList(list, currentId, page) {
  const groups = [...CATEGORIES.map(c => [c, list.filter(s => s.builtin && s.category === c)]),
    ['其他', list.filter(s => s.builtin && !CATEGORIES.includes(s.category))],
    ['我的策略', list.filter(s => !s.builtin)]].filter(([, l]) => l.length);
  return `
    <aside class="card ed-aside">
      <a class="ed-nav${page === 'overview' ? ' on' : ''}" href="#/editor">策略總覽</a>
      <a class="ed-nav${page === 'guide' ? ' on' : ''}" href="#/guide">JSON 寫法</a>
      <select class="input ed-select" id="edSelect">
        <option value="">— 選策略 —</option>
        ${groups.map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(s => `<option value="${esc(s.id)}" ${s.id === currentId ? 'selected' : ''}>${esc(shortName(s))}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <div class="ed-listwrap">
        ${groups.map(([g, l]) => `<div class="strat-group">${esc(g)}</div>
        <div class="strat-list">${l.map(s => `<button data-id="${esc(s.id)}" class="${s.id === currentId ? 'on' : ''}">${esc(shortName(s))}</button>`).join('')}</div>`).join('')}
      </div>
      <label class="btn btn-sm ed-imp">匯入策略 JSON<input type="file" id="eImp" accept="application/json" hidden></label>
    </aside>`;
}

export async function renderEditor(root, id) {
  const stats = await loadPresetStats();
  const list = allStrategies();
  if (!id) return renderOverview(root, list, stats);
  const found = list.find(s => s.id === id);
  if (!found) { location.hash = '#/editor'; return; }
  return renderStrategy(root, list, stats, deepClone(found));
}

export function bindAside(root, isDirty) {
  const go = h => { if (isDirty && isDirty() && !confirm('目前的調整還沒儲存，確定離開？')) return false; location.hash = h; return true; };
  $$('.strat-list button', root).forEach(b => b.onclick = () => go(`#/editor/${encodeURIComponent(b.dataset.id)}`));
  $('#edSelect', root).onchange = e => { if (!go(e.target.value ? `#/editor/${encodeURIComponent(e.target.value)}` : '#/editor')) e.target.value = ''; };
  $$('.ed-nav', root).forEach(a => a.onclick = e => { if (isDirty && isDirty() && !confirm('目前的調整還沒儲存，確定離開？')) e.preventDefault(); });
  $('#eImp', root).onchange = async e => {
    try { const s = JSON.parse(await e.target.files[0].text()); if (!s.id) throw new Error('缺 id'); delete s.builtin; saveCustomStrategy(s); location.hash = `#/editor/${encodeURIComponent(s.id)}`; }
    catch (err) { toast(`匯入失敗：${err.message}`); }
  };
}
export { stratList };

// ───────────────────────────── 總覽 ─────────────────────────────
function renderOverview(root, list, stats) {
  const b = stats?.buyHold;
  root.innerHTML = `
  <div class="editor editor-ov">
    ${stratList(list, null, 'overview')}
    <div class="ed-main">
      <section class="card">
        <h2>策略總覽</h2>
        <div class="cat-cards">
          ${CATEGORIES.map(c => {
            const n = PRESETS.filter(p => p.category === c);
            const i = CAT_INFO[c];
            return `<div class="cat-card"><div class="cat-title">${esc(c)}</div>
              <p>${esc(i.idea)}</p>
              <dl><dt>擅長</dt><dd>${esc(i.good)}</dd><dt>怕</dt><dd>${esc(i.bad)}</dd><dt>勝率</dt><dd>${esc(i.win)}</dd></dl>
              <div class="cat-links">${n.map(p => `<a href="#/editor/${p.id}">${esc(p.short)}</a>`).join('')}</div></div>`;
          }).join('')}
        </div>
      </section>

      <section class="card">
        <h2>題庫回測 ${qm('shadow')} <span class="sub">${(stats?.puzzles || 0).toLocaleString()} 題</span></h2>
        <div class="chips" id="ovCat" style="margin-bottom:10px">
          ${['全部', ...CATEGORIES].map((c, i) => `<button class="chip${i ? '' : ' on'}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
        <div class="tbl-wrap"><table class="tbl ov-tbl" id="ovTbl"></table></div>
      </section>
    </div>
  </div>`;
  bindAside(root);
  let cat = '全部', sortKey = 'sharpe', dir = -1;
  const cols = [
    ['name', '策略'], ['category', '類型'], ['sharpe', 'Sharpe', 'sharpe'], ['up', '多頭', 'regime'], ['down', '空頭'], ['range', '盤整'],
    ['maxDDMedian', '最大回撤', 'maxDD'], ['winRate', '勝率', 'winRate'], ['tradesPerPuzzle', '每題交易'], ['avgHoldBars', '平均持有', 'avgHold'],
  ];
  const val = (p, k) => {
    const s = stats?.presets?.[p.id] || {};
    if (k === 'name') return p.short || '';
    if (k === 'category') return p.category || '';
    if (['up', 'down', 'range'].includes(k)) return s.byRegime?.[k]?.sharpe ?? -9;
    return s[k] ?? -9;
  };
  const draw = () => {
    const rows = PRESETS.filter(p => cat === '全部' || p.category === cat)
      .sort((a, c) => { const x = val(a, sortKey), y = val(c, sortKey); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
    $('#ovTbl').innerHTML = `<thead><tr>${cols.map(([k, n, t]) => `<th data-k="${k}" class="sortable${k === sortKey ? ' sorted' : ''}">${n}${k === sortKey ? (dir < 0 ? ' ▼' : ' ▲') : ''}${t ? ' ' + qm(t) : ''}</th>`).join('')}</tr></thead>
      <tbody>${b ? `<tr class="bh-row"><td>買進持有</td><td>—</td><td class="mono">${fmtNum(b.sharpe)}</td>${['up', 'down', 'range'].map(k => `<td class="mono">${fmtNum(b.byRegime?.[k]?.sharpe)}</td>`).join('')}<td class="mono">${fmtAbs(b.maxDDMedian)}</td><td>—</td><td>—</td><td>—</td></tr>` : ''}
      ${rows.map(p => { const s = stats?.presets?.[p.id] || {}; return `<tr>
        <td><a href="#/editor/${p.id}">${esc(p.short)}</a></td><td>${esc(p.category)}</td>
        <td class="mono ${sgn(s.sharpe)}"><b>${fmtNum(s.sharpe)}</b></td>
        ${['up', 'down', 'range'].map(k => `<td class="mono ${sgn(s.byRegime?.[k]?.sharpe)}">${fmtNum(s.byRegime?.[k]?.sharpe)}</td>`).join('')}
        <td class="mono">${fmtAbs(s.maxDDMedian)}</td><td class="mono">${fmtAbs(s.winRate, 0)}</td><td class="mono">${fmtNum(s.tradesPerPuzzle, 1)}</td>
        <td class="mono">${s.avgHoldBars == null ? '—' : Math.round(s.avgHoldBars) + ' 根'}</td></tr>`; }).join('')}</tbody>`;
    $$('#ovTbl th.sortable').forEach(th => th.onclick = e => {
      if (e.target.closest('.qm')) return;
      const k = th.dataset.k;
      if (k === sortKey) dir = -dir; else { sortKey = k; dir = ['name', 'category'].includes(k) ? 1 : -1; }
      draw();
    });
  };
  $('#ovCat').onclick = e => { const c = e.target.closest('[data-c]'); if (!c) return; cat = c.dataset.c; $$('#ovCat .chip').forEach(x => x.classList.toggle('on', x === c)); draw(); };
  draw();
}

// ───────────────────────────── 單一策略 ─────────────────────────────
function renderStrategy(root, list, stats, loaded) {
  const builtin = !!loaded.builtin; delete loaded.builtin;
  let spec = deepClone(loaded);
  const orig = deepClone(loaded);                           // 還原點
  const baseId = builtin ? spec.id : spec.basedOn;          // 原版內建策略（若有）
  const basePreset = baseId ? presetById(baseId) : null;
  let tab = lsGet('bc.edTab', 'rules');
  if (!TABS.some(t => t[0] === tab)) tab = 'rules';
  const dirty = () => JSON.stringify(spec) !== JSON.stringify(orig);

  root.innerHTML = `
  <div class="editor">
    ${stratList(list, spec.id)}
    <div class="ed-main">
      <section class="card ed-head">
        <div class="si-head">
          ${spec.category ? `<span class="tag">${esc(spec.category)}</span>` : ''}
          ${builtin ? '' : `<span class="tag">我的策略${basePreset ? `・改自 ${esc(basePreset.short)}` : ''}</span>`}
          <span id="eOk"></span>
          <span class="dirty-tag" id="dirtyTag" hidden>● 已調整，還沒儲存</span>
        </div>
        <h2 class="ed-title">${esc(shortName(spec))}</h2>
        ${spec.idea ? `<p class="ed-idea">${esc(spec.idea)}</p>` : ''}
        ${statLine(baseId, stats)}
        <ul class="err-list" id="eErr"></ul>
        <div class="ctrl ed-actions">
          <button class="btn btn-primary" id="eStart">▶ 用這個策略開始</button>
          <button class="btn" id="eSave">${builtin ? '另存為我的策略' : '儲存'}</button>
          <button class="btn" id="eReset" disabled>還原</button>
          <button class="btn btn-sm" id="eDup">複製</button>
          ${builtin ? '' : '<button class="btn btn-sm" id="eDel">刪除</button>'}
        </div>
      </section>
      <section class="card">
        <nav class="ed-tabs" id="edTabs">${TABS.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</nav>
        <div id="edPanel"></div>
      </section>
    </div>
    <div class="ed-side">
      <section class="card">
        <h2>快速回測 ${qm('quickBacktest')}</h2>
        <div id="qbBody"></div>
      </section>
      <section class="card ed-preview">
        <h2>預覽 <span class="sub">背景區</span></h2>
        <div class="chart-main" id="ePrev" style="height:260px"></div>
        <p class="sub" id="ePrevInfo" style="margin-top:6px"></p>
      </section>
    </div>
  </div>`;
  bindAside(root, dirty);

  // ── 動作 ──
  const markDirty = () => { const d = dirty(); $('#dirtyTag').hidden = !d; $('#eReset').disabled = !d; };
  const save = () => {
    const errs = validateSpec(spec);
    if (errs.length) { toast('還有錯誤，先修正再存'); return null; }
    let out = deepClone(spec);
    if (builtin) out = { ...out, id: `${spec.id}-my-${Date.now().toString(36).slice(-4)}`, name: `${spec.name || ''}（我的）`, short: `${spec.short || shortName(spec)}（我的）`, basedOn: spec.id };
    saveCustomStrategy(out);
    return out;
  };
  $('#eSave').onclick = () => { const s = save(); if (!s) return; toast('已儲存'); location.hash = `#/editor/${encodeURIComponent(s.id)}`; };
  $('#eStart').onclick = () => {
    let useId = spec.id;
    if (dirty() || !builtin && !list.some(s => s.id === spec.id)) { const s = save(); if (!s) return; useId = s.id; toast(builtin ? '已另存為我的策略' : '已儲存'); }
    setSettings({ presetId: useId });
    location.hash = '#/setup';
  };
  $('#eReset').onclick = () => { spec = deepClone(orig); markDirty(); renderTab(); refresh(); };
  $('#eDup').onclick = () => {
    const s = { ...deepClone(spec), id: `${spec.id}-copy-${Date.now().toString(36).slice(-4)}`, name: `${spec.name || spec.id}（複製）`, short: `${shortName(spec)}（複製）`, basedOn: baseId || undefined };
    saveCustomStrategy(s); location.hash = `#/editor/${encodeURIComponent(s.id)}`;
  };
  $('#eDel') && ($('#eDel').onclick = () => { if (confirm('刪除這個策略？')) { deleteCustomStrategy(spec.id); location.hash = '#/editor'; } });
  $('#edTabs').onclick = e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    tab = b.dataset.t; lsSet('bc.edTab', tab);
    $$('#edTabs button').forEach(x => x.classList.toggle('on', x === b));
    renderTab();
  };

  // ── 共用：規則變動後 ──
  const refresh = () => { markDirty(); clearTimeout(previewTimer); previewTimer = setTimeout(() => { validate(); if (QB.items) runQuick(); if (tab === 'rules') renderTab(); }, 250); };
  function update(path, value) {
    setPath(spec, path, value);
    refresh();
  }

  // ── 分頁 ──
  function renderTab() {
    const p = $('#edPanel');
    if (tab === 'rules') p.innerHTML = rulesTab();
    else if (tab === 'tune') { p.innerHTML = tuneTab(); bindTune(); }
    else if (tab === 'edit') { p.innerHTML = editTab(); bindEdit(); }
    else if (tab === 'bt') p.innerHTML = btTab();
    else { p.innerHTML = jsonTab(); bindJson(); }
  }

  function rulesTab() {
    const inds = spec.indicators || [];
    return `
      ${rulesBlock(spec)}
      ${inds.length ? `<h3>用到的指標</h3>
      <ul class="ind-list">${inds.map(ind => `<li><code>${esc(ind.id)}</code><span>${esc(INDICATORS[ind.type]?.label || ind.type)} ${qm(ind.type)}</span><span class="sub">${esc(spec.roles?.[ind.id] || '')}</span></li>`).join('')}</ul>` : ''}`;
  }

  function tuneTab() {
    const knobs = spec.knobs || basePreset?.knobs || [];
    if (!knobs.length) return '<p class="empty">這個策略沒有旋鈕，到「進階編輯」直接改。</p>';
    const ref = basePreset && !builtin ? basePreset : orig;
    return `<div class="knobs">${knobs.map((k, i) => knobRow(k, i, getKnob(spec, k.path), getKnob(ref, k.path))).join('')}</div>`;
  }
  function bindTune() {
    const knobs = spec.knobs || basePreset?.knobs || [];
    const ref = basePreset && !builtin ? basePreset : orig;
    $$('.knob').forEach(row => {
      const k = knobs[+row.dataset.k];
      const rg = $('input[type=range]', row), nb = $('.knob-num', row), rs = $('.knob-reset', row), lbl = $('.knob-val', row);
      const def = getKnob(ref, k.path);
      const apply = (v, from) => {
        v = clampStep(v, k);
        setKnob(spec, k.path, v);
        if (from !== 'range') rg.value = v;
        if (from !== 'num') nb.value = toDisp(k, v);
        lbl.textContent = fmtKnob(k, v);
        const changed = Math.abs(v - def) > 1e-12;
        row.classList.toggle('changed', changed); rs.disabled = !changed;
        refresh();
      };
      rg.oninput = () => apply(+rg.value, 'range');
      nb.onchange = () => { const x = parseFloat(nb.value); if (Number.isFinite(x)) apply(fromDisp(k, x), 'num'); };
      rs.onclick = () => apply(def);
    });
  }

  function editTab() {
    const num = (path, v, sch = {}) => `<input class="input mono" data-p="${path}" data-t="${sch.type || 'number'}" type="${sch.type === 'boolean' ? 'checkbox' : 'number'}" ${sch.type === 'boolean' ? (v ? 'checked' : '') : `value="${esc(v ?? '')}"`} step="any">`;
    const field = (label, inner, key = label, scope) => `<div class="field"><span class="lbl">${esc(label)} ${qm(key, scope)}</span>${inner}</div>`;
    const schemaFields = (base, props, params) => { const scope = base.startsWith('stops') ? 'stop' : base.split('.')[0]; return Object.entries(props || {}).map(([k, sch]) =>
      field(k, sch.enum ? `<select class="input" data-p="${base}.${k}" data-t="string">${sch.enum.map(o => `<option ${(params?.[k] ?? sch.default) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : sch.type === 'string' ? `<input class="input mono" data-p="${base}.${k}" data-t="string" value="${esc(params?.[k] ?? '')}">`
          : num(`${base}.${k}`, params?.[k] ?? sch.default, sch), k, scope)).join(''); };
    const exprIn = (path, v) => `<input class="input mono expr-in" data-p="${path}" data-t="string" value="${esc(v ?? '')}" placeholder="條件式">`;
    const sec = (title, body) => `<div class="rule-sec"><h3>${title}</h3>${body}</div>`;
    const known = [...knownSeries(safeNormalize(spec) || spec)].filter(n => !['benchmark'].includes(n));
    return `
      <p class="sub" style="margin-bottom:10px"><a class="link" href="#/guide">每個欄位怎麼填 →</a></p>
      ${sec('名稱', `<div class="form-grid">${field('id', `<input class="input mono" data-p="id" data-t="string" value="${esc(spec.id)}" ${builtin ? 'disabled' : ''}>`)}${field('名稱', `<input class="input" data-p="name" data-t="string" value="${esc(spec.name || '')}">`, 'name')}${field('短名稱', `<input class="input" data-p="short" data-t="string" value="${esc(spec.short || '')}">`, 'short')}</div>`)}
      ${sec(`指標 ${qm('expr')}`,
        `${(spec.indicators || []).map((ind, i) => `<div class="blk"><div class="blk-head"><span class="mono">${esc(ind.id)}</span><span class="tag">${esc(INDICATORS[ind.type]?.label || ind.type)}</span>${qm(ind.type)}<span class="grow"></span><button class="btn btn-sm" data-rm="indicators.${i}">移除</button></div>
          <div class="form-grid">${schemaFields(`indicators.${i}.params`, INDICATORS[ind.type]?.paramsSchema.properties, ind.params)}</div></div>`).join('')}
        <div class="ctrl"><select class="input" id="addInd" style="width:auto">${Object.entries(INDICATORS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select><button class="btn btn-sm" id="addIndBtn">＋ 指標</button></div>`)}
      ${sec(`策略變數 ${qm('vars')}`,
        `<div class="vars-grid">${Object.entries(spec.vars || {}).map(([k, v]) => `<div class="var-row"><span class="mono">$${esc(k)}</span><input class="input mono" data-var="${esc(k)}" type="number" step="any" value="${esc(v)}"><button class="btn btn-sm" data-rmvar="${esc(k)}">移除</button></div>`).join('') || '<p class="sub">（沒有）</p>'}</div>
        <div class="ctrl"><input class="input mono" id="newVarName" placeholder="名稱，例 th" style="width:140px"><input class="input mono" id="newVarVal" type="number" step="any" placeholder="數值" style="width:100px"><button class="btn btn-sm" id="addVar">＋ 變數</button></div>`)}
      ${sec(`買進 ${qm('entry.signal')}`,
        `${field('買進條件', exprIn('entry.signal', spec.entry?.signal), 'entry.signal')}
        <div class="form-grid">${field('賣出後冷卻（根）', num('entry.cooldownBars', spec.entry?.cooldownBars ?? 0, { type: 'integer' }), 'cooldownBars')}
        ${field('成交方式', `<select class="input" data-p="fill.mode" data-t="string">${[['next_open', '下一根開盤'], ['this_close', '當根收盤']].map(([m, n]) => `<option value="${m}" ${spec.fill?.mode === m ? 'selected' : ''}>${n}</option>`).join('')}</select>`, 'fill.mode')}</div>`)}
      ${sec(`部位大小 ${qm('R')}`,
        `<div class="form-grid">${field('方法', `<select class="input" data-p="sizing.method" data-t="string">${Object.entries(SIZING).map(([m, p]) => `<option value="${m}" ${spec.sizing?.method === m ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`, 'method')}
          ${schemaFields('sizing', SIZING[spec.sizing?.method || 'max_loss_amount']?.paramsSchema.properties, spec.sizing)}</div>
        <div class="form-grid" style="margin-top:8px">${field('單筆市值上限（0–1）', num('sizing.caps.maxPositionPct', spec.sizing?.caps?.maxPositionPct), 'maxPositionPct')}${field('總風險上限（R）', num('sizing.caps.maxOpenRiskR', spec.sizing?.caps?.maxOpenRiskR), 'maxOpenRiskR')}</div>`)}
      ${sec(`停損 ${qm('stops')}`,
        `${(spec.stops || []).map((st, i) => `<div class="blk"><div class="blk-head"><span class="tag">${esc(STOPS[st.type]?.label || st.type)}</span>${qm(st.type)}<span class="grow"></span><button class="btn btn-sm" data-rm="stops.${i}">移除</button></div>
          <div class="form-grid">${schemaFields(`stops.${i}.params`, STOPS[st.type]?.paramsSchema.properties, st.params)}</div>${field('啟動條件（選填）', exprIn(`stops.${i}.activateWhen`, st.activateWhen), 'activateWhen')}</div>`).join('')}
        <div class="ctrl"><select class="input" id="addStop" style="width:auto">${Object.entries(STOPS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select><button class="btn btn-sm" id="addStopBtn">＋ 停損</button></div>`)}
      ${sec(`分批停利 ${qm('targets')}`,
        `${(spec.targets || []).map((t, i) => `<div class="form-grid" style="grid-template-columns:repeat(3,minmax(0,1fr)) auto">
          ${field('目標（R）', num(`targets.${i}.at.r`, t.at?.r), 'R')}${field('賣出比例（0–1）', num(`targets.${i}.fraction`, t.fraction), 'fraction')}<span></span><button class="btn btn-sm" data-rm="targets.${i}" style="align-self:end">移除</button></div>`).join('')}
        <button class="btn btn-sm" id="addTarget">＋ 停利</button>`)}
      ${sec(`賣出條件 ${qm('exitSignals')}`,
        `${(spec.exitSignals || []).map((x, i) => `<div class="form-grid" style="grid-template-columns:1fr 110px auto">${field('條件', exprIn(`exitSignals.${i}.expr`, x.expr), 'expr')}${field('賣出比例', num(`exitSignals.${i}.fraction`, x.fraction ?? 1), 'fraction')}<button class="btn btn-sm" data-rm="exitSignals.${i}" style="align-self:end">移除</button></div>`).join('')}
        <button class="btn btn-sm" id="addExit">＋ 賣出條件</button>`)}
      ${sec(`加碼 ${qm('pyramiding')}`,
        `<div class="form-grid">${field('啟用', num('pyramiding.enabled', spec.pyramiding?.enabled, { type: 'boolean' }), 'enabled')}${field('最多加碼次數', num('pyramiding.maxAdds', spec.pyramiding?.maxAdds ?? 0, { type: 'integer' }), 'maxAdds')}</div>
        ${field('加碼條件', exprIn('pyramiding.trigger', spec.pyramiding?.trigger), 'trigger', 'pyramiding')}`)}
      ${sec(`違規判定 ${qm('discipline')}`,
        `<div class="form-grid">${[['entryWindowBars', '訊號後幾根內買都算'], ['chaseAtr', '追價容忍（ATR）'], ['sizeTolerancePct', '股數容忍（%）'], ['stopGraceBars', '停損寬限（根）']].map(([k, n]) => field(n, num(`discipline.${k}`, spec.discipline?.[k]), k)).join('')}
          ${field('可以自己提早賣', num('discipline.allowDiscretionaryExit', spec.discipline?.allowDiscretionaryExit !== false, { type: 'boolean' }), 'allowDiscretionaryExit')}</div>`)}
      <details class="cheat"><summary>條件式小抄（先點一下條件欄位，再點這裡的項目插入）</summary>
        <div class="cheat-sec"><b>這個策略可用的序列</b><div class="cheat-chips">${known.map(n => `<button class="chip-sm mono" data-ins="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>
        <div class="cheat-sec"><b>部位 / 帳戶</b><div class="cheat-chips">${[...POS_VARS.map(v => 'pos.' + v), ...ACCT_VARS.map(v => 'acct.' + v)].map(n => `<button class="chip-sm mono" data-ins="${n}">${n}</button>`).join('')}</div></div>
        <div class="cheat-sec"><b>函數</b><div class="cheat-chips">${['cross_up(a, b)', 'cross_down(a, b)', 'rising(x, 5)', 'falling(x, 5)', 'highest(x, 20)', 'lowest(x, 20)', 'min(a, b)', 'max(a, b)', 'abs(x)'].map(n => `<button class="chip-sm mono" data-ins="${n}">${n}</button>`).join('')}</div></div>
      </details>`;
  }
  function bindEdit() {
    const p = $('#edPanel');
    let lastExpr = null;
    $$('.expr-in', p).forEach(inp => inp.addEventListener('focus', () => { lastExpr = inp; }));
    $$('[data-p]', p).forEach(inp => inp.onchange = () => {
      const t = inp.dataset.t;
      let v = t === 'boolean' ? inp.checked : t === 'string' ? inp.value : inp.value === '' ? undefined : t === 'integer' ? parseInt(inp.value, 10) : parseFloat(inp.value);
      if (v === '' && /activateWhen|trigger|short/.test(inp.dataset.p)) v = undefined;
      update(inp.dataset.p, v);
      if (inp.dataset.p === 'sizing.method') renderTab();
    });
    $$('[data-rm]', p).forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split('.'); spec[k].splice(+i, 1); refresh(); renderTab(); });
    $$('[data-var]', p).forEach(inp => inp.onchange = () => { spec.vars[inp.dataset.var] = parseFloat(inp.value); refresh(); });
    $$('[data-rmvar]', p).forEach(b => b.onclick = () => { delete spec.vars[b.dataset.rmvar]; refresh(); renderTab(); });
    $('#addVar').onclick = () => {
      const k = $('#newVarName').value.trim(), v = parseFloat($('#newVarVal').value);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || !Number.isFinite(v)) return toast('名稱用英數與底線、數值要是數字');
      spec.vars = { ...(spec.vars || {}), [k]: v }; refresh(); renderTab();
    };
    $('#addIndBtn').onclick = () => { const type = $('#addInd').value; let n = 1; while (spec.indicators.some(x => x.id === `${type}${n}`)) n++; spec.indicators.push({ id: `${type}${n}`, type, params: {} }); refresh(); renderTab(); };
    $('#addStopBtn').onclick = () => { spec.stops.push({ type: $('#addStop').value, params: {} }); refresh(); renderTab(); };
    $('#addTarget').onclick = () => { (spec.targets ||= []).push({ at: { r: 2 }, fraction: 0.5 }); refresh(); renderTab(); };
    $('#addExit').onclick = () => { (spec.exitSignals ||= []).push({ expr: 'close < ' + (spec.indicators.find(x => /ma$/.test(x.type))?.id || 'close[1]'), fraction: 1 }); refresh(); renderTab(); };
    $$('[data-ins]', p).forEach(b => b.onclick = () => {
      if (!lastExpr) return toast('先點一下要插入的條件欄位');
      const s = lastExpr.selectionStart ?? lastExpr.value.length, e = lastExpr.selectionEnd ?? s;
      lastExpr.value = lastExpr.value.slice(0, s) + b.dataset.ins + lastExpr.value.slice(e);
      lastExpr.focus(); lastExpr.setSelectionRange(s + b.dataset.ins.length, s + b.dataset.ins.length);
      lastExpr.dispatchEvent(new Event('change'));
    });
  }

  function btTab() {
    return `${backtestTablesHTML(baseId, stats)}
      ${!builtin && basePreset ? '<p class="sub" style="margin-top:8px">這是原版的數字；調整後的版本看右邊的快速回測。</p>' : ''}`;
  }

  function jsonTab() {
    const rules = Object.fromEntries(Object.entries(spec).filter(([k]) => !META_KEYS.includes(k)));
    return `<textarea class="input" id="eJson" rows="24" spellcheck="false">${esc(prettyJson(rules))}</textarea>
      <div class="ctrl" style="margin-top:8px"><button class="btn btn-sm" id="eExp">匯出 JSON</button><a class="link" href="#/guide">JSON 寫法 →</a></div>`;
  }
  function bindJson() {
    $('#eJson').oninput = () => {
      try {
        const parsed = JSON.parse($('#eJson').value);
        const meta = Object.fromEntries(META_KEYS.filter(k => spec[k] !== undefined).map(k => [k, spec[k]]));
        spec = { ...meta, ...parsed };
        if (builtin) spec.id = orig.id;
        refresh();
      } catch (e) { showErr([{ path: 'JSON', message: e.message }]); }
    };
    $('#eExp').onclick = () => download(`${spec.id}.json`, JSON.stringify(spec, null, 2));
  }

  // ── 驗證 / 預覽 ──
  function showErr(errs) {
    $('#eOk').innerHTML = errs.length ? `<span class="tag neg">${errs.length} 個錯誤</span>` : '<span class="ok-badge">✓ 規則有效</span>';
    const ns = safeNormalize(spec);
    $('#eErr').innerHTML = errs.map(e => {
      const src = e.pos != null ? getPath(ns || spec, e.path) : null;
      return `<li><code>${esc(e.path)}</code>：${esc(e.message)}${typeof src === 'string' ? `<span class="caret">${esc(src)}\n${' '.repeat(e.pos)}^</span>` : ''}</li>`;
    }).join('');
  }
  function validate() {
    const errs = validateSpec(spec);
    showErr(errs);
    if (!errs.length) preview();
    return errs;
  }
  async function preview() {
    const playing = (await allSessions()).find(s => s.status === 'playing');
    const bank = await loadBank();
    const pick = playing?.puzzleId || (bank.demo ? 'demo-1' : bank.index[[...(baseId || spec.id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % bank.index.length].id);
    const pz = await getPuzzle(pick);
    const bars = barsFromPuzzle(pz);
    const ns = normalizeSpec(spec);
    const warm = Math.min(maxWarmup(ns.indicators), pz.contextBars - 20);
    let ctx;
    try { ctx = prepare({ bars, spec, market: pz.market, playStart: warm, playEnd: pz.contextBars }); }
    catch (e) { showErr([{ path: 'preview', message: e.message }]); return; }
    const run = simulate(ctx, { mode: 'shadow' });
    chart?.destroy();
    const el = $('#ePrev'); if (!el) return;
    el.innerHTML = '';
    chart = new ChartView(el, document.createElement('div'), null, { playStart: pz.contextBars, spec: ns });
    chart.update({ ctx, t: pz.contextBars - 1, run, hint: 'full' });
    chart.focus(pz.contextBars - 1, pz.contextBars);
    const need = maxWarmup(ns.indicators);
    $('#ePrevInfo').textContent = need > pz.contextBars - 20 ? `指標要約 ${need} 根才算得出來，背景區太短，看快速回測。`
      : `${run.signals.length} 個買訊、${run.trades.length} 筆交易`;
  }

  // ── 快速回測 ──
  function qbIdle() {
    $('#qbBody').innerHTML = `<button class="btn btn-primary" id="qbRun">跑 42 題樣本</button>
      <p class="sub" style="margin-top:6px">第一次會下載約 1 MB 題目</p>`;
    $('#qbRun').onclick = async () => { await loadSample(); runQuick(); };
  }
  async function loadSample() {
    if (QB.items) return;
    if (!QB.loading) QB.loading = (async () => {
      const bank = await loadBank();
      let ids;
      if (bank.demo) ids = Array.from({ length: 42 }, (_, i) => `demo-${i + 1}`);
      else {
        const r = rng('quick-sample-v1');
        const pool = bank.index.filter(p => p.playBars === 250);
        ids = [];
        for (const reg of ['up', 'down', 'range']) {
          const g = pool.filter(p => p.regime === reg);
          for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; }
          ids.push(...g.slice(0, 14).map(p => p.id));
        }
      }
      const items = [];
      let done = 0;
      const worker = async () => {
        while (ids.length) {
          const id = ids.shift();
          try { const pz = await getPuzzle(id); items.push({ puzzle: pz, meta: { regime: pz.tags?.regime, market: pz.market } }); } catch { /* skip */ }
          done++;
          const b = $('#qbBody'); if (b) b.innerHTML = `<p class="sub">下載題目 ${done} / 42</p><div class="progress"><i style="width:${done / 42 * 100}%"></i></div>`;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      items.sort((a, b) => (a.puzzle.id < b.puzzle.id ? -1 : 1));
      QB.items = items;
    })();
    await QB.loading;
  }
  function runQuick() {
    const box = $('#qbBody'); if (!box || !QB.items) return;
    if (validateSpec(spec).length) { box.innerHTML = '<p class="sub">規則有錯，修正後才能回測。</p>'; return; }
    const t0 = performance.now();
    const cur = backtest(QB.items, spec);
    const cached = key => { if (!QB.cache.has(key)) QB.cache.set(key, backtest(QB.items, key === 'bh' ? 'buyhold' : (presetById(key) || orig))); return QB.cache.get(key); };
    const base = basePreset ? cached(basePreset.id) : null;
    const bh = cached('bh');
    const ms = performance.now() - t0;
    const cols = [['目前', cur], ...(base && dirty() || base && !builtin ? [['原版', base]] : []), ['買進持有', bh]];
    const row = (name, f, key, colored) => `<tr><td>${name}</td>${cols.map(([, s]) => `<td class="mono ${colored ? sgn(key(s)) : ''}">${f(key(s))}</td>`).join('')}</tr>`;
    box.innerHTML = `
      <div class="tbl-wrap"><table class="tbl si-tbl">
        <thead><tr><th></th>${cols.map(([n]) => `<th>${n}</th>`).join('')}</tr></thead>
        <tbody>
          ${row('Sharpe', x => fmtNum(x), s => s.sharpe, true)}
          ${row('平均年化', x => fmtPct(x), s => s.annReturn, true)}
          ${row('最大回撤', x => fmtAbs(x), s => s.maxDDMedian)}
          ${row('每題交易', x => fmtNum(x, 1), s => s.tradesPerPuzzle)}
          ${row('勝率', x => fmtAbs(x, 0), s => s.winRate)}
          ${row('多頭 Sharpe', x => fmtNum(x), s => s.byRegime?.up?.sharpe, true)}
          ${row('空頭 Sharpe', x => fmtNum(x), s => s.byRegime?.down?.sharpe, true)}
          ${row('盤整 Sharpe', x => fmtNum(x), s => s.byRegime?.range?.sharpe, true)}
        </tbody></table></div>
      <p class="sub" style="margin-top:6px">${QB.items.length} 題 · ${ms.toFixed(0)} ms</p>`;
  }

  renderTab();
  markDirty();
  validate();
  if (QB.items) runQuick(); else qbIdle();
}

function safeNormalize(spec) { try { return normalizeSpec(spec); } catch { return null; } }
const num = (x, d = 2) => (Number.isFinite(+x) ? String(+(+x).toFixed(d)) : String(x));

// ───────────────────────────── 旋鈕顯示 ─────────────────────────────
const decimals = s => { const t = String(s); return t.includes('.') ? t.split('.')[1].length : 0; };
const toDisp = (k, v) => (k.pct ? +(v * 100).toFixed(Math.max(0, decimals(k.step) - 2)) : v);
const fromDisp = (k, x) => (k.pct ? x / 100 : x);
function clampStep(v, k) {
  v = Math.min(k.max, Math.max(k.min, v));
  const n = Math.round((v - k.min) / k.step);
  return +(k.min + n * k.step).toFixed(Math.max(decimals(k.step), decimals(k.min)) + 2);
}
function fmtKnob(k, v) {
  if (v == null || !Number.isFinite(+v)) return '—';
  if (k.pct) return `${toDisp(k, v)}%`;
  if (k.fmt === 'x') return `× ${num(v, 3)}`;
  return `${num(v, 3)}${k.unit ? ` ${k.unit}` : ''}`;
}
function knobRow(k, i, v, def) {
  const changed = Number.isFinite(v) && Number.isFinite(def) && Math.abs(v - def) > 1e-12;
  return `<div class="knob${changed ? ' changed' : ''}" data-k="${i}">
    <div class="knob-head"><span class="knob-label">${esc(k.label)}</span>${qmText(k.help)}<span class="knob-val mono">${fmtKnob(k, v)}</span></div>
    <div class="knob-ctrl">
      <input type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}" aria-label="${esc(k.label)}">
      <input class="input mono knob-num" type="number" step="${k.pct ? +(k.step * 100).toFixed(4) : k.step}" value="${toDisp(k, v)}" aria-label="${esc(k.label)} 數值">
      <span class="knob-unit">${k.pct ? '%' : k.fmt === 'x' ? '倍' : esc(k.unit || '')}</span>
      <button class="btn btn-sm knob-reset" ${changed ? '' : 'disabled'} title="還原成 ${esc(fmtKnob(k, def))}">↺</button>
    </div>
  </div>`;
}

function getPath(o, p) { return p.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((a, k) => a?.[k], o); }
function setPath(o, p, v) {
  const ks = p.split('.');
  let cur = o;
  ks.slice(0, -1).forEach((k, i) => { if (cur[k] == null) cur[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[k]; });
  const last = ks[ks.length - 1];
  if (v === undefined) delete cur[last]; else cur[last] = v;
}
