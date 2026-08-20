// strait.js — ④ 台海活動基線。滾動中位數 ± k·MAD 穩健基線（非平均±標準差，
// 以免演習期極端值汙染基線）。兩個滑桿即時重算：基線視窗、異常門檻 k。
import { loadJSON, showErr, esc, svgEl, fmtDate } from "../js/milcore.js";

let DATA, win = 28, k = 3.0;
const root = document.getElementById("app");
const ms = d => new Date(d + "T00:00:00").getTime();

let isSynthetic = false;
(async function () {
  try {
    // 優先讀 scrape_mnd.py 產出的真實資料；未有則以合成示意資料佔位。
    try { DATA = await loadJSON("../data/strait.json"); isSynthetic = (DATA.source === "synthetic"); }
    catch { DATA = await loadJSON("../data/strait-sample.json"); isSynthetic = true; }
    render();
  } catch (e) { showErr(root, e.message); }
})();

// 中位數 / MAD
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function baseline(series, i, win) {
  const from = Math.max(0, i - win + 1);
  const w = series.slice(from, i + 1).map(d => d.aircraft);
  const med = median(w);
  const mad = median(w.map(v => Math.abs(v - med))) * 1.4826 || 1;
  return { med, mad };
}

function render() {
  const daily = DATA.daily;
  root.innerHTML = `
    ${isSynthetic ? `<div class="mil-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span>本頁為<b>合成示意資料</b>，非國防部真實數字。真實版由 <code>scrape_mnd.py</code> 解析官方即時軍事動態公告後每日產生（GitHub Actions 排程）。</span></div>` : ""}
    <div class="str-controls">
      <label>基線視窗 <b id="winV">${win}</b> 日 <input type="range" id="winR" min="14" max="120" value="${win}"></label>
      <label>異常門檻 k = <b id="kV">${k.toFixed(1)}</b> ·MAD <input type="range" id="kR" min="1.5" max="4.5" step="0.1" value="${k}"></label>
      <span class="mil-meta">滑桿拉動即時重算基線帶與異常點</span>
    </div>
    <div class="mil-stats" id="stats"></div>
    <section class="mil-panel"><div class="mil-panel-head"><h2 class="mil-panel-title">共機架次日別時序 + 基線帶</h2></div><div id="main"></div></section>
    <section class="mil-panel"><div class="mil-panel-head"><h2 class="mil-panel-title">組成變化（28 日滾動平均）</h2><span class="mil-panel-note">逾越中線占比 · 公務船占比</span></div><div id="comp"></div></section>`;
  const wr = root.querySelector("#winR"), kr = root.querySelector("#kR");
  wr.oninput = () => { win = +wr.value; root.querySelector("#winV").textContent = win; draw(); };
  kr.oninput = () => { k = +kr.value; root.querySelector("#kV").textContent = k.toFixed(1); draw(); };
  draw();
  drawComp(daily);
}

function draw() {
  const daily = DATA.daily;
  const host = root.querySelector("#main");
  const W = Math.max(host.clientWidth || 900, 900), H = 340, padL = 40, padR = 16, padT = 20, padB = 40;
  const maxV = Math.max(...daily.map(d => d.aircraft)) * 1.1;
  const t0 = ms(daily[0].date), t1 = ms(daily[daily.length - 1].date);
  const X = t => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const Y = v => H - padB - (v / maxV) * (H - padT - padB);

  const rows = daily.map((d, i) => { const { med, mad } = baseline(daily, i, win); const z = (d.aircraft - med) / mad; return { ...d, med, mad, z, hi: d.aircraft > med + k * mad, lo: d.aircraft < med - k * mad }; });

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });
  // y grid
  for (let g = 0; g <= maxV; g += 20) { svg.appendChild(svgEl("line", { x1: padL, y1: Y(g), x2: W - padR, y2: Y(g), class: "mil-grid" })); const t = svgEl("text", { x: 4, y: Y(g) + 3, class: "mil-axis-txt" }); t.textContent = g; svg.appendChild(t); }
  // baseline band
  const up = rows.map(r => `${X(ms(r.date))},${Y(r.med + k * r.mad)}`).join(" ");
  const dn = rows.map(r => `${X(ms(r.date))},${Y(Math.max(0, r.med - k * r.mad))}`).reverse().join(" ");
  svg.appendChild(svgEl("polygon", { points: up + " " + dn, fill: "var(--allied)", "fill-opacity": 0.1 }));
  svg.appendChild(svgEl("polyline", { points: rows.map(r => `${X(ms(r.date))},${Y(r.med)}`).join(" "), fill: "none", stroke: "var(--brass)", "stroke-width": 1, "stroke-dasharray": "4 3", opacity: 0.8 }));
  // events layer
  (DATA.events || []).forEach(ev => { const x = X(ms(ev.date)); if (x < padL || x > W - padR) return; svg.appendChild(svgEl("line", { x1: x, y1: padT, x2: x, y2: H - padB, stroke: "var(--civil)", "stroke-width": 1, "stroke-dasharray": "2 3", opacity: 0.8 })); const t = svgEl("text", { x: x + 3, y: padT + 10, class: "str-event" }); t.textContent = ev.label; svg.appendChild(t); });
  // main line
  svg.appendChild(svgEl("polyline", { points: rows.map(r => `${X(ms(r.date))},${Y(r.aircraft)}`).join(" "), fill: "none", stroke: "var(--paper)", "stroke-width": 1.4 }));
  // anomaly points
  const tip = document.createElement("div"); tip.className = "mil-tip"; host.style.position = "relative";
  rows.forEach(r => { if (!r.hi && !r.lo) return; const cx = X(ms(r.date)), cy = Y(r.aircraft); const c = svgEl("circle", { cx, cy, r: 3.5, fill: r.hi ? "var(--japan)" : "var(--allied)", stroke: "#0a1119", "stroke-width": 1, class: "str-anom" });
    c.addEventListener("mouseenter", () => { tip.style.display = "block"; tip.innerHTML = `<span class="d">${fmtDate(r.date)}</span>架次 ${r.aircraft}（基線 ${r.med.toFixed(0)}）<br>z = ${r.z.toFixed(1)} ${r.hi ? "偏高" : "偏低"}${r.suspect ? "<br>⚠ suspect" : ""}`; tip.style.left = Math.min(cx, W - 160) + "px"; tip.style.top = (cy - 60) + "px"; });
    c.addEventListener("mouseleave", () => tip.style.display = "none");
    svg.appendChild(c); });

  host.innerHTML = ""; host.appendChild(svg); host.appendChild(tip);

  // stats
  const last = rows[rows.length - 1];
  const hi = rows.filter(r => r.hi).length, lo = rows.filter(r => r.lo).length;
  root.querySelector("#stats").innerHTML = `
    <div class="mil-stat"><div class="label">最新一日</div><div class="value">${last.aircraft}</div><div class="sub">${fmtDate(last.date)} · 架次</div></div>
    <div class="mil-stat"><div class="label">相對基線</div><div class="value ${last.z>0?'japan':'allied'}">${last.z>=0?"+":""}${last.z.toFixed(1)}σ</div><div class="sub">基線 ${last.med.toFixed(0)}</div></div>
    <div class="mil-stat"><div class="label">偏高異常日</div><div class="value japan">${hi}</div></div>
    <div class="mil-stat"><div class="label">偏低異常日</div><div class="value allied">${lo}</div></div>`;
}

function rollAvg(arr, w) { return arr.map((_, i) => { const from = Math.max(0, i - w + 1); const s = arr.slice(from, i + 1); return s.reduce((a, b) => a + b, 0) / s.length; }); }
function drawComp(daily) {
  const host = root.querySelector("#comp");
  const W = Math.max(host.clientWidth || 900, 900), H = 200, padL = 40, padR = 16, padT = 14, padB = 30;
  const cross = rollAvg(daily.map(d => d.aircraft ? d.crossings / d.aircraft : 0), 28);
  const gov = rollAvg(daily.map(d => d.ships ? d.gov_ships / d.ships : 0), 28);
  const t0 = ms(daily[0].date), t1 = ms(daily[daily.length - 1].date);
  const X = i => padL + (i / (daily.length - 1)) * (W - padL - padR);
  const Y = v => H - padB - v * (H - padT - padB);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "mil-svg", width: W, height: H });
  [0, 0.25, 0.5, 0.75, 1].forEach(g => { svg.appendChild(svgEl("line", { x1: padL, y1: Y(g), x2: W - padR, y2: Y(g), class: "mil-grid" })); const t = svgEl("text", { x: 4, y: Y(g) + 3, class: "mil-axis-txt" }); t.textContent = (g * 100) + "%"; svg.appendChild(t); });
  svg.appendChild(svgEl("polyline", { points: cross.map((v, i) => `${X(i)},${Y(v)}`).join(" "), fill: "none", stroke: "var(--japan)", "stroke-width": 1.5 }));
  svg.appendChild(svgEl("polyline", { points: gov.map((v, i) => `${X(i)},${Y(v)}`).join(" "), fill: "none", stroke: "var(--civil)", "stroke-width": 1.5 }));
  const lg = svgEl("text", { x: W - padR, y: padT + 6, class: "mil-axis-txt", "text-anchor": "end" }); lg.innerHTML = "";
  host.innerHTML = ""; host.appendChild(svg);
  host.insertAdjacentHTML("beforeend", `<div class="str-comp-legend"><span><i class="sw" style="background:var(--japan)"></i>逾越中線占比</span><span><i class="sw" style="background:var(--civil)"></i>公務船占比</span></div>`);
}
