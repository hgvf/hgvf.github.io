// defenseview.js — 每日軍武合約 (Daily Defense Contracts), restyled into the
// site's Stock section (brown theme). Two tabs: 合約動態 (event list) and
// 合約分析 · ETL. Reads the single-doc index via defensedata.js; whitelisted
// users publish through the ADD JSON importer.
import { esc, onAuth } from "./reports.js";
import {
  parseDefenseRun, saveDefenseEvents, loadDefenseEvents, rebuildDefenseIndex, deleteDefenseEvent,
} from "./defensedata.js";

const root = document.getElementById("app");
let EVENTS = [];
let usingSample = false, isAdmin = false;
let activeTag = "", q = "", country = "", type = "", market = "", sort = "date", month = "";
let activeView = "list";
const PAGE_SIZE = 30;
let shownLimit = PAGE_SIZE;

// ── 對照表 / 換算 ──────────────────────────────────────────────────────
const countryZh = { US: "美國", TW: "台灣", JP: "日本", KR: "韓國", AU: "澳洲", GB: "英國", FR: "法國", DE: "德國", IN: "印度", IL: "以色列" };
const typeZh = {
  contract_award: "新合約", contract_modification: "合約修改", development: "研發",
  program_decision: "計畫決策", procurement: "採購", research: "研究", test: "測試",
  foreign_military_sale: "對外軍售", tender: "招標", sustainment: "維持/後勤",
  upgrade: "升級", production: "量產", rfp: "需求徵詢", delivery: "交付",
};
const serviceZh = { Navy: "海軍", Army: "陸軍", "Air Force": "空軍", Joint: "聯合", "Marine Corps": "陸戰隊", "Space Force": "太空軍", "Coast Guard": "海巡" };
// 計畫類別中文；專有名詞（縮寫）保留英文原文。
const CAT_KEEP = new Set(["c4isr", "c2", "c4i", "isr", "uav", "uas", "sam", "ew", "ai", "gps", "sof"]);
const categoryZh = {
  aircraft: "飛機", radar_sensor: "雷達／感測", drone: "無人機", missile: "飛彈",
  weapon_component: "武器零組件", ground_vehicle: "地面載具", naval: "艦艇",
  air_defense: "防空", engine_propulsion: "發動機／推進", electronic_warfare: "電子戰",
  helicopter: "直升機", munition: "彈藥", space: "太空", cyber: "網路戰",
  logistics: "後勤", training: "訓練", satellite: "衛星", submarine: "潛艦",
  small_arms: "輕兵器", artillery: "火砲", ammunition: "彈藥", shipbuilding: "造船",
  services: "服務", construction: "工程", unknown: "未分類",
};
const normKey = v => String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const tZ = v => typeZh[normKey(v)] || (v || "").replaceAll("_", " ") || "—";
const sZ = v => serviceZh[v] || v || "—";
const cZ = v => countryZh[v] || v;
const catZ = v => {
  const k = normKey(v);
  if (CAT_KEEP.has(k)) return k.toUpperCase();
  return categoryZh[k] || (v || "").replaceAll("_", " ") || "未分類";
};

