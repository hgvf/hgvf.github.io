// industryview.js — filterable master/detail view for `supply_chain_events`
// (產業消息). A richer sibling of reportview.js: besides the ticker/year
// filters and the timeline/calendar toggle, it exposes the event schema's flat
// filter fields (event_type / themes / regions / importance_tier /
// evidence_level) plus a keyword search over search_keywords[], and a small
// live digest strip computed from the currently-filtered set. Left column =
// timeline or calendar; right column = the selected event's detail card.

import { loadDocs, deleteReport, esc, fmtDate } from "./reports.js";
import { EVENT_TYPE_LABEL, TIER_LABEL, TIER_CLASS, EVIDENCE_LABEL, tierClass } from "./industrydetail.js";

const DOW = ["日", "一", "二", "三", "四", "五", "六"];
const TIER_ORDER = { critical: 0, high: 1, relevant: 2 };

export async function mountIndustryView(opts) {
  const {
    root, collection = "supply_chain_events", orderField = "event_date",
    renderDetail,
    emptyHint = "點選左側事件節點，內容會顯示在這裡",
    onData, onCollect, isCollected = () => false,
  } = opts;

  let all = [], view = "timeline", selectedId = null, canDelete = false;
  let calY, calM;
  const f = { q: "", type: "__all__", theme: "__all__", region: "__all__",
              tier: "__all__", evi: "__all__", ticker: "__all__", year: "__all__" };

  root.innerHTML = `
    <div class="in-filters">
      <label class="in-search">🔍
        <input type="search" class="in-search-input" data-role="q" placeholder="關鍵字搜尋（ticker / 公司 / 題材 / 材料…）" spellcheck="false" />
      </label>
      <div class="in-selects">
        <label class="rv-ctl">事件類型 <span class="rv-sel-wrap"><select class="rv-select" data-role="type"></select></span></label>
        <label class="rv-ctl">題材 <span class="rv-sel-wrap"><select class="rv-select" data-role="theme"></select></span></label>
        <label class="rv-ctl">地區 <span class="rv-sel-wrap"><select class="rv-select" data-role="region"></select></span></label>
        <label class="rv-ctl">重要性 <span class="rv-sel-wrap"><select class="rv-select" data-role="tier"></select></span></label>
        <label class="rv-ctl">證據 <span class="rv-sel-wrap"><select class="rv-select" data-role="evi"></select></span></label>
        <label class="rv-ctl">Ticker <span class="rv-sel-wrap"><select class="rv-select" data-role="ticker"></select></span></label>
        <label class="rv-ctl">年份 <span class="rv-sel-wrap"><select class="rv-select" data-role="year"></select></span></label>
        <button class="in-clear" data-role="clear" title="清除所有篩選">清除</button>
      </div>
    </div>
    <div class="in-digest" data-role="digest"></div>
    <div class="rv-controls in-viewctl">
      <div class="rv-toggle">
        <button class="rv-tab active" data-view="timeline">時間軸</button>
        <button class="rv-tab" data-view="calendar">月曆</button>
      </div>
      <span class="in-count" data-role="count"></span>
    </div>
    <div class="rv-split">
      <div class="rv-left" id="inLeft"></div>
      <div class="rv-right" id="inRight"></div>
    </div>`;

  const leftEl = root.querySelector("#inLeft");
  const rightEl = root.querySelector("#inRight");
  const digestEl = root.querySelector('[data-role="digest"]');
  const countEl = root.querySelector('[data-role="count"]');
  const qEl = root.querySelector('[data-role="q"]');
  const sel = k => root.querySelector(`[data-role="${k}"]`);

  function emptyRight() { return `<div class="rv-empty rv-empty-right">← ${esc(emptyHint)}</div>`; }

  const BOOKMARK = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.2L5 20.5v-16a1 1 0 0 1 1-1z"/></svg>`;
  function collectBtn(id) {
    const on = isCollected(id) ? " on" : "";
    return `<span class="rv-row-collect${on}" data-collect="${esc(id)}" role="button" tabindex="0" title="收藏到重點新聞" aria-label="收藏到重點新聞">${BOOKMARK}</span>`;
  }
  function refreshCollectStates() {
    leftEl.querySelectorAll("[data-collect]").forEach(n => n.classList.toggle("on", isCollected(n.dataset.collect)));
  }

  const dateOf = it => it.event_date || it.date || "";
  const itYear = it => String(dateOf(it)).slice(0, 4);
  const tickersOf = it => it.tickers || [];
  const nodeTitle = it => it.title_zh || it.title_original || it.event_id || "";
  const chipOf = it => (it.tickers && it.tickers[0]) || (EVENT_TYPE_LABEL[it.event_type] || "•").slice(0, 2);

  // ── Filtering ─────────────────────────────────────────────────────
  function matchesQuery(it) {
    if (!f.q) return true;
    const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = [
      ...(it.search_keywords || []),
      ...(it.tickers || []),
      it.title_zh, it.title_original, it.summary_zh,
      ...((it.companies || []).map(c => c.name)),
    ].filter(Boolean).join(" ").toLowerCase();
    return tokens.every(t => hay.includes(t));
  }

  function filtered() {
    return all.filter(it => {
      if (f.type !== "__all__" && it.event_type !== f.type) return false;
      if (f.theme !== "__all__" && !(it.themes || []).includes(f.theme)) return false;
      if (f.region !== "__all__" && !(it.regions || []).includes(f.region)) return false;
      if (f.tier !== "__all__" && it.importance_tier !== f.tier) return false;
      if (f.evi !== "__all__" && it.evidence_level !== f.evi) return false;
      if (f.ticker !== "__all__" && !tickersOf(it).includes(f.ticker)) return false;
      if (f.year !== "__all__" && itYear(it) !== f.year) return false;
      if (!matchesQuery(it)) return false;
      return true;
    });
  }

  function setDefaultCalMonth() {
    const items = filtered();
    const d = items.length && dateOf(items[0]) ? new Date(dateOf(items[0]) + "T00:00:00") : new Date();
    calY = d.getFullYear(); calM = d.getMonth();
  }

  // ── Live digest strip (from the filtered set) ─────────────────────
  function renderDigest(items) {
    const tiers = { critical: 0, high: 0, relevant: 0 };
    const tickers = {};
    items.forEach(it => {
      if (tiers[it.importance_tier] != null) tiers[it.importance_tier]++;
      (it.tickers || []).forEach(t => { tickers[t] = (tickers[t] || 0) + 1; });
    });
    const top = Object.entries(tickers).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const pill = (k) => tiers[k] ? `<span class="in-dg-pill ${TIER_CLASS[k]}">${TIER_LABEL[k].split(" ")[0]} ${tiers[k]}</span>` : "";
    const topHTML = top.length
      ? `<span class="in-dg-sep">·</span><span class="in-dg-lbl">熱門</span>${top.map(([t, n]) =>
          `<button class="in-dg-tk" data-tk="${esc(t)}" title="篩選 ${esc(t)}">${esc(t)}<span>${n}</span></button>`).join("")}`
      : "";
    digestEl.innerHTML = items.length
      ? `<span class="in-dg-lbl">事件</span><span class="in-dg-count">${items.length}</span>${pill("critical")}${pill("high")}${pill("relevant")}${topHTML}`
      : "";
  }

  // ── Left: timeline ────────────────────────────────────────────────
  function timelineHTML(items) {
    if (!items.length) return `<div class="rv-empty">符合條件的事件為 0，試著放寬篩選。</div>`;
    const groups = {};
    items.forEach(it => { const k = String(dateOf(it) || "—").slice(0, 7); (groups[k] = groups[k] || []).push(it); });
    return Object.keys(groups).sort().reverse().map(k => {
      const [y, m] = k.split("-");
      const rows = groups[k].map(it => {
        const tcls = tierClass(it.importance_tier);
        return `<div class="rv-row" data-id="${esc(it.id)}" role="button" tabindex="0">
          <span class="rv-dot ${tcls}"></span>
          <span class="rv-row-date">${esc((fmtDate(dateOf(it)) || "").slice(5))}</span>
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

  // ── Left: calendar ────────────────────────────────────────────────
  function calendarHTML(items) {
    const prefix = `${calY}-${String(calM + 1).padStart(2, "0")}`;
    const byDay = {};
    items.forEach(it => { if (String(dateOf(it) || "").slice(0, 7) === prefix) (byDay[dateOf(it)] = byDay[dateOf(it)] || []).push(it); });
    const startDow = new Date(calY, calM, 1).getDay();
    const days = new Date(calY, calM + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += `<div class="rv-cal-cell empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const key = `${prefix}-${String(d).padStart(2, "0")}`;
      const its = byDay[key] || [];
      const chips = its.map(it =>
        `<button class="rv-cal-chip ${tierClass(it.importance_tier)}" data-id="${esc(it.id)}" title="${esc(nodeTitle(it))}">${esc(chipOf(it))}</button>`).join("");
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
    const items = filtered();
    renderDigest(items);
    countEl.textContent = `${items.length} / ${all.length} 則`;
    root.classList.toggle("rv-cal-mode", view === "calendar");
    leftEl.innerHTML = view === "timeline" ? timelineHTML(items) : calendarHTML(items);
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
    if (!window.confirm(`確定刪除「${it ? nodeTitle(it) : id}」？此動作無法復原。`)) return;
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

  digestEl.addEventListener("click", e => {
    const tk = e.target.closest("[data-tk]");
    if (tk) { f.ticker = tk.dataset.tk; sel("ticker").value = f.ticker; if (view === "calendar") setDefaultCalMonth(); renderLeft(); }
  });

  root.querySelectorAll(".rv-tab").forEach(tab => tab.addEventListener("click", () => {
    view = tab.dataset.view;
    root.querySelectorAll(".rv-tab").forEach(t => t.classList.toggle("active", t === tab));
    if (view === "calendar") setDefaultCalMonth();
    renderLeft();
  }));

  function onFilterChange() { if (view === "calendar") setDefaultCalMonth(); renderLeft(); }
  ["type", "theme", "region", "tier", "evi", "ticker", "year"].forEach(k =>
    sel(k).addEventListener("change", () => { f[k] = sel(k).value; onFilterChange(); }));
  let qTimer = null;
  qEl.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = qEl.value.trim(); onFilterChange(); }, 180); });
  sel("clear").addEventListener("click", () => {
    Object.keys(f).forEach(k => { f[k] = k === "q" ? "" : "__all__"; });
    qEl.value = "";
    ["type", "theme", "region", "tier", "evi", "ticker", "year"].forEach(k => sel(k).value = "__all__");
    onFilterChange();
  });

  function opts2(values, labelFn) {
    return [`<option value="__all__">全部</option>`,
      ...values.map(v => `<option value="${esc(v)}">${esc(labelFn ? labelFn(v) : v)}</option>`)].join("");
  }

  function buildSelects() {
    const uniq = key => [...new Set(all.flatMap(it => it[key] || []).filter(Boolean))];
    const types = [...new Set(all.map(it => it.event_type).filter(Boolean))]
      .sort((a, b) => (EVENT_TYPE_LABEL[a] || a).localeCompare(EVENT_TYPE_LABEL[b] || b));
    sel("type").innerHTML = opts2(types, t => EVENT_TYPE_LABEL[t] || t);
    sel("theme").innerHTML = opts2(uniq("themes").sort());
    sel("region").innerHTML = opts2(uniq("regions").sort());
    const tiers = [...new Set(all.map(it => it.importance_tier).filter(Boolean))]
      .sort((a, b) => (TIER_ORDER[a] ?? 9) - (TIER_ORDER[b] ?? 9));
    sel("tier").innerHTML = opts2(tiers, t => TIER_LABEL[t] || t);
    const evis = [...new Set(all.map(it => it.evidence_level).filter(Boolean))];
    sel("evi").innerHTML = opts2(evis, v => EVIDENCE_LABEL[v] || v);
    sel("ticker").innerHTML = opts2(uniq("tickers").sort());
    sel("year").innerHTML = opts2([...new Set(all.map(itYear).filter(Boolean))].sort().reverse());
    // preserve current selections where still valid
    ["type", "theme", "region", "tier", "evi", "ticker", "year"].forEach(k => {
      const s = sel(k);
      s.value = [...s.options].some(o => o.value === f[k]) ? f[k] : "__all__";
      f[k] = s.value;
    });
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

  function setAdmin(v) { canDelete = !!v; root.classList.toggle("rv-can-delete", canDelete); }

  await reload();
  return { reload, setAdmin, refreshCollectStates, selectItem };
}
