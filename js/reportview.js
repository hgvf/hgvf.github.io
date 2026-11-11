// reportview.js — master/detail report view for the report pages.
// Left column = timeline (grouped by month) OR monthly calendar; right column
// = detail of the node the user clicks. Nothing is shown on the right until a
// node is selected. A toggle switches the left column between the two layouts.

import { loadDocs, deleteReport, sent, esc, fmtDate, onTickerDataChange } from "./reports.js";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

export async function mountReportView(opts) {
  const {
    root, collection, orderField = "date",
    tickersOf, sentimentOf, nodeTitle, chipLabel, renderDetail,
    chipSub,                         // (item) => string — secondary label in the calendar day panel (e.g. company)
    emptyHint = "點選左側節點，內容會顯示在這裡",
    onData,
    onCollect,                       // (item) => boolean  — return true if now collected
    isCollected = () => false,       // (id)   => boolean
  } = opts;
  const chip = chipLabel || (it => (tickersOf(it)[0] || "•"));

  let all = [], view = "timeline", ticker = "__all__", year = "__all__", selectedId = null;
  let calY, calM; // calendar's current month
  let calDay = null, calQuery = ""; // calendar: expanded day ("YYYY-MM-DD") + its search filter
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
  // Busy days (dozens of reports) would blow up a cell, so each cell shows a
  // count + sentiment bar + the first few chips, and "+N" opens a day panel
  // under the grid listing everything for that day (searchable).
  const CAL_MAX = 3;                                // chips shown per cell before "+N"
  const SENT_ORDER = { pos: 0, neg: 1, neu: 2 };   // signal first, neutral last
  const sortDay = its => its.slice().sort((a, b) =>
    (SENT_ORDER[sent(sentimentOf(a)).cls] ?? 3) - (SENT_ORDER[sent(sentimentOf(b)).cls] ?? 3)
    || String(chip(a)).localeCompare(String(chip(b))));
  const pad2 = n => String(n).padStart(2, "0");
  function todayKey() { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; }
  function sentCounts(its) {
    const c = { pos: 0, neg: 0, neu: 0 };
    its.forEach(it => { const k = sent(sentimentOf(it)).cls; c[k in c ? k : "neu"]++; });
    return c;
  }
  function chipBtn(it) {
    const s = sent(sentimentOf(it));
    // Cells are narrow — drop the Taiwan market suffix (1560.TW → 1560); the day panel keeps the full symbol.
    const label = String(chip(it)).replace(/\.TWO?$/i, "");
    return `<button class="rv-cal-chip ${s.cls}" data-id="${esc(it.id)}" title="${esc(nodeTitle(it))}">${esc(label)}</button>`;
  }

  function dayPanelHTML(key, its) {
    if (!key || !its.length) return "";
    const d = new Date(key + "T00:00:00");
    const c = sentCounts(its);
    const q = calQuery.trim().toLowerCase();
    const shown = sortDay(its).filter(it => !q
      || String(chip(it)).toLowerCase().includes(q)
      || String(chipSub ? chipSub(it) : "").toLowerCase().includes(q)
      || String(nodeTitle(it)).toLowerCase().includes(q));
    const rows = shown.map(it => {
      const s = sent(sentimentOf(it));
      const sub = chipSub ? chipSub(it) : "";
      return `<button class="rv-day-item ${s.cls}" data-id="${esc(it.id)}" title="${esc(nodeTitle(it))}">
        <span class="rv-dot ${s.cls}"></span>
        <span class="rv-day-tk">${esc(chip(it))}</span>
        ${sub ? `<span class="rv-day-sub">${esc(sub)}</span>` : ""}
      </button>`;
    }).join("");
    return `<section class="rv-day" data-day-panel>
      <div class="rv-day-head">
        <span class="rv-day-title">${d.getMonth() + 1} 月 ${d.getDate()} 日<small>（週${DOW[d.getDay()]}）</small></span>
        <span class="rv-day-n">${its.length} 場</span>
        <span class="rv-day-sc">
          ${c.pos ? `<span class="pos">▲ ${c.pos}</span>` : ""}${c.neg ? `<span class="neg">▼ ${c.neg}</span>` : ""}${c.neu ? `<span class="neu">— ${c.neu}</span>` : ""}
        </span>
        <button class="rv-day-close" data-day-close aria-label="收合" title="收合">×</button>
      </div>
      ${its.length > 8 ? `<input class="rv-day-q" data-day-q type="search" placeholder="搜尋代號 / 公司…" value="${esc(calQuery)}" />` : ""}
      <div class="rv-day-list" data-day-list>${rows || `<div class="rv-empty">沒有符合的項目。</div>`}</div>
    </section>`;
  }

  function calendarHTML(items) {
    const prefix = `${calY}-${pad2(calM + 1)}`;
    const byDay = {};
    items.forEach(it => { if (String(it.date || "").slice(0, 7) === prefix) (byDay[it.date] = byDay[it.date] || []).push(it); });
    if (calDay && (calDay.slice(0, 7) !== prefix || !byDay[calDay])) calDay = null;
    const monthN = Object.values(byDay).reduce((n, a) => n + a.length, 0);
    const today = todayKey();
    const startDow = new Date(calY, calM, 1).getDay();
    const days = new Date(calY, calM + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += `<div class="rv-cal-cell empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const key = `${prefix}-${pad2(d)}`;
      const its = sortDay(byDay[key] || []);
      const cls = ["rv-cal-cell"];
      if (its.length) cls.push("has");
      if (key === today) cls.push("today");
      if (key === calDay) cls.push("open");
      let body = "";
      if (its.length) {
        const c = sentCounts(its);
        const bar = ["pos", "neg", "neu"].filter(k => c[k])
          .map(k => `<i class="${k}" style="flex:${c[k]}"></i>`).join("");
        // Show every chip if they fit; otherwise CAL_MAX chips + a "+N" opener.
        const fit = its.length <= CAL_MAX + 1;
        const vis = fit ? its : its.slice(0, CAL_MAX);
        const more = fit ? "" : `<button class="rv-cal-more" data-day="${key}" title="查看當日全部 ${its.length} 場">+${its.length - CAL_MAX}</button>`;
        body = `<div class="rv-cal-bar" title="▲ ${c.pos}　▼ ${c.neg}　— ${c.neu}">${bar}</div>
          <div class="rv-cal-chips">${vis.map(chipBtn).join("")}${more}</div>`;
      }
      cells += `<div class="${cls.join(" ")}"${its.length ? ` data-day="${key}"` : ""}>
        <div class="rv-cal-top"><span class="rv-cal-day">${d}</span>${its.length > 1 ? `<span class="rv-cal-n">${its.length}</span>` : ""}</div>
        ${body}</div>`;
    }
    const dow = DOW.map((x, i) => `<div class="rv-cal-dow${i === 0 || i === 6 ? " we" : ""}">${x}</div>`).join("");
    return `<div class="rv-cal">
      <div class="rv-cal-nav">
        <button class="rv-nav" data-nav="-1" aria-label="上個月">‹</button>
        <span class="rv-cal-title">${calY} 年 ${calM + 1} 月${monthN ? `<span class="rv-month-n">${monthN}</span>` : ""}</span>
        <button class="rv-nav" data-nav="1" aria-label="下個月">›</button>
      </div>
      <div class="rv-cal-grid">${dow}${cells}</div>
      ${dayPanelHTML(calDay, byDay[calDay] || [])}
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
    if (e.target.closest("[data-day-close]")) { calDay = null; calQuery = ""; renderLeft(); return; }
    if (e.target.closest("[data-day-q]")) return;
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      calM += parseInt(nav.dataset.nav, 10);
      if (calM < 0) { calM = 11; calY--; } else if (calM > 11) { calM = 0; calY++; }
      calDay = null; calQuery = "";
      renderLeft();
      return;
    }
    const node = e.target.closest("[data-id]");
    if (node) { selectItem(node.dataset.id); return; }
    // Clicking a day cell (or its "+N") toggles that day's full list.
    const day = e.target.closest("[data-day]");
    if (day) {
      calDay = calDay === day.dataset.day ? null : day.dataset.day; calQuery = "";
      renderLeft();
      if (calDay) {
        const panel = leftEl.querySelector("[data-day-panel]");
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  });
  // Live filter inside the day panel — re-render only the list so the input keeps focus.
  leftEl.addEventListener("input", e => {
    if (!e.target.matches("[data-day-q]")) return;
    calQuery = e.target.value;
    const panel = leftEl.querySelector("[data-day-panel]");
    const html = dayPanelHTML(calDay, filtered().filter(it => it.date === calDay));
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    const fresh = tmp.querySelector("[data-day-list]");
    if (panel && fresh) panel.querySelector("[data-day-list]").replaceWith(fresh);
    if (selectedId) leftEl.querySelectorAll(`[data-id="${CSS.escape(selectedId)}"]`).forEach(n => n.classList.add("active"));
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
  // A ticker correction (symbol alias) changes chips / chart link / price row —
  // rebuild the open detail so it reflects the fix immediately.
  onTickerDataChange(() => { if (selectedId) selectItem(selectedId); });
  return { reload, setAdmin, refreshCollectStates, selectItem };
}
