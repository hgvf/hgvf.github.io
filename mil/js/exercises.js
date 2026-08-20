// exercises.js — ⑥ 演習行事曆。年度甘特圖（Y=各演習，X=月份），
// 底部月度密度條。作為③台海基線的季節性先驗。示意排程。
import { loadJSON, showErr, esc, svgEl } from "../js/milcore.js";

let D;
const root = document.getElementById("app");
const KIND = { multi: { c: "var(--allied)", z: "多國聯合" }, single: { c: "var(--brass)", z: "單國常態" }, recurring: { c: "var(--japan)", z: "不定期環台" } };

(async function () {
  try { D = await loadJSON("../data/exercises.json"); render(); }
  catch (e) { showErr(root, e.message); }
})();

function render() {
  root.innerHTML = `
    <div class="mil-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span>本頁為<b>示意排程</b>，窗口為概略月份。五視圖中資料源最弱者；主要價值是作為台海基線（④）的季節性先驗。</span></div>
    <div class="ex-legend mil-meta">${Object.values(KIND).map(k => `<span><i class="sw" style="background:${k.c}"></i>${k.z}</span>`).join("")} <span>虛線框 = 雙年舉行</span></div>
    <section class="mil-panel"><div id="gantt"></div></section>`;
  drawGantt();
}

function drawGantt() {
  const host = root.querySelector("#gantt");
  const ex = D.exercises;
  const W = Math.max(host.clientWidth || 900, 760), rowH = 34, padL = 140, padR = 20, padT = 34, padB = 70;
  const H = padT + ex.length * rowH + padB;
  const monX = m => padL + ((m - 1) / 12) * (W - padL - padR);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });
  const months = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  months.forEach((m, i) => { const x = monX(i + 1); svg.appendChild(svgEl("line", { x1: x, y1: padT, x2: x, y2: H - padB, class: "mil-grid" })); const t = svgEl("text", { x: monX(i + 1.5), y: padT - 12, class: "mil-axis-txt", "text-anchor": "middle" }); t.textContent = months[i]; svg.appendChild(t); });

  const density = new Array(12).fill(0);
  ex.forEach((e, i) => {
    const y = padT + i * rowH;
    const kind = KIND[e.kind] || KIND.single;
    const t = svgEl("text", { x: padL - 8, y: y + rowH / 2 + 4, class: "ex-name", "text-anchor": "end" }); t.textContent = e.name_zh; svg.appendChild(t);
    const x1 = monX(e.start), x2 = monX(e.end + 1);
    const rect = svgEl("rect", { x: x1, y: y + 6, width: Math.max(6, x2 - x1), height: rowH - 14, rx: 3, fill: kind.c, "fill-opacity": e.biennial ? 0.15 : 0.55, stroke: kind.c, "stroke-width": e.biennial ? 1.4 : 0, "stroke-dasharray": e.biennial ? "4 3" : "" });
    const g = svgEl("g", { class: "war-battle" }); g.appendChild(rect);
    const tt = svgEl("title"); tt.textContent = `${e.name_zh} (${e.name_en}) — ${e.note}`; g.appendChild(tt);
    svg.appendChild(g);
    for (let m = e.start; m <= e.end; m++) density[m - 1]++;
  });
  // 密度條
  const maxD = Math.max(...density, 1);
  const dy = H - padB + 22;
  const t = svgEl("text", { x: padL - 8, y: dy + 10, class: "ex-name", "text-anchor": "end" }); t.textContent = "月度重疊密度"; svg.appendChild(t);
  density.forEach((d, i) => { const x = monX(i + 1) + 3, w = (W - padL - padR) / 12 - 6, h = (d / maxD) * 26; svg.appendChild(svgEl("rect", { x, y: dy + 26 - h, width: w, height: h, fill: "var(--brass)", "fill-opacity": 0.6 })); const n = svgEl("text", { x: x + w / 2, y: dy + 40, class: "mil-axis-txt", "text-anchor": "middle" }); n.textContent = d || ""; svg.appendChild(n); });
  host.innerHTML = ""; host.appendChild(svg);
}
