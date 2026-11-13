// editor.js — 策略編輯器 (SDD 6.5): preset list, auto-generated parameter
// forms from each plugin's paramsSchema, raw JSON with live validation
// (expression errors show the column), and a preview on a puzzle's context bars.
import { $, $$, esc, toast, download } from './ui.js';
import { allStrategies, strategyById } from './strategies.js';
import { saveCustomStrategy, deleteCustomStrategy, allSessions } from './store.js';
import { INDICATORS, STOPS, SIZING, validateSpec, deepClone, prepare, barsFromPuzzle, simulate, maxWarmup, normalizeSpec } from '../engine/index.js';
import { getPuzzle } from './bank.js';
import { ChartView } from './chart.js';

let chart = null;

export async function renderEditor(root, id) {
  const list = allStrategies();
  let spec = deepClone(strategyById(id || list[0].id));
  const builtin = !!spec.builtin; delete spec.builtin;
  root.innerHTML = `
  <div class="editor">
    <aside class="card">
      <h2>策略</h2>
      <div class="strat-list">${list.map(s => `<button data-id="${esc(s.id)}" class="${s.id === spec.id ? 'on' : ''}">${esc(s.name || s.id)}${s.builtin ? ' <span class="sub">內建</span>' : ''}</button>`).join('')}</div>
      <div class="ctrl" style="margin-top:12px">
        <button class="btn btn-sm" id="eDup">複製一份</button>
        <label class="btn btn-sm">匯入 JSON<input type="file" id="eImp" accept="application/json" hidden></label>
      </div>
    </aside>
    <section class="card">
      <h2>參數 <span class="sub">${builtin ? '內建 preset 唯讀；改完按「另存」會存成自訂策略' : '自訂策略（存在這台裝置）'}</span></h2>
      <div id="eForm"></div>
      <details style="margin-top:10px" open><summary class="sub" style="cursor:pointer">進階：直接編輯 JSON</summary>
        <textarea class="input" id="eJson" rows="22" spellcheck="false" style="margin-top:8px"></textarea>
      </details>
      <div class="ctrl" style="margin-top:10px">
        <button class="btn btn-primary" id="eSave">${builtin ? '另存為自訂策略' : '儲存'}</button>
        <button class="btn btn-sm" id="eExp">匯出 JSON</button>
        ${builtin ? '' : '<button class="btn btn-sm" id="eDel">刪除</button>'}
      </div>
    </section>
    <section class="card ed-preview">
      <h2>驗證 <span id="eOk"></span></h2>
      <ul class="err-list" id="eErr"></ul>
      <h2 style="margin-top:14px">在本題預覽 <span class="sub">只畫背景區（不劇透）</span></h2>
      <div class="chart-main" id="ePrev" style="height:320px"></div>
      <p class="sub" id="ePrevInfo" style="margin-top:6px"></p>
    </section>
  </div>`;
  $$('.strat-list button', root).forEach(b => b.onclick = () => { location.hash = `#/editor/${encodeURIComponent(b.dataset.id)}`; });
  const ta = $('#eJson');
  const setJSON = () => { ta.value = JSON.stringify(spec, null, 2); };
  setJSON(); form(); validate();
  ta.oninput = () => { try { spec = JSON.parse(ta.value); form(); } catch (e) { showErr([{ path: 'JSON', message: e.message }]); return; } validate(); };
  $('#eDup').onclick = () => { spec = { ...deepClone(spec), id: `${spec.id}-copy-${Date.now().toString(36).slice(-4)}`, name: `${spec.name || spec.id}（複製）` }; saveCustomStrategy(spec); location.hash = `#/editor/${encodeURIComponent(spec.id)}`; };
  $('#eSave').onclick = () => {
    const errs = validateSpec(spec);
    if (errs.length) return toast('還有錯誤，先修正再存');
    if (builtin) spec = { ...spec, id: `${spec.id}-my-${Date.now().toString(36).slice(-4)}`, name: `${spec.name || ''}（自訂）` };
    saveCustomStrategy(spec); toast('已儲存');
    location.hash = `#/editor/${encodeURIComponent(spec.id)}`;
  };
  $('#eExp').onclick = () => download(`${spec.id}.json`, JSON.stringify(spec, null, 2));
  $('#eDel') && ($('#eDel').onclick = () => { if (confirm('刪除這個策略？')) { deleteCustomStrategy(spec.id); location.hash = '#/editor'; } });
  $('#eImp').onchange = async e => {
    try { const s = JSON.parse(await e.target.files[0].text()); if (!s.id) throw new Error('缺 id'); saveCustomStrategy(s); location.hash = `#/editor/${encodeURIComponent(s.id)}`; }
    catch (err) { toast(`匯入失敗：${err.message}`); }
  };

  function showErr(errs) {
    $('#eOk').innerHTML = errs.length ? `<span class="tag neg">${errs.length} 個問題</span>` : '<span class="ok-badge">✓ 通過 schema 與條件式檢查</span>';
    $('#eErr').innerHTML = errs.map(e => {
      const src = e.pos != null ? getPath(spec, e.path) : null;
      return `<li><code>${esc(e.path)}</code>：${esc(e.message)}${typeof src === 'string' ? `<span class="caret">${esc(src)}\n${' '.repeat(e.pos)}^</span>` : ''}</li>`;
    }).join('');
  }
  function validate() {
    const errs = validateSpec(spec);
    showErr(errs);
    if (!errs.length) preview();
  }
  function update(path, value) { setPath(spec, path, value); setJSON(); validate(); }

  function form() {
    const f = $('#eForm');
    const num = (path, v, sch = {}) => `<input class="input mono" data-p="${path}" data-t="${sch.type || 'number'}" type="${sch.enum ? 'text' : sch.type === 'boolean' ? 'checkbox' : 'number'}" ${sch.type === 'boolean' ? (v ? 'checked' : '') : `value="${esc(v ?? '')}"`} step="any">`;
    const field = (label, inner) => `<div class="field"><label>${esc(label)}</label>${inner}</div>`;
    const schemaFields = (base, props, params) => Object.entries(props || {}).map(([k, sch]) =>
      field(k, sch.enum ? `<select class="input" data-p="${base}.${k}" data-t="string">${sch.enum.map(o => `<option ${(params?.[k] ?? sch.default) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : sch.type === 'string' ? `<input class="input mono" data-p="${base}.${k}" data-t="string" value="${esc(params?.[k] ?? '')}">`
          : num(`${base}.${k}`, params?.[k] ?? sch.default, sch))).join('');
    const exprIn = (path, v) => `<input class="input mono" data-p="${path}" data-t="string" value="${esc(v ?? '')}" placeholder="條件式">`;
    f.innerHTML = `
      <div class="form-grid">${field('id', `<input class="input mono" data-p="id" data-t="string" value="${esc(spec.id)}">`)}${field('名稱', `<input class="input" data-p="name" data-t="string" value="${esc(spec.name || '')}">`)}</div>
      <h3>指標</h3>
      ${(spec.indicators || []).map((ind, i) => `<div class="blk"><div class="blk-head"><span class="mono">${esc(ind.id)}</span><span class="tag">${esc(INDICATORS[ind.type]?.label || ind.type)}</span><span class="grow"></span><button class="btn btn-sm" data-rm="indicators.${i}">移除</button></div>
        <div class="form-grid">${schemaFields(`indicators.${i}.params`, INDICATORS[ind.type]?.paramsSchema.properties, ind.params)}</div></div>`).join('')}
      <div class="ctrl"><select class="input" id="addInd" style="width:auto">${Object.entries(INDICATORS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select><button class="btn btn-sm" id="addIndBtn">＋ 指標</button></div>
      <h3>進場</h3>
      ${field('entry.signal', exprIn('entry.signal', spec.entry?.signal))}
      <div class="form-grid">${field('cooldownBars', num('entry.cooldownBars', spec.entry?.cooldownBars ?? 0, { type: 'integer' }))}</div>
      <h3>部位大小</h3>
      <div class="form-grid">${field('method', `<select class="input" data-p="sizing.method" data-t="string">${Object.keys(SIZING).map(m => `<option ${spec.sizing?.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
        ${schemaFields('sizing', SIZING[spec.sizing?.method || 'max_loss_amount']?.paramsSchema.properties, spec.sizing)}
        ${field('maxPositionPct', num('sizing.caps.maxPositionPct', spec.sizing?.caps?.maxPositionPct))}${field('maxOpenRiskR', num('sizing.caps.maxOpenRiskR', spec.sizing?.caps?.maxOpenRiskR))}</div>
      <h3>停損（可疊加，有效停損取最高且只上不下）</h3>
      ${(spec.stops || []).map((st, i) => `<div class="blk"><div class="blk-head"><span class="tag">${esc(STOPS[st.type]?.label || st.type)}</span><span class="grow"></span><button class="btn btn-sm" data-rm="stops.${i}">移除</button></div>
        <div class="form-grid">${schemaFields(`stops.${i}.params`, STOPS[st.type]?.paramsSchema.properties, st.params)}</div>${field('activateWhen（選填）', exprIn(`stops.${i}.activateWhen`, st.activateWhen))}</div>`).join('')}
      <div class="ctrl"><select class="input" id="addStop" style="width:auto">${Object.entries(STOPS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select><button class="btn btn-sm" id="addStopBtn">＋ 停損</button></div>
      <h3>出場訊號</h3>
      ${(spec.exitSignals || []).map((x, i) => `<div class="form-grid" style="grid-template-columns:1fr 100px auto">${field('expr', exprIn(`exitSignals.${i}.expr`, x.expr))}${field('fraction', num(`exitSignals.${i}.fraction`, x.fraction ?? 1))}<button class="btn btn-sm" data-rm="exitSignals.${i}" style="align-self:end">移除</button></div>`).join('')}
      <button class="btn btn-sm" id="addExit">＋ 出場訊號</button>
      <h3>加碼</h3>
      <div class="form-grid">${field('enabled', num('pyramiding.enabled', spec.pyramiding?.enabled, { type: 'boolean' }))}${field('maxAdds', num('pyramiding.maxAdds', spec.pyramiding?.maxAdds ?? 0, { type: 'integer' }))}</div>
      ${field('trigger', exprIn('pyramiding.trigger', spec.pyramiding?.trigger))}
      <h3>紀律容忍度</h3>
      <div class="form-grid">${['entryWindowBars', 'chaseAtr', 'sizeTolerancePct', 'stopGraceBars'].map(k => field(k, num(`discipline.${k}`, spec.discipline?.[k]))).join('')}
        ${field('allowDiscretionaryExit', num('discipline.allowDiscretionaryExit', spec.discipline?.allowDiscretionaryExit !== false, { type: 'boolean' }))}
        ${field('fill.mode', `<select class="input" data-p="fill.mode" data-t="string">${['next_open', 'this_close'].map(m => `<option ${spec.fill?.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}</div>`;
    $$('[data-p]', f).forEach(inp => inp.onchange = () => {
      const t = inp.dataset.t;
      const v = t === 'boolean' ? inp.checked : t === 'string' ? inp.value : inp.value === '' ? undefined : t === 'integer' ? parseInt(inp.value, 10) : parseFloat(inp.value);
      update(inp.dataset.p, v === '' && /activateWhen|trigger/.test(inp.dataset.p) ? undefined : v);
      if (inp.dataset.p === 'sizing.method') form();
    });
    $$('[data-rm]', f).forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split('.'); spec[k].splice(+i, 1); setJSON(); form(); validate(); });
    $('#addIndBtn').onclick = () => { const type = $('#addInd').value; let n = 1; while (spec.indicators.some(x => x.id === `${type}${n}`)) n++; spec.indicators.push({ id: `${type}${n}`, type, params: {} }); setJSON(); form(); validate(); };
    $('#addStopBtn').onclick = () => { spec.stops.push({ type: $('#addStop').value, params: {} }); setJSON(); form(); validate(); };
    $('#addExit').onclick = () => { (spec.exitSignals ||= []).push({ expr: 'close < ema20', fraction: 1 }); setJSON(); form(); validate(); };
  }

  async function preview() {
    const playing = (await allSessions()).find(s => s.status === 'playing');
    const pz = await getPuzzle(playing?.puzzleId || 'demo-1');
    const bars = barsFromPuzzle(pz);
    const ns = normalizeSpec(spec);
    const warm = Math.min(maxWarmup(ns.indicators), pz.contextBars - 20);
    let ctx;
    try { ctx = prepare({ bars, spec, market: pz.market, playStart: warm, playEnd: pz.contextBars }); }
    catch (e) { showErr([{ path: 'preview', message: e.message }]); return; }
    const run = simulate(ctx, { mode: 'shadow' });
    chart?.destroy();
    $('#ePrev').innerHTML = '';
    chart = new ChartView($('#ePrev'), document.createElement('div'), null, { playStart: pz.contextBars, spec: ns });
    chart.update({ ctx, t: pz.contextBars - 1, run, hint: 'full' });
    chart.focus(pz.contextBars - 1, pz.contextBars);
    $('#ePrevInfo').textContent = `${playing ? '目前題目' : '示範題'}背景區：${run.signals.length} 個訊號、影子帳戶 ${run.trades.length} 筆交易（warmup ${warm} 根）。`;
  }
}

function getPath(o, p) { return p.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((a, k) => a?.[k], o); }
function setPath(o, p, v) {
  const ks = p.split('.');
  let cur = o;
  ks.slice(0, -1).forEach((k, i) => { if (cur[k] == null) cur[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[k]; });
  const last = ks[ks.length - 1];
  if (v === undefined) delete cur[last]; else cur[last] = v;
}