// 匯率（近似、靜態；隨時可於此調整）。金額統一換算為 USD 以便跨國比較。
const CCY_SYM = { USD: "$", TWD: "NT$", JPY: "¥", KRW: "₩", EUR: "€", GBP: "£", AUD: "A$", CNY: "¥", SGD: "S$" };
const FX_USD = { USD: 1, JPY: 1 / 150, KRW: 1 / 1350, TWD: 1 / 32, EUR: 1.08, GBP: 1.27, AUD: 0.66, CNY: 1 / 7.2, SGD: 0.74 };
const toUSD = (v, ccy) => (v == null ? 0 : v * (FX_USD[ccy] != null ? FX_USD[ccy] : 1));
function fmtAmt(v, ccy = "USD") {
  if (v == null) return "—";
  const s = CCY_SYM[ccy] || (ccy ? ccy + " " : ""), a = Math.abs(v);
  if (a >= 1e9) return s + (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + (v / 1e3).toFixed(1) + "K";
  return s + Number(v).toLocaleString();
}
const usd = v => fmtAmt(v, "USD");

// ticker 正規化：去頭尾空白、轉大寫、去掉尾端的點（"BA." → "BA"，與 "BA" 視為同一間）。
const normTicker = t => t ? String(t).trim().toUpperCase().replace(/[.\s]+$/, "") : null;
const listedTicker = c => !c ? null : (c.ticker ? { t: normTicker(c.ticker), ex: c.exchange, basis: "direct" } : c.parent_ticker ? { t: normTicker(c.parent_ticker), ex: c.exchange, basis: "parent" } : null);
const isListed = e => !!listedTicker(e.contractor);
const evYear = e => (e.publication_date || e.event_date || "").slice(0, 4);
const evMonth = e => (e.publication_date || e.event_date || "").slice(0, 7);
const evUSD = e => toUSD(e.contract?.amount, e.contract?.currency || "USD");
// 承包商顯示名 + 縮寫（histogram x 軸用）。
const CORP_SUFFIX = /\b(inc|corp|corporation|co|company|ltd|limited|llc|lp|plc|gmbh|ag|sa|nv|bv|as)\b\.?/gi;
function contractorName(e) { const c = e.contractor || {}; return c.name || c.name_raw || "未列承包商"; }
function contractorShort(e) {
  const c = e.contractor || {}, tk = listedTicker(c);
  if (tk) return tk.t;
  const n = contractorName(e);
  return n.length > 12 ? n.replace(CORP_SUFFIX, "").trim().slice(0, 12) : n;
}
// 正規化公司名（合併大小寫、法人後綴、標點差異）。
const normName = n => String(n || "").toLowerCase().replace(CORP_SUFFIX, "").replace(/[^a-z0-9]+/g, " ").trim();
// 統一的公司識別：有 ticker 用正規化 ticker，否則用正規化名稱 —— 讓
// "BA" / "BA." / "The Boeing Co." 等同一間合併成單一長條 / 單一顏色。
function companyIdentity(e) {
  const tk = listedTicker(e.contractor);
  const name = contractorName(e);
  const key = tk ? "T:" + tk.t : "N:" + (normName(name) || name.toLowerCase());
  return { key, ticker: tk ? tk.t : null, name, short: contractorShort(e) };
}

// ── SVG helper ─────────────────────────────────────────────────────────
const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }

// ── init ───────────────────────────────────────────────────────────────
onAuth(({ isAdmin: a }) => { isAdmin = a; const p = document.getElementById("importPanel"); if (p) p.hidden = !a; if (root.dataset.ready) { renderShell(); applyView(); } });

(async function init() {
  root.innerHTML = `<p class="df-meta">載入中…</p>`;
  await refresh();
})();

async function loadSample() {
  try { const s = await (await fetch("../data/defense-sample.json")).json(); EVENTS = (s.events || []).map(e => ({ __id: null, ...e })); }
  catch { EVENTS = []; }
  usingSample = true;
}

async function refresh(rebuildIndex = false) {
  try {
    const rows = rebuildIndex ? await rebuildDefenseIndex() : await loadDefenseEvents();
    if (rows.length) { EVENTS = rows.map(m => ({ __id: m.id, ...m.data })); usingSample = false; }
    else { await loadSample(); }
  } catch { await loadSample(); }
  renderShell(); applyView();
}

