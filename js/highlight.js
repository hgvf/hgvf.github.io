// highlight.js — the lower "重點新聞 Highlight News" section of the supply-chain
// page. Lets the user pick a collected news item, shows its card (reusing the
// page's detail renderer) plus a stock-price trend per related ticker, with an
// "update price" button that (re)fetches the series from the price worker.

import { WORKER_URL } from "./config.js";
import { esc, fmtDate, chartUrl } from "./reports.js";
import { getCollected, removeCollected, onCollectChange, getTrendTickers, setTrendTickers } from "./collect.js";

const PRICE_KEY = "sc_price_series_v1";
const ALIAS_KEY = "sc_ticker_alias_v1";   // { originalSymbol: correctedSymbol }
const NS = "http://www.w3.org/2000/svg";
const RANGES = [
  { v: "1mo", label: "1 個月" },
  { v: "6mo", label: "6 個月" },
  { v: "1y",  label: "1 年" },
];

// Where a collected item came from (see collect.js `_source`). Used for the
// source filter + the badge shown on each highlight card.
const SOURCE_LABEL = {
  "supply-chain":  "供應鏈瓶頸",
  "industry-news": "產業消息",
};
function sourceOf(it) { return (it && it._source) || "supply-chain"; }
// Normalize the two schemas so the picker/card read one shape.
function dateOf(it) { return (it && (it.date || it.event_date)) || ""; }
function headlineOf(it) { return (it && (it.headline || it.title_zh || it.title_original || it.id)) || ""; }

function readPriceCache() {
  try { return JSON.parse(localStorage.getItem(PRICE_KEY) || "{}") || {}; }
  catch { return {}; }
}
function writePriceCache(obj) {
  try { localStorage.setItem(PRICE_KEY, JSON.stringify(obj)); } catch { /* quota */ }
}

// Ticker corrections keyed by the symbol as stored on the news item. A wrong
// ticker (e.g. AXT → AXTI) is fixed here without touching the source data, and
// the fix applies everywhere that symbol appears across collected news.
function readAlias() {
  try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || "{}") || {}; }
  catch { return {}; }
}
function writeAlias(obj) {
  try { localStorage.setItem(ALIAS_KEY, JSON.stringify(obj)); } catch { /* quota */ }
}
function aliasSym(orig) { const m = readAlias(); return (m[orig] || orig); }
function setAlias(orig, corrected) {
  const m = readAlias();
  const val = String(corrected || "").trim().toUpperCase();
  if (!val || val === orig) delete m[orig];   // no-op / reset clears the override
  else m[orig] = val;
  writeAlias(m);
}

