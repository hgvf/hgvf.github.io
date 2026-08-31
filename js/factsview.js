// factsview.js — 事實追蹤 (Fact Tracking) page.
//
// Master/detail management of tracked earnings-call facts and watch points:
// stat cards, company/status filters, a list of tracked items, and a detail
// panel where each item's progress updates, verification checklist, price-since-
// tracking chart and source record can be edited. All persistence goes through
// facts.js (Firestore-backed, optimistic, live-synced).

import { esc, fmtDate, chartUrl, sent } from "./reports.js";
import { WORKER_URL } from "./config.js";
import {
  getFacts, getFact, saveFact, patchFact, removeFact, addUpdate, removeUpdate,
  onFactsChange, STATES, STATE_ORDER, stateInfo, isOpenState, CONFIDENCE, confInfo,
} from "./facts.js";

// ─── Price series (worker /chart, mirrors strength.js) ─────────────────────
const NS = "http://www.w3.org/2000/svg";
const CHART_KEY = "fx_price_series_v1";
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
function readChartCache() {
  try { return JSON.parse(sessionStorage.getItem(CHART_KEY) || "{}") || {}; } catch { return {}; }
}
function writeChartCache(o) { try { sessionStorage.setItem(CHART_KEY, JSON.stringify(o)); } catch { /* quota */ } }

