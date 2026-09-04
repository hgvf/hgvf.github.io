// militarynews.js — News · Military（軍武動態情報）. Reads collection
// `military_news`（military-dynamics-intelligence skill）. Three tabs:
//   · 事件動態  — filterable event feed + detail modal
//   · 世界地圖  — equirectangular world map of exercises / deployments / tests,
//                filtered by live status (ongoing / upcoming / ended)
//   · ETL 分析  — in-browser aggregates（no contractor / ticker / money model）
// Collection may be empty or absent — everything degrades to an empty layout
// without throwing.
import { esc, onAuth } from "./reports.js";
import { loadNews, saveNews, deleteNews, rebuildNewsIndex, parseNewsRun } from "./newsdata.js";
import { makeFacetState, renderFacetSearch } from "./facetsearch.js";

const searchState = makeFacetState();  // 2×2 多維複選搜尋的選取狀態（跨分頁切換保留）

const COL = "military_news";
const root = document.getElementById("app");
let EVENTS = [];
let isAdmin = false;
let q = "", country = "", type = "", service = "", month = "", sort = "date", activeTag = "";
let mapStatus = "ongoing", mapType = "";
let activeView = "list";
const PAGE_SIZE = 30;
let shownLimit = PAGE_SIZE;

// ── vocab / labels ───────────────────────────────────────────────────────
const countryZh = { US: "美國", TW: "台灣", JP: "日本", KR: "韓國", CN: "中國", RU: "俄羅斯", AU: "澳洲", GB: "英國", FR: "法國", DE: "德國", IN: "印度", IL: "以色列", UA: "烏克蘭", KP: "北韓", PH: "菲律賓", SG: "新加坡", IT: "義大利", CA: "加拿大", NL: "荷蘭", PL: "波蘭", SE: "瑞典", TR: "土耳其", ES: "西班牙" };
const typeZh = {
  weapon_unveiling: "新武器公開", prototype_rollout: "原型出廠", first_flight: "首飛",
  sea_trial: "海試", weapon_test: "武器測試", evaluation_trial: "評估測試", certification: "認證",
  operational_fielding: "接裝配發", readiness_milestone: "戰備里程碑", deployment: "部署",
  exercise: "演習", combat_use: "實戰使用", combat_loss: "戰損", program_launch: "計畫啟動",
  program_milestone: "計畫里程碑", program_delay: "延誤", program_restructure: "重整",
  program_cancellation: "取消", service_entry: "服役", retirement: "除役",
  doctrine_strategy: "戰略準則", military_cooperation: "軍事合作", force_structure: "兵力結構",
  military_infrastructure: "軍事設施", intelligence_assessment: "情報觀察", incident_accident: "事故",
  capability_acquisition: "能力取得", other_military_news: "其他",
};
const serviceZh = { Army: "陸軍", Navy: "海軍", "Air Force": "空軍", "Marine Corps": "陸戰隊", "Space Force": "太空軍", "Coast Guard": "海巡", Joint: "聯合", Other: "其他" };
const categoryZh = {
  aircraft: "飛機", helicopter: "直升機", missile: "飛彈", munition: "彈藥", air_defense: "防空",
  ground_vehicle: "地面載具", artillery: "火砲", naval: "艦艇", submarine: "潛艦", drone: "無人機",
  counter_uas: "反無人機", radar_sensor: "雷達感測", electronic_warfare: "電子戰", space: "太空",
  cyber: "網路戰", c4isr: "C4ISR", engine_propulsion: "發動機推進", directed_energy: "定向能",
  hypersonic: "極音速", nuclear: "核武", small_arms: "輕兵器", weapon_component: "武器零件",
  infrastructure: "軍事設施", support: "支援", unknown: "未分類",
};
const verifyZh = {
  official_confirmed: "官方確認", multi_source_confirmed: "多來源確認", single_reliable_source: "單一可信來源",
  claim_only: "僅一方聲稱", conflicting: "來源衝突", unresolved: "未解決",
};
const CAT_KEEP = new Set(["c4isr"]);
const normKey = v => String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const cZ = v => countryZh[v] || v || "—";
const tZ = v => typeZh[normKey(v)] || (v || "").replaceAll("_", " ") || "—";
const sZ = v => serviceZh[v] || v || "—";
const catZ = v => { const k = normKey(v); return CAT_KEEP.has(k) ? k.toUpperCase() : (categoryZh[k] || (v || "").replaceAll("_", " ") || "未分類"); };