// ── shell ──────────────────────────────────────────────────────────────
function renderShell() {
  root.dataset.ready = "1";
  root.innerHTML = `
    ${usingSample ? `<div class="df-banner">目前顯示<b>示意資料</b>（Firestore <code>mil_defense_daily</code> 尚無資料）。登入白名單帳號後可用上方「ADD JSON」發布真實資料。</div>` : ""}

    <div class="df-tabs" role="tablist">
      <button class="df-tab ${activeView === "list" ? "active" : ""}" data-view="list" role="tab">合約動態</button>
      <button class="df-tab ${activeView === "eta" ? "active" : ""}" data-view="eta" role="tab">合約分析 · ETL</button>
    </div>

    <section class="df-pane" id="pane-list" ${activeView === "list" ? "" : "hidden"}>
      <div class="df-toolbar">
        <input id="fSearch" class="df-input" placeholder="搜尋標題 / 計畫 / 承包商 / ticker…" value="${esc(q)}" />
        <span class="rv-sel-wrap"><select id="fMonth" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fCountry" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fType" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fMarket" class="rv-select"><option value="">全部承包商</option><option value="listed">僅上市</option><option value="private">非上市</option></select></span>
        <span class="rv-sel-wrap"><select id="fSort" class="rv-select"><option value="date">最新優先</option><option value="importance">重要度</option><option value="amount">金額</option></select></span>
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
  const fc = root.querySelector("#fCountry"); fc.innerHTML = `<option value="">全部國家</option>` + [...new Set(EVENTS.map(e => e.country))].filter(Boolean).sort().map(c => `<option value="${c}" ${c === country ? "selected" : ""}>${cZ(c)}</option>`).join("");
  const ft = root.querySelector("#fType"); ft.innerHTML = `<option value="">全部類型</option>` + [...new Set(EVENTS.map(e => e.event_type))].filter(Boolean).sort().map(t => `<option value="${t}" ${t === type ? "selected" : ""}>${tZ(t)}</option>`).join("");
  root.querySelector("#fSort").value = sort;
  root.querySelector("#fMarket").value = market;
  root.querySelector("#fSearch").oninput = e => { q = e.target.value.trim().toLowerCase(); shownLimit = PAGE_SIZE; applyFilters(); };
  fm.onchange = e => { month = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  fc.onchange = e => { country = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  ft.onchange = e => { type = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#fMarket").onchange = e => { market = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#fSort").onchange = e => { sort = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#moreBtn").onclick = () => { shownLimit += PAGE_SIZE; applyFilters(); };
  root.querySelectorAll(".df-tabs [data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));
}

function setView(v) {
  if (v === activeView) return;
  activeView = v;
  root.querySelectorAll(".df-tabs [data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  const pl = root.querySelector("#pane-list"), pe = root.querySelector("#pane-eta");
  if (pl) pl.hidden = v !== "list";
  if (pe) pe.hidden = v !== "eta";
  applyView();
}

function applyView() {
  applyFilters();
  if (activeView === "eta") renderAnalytics();
}

// ── 合約動態清單 ────────────────────────────────────────────────────────
function collectTags(list) {
  const m = new Map(); list.forEach(e => (e.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
}

function applyFilters() {
  if (!root.querySelector("#list")) return;
  let list = EVENTS.filter(e => {
    const c = e.contractor || {};
    const hay = JSON.stringify({ a: e.title, b: e.title_zh, c: e.summary_zh, d: e.summary, t: e.tags, p: e.programs, k: c.name, tk: c.ticker, pt: c.parent_ticker, ag: e.agency }).toLowerCase();
    const mk = !market || (market === "listed" && isListed(e)) || (market === "private" && !isListed(e));
    const mo = !month || evMonth(e) === month;
    return (!q || hay.includes(q)) && (!country || e.country === country) && (!type || e.event_type === type) && mk && mo && (!activeTag || (e.tags || []).includes(activeTag));
  });
  if (sort === "importance") list.sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
  else if (sort === "amount") list.sort((a, b) => evUSD(b) - evUSD(a));
  else list.sort((a, b) => String(b.publication_date || "").localeCompare(String(a.publication_date || "")));

  const chips = root.querySelector("#chips");
  chips.innerHTML = collectTags(EVENTS).map(([t, c]) => `<button class="df-chip ${activeTag === t ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)} <span>${c}</span></button>`).join("");
  chips.querySelectorAll("[data-tag]").forEach(b => b.onclick = () => { activeTag = activeTag === b.dataset.tag ? "" : b.dataset.tag; shownLimit = PAGE_SIZE; applyFilters(); });

  const shown = list.slice(0, shownLimit);
  root.querySelector("#count").textContent = list.length > shown.length ? `顯示 ${shown.length} / ${list.length} 筆` : `${list.length} 筆`;
  const box = root.querySelector("#list");
  if (!list.length) box.innerHTML = `<p class="df-meta">沒有符合條件的事件。</p>`;
  else {
    box.innerHTML = shown.map(cardHTML).join("");
    box.querySelectorAll("[data-open]").forEach(el => el.onclick = () => openDetail(list.find(e => (e.__id || e.event_id || e.title) === el.dataset.open)));
    if (isAdmin) box.querySelectorAll("[data-del]").forEach(b => b.onclick = async ev => { ev.stopPropagation(); if (confirm("刪除此事件？")) { await deleteDefenseEvent(b.dataset.del); await refresh(true); } });
  }
  const moreWrap = root.querySelector("#moreWrap"), moreBtn = root.querySelector("#moreBtn");
  const rest = list.length - shown.length;
  moreWrap.hidden = rest <= 0;
  if (rest > 0) moreBtn.textContent = `載入更多（+${Math.min(PAGE_SIZE, rest)}，剩 ${rest} 筆）`;
}

