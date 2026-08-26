// strength.js — 題材強弱 (Theme Strength) page logic.
//
// Ranks the site's 97 hand-classified *subsectors* by price momentum, and
// cross-references each one against the supply-chain news and earnings-call
// corpora so a strong theme carrying a bearish narrative badge stands out.
//
// Everything here is read-only: Firestore is touched only when the user presses
// Update, and nothing is ever written. Dimension switching (day/week/month/…)
// only re-sorts the data already in memory — it never re-reads Firestore.

import { firebaseConfig, WORKER_URL } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, fmtDate, chartUrl, sent } from "./reports.js";

// ─── Firestore (own read-only handle, mirrors reports.js) ──────────────────
let _app = null, _db = null;
function app() { if (!_app) _app = initializeApp(firebaseConfig); return _app; }
function db() { if (!_db) _db = getFirestore(app()); return _db; }

async function loadAll(name) {
  const snap = await getDocs(collection(db(), name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Tunables ──────────────────────────────────────────────────────────────
// Overall momentum weights: year is deliberately low so a single name up +100%
// over a year doesn't stay pinned to the top — mid-term (week/month) is where
// rotation actually shows up.
const WEIGHTS = { day: 0.15, week: 0.35, month: 0.35, year: 0.15 };
const DIM_FIELD = {
  day: "day_change_pct", week: "week_change_pct",
  month: "month_change_pct", quarter: "quarter_change_pct", year: "year_change_pct",
};
const DIMS = [
  { k: "overall", label: "綜合" },
  { k: "day", label: "日" },
  { k: "week", label: "週" },
  { k: "month", label: "月" },
  { k: "quarter", label: "季" },
  { k: "year", label: "年" },
];
const DIM_LABEL = Object.fromEntries(DIMS.map(d => [d.k, d.label]));
// Quadrant chart: X = mid-term position, Y = short-term momentum by default,
// so movement between quadrants reads as a theme strengthening / weakening.
const QUAD_DEFAULT = { x: "month", y: "week" };
const QUAD_KEY = "st_quad_axes_v1";
const NEWS_DAYS = 30;      // supply-chain news lookback
const CALL_DAYS = 90;      // earnings-call lookback (~one quarter)
const TOP_N = 8;           // strongest / weakest columns
const CHART_RANGE = "6mo"; // per-ticker trend when a theme is expanded
const CHART_KEY = "st_price_series_v1";
const STATE_KEY = "st_state_v1"; // last computed board, restored on reload
const SMALL_SAMPLE = 3;    // < this many members ⇒ 樣本小

// ─── Small helpers ─────────────────────────────────────────────────────────
function median(nums) {
  const a = nums.filter(n => typeof n === "number" && isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(nums) {
  const a = nums.filter(n => typeof n === "number" && isFinite(n));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
// Robust theme value used by the quadrant chart. Drops outliers via the
// median-absolute-deviation modified z-score (|z| > 3.5) — so one member
// spiking on company-specific news doesn't drag the whole theme — then
// averages the surviving inliers. Samples < 4 fall back to the median, which
// is already outlier-resistant.
function robustAgg(nums) {
  const a = nums.filter(n => typeof n === "number" && isFinite(n));
  if (!a.length) return null;
  if (a.length < 4) return median(a);
  const med = median(a);
  const mad = median(a.map(v => Math.abs(v - med)));
  if (!mad) return med;                     // near-identical members
  const keep = a.filter(v => Math.abs(0.6745 * (v - med) / mad) <= 3.5);
  return keep.length ? mean(keep) : med;
}
// Round a domain half-width up to a friendly 1/2/5×10ⁿ step.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}
function fmtPct(v) {
  if (v == null || !isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}
function pctClass(v) {
  if (v == null || !isFinite(v)) return "neu";
  return v > 0 ? "pos" : v < 0 ? "neg" : "neu";
}
// Weighted, missing-aware overall momentum for one ticker. Weights are
// re-normalised over the dimensions that actually have a value, so a ticker
// with only a day change scores its day change, not a diluted fraction of it.
function tickerOverall(p) {
  if (!p) return null;
  let sum = 0, wsum = 0;
  for (const k in WEIGHTS) {
    const v = p[DIM_FIELD[k]];
    if (typeof v === "number" && isFinite(v)) { sum += WEIGHTS[k] * v; wsum += WEIGHTS[k]; }
  }
  return wsum ? sum / wsum : null;
}
// Majority sentiment of an earnings call, from its highlights[].sentiment.
function callSentiment(call) {
  const tally = { bullish: 0, bearish: 0, neutral: 0 };
  for (const h of (call.highlights || [])) {
    const s = (h && h.sentiment) || "neutral";
    tally[s] = (tally[s] || 0) + 1;
  }
  if (tally.bullish === 0 && tally.bearish === 0) return "neutral";
  return tally.bearish > tally.bullish ? "bearish"
    : tally.bullish > tally.bearish ? "bullish" : "neutral";
}
// Aggregate colour for a badge: bearish wins (a warning is the useful signal),
// then bullish, else neutral.
function aggColor(sentiments) {
  if (sentiments.some(s => s === "bearish")) return "neg";
  if (sentiments.some(s => s === "bullish")) return "pos";
  return "neu";
}
function daysBetween(iso, now) {
  if (!iso) return Infinity;
  const t = new Date(iso + (String(iso).length <= 10 ? "T00:00:00" : "")).getTime();
  if (isNaN(t)) return Infinity;
  return (now - t) / 86400000;
}
// Price document timestamp — the worker writes `last_updated`; accept the other
// plausible spellings too so a schema tweak doesn't blank the freshness line.
function priceTime(p) {
  return (p && (p.last_updated || p.updated_at || p.updatedAt)) || null;
}

// ─── Signal index (supply-chain news × earnings calls) ─────────────────────
// Builds symbol → { news[], calls[] } within the lookback windows. Each corpus
// loads under its own try/catch: ranking is the main feature, signals a bonus,
// so a failure here must never break the board.
function buildSignalIndex(news, calls, now) {
  const bySym = {};
  const ensure = s => (bySym[s] ||= { news: [], calls: [] });

  // Keep only the fields the page renders — so the computed board stays small
  // enough to persist to localStorage across reloads.
  for (const it of news) {
    if (daysBetween(it.date, now) > NEWS_DAYS) continue;
    const slim = { id: it.id, date: it.date || "", headline: it.headline || "", sentiment: it.sentiment || "neutral" };
    for (const sym of (it.tickers || [])) ensure(sym).news.push(slim);
  }
  for (const c of calls) {
    if (daysBetween(c.date, now) > CALL_DAYS) continue;
    if (!c.ticker) continue;
    ensure(c.ticker).calls.push({
      quarter: c.quarter || "", year: c.year || "", date: c.date || "",
      summary: String(c.summary || "").slice(0, 120),
      watch: (c.watch || []).slice(0, 2).map(String),
      _sent: callSentiment(c),
    });
  }
  // newest-first within each symbol
  for (const s in bySym) {
    bySym[s].news.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    bySym[s].calls.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }
  return bySym;
}

// ─── Theme (subsector) computation ─────────────────────────────────────────
function computeThemes(data) {
  const { sectors, subsectors, tickers, prices, signalIdx } = data;
  const sectorName = Object.fromEntries(sectors.map(s => [s.id, s.name]));

  // group tickers by subsector
  const bySub = {};
  for (const t of tickers) {
    const sub = t.subsector_id;
    if (!sub) continue;
    (bySub[sub] ||= []).push(t);
  }

  const themes = [];
  for (const sub of subsectors) {
    const members = (bySub[sub.id] || [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const rows = members.map(t => {
      const sym = t.symbol || t.id;            // symbol field, fallback to doc id
      const full = prices[sym];
      // keep only the fields the board + detail table render, so the computed
      // result persists compactly to localStorage
      const p = full ? {
        last: full.last ?? null,
        day_change_pct: full.day_change_pct ?? null,
        week_change_pct: full.week_change_pct ?? null,
        month_change_pct: full.month_change_pct ?? null,
        quarter_change_pct: full.quarter_change_pct ?? null,
        year_change_pct: full.year_change_pct ?? null,
        day_volume: full.day_volume ?? null,
      } : null;
      return { symbol: sym, name: t.name || "", market: t.market || "", p };
    });

    const priced = rows.filter(r => r.p);
    const pricedCount = priced.length;

    // per-dimension median across priced members
    const scores = { overall: median(priced.map(r => tickerOverall(r.p))) };
    for (const k in DIM_FIELD) scores[k] = median(priced.map(r => r.p[DIM_FIELD[k]]));

    // outlier-trimmed aggregate (for the quadrant chart) — robust to a single
    // member spiking on company-specific news
    const robustScores = { overall: robustAgg(priced.map(r => tickerOverall(r.p))) };
    for (const k in DIM_FIELD) robustScores[k] = robustAgg(priced.map(r => r.p[DIM_FIELD[k]]));

    // aggregate signals across member symbols (dedupe news by doc id)
    const seenNews = new Set();
    const news = [], calls = [], perSym = {};
    for (const r of rows) {
      const sig = signalIdx[r.symbol];
      if (!sig) continue;
      perSym[r.symbol] = sig;
      for (const it of sig.news) if (!seenNews.has(it.id)) { seenNews.add(it.id); news.push(it); }
      for (const c of sig.calls) calls.push(c);
    }
    const newsColor = aggColor(news.map(n => n.sentiment || "neutral"));
    const callColor = aggColor(calls.map(c => c._sent));

    themes.push({
      id: sub.id,
      name: sub.name || sub.id,
      sector: sectorName[sub.sector_id] || "",
      rows, pricedCount, totalCount: rows.length,
      scores, robustScores,
      signals: { news, calls, newsColor, callColor, perSym },
    });
  }
  return themes;
}

// ─── Trend chart (6-month sparkline, reused from the highlight section) ─────
const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
function readChartCache() {
  try { return JSON.parse(localStorage.getItem(CHART_KEY) || "{}") || {}; }
  catch { return {}; }
}
function writeChartCache(o) { try { localStorage.setItem(CHART_KEY, JSON.stringify(o)); } catch { /* quota */ } }

async function fetchSeries(symbols, range) {
  if (!symbols.length) return {};
  const url = `${WORKER_URL}/chart?symbols=${encodeURIComponent(symbols.join(","))}`
    + `&range=${encodeURIComponent(range)}&interval=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data && data.data ? data.data : {};
}

function sparkSvg(series) {
  const closes = series.map(p => p.close);
  const first = closes[0], last = closes[closes.length - 1];
  const chg = first ? ((last - first) / first * 100) : 0;
  const cls = chg > 0 ? "pos" : chg < 0 ? "neg" : "neu";
  const W = 240, H = 64, pad = 4;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const span = (hi - lo) || 1;
  const xx = i => pad + (i / (series.length - 1)) * (W - pad * 2);
  const yy = c => pad + (1 - (c - lo) / span) * (H - pad * 2);
  const pts = series.map((p, i) => `${xx(i).toFixed(1)},${yy(p.close).toFixed(1)}`);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: `hl-spark ${cls}`, preserveAspectRatio: "none" });
  svg.appendChild(svgEl("polygon", {
    points: `${xx(0).toFixed(1)},${H - pad} ${pts.join(" ")} ${xx(series.length - 1).toFixed(1)},${H - pad}`,
    class: "hl-spark-area",
  }));
  svg.appendChild(svgEl("polyline", { points: pts.join(" "), class: "hl-spark-line" }));
  return { svg, chg, cls };
}

// ─── Mount ─────────────────────────────────────────────────────────────────
export function mountStrength(opts) {
  const { root } = opts;
  let dim = "overall";
  let themes = null;         // computed themes, or null before first Update
  let skipped = 0;           // themes with no priced members
  let openId = null;         // expanded theme id
  const chartFetched = {};   // theme id → true once its charts were fetched

  root.innerHTML = `
    <div class="st-note">
      <span class="st-note-icon">ⓘ</span>
      請先到 <a href="../index.html#watchlist">Stock Watchlist</a> 按 <b>↺ Refresh Prices</b> 更新行情，再回此頁按下方 <b>↻ Update</b>。
    </div>
    <div class="st-bar">
      <button class="st-update" data-role="update">↻ Update</button>
      <div class="st-dims" data-role="dims" role="tablist">
        ${DIMS.map(d => `<button class="st-dim${d.k === dim ? " on" : ""}" data-dim="${d.k}">${d.label}</button>`).join("")}
      </div>
      <span class="st-status" data-role="status"></span>
    </div>
    <div class="st-age" data-role="age"></div>
    <div class="st-board" data-role="board">
      <div class="st-empty">尚未計算 — 按 <b>↻ Update</b> 讀取 Firestore 並產生榜單。</div>
    </div>
    <div class="st-detail" data-role="detail"></div>

    <section class="st-quad" data-role="quad">
      <div class="st-quad-head">
        <div class="st-quad-titles">
          <h3 class="st-quad-title">題材四象限圖</h3>
          <p class="st-quad-desc">每個題材以去除離群個股後的漲跌幅定位；X／Y 可選不同時間尺度，觀察題材由強轉弱或由弱轉強的移動。</p>
        </div>
        <div class="st-quad-ctrls">
          <label class="st-quad-axis">X 軸
            <span class="rv-sel-wrap"><select class="rv-select st-quad-sel" data-role="qx">
              ${DIMS.map(d => `<option value="${d.k}"${d.k === QUAD_DEFAULT.x ? " selected" : ""}>${d.label}</option>`).join("")}
            </select></span>
          </label>
          <label class="st-quad-axis">Y 軸
            <span class="rv-sel-wrap"><select class="rv-select st-quad-sel" data-role="qy">
              ${DIMS.map(d => `<option value="${d.k}"${d.k === QUAD_DEFAULT.y ? " selected" : ""}>${d.label}</option>`).join("")}
            </select></span>
          </label>
        </div>
      </div>
      <div class="st-quad-canvas" data-role="quad-canvas">
        <div class="st-empty">按 <b>↻ Update</b> 後產生四象限圖。</div>
      </div>
      <div class="st-quad-tip" data-role="quad-tip" hidden></div>
    </section>`;

  const updateBtn = root.querySelector('[data-role="update"]');
  const dimsEl = root.querySelector('[data-role="dims"]');
  const statusEl = root.querySelector('[data-role="status"]');
  const ageEl = root.querySelector('[data-role="age"]');
  const boardEl = root.querySelector('[data-role="board"]');
  const detailEl = root.querySelector('[data-role="detail"]');
  const quadCanvas = root.querySelector('[data-role="quad-canvas"]');
  const quadTip = root.querySelector('[data-role="quad-tip"]');
  const qxSel = root.querySelector('[data-role="qx"]');
  const qySel = root.querySelector('[data-role="qy"]');

  // Restore last-used axis choices.
  let quadAxes = { ...QUAD_DEFAULT };
  try {
    const saved = JSON.parse(localStorage.getItem(QUAD_KEY) || "null");
    if (saved && DIM_FIELD[saved.x] || saved?.x === "overall") quadAxes.x = saved.x;
    if (saved && DIM_FIELD[saved.y] || saved?.y === "overall") quadAxes.y = saved.y;
  } catch { /* ignore */ }
  qxSel.value = quadAxes.x; qySel.value = quadAxes.y;

  function setStatus(msg, kind = "") { statusEl.textContent = msg || ""; statusEl.className = `st-status ${kind}`; }

  // ── Signal badges (theme card + per ticker) ──────────────────────────────
  function badges(newsN, newsColor, callN, callColor) {
    const parts = [];
    if (newsN) parts.push(`<span class="st-badge ${newsColor}" title="近 ${NEWS_DAYS} 天供應鏈新聞">⛓ 供應鏈 ${newsN}</span>`);
    if (callN) parts.push(`<span class="st-badge ${callColor}" title="近 ${CALL_DAYS} 天財報電話會議">▤ 財報 ${callN}</span>`);
    return parts.length ? `<span class="st-badges">${parts.join("")}</span>` : "";
  }

  // ── One theme card ───────────────────────────────────────────────────────
  function themeCard(t, rank) {
    const v = t.scores[dim];
    const cls = pctClass(v);
    const flags = [];
    if (t.totalCount < SMALL_SAMPLE) flags.push(`<span class="st-flag warn" title="成分股少於 ${SMALL_SAMPLE} 檔，中位數易受單一個股影響">樣本小</span>`);
    if (t.pricedCount < t.totalCount) flags.push(`<span class="st-flag" title="部分成分股沒有價格資料">${t.pricedCount}/${t.totalCount} 有價</span>`);
    const sig = t.signals;
    return `<button class="st-card${openId === t.id ? " open" : ""}" data-theme="${esc(t.id)}">
      <span class="st-rank">${rank}</span>
      <span class="st-card-main">
        <span class="st-card-name">${esc(t.name)}</span>
        <span class="st-card-meta">${esc(t.sector)} · n=${t.totalCount}</span>
        <span class="st-flags">${flags.join("")}${badges(sig.news.length, sig.newsColor, sig.calls.length, sig.callColor)}</span>
      </span>
      <span class="st-card-score ${cls}">${fmtPct(v)}</span>
    </button>`;
  }

  // ── Board (Top / Bottom columns) ─────────────────────────────────────────
  function renderBoard() {
    if (!themes) return;
    const ranked = themes
      .filter(t => t.scores[dim] != null)
      .sort((a, b) => b.scores[dim] - a.scores[dim]);
    if (!ranked.length) {
      boardEl.innerHTML = `<div class="st-empty">此維度沒有可排名的題材。</div>`;
      return;
    }
    const top = ranked.slice(0, TOP_N);
    const bottom = ranked.slice(-TOP_N).reverse();
    const col = (title, arr, kind, startRank, reverse) => `
      <div class="st-col ${kind}">
        <div class="st-col-head">${title}</div>
        ${arr.map((t, i) => themeCard(t, reverse ? ranked.length - i : startRank + i)).join("")}
      </div>`;
    boardEl.innerHTML =
      col(`最強 Top ${top.length}`, top, "top", 1, false) +
      col(`最弱 Bottom ${bottom.length}`, bottom, "bottom", 0, true);
    // keep an open theme's detail in sync with the (possibly re-sorted) board
    if (openId && themes.some(t => t.id === openId)) renderDetail(openId);
    else { openId = null; detailEl.innerHTML = ""; }
  }

  // ── Ticker signal detail (news + calls + watch) ──────────────────────────
  function tickerSignals(sym, sig) {
    if (!sig || (!sig.news.length && !sig.calls.length)) return "";
    const news = sig.news.slice(0, 3).map(n => {
      const s = sent(n.sentiment);
      return `<div class="st-sig-row"><span class="sent-tag ${s.cls}">${s.label}</span>
        <span class="st-sig-date">${esc(fmtDate(n.date))}</span>
        <span class="st-sig-text">${esc(n.headline || "")}</span></div>`;
    }).join("");
    const calls = sig.calls.slice(0, 2).map(c => {
      const s = sent(c._sent);
      const summ = (c.summary || "").slice(0, 90);
      const watch = (c.watch || []).slice(0, 2);
      return `<div class="st-sig-call">
        <div class="st-sig-row"><span class="sent-tag ${s.cls}">${s.label}</span>
          <span class="st-sig-date">${esc(c.quarter || "")} ${esc(c.year || "")} · ${esc(fmtDate(c.date))}</span></div>
        ${summ ? `<div class="st-sig-summary">${esc(summ)}${(c.summary || "").length > 90 ? "…" : ""}</div>` : ""}
        ${watch.length ? `<div class="st-sig-watch"><span class="st-sig-watch-h">下季觀察</span>${
          watch.map(w => `<span class="st-sig-watch-i">${esc(w)}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("");
    return `<div class="st-sig">
      ${news ? `<div class="st-sig-grp"><div class="st-sig-grp-h">⛓ 供應鏈</div>${news}</div>` : ""}
      ${calls ? `<div class="st-sig-grp"><div class="st-sig-grp-h">▤ 財報</div>${calls}</div>` : ""}
    </div>`;
  }

  // ── Expanded theme detail (members: prices + trend + signals) ─────────────
  function renderDetail(id) {
    const t = themes.find(x => x.id === id);
    if (!t) { detailEl.innerHTML = ""; return; }
    const cache = readChartCache();
    const rows = t.rows.map(r => {
      const p = r.p || {};
      const cell = (v) => `<td class="st-num ${pctClass(v)}">${fmtPct(v)}</td>`;
      const sigHtml = tickerSignals(r.symbol, t.signals.perSym[r.symbol]);
      return `<tr class="st-trow">
        <td class="st-tsym"><a href="${esc(chartUrl(r.symbol))}" target="_blank" rel="noopener">${esc(r.symbol)}</a>
          <span class="st-tname">${esc(r.name)}</span></td>
        <td class="st-num">${p.last != null ? Number(p.last).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</td>
        ${cell(p.day_change_pct)}${cell(p.week_change_pct)}${cell(p.month_change_pct)}${cell(p.quarter_change_pct)}${cell(p.year_change_pct)}
        <td class="st-num">${p.day_volume ? fmtVol(p.day_volume) : "—"}</td>
      </tr>
      <tr class="st-trow-x"><td colspan="8">
        <div class="st-tx">
          <div class="st-chart" data-sym="${esc(r.symbol)}">${chartInner(cache[r.symbol])}</div>
          ${sigHtml || `<div class="st-sig st-sig-none">近期無供應鏈 / 財報訊號</div>`}
        </div>
      </td></tr>`;
    }).join("");

    detailEl.innerHTML = `
      <div class="st-detail-head">
        <h3>${esc(t.name)} <span class="st-detail-sub">${esc(t.sector)} · ${t.pricedCount}/${t.totalCount} 有價</span></h3>
        <div class="st-detail-actions">
          <button class="st-chart-btn" data-role="load-charts">↻ 載入走勢圖 (6 個月)</button>
          <button class="st-detail-close" data-role="close">✕ 收合</button>
        </div>
      </div>
      <div class="st-table-wrap">
        <table class="st-table">
          <thead><tr><th>成分股</th><th>價格</th><th>日</th><th>週</th><th>月</th><th>季</th><th>年</th><th>量</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    detailEl.querySelector('[data-role="close"]').addEventListener("click", () => {
      openId = null; detailEl.innerHTML = "";
      boardEl.querySelectorAll(".st-card.open").forEach(c => c.classList.remove("open"));
    });
    detailEl.querySelector('[data-role="load-charts"]').addEventListener("click", () => loadCharts(t));
    // auto-load charts the first time a theme is opened
    if (!chartFetched[t.id]) loadCharts(t);
  }

  function chartInner(entry) {
    const series = (entry && entry.series || []).filter(p => p && p.close != null);
    if (series.length < 2) return `<div class="st-chart-empty">走勢圖尚未載入</div>`;
    const { svg, chg, cls } = sparkSvg(series);
    const wrap = document.createElement("div");
    wrap.className = "st-chart-inner";
    const head = document.createElement("div");
    head.className = "st-chart-head";
    head.innerHTML = `<span class="st-chart-chg ${cls}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span>
      <span class="st-chart-period">${esc(fmtDate(series[0].date))} → ${esc(fmtDate(series[series.length - 1].date))}</span>`;
    wrap.appendChild(head);
    const chart = document.createElement("div");
    chart.className = "st-chart-svg";
    chart.appendChild(svg);
    wrap.appendChild(chart);
    return wrap.outerHTML;
  }

  // Fetch 6-month daily closes for a theme's members (one batched request; a
  // theme has few members, comfortably under the worker's subrequest cap).
  async function loadCharts(t) {
    const btn = detailEl.querySelector('[data-role="load-charts"]');
    const syms = t.rows.map(r => r.symbol);
    if (!syms.length) return;
    if (btn) { btn.disabled = true; btn.textContent = "載入中…"; }
    try {
      const cache = readChartCache();
      // only fetch symbols we don't already have for this range
      const need = syms.filter(s => !(cache[s] && cache[s].range === CHART_RANGE && cache[s].series?.length));
      if (need.length) {
        const data = await fetchSeries(need, CHART_RANGE);
        const now = Date.now();
        for (const s of need) {
          const d = data[s];
          if (d && Array.isArray(d.series) && d.series.length) cache[s] = { ...d, range: CHART_RANGE, fetched_at: now };
        }
        writeChartCache(cache);
      }
      chartFetched[t.id] = true;
      // paint each chart cell
      detailEl.querySelectorAll(".st-chart").forEach(cell => {
        cell.innerHTML = chartInner(cache[cell.dataset.sym]);
      });
      if (btn) { btn.disabled = false; btn.textContent = "↻ 重新載入走勢圖"; }
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "↻ 載入走勢圖 (6 個月)"; }
      console.error("chart load failed", e);
    }
  }

  function fmtVol(v) {
    if (!v) return "—";
    if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return String(v);
  }

  // ── Four-quadrant chart ──────────────────────────────────────────────────
  const NSVG = "http://www.w3.org/2000/svg";
  function themeAxisVal(t, k) { return t.robustScores ? t.robustScores[k] : null; }
  function tickerDimVal(p, k) { return k === "overall" ? tickerOverall(p) : (p ? p[DIM_FIELD[k]] : null); }
  // Rough on-screen text width (CJK glyphs ≈ 1em, latin ≈ 0.6em).
  function textWidth(str, fs) {
    let w = 0;
    for (const ch of String(str)) w += (ch.charCodeAt(0) > 255 ? 1.0 : 0.6) * fs;
    return w;
  }
  let _quadW = 0;

  function renderQuadrant() {
    if (!themes) {
      quadCanvas.innerHTML = `<div class="st-empty">按 <b>↻ Update</b> 後產生四象限圖。</div>`;
      return;
    }
    const xk = quadAxes.x, yk = quadAxes.y;
    const pts = themes
      .map(t => ({ t, x: themeAxisVal(t, xk), y: themeAxisVal(t, yk) }))
      .filter(p => p.x != null && isFinite(p.x) && p.y != null && isFinite(p.y));
    if (!pts.length) {
      quadCanvas.innerHTML = `<div class="st-empty">此時間尺度沒有可定位的題材。</div>`;
      return;
    }

    const W = Math.max(320, quadCanvas.clientWidth || 800);
    _quadW = W;
    const H = Math.round(Math.min(640, Math.max(430, W * 0.6)));
    const m = { l: 50, r: 18, t: 26, b: 42 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const domX = Math.max(1, niceMax(Math.max(...pts.map(p => Math.abs(p.x))) * 1.12));
    const domY = Math.max(1, niceMax(Math.max(...pts.map(p => Math.abs(p.y))) * 1.12));
    const sx = v => m.l + (v + domX) / (2 * domX) * iw;
    const sy = v => m.t + (domY - v) / (2 * domY) * ih;
    const ox = sx(0), oy = sy(0);
    const xlbl = DIM_LABEL[xk], ylbl = DIM_LABEL[yk];

    const svg = [];
    svg.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="st-quad-svg" role="img" aria-label="題材四象限圖">`);
    // quadrant tints
    svg.push(`<rect x="${ox}" y="${m.t}" width="${m.l + iw - ox}" height="${oy - m.t}" class="st-q-bg pos"/>`);
    svg.push(`<rect x="${m.l}" y="${oy}" width="${ox - m.l}" height="${m.t + ih - oy}" class="st-q-bg neg"/>`);
    svg.push(`<rect x="${m.l}" y="${m.t}" width="${ox - m.l}" height="${oy - m.t}" class="st-q-bg mid"/>`);
    svg.push(`<rect x="${ox}" y="${oy}" width="${m.l + iw - ox}" height="${m.t + ih - oy}" class="st-q-bg mid"/>`);
    // plot border + zero axes
    svg.push(`<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" class="st-q-frame"/>`);
    svg.push(`<line x1="${ox}" y1="${m.t}" x2="${ox}" y2="${m.t + ih}" class="st-q-axis"/>`);
    svg.push(`<line x1="${m.l}" y1="${oy}" x2="${m.l + iw}" y2="${oy}" class="st-q-axis"/>`);
    // corner tags
    const corner = (x, y, anchor, txt) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="st-q-corner">${esc(txt)}</text>`;
    svg.push(corner(m.l + iw - 8, m.t + 15, "end",   `${xlbl}↑ ${ylbl}↑`));
    svg.push(corner(m.l + 8,      m.t + 15, "start", `${xlbl}↓ ${ylbl}↑`));
    svg.push(corner(m.l + iw - 8, m.t + ih - 8, "end",   `${xlbl}↑ ${ylbl}↓`));
    svg.push(corner(m.l + 8,      m.t + ih - 8, "start", `${xlbl}↓ ${ylbl}↓`));
    // tick labels
    const tick = (x, y, anchor, txt) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="st-q-tick">${esc(txt)}</text>`;
    svg.push(tick(m.l, m.t + ih + 15, "start", `−${domX}%`));
    svg.push(tick(m.l + iw, m.t + ih + 15, "end", `+${domX}%`));
    svg.push(tick(ox, m.t + ih + 15, "middle", "0"));
    svg.push(tick(m.l - 6, m.t + 4, "end", `+${domY}%`));
    svg.push(tick(m.l - 6, m.t + ih, "end", `−${domY}%`));
    // axis titles
    svg.push(`<text x="${m.l + iw / 2}" y="${H - 6}" text-anchor="middle" class="st-q-title-x">${esc(xlbl)}漲跌幅（去離群）</text>`);
    svg.push(`<text transform="translate(14 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle" class="st-q-title-y">${esc(ylbl)}漲跌幅（去離群）</text>`);

    // points, largest themes drawn first so small ones sit on top and stay hittable
    const drawn = pts.slice().sort((a, b) => (b.t.pricedCount || 0) - (a.t.pricedCount || 0));
    for (const p of drawn) {
      const cx = sx(p.x), cy = sy(p.y);
      const r = 4 + Math.min(8, Math.sqrt(p.t.pricedCount || 1));
      const cls = p.x > 0 && p.y > 0 ? "pos" : p.x < 0 && p.y < 0 ? "neg" : "mid";
      svg.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" class="st-q-dot ${cls}" data-id="${esc(p.t.id)}"/>`);
    }

    // labels — greedy, importance-ordered, skip on collision so names never
    // pile up (font stays a fixed readable size)
    const fs = 11;
    const placed = [];
    const clampBox = (b) => b.x0 >= 2 && b.x1 <= W - 2 && b.y0 >= 2 && b.y1 <= H - 2;
    const hit = (b) => placed.some(q => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
    const byImp = pts.slice().sort((a, b) =>
      (b.t.pricedCount || 0) - (a.t.pricedCount || 0) ||
      (Math.abs(b.x) + Math.abs(b.y)) - (Math.abs(a.x) + Math.abs(a.y)));
    for (const p of byImp) {
      const cx = sx(p.x), cy = sy(p.y);
      const r = 4 + Math.min(8, Math.sqrt(p.t.pricedCount || 1));
      let name = p.t.name || "";
      if (name.length > 10) name = name.slice(0, 9) + "…";
      const tw = textWidth(name, fs), th = fs;
      const cands = [
        { x: cx + r + 3, y: cy + th * 0.35, anchor: "start", x0: cx + r + 3, x1: cx + r + 3 + tw },
        { x: cx - r - 3, y: cy + th * 0.35, anchor: "end",   x0: cx - r - 3 - tw, x1: cx - r - 3 },
        { x: cx, y: cy - r - 4,             anchor: "middle", x0: cx - tw / 2, x1: cx + tw / 2 },
        { x: cx, y: cy + r + th + 1,        anchor: "middle", x0: cx - tw / 2, x1: cx + tw / 2 },
      ];
      for (const c of cands) {
        const box = { x0: c.x0 - 1, x1: c.x1 + 1, y0: c.y - th, y1: c.y + 3 };
        if (!clampBox(box) || hit(box)) continue;
        placed.push(box);
        svg.push(`<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" text-anchor="${c.anchor}" class="st-q-label">${esc(name)}</text>`);
        break;
      }
    }
    svg.push(`</svg>`);
    quadCanvas.innerHTML = svg.join("");
    wireQuadHover();
  }

  function quadTipHtml(t, xk, yk) {
    const rows = t.rows
      .map(r => ({ sym: r.symbol, name: r.name, v: tickerDimVal(r.p, yk) }))
      .filter(r => r.v != null && isFinite(r.v))
      .sort((a, b) => b.v - a.v);
    const shown = rows.slice(0, 12);
    const more = rows.length - shown.length;
    const list = shown.map(r =>
      `<div class="st-qt-row"><span class="st-qt-sym">${esc(r.sym)}</span>` +
      `<span class="st-qt-nm">${esc(r.name || "")}</span>` +
      `<span class="st-qt-v ${pctClass(r.v)}">${fmtPct(r.v)}</span></div>`).join("");
    return `<div class="st-qt-head">${esc(t.name)}<span class="st-qt-sector">${esc(t.sector)}</span></div>` +
      `<div class="st-qt-axes"><span>${esc(DIM_LABEL[xk])} <b class="${pctClass(themeAxisVal(t, xk))}">${fmtPct(themeAxisVal(t, xk))}</b></span>` +
      `<span>${esc(DIM_LABEL[yk])} <b class="${pctClass(themeAxisVal(t, yk))}">${fmtPct(themeAxisVal(t, yk))}</b></span>` +
      `<span class="st-qt-n">${t.pricedCount}/${t.totalCount} 有價</span></div>` +
      `<div class="st-qt-listh">個股（依${esc(DIM_LABEL[yk])}漲跌幅）</div>` +
      `<div class="st-qt-list">${list || '<div class="st-qt-row">無個股價格</div>'}` +
      `${more > 0 ? `<div class="st-qt-more">＋ 其餘 ${more} 檔</div>` : ""}</div>`;
  }

  function positionTip(e) {
    const rect = quadCanvas.getBoundingClientRect();
    let x = e.clientX - rect.left + 14;
    let y = e.clientY - rect.top + 14;
    const tw = quadTip.offsetWidth, th = quadTip.offsetHeight;
    if (x + tw > rect.width - 4) x = e.clientX - rect.left - tw - 14;
    if (y + th > rect.height - 4) y = Math.max(4, rect.height - th - 4);
    quadTip.style.left = x + "px";
    quadTip.style.top = y + "px";
  }
  function wireQuadHover() {
    quadCanvas.querySelectorAll(".st-q-dot").forEach(dot => {
      dot.addEventListener("mouseenter", e => {
        const t = themes.find(x => x.id === dot.dataset.id);
        if (!t) return;
        quadTip.innerHTML = quadTipHtml(t, quadAxes.x, quadAxes.y);
        quadTip.hidden = false;
        positionTip(e);
        dot.classList.add("hot");
      });
      dot.addEventListener("mousemove", positionTip);
      dot.addEventListener("mouseleave", () => { quadTip.hidden = true; dot.classList.remove("hot"); });
    });
  }

  // ── Update: read Firestore, compute, render ──────────────────────────────
  async function update() {
    updateBtn.disabled = true;
    setStatus("讀取 Firestore…");
    try {
      // Whole-collection reads + client-side group-by: same document count as
      // per-subsector queries, but one network round-trip instead of ~97.
      const [sectors, subsectors, tickers, priceDocs] = await Promise.all([
        loadAll("sectors"), loadAll("subsectors"), loadAll("tickers"), loadAll("prices"),
      ]);
      const prices = {};
      for (const d of priceDocs) prices[d.id] = d;

      // signals load independently — a failure here must not break the board
      const now = Date.now();
      let news = [], calls = [];
      try { news = await loadAll("supply_chain_news"); } catch (e) { console.warn("news load failed", e); }
      try { calls = await loadAll("earnings_calls"); } catch (e) { console.warn("calls load failed", e); }
      const signalIdx = buildSignalIndex(news, calls, now);

      themes = computeThemes({ sectors, subsectors, tickers, prices, signalIdx });
      skipped = themes.filter(t => t.scores.overall == null).length;

      const meta = priceMetaOf(priceDocs);
      renderPriceAge(meta);
      renderBoard();
      renderQuadrant();       // quadrant updates together with the board
      saveState(meta, now);   // persist so a reload restores this board

      const rankable = themes.length - skipped;
      let msg = `已計算 ${rankable} 個題材`;
      if (skipped) msg += ` · ${skipped} 個無價格已略過`;
      msg += ` · ${new Date(now).toLocaleTimeString("en-GB")}`;
      setStatus(msg, "ok");
    } catch (e) {
      console.error(e);
      setStatus("讀取失敗：" + e.message, "err");
    } finally {
      updateBtn.disabled = false;
    }
  }

  // Newest + oldest price timestamp actually seen (persisted with the board).
  function priceMetaOf(priceDocs) {
    const times = priceDocs.map(priceTime).filter(Boolean).sort();
    if (!times.length) return null;
    return { newest: times[times.length - 1], oldest: times[0] };
  }
  // Freshness line, rendered from the {newest, oldest} meta.
  function renderPriceAge(meta) {
    if (!meta) {
      ageEl.innerHTML = `<span class="st-age-warn">⚠ 價格資料無時間戳（未知新鮮度）— 請確認已按 Refresh Prices</span>`;
      return;
    }
    const fmt = iso => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString("en-GB"); };
    const same = meta.oldest === meta.newest;
    ageEl.innerHTML = `<span class="st-age-icon">🕑</span> 價格資料時間：最新 <b>${esc(fmt(meta.newest))}</b>`
      + (same ? "" : ` · 最舊 <b>${esc(fmt(meta.oldest))}</b>`)
      + ` <span class="st-age-hint">（若過舊，請先到 Watchlist 按 Refresh Prices）</span>`;
  }

  // ── Persist the last computed board so reopening the page restores it
  //    instead of showing an empty list (and without re-reading Firestore). ──
  function saveState(priceMeta, computedAt) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, themes, skipped, priceMeta, computedAt, dim }));
    } catch { /* quota — skip persisting */ }
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
      return s && Array.isArray(s.themes) ? s : null;
    } catch { return null; }
  }
  // Restore a saved board on mount: paint it immediately, flagged as cached.
  function restoreState() {
    const s = loadState();
    if (!s) return;
    themes = s.themes;
    skipped = s.skipped || 0;
    dim = s.dim || "overall";
    dimsEl.querySelectorAll(".st-dim").forEach(b => b.classList.toggle("on", b.dataset.dim === dim));
    renderPriceAge(s.priceMeta);
    renderBoard();
    renderQuadrant();
    const when = s.computedAt ? new Date(s.computedAt).toLocaleString("en-GB") : "";
    setStatus(`顯示上次計算結果${when ? " · " + when : ""} · 按 ↻ Update 重新讀取`, "warn");
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  updateBtn.addEventListener("click", update);
  dimsEl.addEventListener("click", e => {
    const btn = e.target.closest("[data-dim]");
    if (!btn) return;
    dim = btn.dataset.dim;
    dimsEl.querySelectorAll(".st-dim").forEach(b => b.classList.toggle("on", b.dataset.dim === dim));
    renderBoard();  // re-sort only; no Firestore read
  });
  boardEl.addEventListener("click", e => {
    const card = e.target.closest("[data-theme]");
    if (!card) return;
    const id = card.dataset.theme;
    if (openId === id) { openId = null; detailEl.innerHTML = ""; }
    else { openId = id; renderDetail(id); detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    boardEl.querySelectorAll(".st-card").forEach(c => c.classList.toggle("open", c.dataset.theme === openId));
  });

  // Quadrant axis selectors — re-plot from data already in memory (no re-read).
  function onAxisChange() {
    quadAxes = { x: qxSel.value, y: qySel.value };
    try { localStorage.setItem(QUAD_KEY, JSON.stringify(quadAxes)); } catch { /* ignore */ }
    renderQuadrant();
  }
  qxSel.addEventListener("change", onAxisChange);
  qySel.addEventListener("change", onAxisChange);

  // Re-plot on real width changes (responsive), guarded against self-triggered
  // layout churn from our own innerHTML writes.
  if (typeof ResizeObserver !== "undefined") {
    let rt = null;
    new ResizeObserver(() => {
      if (!themes) return;
      const w = quadCanvas.clientWidth || 0;
      if (Math.abs(w - _quadW) < 3) return;
      clearTimeout(rt);
      rt = setTimeout(renderQuadrant, 120);
    }).observe(quadCanvas);
  }

  // Restore the last computed board (if any) so reopening the page isn't empty.
  restoreState();

  return { update };
}
