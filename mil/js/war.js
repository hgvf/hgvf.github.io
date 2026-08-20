// war.js — ② 戰役消耗帳（多戰爭）。戰爭切換選單、戰役 filter（可只挑重要的放上 timeline）、
// 時序視圖 + 海圖視圖、戰役↔武器 join、ADD JSON 插入（Firestore mil_conflicts）。
import { loadJSON, showErr, esc, fmtDate, svgEl } from "../js/milcore.js";

let REGISTRY = [];        // [{id,name_zh,...,file?,data?}]
let CONF = null;          // 目前選中的戰爭（完整資料）
let BYW = new Map(), BYB = new Map();
let view = "timeline";
let selected = new Set(); // 顯示在 timeline/map 上的戰役 id
let isAdmin = false;
let store = null;

const root = document.getElementById("app");
const DAY = 86400000;
const ms = d => new Date(d + "T00:00:00").getTime();

async function getStore() { if (store) return store; try { store = await import("../js/milstore.js"); } catch { store = null; } return store; }

(async function () {
  root.innerHTML = `<p class="mil-meta">載入中…</p>`;
  document.body.addEventListener("mil-auth", e => { isAdmin = !!e.detail.isAdmin; const p = document.getElementById("warImport"); if (p) { p.hidden = !isAdmin; if (isAdmin) wireImport(); } });
  try {
    const idx = await loadJSON("../data/wars/index.json");
    REGISTRY = (idx.conflicts || []).map(c => ({ ...c }));
  } catch (e) { showErr(root, e.message); return; }
  // 併入 Firestore mil_conflicts（若可用）
  const s = await getStore();
  if (s) { try {
    const docs = await s.loadConflicts();
    docs.forEach(d => {
      const data = d.data || d;
      const i = REGISTRY.findIndex(r => r.id === data.id);
      const entry = { id: data.id, name_zh: data.name_zh, name_en: data.name_en, start: data.start, end: data.end, region_zh: data.region_zh, data, _fs: d.id };
      if (i >= 0) REGISTRY[i] = entry; else REGISTRY.push(entry);
    });
  } catch { /* ignore */ } }
  REGISTRY.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const wanted = new URLSearchParams(location.hash.split("?")[1] || "").get("war");
  await selectConflict(wanted && REGISTRY.find(r => r.id === wanted) ? wanted : REGISTRY[0]?.id);
})();

async function loadConflictData(reg) {
  if (reg.data) return reg.data;
  return loadJSON(`../data/wars/${reg.file}`);
}

async function selectConflict(id) {
  const reg = REGISTRY.find(r => r.id === id);
  if (!reg) { showErr(root, "查無戰爭：" + id); return; }
  try { CONF = await loadConflictData(reg); }
  catch (e) { showErr(root, e.message); return; }
  BYW = new Map((CONF.weapons || []).map(w => [w.id, w]));
  BYB = new Map(CONF.battles.map(b => [b.id, b]));
  selected = new Set(CONF.battles.map(b => b.id));   // 預設全部
  render();
}

// 依 side_labels 判定 outcome 屬藍(我方)或紅(對方)
function outcomeSide(o) {
  const al = CONF.side_labels?.allied, en = CONF.side_labels?.enemy;
  if (/持續|僵持|中$/.test(o)) return "ongoing";
  if (al && o.includes(al)) return "allied";
  if (en && o.includes(en)) return "enemy";
  if (/盟軍|聯軍|美軍|烏克蘭/.test(o)) return "allied";
  return "enemy";
}