function cardHTML(e) {
  const c = e.contractor || {}, ct = e.contract || {};
  const tk = listedTicker(c);
  const key = e.__id || e.event_id || e.title;
  const programs = (e.programs || []).map(p => { const zh = p.name_zh || p.canonical_name || p.program_name_raw || "計畫"; return `<span class="df-prog">${esc(zh)}</span>`; }).join("");
  return `<article class="df-card" data-open="${esc(key)}" tabindex="0">
    <div class="df-card-main">
      <div class="df-card-meta">${cZ(e.country)} · ${sZ(e.service)} · ${tZ(e.event_type)} · ${esc(e.publication_date || "")}</div>
      <h4 class="df-card-title">${esc(e.title_zh || e.title)}</h4>
      <p class="df-card-sum">${esc(e.summary_zh || e.summary || "")}</p>
      ${programs ? `<div class="df-progs">${programs}</div>` : ""}
      <div class="df-tags">${(e.tags || []).map(t => `<span class="df-tag">#${esc(t)}</span>`).join("")}</div>
      ${e.quality?.needs_review ? `<div class="df-review">需人工複核：${esc((e.quality.issues || []).join(" "))}</div>` : ""}
    </div>
    <aside class="df-card-side">
      <div class="df-amt">${fmtAmt(ct.amount, ct.currency || "USD")}</div>
      ${ct.currency && ct.currency !== "USD" && ct.amount != null ? `<div class="df-amt-usd">≈ ${usd(evUSD(e))}</div>` : ""}
      ${ct.contract_number ? `<div class="df-cno">合約 ${esc(ct.contract_number)}</div>` : ""}
      <div class="df-company">
        <div class="df-cname">${esc(c.name || "未列承包商")}</div>
        ${tk ? `<div><span class="df-tk">${esc(tk.t)}</span>${tk.ex ? ` <span class="df-ex">${esc(tk.ex)}</span>` : ""}</div>` : `<div><span class="df-tk private">${c.ticker_basis === "government" ? "政府/學研" : c.ticker_basis === "private" ? "私人公司" : "非上市"}</span></div>`}
      </div>
      <div class="df-score">重要度 ${e.importance_score ?? 0}</div>
      ${isAdmin && e.__id ? `<button class="rp-btn ghost df-del" data-del="${esc(e.__id)}">刪除</button>` : ""}
    </aside>
  </article>`;
}

function openDetail(e) {
  if (!e) return;
  const c = e.contractor || {}, ct = e.contract || {}, src = (e.sources || [])[0];
  let modal = document.getElementById("dfModal");
  if (!modal) { modal = document.createElement("div"); modal.id = "dfModal"; modal.className = "df-modal"; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="df-modal-box">
    <button class="df-modal-close" aria-label="關閉">×</button>
    <div class="df-card-meta">${cZ(e.country)} · ${e.agency || sZ(e.service)} · ${tZ(e.event_type)} · ${esc(e.publication_date || "")}</div>
    <h3 class="df-modal-title">${esc(e.title_zh || e.title)}</h3>
    ${e.title_zh && e.title ? `<div class="df-orig">英文原文：${esc(e.title)}</div>` : ""}
    <p class="df-modal-sum">${esc(e.summary_zh || e.summary || "")}</p>
    ${e.summary_zh && e.summary ? `<details class="df-en"><summary>查看英文原文摘要</summary><p>${esc(e.summary)}</p></details>` : ""}
    <div class="df-grid2">
      <div><span>承包商</span>${esc(c.name_raw || c.name || "—")}</div>
      <div><span>合約編號</span>${esc(ct.contract_number || "—")}</div>
      <div><span>金額</span>${esc(ct.amount_raw || fmtAmt(ct.amount, ct.currency || "USD"))}${ct.currency && ct.currency !== "USD" && ct.amount != null ? `（≈ ${usd(evUSD(e))}）` : ""}</div>
      <div><span>預計完成</span>${esc(e.action?.expected_completion_date || "—")}</div>
      ${listedTicker(c) ? `<div><span>對應股票</span>${esc(listedTicker(c).t)} ${esc(listedTicker(c).ex || "")}</div>` : ""}
    </div>
    ${(e.programs || []).length ? `<div class="df-block"><h5>相關計畫</h5><div class="df-progs">${(e.programs || []).map(p => `<span class="df-prog">${esc(p.name_zh || p.canonical_name || p.program_name_raw)}</span>`).join("")}</div></div>` : ""}
    ${src?.url && /^https?:\/\//.test(src.url) ? `<a class="rp-btn" href="${esc(src.url)}" target="_blank" rel="noopener">開啟 ${esc(src.publisher || "官方來源")} ↗</a>` : `<div class="df-meta">此筆無官方來源連結</div>`}
  </div>`;
  modal.classList.add("open");
  const close = () => modal.classList.remove("open");
  modal.querySelector(".df-modal-close").onclick = close;
  modal.onclick = ev => { if (ev.target === modal) close(); };
  document.addEventListener("keydown", function onEsc(ev) { if (ev.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } });
}

