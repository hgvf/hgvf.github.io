// defense.js — ⑦ 每日軍武動態。讀 mil_defense_daily（Firestore），
// 白名單使用者可用「ADD JSON」貼上 skill 產出的 run JSON 發布。
// 呈現：中文為主、英文原文為輔；篩選 / chips / 詳情 modal / 統計。
import { esc, money, fmtDate, loadJSON, svgEl } from "../js/milcore.js";
// milstore（Firebase）動態載入：若 SDK 無法載入，仍以示意資料唯讀呈現。
let store = null;
async function getStore() {
  if (store) return store;
  try { store = await import("../js/milstore.js"); } catch { store = null; }
  return store;
}

const root = document.getElementById("app");
let EVENTS = [];         // 已展平的 event 物件（data）
let META = [];           // {id, data}
let usingSample = false;
let isAdmin = false;
let activeTag = "", q = "", country = "", type = "", market = "", sort = "date", month = "";
let activeView = "list";        // 分頁：list（合約動態）/ eta（合約分析 · ETL）
const PAGE_SIZE = 30;           // 動態清單一次顯示上限，其餘隱藏、按鈕載入更多
let shownLimit = PAGE_SIZE;

const countryZh = { US: "美國", TW: "台灣", JP: "日本", KR: "韓國", AU: "澳洲", GB: "英國" };
const typeZh = { contract_award: "新合約", contract_modification: "合約修改", development: "研發", program_decision: "計畫決策", procurement: "採購", research: "研究", test: "測試" };
const serviceZh = { Navy: "海軍", Army: "陸軍", "Air Force": "空軍", Joint: "聯合", "Marine Corps": "陸戰隊" };
const tZ = v => typeZh[v] || (v || "").replaceAll("_", " ") || "—";
const sZ = v => serviceZh[v] || v || "—";
const cZ = v => countryZh[v] || v;

const listedTicker = c => !c ? null : (c.ticker ? { t: c.ticker, ex: c.exchange, basis: "direct" } : c.parent_ticker ? { t: c.parent_ticker, ex: c.exchange, basis: "parent" } : null);
const isListed = e => !!listedTicker(e.contractor);

(async function init() {
  root.innerHTML = `<p class="mil-meta">載入中…</p>`;
  const s = await getStore();
  if (s) s.onAuth(({ isAdmin: a }) => { isAdmin = a; const p = document.getElementById("importPanel"); if (p) p.hidden = !a; });
  await refresh();
})();

async function loadSample() {
  try { const s = await loadJSON("../data/defense-sample.json"); EVENTS = (s.events || []).map(e => ({ __id: null, ...e })); }
  catch { EVENTS = []; }
  usingSample = true;
}

// rebuildIndex=true 時（白名單新增/刪除後）改走 rebuildDefenseIndex()，
// 順便把 indexes/mil_defense_daily 更新成最新，一般載入只讀該索引 1 份文件。
async function refresh(rebuildIndex = false) {
  const s = await getStore();
  if (!s) { await loadSample(); renderShell(); applyView(); return; }
  try {
    META = rebuildIndex ? await s.rebuildDefenseIndex() : await s.loadDefenseEvents();
    if (META.length) { EVENTS = META.map(m => ({ __id: m.id, ...m.data })); usingSample = false; }
    else { await loadSample(); }
  } catch { await loadSample(); }
  renderShell(); applyView();
}