function render() {
  const battles = CONF.battles;
  const maxD = Math.max(1, ...battles.flatMap(b => b.sides.map(s => s.deaths || 0)));
  root.innerHTML = `
    <div class="war-toolbar">
      <label class="war-switch">戰爭
        <span class="rv-sel-wrap"><select class="mil-select" id="warSel">${REGISTRY.map(r => `<option value="${r.id}" ${r.id === CONF.id ? "selected" : ""}>${esc(r.name_zh)}（${String(r.start).slice(0,4)}）</option>`).join("")}</select></span>
      </label>
      <div class="mil-toggle">
        <button class="mil-btn ${view==='timeline'?'mil-btn-primary':''}" data-v="timeline">時序視圖</button>
        <button class="mil-btn ${view==='map'?'mil-btn-primary':''}" data-v="map">海圖視圖</button>
      </div>
      <div class="war-legend">
        <span><i class="sw allied"></i>${esc(CONF.side_labels?.allied||"我方")}陣亡</span>
        <span><i class="sw japan"></i>${esc(CONF.side_labels?.enemy||"對方")}陣亡</span>
        <span><i class="sw brass"></i>轉捩點</span>
        <span class="mil-meta">高度 = √陣亡數</span>
      </div>
    </div>

    <div class="war-conf-meta mil-meta">${esc(CONF.name_zh)} · ${esc(CONF.name_en||"")} · ${esc(fmtDate(CONF.start))} – ${esc(fmtDate(CONF.end))} · ${esc(CONF.region_zh||"")}</div>

    <details class="mil-import" id="warImport" ${isAdmin ? "" : "hidden"}>
      <summary>匯入 / 新增戰爭（ADD JSON）</summary>
      <p class="hint">貼上一份<b>自足的戰爭 JSON</b>（含 <code>id / name_zh / start / end / phases / weapons[] / battles[]</code>，每場 battle 以 <code>weapons:[武器id]</code> 關聯本檔 weapons）。以 id 為主鍵，寫入 Firestore <code>mil_conflicts</code>，重貼同 id 覆蓋。範例結構見既有 <code>mil/data/wars/pacific_war.json</code>。</p>
      <textarea id="warJson" class="mil-textarea" rows="8" spellcheck="false" placeholder='{"id":"my_war","name_zh":"…","name_en":"…","start":"YYYY-MM-DD","end":"YYYY-MM-DD","region_zh":"…","side_labels":{"allied":"我方","enemy":"對方"},"phases":[{"id":"p1","name_zh":"…","start":"…","end":"…"}],"weapons":[{"id":"w1","name_zh":"…","side":"allied","family":"f","parent":null,"role":"…","service":[1990,null],"specs":{},"note":"…"}],"battles":[{"id":"b1","name_zh":"…","phase":"p1","start":"…","end":"…","location_zh":"…","coord":[25,121],"type":"…","turning_point":true,"featured":true,"sides":[{"key":"allied","name_zh":"…","committed":0,"deaths":0,"wounded":0,"materiel":""},{"key":"enemy","name_zh":"…","committed":0,"deaths":0}],"outcome":"…","significance":"…","weapons":["w1"]}]}'></textarea>
      <div class="actions"><button class="mil-btn mil-btn-primary" id="warPub">發布到 Firebase</button><span class="mil-status" id="warPubStatus"></span></div>
    </details>

    <div class="war-filter">
      <span class="war-filter-label">Timeline 篩選：</span>
      <button class="mil-btn" data-f="all">全部 (${battles.length})</button>
      <button class="mil-btn" data-f="turning">僅轉捩點 (${battles.filter(b=>b.turning_point).length})</button>
      <button class="mil-btn" data-f="featured">僅精選 (${battles.filter(b=>b.featured).length})</button>
      <details class="war-filter-custom"><summary>自訂挑選</summary>
        <div class="war-filter-list">${battles.map(b => `<label class="war-fchk"><input type="checkbox" data-bid="${b.id}" ${selected.has(b.id)?"checked":""}> ${esc(b.name_zh)}${b.turning_point?' <span class="mil-pill brass">轉捩</span>':''}</label>`).join("")}</div>
      </details>
      <span class="mil-meta" id="warSelCount"></span>
    </div>

    <section class="mil-panel"><div id="chart"></div></section>
    <section class="mil-panel" id="detailPanel"><p class="mil-meta">點選任一戰役 → 展開雙方消耗、戰略意義與參戰武器。點武器可看型號譜系與其他參戰戰役。</p></section>`;

  root.querySelector("#warSel").onchange = e => { const h = `#/?war=${e.target.value}`; history.replaceState(null, "", h); selectConflict(e.target.value); };
  root.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { view = b.dataset.v; drawChart(maxD); root.querySelectorAll("[data-v]").forEach(x => x.classList.toggle("mil-btn-primary", x.dataset.v === view)); });
  root.querySelectorAll("[data-f]").forEach(b => b.onclick = () => applyFilter(b.dataset.f));
  root.querySelectorAll("[data-bid]").forEach(c => c.onchange = () => { c.checked ? selected.add(c.dataset.bid) : selected.delete(c.dataset.bid); refreshChart(maxD); });
  if (isAdmin) wireImport();
  refreshChart(maxD);
  document.getElementById("warImport").hidden = !isAdmin;
}

