// reports.js — shared data + timeline rendering for the report pages
// (supply-chain news, earnings calls). Read-only, public Firestore access.

import { firebaseConfig } from "./config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, getDocs, getDoc, query, orderBy, doc, setDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let _app = null, _db = null, _auth = null;
// Reuse an already-initialized app (collect.js / app.js may init first) to
// avoid a "duplicate app" throw.
function app() { if (!_app) _app = getApps().length ? getApp() : initializeApp(firebaseConfig); return _app; }
// Firestore with IndexedDB offline persistence — repeat reads are served from
// the local cache and don't count against the daily read quota until the data
// changes. Falls back to a plain instance if the app was already initialized
// on this page or persistence is unavailable.
function db() {
  if (!_db) {
    try {
      _db = initializeFirestore(app(), {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      _db = getFirestore(app());
    }
  }
  return _db;
}
function auth() { if (!_auth) _auth = getAuth(app()); return _auth; }

// ─── Auth (Google sign-in + whitelist check) ───────────────────────────
export function onAuth(cb) {
  return onAuthStateChanged(auth(), async user => {
    if (!user) { cb({ user: null, isAdmin: false }); return; }
    let isAdmin = false;
    try {
      const snap = await getDoc(doc(db(), "config", "auth"));
      isAdmin = snap.exists() && (snap.data().allowed_emails || []).includes(user.email);
    } catch { /* not whitelisted / read denied */ }
    cb({ user, isAdmin });
  });
}
export function signInGoogle() { return signInWithPopup(auth(), new GoogleAuthProvider()); }
export function signOutUser() { return signOut(auth()); }

// ─── Writes (whitelisted users only; enforced by Firestore rules) ──────
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
function normSent(v) { v = (v || "neutral").toLowerCase(); return ["bullish", "bearish", "neutral"].includes(v) ? v : "neutral"; }

// Accepts {calls:[...]}, a bare array, or a single call object.
export function parseCalls(input) {
  let data = typeof input === "string" ? JSON.parse(input) : input;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.calls)) return data.calls;
  if (data && data.ticker) return [data];
  throw new Error('格式需為 {"calls":[...]}、陣列、或單一 call 物件');
}

// Delete a document (whitelisted users only; enforced by Firestore rules).
export async function deleteReport(collectionName, id) {
  return deleteDoc(doc(db(), collectionName, id));
}

export async function saveEarnings(calls) {
  const now = new Date().toISOString();
  let n = 0;
  for (const c of calls) {
    if (!c.ticker || !c.year || !c.quarter) throw new Error(`每筆需含 ticker/year/quarter：${JSON.stringify(c).slice(0, 80)}`);
    const id = `${slug(c.ticker)}-${c.year}-${slug(c.quarter)}`;
    const highlights = (c.highlights || [])
      .filter(h => h && h.text)
      .map(h => ({ text: String(h.text), sentiment: normSent(h.sentiment) }));
    // future watch points — accept an array of strings, or a single string; "" / missing = none
    const watch = Array.isArray(c.watch)
      ? c.watch.filter(w => w != null && String(w).trim()).map(w => String(w))
      : (c.watch ? [String(c.watch)] : []);
    await setDoc(doc(db(), "earnings_calls", id), {
      ticker: String(c.ticker),
      company: c.company || c.ticker,
      year: parseInt(c.year, 10),
      quarter: String(c.quarter),
      date: c.date || "",
      summary: c.summary || "",
      highlights,
      watch,
      updated_at: now,
    }, { merge: true });
    n++;
  }
  return n;
}

// Patch a single earnings call in place (whitelisted users only; enforced by
// Firestore rules). Used by the inline card editor to add / remove / re-classify
// highlight nodes and future-watch points without re-pasting the whole JSON.
// `patch` may carry summary (string), highlights ([{text,sentiment}]) and/or
// watch ([string]); only the provided keys are written.
export async function updateEarningsCall(id, patch = {}) {
  if (!id) throw new Error("缺少會議 id");
  const out = { updated_at: new Date().toISOString() };
  if ("summary" in patch) out.summary = String(patch.summary || "");
  if ("highlights" in patch) {
    out.highlights = (patch.highlights || [])
      .filter(h => h && String(h.text).trim())
      .map(h => ({ text: String(h.text).trim(), sentiment: normSent(h.sentiment) }));
  }
  if ("watch" in patch) {
    out.watch = (patch.watch || [])
      .filter(w => w != null && String(w).trim())
      .map(w => String(w).trim());
  }
  await setDoc(doc(db(), "earnings_calls", id), out, { merge: true });
}

