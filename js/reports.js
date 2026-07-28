// reports.js — shared data + timeline rendering for the report pages
// (supply-chain news, earnings calls). Read-only, public Firestore access.

import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _db = null;
function db() {
  if (!_db) _db = getFirestore(initializeApp(firebaseConfig));
  return _db;
}

export async function loadDocs(name, orderField = "date", dir = "desc") {
  try {
    const snap = await getDocs(query(collection(db(), name), orderBy(orderField, dir)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Fallback if the field/index isn't there yet — sort client-side.
    const snap = await getDocs(collection(db(), name));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => String(b[orderField] || "").localeCompare(String(a[orderField] || "")));
    return rows;
  }
}

// ─── Sentiment ─────────────────────────────────────────────────────────
export const SENT = {
  bullish: { label: "偏多 Bullish", cls: "pos", color: "var(--positive)", bg: "var(--positive-bg)" },
  bearish: { label: "偏空 Bearish", cls: "neg", color: "var(--negative)", bg: "var(--negative-bg)" },
  neutral: { label: "中性 Neutral", cls: "neu", color: "var(--neutral)", bg: "var(--neutral-bg)" },
};
export function sent(v) { return SENT[v] || SENT.neutral; }

export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length <= 10 ? "T00:00:00" : ""));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

// ─── Timeline chart (SVG) ──────────────────────────────────────────────
// items: [{ id, date, sentiment }]  (sorted newest-first is fine)
// opts.priceSeries: optional [{date, close}] to draw a price line.
// opts.onSelect(id): called when a node is clicked.
const NS = "http://www.w3.org/2000/svg";
const DAY = 86400000;

function el(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
function ms(iso) { return new Date(iso + (String(iso).length <= 10 ? "T00:00:00" : "")).getTime(); }

export function renderTimeline(host, items, opts = {}) {
  const data = items.filter(i => i.date).map(i => ({ ...i, t: ms(i.date) })).sort((a, b) => a.t - b.t);
  host.innerHTML = "";
  if (!data.length) return { select() {} };

  const H = 240, padT = 26, padB = 46, padL = 20, padR = 20;
  let min = data[0].t, max = data[data.length - 1].t;
  if (min === max) { min -= 15 * DAY; max += 15 * DAY; }
  else { const p = (max - min) * 0.04; min -= p; max += p; }

  // Give each node breathing room; allow horizontal scroll when crowded.
  const cw = host.clientWidth || 800;
  const W = Math.max(cw, padL + padR + data.length * 30);
  const x = t => padL + ((t - min) / (max - min)) * (W - padL - padR);
  const baseY = H - padB;

  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "tl-svg" });
  svg.style.display = "block";

  // Month gridlines + labels
  const start = new Date(min); start.setDate(1);
  for (let d = new Date(start); d.getTime() <= max; d.setMonth(d.getMonth() + 1)) {
    const tx = x(d.getTime());
    if (tx < padL || tx > W - padR) continue;
    svg.appendChild(el("line", { x1: tx, y1: padT, x2: tx, y2: baseY, class: "tl-grid" }));
    const lbl = el("text", { x: tx, y: baseY + 18, class: "tl-axis", "text-anchor": "middle" });
    lbl.textContent = d.toLocaleDateString("en-US", { month: "short" });
    svg.appendChild(lbl);
    if (d.getMonth() === 0) {
      const yr = el("text", { x: tx, y: baseY + 32, class: "tl-axis tl-year", "text-anchor": "middle" });
      yr.textContent = d.getFullYear();
      svg.appendChild(yr);
    }
  }
  svg.appendChild(el("line", { x1: padL, y1: baseY, x2: W - padR, y2: baseY, class: "tl-baseline" }));

  const series = opts.priceSeries && opts.priceSeries.length
    ? opts.priceSeries.map(p => ({ t: ms(p.date), c: p.close })).sort((a, b) => a.t - b.t)
    : null;
  let yOf = null;
  if (series) {
    const lo = Math.min(...series.map(s => s.c)), hi = Math.max(...series.map(s => s.c));
    const span = hi - lo || 1;
    yOf = c => padT + (1 - (c - lo) / span) * (baseY - padT);
    const pts = series.map(s => `${x(s.t)},${yOf(s.c)}`);
    svg.appendChild(el("polyline", { points: pts.join(" "), class: "tl-price" }));
    svg.appendChild(el("polygon", {
      points: `${x(series[0].t)},${baseY} ${pts.join(" ")} ${x(series[series.length - 1].t)},${baseY}`,
      class: "tl-price-area",
    }));
  }
  const priceAt = t => {
    if (!series) return null;
    let best = series[0];
    for (const s of series) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    return best.c;
  };

  // Node placement: on the price line if available, else lane-stacked above baseline.
  const laneX = [];
  const gap = 28, laneH = 24;
  const nodes = data.map(item => {
    const nx = x(item.t);
    let ny;
    if (series) {
      ny = yOf(priceAt(item.t));
    } else {
      let lane = 0;
      while (laneX[lane] != null && nx - laneX[lane] < gap) lane++;
      laneX[lane] = nx;
      ny = baseY - 16 - lane * laneH;
      const stem = el("line", { x1: nx, y1: baseY, x2: nx, y2: ny, class: "tl-stem" });
      svg.appendChild(stem);
    }
    return { item, nx, ny };
  });

  const tip = document.createElement("div");
  tip.className = "tl-tip";
  host.style.position = "relative";
  host.appendChild(tip);

  const select = id => {
    nodes.forEach(n => n.dot.classList.toggle("sel", n.item.id === id));
  };

  nodes.forEach(n => {
    const s = sent(n.item.sentiment);
    const g = el("g", { class: "tl-node", tabindex: "0" });
    const halo = el("circle", { cx: n.nx, cy: n.ny, r: 10, class: "tl-halo" });
    const dot = el("circle", { cx: n.nx, cy: n.ny, r: 6, class: `tl-dot ${s.cls}` });
    g.appendChild(halo); g.appendChild(dot);
    n.dot = g;
    const show = () => {
      tip.innerHTML = `<span class="tl-tip-date">${esc(fmtDate(n.item.date))}</span>${esc(n.item.tipTitle || "")}`;
      tip.style.display = "block";
      const rect = host.getBoundingClientRect();
      const tw = tip.offsetWidth;
      let left = n.nx - tw / 2;
      left = Math.max(4, Math.min(left, rect.width - tw - 4));
      tip.style.left = left + "px";
      tip.style.top = Math.max(2, n.ny - 52) + "px";
    };
    const hide = () => { tip.style.display = "none"; };
    g.addEventListener("mouseenter", show);
    g.addEventListener("mouseleave", hide);
    const go = () => { select(n.item.id); hide(); opts.onSelect && opts.onSelect(n.item.id); };
    g.addEventListener("click", go);
    g.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    svg.appendChild(g);
  });

  host.appendChild(svg);
  return { select };
}