// ── ETL 分析 ────────────────────────────────────────────────────────────
let anaContractor = "";      // 承包商深入檢視選取
let chartYear = "";          // histogram/line 年份 filter
let chartMode = "bar";       // bar | line
let selectedCompanies = new Set();  // 圖表上被點選的公司（跨長條/折線共用）

// 公司配色（cream 背景可辨識）。依當前 pool 的總額排序，前 N 名各給一色，
// 其餘統一灰色。點 legend 或長條可加入/移除 selectedCompanies。
const CHART_PALETTE = ["#8B5E3C", "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0891B2", "#65A30D", "#9333EA", "#E11D48", "#0D9488", "#CA8A04", "#4F46E5", "#B45309", "#15803D"];
const MUTED_COLOR = "#B8A894";
let _colorMap = new Map();
const colorFor = name => _colorMap.get(name) || MUTED_COLOR;

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

function renderAnalytics() {
  const host = document.getElementById("analytics");
  if (!host) return;
  const E = EVENTS;
  if (!E.length) { host.innerHTML = `<p class="df-meta">尚無資料。</p>`; return; }

  const sum = arr => arr.reduce((s, x) => s + x, 0);
  const withAmt = E.filter(e => e.contract?.amount != null);
  const totalUSD = sum(withAmt.map(evUSD));

  // 承包商彙整（USD）
  const contractors = new Map();
  withAmt.forEach(e => {
    const name = contractorName(e);
    const cur = contractors.get(name) || { value: 0, n: 0, ticker: null, short: contractorShort(e) };
    cur.value += evUSD(e); cur.n++; cur.ticker = cur.ticker || (listedTicker(e.contractor)?.t || null);
    contractors.set(name, cur);
  });

  // 國別分布（統一換算 USD）
  const byCountry = {};
  E.forEach(e => { const c = e.country || "?"; (byCountry[c] ||= { v: 0, n: 0 }); byCountry[c].v += evUSD(e); byCountry[c].n++; });
  const countryRows = Object.entries(byCountry).map(([c, o]) => ({ label: cZ(c), value: o.v, sub: o.n + " 筆" })).sort((a, b) => b.value - a.value);

  // 事件類型分布（中文，筆數）
  const byType = {};
  E.forEach(e => { const t = e.event_type || "other"; byType[t] = (byType[t] || 0) + 1; });
  const typeRows = Object.entries(byType).map(([t, n]) => ({ label: tZ(t), value: n })).sort((a, b) => b.value - a.value);

  // 計畫類別分布（中文；專有名詞保留英文，筆數）
  const byCat = {};
  E.forEach(e => (e.programs || []).forEach(p => { const c = p.category || "unknown"; byCat[c] = (byCat[c] || 0) + 1; }));
  const catRows = Object.entries(byCat).map(([c, n]) => ({ label: catZ(c), value: n })).sort((a, b) => b.value - a.value).slice(0, 12);

  const distinctPrograms = new Set(E.flatMap(e => (e.programs || []).map(p => p.program_id || p.canonical_name || p.name_zh).filter(Boolean))).size;
  const contractorNames = [...contractors.keys()].sort();

  host.innerHTML = `
    <p class="df-meta df-note">就地彙整目前載入的 ${E.length} 筆事件；金額<b>統一以近似匯率換算為 USD</b> 以便跨國比較（ceiling ≠ 實支；匯率為靜態近似值）。</p>

    <div class="df-stats">
      <div class="df-stat"><div class="df-stat-l">事件數</div><div class="df-stat-v">${E.length}</div></div>
      <div class="df-stat"><div class="df-stat-l">合約總額（USD 約）</div><div class="df-stat-v accent">${usd(totalUSD)}</div></div>
      <div class="df-stat"><div class="df-stat-l">承包商數</div><div class="df-stat-v">${contractors.size}</div></div>
      <div class="df-stat"><div class="df-stat-l">計畫數</div><div class="df-stat-v">${distinctPrograms}</div></div>
    </div>

    <div class="df-anacard df-contractor">
      <div class="df-anacard-head">
        <h4>承包商深入檢視</h4>
        <span class="rv-sel-wrap"><select class="rv-select" id="anaContractor">
          <option value="">— 選擇承包商查看其所有合約 —</option>
          ${contractorNames.map(n => `<option value="${esc(n)}" ${n === anaContractor ? "selected" : ""}>${esc(n)}${contractors.get(n).ticker ? " (" + esc(contractors.get(n).ticker) + ")" : ""}</option>`).join("")}
        </select></span>
      </div>
      <div id="contractorPanel"></div>
    </div>

    <div class="df-anacard df-chartcard">
      <div class="df-anacard-head">
        <h4>合約金額分析 <span class="df-meta">（USD 換算）</span></h4>
        <div class="df-chart-ctl">
          <span class="rv-sel-wrap"><select class="rv-select" id="chartYear"></select></span>
          <div class="df-toggle" id="chartMode">
            <button data-mode="bar" class="${chartMode === "bar" ? "active" : ""}">長條圖·依公司</button>
            <button data-mode="line" class="${chartMode === "line" ? "active" : ""}">折線圖·依時間</button>
          </div>
        </div>
      </div>
      <p class="df-meta df-chart-hint">點選下方公司（或長條）加入/移除比較；折線圖會疊出各公司的<b>累積合約金額</b>曲線，未選取時顯示全部加總。</p>
      <div id="chartLegend" class="df-legend"></div>
      <div id="mainChart" class="df-chartbox"></div>
    </div>

    <div class="df-anagrid">
      <div class="df-anacard"><h4>國別合約分布 <span class="df-meta">（USD 換算）</span></h4>${hbars(countryRows, usd, "var(--accent)")}</div>
      <div class="df-anacard"><h4>事件類型分布 <span class="df-meta">（筆數）</span></h4>${hbars(typeRows, v => v + " 筆", "#9C6B44")}</div>
      <div class="df-anacard"><h4>計畫類別分布 <span class="df-meta">（筆數）</span></h4>${hbars(catRows, v => v + " 筆", "#5C8A5C")}</div>
    </div>`;

  // 年份選單
  const years = [...new Set(E.map(evYear).filter(Boolean))].sort().reverse();
  const ySel = host.querySelector("#chartYear");
  if (chartYear && !years.includes(chartYear)) chartYear = "";
  ySel.innerHTML = `<option value="">全部年份</option>` + years.map(y => `<option value="${y}" ${y === chartYear ? "selected" : ""}>${y}</option>`).join("");
  ySel.onchange = e => { chartYear = e.target.value; drawMainChart(); };
  host.querySelectorAll("#chartMode [data-mode]").forEach(b => b.onclick = () => { chartMode = b.dataset.mode; host.querySelectorAll("#chartMode [data-mode]").forEach(x => x.classList.toggle("active", x.dataset.mode === chartMode)); drawMainChart(); });

  const cSel = host.querySelector("#anaContractor");
  cSel.onchange = e => { anaContractor = e.target.value; renderContractorPanel(); };
  renderContractorPanel();
  drawMainChart();
}