// ─── Annual reports ────────────────────────────────────────────────────
// Accepts {reports:[...]}, a bare array, or a single annual-report object
// (the annual_report_summary schema, detected by schema_version/document/company).
export function parseAnnualReports(input) {
  let data = typeof input === "string" ? JSON.parse(input) : input;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.reports)) return data.reports;
  if (data && (data.schema_version || data.document || data.company)) return [data];
  throw new Error('格式需為 {"reports":[...]}、陣列、或單一年報 JSON 物件');
}

const STANCES = ["bullish", "slightly_bullish", "neutral", "slightly_bearish", "bearish"];
function normStance(v) { v = (v || "neutral").toLowerCase(); return STANCES.includes(v) ? v : "neutral"; }

// Save one-or-more annual reports. Each doc keeps the full schema object plus
// a few flattened index fields (prefixed `_`) used for grouping / ordering /
// filtering, so rendering can read the rich nested data straight back.
export async function saveAnnualReports(reports) {
  const now = new Date().toISOString();
  let n = 0;
  for (const r of reports) {
    const company = r.company || {};
    const document = r.document || {};
    const headline = r.headline || {};
    const ticker = (company.ticker || "").toString().trim();
    const name = (company.name || company.name_english || "").toString().trim();
    const year = (document.fiscal_year || r.fiscal_year || "").toString().trim();
    if (!name && !ticker) throw new Error(`每筆需含 company.name 或 company.ticker：${JSON.stringify(r).slice(0, 80)}`);
    if (!year) throw new Error(`每筆需含 document.fiscal_year：${name || ticker}`);
    const key = ticker || name;
    const id = `${slug(key)}-${slug(year)}`;
    const date = document.filing_date || document.fiscal_period_end || `${year}-12-31`;
    await setDoc(doc(db(), "annual_reports", id), {
      _ticker: ticker || null,
      _company: name || ticker,
      _company_en: company.name_english || null,
      _year: year,
      _market: document.market || null,
      _industry: company.industry || null,
      _stance: normStance(headline.stance),
      _date: date,
      updated_at: now,
      data: r,
    }, { merge: false });
    n++;
  }
  return n;
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

// Ticker filter as a <select> (scales better than chips when there are many).
export function renderTickerFilter(container, tickers, onChange) {
  const opts = ['<option value="__all__">全部</option>',
    ...tickers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`)].join("");
  container.innerHTML = `<label class="rp-filter-label">篩選 ticker
    <span class="rp-select-wrap"><select class="rp-select">${opts}</select></span></label>`;
  container.querySelector("select").addEventListener("change", e => onChange(e.target.value));
}

// TradingView chart URL for a symbol (mirrors js/render.js tradingViewUrl).
export function chartUrl(symbol) {
  const s = String(symbol || "").trim();
  if (!s) return "";
  if (s.endsWith(".TWO")) return `https://www.tradingview.com/chart/?symbol=TPEX:${s.slice(0, -4)}`;
  if (s.endsWith(".TW")) return `https://www.tradingview.com/chart/?symbol=TWSE:${s.slice(0, -3)}`;
  if (s.endsWith(".KQ")) return `https://www.tradingview.com/chart/?symbol=KRX:${s.slice(0, -3)}`;
  if (s.endsWith(".KS")) return `https://www.tradingview.com/chart/?symbol=KRX:${s.slice(0, -3)}`;
  if (s.endsWith(".T")) return `https://www.tradingview.com/chart/?symbol=TSE:${s.slice(0, -2)}`;
  if (s.endsWith(".SS")) return `https://www.tradingview.com/chart/?symbol=SSE:${s.slice(0, -3)}`;
  if (s.endsWith(".SZ")) return `https://www.tradingview.com/chart/?symbol=SZSE:${s.slice(0, -3)}`;
  if (s.endsWith(".HK")) return `https://www.tradingview.com/chart/?symbol=HKEX:${s.slice(0, -3)}`;
  const eu = s.match(/^(.+)\.(AS|PA|DE|MI|MC|L|ST|CO|HE|OL|VX|BR|LS|IR)$/);
  if (eu) {
    const ex = { AS: "EURONEXT", PA: "EURONEXT", DE: "XETR", MI: "MIL", MC: "BME", L: "LSE",
      ST: "OMX", CO: "OMX", HE: "OMX", OL: "OSL", VX: "SIX", BR: "EURONEXT", LS: "EURONEXT", IR: "EURONEXT" }[eu[2]];
    if (ex) return `https://www.tradingview.com/chart/?symbol=${ex}:${eu[1]}`;
  }
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s)}`;
}

// ─── Ticker trend table (read-only snapshot of the `prices` collection) ────
// A watchlist-style table of the tickers attached to a news / earnings item.
// Values are whatever Firestore currently holds — a one-off snapshot at view
// time; nothing here fetches or writes. Load the map once per page via
// loadPricesMap() (before mounting), then tickerTrendCard() reads it in-sync.
let _pricesMap = null;
export async function loadPricesMap() {
  if (_pricesMap) return _pricesMap;
  const map = {};
  try {
    const snap = await getDocs(collection(db(), "prices"));
    snap.docs.forEach(d => { map[d.id] = d.data(); });
  } catch { /* leave empty — cells fall back to N/A */ }
  _pricesMap = map;
  return map;
}
export function getPricesMapSync() { return _pricesMap || {}; }

// Manual company-name overrides (ticker_overrides/{symbol}.name). Loaded once
// per page; admins can edit inline and it's written straight back to Firestore.
let _overrides = null;
export async function loadOverridesMap() {
  if (_overrides) return _overrides;
  const map = {};
  try {
    const snap = await getDocs(collection(db(), "ticker_overrides"));
    snap.docs.forEach(d => { const n = d.data() && d.data().name; if (n) map[d.id] = String(n); });
  } catch { /* collection may not exist yet — leave empty */ }
  _overrides = map;
  return map;
}
function _displayName(sym, p) {
  return (_overrides && _overrides[sym]) || (p && p.name) || "";
}

let _ttAdmin = false;
export function setTickerAdmin(v) { _ttAdmin = !!v; }

// Write (or clear, when blank) a name override. Requires a whitelisted admin;
// Firestore rules enforce it.
export async function saveTickerName(symbol, name) {
  const sym = String(symbol || "").trim();
  if (!sym) return;
  const ref = doc(db(), "ticker_overrides", sym);
  const clean = String(name || "").trim();
  if (!clean) { await deleteDoc(ref); if (_overrides) delete _overrides[sym]; return; }
  await setDoc(ref, { name: clean, updated_at: new Date().toISOString() }, { merge: true });
  (_overrides = _overrides || {})[sym] = clean;
}

// Inline-edit wiring for the name cell — attached once, delegated on document
// so it survives the detail panel being re-rendered on every item click.
let _ttWired = false;
function ensureTtEditWiring() {
  if (_ttWired) return;
  _ttWired = true;
  document.addEventListener("click", async e => {
    const editBtn = e.target.closest("[data-tt-edit]");
    if (editBtn) {
      const wrap = editBtn.closest(".tt-namewrap");
      if (!wrap || wrap.querySelector(".tt-name-input")) return;
      const sym = wrap.dataset.sym;
      const cur = wrap.dataset.name || "";
      wrap.innerHTML =
        `<input class="tt-name-input" type="text" value="${esc(cur)}" maxlength="80" aria-label="公司名稱">` +
        `<button class="tt-editbtn tt-save" data-tt-save="${esc(sym)}" title="儲存">✓</button>` +
        `<button class="tt-editbtn tt-cancel" data-tt-cancel="${esc(sym)}" title="取消">✕</button>`;
      wrap.querySelector(".tt-name-input").focus();
      return;
    }
    const cancelBtn = e.target.closest("[data-tt-cancel]");
    if (cancelBtn) {
      const wrap = cancelBtn.closest(".tt-namewrap");
      if (wrap) _paintNameWrap(wrap, wrap.dataset.name);
      return;
    }
    const saveBtn = e.target.closest("[data-tt-save]");
    if (saveBtn) {
      const wrap = saveBtn.closest(".tt-namewrap");
      if (!wrap) return;
      const sym = wrap.dataset.sym;
      const input = wrap.querySelector(".tt-name-input");
      const val = input ? input.value.trim() : "";
      saveBtn.disabled = true; saveBtn.textContent = "…";
      try {
        await saveTickerName(sym, val);
        wrap.dataset.name = val;
        _paintNameWrap(wrap, val);
      } catch (err) {
        saveBtn.disabled = false; saveBtn.textContent = "✓";
        window.alert("儲存失敗：" + (err && err.code === "permission-denied" ? "需以白名單管理員登入。" : (err && err.message) || err));
      }
    }
  });
  // Enter = save, Esc = cancel inside the inline input
  document.addEventListener("keydown", e => {
    if (!e.target.classList || !e.target.classList.contains("tt-name-input")) return;
    const wrap = e.target.closest(".tt-namewrap");
    if (!wrap) return;
    if (e.key === "Enter") { e.preventDefault(); wrap.querySelector("[data-tt-save]")?.click(); }
    else if (e.key === "Escape") { e.preventDefault(); _paintNameWrap(wrap, wrap.dataset.name); }
  });
}
function _paintNameWrap(wrap, name) {
  const sym = wrap.dataset.sym;
  wrap.dataset.name = name || "";
  wrap.innerHTML =
    `<span class="tt-name">${name ? esc(name) : '<i class="tt-noname">未命名</i>'}</span>` +
    (_ttAdmin ? `<button class="tt-editbtn tt-edit" data-tt-edit="${esc(sym)}" title="修正名稱">✎</button>` : "");
}

function _pct(v) {
  if (v == null || v === "" || isNaN(v)) return `<td class="tt-num tt-na">N/A</td>`;
  const n = Number(v);
  const cls = n > 0 ? "pos" : n < 0 ? "neg" : "neu";
  return `<td class="tt-num ${cls}">${(n >= 0 ? "+" : "") + n.toFixed(2)}%</td>`;
}
function _mktCap(p) {
  if (!p || p.market_cap == null || p.market_cap === "") return `<td class="tt-num tt-na">N/A</td>`;
  const cur = p.market_cap_currency ? ` ${esc(p.market_cap_currency)}` : "";
  return `<td class="tt-num">${esc(String(p.market_cap))}${esc(p.market_cap_suffix || "")}${cur}</td>`;
}
// Last traded price (from the watchlist prices snapshot). Uses the market-cap
// currency as the price currency (Yahoo reports them in the same currency).
function _price(p) {
  if (!p || p.last == null || p.last === "" || isNaN(p.last)) return `<td class="tt-num tt-na">N/A</td>`;
  const n = Number(p.last);
  const num = n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = p.market_cap_currency ? `<span class="tt-cur">${esc(p.market_cap_currency)}</span>` : "";
  return `<td class="tt-num tt-price">${num}${cur}</td>`;
}
// Render the snapshot table. `symbols` = the item's ticker list (or [ticker]).
export function tickerTrendCard(symbols, title = "相關個股近期表現") {
  const syms = [...new Set((symbols || []).map(s => String(s || "").trim()).filter(Boolean))];
  if (!syms.length) return "";
  ensureTtEditWiring();
  const prices = getPricesMapSync();
  const nameCellFor = (sym, p) => {
    const nm = _displayName(sym, p);
    const editBtn = _ttAdmin ? `<button class="tt-editbtn tt-edit" data-tt-edit="${esc(sym)}" title="修正名稱">✎</button>` : "";
    const nameWrap = (p || _ttAdmin)
      ? `<span class="tt-namewrap" data-sym="${esc(sym)}" data-name="${esc(nm)}"><span class="tt-name">${nm ? esc(nm) : '<i class="tt-noname">未命名</i>'}</span>${editBtn}</span>`
      : "";
    return `<td class="tt-sym"><a href="${esc(chartUrl(sym))}" target="_blank" rel="noopener">${esc(sym)}</a>${nameWrap}</td>`;
  };
  const rows = syms.map(sym => {
    const p = prices[sym];
    const nameCell = nameCellFor(sym, p);
    if (!p) return `<tr>${nameCell}<td class="tt-num tt-na" colspan="8">N/A（watchlist 無此代號價格）</td></tr>`;
    const pe = (p.pe_ratio == null || p.pe_ratio === "" || isNaN(p.pe_ratio) || Number(p.pe_ratio) === 0)
      ? `<td class="tt-num tt-na">N/A</td>` : `<td class="tt-num">${Number(p.pe_ratio).toFixed(2)}</td>`;
    return `<tr>${nameCell}${_price(p)}${_pct(p.day_change_pct)}${_pct(p.week_change_pct)}${_pct(p.month_change_pct)}${_pct(p.quarter_change_pct)}${_pct(p.year_change_pct)}${pe}${_mktCap(p)}</tr>`;
  }).join("");
  return `<div class="rp-subcard tt-card">
    <div class="rp-subcard-head">📈 ${esc(title)}<span class="tt-note">· 擷取當下 watchlist 行情，不隨新聞更新</span></div>
    <div class="tt-wrap"><table class="tt-table">
      <thead><tr><th>Ticker</th><th>股價</th><th>日</th><th>週</th><th>月</th><th>季</th><th>年</th><th>PE</th><th>Market Cap</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
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