function applyFilter(kind) {
  const battles = CONF.battles;
  if (kind === "all") selected = new Set(battles.map(b => b.id));
  else if (kind === "turning") selected = new Set(battles.filter(b => b.turning_point).map(b => b.id));
  else if (kind === "featured") selected = new Set(battles.filter(b => b.featured).map(b => b.id));
  root.querySelectorAll("[data-bid]").forEach(c => c.checked = selected.has(c.dataset.bid));
  const maxD = Math.max(1, ...battles.flatMap(b => b.sides.map(s => s.deaths || 0)));
  refreshChart(maxD);
}
function refreshChart(maxD) {
  root.querySelector("#warSelCount").textContent = `顯示 ${selected.size} / ${CONF.battles.length} 場`;
  drawChart(maxD);
}
function visibleBattles() { return CONF.battles.filter(b => selected.has(b.id)); }
function drawChart(maxD) { if (view === "timeline") drawTimeline(maxD); else drawMap(); }

// ── 時序視圖 ─────────────────────────────────────────────
function drawTimeline(maxD) {
  const host = document.getElementById("chart");
  const bs = visibleBattles();
  const W = Math.max(host.clientWidth || 900, 900), H = 560;
  const padL = 44, padR = 44, padT = 62, padB = 42, midY = H / 2;
  const t0 = ms(CONF.start), t1 = ms(CONF.end);
  const X = t => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const hScale = (midY - padT) / Math.sqrt(maxD);
  const barH = d => Math.sqrt(Math.max(0, d)) * hScale;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });

  (CONF.phases || []).forEach((p, i) => {
    const x1 = X(ms(p.start)), x2 = X(ms(p.end));
    svg.appendChild(svgEl("rect", { x: x1, y: padT, width: Math.max(0, x2 - x1), height: H - padT - padB, fill: i % 2 ? "#111922" : "#0e151d", opacity: 0.6 }));
    const lb = svgEl("text", { x: (x1 + x2) / 2, y: padT - 42, "text-anchor": "middle", class: "war-phase" }); lb.textContent = p.name_zh; svg.appendChild(lb);
  });
  svg.appendChild(svgEl("line", { x1: padL, y1: midY, x2: W - padR, y2: midY, stroke: "var(--brass)", "stroke-width": 1.2, opacity: 0.6 }));
  [[CONF.side_labels?.allied || "我方", "allied"], [CONF.side_labels?.enemy || "對方", "japan"]].forEach(([t, cls], i) => {
    const el = svgEl("text", { x: padL - 4, y: i ? midY + 16 : midY - 8, class: "war-axis-lbl", "text-anchor": "start", fill: i ? "var(--japan)" : "var(--allied)" }); el.textContent = (i ? "▼ " : "▲ ") + t; svg.appendChild(el);
  });
  const y0 = new Date(CONF.start).getFullYear(), y1 = new Date(CONF.end).getFullYear();
  for (let y = y0; y <= y1; y++) { const tx = X(ms(`${y}-01-01`)); if (tx < padL || tx > W - padR) continue; svg.appendChild(svgEl("line", { x1: tx, y1: padT, x2: tx, y2: H - padB, class: "mil-grid" })); const t = svgEl("text", { x: tx, y: H - padB + 20, "text-anchor": "middle", class: "mil-axis-txt" }); t.textContent = y; svg.appendChild(t); }

  const placed = [];
  [...bs].sort((a, b) => ms(a.start) - ms(b.start)).forEach(b => {
    const x1 = X(ms(b.start)), x2 = X(ms(b.end)), w = Math.max(3, x2 - x1), cx = (x1 + x2) / 2;
    const al = b.sides.find(s => s.key === "allied") || { deaths: 0 }, en = b.sides.find(s => s.key === "enemy") || b.sides.find(s => s.key === "japan") || { deaths: 0 };
    if (b.turning_point) svg.appendChild(svgEl("line", { x1: cx, y1: padT - 6, x2: cx, y2: H - padB, stroke: "var(--brass)", "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.7 }));
    const g = svgEl("g", { class: "war-battle", tabindex: "0", role: "button" });
    g.appendChild(svgEl("rect", { x: x1, y: midY - barH(al.deaths), width: w, height: barH(al.deaths), fill: "var(--allied)", opacity: 0.85, rx: 1 }));
    g.appendChild(svgEl("rect", { x: x1, y: midY, width: w, height: barH(en.deaths), fill: "var(--japan)", opacity: 0.85, rx: 1 }));
    g.addEventListener("click", () => showBattle(b.id));
    g.addEventListener("keydown", e => { if (e.key === "Enter") showBattle(b.id); });
    svg.appendChild(g);
    let ly = padT - 4;
    while (placed.some(p => Math.abs(p.x - cx) < 64 && Math.abs(p.y - ly) < 14)) ly -= 15;
    placed.push({ x: cx, y: ly });
    if (ly < padT - 4) svg.appendChild(svgEl("line", { x1: cx, y1: ly + 4, x2: cx, y2: midY - barH(al.deaths), stroke: "var(--rule)", "stroke-width": 0.8, opacity: 0.7 }));
    const lbl = svgEl("text", { x: cx, y: ly, "text-anchor": "middle", class: "war-blabel" }); lbl.textContent = b.name_zh; lbl.style.cursor = "pointer"; lbl.addEventListener("click", () => showBattle(b.id)); svg.appendChild(lbl);
  });
  host.innerHTML = ""; host.appendChild(svg);
  if (!bs.length) host.innerHTML = `<p class="mil-meta" style="padding:2rem;text-align:center">篩選後沒有可顯示的戰役。</p>`;
}

// ── 海圖視圖 ─────────────────────────────────────────────
const LON = l => (l < 0 ? l + 360 : l);
const COAST = [
  { pts: [[45,142],[41,140],[35,140],[34,136],[33,131],[31,131],[34,133],[36,138],[38,140],[41,141],[45,142]] },
  { pts: [[41,126],[39,122],[35,120],[31,122],[24,118],[22,114],[21,110],[24,110],[30,112],[35,119],[41,123],[41,126]] },
  { pts: [[18,120],[16,122],[12,124],[9,126],[6,125],[8,123],[11,122],[14,120],[18,120]] },
  { pts: [[-1,131],[-3,138],[-6,144],[-9,148],[-10,150],[-8,146],[-5,140],[-2,133],[-1,131]] },
  { pts: [[-11,142],[-13,142],[-17,146],[-20,149],[-20,140],[-16,137],[-12,136],[-11,142]] }
];
function drawMap() {
  const host = document.getElementById("chart");
  const bs = visibleBattles();
  const W = Math.max(host.clientWidth || 900, 900), H = 560, pad = 34;
  if (!bs.length) { host.innerHTML = `<p class="mil-meta" style="padding:2rem;text-align:center">篩選後沒有可顯示的戰役。</p>`; return; }
  const lons = bs.map(b => LON(b.coord[1])), lats = bs.map(b => b.coord[0]);
  const usePacific = CONF.id === "pacific_war";
  const extraLon = usePacific ? COAST.flatMap(c => c.pts.map(p => p[1])) : [];
  const extraLat = usePacific ? COAST.flatMap(c => c.pts.map(p => p[0])) : [];
  let lonMin = Math.min(...lons, ...extraLon) - 4, lonMax = Math.max(...lons, ...extraLon) + 4;
  let latMin = Math.min(...lats, ...extraLat) - 4, latMax = Math.max(...lats, ...extraLat) + 4;
  const scale = Math.min((W - 2 * pad) / (lonMax - lonMin), (H - 2 * pad) / (latMax - latMin));
  const offX = (W - scale * (lonMax - lonMin)) / 2, offY = (H - scale * (latMax - latMin)) / 2;
  const PX = lon => offX + (lon - lonMin) * scale, PY = lat => offY + (latMax - lat) * scale;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#0a1119" }));
  for (let lo = Math.ceil(lonMin / 10) * 10; lo < lonMax; lo += 10) { svg.appendChild(svgEl("line", { x1: PX(lo), y1: 0, x2: PX(lo), y2: H, class: "mil-grid" })); const t = svgEl("text", { x: PX(lo), y: H - 6, class: "mil-axis-txt", "text-anchor": "middle" }); t.textContent = (lo > 180 ? lo - 360 : lo) + "°"; svg.appendChild(t); }
  for (let la = Math.ceil(latMin / 10) * 10; la < latMax; la += 10) { svg.appendChild(svgEl("line", { x1: 0, y1: PY(la), x2: W, y2: PY(la), class: "mil-grid" })); const t = svgEl("text", { x: 6, y: PY(la) - 3, class: "mil-axis-txt" }); t.textContent = la + "°"; svg.appendChild(t); }
  if (usePacific) COAST.forEach(c => svg.appendChild(svgEl("polygon", { points: c.pts.map(p => `${PX(p[1])},${PY(p[0])}`).join(" "), fill: "#16232e", stroke: "#243642", "stroke-width": 1 })));

  const seq = [...bs].sort((a, b) => ms(a.start) - ms(b.start));
  svg.appendChild(svgEl("polyline", { points: seq.map(b => `${PX(LON(b.coord[1]))},${PY(b.coord[0])}`).join(" "), fill: "none", stroke: "var(--brass)", "stroke-width": 1.2, "stroke-dasharray": "5 5", opacity: 0.7 }));
  const maxTot = Math.max(1, ...bs.map(b => b.sides.reduce((s, x) => s + (x.deaths || 0), 0)));
  bs.forEach(b => {
    const total = b.sides.reduce((s, x) => s + (x.deaths || 0), 0);
    const r = 5 + Math.sqrt(total / maxTot) * 26, x = PX(LON(b.coord[1])), y = PY(b.coord[0]);
    const side = outcomeSide(b.outcome), col = side === "allied" ? "var(--allied)" : side === "enemy" ? "var(--japan)" : "var(--brass)";
    const g = svgEl("g", { class: "war-battle", tabindex: "0", role: "button" });
    g.appendChild(svgEl("circle", { cx: x, cy: y, r, fill: col, "fill-opacity": 0.35, stroke: col, "stroke-width": 1.4 }));
    if (b.turning_point) g.appendChild(svgEl("circle", { cx: x, cy: y, r: r + 3, fill: "none", stroke: "var(--brass)", "stroke-width": 1, "stroke-dasharray": "2 3" }));
    const flip = x > W - 130;
    const tx = svgEl("text", { x: flip ? x - r - 6 : x + r + 6, y: y + 4, class: "war-mlabel", "text-anchor": flip ? "end" : "start" }); tx.textContent = b.name_zh; g.appendChild(tx);
    g.addEventListener("click", () => showBattle(b.id));
    g.addEventListener("keydown", e => { if (e.key === "Enter") showBattle(b.id); });
    svg.appendChild(g);
  });
  const note = svgEl("text", { x: W - 8, y: 16, class: "mil-axis-txt", "text-anchor": "end" }); note.textContent = usePacific ? "示意陸塊，不具製圖精度" : "僅示意標記位置，未繪製陸塊"; svg.appendChild(note);
  host.innerHTML = ""; host.appendChild(svg);
}

// ── 戰役詳情 ─────────────────────────────────────────────
function showBattle(id) {
  const b = BYB.get(id); if (!b) return;
  const p = document.getElementById("detailPanel");
  const al = b.sides.find(s => s.key === "allied"), en = b.sides.find(s => s.key === "enemy") || b.sides.find(s => s.key === "japan");
  const wids = b.weapons || [];
  const side = outcomeSide(b.outcome);
  p.innerHTML = `
    <div class="mil-panel-head"><h2 class="mil-panel-title">${esc(b.name_zh)} <span class="mil-meta">${esc(b.name_en||"")}</span></h2>
      <span class="mil-meta">${esc(fmtDate(b.start))} – ${esc(fmtDate(b.end))} · ${esc(b.location_zh||"")} · ${esc(b.type||"")}</span></div>
    ${b.turning_point ? `<span class="mil-pill brass">戰略轉捩點</span> ` : ""}${b.featured ? `<span class="mil-pill">精選</span> ` : ""}
    <span class="mil-pill ${side==="allied"?"allied":side==="enemy"?"japan":"brass"}">${esc(b.outcome)}</span>
    <div class="war-sides">${al?sideCard(al,"allied"):""}${en?sideCard(en,"japan"):""}</div>
    ${b.civilian_deaths ? `<div class="war-civ">◇ 平民死亡（獨立標示，不計入視覺高度）：約 ${b.civilian_deaths.toLocaleString()} 人</div>` : ""}
    <p class="war-sig">${esc(b.significance||"")}</p>
    <div class="mil-panel-head" style="margin-top:1rem"><h3 class="mil-panel-title">參戰武器</h3></div>
    <div class="war-weapons">${wids.map(wid => { const w = BYW.get(wid); return w ? `<button class="war-wchip ${w.side}" data-w="${wid}">${esc(w.name_zh)} <span class="mil-meta">${esc(w.role||"")}</span></button>` : `<span class="mil-meta">${esc(wid)}（未定義）</span>`; }).join("") || '<span class="mil-meta">—</span>'}</div>
    <div id="wDetail"></div>`;
  p.querySelectorAll("[data-w]").forEach(x => x.onclick = () => showWeapon(x.dataset.w));
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function sideCard(s, key) {
  return `<div class="war-side ${key}"><div class="war-side-name">${esc(s.name_zh)}</div>
    <div class="war-stat"><span>投入兵力</span><b>${(s.committed||0).toLocaleString()}</b></div>
    <div class="war-stat"><span>陣亡</span><b class="${key}">${(s.deaths||0).toLocaleString()}</b></div>
    <div class="war-stat"><span>負傷</span><b>${(s.wounded||0).toLocaleString()}</b></div>
    ${s.materiel ? `<div class="war-mat">${esc(s.materiel)}</div>` : ""}</div>`;
}
function showWeapon(wid) {
  const w = BYW.get(wid); if (!w) return;
  const d = document.getElementById("wDetail");
  const chain = []; let cur = w; while (cur) { chain.unshift(cur); cur = cur.parent ? BYW.get(cur.parent) : null; }
  const children = (CONF.weapons || []).filter(x => x.parent === wid);
  const inBattles = CONF.battles.filter(b => (b.weapons || []).includes(wid));
  d.innerHTML = `<div class="war-wdetail ${w.side}">
    <div class="war-wd-head"><b>${esc(w.name_zh)}</b> <span class="mil-meta">${esc(w.name_en||"")} · ${esc(w.role||"")}${w.service?` · 服役 ${w.service[0]}–${w.service[1]||"至今"}`:""}</span>${w.status==="未量產"?' <span class="mil-pill">未量產</span>':""}</div>
    <div class="war-wd-specs">${Object.entries(w.specs||{}).map(([k,v])=>`<span><i>${esc(k)}</i> ${esc(v)}</span>`).join("")}</div>
    <p class="war-wd-note">${esc(w.note||"")}</p>
    <div class="war-lineage"><span class="mil-meta">型號譜系：</span>${chain.map(c=>c.id===wid?`<b class="cur">${esc(c.name_zh)}</b>`:`<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" <span class='arr'>→</span> ")}${children.length?" <span class='arr'>→</span> "+children.map(c=>`<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" / "):""}</div>
    <div class="war-appears"><span class="mil-meta">出現於：</span>${inBattles.map(bb=>`<button class="link" data-b="${bb.id}">${esc(bb.name_zh)}</button>`).join(" · ")||"—"}</div></div>`;
  d.querySelectorAll("[data-w]").forEach(x => x.onclick = () => showWeapon(x.dataset.w));
  d.querySelectorAll("[data-b]").forEach(x => x.onclick = () => showBattle(x.dataset.b));
  d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── ADD JSON（Firestore mil_conflicts）──
function wireImport() {
  const btn = root.querySelector("#warPub"), status = root.querySelector("#warPubStatus"), ta = root.querySelector("#warJson");
  if (!btn) return;
  btn.onclick = async () => {
    status.className = "mil-status"; status.textContent = "解析中…";
    try {
      const s = await getStore(); if (!s) throw new Error("Firebase SDK 無法載入");
      const data = JSON.parse(ta.value);
      const errs = validateConflict(data);
      if (errs.length) { status.className = "mil-status err"; status.innerHTML = "✗ " + errs.map(esc).join("<br>"); return; }
      await s.saveConflict(data);
      status.className = "mil-status ok"; status.textContent = "✓ 已發布，重新載入…";
      ta.value = "";
      // reload registry entry
      const i = REGISTRY.findIndex(r => r.id === data.id);
      const entry = { id: data.id, name_zh: data.name_zh, name_en: data.name_en, start: data.start, end: data.end, region_zh: data.region_zh, data };
      if (i >= 0) REGISTRY[i] = entry; else REGISTRY.push(entry);
      REGISTRY.sort((a, b) => String(a.start).localeCompare(String(b.start)));
      await selectConflict(data.id);
    } catch (e) {
      status.className = "mil-status err";
      status.innerHTML = /insufficient permissions|permission-denied/i.test(e.message||"") ? "✗ 權限不足：需白名單帳號且已部署 mil_conflicts 規則（<code>firebase deploy --only firestore:rules</code>）" : "✗ " + esc(e.message);
    }
  };
}
function validateConflict(d) {
  const e = [];
  if (!d || typeof d !== "object") return ["JSON 需為物件"];
  if (!d.id) e.push("缺 id");
  if (!d.name_zh) e.push("缺 name_zh");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start || "")) e.push("start 需為 YYYY-MM-DD");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.end || "")) e.push("end 需為 YYYY-MM-DD");
  if (!Array.isArray(d.battles) || !d.battles.length) e.push("battles 需為非空陣列");
  const wids = new Set((d.weapons || []).map(w => w.id));
  (d.battles || []).forEach((b, i) => {
    if (!b.id) e.push(`battles[${i}] 缺 id`);
    if (!Array.isArray(b.sides) || b.sides.length < 1) e.push(`battles[${i}] 缺 sides`);
    if (!Array.isArray(b.coord) || b.coord.length !== 2) e.push(`battles[${i}] coord 需 [lat,lon]`);
    (b.weapons || []).forEach(wid => { if (!wids.has(wid)) e.push(`battles[${i}] 武器 '${wid}' 不在 weapons[]`); });
  });
  return e;
}
