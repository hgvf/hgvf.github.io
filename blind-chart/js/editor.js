// editor.js — 策略頁。
//   #/editor        策略總覽：三種類型怎麼選、所有內建策略的題庫回測比較表、通用文獻
//   #/editor/<id>   單一策略：概覽（白話規則、因子）/ 快速調整（旋鈕）/ 完整規則 / 文獻與回測 / JSON
//                   右側固定：驗證、快速回測（按需下載約 40 題樣本）、背景區預覽
// 網站負擔：回測數字來自預先算好的 config/preset-stats.json；快速回測的題目只在按下按鈕後才下載。
import { $, $$, esc, toast, download } from './ui.js';
import { allStrategies } from './strategies.js';
import { saveCustomStrategy, deleteCustomStrategy, allSessions, setSettings } from './store.js';
import {
  INDICATORS, STOPS, SIZING, PRESETS, CATEGORIES, GENERAL_REFERENCES, POS_VARS, ACCT_VARS,
  validateSpec, deepClone, prepare, barsFromPuzzle, simulate, maxWarmup, normalizeSpec, knownSeries, getKnob, setKnob, rng, presetById,
} from '../engine/index.js';
import { backtest } from '../engine/backtest.js';
import { getPuzzle, loadBank } from './bank.js';
import { ChartView } from './chart.js';
import { qm, tip } from './glossary.js';
import { loadPresetStats, sharpeChip, profileChips, backtestTablesHTML, sourceHTML, fmtPct, fmtAbs, fmtNum, fmtR, sgn, REGIME } from './presetstats.js';

const META_KEYS = ['category', 'level', 'idea', 'summary', 'roles', 'knobs', 'source', 'basedOn'];
const TABS = [['overview', '概覽'], ['tune', '快速調整'], ['rules', '完整規則'], ['refs', '文獻與回測'], ['json', 'JSON']];
const CAT_INFO = {
  趨勢跟隨: { idea: '價格已經在走的方向會持續；不預測，只跟隨。', good: '大波段、單邊趨勢', bad: '盤整來回洗（停損一次次被打到）', win: '25–40%，靠少數大賺撐起整體' },
  動能突破: { idea: '強勢股（創新高、波動收斂後放量）傾向繼續強。', good: '強勢股的主升段', bad: '假突破、追高後回落', win: '30–40%' },
  均值回歸: { idea: '多頭結構中的短期超跌會反彈；快進快出。', good: '多頭裡的回檔、盤整', bad: '跌了就不回來的空頭（偶爾一次大虧）', win: '55–75%，每筆賺得少' },
};