// ── date helpers ─────────────────────────────────────────────────────────
const evDate = e => e.publication_date || e.event_date || "";
const evMonth = e => evDate(e).slice(0, 7);
const evYear = e => evDate(e).slice(0, 4);
const impScore = e => Number(e.importance?.score ?? e.importance_score ?? 0) || 0;
const primarySystem = e => (e.systems || [])[0] || null;
const TODAY = new Date().toISOString().slice(0, 10);

// exercise / deployment live status, recomputed against today (never trust
// stored `ongoing`).
function liveStatus(e) {
  const m = e.map || {};
  const win = e.exercise || e.deployment || {};
  const start = (m.active_from || win.start_date || e.event_date || "").slice(0, 10);
  const end = (m.active_until || win.end_date || e.event_end_date || "").slice(0, 10);
  if (start && start > TODAY) return "upcoming";
  if (end && end < TODAY) return "ended";
  if (start && start <= TODAY && (!end || end >= TODAY)) return "ongoing";
  if (!start && !end && normKey(e.event_status) === "ongoing") return "ongoing";
  return end ? "ended" : "unknown";
}
const STATUS_ZH = { ongoing: "進行中", upcoming: "即將開始", ended: "已結束", unknown: "未定" };

// ── SVG helper ───────────────────────────────────────────────────────────
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
    ${empty ? `<div class="df-banner">目前<b>尚無資料</b>（Firestore <code>military_news</code> 尚未建立或為空）。頁面版面已就緒，待 <code>military-dynamics-intelligence</code> skill 產出資料後即自動顯示。登入白名單帳號可用上方「ADD JSON」手動匯入。</div>` : ""}

    <div class="df-tabs" role="tablist">
      <button class="df-tab ${activeView === "list" ? "active" : ""}" data-view="list" role="tab">事件動態</button>
      <button class="df-tab ${activeView === "map" ? "active" : ""}" data-view="map" role="tab">世界地圖</button>
      <button class="df-tab ${activeView === "eta" ? "active" : ""}" data-view="eta" role="tab">ETL 分析</button>
    </div>

    <section class="df-pane" id="pane-list" ${activeView === "list" ? "" : "hidden"}>
      <div class="df-toolbar nm-toolbar">
        <input id="fSearch" class="df-input" placeholder="搜尋標題 / 系統 / 計畫 / 部隊 / 演習…" value="${esc(q)}" />
        <span class="rv-sel-wrap"><select id="fMonth" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fCountry" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fType" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fService" class="rv-select"></select></span>
        <span class="rv-sel-wrap"><select id="fSort" class="rv-select"><option value="date">最新優先</option><option value="importance">重要度</option></select></span>
      </div>
      <div class="df-chips" id="chips"></div>
      <div class="df-listhead"><h3>事件</h3><span id="count" class="df-meta"></span></div>
      <div class="df-list" id="list"></div>
      <div class="df-more" id="moreWrap" hidden><button class="rp-btn ghost" id="moreBtn"></button></div>
    </section>

    <section class="df-pane" id="pane-map" ${activeView === "map" ? "" : "hidden"}>
      <div class="nm-map-head">
        <div class="df-toggle" id="mapStatus">
          <button data-st="ongoing" class="active">進行中</button>
          <button data-st="upcoming">即將</button>
          <button data-st="ended">已結束</button>
          <button data-st="all">全部</button>
        </div>
        <span class="rv-sel-wrap"><select id="mapType" class="rv-select"><option value="">全部事件類型</option></select></span>
        <span class="df-meta" id="mapCount"></span>
      </div>
      <p class="df-meta nm-map-hint">依公開精度顯示演習 / 部署 / 測試 / 事故位置；精度僅到區域或戰區者以較大、半透明標記呈現，非精確軍事座標。點標記可看事件細節。</p>
      <div class="nm-map-wrap" id="mapWrap"></div>
      <div class="nm-map-legend" id="mapLegend"></div>
      <div class="nm-map-list" id="mapList"></div>
    </section>

    <section class="df-pane" id="pane-eta" ${activeView === "eta" ? "" : "hidden"}>
      <section id="analytics"></section>
    </section>`;

  const months = [...new Set(EVENTS.map(evMonth).filter(Boolean))].sort().reverse();
  const fm = root.querySelector("#fMonth");
  if (month && !months.includes(month)) month = "";
  fm.innerHTML = `<option value="">全部月份</option>` + months.map(m => `<option value="${m}" ${m === month ? "selected" : ""}>${m}</option>`).join("");
  const fc = root.querySelector("#fCountry");
  fc.innerHTML = `<option value="">全部國家</option>` + [...new Set(EVENTS.map(e => e.country))].filter(Boolean).sort().map(c => `<option value="${c}" ${c === country ? "selected" : ""}>${cZ(c)}</option>`).join("");
  const ft = root.querySelector("#fType");
  ft.innerHTML = `<option value="">全部類型</option>` + [...new Set(EVENTS.map(e => e.event_type))].filter(Boolean).sort().map(t => `<option value="${t}" ${t === type ? "selected" : ""}>${tZ(t)}</option>`).join("");
  const fs = root.querySelector("#fService");
  fs.innerHTML = `<option value="">全部軍種</option>` + [...new Set(EVENTS.map(e => e.service))].filter(Boolean).sort().map(s => `<option value="${s}" ${s === service ? "selected" : ""}>${sZ(s)}</option>`).join("");
  root.querySelector("#fSort").value = sort;

  root.querySelector("#fSearch").oninput = e => { q = e.target.value.trim().toLowerCase(); shownLimit = PAGE_SIZE; applyFilters(); };
  fm.onchange = e => { month = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  fc.onchange = e => { country = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  ft.onchange = e => { type = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  fs.onchange = e => { service = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#fSort").onchange = e => { sort = e.target.value; shownLimit = PAGE_SIZE; applyFilters(); };
  root.querySelector("#moreBtn").onclick = () => { shownLimit += PAGE_SIZE; applyFilters(); };
  root.querySelectorAll(".df-tabs [data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));

  // map controls
  const mt = root.querySelector("#mapType");
  mt.innerHTML = `<option value="">全部事件類型</option>` + [...new Set(EVENTS.map(e => e.event_type))].filter(Boolean).sort().map(t => `<option value="${t}" ${t === mapType ? "selected" : ""}>${tZ(t)}</option>`).join("");
  mt.onchange = e => { mapType = e.target.value; drawMap(); };
  root.querySelectorAll("#mapStatus [data-st]").forEach(b => b.onclick = () => {
    mapStatus = b.dataset.st;
    root.querySelectorAll("#mapStatus [data-st]").forEach(x => x.classList.toggle("active", x.dataset.st === mapStatus));
    drawMap();
  });
  root.querySelectorAll("#mapStatus [data-st]").forEach(b => b.classList.toggle("active", b.dataset.st === mapStatus));
}

function setView(v) {
  if (v === activeView) return;
  activeView = v;
  root.querySelectorAll(".df-tabs [data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  ["list", "map", "eta"].forEach(k => { const p = root.querySelector(`#pane-${k}`); if (p) p.hidden = k !== v; });
  applyView();
}

