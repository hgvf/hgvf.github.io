// doctrine.js — ⑤ 文件敘事漂移。威脅排序流動圖（缺席則斷線，不內插）、
// 措辭升降（新舊原文並列）、章節增刪。示意資料。
import { loadJSON, showErr, esc, svgEl } from "../js/milcore.js";

let D;
const root = document.getElementById("app");
const SEV = { up: { c: "var(--japan)", z: "重要性上升" }, down: { c: "var(--allied)", z: "重要性下降" }, new: { c: "var(--brass)", z: "全新" } };

(async function () {
  try { D = await loadJSON("../data/doctrine.json"); render(); }
  catch (e) { showErr(root, e.message); }
})();

function render() {
  root.innerHTML = `
    <div class="mil-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span>本頁為<b>示意資料</b>，非真實國防文件引文；僅示範「同議題跨版本排序 / 措辭 / 章節」的呈現格式。措辭區塊一律同時顯示新舊原文供讀者覆核。</span></div>
    <section class="mil-panel"><div class="mil-panel-head"><h2 class="mil-panel-title">威脅排序流動</h2><span class="mil-panel-note">上行 = 重要性提高；缺席版本斷線</span></div><div id="flow"></div></section>
    <section class="mil-panel"><div class="mil-panel-head"><h2 class="mil-panel-title">措辭升降</h2></div><div class="doc-shifts">${D.wording_shifts.map(shiftHTML).join("")}</div></section>
    <section class="mil-panel"><div class="mil-panel-head"><h2 class="mil-panel-title">章節增刪</h2></div><div class="doc-secs">${secHTML()}</div></section>`;
  drawFlow();
}

function drawFlow() {
  const host = root.querySelector("#flow");
  const eds = D.editions;
  const topics = [...new Set(Object.values(D.threat_ranking).flat())];
  const maxRank = Math.max(...Object.values(D.threat_ranking).map(a => a.length));
  const W = Math.max(host.clientWidth || 900, 700), H = 60 + maxRank * 46, padL = 20, padR = 160, padT = 40;
  const colX = i => padL + (i / (eds.length - 1)) * (W - padL - padR);
  const rowY = r => padT + r * 46;
  const palette = ["#6FA8C7", "#C1553F", "#C9A227", "#8E7CA8", "#6FAE8A", "#C3BCAB", "#7FA0B5", "#B58A5A"];
  const color = {}; topics.forEach((t, i) => color[t] = palette[i % palette.length]);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });
  eds.forEach((e, i) => { const t = svgEl("text", { x: colX(i), y: 24, class: "doc-ed", "text-anchor": "middle" }); t.textContent = e; svg.appendChild(t); svg.appendChild(svgEl("line", { x1: colX(i), y1: padT - 8, x2: colX(i), y2: H - 10, class: "mil-grid" })); });

  topics.forEach(topic => {
    const pts = eds.map((e, i) => { const r = (D.threat_ranking[e] || []).indexOf(topic); return r < 0 ? null : { x: colX(i), y: rowY(r), i }; });
    // 斷線：只連相鄰皆存在者
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i] && pts[i + 1]) svg.appendChild(svgEl("line", { x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y, stroke: color[topic], "stroke-width": 2, opacity: 0.8 }));
    }
    pts.forEach((p, i) => { if (!p) return; svg.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 4, fill: color[topic] })); if (i === pts.length - 1) { const t = svgEl("text", { x: p.x + 10, y: p.y + 4, class: "doc-topic", fill: color[topic] }); t.textContent = topic; svg.appendChild(t); } });
  });
  host.innerHTML = ""; host.appendChild(svg);
}

function shiftHTML(s) {
  const sev = SEV[s.severity] || SEV.new;
  return `<div class="doc-shift"><span class="doc-sev" style="background:${sev.c}"></span>
    <div class="doc-shift-body">
      <div class="doc-shift-head"><b>${esc(s.topic)}</b> <span class="mil-meta">${esc(s.from_edition)} → ${esc(s.to_edition)}</span> <span class="mil-pill" style="color:${sev.c};border-color:${sev.c}">${sev.z}</span></div>
      <div class="doc-quotes"><div class="doc-q from"><span>舊 ${esc(s.from_edition)}</span>${esc(s.from)}</div><div class="doc-q to"><span>新 ${esc(s.to_edition)}</span>${esc(s.to)}</div></div>
      <div class="doc-delta">Δ ${esc(s.delta)}</div>
    </div></div>`;
}
function secHTML() {
  const byEd = {};
  D.section_changes.forEach(c => { (byEd[c.edition] ||= []).push(c); });
  return Object.entries(byEd).map(([ed, cs]) => `<div class="doc-sec-ed"><div class="doc-sec-year">${esc(ed)}</div>
    ${cs.map(c => `<div class="doc-sec-row ${c.type}">${c.type === "added" ? "＋" : "－"} ${esc(c.section)}</div>`).join("")}</div>`).join("");
}
