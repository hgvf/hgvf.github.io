// defense.js — ⑦ 每日軍武動態。讀 mil_defense_daily（Firestore），
// 白名單使用者可用「ADD JSON」貼上 skill 產出的 run JSON 發布。
// 呈現：中文為主、英文原文為輔；篩選 / chips / 詳情 modal / 統計。
import { esc, money, fmtDate, loadJSON } from "../js/milcore.js";
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
let activeTag = "", q = "", country = "", type = "", market = "", sort = "date";

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

async function refresh() {
  const s = await getStore();
  if (!s) { await loadSample(); renderShell(); applyFilters(); return; }
  try {
    META = await s.loadDefenseEvents();
    if (META.length) { EVENTS = META.map(m => ({ __id: m.id, ...m.data })); usingSample = false; }
    else { await loadSample(); }
  } catch { await loadSample(); }
  renderShell(); applyFilters();
}

function renderShell() {
  const total = EVENTS.reduce((s, e) => s + (e.contract?.amount || 0), 0);
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
      <div class="mil-stat"><div class="label">合約總額</div><div class="value brass">${money(total)}</div></div>
      <div class="mil-stat"><div class="label">上市承包商事件</div><div class="value allied">${EVENTS.filter(isListed).length}</div></div>
      <div class="mil-stat"><div class="label">最高重要度</div><div class="value">${Math.max(0, ...EVENTS.map(e => e.importance_score || 0))}</div></div>
    </div>

    <div class="def-toolbar">
      <input id="fSearch" class="mil-input" placeholder="搜尋標題 / 計畫 / 承包商 / ticker…" />
      <select id="fCountry" class="mil-select"></select>
      <select id="fType" class="mil-select"></select>
      <select id="fMarket" class="mil-select"><option value="">全部承包商</option><option value="listed">僅上市</option><option value="private">非上市</option></select>
      <select id="fSort" class="mil-select"><option value="date">最新優先</option><option value="importance">重要度</option><option value="amount">金額</option></select>
    </div>
    <div class="def-chips" id="chips"></div>
    <div class="mil-panel-head" style="margin-top:0.8rem"><h2 class="mil-panel-title">事件</h2><span class="mil-panel-note" id="count"></span></div>
    <div class="def-list" id="list"></div>`;

  // filters options
  const fc = root.querySelector("#fCountry"); fc.innerHTML = `<option value="">全部國家</option>` + [...new Set(EVENTS.map(e => e.country))].filter(Boolean).sort().map(c => `<option value="${c}">${cZ(c)}</option>`).join("");
  const ft = root.querySelector("#fType"); ft.innerHTML = `<option value="">全部類型</option>` + [...new Set(EVENTS.map(e => e.event_type))].filter(Boolean).sort().map(t => `<option value="${t}">${tZ(t)}</option>`).join("");
  root.querySelector("#fSearch").oninput = e => { q = e.target.value.trim().toLowerCase(); applyFilters(); };
  fc.onchange = e => { country = e.target.value; applyFilters(); };
  ft.onchange = e => { type = e.target.value; applyFilters(); };
  root.querySelector("#fMarket").onchange = e => { market = e.target.value; applyFilters(); };
  root.querySelector("#fSort").onchange = e => { sort = e.target.value; applyFilters(); };

  if (isAdmin) wireImporter();
  const p = document.getElementById("importPanel"); if (p) p.hidden = !isAdmin;
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
      ta.value = ""; await refresh();
    } catch (e) {
      status.className = "mil-status err"; status.textContent = "✗ " + e.message;
    }
  };
}

function collectTags(list) {
  const m = new Map(); list.forEach(e => (e.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
}

function applyFilters() {
  let list = EVENTS.filter(e => {
    const c = e.contractor || {};
    const hay = JSON.stringify({ a: e.title, b: e.title_zh, c: e.summary_zh, d: e.summary, t: e.tags, p: e.programs, k: c.name, tk: c.ticker, pt: c.parent_ticker, ag: e.agency }).toLowerCase();
    const mk = !market || (market === "listed" && isListed(e)) || (market === "private" && !isListed(e));
    return (!q || hay.includes(q)) && (!country || e.country === country) && (!type || e.event_type === type) && mk && (!activeTag || (e.tags || []).includes(activeTag));
  });
  if (sort === "importance") list.sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
  else if (sort === "amount") list.sort((a, b) => (b.contract?.amount || 0) - (a.contract?.amount || 0));
  else list.sort((a, b) => String(b.publication_date || "").localeCompare(String(a.publication_date || "")));

  // chips
  const chips = root.querySelector("#chips");
  chips.innerHTML = collectTags(EVENTS).map(([t, c]) => `<button class="mil-chip ${activeTag === t ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)} <span class="chip-count">${c}</span></button>`).join("");
  chips.querySelectorAll("[data-tag]").forEach(b => b.onclick = () => { activeTag = activeTag === b.dataset.tag ? "" : b.dataset.tag; applyFilters(); });

  root.querySelector("#count").textContent = `${list.length} 筆`;
  const box = root.querySelector("#list");
  if (!list.length) { box.innerHTML = `<p class="mil-meta">沒有符合條件的事件。</p>`; return; }
  box.innerHTML = list.map(cardHTML).join("");
  box.querySelectorAll("[data-open]").forEach(el => el.onclick = () => openDetail(list.find(e => (e.__id || e.event_id || e.title) === el.dataset.open)));
  if (isAdmin) box.querySelectorAll("[data-del]").forEach(b => b.onclick = async ev => { ev.stopPropagation(); if (confirm("刪除此事件？")) { const s = await getStore(); if (s) { await s.deleteDefenseEvent(b.dataset.del); await refresh(); } } });
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