function applyView() {
  applyFilters();
  if (activeView === "map") drawMap();
  if (activeView === "eta") renderAnalytics();
}

// ── event feed ─────────────────────────────────────────────────────────
function collectTags(list) {
  const m = new Map(); list.forEach(e => (e.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
}

function applyFilters() {
  if (!root.querySelector("#list")) return;
  let list = EVENTS.filter(e => {
    const hay = JSON.stringify({
      a: e.title, b: e.title_zh, c: e.summary_zh, d: e.summary, t: e.tags,
      s: (e.systems || []).map(x => [x.canonical_name, x.name_zh, x.name_raw]),
      p: (e.programs || []).map(x => [x.canonical_name, x.name_zh]),
      u: (e.units || []).map(x => x.name), ex: e.exercise?.exercise_name, ag: e.agency,
    }).toLowerCase();
    return (!q || hay.includes(q)) && (!country || e.country === country) && (!type || e.event_type === type)
      && (!service || e.service === service) && (!month || evMonth(e) === month)
      && (!activeTag || (e.tags || []).includes(activeTag));
  });
  if (sort === "importance") list.sort((a, b) => impScore(b) - impScore(a));
  else list.sort((a, b) => String(evDate(b)).localeCompare(String(evDate(a))));

  const chips = root.querySelector("#chips");
  chips.innerHTML = collectTags(EVENTS).map(([t, c]) => `<button class="df-chip ${activeTag === t ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)} <span>${c}</span></button>`).join("");
  chips.querySelectorAll("[data-tag]").forEach(b => b.onclick = () => { activeTag = activeTag === b.dataset.tag ? "" : b.dataset.tag; shownLimit = PAGE_SIZE; applyFilters(); });

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

const keyOf = e => e.__id || e.event_id || e.title_zh || e.title;

function cardHTML(e) {
  const sysName = (e.systems || []).map(s => s.name_zh || s.canonical_name || s.name_raw).filter(Boolean);
  const primary = primarySystem(e);
  const st = e.event_type === "exercise" || e.event_type === "deployment" ? liveStatus(e) : "";
  return `<article class="df-card nm-card" data-open="${esc(keyOf(e))}" tabindex="0">
    <div class="df-card-main">
      <div class="df-card-meta">${cZ(e.country)} · ${sZ(e.service)} · ${tZ(e.event_type)} · ${esc(evDate(e))}</div>
      <h4 class="df-card-title">${esc(e.title_zh || e.title)}</h4>
      <p class="df-card-sum">${esc(e.summary_zh || e.summary || "")}</p>
      ${sysName.length ? `<div class="df-progs">${sysName.slice(0, 6).map(n => `<span class="df-prog">${esc(n)}</span>`).join("")}</div>` : ""}
      <div class="df-tags">${(e.tags || []).slice(0, 8).map(t => `<span class="df-tag">#${esc(t)}</span>`).join("")}</div>
      ${e.quality?.needs_review ? `<div class="df-review">需人工複核：${esc((e.quality.issues || []).join(" "))}</div>` : ""}
    </div>
    <aside class="df-card-side">
      <div class="nm-score">重要度 <b>${impScore(e)}</b></div>
      ${primary ? `<div class="nm-cat">${esc(catZ(primary.category))}</div>` : ""}
      ${st ? `<div class="nm-status nm-status-${st}">${STATUS_ZH[st]}</div>` : ""}
      ${e.quality?.verification_status ? `<div class="nm-verify">${esc(verifyZh[e.quality.verification_status] || e.quality.verification_status)}</div>` : ""}
      ${(e.locations || []).some(l => l.name) ? `<div class="nm-loc">📍 ${esc((e.locations.find(l => l.name) || {}).name || "")}</div>` : ""}
      ${isAdmin && e.__id ? `<button class="rp-btn ghost df-del" data-del="${esc(e.__id)}">刪除</button>` : ""}
    </aside>
  </article>`;
}

function openDetail(e) {
  if (!e) return;
  const src = (e.sources || [])[0];
  const kv = (label, val) => val ? `<div><span>${label}</span>${esc(val)}</div>` : "";
  const sysBlock = (e.systems || []).map(s => `<span class="df-prog">${esc(s.name_zh || s.canonical_name || s.name_raw)}${s.category ? ` <i>· ${esc(catZ(s.category))}</i>` : ""}</span>`).join("");
  const progBlock = (e.programs || []).map(p => `<span class="df-prog">${esc(p.name_zh || p.canonical_name || p.program_name_raw)}</span>`).join("");
  const unitBlock = (e.units || []).map(u => `<span class="df-tag">${esc(u.name || u.name_raw)}${u.country ? `（${cZ(u.country)}）` : ""}</span>`).join("");
  const ex = e.exercise, dep = e.deployment, test = e.test, combat = e.combat, ms = e.milestone, inc = e.incident;

  let modal = document.getElementById("dfModal");
  if (!modal) { modal = document.createElement("div"); modal.id = "dfModal"; modal.className = "df-modal"; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="df-modal-box">
    <button class="df-modal-close" aria-label="關閉">×</button>
    <div class="df-card-meta">${cZ(e.country)} · ${e.agency || sZ(e.service)} · ${tZ(e.event_type)} · ${esc(evDate(e))}${e.theater ? ` · ${esc(e.theater)}` : ""}</div>
    <h3 class="df-modal-title">${esc(e.title_zh || e.title)}</h3>
    ${e.title_zh && e.title ? `<div class="df-orig">英文原文：${esc(e.title)}</div>` : ""}
    <p class="df-modal-sum">${esc(e.summary_zh || e.summary || "")}</p>
    ${e.why_it_matters_zh ? `<div class="nm-why"><b>為何重要：</b>${esc(e.why_it_matters_zh)}</div>` : ""}
    ${e.summary_zh && e.summary ? `<details class="df-en"><summary>查看英文原文摘要</summary><p>${esc(e.summary)}</p></details>` : ""}

    <div class="df-grid2">
      ${kv("事件階段", e.event_phase)}
      ${kv("事件狀態", e.event_status)}
      ${kv("驗證", verifyZh[e.quality?.verification_status] || e.quality?.verification_status)}
      ${kv("重要度", String(impScore(e)))}
    </div>

    ${sysBlock ? `<div class="df-block"><h5>相關系統 / 平台</h5><div class="df-progs">${sysBlock}</div></div>` : ""}
    ${progBlock ? `<div class="df-block"><h5>相關計畫</h5><div class="df-progs">${progBlock}</div></div>` : ""}
    ${unitBlock ? `<div class="df-block"><h5>部隊 / 機構</h5><div class="df-tags">${unitBlock}</div></div>` : ""}

    ${ex ? `<div class="df-block"><h5>演習</h5><div class="df-grid2">
      ${kv("名稱", ex.exercise_name)}${kv("主辦", cZ(ex.host_country))}
      ${kv("期間", [ex.start_date, ex.end_date].filter(Boolean).join(" → "))}
      ${kv("規模", ex.scale)}${kv("參與國", (ex.participant_countries || []).map(cZ).join("、"))}
      ${kv("實彈", ex.live_fire === true ? "是" : ex.live_fire === false ? "否" : "")}
    </div></div>` : ""}
    ${dep ? `<div class="df-block"><h5>部署</h5><div class="df-grid2">
      ${kv("型態", dep.deployment_type)}${kv("目的地", dep.destination)}
      ${kv("期間", [dep.start_date, dep.end_date].filter(Boolean).join(" → "))}${kv("目的", dep.stated_purpose)}
    </div></div>` : ""}
    ${test ? `<div class="df-block"><h5>測試</h5><div class="df-grid2">
      ${kv("類型", test.test_type)}${kv("結果", test.result)}
      ${kv("目標", test.objective_zh)}${kv("說明", test.result_details_zh)}
    </div></div>` : ""}
    ${combat ? `<div class="df-block"><h5>實戰</h5><div class="df-grid2">
      ${kv("行動", combat.operation_name)}${kv("宣稱結果", combat.claimed_result)}
      ${kv("確認結果", combat.confirmed_result)}${kv("損失", combat.losses)}
    </div></div>` : ""}
    ${ms ? `<div class="df-block"><h5>里程碑</h5><div class="df-grid2">
      ${kv("類型", ms.milestone_type)}${kv("前狀態", ms.previous_state)}${kv("後狀態", ms.new_state)}${kv("實際日期", ms.actual_date)}
    </div></div>` : ""}
    ${inc ? `<div class="df-block"><h5>事故</h5><div class="df-grid2">
      ${kv("類型", inc.incident_type)}${kv("死亡", inc.fatalities)}${kv("受傷", inc.injuries)}${kv("調查", inc.investigation_status)}
    </div></div>` : ""}

    ${(e.locations || []).some(l => l.name) ? `<div class="df-block"><h5>地點</h5><div class="df-tags">${(e.locations || []).filter(l => l.name).map(l => `<span class="df-tag">📍 ${esc(l.name)}${l.precision ? `（${esc(l.precision)}）` : ""}</span>`).join("")}</div></div>` : ""}

    ${src?.url && /^https?:\/\//.test(src.url) ? `<a class="rp-btn" href="${esc(src.url)}" target="_blank" rel="noopener">開啟 ${esc(src.publisher || "來源")} ↗</a>` : `<div class="df-meta">此筆無公開來源連結</div>`}
  </div>`;
  modal.classList.add("open");
  const close = () => modal.classList.remove("open");
  modal.querySelector(".df-modal-close").onclick = close;
  modal.onclick = ev => { if (ev.target === modal) close(); };
  document.addEventListener("keydown", function onEsc(ev) { if (ev.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } });
}

// ── world map ─────────────────────────────────────────────────────────
// Marker colour by event category.
const MARKER_COLOR = {
  exercise: "#DC2626", deployment: "#2563EB", weapon_test: "#D97706", combat_use: "#7C1D1D",
  combat_loss: "#7C1D1D", incident_accident: "#CA8A04", military_infrastructure: "#059669",
  first_flight: "#7C3AED", sea_trial: "#0891B2", default: "#8B5E3C",
};
const markerColor = e => MARKER_COLOR[e.map?.marker_category || e.event_type] || MARKER_COLOR.default;

// Real country backdrop: a simplified Natural Earth 110m admin-0 countries
// outline (data/world-countries.json — one entry per country, each an array of
// [lon,lat] rings, coords rounded to 0.1°, ~127KB) drawn in the same
// equirectangular projection as the markers, one SVG path per country so
// national borders show. Loaded lazily on first map draw and cached; until it
// arrives (or if the fetch fails) the coarse CONTINENTS blobs below are used as
// an instant, offline fallback.
let LAND = null, landTried = false;
async function ensureLand() {
  if (LAND || landTried) return;
  landTried = true;
  try {
    const url = new URL("../data/world-countries.json", import.meta.url);
    const countries = await (await fetch(url)).json();
    if (Array.isArray(countries) && countries.length) { LAND = countries; if (activeView === "map") drawMap(); }
  } catch { /* offline / missing — keep the coarse fallback */ }
}

// Coarse continent outlines (lon/lat) — instant offline fallback shown until the
// detailed coastline (LAND, above) finishes loading, or if that load fails.
const CONTINENTS = [
  [[-168,66],[-160,71],[-128,70],[-100,68],[-82,73],[-60,60],[-52,47],[-66,44],[-70,41],[-81,25],[-97,26],[-97,18],[-105,20],[-117,32],[-124,40],[-124,48],[-135,58],[-152,58]],
  [[-80,8],[-60,10],[-50,0],[-35,-6],[-40,-22],[-48,-25],[-58,-34],[-65,-48],[-71,-52],[-75,-45],[-71,-30],[-70,-18],[-78,-4]],
  [[-16,15],[-10,30],[10,37],[25,32],[35,31],[43,12],[51,12],[40,-5],[40,-18],[32,-26],[20,-35],[15,-28],[12,-16],[8,4],[-8,5]],
  [[-10,36],[-9,44],[-2,49],[2,51],[-4,58],[5,62],[10,64],[25,71],[30,60],[40,58],[45,50],[28,41],[20,40],[15,37],[3,43],[-2,36]],
  [[45,50],[60,55],[75,55],[100,54],[120,53],[135,55],[145,48],[142,50],[135,35],[122,31],[120,22],[108,21],[105,10],[100,7],[95,16],[90,22],[80,10],[77,8],[72,20],[62,25],[52,27],[48,30],[45,40]],
  [[113,-22],[125,-15],[137,-12],[142,-11],[147,-20],[153,-28],[150,-38],[143,-39],[130,-32],[123,-34],[115,-34],[114,-27]],
];

function displayableLocs(e) {
  return (e.locations || []).filter(l => l && l.map_display_allowed !== false && l.geometry && Array.isArray(l.geometry.coordinates));
}
function firstPoint(geom) {
  if (!geom) return null;
  const c = geom.coordinates;
  if (geom.type === "Point") return c;
  if (geom.type === "MultiPoint" || geom.type === "LineString") return c[0];
  if (geom.type === "Polygon") { // centroid-ish: average of outer ring
    const ring = c[0] || [];
    if (!ring.length) return null;
    const s = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    return [s[0] / ring.length, s[1] / ring.length];
  }
  return null;
}

function drawMap() {
  const wrap = root.querySelector("#mapWrap");
  if (!wrap) return;
  const W = 960, H = 480, padX = 10, padY = 8;
  const X = lon => padX + (lon + 180) / 360 * (W - 2 * padX);
  const Y = lat => padY + (90 - lat) / 180 * (H - 2 * padY);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "nm-map", width: "100%" });
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, class: "nm-ocean" }));
  // graticule
  for (let lon = -150; lon <= 150; lon += 30) svg.appendChild(svgEl("line", { x1: X(lon), y1: padY, x2: X(lon), y2: H - padY, class: "nm-grat" }));
  for (let lat = -60; lat <= 60; lat += 30) svg.appendChild(svgEl("line", { x1: padX, y1: Y(lat), x2: W - padX, y2: Y(lat), class: `nm-grat ${lat === 0 ? "eq" : ""}` }));
  // land: detailed countries (one path each, so borders show) once loaded,
  // else the coarse fallback blobs
  ensureLand();
  if (LAND) {
    LAND.forEach(country => {
      const d = country.map(ring =>
        "M" + ring.map(([lon, lat]) => `${X(lon).toFixed(1)} ${Y(lat).toFixed(1)}`).join("L") + "Z").join("");
      svg.appendChild(svgEl("path", { d, class: "nm-land", "fill-rule": "evenodd" }));
    });
  } else {
    CONTINENTS.forEach(ring => {
      const pts = ring.map(([lon, lat]) => `${X(lon).toFixed(1)},${Y(lat).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("polygon", { points: pts, class: "nm-land" }));
    });
  }

  // markers
  const events = EVENTS.filter(e => (!mapType || e.event_type === mapType) && (mapStatus === "all" || liveStatus(e) === mapStatus || (mapStatus === "ongoing" && !["exercise", "deployment"].includes(e.event_type) && displayableLocs(e).length && liveStatus(e) === "unknown")));
  let plotted = [];
  events.forEach(e => {
    displayableLocs(e).forEach((loc, i) => {
      const p = firstPoint(loc.geometry);
      if (!p) return;
      const [lon, lat] = p;
      if (isNaN(lon) || isNaN(lat)) return;
      const cx = X(lon), cy = Y(lat), col = markerColor(e);
      const low = loc.geocode_confidence === "low" || ["country", "sea_region", "theater"].includes(loc.precision);
      if (low) { // fuzzy region marker
        const halo = svgEl("circle", { cx, cy, r: 16, fill: col, opacity: 0.14 });
        svg.appendChild(halo);
      }
      const dot = svgEl("circle", { cx, cy, r: low ? 5 : 5.5, fill: col, "fill-opacity": low ? 0.55 : 0.9, stroke: "#fff", "stroke-width": 1, class: "nm-marker", style: "cursor:pointer" });
      const title = svgEl("title"); title.textContent = `${e.title_zh || e.title}｜${cZ(e.country)}｜${loc.name || ""}`; dot.appendChild(title);
      dot.addEventListener("click", () => openDetail(e));
      svg.appendChild(dot);
      plotted.push({ e, loc });
    });
  });
  wrap.innerHTML = "";
  wrap.appendChild(svg);

  root.querySelector("#mapCount").textContent = plotted.length ? `${plotted.length} 個標記 · ${new Set(plotted.map(x => keyOf(x.e))).size} 起事件` : "此條件下無可顯示位置";

  // legend
  const cats = [...new Set(events.map(e => e.map?.marker_category || e.event_type))].filter(Boolean);
  root.querySelector("#mapLegend").innerHTML = cats.map(c => `<span class="nm-leg"><span class="nm-leg-dot" style="background:${MARKER_COLOR[c] || MARKER_COLOR.default}"></span>${esc(tZ(c))}</span>`).join("") || `<span class="df-meta">尚無可顯示的事件位置。地圖底圖已就緒。</span>`;

  // side list
  const ml = root.querySelector("#mapList");
  const byEvent = [];
  const seen = new Set();
  plotted.forEach(({ e, loc }) => { const k = keyOf(e); if (seen.has(k)) return; seen.add(k); byEvent.push({ e, loc }); });
  ml.innerHTML = byEvent.length ? byEvent.map(({ e, loc }) => {
    const st = liveStatus(e);
    return `<div class="nm-map-row" data-open="${esc(keyOf(e))}">
      <span class="nm-leg-dot" style="background:${markerColor(e)}"></span>
      <span class="nm-map-row-title">${esc(e.title_zh || e.title)}</span>
      <span class="nm-map-row-loc">${esc(loc.name || "")}</span>
      <span class="nm-status nm-status-${st}">${STATUS_ZH[st]}</span>
    </div>`;
  }).join("") : "";
  ml.querySelectorAll("[data-open]").forEach(el => el.onclick = () => openDetail(EVENTS.find(e => keyOf(e) === el.dataset.open)));
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

function renderAnalytics() {
  const host = document.getElementById("analytics");
  if (!host) return;
  const E = EVENTS;
  if (!E.length) { host.innerHTML = `<p class="df-meta">尚無資料可供分析。待 <code>military_news</code> 有事件後，此處會就地彙整國家、軍種、系統類別、事件類型、演習與部署等統計。</p>`; return; }

  const countries = new Set(E.map(e => e.country).filter(Boolean));
  const systems = new Set(E.flatMap(e => (e.systems || []).map(s => s.system_id || s.canonical_name).filter(Boolean)));
  const programs = new Set(E.flatMap(e => (e.programs || []).map(p => p.program_id || p.canonical_name).filter(Boolean)));
  const official = E.filter(e => e.quality?.verification_status === "official_confirmed").length;
  const needsReview = E.filter(e => e.quality?.needs_review).length;
  const bigRecent = E.filter(e => impScore(e) >= 70).length;
  const ongoingEx = E.filter(e => e.event_type === "exercise" && liveStatus(e) === "ongoing").length;
  const activeDep = E.filter(e => e.event_type === "deployment" && liveStatus(e) === "ongoing").length;

  const byCountry = tally(E, e => e.country).map(([k, v]) => ({ label: cZ(k), value: v }));
  const byType = tally(E, e => e.event_type).map(([k, v]) => ({ label: tZ(k), value: v }));
  const byService = tally(E, e => e.service).map(([k, v]) => ({ label: sZ(k), value: v }));
  const byCat = tally(E, null, e => (e.systems || []).map(s => s.category)).map(([k, v]) => ({ label: catZ(k), value: v })).slice(0, 12);

  host.innerHTML = `
    <p class="df-meta df-note">就地彙整目前載入的 ${E.length} 筆軍武動態事件。此頁不使用合約金額 / ticker / 承包商模型，聚焦全球軍事活動、武器生命週期與演習部署位置。</p>

    <div class="df-stats nm-stats">
      <div class="df-stat"><div class="df-stat-l">事件數</div><div class="df-stat-v">${E.length}</div></div>
      <div class="df-stat"><div class="df-stat-l">涉及國家</div><div class="df-stat-v">${countries.size}</div></div>
      <div class="df-stat"><div class="df-stat-l">武器 / 平台</div><div class="df-stat-v">${systems.size}</div></div>
      <div class="df-stat"><div class="df-stat-l">計畫數</div><div class="df-stat-v">${programs.size}</div></div>
      <div class="df-stat"><div class="df-stat-l">重大事件（≥70）</div><div class="df-stat-v accent">${bigRecent}</div></div>
      <div class="df-stat"><div class="df-stat-l">官方確認率</div><div class="df-stat-v">${E.length ? Math.round(official / E.length * 100) : 0}%</div></div>
      <div class="df-stat"><div class="df-stat-l">進行中演習</div><div class="df-stat-v">${ongoingEx}</div></div>
      <div class="df-stat"><div class="df-stat-l">有效部署</div><div class="df-stat-v">${activeDep}</div></div>
    </div>

    ${needsReview ? `<p class="df-meta">其中 <b>${needsReview}</b> 筆標記需人工複核。</p>` : ""}

    <section id="nmSearch"></section>

    <div class="df-anagrid">
      <div class="df-anacard"><h4>國別事件分布</h4>${hbars(byCountry, v => v + " 筆", "var(--accent)")}</div>
      <div class="df-anacard"><h4>事件類型分布</h4>${hbars(byType, v => v + " 筆", "#9C6B44")}</div>
      <div class="df-anacard"><h4>軍種分布</h4>${hbars(byService, v => v + " 筆", "#5C8A5C")}</div>
      <div class="df-anacard"><h4>系統類別分布</h4>${hbars(byCat, v => v + " 筆", "#2563EB")}</div>
    </div>

    <div class="df-anacard"><h4>事件時間序列 <span class="df-meta">（每月筆數）</span></h4><div id="nmTimeline" class="df-chartbox"></div></div>`;

  drawTimeline(host.querySelector("#nmTimeline"));

  renderFacetSearch(host.querySelector("#nmSearch"), searchState, {
    title: "事件搜尋 · 多維複選",
    facets: [
      { key: "country", title: "國家", placeholder: "篩選國家…", values: e => (e.country ? [e.country] : []), label: cZ },
      { key: "type", title: "事件類型", placeholder: "篩選事件類型…", values: e => (e.event_type ? [e.event_type] : []), label: tZ },
      { key: "service", title: "軍種", placeholder: "篩選軍種…", values: e => (e.service ? [e.service] : []), label: sZ },
      { key: "category", title: "系統類別", placeholder: "篩選系統類別…", values: e => [...new Set((e.systems || []).map(s => s.category).filter(Boolean))], label: catZ },
    ],
    getEvents: () => EVENTS,
    keyOf,
    sortRows: (a, b) => String(evDate(b)).localeCompare(String(evDate(a))),
    summary: rows => `${rows.length} 筆 · ${new Set(rows.map(e => e.country).filter(Boolean)).size} 國`,
    emptyHint: "於上方任一維度<b>複選</b>條件即可查詢；可跨維度組合（如「美國 × 演習 × 海軍」）。",
    renderRow: e => `<div class="df-crow" data-open="${esc(String(keyOf(e)))}">
        <span class="df-crow-date">${esc(evDate(e) || "—")}</span>
        <span class="df-crow-title">${esc(e.title_zh || e.title)}</span>
        <span class="df-crow-type">${esc(cZ(e.country))} · ${esc(tZ(e.event_type))}</span>
        <span class="df-crow-amt">重要度 ${impScore(e)}</span>
      </div>`,
    onOpen: openDetail,
  });
}

// tally by keyFn (single) or listFn (array of keys); returns sorted [key,count].
function tally(E, keyFn, listFn) {
  const m = {};
  E.forEach(e => {
    const keys = listFn ? listFn(e) : [keyFn(e)];
    (keys || []).forEach(k => { if (k == null || k === "") return; m[k] = (m[k] || 0) + 1; });
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
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
      const n = await saveNews(COL, events, e => e.publication_date || e.event_date || "");
      status.className = "rp-status ok"; status.textContent = `✓ 已發布 ${n} 筆`;
      ta.value = ""; await refresh(true);
    } catch (e) {
      status.className = "rp-status err";
      status.textContent = /permission|insufficient/i.test(e.message || "") ? "✗ 權限不足：帳號需在白名單且已部署 Firestore 規則。" : "✗ " + e.message;
    }
  };
}