let chart = null;
let previewTimer = null;
const QB = { items: null, loading: null, cache: new Map() };     // 快速回測樣本（只在按下按鈕後下載）

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function stratList(list, stats, currentId) {
  const groups = [...CATEGORIES.map(c => [c, list.filter(s => s.builtin && s.category === c)]),
    ['其他內建', list.filter(s => s.builtin && !CATEGORIES.includes(s.category))],
    ['我的策略', list.filter(s => !s.builtin)]].filter(([, l]) => l.length);
  return `
    <aside class="card ed-aside">
      <a class="ed-overview-link${currentId ? '' : ' on'}" href="#/editor">📊 策略總覽與比較</a>
      <select class="input ed-select" id="edSelect">
        <option value="">— 策略總覽 —</option>
        ${groups.map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(s => `<option value="${esc(s.id)}" ${s.id === currentId ? 'selected' : ''}>${esc(s.name || s.id)}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <div class="ed-listwrap">
        <div class="sub" style="margin:8px 0 2px">右側數字 = 題庫 Sharpe ${qm('sharpe')}</div>
        ${groups.map(([g, l]) => `<div class="strat-group">${esc(g)}</div>
        <div class="strat-list">${l.map(s => `<button data-id="${esc(s.id)}" class="${s.id === currentId ? 'on' : ''}"><span>${esc(s.name || s.id)}${s.level === '入門' ? ' <span class="lv">入門</span>' : ''}</span>${sharpeChip(stats, s.builtin ? s.id : s.basedOn)}</button>`).join('')}</div>`).join('')}
      </div>
      <label class="btn btn-sm" style="margin-top:12px">匯入策略 JSON<input type="file" id="eImp" accept="application/json" hidden></label>
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

function bindAside(root, isDirty) {
  const go = h => { if (isDirty && isDirty() && !confirm('目前的調整還沒儲存，確定離開？')) return false; location.hash = h; return true; };
  $$('.strat-list button', root).forEach(b => b.onclick = () => go(`#/editor/${encodeURIComponent(b.dataset.id)}`));
  $('#edSelect', root).onchange = e => { if (!go(e.target.value ? `#/editor/${encodeURIComponent(e.target.value)}` : '#/editor')) e.target.value = ''; };
  $('.ed-overview-link', root).onclick = e => { if (isDirty && isDirty() && !confirm('目前的調整還沒儲存，確定離開？')) e.preventDefault(); };
  $('#eImp', root).onchange = async e => {
    try { const s = JSON.parse(await e.target.files[0].text()); if (!s.id) throw new Error('缺 id'); delete s.builtin; saveCustomStrategy(s); location.hash = `#/editor/${encodeURIComponent(s.id)}`; }
    catch (err) { toast(`匯入失敗：${err.message}`); }
  };
}

// ───────────────────────────── 總覽 ─────────────────────────────
function renderOverview(root, list, stats) {
  const b = stats?.buyHold;
  root.innerHTML = `
  <div class="editor editor-ov">
    ${stratList(list, stats, null)}
    <div class="ed-main">
      <section class="card">
        <h2>策略總覽 <span class="sub">${PRESETS.length} 個內建策略，點進去可以看白話說明、用旋鈕調整、快速回測</span></h2>
        <div class="cat-cards">
          ${CATEGORIES.map(c => {
            const n = PRESETS.filter(p => p.category === c);
            const i = CAT_INFO[c];
            return `<div class="cat-card"><div class="cat-title">${esc(c)} <span class="sub">${n.length} 個</span></div>
              <p>${esc(i.idea)}</p>
              <dl><dt>擅長</dt><dd>${esc(i.good)}</dd><dt>弱點</dt><dd>${esc(i.bad)}</dd><dt>典型勝率</dt><dd>${esc(i.win)}</dd></dl>
              <div class="cat-links">${n.map(p => `<a href="#/editor/${p.id}">${esc(p.name.split('（')[0].split(' + ')[0])}</a>`).join('')}</div></div>`;
          }).join('')}
        </div>
        <div class="callout" style="margin-top:12px">
          <b>建議從「入門」開始</b>：規則少、旋鈕少，容易看懂每個設定的影響。
          <b>怎麼讀數字</b>：比較策略看 <b>Sharpe</b>（不受部位大小影響）。
          單一股票、約一年的題目裡，規則策略的 Sharpe 都低於買進持有（${fmtNum(b?.sharpe)}），因為題庫有 1/3 多頭題目平均年化 ${fmtPct(b?.byRegime?.up?.annReturn, 0)}。
          策略的價值在<b>空頭時少虧</b>：買進持有空頭題目年化 ${fmtPct(b?.byRegime?.down?.annReturn, 0)}、最大回撤中位數 ${fmtAbs(b?.byRegime?.down?.maxDDMedian, 0)}。
        </div>
      </section>

      <section class="card">
        <h2>題庫回測比較 ${qm('shadow')} <span class="sub">${(stats?.puzzles || 0).toLocaleString()} 題 · 點欄位排序 · 點策略名稱進入</span></h2>
        <div class="chips" id="ovCat" style="margin-bottom:10px">
          ${['全部', ...CATEGORIES].map((c, i) => `<button class="chip${i ? '' : ' on'}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
        <div class="tbl-wrap"><table class="tbl ov-tbl" id="ovTbl"></table></div>
        <p class="sub si-note">${esc(stats?.method || '')}</p>
      </section>

      <section class="card">
        <h2>文獻 <span class="sub">策略背後的研究；各策略自己的出處在策略頁的「文獻與回測」</span></h2>
        <ul class="ref-list">${GENERAL_REFERENCES.map(r => `<li><span class="tag">${esc(r.topic)}</span> <b>${esc(r.ref)}</b><br><span class="sub">${esc(r.claim)}</span>${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">連結 ↗</a>` : ''}</li>`).join('')}</ul>
      </section>
    </div>
  </div>`;
  bindAside(root);
  let cat = '全部', sortKey = 'sharpe', dir = -1;
  const cols = [
    ['name', '策略'], ['category', '類型'], ['level', '等級'], ['sharpe', 'Sharpe', 'sharpe'], ['up', '多頭', 'regime'], ['down', '空頭'], ['range', '盤整'],
    ['maxDDMedian', 'MaxDD 中位', 'maxDD'], ['tradesPerPuzzle', '每題交易'], ['avgHoldBars', '平均持有', 'avgHold'], ['winRate', '勝率', 'winRate'], ['expectancyR', '期望值', 'expectancy'], ['profitFactor', 'PF', 'profitFactor'],
  ];
  const val = (p, k) => {
    const s = stats?.presets?.[p.id] || {};
    if (k === 'name' || k === 'category' || k === 'level') return p[k] || '';
    if (['up', 'down', 'range'].includes(k)) return s.byRegime?.[k]?.sharpe ?? -9;
    return s[k] ?? -9;
  };
  const draw = () => {
    const rows = PRESETS.filter(p => cat === '全部' || p.category === cat)
      .sort((a, c) => { const x = val(a, sortKey), y = val(c, sortKey); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
    $('#ovTbl').innerHTML = `<thead><tr>${cols.map(([k, n, t]) => `<th data-k="${k}" class="sortable${k === sortKey ? ' sorted' : ''}">${n}${k === sortKey ? (dir < 0 ? ' ▼' : ' ▲') : ''}${t ? ' ' + qm(t) : ''}</th>`).join('')}</tr></thead>
      <tbody>${b ? `<tr class="bh-row"><td>買進持有（對照）</td><td>—</td><td>—</td><td class="mono">${fmtNum(b.sharpe)}</td>${['up', 'down', 'range'].map(k => `<td class="mono">${fmtNum(b.byRegime?.[k]?.sharpe)}</td>`).join('')}<td class="mono">${fmtAbs(b.maxDDMedian)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>` : ''}
      ${rows.map(p => { const s = stats?.presets?.[p.id] || {}; return `<tr>
        <td><a href="#/editor/${p.id}">${esc(p.name)}</a></td><td>${esc(p.category)}</td><td>${p.level === '入門' ? '<span class="lv">入門</span>' : '進階'}</td>
        <td class="mono ${sgn(s.sharpe)}"><b>${fmtNum(s.sharpe)}</b></td>
        ${['up', 'down', 'range'].map(k => `<td class="mono ${sgn(s.byRegime?.[k]?.sharpe)}">${fmtNum(s.byRegime?.[k]?.sharpe)}</td>`).join('')}
        <td class="mono">${fmtAbs(s.maxDDMedian)}</td><td class="mono">${fmtNum(s.tradesPerPuzzle, 1)}</td><td class="mono">${s.avgHoldBars == null ? '—' : Math.round(s.avgHoldBars) + ' 根'}</td>
        <td class="mono">${fmtAbs(s.winRate, 0)}</td><td class="mono ${sgn(s.expectancyR)}">${fmtR(s.expectancyR)}</td><td class="mono">${fmtNum(s.profitFactor)}</td></tr>`; }).join('')}</tbody>`;
    $$('#ovTbl th.sortable').forEach(th => th.onclick = e => {
      if (e.target.closest('.qm')) return;
      const k = th.dataset.k;
      if (k === sortKey) dir = -dir; else { sortKey = k; dir = ['name', 'category', 'level'].includes(k) ? 1 : -1; }
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
  let tab = lsGet('bc.edTab', 'overview');
  if (!TABS.some(t => t[0] === tab)) tab = 'overview';
  const dirty = () => JSON.stringify(spec) !== JSON.stringify(orig);

  root.innerHTML = `
  <div class="editor">
    ${stratList(list, stats, spec.id)}
    <div class="ed-main">
      <section class="card ed-head">
        <div class="si-head">
          ${spec.category ? `<span class="tag">${esc(spec.category)}</span>` : ''}
          ${spec.level ? `<span class="tag ${spec.level === '入門' ? 'pos' : 'warn'}">${esc(spec.level)}</span>` : ''}
          ${builtin ? '<span class="tag">內建</span>' : `<span class="tag">我的策略${basePreset ? `（改自 ${esc(basePreset.name.split('（')[0])}）` : ''}</span>`}
          <span class="dirty-tag" id="dirtyTag" hidden>● 已調整，尚未儲存</span>
        </div>
        <h2 class="ed-title">${esc(spec.name || spec.id)}</h2>
        ${spec.idea ? `<p class="ed-idea">${esc(spec.idea)}</p>` : ''}
        ${profileChips(baseId, stats)}
        <div class="ctrl ed-actions">
          <button class="btn btn-primary" id="eStart">▶ 用這個策略開始一題</button>
          <button class="btn" id="eSave">${builtin ? '另存為我的策略' : '儲存'}</button>
          <button class="btn" id="eReset" disabled>還原</button>
          <button class="btn btn-sm" id="eDup">複製一份</button>
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
        <h2>驗證 <span id="eOk"></span></h2>
        <ul class="err-list" id="eErr"></ul>
      </section>
      <section class="card">
        <h2>快速回測 ${qm('quickBacktest')}</h2>
        <div id="qbBody"></div>
      </section>
      <section class="card ed-preview">
        <h2>背景區預覽 <span class="sub">不劇透可操作區</span></h2>
        <div class="chart-main" id="ePrev" style="height:280px"></div>
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
    if (builtin) out = { ...out, id: `${spec.id}-my-${Date.now().toString(36).slice(-4)}`, name: `${spec.name || ''}（我的）`, basedOn: spec.id };
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
    const s = { ...deepClone(spec), id: `${spec.id}-copy-${Date.now().toString(36).slice(-4)}`, name: `${spec.name || spec.id}（複製）`, basedOn: baseId || undefined };
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
  const refresh = () => { markDirty(); clearTimeout(previewTimer); previewTimer = setTimeout(() => { validate(); if (QB.items) runQuick(); }, 250); };
  function update(path, value) {
    setPath(spec, path, value);
    refresh();
  }

  // ── 分頁 ──
  function renderTab() {
    const p = $('#edPanel');
    if (tab === 'overview') p.innerHTML = overviewTab();
    else if (tab === 'tune') { p.innerHTML = tuneTab(); bindTune(); }
    else if (tab === 'rules') { p.innerHTML = rulesTab(); bindRules(); }
    else if (tab === 'refs') p.innerHTML = refsTab();
    else { p.innerHTML = jsonTab(); bindJson(); }
  }

  function overviewTab() {
    const sm = spec.summary || {};
    const ns = safeNormalize(spec);
    const step = (n, title, plain, now) => `<div class="flow-step"><div class="flow-n">${n}</div><div class="flow-body"><div class="flow-title">${title}</div>
      ${plain ? `<p>${esc(plain)}</p>` : ''}${now ? `<div class="flow-now"><span class="sub">目前設定</span>${now}</div>` : ''}</div></div>`;
    return `
      ${dirty() && sm.entry ? '<p class="callout" style="margin-bottom:10px">白話說明是以原始設定寫的；你調整過的數值以每段下方的「目前設定」為準。</p>' : ''}
      <div class="flow">
        ${step(1, `進場 ${qm('entry.signal')}`, sm.entry, `<code class="expr">${esc(ns?.entry?.signal || spec.entry?.signal || '')}</code>${spec.entry?.cooldownBars ? `<span class="sub">　出場後冷卻 ${spec.entry.cooldownBars} 根</span>` : ''}`)}
        ${step(2, `部位大小 ${qm('R')}`, sm.sizing, esc(describeSizing(spec)))}
        ${step(3, `停損與停利 ${qm('stops')}`, sm.exit, `<ul class="rule-list">${describeExits(spec, ns).map(x => `<li>${x}</li>`).join('')}</ul>`)}
        ${spec.pyramiding?.enabled ? step(4, `加碼 ${qm('pyramiding')}`, '', esc(describePyramid(spec, ns))) : ''}
      </div>
      <h3>因子（指標）在做什麼</h3>
      <div class="tbl-wrap"><table class="tbl fac-tbl"><thead><tr><th>代號</th><th>指標</th><th>參數</th><th>在這個策略的作用</th></tr></thead><tbody>
        ${(spec.indicators || []).map(ind => `<tr><td class="mono">${esc(ind.id)}</td><td>${esc(INDICATORS[ind.type]?.label || ind.type)} ${qm(ind.type)}</td>
          <td class="mono">${esc(Object.entries(ind.params || {}).map(([k, v]) => `${k}=${v}`).join(' ') || '預設')}</td><td>${esc(spec.roles?.[ind.id] || '')}</td></tr>`).join('')}
      </tbody></table></div>
      ${Object.keys(spec.vars || {}).length ? `<h3>策略變數 ${qm('vars')}</h3><p class="sub">條件式裡的 <code>$名稱</code> 會換成下面的數值，可在「快速調整」改。</p>
        <div class="chips">${Object.entries(spec.vars).map(([k, v]) => `<span class="tag mono">$${esc(k)} = ${esc(v)}</span>`).join('')}</div>` : ''}
      <p class="sub" style="margin-top:12px">想改數值 → 「快速調整」；想改規則結構（加指標、換停損）→ 「完整規則」。</p>`;
  }

  function tuneTab() {
    const knobs = spec.knobs || basePreset?.knobs || [];
    if (!knobs.length) return '<p class="empty">這個策略沒有預設旋鈕，請到「完整規則」直接改。</p>';
    const ref = basePreset && !builtin ? basePreset : orig;
    return `
      <p class="sub" style="margin-bottom:10px">拖動或輸入數值，右側的驗證、預覽與快速回測會跟著更新。每個旋鈕下面寫了它在做什麼與預設值；改過的會標成橘色，按 ↺ 還原單一項。</p>
      <div class="knobs">${knobs.map((k, i) => knobRow(k, i, getKnob(spec, k.path), getKnob(ref, k.path))).join('')}</div>`;
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

  function rulesTab() {
    const num = (path, v, sch = {}) => `<input class="input mono" data-p="${path}" data-t="${sch.type || 'number'}" type="${sch.type === 'boolean' ? 'checkbox' : 'number'}" ${sch.type === 'boolean' ? (v ? 'checked' : '') : `value="${esc(v ?? '')}"`} step="any">`;
    const field = (label, inner, key = label, scope) => `<div class="field"><span class="lbl">${esc(label)} ${qm(key, scope)}</span>${inner}</div>`;
    const schemaFields = (base, props, params) => { const scope = base.startsWith('stops') ? 'stop' : base.split('.')[0]; return Object.entries(props || {}).map(([k, sch]) =>
      field(k, sch.enum ? `<select class="input" data-p="${base}.${k}" data-t="string">${sch.enum.map(o => `<option ${(params?.[k] ?? sch.default) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : sch.type === 'string' ? `<input class="input mono" data-p="${base}.${k}" data-t="string" value="${esc(params?.[k] ?? '')}">`
          : num(`${base}.${k}`, params?.[k] ?? sch.default, sch), k, scope)).join(''); };
    const exprIn = (path, v) => `<input class="input mono expr-in" data-p="${path}" data-t="string" value="${esc(v ?? '')}" placeholder="條件式">`;
    const sec = (title, intro, body) => `<div class="rule-sec"><h3>${title}</h3><p class="sec-intro">${intro}</p>${body}</div>`;
    const known = [...knownSeries(safeNormalize(spec) || spec)].filter(n => !['benchmark'].includes(n));
    return `
      <p class="sub" style="margin-bottom:8px">這裡可以改策略的每一條規則。條件式欄位點一下後，可以從最下面的「條件式小抄」點選變數插入。</p>
      ${sec('名稱', '', `<div class="form-grid">${field('id', `<input class="input mono" data-p="id" data-t="string" value="${esc(spec.id)}" ${builtin ? 'disabled' : ''}>`)}${field('名稱', `<input class="input" data-p="name" data-t="string" value="${esc(spec.name || '')}">`, 'name')}</div>`)}
      ${sec(`指標（因子） ${qm('expr')}`, '策略用到的技術指標。每個指標有一個代號（id），條件式用代號引用它，例如 <code>ema20</code>、<code>dc20.upper</code>。',
        `${(spec.indicators || []).map((ind, i) => `<div class="blk"><div class="blk-head"><span class="mono">${esc(ind.id)}</span><span class="tag">${esc(INDICATORS[ind.type]?.label || ind.type)}</span>${qm(ind.type)}<span class="sub">${esc(spec.roles?.[ind.id] || '')}</span><span class="grow"></span><button class="btn btn-sm" data-rm="indicators.${i}">移除</button></div>
          <div class="form-grid">${schemaFields(`indicators.${i}.params`, INDICATORS[ind.type]?.paramsSchema.properties, ind.params)}</div></div>`).join('')}
        <div class="ctrl"><select class="input" id="addInd" style="width:auto">${Object.entries(INDICATORS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select><button class="btn btn-sm" id="addIndBtn">＋ 指標</button></div><p class="sub" id="addIndTip" style="margin-top:4px"></p>`)}
      ${sec(`策略變數 ${qm('vars')}`, '條件式裡寫 <code>$名稱</code>，就會換成這裡的數字。把門檻做成變數，就能在「快速調整」用旋鈕改。',
        `<div class="vars-grid">${Object.entries(spec.vars || {}).map(([k, v]) => `<div class="var-row"><span class="mono">$${esc(k)}</span><input class="input mono" data-var="${esc(k)}" type="number" step="any" value="${esc(v)}"><button class="btn btn-sm" data-rmvar="${esc(k)}">移除</button></div>`).join('') || '<p class="sub">（沒有變數）</p>'}</div>
        <div class="ctrl"><input class="input mono" id="newVarName" placeholder="名稱，例 th" style="width:140px"><input class="input mono" id="newVarVal" type="number" step="any" placeholder="數值" style="width:100px"><button class="btn btn-sm" id="addVar">＋ 變數</button></div>`)}
      ${sec(`進場 ${qm('entry.signal')}`, '條件式在某根 K 棒收盤後成立就是「進場訊號」，預設下一根開盤買進。',
        `${field('進場條件式', exprIn('entry.signal', spec.entry?.signal), 'entry.signal')}
        <div class="form-grid">${field('出場後冷卻（根）', num('entry.cooldownBars', spec.entry?.cooldownBars ?? 0, { type: 'integer' }), 'cooldownBars')}
        ${field('成交方式', `<select class="input" data-p="fill.mode" data-t="string">${[['next_open', '下一根開盤'], ['this_close', '當根收盤']].map(([m, n]) => `<option value="${m}" ${spec.fill?.mode === m ? 'selected' : ''}>${n}</option>`).join('')}</select>`, 'fill.mode')}</div>`)}
      ${sec(`部位大小 ${qm('R')}`, '決定每筆買幾股。多數策略用「每筆風險固定」：股數 = 願意虧的錢 ÷ 停損距離，所以停損越近買越多。',
        `<div class="form-grid">${field('方法', `<select class="input" data-p="sizing.method" data-t="string">${Object.entries(SIZING).map(([m, p]) => `<option value="${m}" ${spec.sizing?.method === m ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`, 'method')}
          ${schemaFields('sizing', SIZING[spec.sizing?.method || 'max_loss_amount']?.paramsSchema.properties, spec.sizing)}</div>
        <p class="sub" style="margin:-4px 0 10px">${esc(tip(spec.sizing?.method || 'max_loss_amount') || '')}</p>
        <div class="form-grid">${field('單筆市值上限（0–1）', num('sizing.caps.maxPositionPct', spec.sizing?.caps?.maxPositionPct), 'maxPositionPct')}${field('總風險上限（R）', num('sizing.caps.maxOpenRiskR', spec.sizing?.caps?.maxOpenRiskR), 'maxOpenRiskR')}</div>`)}
      ${sec(`停損（可疊加） ${qm('stops')}`, '每一條停損都會算出一條線，系統取最高（最保護）的那條，而且只往上移、不往下。加「啟動條件」可以讓某條停損在賺到一定程度後才生效。',
        `${(spec.stops || []).map((st, i) => `<div class="blk"><div class="blk-head"><span class="tag">${esc(STOPS[st.type]?.label || st.type)}</span>${qm(st.type)}<span class="grow"></span><button class="btn btn-sm" data-rm="stops.${i}">移除</button></div>
          <p class="sub" style="margin-bottom:6px">${esc(tip(st.type) || '')}</p>
          <div class="form-grid">${schemaFields(`stops.${i}.params`, STOPS[st.type]?.paramsSchema.properties, st.params)}</div>${field('啟動條件（選填）', exprIn(`stops.${i}.activateWhen`, st.activateWhen), 'activateWhen')}</div>`).join('')}
        <div class="ctrl"><select class="input" id="addStop" style="width:auto">${Object.entries(STOPS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select><button class="btn btn-sm" id="addStopBtn">＋ 停損</button></div><p class="sub" id="addStopTip" style="margin-top:4px"></p>`)}
      ${sec(`分批停利 ${qm('targets')}`, '價格碰到目標時先賣掉一部分，鎖住獲利；剩下的交給移動停損。',
        `${(spec.targets || []).map((t, i) => `<div class="form-grid" style="grid-template-columns:repeat(3,minmax(0,1fr)) auto">
          ${field('目標（R）', num(`targets.${i}.at.r`, t.at?.r), 'R')}${field('賣出比例（0–1）', num(`targets.${i}.fraction`, t.fraction), 'fraction')}<span></span><button class="btn btn-sm" data-rm="targets.${i}" style="align-self:end">移除</button></div>`).join('')}
        <button class="btn btn-sm" id="addTarget">＋ 停利目標</button>`)}
      ${sec(`出場訊號 ${qm('exitSignals')}`, '條件式成立就在下一根開盤賣出（例如跌破均線、反向交叉）。跟停損不同，它不是盤中觸價。',
        `${(spec.exitSignals || []).map((x, i) => `<div class="form-grid" style="grid-template-columns:1fr 110px auto">${field('條件式', exprIn(`exitSignals.${i}.expr`, x.expr), 'expr')}${field('賣出比例', num(`exitSignals.${i}.fraction`, x.fraction ?? 1), 'fraction')}<button class="btn btn-sm" data-rm="exitSignals.${i}" style="align-self:end">移除</button></div>`).join('')}
        <button class="btn btn-sm" id="addExit">＋ 出場訊號</button>`)}
      ${sec(`加碼 ${qm('pyramiding')}`, '只在部位賺錢時順勢加碼。虧損中加碼（攤平）在遊戲裡會被判違規。',
        `<div class="form-grid">${field('啟用', num('pyramiding.enabled', spec.pyramiding?.enabled, { type: 'boolean' }), 'enabled')}${field('最多加碼次數', num('pyramiding.maxAdds', spec.pyramiding?.maxAdds ?? 0, { type: 'integer' }), 'maxAdds')}</div>
        ${field('加碼條件式', exprIn('pyramiding.trigger', spec.pyramiding?.trigger), 'trigger', 'pyramiding')}`)}
      ${sec(`紀律容忍度 ${qm('discipline')}`, '遊戲裡什麼情況算違規。只影響紀律分數，不影響影子帳戶。',
        `<div class="form-grid">${[['entryWindowBars', '訊號後幾根內進場算合規'], ['chaseAtr', '追價容忍（ATR）'], ['sizeTolerancePct', '股數容忍（%）'], ['stopGraceBars', '停損寬限（根）']].map(([k, n]) => field(n, num(`discipline.${k}`, spec.discipline?.[k]), k)).join('')}
          ${field('允許自行提早出場', num('discipline.allowDiscretionaryExit', spec.discipline?.allowDiscretionaryExit !== false, { type: 'boolean' }), 'allowDiscretionaryExit')}</div>`)}
      <details class="cheat"><summary>條件式小抄（點一下插入到游標所在的條件式）</summary>
        <div class="cheat-sec"><b>這個策略可用的序列</b><div class="cheat-chips">${known.map(n => `<button class="chip-sm mono" data-ins="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>
        <div class="cheat-sec"><b>部位 / 帳戶</b><div class="cheat-chips">${[...POS_VARS.map(v => 'pos.' + v), ...ACCT_VARS.map(v => 'acct.' + v)].map(n => `<button class="chip-sm mono" data-ins="${n}">${n}</button>`).join('')}</div></div>
        <div class="cheat-sec"><b>函數</b><div class="cheat-chips">${['cross_up(a, b)', 'cross_down(a, b)', 'rising(x, 5)', 'falling(x, 5)', 'highest(x, 20)', 'lowest(x, 20)', 'min(a, b)', 'max(a, b)', 'abs(x)'].map(n => `<button class="chip-sm mono" data-ins="${n}">${n}</button>`).join('')}</div></div>
        <p class="sub">往前取值：<code>close[1]</code> = 前一根收盤。運算：<code>+ − * /</code>、<code>&gt; &lt; &gt;= &lt;= == !=</code>、<code>and or not</code>。策略變數用 <code>$名稱</code>。</p>
      </details>`;
  }
  function bindRules() {
    const p = $('#edPanel');
    let lastExpr = null;
    $$('.expr-in', p).forEach(inp => inp.addEventListener('focus', () => { lastExpr = inp; }));
    $$('[data-p]', p).forEach(inp => inp.onchange = () => {
      const t = inp.dataset.t;
      let v = t === 'boolean' ? inp.checked : t === 'string' ? inp.value : inp.value === '' ? undefined : t === 'integer' ? parseInt(inp.value, 10) : parseFloat(inp.value);
      if (v === '' && /activateWhen|trigger/.test(inp.dataset.p)) v = undefined;
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
    const syncTips = () => { $('#addIndTip').textContent = tip($('#addInd').value) || ''; $('#addStopTip').textContent = tip($('#addStop').value) || ''; };
    $('#addInd').onchange = $('#addStop').onchange = syncTips; syncTips();
    $('#addIndBtn').onclick = () => { const type = $('#addInd').value; let n = 1; while (spec.indicators.some(x => x.id === `${type}${n}`)) n++; spec.indicators.push({ id: `${type}${n}`, type, params: {} }); refresh(); renderTab(); };
    $('#addStopBtn').onclick = () => { spec.stops.push({ type: $('#addStop').value, params: {} }); refresh(); renderTab(); };
    $('#addTarget').onclick = () => { (spec.targets ||= []).push({ at: { r: 2 }, fraction: 0.5 }); refresh(); renderTab(); };
    $('#addExit').onclick = () => { (spec.exitSignals ||= []).push({ expr: 'close < ' + (spec.indicators.find(x => /ma$/.test(x.type))?.id || 'close[1]'), fraction: 1 }); refresh(); renderTab(); };
    $$('[data-ins]', p).forEach(b => b.onclick = () => {
      if (!lastExpr) return toast('先點一下要插入的條件式欄位');
      const s = lastExpr.selectionStart ?? lastExpr.value.length, e = lastExpr.selectionEnd ?? s;
      lastExpr.value = lastExpr.value.slice(0, s) + b.dataset.ins + lastExpr.value.slice(e);
      lastExpr.focus(); lastExpr.setSelectionRange(s + b.dataset.ins.length, s + b.dataset.ins.length);
      lastExpr.dispatchEvent(new Event('change'));
    });
  }

  function refsTab() {
    return `
      <h3>出處</h3>
      ${sourceHTML(basePreset && !builtin ? { source: basePreset.source } : spec)}
      ${backtestTablesHTML(baseId, stats)}
      ${!builtin && basePreset ? '<p class="sub">↑ 是原版內建策略的數字；你調整後的版本請用右側「快速回測」。</p>' : ''}
      <h3>延伸閱讀</h3>
      <ul class="ref-list">${GENERAL_REFERENCES.map(r => `<li><span class="tag">${esc(r.topic)}</span> ${esc(r.ref)}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">↗</a>` : ''}<br><span class="sub">${esc(r.claim)}</span></li>`).join('')}</ul>`;
  }

  function jsonTab() {
    const rules = Object.fromEntries(Object.entries(spec).filter(([k]) => !META_KEYS.includes(k)));
    return `<p class="sub" style="margin-bottom:8px">只顯示規則欄位（說明、旋鈕等中繼資料會自動保留）。可以直接貼上別人分享的策略 JSON。</p>
      <textarea class="input" id="eJson" rows="26" spellcheck="false">${esc(JSON.stringify(rules, null, 2))}</textarea>
      <div class="ctrl" style="margin-top:8px"><button class="btn btn-sm" id="eExp">匯出完整 JSON</button></div>`;
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
    $('#eOk').innerHTML = errs.length ? `<span class="tag neg">${errs.length} 個問題</span>` : '<span class="ok-badge">✓ 規則都有效</span>';
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
    $('#ePrevInfo').textContent = `${playing ? '目前題目' : bank.demo ? '示範題' : '題庫中的一題'}背景區：${run.signals.length} 個訊號、影子帳戶 ${run.trades.length} 筆交易。`
      + (need > pz.contextBars - 20 ? `這個策略的指標需要約 ${need} 根暖機，背景區（${pz.contextBars} 根）幾乎看不到訊號，請用快速回測看效果。` : '');
  }

  // ── 快速回測 ──
  function qbIdle() {
    $('#qbBody').innerHTML = `<p class="sub">在題庫挑 42 題代表性樣本（多頭 / 空頭 / 盤整各 14 題）跑影子帳戶，比較「目前設定」「原版」「買進持有」。第一次會下載約 1 MB 的題目，之後調整旋鈕會自動重算。</p>
      <button class="btn btn-primary" id="qbRun" style="margin-top:8px">執行快速回測</button>`;
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
          const b = $('#qbBody'); if (b) b.innerHTML = `<p class="sub">下載樣本題目… ${done} / 42</p><div class="progress"><i style="width:${done / 42 * 100}%"></i></div>`;
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
    if (validateSpec(spec).length) { box.innerHTML = '<p class="sub">規則有錯誤，修正後才能回測。</p>'; return; }
    const t0 = performance.now();
    const cur = backtest(QB.items, spec);
    const cached = key => { if (!QB.cache.has(key)) QB.cache.set(key, backtest(QB.items, key === 'bh' ? 'buyhold' : (presetById(key) || orig))); return QB.cache.get(key); };
    const base = basePreset ? cached(basePreset.id) : null;
    const bh = cached('bh');
    const ms = performance.now() - t0;
    const cols = [['目前設定', cur], ...(base && dirty() || base && !builtin ? [['原版', base]] : []), ['買進持有', bh]];
    const row = (name, f, key, colored) => `<tr><td>${name}</td>${cols.map(([, s]) => `<td class="mono ${colored ? sgn(key(s)) : ''}">${f(key(s))}</td>`).join('')}</tr>`;
    box.innerHTML = `
      <div class="tbl-wrap"><table class="tbl si-tbl">
        <thead><tr><th></th>${cols.map(([n]) => `<th>${n}</th>`).join('')}</tr></thead>
        <tbody>
          ${row('Sharpe', x => fmtNum(x), s => s.sharpe, true)}
          ${row('平均年化', x => fmtPct(x), s => s.annReturn, true)}
          ${row('MaxDD 中位', x => fmtAbs(x), s => s.maxDDMedian)}
          ${row('每題交易', x => fmtNum(x, 1), s => s.tradesPerPuzzle)}
          ${row('勝率', x => fmtAbs(x, 0), s => s.winRate)}
          ${row('期望值', fmtR, s => s.expectancyR, true)}
          ${row('多頭 Sharpe', x => fmtNum(x), s => s.byRegime?.up?.sharpe, true)}
          ${row('空頭 Sharpe', x => fmtNum(x), s => s.byRegime?.down?.sharpe, true)}
          ${row('盤整 Sharpe', x => fmtNum(x), s => s.byRegime?.range?.sharpe, true)}
        </tbody></table></div>
      <p class="sub" style="margin-top:6px">${QB.items.length} 題樣本 · ${ms.toFixed(0)} ms。樣本小、數字會跳動，看大方向就好；完整 ${(stats?.puzzles || 0).toLocaleString()} 題的結果在「文獻與回測」。</p>`;
  }

  renderTab();
  markDirty();
  validate();
  if (QB.items) runQuick(); else qbIdle();
}

// ───────────────────────────── 白話描述（依目前設定自動產生） ─────────────────────────────
function safeNormalize(spec) { try { return normalizeSpec(spec); } catch { return null; } }
const num = (x, d = 2) => (Number.isFinite(+x) ? String(+(+x).toFixed(d)) : String(x));
const pct = x => `${num(x * 100, 2)}%`;

function describeSizing(spec) {
  const s = spec.sizing || {}, c = s.caps || {};
  const m = {
    max_loss_amount: `每筆最多虧 ${num(s.amount ?? 10000, 0)} 點：股數 = ${num(s.amount ?? 10000, 0)} ÷ 停損距離`,
    risk_percent: `每筆最多虧帳戶 ${pct(s.pct ?? 0.01)}：股數 = 權益 × ${pct(s.pct ?? 0.01)} ÷ 停損距離`,
    total_cost: `每筆投入 ${num(s.cost, 0)} 點`,
    percent_equity: `每筆投入帳戶 ${pct(s.pct ?? 0.2)}`,
    fixed_shares: `每筆固定 ${num(s.shares, 0)} 股`,
    vol_target: `波動度目標：股數 = 權益 × ${pct(s.targetVolPct ?? 0.01)} ÷ ATR`,
  }[s.method] || s.method;
  const caps = [c.maxPositionPct != null ? `單筆市值 ≤ ${pct(c.maxPositionPct)}` : '', c.maxOpenRiskR != null ? `總風險 ≤ ${c.maxOpenRiskR}R` : '', c.cashOnly !== false ? '不融資' : ''].filter(Boolean);
  return m + (caps.length ? `；${caps.join('、')}` : '');
}
function describeStop(st, ns) {
  const p = st.params || {};
  const atr = p.atrId || 'ATR';
  const d = {
    atr_initial: `初始停損：進場價 − ${num(p.k ?? 2)} × ${atr}`,
    pct_initial: `初始停損：進場價 × (1 − ${pct(p.p ?? 0.08)})`,
    structure: `結構停損：${p.swingId || 'swing'} 波段低點${p.bufferAtr ? ` − ${num(p.bufferAtr)} × ${atr}` : ''}${p.bufferPct ? ` − ${pct(p.bufferPct)}` : ''}`,
    atr_trailing: `ATR 移動停損：收盤 − ${num(p.k ?? 3)} × ${atr}`,
    chandelier: `Chandelier：進場後最高價 − ${num(p.k ?? 3)} × ${atr}`,
    ma_trailing: `均線移動停損：${(p.trigger ?? 'close') === 'close' ? '收盤跌破' : '盤中碰到'} ${p.maId}${p.bufferAtr ? ` − ${num(p.bufferAtr)} × ${atr}` : ''}${p.bufferPct ? ` × (1 − ${pct(p.bufferPct)})` : ''} 就出場`,
    donchian_trailing: `N 日低點：跌破最近 ${p.length ?? 10} 根最低價就出場`,
    breakeven: `保本：賺到 ${num(p.atR ?? 1)}R 後停損移到均價`,
    step_r: `階梯：每賺 ${num(p.stepR ?? 1)}R，停損上移 ${num(p.moveR ?? 1)}R`,
    time_stop: (p.minR ?? 0.5) >= 50 ? `時間停損：持有滿 ${p.bars ?? 20} 根就出場` : `時間停損：持有 ${p.bars ?? 20} 根仍沒賺到 ${num(p.minR ?? 0.5)}R 就出場`,
  }[st.type] || st.type;
  const act = ns?.stops?.find(x => x === st || (x.type === st.type && JSON.stringify(x.params) === JSON.stringify(st.params)))?.activateWhen || st.activateWhen;
  return esc(d) + (act ? `　<span class="sub">（<code>${esc(act)}</code> 之後才生效）</span>` : '');
}
function describeExits(spec, ns) {
  const out = (spec.stops || []).map(st => describeStop(st, ns));
  (spec.targets || []).forEach(t => out.push(esc(`分批停利：到 ${t.at?.r != null ? `進場價 + ${num(t.at.r)}R` : t.at?.atr != null ? `進場價 + ${num(t.at.atr)} ATR` : t.at?.expr} 賣出 ${pct(t.fraction ?? 1)}`)));
  (ns?.exitSignals || spec.exitSignals || []).forEach(x => out.push(`出場訊號：<code>${esc(x.expr)}</code> 成立就賣出 ${esc(pct(x.fraction ?? 1))}`));
  return out;
}
function describePyramid(spec, ns) {
  const p = spec.pyramiding || {};
  const size = p.size?.mode === 'pyramid_decreasing' ? `依次遞減（×${p.size?.value ?? 0.5}）` : p.size?.mode === 'risk_based' ? `以新停損距離加 ${p.size?.value ?? 0.5}R 風險` : `每次加初始部位的 ${pct(p.size?.value ?? 0.5)}`;
  return `最多 ${p.maxAdds ?? 0} 次；條件 ${ns?.pyramiding?.trigger || p.trigger}；${size}${p.onAdd?.moveStop?.type === 'breakeven' ? '；加碼後停損移到均價' : ''}${p.riskCap?.maxOpenRiskR != null ? `；總風險 ≤ ${p.riskCap.maxOpenRiskR}R` : ''}`;
}

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
    <div class="knob-head"><span class="knob-label">${esc(k.label)}</span><span class="knob-val mono">${fmtKnob(k, v)}</span></div>
    <div class="knob-ctrl">
      <input type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}" aria-label="${esc(k.label)}">
      <input class="input mono knob-num" type="number" step="${k.pct ? +(k.step * 100).toFixed(4) : k.step}" value="${toDisp(k, v)}" aria-label="${esc(k.label)} 數值">
      <span class="knob-unit">${k.pct ? '%' : k.fmt === 'x' ? '倍' : esc(k.unit || '')}</span>
      <button class="btn btn-sm knob-reset" ${changed ? '' : 'disabled'} title="還原預設">↺</button>
    </div>
    <div class="knob-help">${esc(k.help || '')}${k.help ? '　' : ''}<span class="muted">預設 ${fmtKnob(k, def)}，範圍 ${fmtKnob(k, k.min)} ～ ${fmtKnob(k, k.max)}</span></div>
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
