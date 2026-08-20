// highlight.js — the lower "重點新聞 Highlight News" section of the supply-chain
// page. Lets the user pick a collected news item, shows its card (reusing the
// page's detail renderer) plus a stock-price trend per related ticker, with an
// "update price" button that (re)fetches the series from the price worker.

import { WORKER_URL } from "./config.js";
import { esc, fmtDate, chartUrl } from "./reports.js";
import { getCollected, removeCollected, onCollectChange } from "./collect.js";

const PRICE_KEY = "sc_price_series_v1";
const NS = "http://www.w3.org/2000/svg";
const RANGES = [
  { v: "1mo", label: "1 個月" },
  { v: "6mo", label: "6 個月" },
  { v: "1y",  label: "1 年" },
];

function readPriceCache() {
  try { return JSON.parse(localStorage.getItem(PRICE_KEY) || "{}") || {}; }
  catch { return {}; }
}
function writePriceCache(obj) {
  try { localStorage.setItem(PRICE_KEY, JSON.stringify(obj)); } catch { /* quota */ }
}

// Fetch daily close series for symbols from the price worker's /chart endpoint.
// Returns { [symbol]: { name, currency, series:[{date,close}] } }.
async function fetchSeries(symbols, range) {
  if (!symbols.length) return {};
  const url = `${WORKER_URL}/chart?symbols=${encodeURIComponent(symbols.join(","))}`
    + `&range=${encodeURIComponent(range)}&interval=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data && data.data ? data.data : {};
}

function el(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// A compact price-trend chart card (image-2 style): symbol + last + change on
// top, a filled line chart below.
function trendCard(symbol, entry) {
  const card = document.createElement("div");
  card.className = "hl-trend-card";
  const series = (entry && entry.series || []).filter(p => p && p.close != null);
  const name = entry && entry.name ? entry.name : "";

  if (series.length < 2) {
    card.classList.add("empty");
    card.innerHTML = `
      <div class="hl-trend-head">
        <a class="hl-trend-sym" href="${esc(chartUrl(symbol))}" target="_blank" rel="noopener">${esc(symbol)}</a>
        ${name ? `<span class="hl-trend-name">${esc(name)}</span>` : ""}
      </div>
      <div class="hl-trend-empty">尚無股價資料 — 按「更新股價」載入</div>`;
    return card;
  }

  const closes = series.map(p => p.close);
  const first = closes[0], last = closes[closes.length - 1];
  const chg = first ? ((last - first) / first * 100) : 0;
  const cls = chg > 0 ? "pos" : chg < 0 ? "neg" : "neu";
  const sign = chg > 0 ? "+" : "";

  // SVG line + area
  const W = 240, H = 76, pad = 4;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const span = (hi - lo) || 1;
  const xx = i => pad + (i / (series.length - 1)) * (W - pad * 2);
  const yy = c => pad + (1 - (c - lo) / span) * (H - pad * 2);
  const pts = series.map((p, i) => `${xx(i).toFixed(1)},${yy(p.close).toFixed(1)}`);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: `hl-spark ${cls}`, preserveAspectRatio: "none" });
  svg.appendChild(el("polygon", {
    points: `${xx(0).toFixed(1)},${H - pad} ${pts.join(" ")} ${xx(series.length - 1).toFixed(1)},${H - pad}`,
    class: "hl-spark-area",
  }));
  svg.appendChild(el("polyline", { points: pts.join(" "), class: "hl-spark-line" }));

  const fmtN = n => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const period = `${fmtDate(series[0].date)} → ${fmtDate(series[series.length - 1].date)}`;
  card.innerHTML = `
    <div class="hl-trend-head">
      <a class="hl-trend-sym" href="${esc(chartUrl(symbol))}" target="_blank" rel="noopener">${esc(symbol)}</a>
      ${name ? `<span class="hl-trend-name">${esc(name)}</span>` : ""}
    </div>
    <div class="hl-trend-num">
      <span class="hl-trend-last">${fmtN(last)}</span>
      <span class="hl-trend-chg ${cls}">${sign}${chg.toFixed(2)}%</span>
    </div>`;
  const chart = document.createElement("div");
  chart.className = "hl-trend-chart";
  chart.appendChild(svg);
  card.appendChild(chart);
  const foot = document.createElement("div");
  foot.className = "hl-trend-period";
  foot.textContent = period;
  card.appendChild(foot);
  return card;
}

export function mountHighlight(opts) {
  const { root, renderDetail } = opts;
  let range = "6mo";
  let selectedId = null;

  root.innerHTML = `
    <div class="hl-bar">
      <label class="hl-ctl">選新聞
        <span class="rv-sel-wrap"><select class="rv-select" data-role="hl-news"></select></span>
      </label>
      <label class="hl-ctl">區間
        <span class="rv-sel-wrap"><select class="rv-select" data-role="hl-range"></select></span>
      </label>
      <button class="hl-btn" data-role="hl-update" title="更新所有收藏新聞的相關個股股價">↻ 更新全部股價</button>
      <button class="hl-btn hl-btn-ghost" data-role="hl-remove" title="從重點移除">移除此則</button>
      <span class="hl-status" data-role="hl-status"></span>
    </div>
    <div class="hl-body" data-role="hl-body"></div>`;

  const newsSel  = root.querySelector('[data-role="hl-news"]');
  const rangeSel = root.querySelector('[data-role="hl-range"]');
  const updateBtn= root.querySelector('[data-role="hl-update"]');
  const removeBtn= root.querySelector('[data-role="hl-remove"]');
  const statusEl = root.querySelector('[data-role="hl-status"]');
  const bodyEl   = root.querySelector('[data-role="hl-body"]');

  rangeSel.innerHTML = RANGES.map(r => `<option value="${r.v}">${r.label}</option>`).join("");
  rangeSel.value = range;

  function setStatus(msg, kind = "") { statusEl.textContent = msg || ""; statusEl.className = `hl-status ${kind}`; }

  function collected() { return getCollected(); }

  function tickersOf(it) { return (it && it.tickers) ? it.tickers : []; }

  function rebuildSelect() {
    const items = collected();
    if (!items.length) {
      newsSel.innerHTML = `<option value="">（尚未收藏任何新聞）</option>`;
      newsSel.disabled = true;
      selectedId = null;
      return;
    }
    newsSel.disabled = false;
    newsSel.innerHTML = items.map(it =>
      `<option value="${esc(it.id)}">${esc((fmtDate(it.date) || "").slice(0))} · ${esc(it.headline || it.id)}</option>`
    ).join("");
    if (!selectedId || !items.some(it => it.id === selectedId)) selectedId = items[0].id;
    newsSel.value = selectedId;
  }

  function currentItem() { return collected().find(it => it.id === selectedId) || null; }

  function renderBody() {
    const it = currentItem();
    if (!it) {
      bodyEl.innerHTML = `<div class="hl-empty">按左側新聞列上的 <span class="hl-bookmark-inline">🔖</span> 收藏按鈕，把重點新聞加進來，就會出現在這裡。</div>`;
      removeBtn.disabled = true; updateBtn.disabled = true;
      return;
    }
    removeBtn.disabled = false; updateBtn.disabled = false;

    const cache = readPriceCache();
    const syms = tickersOf(it);
    const trendsWrap = syms.length
      ? `<div class="hl-trends-head">股價走勢 <span class="hl-muted">(${esc(range)})</span></div><div class="hl-trends" data-role="hl-trends"></div>`
      : `<div class="hl-trends-head hl-muted">此新聞未標註相關股票</div>`;

    bodyEl.innerHTML = `
      <div class="hl-card">${renderDetail(it)}</div>
      <div class="hl-trends-wrap">${trendsWrap}</div>`;

    const host = bodyEl.querySelector('[data-role="hl-trends"]');
    if (host) {
      syms.forEach(sym => {
        const c = cache[sym];
        // Only reuse a cached series if it was fetched for the current range;
        // otherwise show the empty state prompting an update.
        const entry = (c && c.range === range) ? c : null;
        host.appendChild(trendCard(sym, entry));
      });
    }
  }

  // Every unique ticker across ALL collected news items.
  function allSymbols() {
    const set = new Set();
    collected().forEach(it => tickersOf(it).forEach(s => { if (s) set.add(s); }));
    return [...set];
  }

  // One press refreshes the price series for every collected news item's stocks
  // (not just the currently-selected one). Symbols are fetched in chunks of 25
  // (the worker's per-request cap) and merged into the cache.
  async function updatePrices() {
    const syms = allSymbols();
    if (!syms.length) { setStatus("收藏的新聞都沒有相關股票代號", "warn"); return; }
    updateBtn.disabled = true;
    setStatus(`更新中… (${syms.length} 檔)`);
    try {
      const cache = readPriceCache();
      const now = Date.now();
      let n = 0;
      const CHUNK = 25;
      for (let i = 0; i < syms.length; i += CHUNK) {
        const batch = syms.slice(i, i + CHUNK);
        const data = await fetchSeries(batch, range);
        for (const sym of batch) {
          const d = data[sym];
          if (d && Array.isArray(d.series) && d.series.length) {
            cache[sym] = { ...d, range, fetched_at: now };
            n++;
          }
        }
        writePriceCache(cache);              // persist progress after each chunk
        setStatus(`更新中… ${Math.min(i + CHUNK, syms.length)}/${syms.length}`);
      }
      renderBody();
      setStatus(n ? `已更新 ${n}/${syms.length} 檔 · ${new Date(now).toLocaleTimeString("en-GB")}`
                  : "查無股價資料（來源可能暫時無回應）", n ? "ok" : "warn");
    } catch (e) {
      setStatus("更新失敗：" + e.message + "（需已部署 price worker /chart）", "err");
    } finally {
      updateBtn.disabled = false;
    }
  }

  newsSel.addEventListener("change", () => { selectedId = newsSel.value; renderBody(); });
  rangeSel.addEventListener("change", () => { range = rangeSel.value; renderBody(); });
  updateBtn.addEventListener("click", updatePrices);
  removeBtn.addEventListener("click", () => {
    const it = currentItem();
    if (!it) return;
    removeCollected(it.id);
  });

  function refresh() { rebuildSelect(); renderBody(); }

  onCollectChange(() => { refresh(); });
  refresh();

  // Programmatically focus a freshly-collected item.
  function focusItem(id) { if (getCollected().some(x => x.id === id)) { selectedId = id; rebuildSelect(); newsSel.value = id; renderBody(); } }
  return { refresh, focusItem };
}