// Per-item override of which tickers get a trend chart on the right. Affects
// ONLY the trend charts, never the news card's own tickers. Backed by the
// shared collect store (Firestore), so it is unified across devices too.
function trendSymbols(it) { return getTrendTickers(it); }
function addTrendSymbol(it, sym) {
  const v = String(sym || "").trim().toUpperCase();
  if (!v) return false;
  const list = trendSymbols(it);
  if (list.includes(v)) return false;
  setTrendTickers(it.id, [...list, v]);
  return true;
}
function removeTrendSymbol(it, sym) {
  setTrendTickers(it.id, trendSymbols(it).filter(s => s !== sym));
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

const PENCIL = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M14.06 6.19l3.75 3.75L8.5 19.25 4 20.5l1.25-4.5 8.81-9.81z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

// Header shared by both card states: the (effective) symbol + an edit pencil so
// a wrong ticker (e.g. AXT → AXTI) can be corrected on the site.
function headHTML(orig, eff, name) {
  return `<div class="hl-trend-head">
      <a class="hl-trend-sym" href="${esc(chartUrl(eff))}" target="_blank" rel="noopener">${esc(eff)}</a>
      <button class="hl-trend-edit" data-edit-ticker="${esc(orig)}" data-eff="${esc(eff)}" title="編輯股票代號" aria-label="編輯股票代號">${PENCIL}</button>
      ${name ? `<span class="hl-trend-name">${esc(name)}</span>` : ""}
      <button class="hl-trend-remove" data-remove-ticker="${esc(orig)}" title="從走勢圖移除此 ticker" aria-label="移除此 ticker">✕</button>
    </div>`;
}

// A compact price-trend chart card (image-2 style): symbol + last + change on
// top, a filled line chart below. `orig` is the ticker as stored on the news
// item; `eff` is the (possibly user-corrected) symbol actually charted.
function trendCard(orig, eff, entry) {
  const card = document.createElement("div");
  card.className = "hl-trend-card";
  card.dataset.orig = orig;
  const series = (entry && entry.series || []).filter(p => p && p.close != null);
  const name = entry && entry.name ? entry.name : "";

  if (series.length < 2) {
    card.classList.add("empty");
    card.innerHTML = `
      ${headHTML(orig, eff, name)}
      <div class="hl-trend-empty">尚無股價資料 — 按「更新全部股價」載入</div>`;
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
    ${headHTML(orig, eff, name)}
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
  // `renderDetail(item)` may dispatch on item._source (the consolidated
  // 重點新聞 page passes a renderer that picks the supply-chain vs 產業消息 card).
  const { root, renderDetail } = opts;
  let range = "6mo";
  let selectedId = null;
  let sourceFilter = "__all__";

  root.innerHTML = `
    <div class="hl-bar">
      <label class="hl-ctl">來源
        <span class="rv-sel-wrap"><select class="rv-select" data-role="hl-source"></select></span>
      </label>
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

  const sourceSel= root.querySelector('[data-role="hl-source"]');
  const newsSel  = root.querySelector('[data-role="hl-news"]');
  const rangeSel = root.querySelector('[data-role="hl-range"]');
  const updateBtn= root.querySelector('[data-role="hl-update"]');
  const removeBtn= root.querySelector('[data-role="hl-remove"]');
  const statusEl = root.querySelector('[data-role="hl-status"]');
  const bodyEl   = root.querySelector('[data-role="hl-body"]');

  rangeSel.innerHTML = RANGES.map(r => `<option value="${r.v}">${r.label}</option>`).join("");
  rangeSel.value = range;

  function setStatus(msg, kind = "") { statusEl.textContent = msg || ""; statusEl.className = `hl-status ${kind}`; }

  function allCollected() { return getCollected(); }
  function collected() {
    const items = getCollected();
    return sourceFilter === "__all__" ? items : items.filter(it => sourceOf(it) === sourceFilter);
  }

  // Rebuild the source filter, keeping "全部" plus whichever sources are present.
  function rebuildSourceSelect() {
    const present = [...new Set(getCollected().map(sourceOf))];
    const counts = {};
    getCollected().forEach(it => { const s = sourceOf(it); counts[s] = (counts[s] || 0) + 1; });
    const order = ["supply-chain", "industry-news", ...present.filter(s => !SOURCE_LABEL[s])];
    const opts = [`<option value="__all__">全部來源（${getCollected().length}）</option>`,
      ...order.filter(s => present.includes(s)).map(s =>
        `<option value="${esc(s)}">${esc(SOURCE_LABEL[s] || s)}（${counts[s] || 0}）</option>`)];
    sourceSel.innerHTML = opts.join("");
    if (![...sourceSel.options].some(o => o.value === sourceFilter)) sourceFilter = "__all__";
    sourceSel.value = sourceFilter;
  }

  // Original tickers as stored on the item, and the effective (corrected) ones.
  function tickersOf(it) { return (it && it.tickers) ? it.tickers : []; }
  function effTickersOf(it) { return tickersOf(it).map(aliasSym); }

  function rebuildSelect() {
    const items = collected();
    if (!items.length) {
      newsSel.innerHTML = `<option value="">（尚未收藏任何新聞）</option>`;
      newsSel.disabled = true;
      selectedId = null;
      return;
    }
    newsSel.disabled = false;
    newsSel.innerHTML = items.map(it => {
      const tag = sourceFilter === "__all__" ? `[${SOURCE_LABEL[sourceOf(it)] || sourceOf(it)}] ` : "";
      return `<option value="${esc(it.id)}">${esc(tag)}${esc((fmtDate(dateOf(it)) || "").slice(0))} · ${esc(headlineOf(it))}</option>`;
    }).join("");
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
    const syms = trendSymbols(it);   // per-item trend override (add/remove/edit)
    const trendsWrap = `
      <div class="hl-trends-head">股價走勢 <span class="hl-muted">(${esc(range)})</span></div>
      <div class="hl-trend-add">
        <input class="hl-trend-add-input" data-role="hl-add-input" type="text"
               placeholder="新增 ticker（如 TSLA、2330.TW）" spellcheck="false" autocapitalize="characters" aria-label="新增 ticker" />
        <button class="hl-trend-add-btn" data-role="hl-add-btn" title="加入走勢圖">＋ 新增</button>
      </div>
      <div class="hl-trends" data-role="hl-trends"></div>`;

    // Show corrected tickers in the news card's chips too. The card's own
    // tickers are NOT affected by trend add/remove — only the charts are.
    const cardItem = { ...it, tickers: effTickersOf(it) };
    const src = sourceOf(it);
    const srcBadge = `<div class="hl-source-badge hl-src-${esc(src)}">來源：${esc(SOURCE_LABEL[src] || src)}</div>`;
    bodyEl.innerHTML = `
      <div class="hl-card">${srcBadge}${renderDetail(cardItem)}</div>
      <div class="hl-trends-wrap">${trendsWrap}</div>`;

    const host = bodyEl.querySelector('[data-role="hl-trends"]');
    if (host) {
      if (!syms.length) {
        host.innerHTML = `<div class="hl-trend-empty hl-trend-none">此新聞沒有走勢圖 ticker，於上方輸入框新增。</div>`;
      } else {
        syms.forEach(orig => {
          const eff = aliasSym(orig);
          const c = cache[eff];
          // Only reuse a cached series if it was fetched for the current range;
          // otherwise show the empty state prompting an update.
          const entry = (c && c.range === range) ? c : null;
          host.appendChild(trendCard(orig, eff, entry));
        });
      }
    }
  }

  // Add a ticker to the current item's trend charts, then fetch its series so
  // the chart appears immediately.
  async function doAddTicker() {
    const it = currentItem();
    if (!it) return;
    const input = bodyEl.querySelector('[data-role="hl-add-input"]');
    const val = (input?.value || "").trim().toUpperCase();
    if (!val) return;
    if (!addTrendSymbol(it, val)) { setStatus(`${val} 已在走勢圖中`, "warn"); return; }
    renderBody();
    const eff = aliasSym(val);
    if (readPriceCache()[eff]?.range === range) { setStatus(`已新增 ${eff}`, "ok"); return; }
    setStatus(`載入 ${eff} …`);
    const ok = await fetchOneIntoCache(eff);
    renderBody();
    setStatus(ok ? `已新增 ${eff}` : `已新增 ${eff}（查無股價）`, ok ? "ok" : "warn");
  }

  // Every unique effective (corrected) ticker actually charted across ALL
  // collected news items (their per-item trend lists, every source).
  function allSymbols() {
    const set = new Set();
    allCollected().forEach(it => trendSymbols(it).map(aliasSym).forEach(s => { if (s) set.add(s); }));
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

  // Fetch one corrected symbol immediately so an edit shows its chart at once.
  async function fetchOneIntoCache(eff) {
    try {
      const data = await fetchSeries([eff], range);
      const d = data[eff];
      if (d && Array.isArray(d.series) && d.series.length) {
        const cache = readPriceCache();
        cache[eff] = { ...d, range, fetched_at: Date.now() };
        writePriceCache(cache);
        return true;
      }
    } catch { /* ignore — handled by status */ }
    return false;
  }

  // Turn a trend card's header into an inline ticker editor.
  function startEditTicker(card) {
    const orig = card.dataset.orig;
    const head = card.querySelector(".hl-trend-head");
    if (!orig || !head || head.querySelector(".hl-trend-edit-form")) return;
    const cur = aliasSym(orig);
    head.innerHTML = `<span class="hl-trend-edit-form">
        <input class="hl-trend-input" type="text" value="${esc(cur)}" spellcheck="false"
               autocapitalize="characters" aria-label="股票代號" />
        <button class="hl-trend-save" title="儲存">✓</button>
        <button class="hl-trend-cancel" title="取消">✕</button>
      </span>`;
    const input = head.querySelector(".hl-trend-input");
    input.focus(); input.select();
    const commit = async () => {
      const val = input.value.trim().toUpperCase();
      setAlias(orig, val);
      const eff = aliasSym(orig);
      renderBody();                                  // reflect the corrected symbol
      if (eff && !(readPriceCache()[eff]?.range === range)) {
        setStatus(`載入 ${eff} …`);
        const ok = await fetchOneIntoCache(eff);
        renderBody();
        setStatus(ok ? `已更新 ${eff}` : `查無 ${eff} 股價`, ok ? "ok" : "warn");
      }
    };
    head.querySelector(".hl-trend-save").addEventListener("click", commit);
    head.querySelector(".hl-trend-cancel").addEventListener("click", () => renderBody());
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); renderBody(); }
    });
  }

  bodyEl.addEventListener("click", e => {
    const edit = e.target.closest("[data-edit-ticker]");
    if (edit) { e.preventDefault(); startEditTicker(edit.closest(".hl-trend-card")); return; }
    const rm = e.target.closest("[data-remove-ticker]");
    if (rm) {
      e.preventDefault();
      const it = currentItem();
      if (it) { removeTrendSymbol(it, rm.dataset.removeTicker); renderBody(); setStatus(`已移除 ${rm.dataset.removeTicker}`, "ok"); }
      return;
    }
    if (e.target.closest('[data-role="hl-add-btn"]')) { e.preventDefault(); doAddTicker(); }
  });
  bodyEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.closest('[data-role="hl-add-input"]')) { e.preventDefault(); doAddTicker(); }
  });

  sourceSel.addEventListener("change", () => { sourceFilter = sourceSel.value; selectedId = null; rebuildSelect(); renderBody(); });
  newsSel.addEventListener("change", () => { selectedId = newsSel.value; renderBody(); });
  rangeSel.addEventListener("change", () => { range = rangeSel.value; renderBody(); });
  updateBtn.addEventListener("click", updatePrices);
  removeBtn.addEventListener("click", () => {
    const it = currentItem();
    if (!it) return;
    removeCollected(it.id);
  });

  function refresh() { rebuildSourceSelect(); rebuildSelect(); renderBody(); }

  onCollectChange(() => { refresh(); });
  refresh();

  // Programmatically focus a freshly-collected item (reset the source filter
  // so it is visible regardless of which source it came from).
  function focusItem(id) {
    if (!getCollected().some(x => x.id === id)) return;
    sourceFilter = "__all__"; selectedId = id;
    rebuildSourceSelect(); rebuildSelect(); newsSel.value = id; renderBody();
  }
  return { refresh, focusItem };
}