function renderContractorPanel() {
  const host = document.getElementById("contractorPanel");
  if (!host) return;
  if (!anaContractor) { host.innerHTML = `<p class="df-meta">選擇一家承包商，列出其所有合約與累積金額。</p>`; return; }
  const rows = EVENTS.filter(e => contractorName(e) === anaContractor)
    .sort((a, b) => String(b.publication_date || "").localeCompare(String(a.publication_date || "")));
  const total = rows.filter(e => e.contract?.amount != null).reduce((s, e) => s + evUSD(e), 0);
  const tk = rows.map(e => listedTicker(e.contractor)).find(Boolean);
  host.innerHTML = `
    <div class="df-contractor-sum">
      <span>${rows.length} 筆合約</span>
      <span>累積 <b class="accent">${usd(total)}</b>（USD 約）</span>
      ${tk ? `<span class="df-tk">${esc(tk.t)}${tk.ex ? " · " + esc(tk.ex) : ""}</span>` : ""}
    </div>
    <div class="df-contractor-list">
      ${rows.map(e => {
        const ct = e.contract || {};
        return `<div class="df-crow" data-open="${esc(e.__id || e.event_id || e.title)}">
          <span class="df-crow-date">${esc(e.publication_date || "—")}</span>
          <span class="df-crow-title">${esc(e.title_zh || e.title)}</span>
          <span class="df-crow-type">${tZ(e.event_type)}</span>
          <span class="df-crow-amt">${fmtAmt(ct.amount, ct.currency || "USD")}${ct.currency && ct.currency !== "USD" && ct.amount != null ? ` <i>≈${usd(evUSD(e))}</i>` : ""}</span>
        </div>`;
      }).join("")}
    </div>`;
  host.querySelectorAll("[data-open]").forEach(el => el.onclick = () => openDetail(rows.find(e => (e.__id || e.event_id || e.title) === el.dataset.open)));
}

