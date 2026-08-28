// industrynews.js — News · Industry（產業動態情報）. Reads collection
// `industry_news`（industry-news-daily skill）. Two tabs:
//   · 事件動態  — filterable event feed with investable content nodes + detail
//   · ETL 分析  — in-browser aggregates（industry / event_type / tier / tickers）
// Collection may be empty or absent — degrades to an empty layout without
// throwing.
import { esc, onAuth } from "./reports.js";
import { loadNews, saveNews, deleteNews, rebuildNewsIndex, parseNewsRun } from "./newsdata.js";

const COL = "industry_news";
const root = document.getElementById("app");
let EVENTS = [];
let isAdmin = false;
let q = "", industry = "", type = "", tier = "", month = "", sort = "date", activeTheme = "";
let activeView = "list";
const PAGE_SIZE = 30;
let shownLimit = PAGE_SIZE;

// ── vocab / labels ───────────────────────────────────────────────────────
const industryZh = {
  semiconductor_manufacturing: "半導體製造", data_center: "資料中心", robotics_automation: "機器人自動化",
  power_grid_utilities: "電網公用", nuclear: "核能", space: "太空", ev_battery: "電動車電池",
  solar_storage: "太陽能儲能", power_generation: "發電", electronics_chip_design: "電子晶片設計",
  mining: "採礦", defense: "國防", telecom: "電信", other: "其他",
};
const typeZh = {
  contract_award: "合約授予", government_funding: "政府補助", capacity_expansion: "產能擴張",
  capacity_reduction: "產能縮減", commercial_deployment: "商業部署", technology_milestone: "技術里程碑",
  supply_agreement: "供應協議", partnership_joint_venture: "合作合資", merger_acquisition_investment: "併購投資",
  regulatory_policy: "法規政策", permit_authorization: "許可授權", production_disruption: "生產中斷",
  pricing_supply_shift: "價格供給轉變",
};
const tierZh = { critical: "關鍵", high: "高", relevant: "相關" };
const tierColor = { critical: "#DC2626", high: "#D97706", relevant: "#2563EB" };
const roleZh = { supplier: "供應商", customer: "客戶", manufacturer: "製造商", developer: "開發商", operator: "營運商", competitor: "競爭者", investor: "投資方", target: "標的", regulator: "監管機關", partner: "夥伴" };
const dirZh = { positive: "受惠", negative: "承壓", mixed: "中性偏混合", neutral: "中性" };
const nodeZh = {
  event_facts: "事件核心", technology_mechanism: "技術機制", value_chain_position: "價值鏈位置",
  investment_impact: "投資傳導", beneficiaries: "受益者", affected_parties: "受影響方",
  timeline_milestones: "時程里程碑", kpi_watch: "後續觀察", risks_unknowns: "風險未知", policy_mechanism: "政策機制",
};
const normKey = v => String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const indZ = v => industryZh[normKey(v)] || (v || "").replaceAll("_", " ") || "—";
const tZ = v => typeZh[normKey(v)] || (v || "").replaceAll("_", " ") || "—";

// ── date / score helpers ──────────────────────────────────────────────────
const evDate = e => e.event_date || (e.published_at || "").slice(0, 10) || "";
const evMonth = e => evDate(e).slice(0, 7);
const impScore = e => Number(e.importance_score ?? 0) || 0;
const tierOf = e => e.importance_tier || (impScore(e) >= 90 ? "critical" : impScore(e) >= 78 ? "high" : "relevant");

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };

// ── init ─────────────────────────────────────────────────────────────────
onAuth(({ isAdmin: a }) => { isAdmin = a; const p = document.getElementById("importPanel"); if (p) p.hidden = !a; if (root.dataset.ready) { renderShell(); applyView(); } });

(async function init() {
  root.innerHTML = `<p class="df-meta">載入中…</p>`;
  await refresh();
})();

async function refresh(rebuildIndex = false) {
  try { EVENTS = rebuildIndex ? await rebuildNewsIndex(COL) : await loadNews(COL); }
  catch { EVENTS = []; }
  renderShell(); applyView();
}

