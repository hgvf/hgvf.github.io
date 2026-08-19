// war.js — ① 戰役消耗帳：時序視圖 + 海圖視圖（雙視圖），戰役↔武器 join。
import { loadJSON, showErr, esc, fmtDate, svgEl, NS } from "../js/milcore.js";

let WAR, WPN, BW, BYW = new Map(), BYB = new Map();
let view = "timeline";
const root = document.getElementById("app");
const DAY = 86400000;
const ms = d => new Date(d + "T00:00:00").getTime();
const isAllied = o => /盟軍|美軍|美國/.test(o);

(async function () {
  try {
    [WAR, WPN, BW] = await Promise.all([
      loadJSON("../data/pacific-war.json"), loadJSON("../data/weapons.json"), loadJSON("../data/battle-weapons.json"),
    ]);
    BYW = new Map(WPN.weapons.map(w => [w.id, w]));
    BYB = new Map(WAR.battles.map(b => [b.id, b]));
    render();
  } catch (e) { showErr(root, e.message); }
})();

function render() {
  const maxD = Math.max(...WAR.battles.flatMap(b => b.sides.map(s => s.deaths)));
  root.innerHTML = `
    <div class="war-toolbar">
      <div class="mil-toggle">
        <button class="mil-btn ${view==='timeline'?'mil-btn-primary':''}" data-v="timeline">時序視圖</button>
        <button class="mil-btn ${view==='map'?'mil-btn-primary':''}" data-v="map">海圖視圖</button>
      </div>
      <div class="war-legend">
        <span><i class="sw allied"></i>盟軍/我方陣亡</span>
        <span><i class="sw japan"></i>日軍陣亡</span>
        <span><i class="sw brass"></i>轉捩點</span>
        <span class="mil-meta">高度 = √陣亡數（平方根尺度）</span>
      </div>
    </div>
    <section class="mil-panel"><div id="chart"></div></section>
    <section class="mil-panel" id="detailPanel">
      <p class="mil-meta">點選任一戰役 → 展開雙方消耗、戰略意義與參戰武器。點武器可看型號譜系與其他參戰戰役。</p>
    </section>`;
  root.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { view = b.dataset.v; render(); });
  if (view === "timeline") drawTimeline(maxD); else drawMap();
}