// 當前 pool 內、依總額排序的公司（依 companyIdentity 合併同一間）；並指派配色。
function rankCompanies(pool) {
  const m = new Map();
  pool.forEach(e => {
    const id = companyIdentity(e);
    const cur = m.get(id.key) || { key: id.key, name: id.name, value: 0, short: id.short, ticker: id.ticker };
    cur.value += evUSD(e);
    if (id.ticker && !cur.ticker) cur.ticker = id.ticker;
    m.set(id.key, cur);
  });
  const ranked = [...m.values()].sort((a, b) => b.value - a.value);
  _colorMap = new Map();
  ranked.forEach((c, i) => { if (i < CHART_PALETTE.length) _colorMap.set(c.key, CHART_PALETTE[i]); });
  return ranked;
}

function toggleCompany(name) {
  if (selectedCompanies.has(name)) selectedCompanies.delete(name); else selectedCompanies.add(name);
  drawMainChart();
}

function renderLegend(ranked) {
  const host = document.getElementById("chartLegend");
  if (!host) return;
  const shown = ranked.slice(0, CHART_PALETTE.length);
  const anySel = selectedCompanies.size > 0;
  host.innerHTML =
    (anySel ? `<button class="df-legend-clear" id="legendClear">✕ 清除選取（${selectedCompanies.size}）</button>` : "") +
    shown.map(c => {
      const sel = selectedCompanies.has(c.key);
      return `<button class="df-legend-chip ${sel ? "sel" : ""} ${anySel && !sel ? "dim" : ""}" data-key="${esc(c.key)}" title="${esc(c.name)} — ${usd(c.value)}">
        <span class="df-legend-dot" style="background:${colorFor(c.key)}"></span>${esc(c.ticker || c.short)}</button>`;
    }).join("");
  host.querySelectorAll("[data-key]").forEach(b => b.onclick = () => toggleCompany(b.dataset.key));
  const clr = host.querySelector("#legendClear");
  if (clr) clr.onclick = () => { selectedCompanies.clear(); drawMainChart(); };
}

function drawMainChart() {
  const host = document.getElementById("mainChart");
  if (!host) return;
  const pool = EVENTS.filter(e => e.contract?.amount != null && (!chartYear || evYear(e) === chartYear));
  const ranked = rankCompanies(pool);
  renderLegend(ranked);
  if (chartMode === "bar") drawBar(host, ranked.slice(0, 15));
  else drawLine(host, pool, ranked);
}

function drawBar(host, ranked) {
  host.innerHTML = "";
  if (!ranked.length) { host.innerHTML = `<p class="df-meta">此區間無資料。</p>`; return; }
  const anySel = selectedCompanies.size > 0;
  const W = Math.max(host.clientWidth || 720, 480), H = 300, padL = 56, padR = 14, padT = 14, padB = 74;
  const max = Math.max(...ranked.map(r => r.value), 1);
  const bw = (W - padL - padR) / ranked.length;
  const Y = v => H - padB - (v / max) * (H - padT - padB);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "df-svg", width: "100%", height: H });
  [0, 0.25, 0.5, 0.75, 1].forEach(g => {
    svg.appendChild(svgEl("line", { x1: padL, y1: Y(max * g), x2: W - padR, y2: Y(max * g), class: "df-grid" }));
    const t = svgEl("text", { x: padL - 6, y: Y(max * g) + 3, class: "df-axis", "text-anchor": "end" }); t.textContent = usd(max * g); svg.appendChild(t);
  });
  ranked.forEach((r, i) => {
    const sel = selectedCompanies.has(r.key);
    const x = padL + i * bw + bw * 0.15, w = bw * 0.7, y = Y(r.value);
    const rect = svgEl("rect", { x, y, width: w, height: H - padB - y, rx: 3, fill: colorFor(r.key), style: "cursor:pointer", opacity: anySel && !sel ? "0.32" : "1" });
    if (sel) { rect.setAttribute("stroke", "var(--text-primary)"); rect.setAttribute("stroke-width", "1.5"); }
    const title = svgEl("title"); title.textContent = `${r.name} — ${usd(r.value)}（點選比較）`; rect.appendChild(title);
    rect.addEventListener("click", () => toggleCompany(r.key));
    svg.appendChild(rect);
    const lab = svgEl("text", { x: x + w / 2, y: H - padB + 14, class: "df-axis", "text-anchor": "end", transform: `rotate(-40 ${x + w / 2} ${H - padB + 14})` });
    lab.textContent = (r.ticker || r.short).length > 12 ? (r.ticker || r.short).slice(0, 12) + "…" : (r.ticker || r.short); svg.appendChild(lab);
    const val = svgEl("text", { x: x + w / 2, y: y - 4, class: "df-axis val", "text-anchor": "middle" }); val.textContent = usd(r.value); svg.appendChild(val);
  });
  host.appendChild(svg);
}