// ── shell ────────────────────────────────────────────────────────────────
function renderShell() {
  root.dataset.ready = "1";
  const empty = !EVENTS.length;
  root.innerHTML = `
    ${empty ? `<div class="df-banner">目前<b>尚無資料</b>（Firestore <code>industry_news</code> 尚未建立或為空）。頁面版面已就緒，待 <code>industry-news-daily</code> skill 產出資料後即自動顯示。登入白名單帳號可用上方「ADD JSON」手動匯入。</div>` : ""}

    <div class="df-tabs" role="tablist">
      <button class="df-tab ${activeView === "list" ? "active" : ""}" data-view="list" role="tab">事件動態</button>
      <button class="df-tab ${activeView === "eta" ? "active" : ""}" data-view="eta" role="tab">ETL 分析</button>
    </div>

    <section class="df-pane" id="pane-list" ${activeView === "list" ? "" : "hidden"}>
      <div class="df-toolbar nm-toolbar">
        <input id="fSearch" class="df-input" placeholder="搜尋標題 / 公司 / ticker / 主題 / 產品…" value="${esc(q)}" />
        <span class="rv-sel-wrap"><select id="fMonth" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fIndustry" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fType" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fTier" class="rv-select"><option value="">全部重要度</option><option value="critical">關鍵</option><option value="high">高</option><option value="relevant">相關</option></select></span>
        <span class="rv-sel-wrap"><select id="fSort" class="rv-select"><option value="date">最新優先</option><option value="importance">重要度</option></select></span>
      </div>
      <div class="df-chips" id="chips"></div>
      <div class="df-listhead"><h3>事件</h3><span id="count" class="df-meta"></span></div>
      <div class="df-list" id="list"></div>
      <div class="df-more" id="moreWrap" hidden><button class="rp-btn ghost" id="moreBtn"></button></div>
    </section>

    <section class="df-pane" id="pane-eta" ${activeView === "eta" ? "" : "hidden"}>
      <section id="analytics"></section>
    </section>`;

  const months = [...new Set(EVENTS.map(evMonth).filter(Boolean))].sort().reverse();
  const fm = root.querySelector("#fMonth");
  if (month && !months.includes(month)) month = "";
  fm.innerHTML = `<option value="">全部月份</option>` + months.map(m => `<option value="${m}" ${m === month ? "selected" : ""}>${m}</option>`).join("");
  const fi = root.querySelector("#fIndustry");
  fi.innerHTML = `<option value="">全部產業</option>` + [...new Set(EVENTS.map(e => e.industry))].filter(Boolean).sort().map(c => `<option value="${c}" ${c === industry ? "selected" : ""}>${indZ(c)}</option>`).join("");
  const ft = root.querySelector("#fType");
  ft.innerHTML = `<option value="">全部類型</option>` + [...new Set(EVENTS.map(e => e.event_type))].filter(Boolean).sort().map(t => `<option value="${t}" ${t === type ? "selected" : ""}>${tZ(t)}</option>`).join("");
  root.querySelector("#fTier").value = tier;
  root.querySelector("#fSort").value = sort;

  root.querySelector("#fSearch").oninput = e => { q = e.target.value.trim().toLowerCase(); shownLimit = PAGE_SIZE; applyFilters(); };
  fm.onchange = e => { month = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  fi.onchange = e => { industry = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  ft.onchange = e => { type = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#fTier").onchange = e => { tier = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#fSort").onchange = e => { sort = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#moreBtn").onclick = () => { shownLimit += PAGE_SIZE; applyFilters(); };
  root.querySelectorAll(".df-tabs [data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));
}

function setView(v) {
  if (v === activeView) return;
  activeView = v;
  root.querySelectorAll(".df-tabs [data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  ["list", "eta"].forEach(k => { const p = root.querySelector(`#pane-${k}`); if (p) p.hidden = k !== v; });
  applyView();
}

function applyView() {
  applyFilters();
  if (activeView === "eta") renderAnalytics();
}

// ── event feed ─────────────────────────────────────────────────────────
function collectThemes(list) {
  const m = new Map(); list.forEach(e => (e.themes || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
}

function applyFilters() {
  if (!root.querySelector("#list")) return;
  let list = EVENTS.filter(e => {
    const hay = JSON.stringify({
      a: e.title_zh, b: e.title_original, c: e.summary_zh, d: e.why_it_matters, t: e.themes,
      tk: e.tickers, co: (e.companies || []).map(x => [x.name, x.ticker]), p: e.products, k: e.search_keywords,
    }).toLowerCase();
    return (!q || hay.includes(q)) && (!industry || e.industry === industry) && (!type || e.event_type === type)
      && (!tier || tierOf(e) === tier) && (!month || evMonth(e) === month)
      && (!activeTheme || (e.themes || []).includes(activeTheme));
  });
  if (sort === "importance") list.sort((a, b) => impScore(b) - impScore(a));
  else list.sort((a, b) => String(evDate(b)).localeCompare(String(evDate(a))));

  const chips = root.querySelector("#chips");
  chips.innerHTML = collectThemes(EVENTS).map(([t, c]) => `<button class="df-chip ${activeTheme === t ? "active" : ""}" data-theme="${esc(t)}">${esc(t)} <span>${c}</span></button>`).join("");
  chips.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => { activeTheme = activeTheme === b.dataset.theme ? "" : b.dataset.theme; shownLimit = PAGE_SIZE; applyFilters(); });

  const shown = list.slice(0, shownLimit);
  root.querySelector("#count").textContent = list.length > shown.length ? `顯示 ${shown.length} / ${list.length} 筆` : `${list.length} 筆`;
  const box = root.querySelector("#list");
  if (!list.length) box.innerHTML = `<p class="df-meta">沒有符合條件的事件。</p>`;
  else {
    box.innerHTML = shown.map(cardHTML).join("");
    box.querySelectorAll("[data-open]").forEach(el => el.onclick = () => openDetail(list.find(e => keyOf(e) === el.dataset.open)));
    if (isAdmin) box.querySelectorAll("[data-del]").forEach(b => b.onclick = async ev => { ev.stopPropagation(); if (confirm("刪除此事件？")) { await deleteNews(COL, b.dataset.del); await refresh(true); } });
  }
  const moreWrap = root.querySelector("#moreWrap"), moreBtn = root.querySelector("#moreBtn");
  const rest = list.length - shown.length;
  moreWrap.hidden = rest <= 0;
  if (rest > 0) moreBtn.textContent = `載入更多（+${Math.min(PAGE_SIZE, rest)}，剩 ${rest} 筆）`;
}

const keyOf = e => e.__id || e.event_id || e.slug || e.title_zh;

function cardHTML(e) {
  const t = tierOf(e);
  const tickers = (e.tickers || []).slice(0, 6);
  return `<article class="df-card nm-card" data-open="${esc(keyOf(e))}" tabindex="0">
    <div class="df-card-main">
      <div class="df-card-meta">${indZ(e.industry)} · ${tZ(e.event_type)} · ${esc(evDate(e))}${(e.regions || []).length ? ` · ${esc((e.regions || []).join("/"))}` : ""}</div>
      <h4 class="df-card-title">${esc(e.title_zh || e.title_original)}</h4>
      <p class="df-card-sum">${esc(e.summary_zh || "")}</p>
      ${e.why_it_matters ? `<p class="in-why">${esc(e.why_it_matters)}</p>` : ""}
      <div class="df-tags">${(e.themes || []).slice(0, 8).map(x => `<span class="df-tag">${esc(x)}</span>`).join("")}</div>
    </div>
    <aside class="df-card-side">
      <div class="in-tier" style="background:${tierColor[t]}">${tierZh[t] || t} · ${impScore(e)}</div>
      ${tickers.length ? `<div class="in-tickers">${tickers.map(tk => `<span class="df-tk">${esc(tk)}</span>`).join("")}</div>` : `<div class="df-tk private">無上市標的</div>`}
      ${(e.content_nodes || []).length ? `<div class="in-nodecount">${(e.content_nodes || []).length} 個內容節點</div>` : ""}
      ${isAdmin && e.__id ? `<button class="rp-btn ghost df-del" data-del="${esc(e.__id)}">刪除</button>` : ""}
    </aside>
  </article>`;
}

function openDetail(e) {
  if (!e) return;
  const t = tierOf(e);
  const src = (e.sources || []).find(s => s.is_primary) || (e.sources || [])[0];
  const nodes = (e.content_nodes || []).map(n => `
    <div class="in-node">
      <div class="in-node-head"><span class="in-node-type">${esc(nodeZh[n.node_type] || n.node_type)}</span>${n.evidence ? `<span class="in-node-ev">${esc(n.evidence)}</span>` : ""}</div>
      ${n.title_zh ? `<div class="in-node-title">${esc(n.title_zh)}</div>` : ""}
      <p class="in-node-sum">${esc(n.summary_zh || "")}</p>
      ${(n.bullets || []).length ? `<ul class="in-node-bullets">${(n.bullets || []).map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    </div>`).join("");
  const companies = (e.companies || []).map(c => `
    <div class="in-co">
      <span class="in-co-name">${esc(c.name || "")}${c.ticker ? ` <span class="df-tk">${esc(c.ticker)}</span>` : ""}</span>
      <span class="in-co-meta">${[roleZh[c.role] || c.role, dirZh[c.impact_direction] || c.impact_direction].filter(Boolean).join(" · ")}</span>
      ${c.impact_mechanism ? `<span class="in-co-mech">${esc(c.impact_mechanism)}</span>` : ""}
    </div>`).join("");
  const sc = e.supply_chain || {};
  const scChain = ["upstream", "component", "supplier", "customer", "end_market"]
    .map(k => ({ k, v: sc[k] || [] })).filter(x => x.v.length);
  const scZh = { upstream: "上游", component: "元件", supplier: "供應商", customer: "客戶", end_market: "終端市場" };
  const metrics = (e.metrics || []).map(m => `<div class="df-tag">${esc(m.name || "")}: <b>${esc(m.value)}</b>${m.unit ? " " + esc(m.unit) : ""}${m.period ? `（${esc(m.period)}）` : ""}</div>`).join("");
  const milestones = (e.milestones || []).map(m => `<div class="in-ms"><span>${esc(m.date || "")}</span>${esc(m.label_zh || "")} ${m.status ? `<i>${esc(m.status)}</i>` : ""}</div>`).join("");
  const watch = (e.watch_items || []).map(w => `<li>${esc(w.question_zh || "")}${w.indicator ? `（指標：${esc(w.indicator)}）` : ""}</li>`).join("");
  const fd = e.financial_data || {};
  const fdBits = [];
  if (fd.amount != null) fdBits.push(`金額 ${esc(fd.amount)}${fd.currency ? " " + esc(fd.currency) : ""}`);
  if (fd.capacity_change_pct != null) fdBits.push(`產能 ${esc(fd.capacity_change_pct)}%`);
  if (fd.contract_duration_years != null) fdBits.push(`合約 ${esc(fd.contract_duration_years)} 年`);
  if (fd.effective_date) fdBits.push(`生效 ${esc(fd.effective_date)}`);

  let modal = document.getElementById("dfModal");
  if (!modal) { modal = document.createElement("div"); modal.id = "dfModal"; modal.className = "df-modal"; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="df-modal-box">
    <button class="df-modal-close" aria-label="關閉">×</button>
    <div class="df-card-meta">${indZ(e.industry)} · ${tZ(e.event_type)} · ${esc(evDate(e))} · <span style="color:${tierColor[t]}">${tierZh[t] || t}（${impScore(e)}）</span></div>
    <h3 class="df-modal-title">${esc(e.title_zh || e.title_original)}</h3>
    ${e.title_zh && e.title_original ? `<div class="df-orig">原文：${esc(e.title_original)}</div>` : ""}
    <p class="df-modal-sum">${esc(e.summary_zh || "")}</p>
    ${e.why_it_matters ? `<div class="nm-why"><b>為何重要：</b>${esc(e.why_it_matters)}</div>` : ""}
    ${fdBits.length ? `<div class="df-tags">${fdBits.map(x => `<span class="df-prog">${esc(x)}</span>`).join("")}</div>` : ""}

    ${nodes ? `<div class="df-block"><h5>內容節點</h5><div class="in-nodes">${nodes}</div></div>` : ""}
    ${companies ? `<div class="df-block"><h5>相關公司</h5><div class="in-cos">${companies}</div></div>` : ""}
    ${scChain.length ? `<div class="df-block"><h5>價值鏈</h5><div class="in-scchain">${scChain.map(x => `<span class="in-scnode"><b>${scZh[x.k]}</b> ${esc(x.v.join("、"))}</span>`).join('<span class="in-scarrow">→</span>')}</div></div>` : ""}
    ${metrics ? `<div class="df-block"><h5>關鍵指標</h5><div class="df-tags">${metrics}</div></div>` : ""}
    ${milestones ? `<div class="df-block"><h5>時程</h5>${milestones}</div>` : ""}
    ${watch ? `<div class="df-block"><h5>後續觀察</h5><ul class="in-watch">${watch}</ul></div>` : ""}

    ${src?.url && /^https?:\/\//.test(src.url) ? `<a class="rp-btn" href="${esc(src.url)}" target="_blank" rel="noopener">開啟 ${esc(src.publisher || "來源")} ↗</a>` : `<div class="df-meta">此筆無來源連結</div>`}
  </div>`;
  modal.classList.add("open");
  const close = () => modal.classList.remove("open");
  modal.querySelector(".df-modal-close").onclick = close;
  modal.onclick = ev => { if (ev.target === modal) close(); };
  document.addEventListener("keydown", function onEsc(ev) { if (ev.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } });
}

// ── ETL analytics ─────────────────────────────────────────────────────
function hbars(rows, fmt, color = "var(--accent)") {
  if (!rows.length) return `<p class="df-meta">無資料</p>`;
  const max = Math.max(...rows.map(r => r.value), 1);
  return `<div class="df-bars">${rows.map(r => `
    <div class="df-bar-row">
      <span class="df-bar-label" title="${esc(r.label)}">${esc(r.label)}${r.sub ? ` <i>${esc(r.sub)}</i>` : ""}</span>
      <span class="df-bar-track"><span class="df-bar-fill" style="width:${(r.value / max * 100).toFixed(1)}%;background:${r.color || color}"></span></span>
      <span class="df-bar-val">${fmt(r.value)}</span>
    </div>`).join("")}</div>`;
}

function tally(E, keyFn, listFn) {
  const m = {};
  E.forEach(e => {
    const keys = listFn ? listFn(e) : [keyFn(e)];
    (keys || []).forEach(k => { if (k == null || k === "") return; m[k] = (m[k] || 0) + 1; });
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function renderAnalytics() {
  const host = document.getElementById("analytics");
  if (!host) return;
  const E = EVENTS;
  if (!E.length) { host.innerHTML = `<p class="df-meta">尚無資料可供分析。待 <code>industry_news</code> 有事件後，此處會就地彙整產業、事件類型、重要度分布與熱門 ticker / 主題等統計。</p>`; return; }

  const tickers = new Set(E.flatMap(e => e.tickers || []));
  const industries = new Set(E.map(e => e.industry).filter(Boolean));
  const critical = E.filter(e => tierOf(e) === "critical").length;
  const avgScore = E.length ? Math.round(E.reduce((s, e) => s + impScore(e), 0) / E.length) : 0;

  const byIndustry = tally(E, e => e.industry).map(([k, v]) => ({ label: indZ(k), value: v }));
  const byType = tally(E, e => e.event_type).map(([k, v]) => ({ label: tZ(k), value: v })).slice(0, 12);
  const byTier = tally(E, tierOf).map(([k, v]) => ({ label: tierZh[k] || k, value: v, color: tierColor[k] }));
  const byTicker = tally(E, null, e => e.tickers || []).slice(0, 12).map(([k, v]) => ({ label: k, value: v }));
  const byTheme = tally(E, null, e => e.themes || []).slice(0, 12).map(([k, v]) => ({ label: k, value: v }));

  host.innerHTML = `
    <p class="df-meta df-note">就地彙整目前載入的 ${E.length} 筆產業事件。聚焦真正影響科技產業、價值鏈與上市公司的動態；每筆事件的重要度為 65–100 分。</p>

    <div class="df-stats nm-stats">
      <div class="df-stat"><div class="df-stat-l">事件數</div><div class="df-stat-v">${E.length}</div></div>
      <div class="df-stat"><div class="df-stat-l">涉及產業</div><div class="df-stat-v">${industries.size}</div></div>
      <div class="df-stat"><div class="df-stat-l">相關 ticker</div><div class="df-stat-v">${tickers.size}</div></div>
      <div class="df-stat"><div class="df-stat-l">關鍵事件</div><div class="df-stat-v accent">${critical}</div></div>
      <div class="df-stat"><div class="df-stat-l">平均重要度</div><div class="df-stat-v">${avgScore}</div></div>
    </div>

    <div class="df-anagrid">
      <div class="df-anacard"><h4>產業分布</h4>${hbars(byIndustry, v => v + " 筆", "var(--accent)")}</div>
      <div class="df-anacard"><h4>事件類型分布</h4>${hbars(byType, v => v + " 筆", "#9C6B44")}</div>
      <div class="df-anacard"><h4>重要度分布</h4>${hbars(byTier, v => v + " 筆")}</div>
      <div class="df-anacard"><h4>熱門 ticker</h4>${hbars(byTicker, v => v + " 筆", "#2563EB")}</div>
      <div class="df-anacard"><h4>熱門主題</h4>${hbars(byTheme, v => v + " 筆", "#5C8A5C")}</div>
    </div>

    <div class="df-anacard"><h4>事件時間序列 <span class="df-meta">（每月筆數）</span></h4><div id="inTimeline" class="df-chartbox"></div></div>`;

  drawTimeline(host.querySelector("#inTimeline"));
}

function drawTimeline(host) {
  if (!host) return;
  const months = tally(EVENTS, evMonth).filter(([k]) => k).sort((a, b) => a[0].localeCompare(b[0]));
  if (months.length < 1) { host.innerHTML = `<p class="df-meta">無足夠資料。</p>`; return; }
  const W = Math.max(host.clientWidth || 720, 480), H = 220, padL = 40, padR = 14, padT = 14, padB = 40;
  const max = Math.max(...months.map(m => m[1]), 1);
  const bw = (W - padL - padR) / months.length;
  const Y = v => H - padB - (v / max) * (H - padT - padB);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "df-svg", width: "100%", height: H });
  [0, 0.5, 1].forEach(g => {
    svg.appendChild(svgEl("line", { x1: padL, y1: Y(max * g), x2: W - padR, y2: Y(max * g), class: "df-grid" }));
    const t = svgEl("text", { x: padL - 6, y: Y(max * g) + 3, class: "df-axis", "text-anchor": "end" }); t.textContent = Math.round(max * g); svg.appendChild(t);
  });
  months.forEach(([m, n], i) => {
    const x = padL + i * bw + bw * 0.18, w = bw * 0.64, y = Y(n);
    svg.appendChild(svgEl("rect", { x, y, width: w, height: H - padB - y, rx: 2, fill: "var(--accent)" }));
    if (months.length <= 18 || i % 2 === 0) { const t = svgEl("text", { x: x + w / 2, y: H - padB + 14, class: "df-axis", "text-anchor": "middle" }); t.textContent = m.slice(2); svg.appendChild(t); }
  });
  host.innerHTML = ""; host.appendChild(svg);
}

// ── admin importer ────────────────────────────────────────────────────
export function wireImporter() {
  const btn = document.getElementById("publishBtn"), status = document.getElementById("pubStatus"), ta = document.getElementById("jsonInput");
  if (!btn) return;
  btn.onclick = async () => {
    status.className = "rp-status"; status.textContent = "解析中…";
    try {
      const { events } = parseNewsRun(ta.value);
      status.textContent = `寫入 ${events.length} 筆…`;
      const n = await saveNews(COL, events, e => e.event_date || (e.published_at || "").slice(0, 10) || "");
      status.className = "rp-status ok"; status.textContent = `✓ 已發布 ${n} 筆`;
      ta.value = ""; await refresh(true);
    } catch (e) {
      status.className = "rp-status err";
      status.textContent = /permission|insufficient/i.test(e.message || "") ? "✗ 權限不足：帳號需在白名單且已部署 Firestore 規則。" : "✗ " + e.message;
    }
  };
}