async function fetchSeries(symbol, range = "1y") {
  const cache = readChartCache();
  const key = `${symbol}|${range}`;
  if (cache[key]) return cache[key];
  const url = `${WORKER_URL}/chart?symbols=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}&interval=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const series = (data && data.data && data.data[symbol]) || [];
  cache[key] = series;
  writeChartCache(cache);
  return series;
}

// ─── Small helpers ─────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
function pctClass(v) { return v == null || !isFinite(v) ? "neu" : v > 0 ? "pos" : v < 0 ? "neg" : "neu"; }
function fmtPct(v) { return v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }
// A tracked item is "due this month" if it is still open and its next check is
// this month or already past.
function isDueThisMonth(f) {
  if (!isOpenState(f.state) || !f.next_check) return false;
  return f.next_check <= today().slice(0, 7) + "-99"; // ≤ end of this month or earlier
}

export function mountFacts(opts) {
  const { root } = opts;
  let company = "__all__";   // ticker filter
  let group = "__all__";     // status group filter: open | verified | invalidated | due
  let selectedId = null;
  let tab = "progress";      // progress | checklist | source
  let showAdd = false;

  root.innerHTML = `
    <div class="fx-stats" id="fxStats"></div>
    <div class="fx-toolbar">
      <div class="fx-filters">
        <label class="fx-fl">公司
          <span class="rv-sel-wrap"><select class="rv-select" data-role="company"></select></span></label>
        <label class="fx-fl">狀態
          <span class="rv-sel-wrap"><select class="rv-select" data-role="group"></select></span></label>
      </div>
      <button class="fx-add-btn" data-role="add">＋ 新增追蹤事實</button>
    </div>
    <div class="fx-addform" id="fxAddForm" hidden></div>
    <div class="fx-body">
      <aside class="fx-list-pane"><div class="fx-list" id="fxList"></div></aside>
      <section class="fx-detail" id="fxDetail"></section>
    </div>`;

  const statsEl = root.querySelector("#fxStats");
  const listEl = root.querySelector("#fxList");
  const detailEl = root.querySelector("#fxDetail");
  const addFormEl = root.querySelector("#fxAddForm");
  const companySel = root.querySelector('[data-role="company"]');
  const groupSel = root.querySelector('[data-role="group"]');

  // ── Stats ────────────────────────────────────────────────────────────
  function renderStats(facts) {
    const tracking = facts.filter(f => isOpenState(f.state)).length;
    const due = facts.filter(isDueThisMonth).length;
    const verified = facts.filter(f => f.state === "verified").length;
    const invalid = facts.filter(f => f.state === "invalidated").length;
    const cards = [
      { k: "open", label: "追蹤中", n: tracking, cls: "c-open" },
      { k: "due", label: "本月待更新", n: due, cls: "c-due" },
      { k: "verified", label: "已驗證", n: verified, cls: "c-ok" },
      { k: "invalidated", label: "已失效", n: invalid, cls: "c-bad" },
    ];
    statsEl.innerHTML = cards.map(c =>
      `<button class="fx-stat ${c.cls}${(group === c.k || (c.k === "open" && group === "__all__") ) ? " active" : ""}" data-stat="${c.k}">
        <span class="fx-stat-n">${c.n}</span><span class="fx-stat-l">${c.label}</span></button>`
    ).join("");
  }

  // ── Filters ──────────────────────────────────────────────────────────
  function rebuildCompanySelect(facts) {
    const map = new Map();
    facts.forEach(f => { if (f.ticker) map.set(f.ticker, f.company || ""); });
    const opts = [`<option value="__all__">全部公司</option>`,
      ...[...map.keys()].sort().map(t =>
        `<option value="${esc(t)}">${esc(t)}${map.get(t) ? " · " + esc(map.get(t)) : ""}</option>`)].join("");
    companySel.innerHTML = opts;
    companySel.value = map.has(company) ? company : "__all__";
    if (!map.has(company)) company = "__all__";
    groupSel.innerHTML = [
      `<option value="__all__">全部狀態</option>`,
      `<option value="open">追蹤中</option>`,
      `<option value="due">本月待更新</option>`,
      `<option value="verified">已驗證</option>`,
      `<option value="invalidated">已失效</option>`,
    ].join("");
    groupSel.value = group;
  }

  function matchesGroup(f) {
    if (group === "__all__") return true;
    if (group === "open") return isOpenState(f.state);
    if (group === "due") return isDueThisMonth(f);
    return f.state === group;
  }
  function filtered(facts) {
    return facts.filter(f => (company === "__all__" || f.ticker === company) && matchesGroup(f));
  }

  // ── List ─────────────────────────────────────────────────────────────
  function listRow(f) {
    const si = stateInfo(f.state);
    const due = isDueThisMonth(f);
    const meta = f.state === "verified" || f.state === "invalidated"
      ? `更新於 ${esc((f.updated_at || "").slice(0, 10))}`
      : (f.next_check
          ? (f.next_check < today() ? `逾期 ${daysBetween(f.next_check, today())} 天` : `下次檢查 ${esc(f.next_check.slice(5))}`)
          : "下次法說");
    return `<button class="fx-row${selectedId === f.id ? " active" : ""}${due ? " due" : ""}" data-id="${esc(f.id)}">
      <span class="fx-badge s-${si.cls}">${esc(si.label)}</span>
      <span class="fx-row-title">${esc(f.title)}</span>
      <span class="fx-row-foot">
        <span class="fx-row-tk">${esc(f.ticker)}</span>
        <span class="fx-row-meta${due ? " due" : ""}">${meta}</span>
      </span>
    </button>`;
  }
  function renderList(facts) {
    const rows = filtered(facts);
    listEl.innerHTML = rows.length
      ? rows.map(listRow).join("")
      : `<div class="fx-empty">目前沒有符合的追蹤事實。<br>到<a href="../earnings/index.html">財報電話會議分析</a>按 ★ 收藏，或按上方「新增追蹤事實」。</div>`;
  }

  function daysBetween(a, b) {
    const d = Math.round((new Date(b) - new Date(a)) / 86400000);
    return Math.abs(d);
  }

  // ── Detail ───────────────────────────────────────────────────────────
  function stateSwitcher(f) {
    return `<div class="fx-state-switch">${STATE_ORDER.map(s => {
      const si = STATES[s];
      return `<button class="fx-st-opt s-${si.cls}${f.state === s ? " on" : ""}" data-setstate="${s}">${esc(si.label)}</button>`;
    }).join("")}</div>`;
  }

  function tabsBar() {
    const t = [["progress", "進度與股價"], ["checklist", "驗證條件"], ["source", "來源紀錄"]];
    return `<div class="fx-tabs">${t.map(([k, l]) =>
      `<button class="fx-tab${tab === k ? " active" : ""}" data-tab="${k}">${esc(l)}</button>`).join("")}</div>`;
  }

  function progressTab(f) {
    const updates = (f.updates || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const items = updates.length
      ? updates.map(u => {
          const si = u.state ? stateInfo(u.state) : null;
          return `<li class="fx-upd">
            <div class="fx-upd-top">
              <span class="fx-upd-date">${esc(u.date)}</span>
              ${si ? `<span class="fx-badge s-${si.cls} sm">${esc(si.label)}</span>` : ""}
              <button class="fx-upd-del" data-updel="${esc(u.at)}" title="刪除">×</button>
            </div>
            ${u.text ? `<div class="fx-upd-text">${esc(u.text)}</div>` : ""}
          </li>`;
        }).join("")
      : `<li class="fx-upd empty">尚無進度紀錄。</li>`;
    return `
      <div class="fx-two">
        <div class="fx-timeline-card">
          <div class="fx-card-h">進度時間軸</div>
          <form class="fx-upd-form" data-role="updform">
            <div class="fx-upd-row">
              <input type="date" class="fx-in" name="date" value="${today()}" />
              <span class="rv-sel-wrap"><select class="rv-select fx-in" name="state">
                <option value="">— 維持狀態 —</option>
                ${STATE_ORDER.map(s => `<option value="${s}">${esc(STATES[s].label)}</option>`).join("")}
              </select></span>
            </div>
            <textarea class="fx-in fx-ta" name="text" rows="2" placeholder="輸入進度或事實更新…"></textarea>
            <button class="fx-btn" type="submit">＋ 新增更新</button>
          </form>
          <ul class="fx-upd-list">${items}</ul>
        </div>
        <div class="fx-price-card" id="fxPrice">
          <div class="fx-card-h">股價對照 <span class="fx-card-sub">追蹤建立日 ${esc(f.base_date || "")} 起</span></div>
          <div class="fx-price-body"><div class="fx-price-loading">載入股價中…</div></div>
        </div>
      </div>`;
  }

  function checklistTab(f) {
    const items = (f.checklist || []).map((c, i) =>
      `<li class="fx-ck${c.done ? " done" : ""}">
        <button class="fx-ck-box" data-cktoggle="${i}" aria-label="切換">${c.done ? "✓" : ""}</button>
        <span class="fx-ck-text">${esc(c.text)}</span>
        <button class="fx-ck-del" data-ckdel="${i}" title="刪除">×</button>
      </li>`).join("");
    const done = (f.checklist || []).filter(c => c.done).length;
    return `<div class="fx-check-card">
      <div class="fx-card-h">驗證清單 <span class="fx-card-sub">${done}/${(f.checklist || []).length} 完成</span></div>
      <ul class="fx-ck-list">${items || `<li class="fx-ck empty">尚無驗證條件。</li>`}</ul>
      <form class="fx-ck-form" data-role="ckform">
        <input type="text" class="fx-in" name="text" placeholder="新增驗證條件，例如：綠膠營收占比 ≥ 10%" />
        <button class="fx-btn" type="submit">＋</button>
      </form>
    </div>`;
  }

  function sourceTab(f) {
    const src = f.source || {};
    const s = src.sentiment ? sent(src.sentiment) : null;
    const rows = [
      ["來源類型", f.kind === "watch" ? "未來看點" : "法說事實"],
      ["法說季度", src.quarter || "—"],
      ["法說日期", src.date ? fmtDate(src.date) : "—"],
      ["當時看法", s ? `<span class="fx-badge s-${s.cls === 'pos' ? 'ontrack' : s.cls === 'neg' ? 'behind' : 'notstart'}">${esc(s.label)}</span>` : "—"],
      ["建立追蹤", (f.created_at || "").slice(0, 10) || "—"],
    ];
    return `<div class="fx-src-card">
      <div class="fx-card-h">來源紀錄</div>
      <dl class="fx-src-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
      ${f.source && f.source.quarter ? `<a class="fx-src-link" href="../earnings/index.html#ticker=${encodeURIComponent(f.ticker)}">→ 回到 ${esc(f.ticker)} 財報分析</a>` : ""}
    </div>`;
  }

  function renderDetail() {
    const f = selectedId ? getFact(selectedId) : null;
    if (!f) {
      detailEl.innerHTML = `<div class="fx-detail-empty">← 從左側點選一個追蹤事實，或新增一筆</div>`;
      return;
    }
    const ci = confInfo(f.confidence);
    detailEl.innerHTML = `
      <div class="fx-d-head">
        <div class="fx-d-titlewrap">
          <input class="fx-d-title" data-edit="title" value="${esc(f.title)}" placeholder="事實標題" />
          <div class="fx-d-sub">
            <a class="fx-d-tk" href="${esc(chartUrl(f.ticker))}" target="_blank" rel="noopener">${esc(f.ticker)}</a>
            ${f.company ? `<span class="fx-d-co">${esc(f.company)}</span>` : ""}
            ${f.source && f.source.quarter ? `<span class="fx-d-q">${esc(f.source.quarter)}</span>` : ""}
          </div>
        </div>
        <div class="fx-d-actions">
          <label class="fx-conf c-${ci.cls}">信心
            <span class="rv-sel-wrap"><select class="rv-select fx-in" data-edit="confidence">
              ${Object.keys(CONFIDENCE).map(k => `<option value="${k}"${f.confidence === k ? " selected" : ""}>${esc(CONFIDENCE[k].label)}</option>`).join("")}
            </select></span>
          </label>
          <button class="fx-del-btn" data-role="delete" title="刪除此追蹤事實">🗑 刪除</button>
        </div>
      </div>
      <textarea class="fx-d-thesis fx-in" data-edit="thesis" rows="2" placeholder="投資假設 / 追蹤重點…">${esc(f.thesis)}</textarea>
      ${stateSwitcher(f)}
      <div class="fx-d-meta">
        <label class="fx-fl sm">下次檢查 <input type="date" class="fx-in" data-edit="next_check" value="${esc(f.next_check || "")}" /></label>
        <label class="fx-fl sm">追蹤建立日 <input type="date" class="fx-in" data-edit="base_date" value="${esc(f.base_date || "")}" /></label>
      </div>
      ${tabsBar()}
      <div class="fx-tabbody">
        ${tab === "progress" ? progressTab(f) : tab === "checklist" ? checklistTab(f) : sourceTab(f)}
      </div>`;
    if (tab === "progress") loadPriceChart(f);
  }

  // ── Price chart ──────────────────────────────────────────────────────
  async function loadPriceChart(f) {
    const host = detailEl.querySelector("#fxPrice .fx-price-body");
    if (!host) return;
    if (!f.ticker) { host.innerHTML = `<div class="fx-price-na">無代號</div>`; return; }
    try {
      const series = await fetchSeries(f.ticker, "1y");
      if (!series.length) { host.innerHTML = `<div class="fx-price-na">查無股價資料</div>`; return; }
      const base = f.base_date || series[0].date;
      const from = series.filter(p => p.date >= base);
      const use = from.length >= 2 ? from : series.slice(-30);
      drawPriceChart(host, use, f);
    } catch (e) {
      host.innerHTML = `<div class="fx-price-na">股價載入失敗（${esc(e.message)}）</div>`;
    }
  }

  function drawPriceChart(host, series, f) {
    const closes = series.map(p => p.close);
    const first = closes[0], last = closes[closes.length - 1];
    const chg = first ? ((last - first) / first * 100) : 0;
    const cls = pctClass(chg);
    const W = 300, H = 120, pad = 8;
    const lo = Math.min(...closes), hi = Math.max(...closes);
    const span = (hi - lo) || 1;
    const xx = i => pad + (i / (series.length - 1)) * (W - pad * 2);
    const yy = c => pad + (1 - (c - lo) / span) * (H - pad * 2);
    const pts = series.map((p, i) => `${xx(i).toFixed(1)},${yy(p.close).toFixed(1)}`);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: `fx-spark ${cls}`, preserveAspectRatio: "none" });
    svg.appendChild(svgEl("polygon", {
      points: `${xx(0).toFixed(1)},${H - pad} ${pts.join(" ")} ${xx(series.length - 1).toFixed(1)},${H - pad}`,
      class: "fx-spark-area",
    }));
    svg.appendChild(svgEl("polyline", { points: pts.join(" "), class: "fx-spark-line" }));
    // Mark update dates on the line.
    const dateIndex = d => {
      let bi = 0; for (let i = 0; i < series.length; i++) if (series[i].date <= d) bi = i; return bi;
    };
    (f.updates || []).forEach(u => {
      if (!u.date || u.date < series[0].date) return;
      const i = dateIndex(u.date);
      svg.appendChild(svgEl("circle", { cx: xx(i).toFixed(1), cy: yy(series[i].close).toFixed(1), r: 3.5, class: "fx-spark-mark" }));
    });
    host.innerHTML = `<div class="fx-price-top"><span class="fx-price-chg ${cls}">追蹤建立日起 ${fmtPct(chg)}</span></div>`;
    host.appendChild(svg);
    host.insertAdjacentHTML("beforeend",
      `<div class="fx-price-axis"><span>建立</span><span>現在</span></div>`);
  }

  // ── Add form ─────────────────────────────────────────────────────────
  function renderAddForm() {
    addFormEl.hidden = !showAdd;
    if (!showAdd) { addFormEl.innerHTML = ""; return; }
    addFormEl.innerHTML = `
      <form class="fx-newf" data-role="newform">
        <div class="fx-newf-grid">
          <label class="fx-fl sm">代號<input class="fx-in" name="ticker" placeholder="2449.TW" required /></label>
          <label class="fx-fl sm">公司<input class="fx-in" name="company" placeholder="京元電子" /></label>
          <label class="fx-fl sm">類型
            <span class="rv-sel-wrap"><select class="rv-select fx-in" name="kind">
              <option value="fact">法說事實</option><option value="watch">未來看點</option></select></span></label>
          <label class="fx-fl sm">信心
            <span class="rv-sel-wrap"><select class="rv-select fx-in" name="confidence">
              <option value="high">高</option><option value="medium" selected>中</option><option value="low">低</option></select></span></label>
        </div>
        <input class="fx-in" name="title" placeholder="事實 / 看點標題，例如：AI Server 綠膠放量" required />
        <textarea class="fx-in fx-ta" name="thesis" rows="2" placeholder="投資假設 / 追蹤重點（選填）"></textarea>
        <div class="fx-newf-foot">
          <label class="fx-fl sm">下次檢查<input type="date" class="fx-in" name="next_check" /></label>
          <div class="fx-newf-btns">
            <button type="button" class="fx-btn ghost" data-role="cancelnew">取消</button>
            <button type="submit" class="fx-btn">新增</button>
          </div>
        </div>
      </form>`;
  }

  // ── Master render ────────────────────────────────────────────────────
  function renderAll() {
    const facts = getFacts();
    renderStats(facts);
    rebuildCompanySelect(facts);
    renderList(facts);
    if (selectedId && !getFact(selectedId)) selectedId = null;
    renderDetail();
  }

  // ── Events ───────────────────────────────────────────────────────────
  statsEl.addEventListener("click", e => {
    const b = e.target.closest("[data-stat]");
    if (!b) return;
    group = b.dataset.stat === "open" ? "open" : b.dataset.stat;
    groupSel.value = group;
    renderAll();
  });
  companySel.addEventListener("change", () => { company = companySel.value; renderAll(); });
  groupSel.addEventListener("change", () => { group = groupSel.value; renderAll(); });

  root.querySelector('[data-role="add"]').addEventListener("click", () => {
    showAdd = !showAdd; renderAddForm();
  });

  addFormEl.addEventListener("click", e => {
    if (e.target.closest('[data-role="cancelnew"]')) { showAdd = false; renderAddForm(); }
  });
  addFormEl.addEventListener("submit", e => {
    e.preventDefault();
    if (!e.target.closest('[data-role="newform"]')) return;
    const fd = new FormData(e.target);
    const ticker = String(fd.get("ticker") || "").trim();
    const title = String(fd.get("title") || "").trim();
    if (!ticker || !title) return;
    const f = saveFact({
      ticker, company: String(fd.get("company") || "").trim(), title,
      kind: fd.get("kind"), confidence: fd.get("confidence"),
      thesis: String(fd.get("thesis") || "").trim(),
      next_check: fd.get("next_check") || "", state: "pending", base_date: today(),
    });
    showAdd = false; renderAddForm();
    selectedId = f.id; tab = "progress"; renderAll();
  });

  listEl.addEventListener("click", e => {
    const row = e.target.closest("[data-id]");
    if (row) { selectedId = row.dataset.id; tab = "progress"; renderAll(); }
  });

  // Delegated detail interactions.
  detailEl.addEventListener("click", e => {
    const f = selectedId ? getFact(selectedId) : null;
    if (!f) return;
    const st = e.target.closest("[data-setstate]");
    if (st) { patchFact(f.id, { state: st.dataset.setstate }); return; }
    const tb = e.target.closest("[data-tab]");
    if (tb) { tab = tb.dataset.tab; renderDetail(); return; }
    if (e.target.closest('[data-role="delete"]')) {
      if (window.confirm(`確定刪除追蹤「${f.title}」？此動作無法復原。`)) { selectedId = null; removeFact(f.id); }
      return;
    }
    const ud = e.target.closest("[data-updel]");
    if (ud) { removeUpdate(f.id, ud.dataset.updel); return; }
    const ct = e.target.closest("[data-cktoggle]");
    if (ct) {
      const i = +ct.dataset.cktoggle; const list = (f.checklist || []).slice();
      if (list[i]) { list[i] = { ...list[i], done: !list[i].done }; patchFact(f.id, { checklist: list }); }
      return;
    }
    const cd = e.target.closest("[data-ckdel]");
    if (cd) {
      const i = +cd.dataset.ckdel; const list = (f.checklist || []).slice();
      list.splice(i, 1); patchFact(f.id, { checklist: list });
      return;
    }
  });

  detailEl.addEventListener("submit", e => {
    const f = selectedId ? getFact(selectedId) : null;
    if (!f) return;
    e.preventDefault();
    if (e.target.closest('[data-role="updform"]')) {
      const fd = new FormData(e.target);
      const text = String(fd.get("text") || "").trim();
      const state = fd.get("state") || "";
      if (!text && !state) return;
      addUpdate(f.id, { text, date: fd.get("date") || today(), state });
      return;
    }
    if (e.target.closest('[data-role="ckform"]')) {
      const fd = new FormData(e.target);
      const text = String(fd.get("text") || "").trim();
      if (!text) return;
      patchFact(f.id, { checklist: [...(f.checklist || []), { text, done: false }] });
      return;
    }
  });

  // Inline edits (title, thesis, confidence, next_check, base_date) — commit on
  // change/blur so a keystroke doesn't re-render mid-typing.
  detailEl.addEventListener("change", e => {
    const el = e.target.closest("[data-edit]");
    if (!el || !selectedId) return;
    patchFact(selectedId, { [el.dataset.edit]: el.value });
  });
  detailEl.addEventListener("blur", e => {
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (!el || !selectedId) return;
    const f = getFact(selectedId);
    if (f && String(f[el.dataset.edit] || "") !== el.value) patchFact(selectedId, { [el.dataset.edit]: el.value });
  }, true);

  // Deep-link ?ticker=XXX — pre-filter to a company (used by the earnings-page
  // "事實追蹤" link). Also accepts #ticker=XXX.
  function applyDeepLink() {
    const qs = new URLSearchParams(location.search);
    const hashM = /(?:^|[#&])ticker=([^&]+)/.exec(location.hash || "");
    const t = qs.get("ticker") || (hashM ? decodeURIComponent(hashM[1]) : "");
    if (t) { company = t; group = "__all__"; }
  }

  // Live re-render when the store changes (bookmark from another tab/page).
  onFactsChange(() => {
    // Keep any in-flight inline edit from being clobbered: only re-render list +
    // stats; re-render detail only if the selected item's identity changed.
    renderAll();
  });

  applyDeepLink();
  renderAll();
  return { renderAll };
}