// 折線：一或多條「累積合約金額」曲線。未選取公司 → 全部加總單線；
// 有選取 → 每家一條彩色線（如比較圖）。x 軸為日期。
function drawLine(host, pool, ranked) {
  host.innerHTML = "";
  const dates = [...new Set(pool.map(e => e.publication_date || e.event_date || "").filter(Boolean))].sort();
  if (dates.length < 2) { host.innerHTML = `<p class="df-meta">資料點不足以繪製折線（需 ≥ 2 個日期）。</p>`; return; }

  const keys = selectedCompanies.size ? [...selectedCompanies] : ["__ALL__"];
  // 每條線：對每個日期累加到當日為止的 USD 總額。
  const cumFor = key => {
    const byDay = {};
    pool.forEach(e => {
      if (key !== "__ALL__" && companyIdentity(e).key !== key) return;
      const d = e.publication_date || e.event_date || ""; if (d) byDay[d] = (byDay[d] || 0) + evUSD(e);
    });
    let cum = 0;
    return dates.map(d => { cum += (byDay[d] || 0); return cum; });
  };
  const lines = keys.map(k => { const r = ranked.find(x => x.key === k); return { key: k, color: k === "__ALL__" ? "var(--accent)" : colorFor(k), label: k === "__ALL__" ? "全部加總" : (r?.ticker || r?.short || r?.name || k), vals: cumFor(k) }; });
  const max = Math.max(1, ...lines.flatMap(l => l.vals));

  const W = Math.max(host.clientWidth || 720, 480), H = 320, padL = 56, padR = 14, padT = 14, padB = 40;
  const X = i => padL + (i / (dates.length - 1)) * (W - padL - padR);
  const Y = v => H - padB - (v / max) * (H - padT - padB);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "df-svg", width: "100%", height: H });
  [0, 0.25, 0.5, 0.75, 1].forEach(g => {
    svg.appendChild(svgEl("line", { x1: padL, y1: Y(max * g), x2: W - padR, y2: Y(max * g), class: "df-grid" }));
    const t = svgEl("text", { x: padL - 6, y: Y(max * g) + 3, class: "df-axis", "text-anchor": "end" }); t.textContent = usd(max * g); svg.appendChild(t);
  });
  // 單線（全部加總）填色面積；多線比較時不填色以免互相遮蔽。
  if (lines.length === 1 && keys[0] === "__ALL__") {
    svg.appendChild(svgEl("polyline", { points: `${X(0)},${H - padB} ` + lines[0].vals.map((v, i) => `${X(i)},${Y(v)}`).join(" ") + ` ${X(dates.length - 1)},${H - padB}`, fill: "var(--accent-light)", stroke: "none" }));
  }
  lines.forEach(l => {
    svg.appendChild(svgEl("polyline", { points: l.vals.map((v, i) => `${X(i)},${Y(v)}`).join(" "), fill: "none", stroke: l.color, "stroke-width": 2.2 }));
    l.vals.forEach((v, i) => {
      if (dates.length <= 24 || i % Math.ceil(dates.length / 24) === 0 || i === dates.length - 1) {
        const c = svgEl("circle", { cx: X(i), cy: Y(v), r: 2.8, fill: l.color });
        const title = svgEl("title"); title.textContent = `${l.label} · ${dates[i]} — ${usd(v)}`; c.appendChild(title); svg.appendChild(c);
      }
    });
  });
  dates.forEach((d, i) => {
    if (i % Math.ceil(dates.length / 10) === 0 || i === dates.length - 1) { const t = svgEl("text", { x: X(i), y: H - padB + 16, class: "df-axis", "text-anchor": "middle" }); t.textContent = d.length > 7 ? d.slice(5) : d.slice(2); svg.appendChild(t); }
  });
  host.appendChild(svg);
}

// ── admin importer wiring (called from page) ───────────────────────────
export function wireImporter() {
  const btn = document.getElementById("publishBtn"), status = document.getElementById("pubStatus"), ta = document.getElementById("jsonInput");
  if (!btn) return;
  btn.onclick = async () => {
    status.className = "rp-status"; status.textContent = "解析中…";
    try {
      const { events } = parseDefenseRun(ta.value);
      status.textContent = `寫入 ${events.length} 筆…`;
      const n = await saveDefenseEvents(events);
      status.className = "rp-status ok"; status.textContent = `✓ 已發布 ${n} 筆`;
      ta.value = ""; await refresh(true);
    } catch (e) {
      status.className = "rp-status err";
      status.textContent = /permission|insufficient/i.test(e.message || "") ? "✗ 權限不足：帳號需在白名單且已部署 Firestore 規則。" : "✗ " + e.message;
    }
  };
}