function renderShell() {
  // 合約總額須「依幣別」加總，不能把 USD/JPY/KRW… 混加成單一數字（否則會得到
  // 像 $5222B 這種無意義的值，也和下方 ETL 依幣別分開的數字對不上）。
  const byCcyTotal = {};
  EVENTS.forEach(e => { const a = e.contract?.amount, c = e.contract?.currency || (a != null ? "USD" : null); if (a != null && c) byCcyTotal[c] = (byCcyTotal[c] || 0) + a; });
  const ccyOrder = Object.keys(byCcyTotal).sort((a, b) => byCcyTotal[b] - byCcyTotal[a]);
  const primaryCcy = ccyOrder[0] || "USD";
  const otherCcy = ccyOrder.slice(1).map(c => fmtAmt(byCcyTotal[c], c)).join(" · ");
  const dates = EVENTS.map(e => e.publication_date).filter(Boolean).sort();
  root.innerHTML = `
    ${usingSample ? `<div class="mil-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span>目前顯示<b>示意資料</b>（Firestore <code>mil_defense_daily</code> 尚無資料）。登入白名單帳號後可用下方「ADD JSON」發布真實資料。</span></div>` : ""}

    <details class="mil-import" id="importPanel" ${isAdmin ? "" : "hidden"}>
      <summary>匯入 / 更新每日軍武 JSON（ADD JSON）</summary>
      <p class="hint">貼上 <code>defense-daily</code> skill 產出的 JSON —— 接受 <code>{"run":{…},"events":[…]}</code>、事件陣列、或單一 event。以 <code>event_id</code> 為主鍵，重貼同 id 會覆蓋。資料寫入 Firebase <code>mil_defense_daily</code>。</p>
      <textarea id="jsonInput" class="mil-textarea" rows="8" spellcheck="false" placeholder='{"run":{"run_date":"2026-08-18"},"events":[{"event_id":"...","country":"US","title":"...","title_zh":"...","summary_zh":"...","contract":{"amount":169216659},"sources":[{"url":"https://..."}]}]}'></textarea>
      <div class="actions"><button class="mil-btn mil-btn-primary" id="pubBtn">發布到 Firebase</button><span class="mil-status" id="pubStatus"></span></div>
    </details>

    <div class="mil-stats">
      <div class="mil-stat"><div class="label">事件數</div><div class="value">${EVENTS.length}</div><div class="sub">${dates[0] ? fmtDate(dates[0]) + " – " + fmtDate(dates[dates.length-1]) : ""}</div></div>
      <div class="mil-stat"><div class="label">合約總額 ${primaryCcy}</div><div class="value brass">${fmtAmt(byCcyTotal[primaryCcy] || 0, primaryCcy)}</div>${otherCcy ? `<div class="sub">${otherCcy}</div>` : ""}</div>
      <div class="mil-stat"><div class="label">上市承包商事件</div><div class="value allied">${EVENTS.filter(isListed).length}</div></div>
      <div class="mil-stat"><div class="label">最高重要度</div><div class="value">${Math.max(0, ...EVENTS.map(e => e.importance_score || 0))}</div></div>
    </div>

    <div class="def-tabs" id="defTabs" role="tablist">
      <button class="def-tab ${activeView === "list" ? "active" : ""}" data-view="list" role="tab">合約動態</button>
      <button class="def-tab ${activeView === "eta" ? "active" : ""}" data-view="eta" role="tab">合約分析 · ETL</button>
    </div>

    <section class="def-pane" id="pane-list" ${activeView === "list" ? "" : "hidden"}>
      <div class="def-toolbar">
        <input id="fSearch" class="mil-input" placeholder="搜尋標題 / 計畫 / 承包商 / ticker…" value="${esc(q)}" />
        <select id="fMonth" class="mil-select"></select>
        <select id="fCountry" class="mil-select"></select>
        <select id="fType" class="mil-select"></select>
        <select id="fMarket" class="mil-select"><option value="">全部承包商</option><option value="listed">僅上市</option><option value="private">非上市</option></select>
        <select id="fSort" class="mil-select"><option value="date">最新優先</option><option value="importance">重要度</option><option value="amount">金額</option></select>
      </div>
      <div class="def-chips" id="chips"></div>
      <div class="mil-panel-head" style="margin-top:0.8rem"><h2 class="mil-panel-title">事件</h2><span class="mil-panel-note" id="count"></span></div>
      <div class="def-list" id="list"></div>
      <div class="def-more" id="moreWrap" hidden><button class="mil-btn mil-btn-ghost" id="moreBtn"></button></div>
    </section>

    <section class="def-pane" id="pane-eta" ${activeView === "eta" ? "" : "hidden"}>
      <section class="mil-panel def-ana" id="analytics"></section>
    </section>`;

  // filters options
  const months = [...new Set(EVENTS.map(e => (e.publication_date || e.event_date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
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

  // 分頁切換：ETL 分析只在切到該頁時才繪製（drawTrend 需要可見寬度）。
  root.querySelectorAll("#defTabs [data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));

  if (isAdmin) wireImporter();
  const p = document.getElementById("importPanel"); if (p) p.hidden = !isAdmin;
}

function setView(v) {
  if (v === activeView) return;
  activeView = v;
  root.querySelectorAll("#defTabs [data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  const pl = root.querySelector("#pane-list"), pe = root.querySelector("#pane-eta");
  if (pl) pl.hidden = v !== "list";
  if (pe) pe.hidden = v !== "eta";
  applyView();
}

// 依目前分頁只渲染需要的內容（分析頁的趨勢圖需要 pane 可見才有寬度）。
function applyView() {
  applyFilters();
  if (activeView === "eta") renderAnalytics();
}

function wireImporter() {
  const btn = root.querySelector("#pubBtn"), status = root.querySelector("#pubStatus"), ta = root.querySelector("#jsonInput");
  btn.onclick = async () => {
    status.className = "mil-status"; status.textContent = "解析中…";
    try {
      const s = await getStore();
      if (!s) throw new Error("Firebase SDK 無法載入，無法寫入");
      const { events } = s.parseDefenseRun(ta.value);
      status.textContent = `寫入 ${events.length} 筆…`;
      const n = await s.saveDefenseEvents(events);
      status.className = "mil-status ok"; status.textContent = `✓ 已發布 ${n} 筆`;
      ta.value = ""; await refresh(true);
    } catch (e) {
      status.className = "mil-status err";
      if (/insufficient permissions|Missing or insufficient|permission-denied/i.test(e.message || "")) {
        status.innerHTML = "✗ 權限不足：請確認①此帳號 email 已在白名單（config/auth），且②已部署更新後的 Firestore 規則（新增 mil_defense_daily）。<br>部署：<code>firebase deploy --only firestore:rules</code>";
      } else {
        status.textContent = "✗ " + e.message;
      }
    }
  };
}

function collectTags(list) {
  const m = new Map(); list.forEach(e => (e.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
}

function applyFilters() {
  if (!root.querySelector("#list")) return;   // 目前不在動態分頁，略過
  let list = EVENTS.filter(e => {
    const c = e.contractor || {};
    const hay = JSON.stringify({ a: e.title, b: e.title_zh, c: e.summary_zh, d: e.summary, t: e.tags, p: e.programs, k: c.name, tk: c.ticker, pt: c.parent_ticker, ag: e.agency }).toLowerCase();
    const mk = !market || (market === "listed" && isListed(e)) || (market === "private" && !isListed(e));
    const mo = !month || (e.publication_date || e.event_date || "").slice(0, 7) === month;
    return (!q || hay.includes(q)) && (!country || e.country === country) && (!type || e.event_type === type) && mk && mo && (!activeTag || (e.tags || []).includes(activeTag));
  });
  if (sort === "importance") list.sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
  else if (sort === "amount") list.sort((a, b) => (b.contract?.amount || 0) - (a.contract?.amount || 0));
  else list.sort((a, b) => String(b.publication_date || "").localeCompare(String(a.publication_date || "")));

  // chips
  const chips = root.querySelector("#chips");
  chips.innerHTML = collectTags(EVENTS).map(([t, c]) => `<button class="mil-chip ${activeTag === t ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)} <span class="chip-count">${c}</span></button>`).join("");
  chips.querySelectorAll("[data-tag]").forEach(b => b.onclick = () => { activeTag = activeTag === b.dataset.tag ? "" : b.dataset.tag; shownLimit = PAGE_SIZE; applyFilters(); });

  // 只渲染前 shownLimit 筆，其餘隱藏於「載入更多」之後（避免一次塞爆整頁）。
  const shown = list.slice(0, shownLimit);
  root.querySelector("#count").textContent = list.length > shown.length ? `顯示 ${shown.length} / ${list.length} 筆` : `${list.length} 筆`;
  const box = root.querySelector("#list");
  if (!list.length) { box.innerHTML = `<p class="mil-meta">沒有符合條件的事件。</p>`; }
  else {
    box.innerHTML = shown.map(cardHTML).join("");
    box.querySelectorAll("[data-open]").forEach(el => el.onclick = () => openDetail(list.find(e => (e.__id || e.event_id || e.title) === el.dataset.open)));
    if (isAdmin) box.querySelectorAll("[data-del]").forEach(b => b.onclick = async ev => { ev.stopPropagation(); if (confirm("刪除此事件？")) { const s = await getStore(); if (s) { await s.deleteDefenseEvent(b.dataset.del); await refresh(true); } } });
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
  const programs = (e.programs || []).map(p => { const zh = p.name_zh || p.canonical_name || p.program_name_raw || "計畫"; const en = (p.name_zh && p.canonical_name) ? `<small>${esc(p.canonical_name)}</small>` : ""; return `<span class="def-prog">${esc(zh)}${en}</span>`; }).join("");
  return `<article class="def-card" data-open="${esc(key)}" tabindex="0">
    <div class="def-main">
      <div class="def-meta">${cZ(e.country)} · ${sZ(e.service)} · ${tZ(e.event_type)} · ${esc(e.publication_date || "")}</div>
      <h3 class="def-title">${esc(e.title_zh || e.title)}</h3>
      <p class="def-summary">${esc(e.summary_zh || e.summary || "")}</p>
      ${e.action?.description_zh || e.action?.description ? `<div class="def-action">${esc(e.action.description_zh || e.action.description)}</div>` : ""}
      ${programs ? `<div class="def-progs">${programs}</div>` : ""}
      <div class="def-tags">${(e.tags || []).map(t => `<span class="def-tag">#${esc(t)}</span>`).join("")}</div>
      ${e.quality?.needs_review ? `<div class="def-review">需人工複核：${esc((e.quality.issues || []).join(" "))}</div>` : ""}
    </div>
    <aside class="def-side">
      <div class="def-amount">${money(ct.amount)}</div>
      ${ct.contract_number ? `<div class="def-cno">合約 ${esc(ct.contract_number)}</div>` : ""}
      <div class="def-company">
        <div class="def-cname">${esc(c.name || "未列承包商")}</div>
        ${tk ? `<div class="def-ticker"><span class="tk">${esc(tk.t)}</span>${tk.ex ? ` <span class="ex">${esc(tk.ex)}</span>` : ""}${tk.basis === "parent" && c.parent_company ? `<div class="def-parent">上市母公司：${esc(c.parent_company)}</div>` : ""}</div>` : `<div class="def-ticker"><span class="tk private">${c.ticker_basis === "government" ? "政府/學研" : c.ticker_basis === "private" ? "私人公司" : "非上市"}</span></div>`}
      </div>
      ${e.action?.expected_completion_date ? `<div class="def-comp">預計完成 ${esc(e.action.expected_completion_date)}</div>` : ""}
      <div class="def-score">重要度 ${e.importance_score ?? 0}</div>
      ${isAdmin && e.__id ? `<button class="mil-btn mil-btn-ghost def-del" data-del="${esc(e.__id)}">刪除</button>` : ""}
    </aside>
  </article>`;
}

// ── 詳情 modal（英文原文為輔）──
function openDetail(e) {
  if (!e) return;
  const c = e.contractor || {}, ct = e.contract || {}, src = (e.sources || [])[0];
  let modal = document.getElementById("defModal");
  if (!modal) { modal = document.createElement("div"); modal.id = "defModal"; modal.className = "mil-modal"; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="mil-modal-box">
    <button class="mil-modal-close" aria-label="關閉">×</button>
    <div class="def-meta">${cZ(e.country)} · ${e.agency || sZ(e.service)} · ${tZ(e.event_type)} · ${esc(e.publication_date || "")}</div>
    <h2 class="def-modal-title">${esc(e.title_zh || e.title)}</h2>
    ${e.title_zh && e.title ? `<div class="def-orig">英文原文：${esc(e.title)}</div>` : ""}
    <p class="def-modal-sum">${esc(e.summary_zh || e.summary || "")}</p>
    ${e.summary_zh && e.summary ? `<details class="def-en"><summary>查看英文原文摘要</summary><p>${esc(e.summary)}</p></details>` : ""}
    ${e.action ? `<div class="def-block"><h4>行動</h4><p>${esc(e.action.description_zh || e.action.description || "—")}</p>${e.action.description_zh && e.action.description ? `<details class="def-en"><summary>原文</summary><p>${esc(e.action.description)}</p></details>` : ""}</div>` : ""}
    <div class="def-grid2">
      <div><span>承包商</span>${esc(c.name_raw || c.name || "—")}</div>
      <div><span>合約編號</span>${esc(ct.contract_number || "—")}</div>
      <div><span>金額</span>${esc(ct.amount_raw || money(ct.amount))}</div>
      <div><span>預計完成</span>${esc(e.action?.expected_completion_date || "—")}</div>
      ${listedTicker(c) ? `<div><span>對應股票</span>${esc(listedTicker(c).t)} ${esc(listedTicker(c).ex || "")}</div>` : ""}
    </div>
    ${(e.programs || []).length ? `<div class="def-block"><h4>相關計畫</h4><div class="def-progs">${(e.programs || []).map(p => `<span class="def-prog">${esc(p.name_zh || p.canonical_name || p.program_name_raw)}${p.canonical_name && p.name_zh ? `<small>${esc(p.canonical_name)}</small>` : ""}</span>`).join("")}</div></div>` : ""}
    ${src?.url && /^https?:\/\//.test(src.url) ? `<a class="mil-btn mil-btn-primary" href="${esc(src.url)}" target="_blank" rel="noopener">開啟 ${esc(src.publisher || "官方來源")} ↗</a>` : `<div class="mil-meta">此筆無官方來源連結</div>`}
  </div>`;
  modal.classList.add("open");
  const close = () => modal.classList.remove("open");
  modal.querySelector(".mil-modal-close").onclick = close;
  modal.onclick = ev => { if (ev.target === modal) close(); };
  document.addEventListener("keydown", function esc2(ev) { if (ev.key === "Escape") { close(); document.removeEventListener("keydown", esc2); } });
}

// ── ETL / 分析（就地彙整 Firestore 內部資料）──────────────────────────
// 全部從已載入的 EVENTS 就地計算（in-memory），不額外讀 Firestore。
const CCY_SYM = { USD: "$", TWD: "NT$", JPY: "¥", KRW: "₩", EUR: "€", GBP: "£", AUD: "A$" };
let anaCcy = null;
function fmtAmt(v, ccy) {
  if (v == null) return "—";
  const s = CCY_SYM[ccy] || (ccy ? ccy + " " : ""), a = Math.abs(v);
  if (a >= 1e9) return s + (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + (v / 1e3).toFixed(1) + "K";
  return s + Number(v).toLocaleString();
}
function contractorKey(e) {
  const c = e.contractor || {};
  const t = listedTicker(c);
  return { name: c.name || c.name_raw || "未列承包商", ticker: t ? t.t : null };
}
function hbars(rows, fmt, color = "var(--brass)") {
  if (!rows.length) return `<p class="mil-meta">無資料</p>`;
  const max = Math.max(...rows.map(r => r.value), 1);
  return `<div class="ana-bars">${rows.map(r => `
    <div class="ana-bar-row">
      <span class="ana-bar-label" title="${esc(r.label)}">${esc(r.label)}${r.sub ? ` <i>${esc(r.sub)}</i>` : ""}</span>
      <span class="ana-bar-track"><span class="ana-bar-fill" style="width:${(r.value / max * 100).toFixed(1)}%;background:${r.color || color}"></span></span>
      <span class="ana-bar-val">${fmt(r.value)}</span>
    </div>`).join("")}</div>`;
}

function renderAnalytics() {
  const host = document.getElementById("analytics");
  if (!host) return;
  const E = EVENTS;
  if (!E.length) { host.innerHTML = `<div class="mil-panel-head"><h2 class="mil-panel-title">合約分析</h2></div><p class="mil-meta">尚無資料。</p>`; return; }

  // 幣別（金額類彙整依幣別，不做 FX 換算）
  const ccyCount = {};
  E.forEach(e => { const c = e.contract?.currency; if (c) ccyCount[c] = (ccyCount[c] || 0) + 1; });
  const currencies = Object.keys(ccyCount).sort((a, b) => ccyCount[b] - ccyCount[a]);
  if (!anaCcy || !currencies.includes(anaCcy)) anaCcy = currencies[0] || "USD";
  const inCcy = E.filter(e => (e.contract?.currency || "USD") === anaCcy && e.contract?.amount != null);

  // 彙整
  const sum = arr => arr.reduce((s, x) => s + x, 0);
  const totalByCcy = currencies.map(c => ({ c, v: sum(E.filter(e => e.contract?.currency === c).map(e => e.contract?.amount || 0)) }));
  const contractors = new Map();
  inCcy.forEach(e => { const k = contractorKey(e); const cur = contractors.get(k.name) || { value: 0, n: 0, ticker: k.ticker }; cur.value += e.contract.amount; cur.n++; cur.ticker = cur.ticker || k.ticker; contractors.set(k.name, cur); });
  const topContractors = [...contractors.entries()].map(([name, o]) => ({ label: name, value: o.value, sub: o.ticker ? o.ticker : (o.n + " 筆"), color: o.ticker ? "var(--allied)" : "var(--brass)" })).sort((a, b) => b.value - a.value).slice(0, 10);

  // 國別分布：以「筆數」計（跨幣別，不受上方幣別選單過濾），否則只有 JPY
  // 合約的國家（如日本）在 USD 檢視下會整個消失。金額改列在標籤下依幣別分開。
  const byCountry = {};
  E.forEach(e => {
    const c = e.country || "?";
    const o = (byCountry[c] ||= { n: 0, ccy: {} });
    o.n++;
    const amt = e.contract?.amount, cc = e.contract?.currency || (amt != null ? "USD" : null);
    if (amt != null && cc) o.ccy[cc] = (o.ccy[cc] || 0) + amt;
  });
  const countryRows = Object.entries(byCountry).map(([c, o]) => ({
    label: cZ(c), value: o.n,
    sub: Object.entries(o.ccy).sort((a, b) => b[1] - a[1]).map(([cc, v]) => fmtAmt(v, cc)).join(" · ") || null,
  })).sort((a, b) => b.value - a.value);

  const byType = {};
  E.forEach(e => { const t = e.event_type || "other"; byType[t] = (byType[t] || 0) + 1; });
  const typeRows = Object.entries(byType).map(([t, n]) => ({ label: tZ(t), value: n })).sort((a, b) => b.value - a.value);

  const byCat = {};
  E.forEach(e => (e.programs || []).forEach(p => { const c = p.category || "unknown"; byCat[c] = (byCat[c] || 0) + 1; }));
  const catRows = Object.entries(byCat).map(([c, n]) => ({ label: c, value: n })).sort((a, b) => b.value - a.value).slice(0, 10);

  // 上市 vs 非上市（金額）
  const listedVal = sum(inCcy.filter(isListed).map(e => e.contract.amount));
  const privVal = sum(inCcy.filter(e => !isListed(e)).map(e => e.contract.amount));

  // 月度趨勢
  const byMonth = {};
  inCcy.forEach(e => { const m = (e.publication_date || e.event_date || "").slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + e.contract.amount; });
  const months = Object.keys(byMonth).sort();

  const distinctContractors = contractors.size;
  const distinctPrograms = new Set(E.flatMap(e => (e.programs || []).map(p => p.program_id || p.canonical_name || p.name_zh).filter(Boolean))).size;

  host.innerHTML = `
    <div class="mil-panel-head">
      <h2 class="mil-panel-title">合約分析 · ETL</h2>
      <label class="mil-meta">金額幣別
        <span class="rv-sel-wrap"><select class="mil-select ana-ccy" id="anaCcy">${currencies.map(c => `<option value="${c}" ${c === anaCcy ? "selected" : ""}>${c}（${ccyCount[c]}）</option>`).join("")}</select></span>
      </label>
    </div>
    <p class="mil-meta" style="margin:-0.4rem 0 0.8rem">就地彙整目前載入的 ${E.length} 筆事件；金額類統計依幣別分開，不做匯率換算（<b>ceiling ≠ 實支</b>）。</p>

    <div class="mil-stats">
      <div class="mil-stat"><div class="label">事件數</div><div class="value">${E.length}</div></div>
      ${totalByCcy.slice(0, 2).map(t => `<div class="mil-stat"><div class="label">合約總額 ${t.c}</div><div class="value brass">${fmtAmt(t.v, t.c)}</div></div>`).join("")}
      <div class="mil-stat"><div class="label">承包商數</div><div class="value allied">${distinctContractors}</div></div>
      <div class="mil-stat"><div class="label">計畫數</div><div class="value">${distinctPrograms}</div></div>
    </div>

    <div class="ana-grid">
      <div class="ana-card"><h3>承包商合約總值 Top 10 <span>（${anaCcy}）</span></h3>${hbars(topContractors, v => fmtAmt(v, anaCcy))}</div>
      <div class="ana-card"><h3>國別合約分布 <span>（筆數 · 金額依幣別）</span></h3>${hbars(countryRows, v => v + " 筆", "var(--allied)")}</div>
      <div class="ana-card"><h3>事件類型分布 <span>（筆數）</span></h3>${hbars(typeRows, v => v + " 筆", "var(--civil)")}</div>
      <div class="ana-card"><h3>計畫類別分布 <span>（筆數）</span></h3>${hbars(catRows, v => v + " 筆", "var(--ok)")}</div>
      <div class="ana-card ana-wide"><h3>月度合約金額趨勢 <span>（${anaCcy}）</span></h3><div id="anaTrend"></div></div>
      <div class="ana-card"><h3>上市 vs 非上市 合約值 <span>（${anaCcy}）</span></h3>
        ${hbars([{ label: "上市承包商", value: listedVal, color: "var(--allied)" }, { label: "非上市 / 政府", value: privVal, color: "var(--muted)" }], v => fmtAmt(v, anaCcy))}
      </div>
    </div>`;

  host.querySelector("#anaCcy").onchange = e => { anaCcy = e.target.value; renderAnalytics(); };
  drawTrend(document.getElementById("anaTrend"), months.map(m => ({ m, v: byMonth[m] })), anaCcy);
}

function drawTrend(host, series, ccy) {
  if (!host) return;
  if (series.length < 2) { host.innerHTML = `<p class="mil-meta">資料月份不足以繪製趨勢（需 ≥ 2 個月）。</p>`; return; }
  const W = Math.max(host.clientWidth || 600, 480), H = 180, padL = 52, padR = 14, padT = 14, padB = 30;
  const max = Math.max(...series.map(s => s.v), 1);
  const X = i => padL + (i / (series.length - 1)) * (W - padL - padR);
  const Y = v => H - padB - (v / max) * (H - padT - padB);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });
  [0, 0.5, 1].forEach(g => { svg.appendChild(svgEl("line", { x1: padL, y1: Y(max * g), x2: W - padR, y2: Y(max * g), class: "mil-grid" })); const t = svgEl("text", { x: padL - 6, y: Y(max * g) + 3, class: "mil-axis-txt", "text-anchor": "end" }); t.textContent = fmtAmt(max * g, ccy); svg.appendChild(t); });
  svg.appendChild(svgEl("polyline", { points: series.map((s, i) => `${X(i)},${Y(s.v)}`).join(" "), fill: "none", stroke: "var(--brass)", "stroke-width": 1.8 }));
  series.forEach((s, i) => {
    svg.appendChild(svgEl("circle", { cx: X(i), cy: Y(s.v), r: 3, fill: "var(--brass)" }));
    if (i % Math.ceil(series.length / 8) === 0 || i === series.length - 1) { const t = svgEl("text", { x: X(i), y: H - padB + 16, class: "mil-axis-txt", "text-anchor": "middle" }); t.textContent = s.m.slice(2); svg.appendChild(t); }
  });
  host.innerHTML = ""; host.appendChild(svg);
}