// ── 時序視圖 ────────────────────────────────────────────────
function drawTimeline(maxD) {
  const host = document.getElementById("chart");
  const W = Math.max(host.clientWidth || 900, 900), H = 560;
  const padL = 40, padR = 40, padT = 60, padB = 40;
  const midY = H / 2;
  const t0 = ms(WAR.conflict.start), t1 = ms(WAR.conflict.end);
  const X = t => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const hScale = (midY - padT) / Math.sqrt(maxD);   // √尺度
  const barH = d => Math.sqrt(d) * hScale;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });

  // 階段背景色帶
  WAR.phases.forEach((p, i) => {
    const x1 = X(ms(p.start)), x2 = X(ms(p.end));
    svg.appendChild(svgEl("rect", { x: x1, y: padT, width: Math.max(0, x2 - x1), height: H - padT - padB, fill: i % 2 ? "#111922" : "#0e151d", opacity: 0.6 }));
    const lb = svgEl("text", { x: (x1 + x2) / 2, y: padT - 40, "text-anchor": "middle", class: "war-phase" });
    lb.textContent = p.name_zh; svg.appendChild(lb);
  });
  // mirror axis
  svg.appendChild(svgEl("line", { x1: padL, y1: midY, x2: W - padR, y2: midY, stroke: "var(--brass)", "stroke-width": 1.2, opacity: 0.6 }));
  ["盟軍 ▲", "▼ 日軍"].forEach((t, i) => {
    const el = svgEl("text", { x: padL - 4, y: i ? midY + 16 : midY - 8, class: "war-axis-lbl", "text-anchor": "start", fill: i ? "var(--japan)" : "var(--allied)" });
    el.textContent = t; svg.appendChild(el);
  });

  // 年份刻度
  for (let y = 1942; y <= 1945; y++) {
    const tx = X(ms(`${y}-01-01`));
    svg.appendChild(svgEl("line", { x1: tx, y1: padT, x2: tx, y2: H - padB, class: "mil-grid" }));
    const t = svgEl("text", { x: tx, y: H - padB + 20, "text-anchor": "middle", class: "mil-axis-txt" }); t.textContent = y; svg.appendChild(t);
  }

  // 標籤去碰撞：紀錄已放置的 x，若太近則往上疊
  const placed = [];
  const sorted = [...WAR.battles].sort((a, b) => ms(a.start) - ms(b.start));

  sorted.forEach(b => {
    const x1 = X(ms(b.start)), x2 = X(ms(b.end));
    const w = Math.max(3, x2 - x1);
    const cx = (x1 + x2) / 2;
    const allied = b.sides.find(s => s.key === "allied"), japan = b.sides.find(s => s.key === "japan");

    // 轉捩點虛線
    if (b.turning_point) svg.appendChild(svgEl("line", { x1: cx, y1: padT - 6, x2: cx, y2: H - padB, stroke: "var(--brass)", "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.7 }));

    // 上方藍（盟軍）、下方紅（日軍）
    const g = svgEl("g", { class: "war-battle", tabindex: "0", role: "button" });
    g.appendChild(svgEl("rect", { x: x1, y: midY - barH(allied.deaths), width: w, height: barH(allied.deaths), fill: "var(--allied)", opacity: 0.85, rx: 1 }));
    g.appendChild(svgEl("rect", { x: x1, y: midY, width: w, height: barH(japan.deaths), fill: "var(--japan)", opacity: 0.85, rx: 1 }));
    g.addEventListener("click", () => showBattle(b.id));
    g.addEventListener("keydown", e => { if (e.key === "Enter") showBattle(b.id); });
    svg.appendChild(g);

    // 標籤去碰撞
    let ly = padT - 4;
    while (placed.some(p => Math.abs(p.x - cx) < 62 && Math.abs(p.y - ly) < 14)) ly -= 15;
    placed.push({ x: cx, y: ly });
    if (ly < padT - 4) svg.appendChild(svgEl("line", { x1: cx, y1: ly + 4, x2: cx, y2: midY - barH(allied.deaths), stroke: "var(--rule)", "stroke-width": 0.8, opacity: 0.7 }));
    const lbl = svgEl("text", { x: cx, y: ly, "text-anchor": "middle", class: "war-blabel" });
    lbl.textContent = b.name_zh; lbl.style.cursor = "pointer";
    lbl.addEventListener("click", () => showBattle(b.id));
    svg.appendChild(lbl);
  });

  host.innerHTML = ""; host.appendChild(svg);
}

// ── 海圖視圖（等距圓柱投影，經度正規化 0–360）──────────────
const LON = l => (l < 0 ? l + 360 : l);
// 極簡示意陸塊（[lat,lon]，lon 已正規化 0–360），僅供定位，不具製圖精度
const COAST = [
  { n: "日本", pts: [[45,142],[41,140],[35,140],[34,136],[33,131],[31,131],[34,133],[36,138],[38,140],[41,141],[45,142]] },
  { n: "亞洲大陸", pts: [[41,126],[39,122],[35,120],[31,122],[24,118],[22,114],[21,110],[24,110],[30,112],[35,119],[41,123],[41,126]] },
  { n: "菲律賓", pts: [[18,120],[16,122],[12,124],[9,126],[6,125],[8,123],[11,122],[14,120],[18,120]] },
  { n: "新幾內亞", pts: [[-1,131],[-3,138],[-6,144],[-9,148],[-10,150],[-8,146],[-5,140],[-2,133],[-1,131]] },
  { n: "澳洲北", pts: [[-11,142],[-13,142],[-17,146],[-20,149],[-20,140],[-16,137],[-12,136],[-11,142]] }
];
function drawMap() {
  const host = document.getElementById("chart");
  const W = Math.max(host.clientWidth || 900, 900), H = 560, pad = 30;
  const lons = WAR.battles.map(b => LON(b.coord[1])), lats = WAR.battles.map(b => b.coord[0]);
  const allLon = lons.concat(COAST.flatMap(c => c.pts.map(p => p[1])));
  const allLat = lats.concat(COAST.flatMap(c => c.pts.map(p => p[0])));
  let lonMin = Math.min(...allLon) - 2, lonMax = Math.max(...allLon) + 2;
  let latMin = Math.min(...allLat) - 2, latMax = Math.max(...allLat) + 2;
  // 等比例投影（x/y 每度像素相等，無變形）
  const scale = Math.min((W - 2 * pad) / (lonMax - lonMin), (H - 2 * pad) / (latMax - latMin));
  const offX = (W - scale * (lonMax - lonMin)) / 2, offY = (H - scale * (latMax - latMin)) / 2;
  const PX = lon => offX + (lon - lonMin) * scale;
  const PY = lat => offY + (latMax - lat) * scale;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#0a1119" }));
  // 經緯格線
  for (let lo = Math.ceil(lonMin / 10) * 10; lo < lonMax; lo += 10) {
    svg.appendChild(svgEl("line", { x1: PX(lo), y1: 0, x2: PX(lo), y2: H, class: "mil-grid" }));
    const t = svgEl("text", { x: PX(lo), y: H - 6, class: "mil-axis-txt", "text-anchor": "middle" }); t.textContent = (lo > 180 ? lo - 360 + "°" : lo + "°"); svg.appendChild(t);
  }
  for (let la = Math.ceil(latMin / 10) * 10; la < latMax; la += 10) {
    svg.appendChild(svgEl("line", { x1: 0, y1: PY(la), x2: W, y2: PY(la), class: "mil-grid" }));
    const t = svgEl("text", { x: 6, y: PY(la) - 3, class: "mil-axis-txt" }); t.textContent = la + "°"; svg.appendChild(t);
  }
  // 陸塊
  COAST.forEach(c => svg.appendChild(svgEl("polygon", { points: c.pts.map(p => `${PX(p[1])},${PY(p[0])}`).join(" "), fill: "#16232e", stroke: "#243642", "stroke-width": 1 })));

  // 推進軸線（時間序虛線）
  const seq = [...WAR.battles].sort((a, b) => ms(a.start) - ms(b.start));
  svg.appendChild(svgEl("polyline", { points: seq.map(b => `${PX(LON(b.coord[1]))},${PY(b.coord[0])}`).join(" "), fill: "none", stroke: "var(--brass)", "stroke-width": 1.2, "stroke-dasharray": "5 5", opacity: 0.7 }));

  const maxTot = Math.max(...WAR.battles.map(b => b.sides.reduce((s, x) => s + x.deaths, 0)));
  WAR.battles.forEach(b => {
    const total = b.sides.reduce((s, x) => s + x.deaths, 0);
    const r = 5 + Math.sqrt(total / maxTot) * 26;   // 面積 ∝ 總陣亡
    const x = PX(LON(b.coord[1])), y = PY(b.coord[0]);
    const col = isAllied(b.outcome) ? "var(--allied)" : "var(--japan)";
    const g = svgEl("g", { class: "war-battle", tabindex: "0", role: "button" });
    g.appendChild(svgEl("circle", { cx: x, cy: y, r, fill: col, "fill-opacity": 0.35, stroke: col, "stroke-width": 1.4 }));
    if (b.turning_point) g.appendChild(svgEl("circle", { cx: x, cy: y, r: r + 3, fill: "none", stroke: "var(--brass)", "stroke-width": 1, "stroke-dasharray": "2 3" }));
    // 標籤：靠右緣則翻左
    const flip = x > W - 120;
    const tx = svgEl("text", { x: flip ? x - r - 6 : x + r + 6, y: y + 4, class: "war-mlabel", "text-anchor": flip ? "end" : "start" });
    tx.textContent = b.name_zh; g.appendChild(tx);
    g.addEventListener("click", () => showBattle(b.id));
    g.addEventListener("keydown", e => { if (e.key === "Enter") showBattle(b.id); });
    svg.appendChild(g);
  });
  const note = svgEl("text", { x: W - 8, y: 16, class: "mil-axis-txt", "text-anchor": "end" }); note.textContent = "示意陸塊，不具製圖精度"; svg.appendChild(note);
  host.innerHTML = ""; host.appendChild(svg);
}

// ── 戰役詳情 ────────────────────────────────────────────────
function showBattle(id) {
  const b = BYB.get(id);
  const p = document.getElementById("detailPanel");
  const allied = b.sides.find(s => s.key === "allied"), japan = b.sides.find(s => s.key === "japan");
  const wids = (BW.battle_weapons[id] || []);
  p.innerHTML = `
    <div class="mil-panel-head">
      <h2 class="mil-panel-title">${esc(b.name_zh)} <span class="mil-meta">${esc(b.name_en)}</span></h2>
      <span class="mil-meta">${esc(fmtDate(b.start))} – ${esc(fmtDate(b.end))} · ${esc(b.location_zh)} · ${esc(b.type)}</span>
    </div>
    ${b.turning_point ? `<span class="mil-pill brass">戰略轉捩點</span>` : ""}
    <span class="mil-pill ${isAllied(b.outcome) ? "allied" : "japan"}">${esc(b.outcome)}</span>
    <div class="war-sides">
      ${sideCard(allied, "allied")}${sideCard(japan, "japan")}
    </div>
    ${b.civilian_deaths ? `<div class="war-civ">◇ 平民死亡（獨立標示，不計入視覺高度）：約 ${b.civilian_deaths.toLocaleString()} 人</div>` : ""}
    <p class="war-sig">${esc(b.significance)}</p>
    <div class="mil-panel-head" style="margin-top:1rem"><h3 class="mil-panel-title">參戰武器</h3></div>
    <div class="war-weapons">${wids.map(wid => { const w = BYW.get(wid); return `<button class="war-wchip ${w.side}" data-w="${wid}">${esc(w.name_zh)} <span class="mil-meta">${esc(w.role)}</span></button>`; }).join("")}</div>
    <div id="wDetail"></div>`;
  p.querySelectorAll("[data-w]").forEach(b2 => b2.onclick = () => showWeapon(b2.dataset.w));
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function sideCard(s, key) {
  return `<div class="war-side ${key}">
    <div class="war-side-name">${esc(s.name_zh)}</div>
    <div class="war-stat"><span>投入兵力</span><b>${(s.committed||0).toLocaleString()}</b></div>
    <div class="war-stat"><span>陣亡</span><b class="${key}">${(s.deaths||0).toLocaleString()}</b></div>
    <div class="war-stat"><span>負傷</span><b>${(s.wounded||0).toLocaleString()}</b></div>
    ${s.materiel ? `<div class="war-mat">${esc(s.materiel)}</div>` : ""}
  </div>`;
}

// ── 武器詳情（含譜系鏈 + 出現戰役）──────────────────────────
function showWeapon(wid) {
  const w = BYW.get(wid);
  const d = document.getElementById("wDetail");
  // 譜系鏈
  const chain = []; let cur = w;
  while (cur) { chain.unshift(cur); cur = cur.parent ? BYW.get(cur.parent) : null; }
  const children = WPN.weapons.filter(x => x.parent === wid);
  const inBattles = Object.entries(BW.battle_weapons).filter(([, v]) => v.includes(wid)).map(([k]) => BYB.get(k));
  d.innerHTML = `<div class="war-wdetail ${w.side}">
    <div class="war-wd-head"><b>${esc(w.name_zh)}</b> <span class="mil-meta">${esc(w.name_en)} · ${esc(w.role)} · 服役 ${w.service[0]}–${w.service[1] || "至戰後"}</span>
      ${w.status === "未量產" ? `<span class="mil-pill">未量產</span>` : ""}</div>
    <div class="war-wd-specs">${Object.entries(w.specs || {}).map(([k, v]) => `<span><i>${esc(k)}</i> ${esc(v)}</span>`).join("")}</div>
    <p class="war-wd-note">${esc(w.note || "")}</p>
    <div class="war-lineage"><span class="mil-meta">型號譜系：</span>
      ${chain.map(c => c.id === wid ? `<b class="cur">${esc(c.name_zh)}</b>` : `<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" <span class='arr'>→</span> ")}
      ${children.length ? " <span class='arr'>→</span> " + children.map(c => `<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" / ") : ""}
    </div>
    <div class="war-appears"><span class="mil-meta">出現於：</span>${inBattles.map(bb => `<button class="link" data-b="${bb.id}">${esc(bb.name_zh)}</button>`).join(" · ")}</div>
  </div>`;
  d.querySelectorAll("[data-w]").forEach(x => x.onclick = () => showWeapon(x.dataset.w));
  d.querySelectorAll("[data-b]").forEach(x => x.onclick = () => showBattle(x.dataset.b));
  d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
