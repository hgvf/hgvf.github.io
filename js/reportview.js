// reportview.js — master/detail report view for the report pages.
// Left column = timeline (grouped by month) OR monthly calendar; right column
// = detail of the node the user clicks. Nothing is shown on the right until a
// node is selected. A toggle switches the left column between the two layouts.

import { loadDocs, deleteReport, sent, esc, fmtDate } from "./reports.js";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

export async function mountReportView(opts) {
  const {
    root, collection, orderField = "date",
    tickersOf, sentimentOf, nodeTitle, chipLabel, renderDetail,
    emptyHint = "點選左側節點，內容會顯示在這裡",
    onData,
    onCollect,                       // (item) => boolean  — return true if now collected
    isCollected = () => false,       // (id)   => boolean
  } = opts;
  const chip = chipLabel || (it => (tickersOf(it)[0] || "•"));

  let all = [], view = "timeline", ticker = "__all__", year = "__all__", selectedId = null;
  let calY, calM; // calendar's current month
  let canDelete = false;

  root.innerHTML = `
    <div class="rv-controls">
      <label class="rv-ctl">Ticker <span class="rv-sel-wrap"><select class="rv-select" data-role="ticker"></select></span></label>
      <label class="rv-ctl">年份 <span class="rv-sel-wrap"><select class="rv-select" data-role="year"></select></span></label>
      <div class="rv-toggle">
        <button class="rv-tab active" data-view="timeline">時間軸</button>
        <button class="rv-tab" data-view="calendar">月曆</button>
      </div>
    </div>
    <div class="rv-split">
      <div class="rv-left" id="rvLeft"></div>
      <div class="rv-right" id="rvRight"></div>
    </div>`;

  const leftEl = root.querySelector("#rvLeft");
  const rightEl = root.querySelector("#rvRight");
  const tickerSel = root.querySelector('[data-role="ticker"]');
  const yearSel = root.querySelector('[data-role="year"]');

  function emptyRight() { return `<div class="rv-empty rv-empty-right">← ${esc(emptyHint)}</div>`; }

  // Collect ("bookmark") toggle shown next to the delete ×. Always available.
  const BOOKMARK = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.2L5 20.5v-16a1 1 0 0 1 1-1z"/></svg>`;
  function collectBtn(id) {
    const on = isCollected(id) ? " on" : "";
    return `<span class="rv-row-collect${on}" data-collect="${esc(id)}" role="button" tabindex="0" title="收藏到重點新聞" aria-label="收藏到重點新聞">${BOOKMARK}</span>`;
  }

  // Reflect the current collection state onto every collect button (called when
  // the store changes elsewhere, e.g. an item removed from the highlight panel).
  function refreshCollectStates() {
    leftEl.querySelectorAll("[data-collect]").forEach(n => {
      n.classList.toggle("on", isCollected(n.dataset.collect));
    });
  }

  function itYear(it) { return String(it.date || "").slice(0, 4); }

  function filtered() {
    return all.filter(it => {
      if (ticker !== "__all__" && !tickersOf(it).includes(ticker)) return false;
      if (year !== "__all__" && itYear(it) !== year) return false;
      return true;
    });
  }

  function setDefaultCalMonth() {
    const items = filtered();
    const d = items.length && items[0].date ? new Date(items[0].date + "T00:00:00") : new Date();
    calY = d.getFullYear(); calM = d.getMonth();
  }

  // ── Left: timeline grouped by month ───────────────────────────────
  function timelineHTML(items) {
    if (!items.length) return `<div class="rv-empty">目前沒有資料。</div>`;
    const groups = {};
    items.forEach(it => { const k = String(it.date || "—").slice(0, 7); (groups[k] = groups[k] || []).push(it); });
    return Object.keys(groups).sort().reverse().map(k => {
      const [y, m] = k.split("-");
      const rows = groups[k].map(it => {
        const s = sent(sentimentOf(it));
        return `<div class="rv-row" data-id="${esc(it.id)}" role="button" tabindex="0">
          <span class="rv-dot ${s.cls}"></span>
          <span class="rv-row-date">${esc((fmtDate(it.date) || "").slice(5))}</span>
          <span class="rv-row-title">${esc(nodeTitle(it))}</span>
          ${collectBtn(it.id)}
          <span class="rv-row-del" data-del="${esc(it.id)}" role="button" title="刪除" aria-label="刪除">×</span>
        </div>`;
      }).join("");
      return `<section class="rv-month">
        <h3 class="rv-month-h">${esc(y)} 年 ${esc(String(parseInt(m, 10)))} 月<span class="rv-month-n">${groups[k].length}</span></h3>
        <div class="rv-rows">${rows}</div>
      </section>`;
    }).join("");
  }

  // ── Left: monthly calendar ────────────────────────────────────────
  function calendarHTML(items) {
    const prefix = `${calY}-${String(calM + 1).padStart(2, "0")}`;
    const byDay = {};
    items.forEach(it => { if (String(it.date || "").slice(0, 7) === prefix) (byDay[it.date] = byDay[it.date] || []).push(it); });
    const startDow = new Date(calY, calM, 1).getDay();
    const days = new Date(calY, calM + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += `<div class="rv-cal-cell empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const key = `${prefix}-${String(d).padStart(2, "0")}`;
      const its = byDay[key] || [];
      const chips = its.map(it => {
        const s = sent(sentimentOf(it));
        return `<button class="rv-cal-chip ${s.cls}" data-id="${esc(it.id)}" title="${esc(nodeTitle(it))}">${esc(chip(it))}</button>`;
      }).join("");
      cells += `<div class="rv-cal-cell${its.length ? " has" : ""}"><span class="rv-cal-day">${d}</span><div class="rv-cal-chips">${chips}</div></div>`;
    }
    const dow = DOW.map(x => `<div class="rv-cal-dow">${x}</div>`).join("");
    return `<div class="rv-cal">
      <div class="rv-cal-nav">
        <button class="rv-nav" data-nav="-1" aria-label="上個月">‹</button>
        <span class="rv-cal-title">${calY} 年 ${calM + 1} 月</span>
        <button class="rv-nav" data-nav="1" aria-label="下個月">›</button>
      </div>
      <div class="rv-cal-grid">${dow}${cells}</div>
    </div>`;
  }

  function renderLeft() {
    root.classList.toggle("rv-cal-mode", view === "calendar");
    leftEl.innerHTML = view === "timeline" ? timelineHTML(filtered()) : calendarHTML(filtered());
    if (selectedId) leftEl.querySelectorAll(`[data-id="${CSS.escape(selectedId)}"]`).forEach(n => n.classList.add("active"));
  }

  function selectItem(id) {
    selectedId = id;
    const it = all.find(x => x.id === id);
    rightEl.innerHTML = it ? renderDetail(it) : emptyRight();
    leftEl.querySelectorAll("[data-id]").forEach(n => n.classList.toggle("active", n.dataset.id === id));
    if (window.innerWidth <= 900) rightEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Wiring ────────────────────────────────────────────────────────
  async function handleDelete(id) {
    if (!canDelete) return;
    const it = all.find(x => x.id === id);
    const label = it ? (nodeTitle(it) || id) : id;
    if (!window.confirm(`確定刪除「${label}」？此動作無法復原。`)) return;
    try {
      await deleteReport(collection, id);
      if (selectedId === id) { selectedId = null; rightEl.innerHTML = emptyRight(); }
      await reload();
    } catch (e) {
      window.alert("刪除失敗：" + (e.code === "permission-denied" ? "需以白名單管理員登入。" : e.message));
    }
  }

  function handleCollect(id) {
    const it = all.find(x => x.id === id);
    if (!it) return;
    const now = onCollect ? onCollect(it) : false;
    const btn = leftEl.querySelector(`[data-collect="${CSS.escape(id)}"]`);
    if (btn) btn.classList.toggle("on", !!now);
  }

  leftEl.addEventListener("click", e => {
    const col = e.target.closest("[data-collect]");
    if (col) { e.stopPropagation(); handleCollect(col.dataset.collect); return; }
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); handleDelete(del.dataset.del); return; }
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      calM += parseInt(nav.dataset.nav, 10);
      if (calM < 0) { calM = 11; calY--; } else if (calM > 11) { calM = 0; calY++; }
      renderLeft();
      return;
    }
    const node = e.target.closest("[data-id]");
    if (node) selectItem(node.dataset.id);
  });

  root.querySelectorAll(".rv-tab").forEach(tab => tab.addEventListener("click", () => {
    view = tab.dataset.view;
    root.querySelectorAll(".rv-tab").forEach(t => t.classList.toggle("active", t === tab));
    if (view === "calendar") setDefaultCalMonth();
    renderLeft();
  }));

  tickerSel.addEventListener("change", () => { ticker = tickerSel.value; if (view === "calendar") setDefaultCalMonth(); renderLeft(); });
  yearSel.addEventListener("change", () => { year = yearSel.value; if (view === "calendar") setDefaultCalMonth(); renderLeft(); });

  function buildSelects() {
    const tset = new Set(); all.forEach(it => tickersOf(it).forEach(t => tset.add(t)));
    tickerSel.innerHTML = [`<option value="__all__">全部</option>`,
      ...[...tset].sort().map(t => `<option value="${esc(t)}">${esc(t)}</option>`)].join("");
    const yset = new Set(all.map(itYear).filter(Boolean));
    yearSel.innerHTML = [`<option value="__all__">全部</option>`,
      ...[...yset].sort().reverse().map(y => `<option value="${esc(y)}">${esc(y)}</option>`)].join("");
    tickerSel.value = tset.has(ticker) ? ticker : "__all__";
    yearSel.value = yset.has(year) ? year : "__all__";
  }

  async function reload() {
    all = await loadDocs(collection, orderField, "desc");
    buildSelects();
    setDefaultCalMonth();
    if (selectedId && !all.some(x => x.id === selectedId)) selectedId = null;
    rightEl.innerHTML = selectedId ? renderDetail(all.find(x => x.id === selectedId)) : emptyRight();
    renderLeft();
    if (onData) onData(all);
  }

  function setAdmin(v) {
    canDelete = !!v;
    root.classList.toggle("rv-can-delete", canDelete);
  }

  // Deep-link: open a specific item (#item=<id>) or pre-filter by ticker
  // (#ticker=<sym>) when arrived at from a ticker-card tag link.
  function applyDeepLink() {
    const hash = location.hash || "";
    const idM = /(?:^|[#&])item=([^&]+)/.exec(hash);
    if (idM) {
      const id = decodeURIComponent(idM[1]);
      if (all.some(x => x.id === id)) {
        ticker = "__all__"; year = "__all__";
        if (tickerSel) tickerSel.value = "__all__";
        if (yearSel) yearSel.value = "__all__";
        renderLeft();
        selectItem(id);
        const row = leftEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    const tkM = /(?:^|[#&])ticker=([^&]+)/.exec(hash);
    if (tkM) {
      const t = decodeURIComponent(tkM[1]);
      const has = all.some(x => tickersOf(x).includes(t));
      if (has) { ticker = t; if (tickerSel) tickerSel.value = t; renderLeft(); }
    }
  }

  await reload();
  applyDeepLink();
  window.addEventListener("hashchange", applyDeepLink);
  return { reload, setAdmin, refreshCollectStates, selectItem };
}
