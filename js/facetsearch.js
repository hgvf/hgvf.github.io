// facetsearch.js — 可重用的 2×2 多維複選搜尋 sector（nested / faceted search）。
// 用於 ETL 分頁：於數個維度上複選條件，同一維度內為「或」、不同維度之間為
// 「且」；每個維度的候選筆數依「其他維度目前的選取」即時計算。軍武合約、
// 軍武動態、產業動態三頁共用同一套邏輯與外觀。
//
// 用法：
//   const state = makeFacetState();               // 於模組層建立一次，保存選取
//   renderFacetSearch(hostEl, state, {
//     title, intro,                                // 標題與說明（可省略）
//     facets: [{ key, title, placeholder, values(e)=>[], label(v)=>str }, …],
//     getEvents: () => EVENTS,
//     keyOf: (e) => id,
//     renderRow: (e) => `<div class="df-crow" data-open="…">…</div>`,
//     onOpen: (e) => void,
//     summary: (rows) => str,                      // 右上摘要（可省略）
//     emptyHint: str,                              // 未選任何條件時的提示（可省略）
//   });
import { esc } from "./reports.js";

export function makeFacetState() {
  return { sel: {}, q: {} };  // sel[key] = Set<value>；q[key] = 篩選字串
}

export function renderFacetSearch(host, state, cfg) {
  if (!host) return;
  const facets = cfg.facets.slice(0, 4);
  facets.forEach(f => { state.sel[f.key] ||= new Set(); if (state.q[f.key] == null) state.q[f.key] = ""; });

  host.innerHTML = `
    <details class="df-anacard df-search"${state.open ? " open" : ""}>
      <summary class="df-anacard-head df-search-toggle">
        <h4>${esc(cfg.title || "多維複選搜尋")}</h4>
        <span class="df-meta" data-fs="summary"></span>
      </summary>
      <p class="df-meta df-chart-hint">${cfg.intro || "於下列維度<b>複選</b>條件：同一維度內為「或」、不同維度之間為「且」（nested search）。各維度旁數字為<b>在其他條件下</b>符合的筆數。"}</p>
      <div class="df-search-grid">
        ${facets.map(f => `
          <div class="df-facet" data-facet="${esc(f.key)}">
            <div class="df-facet-head"><span class="df-facet-title">${esc(f.title)}</span><button class="df-facet-clear" data-clear="${esc(f.key)}" hidden>清除</button></div>
            <input class="df-facet-filter df-input" data-q="${esc(f.key)}" placeholder="${esc(f.placeholder || "篩選…")}" value="${esc(state.q[f.key])}" />
            <div class="df-facet-chips" data-chips="${esc(f.key)}"></div>
          </div>`).join("")}
      </div>
      <div class="df-search-results" data-fs="results"></div>
    </details>`;

  // 記住展開/收合狀態（預設收合），使切換分頁後重繪能保留使用者的選擇。
  const det = host.querySelector("details.df-search");
  if (det) det.addEventListener("toggle", () => { state.open = det.open; });

  const facetByKey = Object.fromEntries(facets.map(f => [f.key, f]));

  // 某事件是否符合「除了 exceptKey 以外」的所有維度選取。
  const matchesExcept = (e, exceptKey) => {
    for (const f of facets) {
      if (f.key === exceptKey) continue;
      const sel = state.sel[f.key];
      if (!sel.size) continue;
      const vals = f.values(e) || [];
      if (!vals.some(v => sel.has(v))) return false;
    }
    return true;
  };
  const matchesAll = e => matchesExcept(e, null);

  function facetOptions(f) {
    const pool = cfg.getEvents().filter(e => matchesExcept(e, f.key));
    const counts = new Map();
    pool.forEach(e => (f.values(e) || []).forEach(v => { if (v != null && v !== "") counts.set(v, (counts.get(v) || 0) + 1); }));
    state.sel[f.key].forEach(v => { if (!counts.has(v)) counts.set(v, 0); });  // 保留已選、目前 0 筆者
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: f.label ? f.label(value) : value, count }))
      .sort((a, b) => (b.count - a.count) || String(a.label).localeCompare(String(b.label)));
  }

  function renderChips(f) {
    const box = host.querySelector(`[data-chips="${f.key}"]`);
    if (!box) return;
    const sel = state.sel[f.key], q = (state.q[f.key] || "").toLowerCase();
    let opts = facetOptions(f);
    if (q) opts = opts.filter(o => String(o.label).toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q));
    const anySel = sel.size > 0;
    if (!opts.length) box.innerHTML = `<p class="df-meta df-facet-empty">無符合項目</p>`;
    else box.innerHTML = opts.map(o => {
      const on = sel.has(o.value);
      return `<button class="df-legend-chip df-facet-chip ${on ? "sel" : ""} ${anySel && !on ? "dim" : ""}" data-val="${esc(String(o.value))}" title="${esc(String(o.label))} — ${o.count} 筆">${esc(String(o.label))} <span class="df-facet-n">${o.count}</span></button>`;
    }).join("");
    box.querySelectorAll("[data-val]").forEach(b => b.onclick = () => {
      const v = b.dataset.val;
      if (sel.has(v)) sel.delete(v); else sel.add(v);
      renderAll();
    });
    const clr = host.querySelector(`[data-clear="${f.key}"]`);
    if (clr) clr.hidden = !anySel;
  }

  function renderResults() {
    const box = host.querySelector(`[data-fs="results"]`);
    const summary = host.querySelector(`[data-fs="summary"]`);
    if (!box) return;
    const anySel = facets.some(f => state.sel[f.key].size);
    if (!anySel) {
      if (summary) summary.textContent = "";
      box.innerHTML = `<p class="df-meta">${cfg.emptyHint || "於上方任一維度<b>複選</b>條件即可查詢；可跨維度組合。"}</p>`;
      return;
    }
    let rows = cfg.getEvents().filter(matchesAll);
    rows.sort(cfg.sortRows || ((a, b) => 0));
    if (summary) summary.textContent = cfg.summary ? cfg.summary(rows) : `${rows.length} 筆`;
    if (!rows.length) { box.innerHTML = `<p class="df-meta">沒有符合所有條件的事件。</p>`; return; }
    box.innerHTML = `<div class="df-contractor-list">${rows.map(cfg.renderRow).join("")}</div>`;
    box.querySelectorAll("[data-open]").forEach(el => el.onclick = () => {
      const e = rows.find(x => String(cfg.keyOf(x)) === el.dataset.open);
      if (e) cfg.onOpen(e);
    });
  }

  function renderAll() { facets.forEach(renderChips); renderResults(); }

  // 字面篩選框 / 清除鈕
  host.querySelectorAll(".df-facet-filter[data-q]").forEach(inp => {
    inp.oninput = e => { state.q[e.target.dataset.q] = e.target.value.trim(); renderChips(facetByKey[e.target.dataset.q]); };
  });
  host.querySelectorAll(".df-facet-clear[data-clear]").forEach(b => {
    b.onclick = () => { state.sel[b.dataset.clear].clear(); renderAll(); };
  });

  renderAll();
}
