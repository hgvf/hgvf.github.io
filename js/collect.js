// collect.js — the shared "collected highlight news" store.
//
// Source of truth is Firestore (collection `highlight_collected`, public read /
// whitelist write), so the curated 重點新聞 list is IDENTICAL on every device and
// for every account — it is not per-browser and not per-login. A localStorage
// mirror gives an instant first paint and preserves older, local-only
// collections; when a whitelisted user is signed in, those local-only items are
// pushed up to the cloud automatically so nothing is lost.
//
// The public API stays synchronous (reads hit the in-memory cache); writes
// update the cache optimistically, broadcast a change event, and sync to
// Firestore in the background. A live onSnapshot keeps the cache authoritative.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const COLL = "highlight_collected";
const KEY  = "sc_collected_news_v1";   // localStorage mirror (also legacy source)
const EVT  = "sc-collect-change";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
// Firestore with IndexedDB offline persistence (repeat reads served from local
// cache, no quota cost until data changes); plain instance if already
// initialized on this page or persistence unavailable.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  db = getFirestore(app);
}

// ─── localStorage mirror ────────────────────────────────────────────────
function readLocal() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeLocal(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* quota */ } }

let _cache = readLocal();              // array of item snapshots (newest first)
let _cloudIds = new Set();             // ids currently present in the cloud

function docId(id) { return String(id).replace(/\//g, "_").slice(0, 1500); }
function sortCache() { _cache.sort((a, b) => (b._collected_at || 0) - (a._collected_at || 0)); }
function broadcast() {
  writeLocal(_cache);
  window.dispatchEvent(new CustomEvent(EVT, { detail: { items: _cache } }));
}

// ─── Firestore write helpers ────────────────────────────────────────────
async function writeCloud(item) {
  await setDoc(doc(db, COLL, docId(item.id)), {
    item,
    source: item._source || "supply-chain",
    collected_at: item._collected_at || Date.now(),
    ...(Array.isArray(item._trend_tickers) ? { trend_tickers: item._trend_tickers } : {}),
  }, { merge: true });
}

// Best-effort upload of local-only items — succeeds only for whitelisted users;
// for everyone else the items simply stay in the local mirror.
let _pushing = false;
async function pushLocalOnly(items) {
  if (_pushing || !items.length) return;
  _pushing = true;
  for (const it of items) {
    try { await writeCloud(it); } catch { /* not whitelisted — keep local */ }
  }
  _pushing = false;
}

// ─── Live sync ──────────────────────────────────────────────────────────
onSnapshot(collection(db, COLL), snap => {
  const cloud = [];
  _cloudIds = new Set();
  snap.forEach(d => {
    const data = d.data() || {};
    const item = data.item || {};
    const id = item.id ?? d.id;
    cloud.push({
      ...item,
      id,
      _source: data.source || item._source || "supply-chain",
      _collected_at: data.collected_at || 0,
      ...(Array.isArray(data.trend_tickers) ? { _trend_tickers: data.trend_tickers } : {}),
    });
    _cloudIds.add(id);
  });
  // Preserve any local-only items (not yet in the cloud) so nothing disappears.
  const localOnly = _cache.filter(it => !_cloudIds.has(it.id));
  _cache = [...cloud, ...localOnly];
  sortCache();
  broadcast();
  pushLocalOnly(localOnly);
}, err => { console.warn("collect sync failed:", err); });

// ─── Public API ─────────────────────────────────────────────────────────
export function getCollected() { return _cache.slice(); }

export function isCollected(id) { return _cache.some(x => x.id === id); }

// Add (or refresh) an item's snapshot. `source` tags where it came from
// ("supply-chain" | "industry-news"). Returns the current collection.
export function addCollected(item, source) {
  if (!item || !item.id) return _cache.slice();
  const snap = { ...item, _source: source || item._source || "supply-chain", _collected_at: Date.now() };
  _cache = [snap, ..._cache.filter(x => x.id !== item.id)];
  sortCache();
  broadcast();
  writeCloud(snap).catch(e => console.warn("collect save failed:", e));
  return _cache.slice();
}

export function removeCollected(id) {
  _cache = _cache.filter(x => x.id !== id);
  broadcast();
  deleteDoc(doc(db, COLL, docId(id))).catch(e => console.warn("collect remove failed:", e));
  return _cache.slice();
}

// Toggle collection membership. Returns true if now collected, false if removed.
export function toggleCollected(item, source) {
  if (!item || !item.id) return false;
  if (isCollected(item.id)) { removeCollected(item.id); return false; }
  addCollected(item, source);
  return true;
}

export function onCollectChange(cb) {
  const h = e => cb(e.detail ? e.detail.items : getCollected());
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

// ─── Per-item trend-chart ticker override (right-side charts only) ──────
// Defaults to the item's own tickers until the user adds/removes one; an
// explicit empty list is respected. Stored on the same Firestore doc so the
// chart set is unified across devices too.
export function getTrendTickers(item) {
  const it = _cache.find(x => x.id === item.id) || item;
  return Array.isArray(it._trend_tickers)
    ? it._trend_tickers
    : (item.tickers ? [...item.tickers] : []);
}

export function setTrendTickers(id, arr) {
  const it = _cache.find(x => x.id === id);
  if (it) { it._trend_tickers = arr; broadcast(); }
  setDoc(doc(db, COLL, docId(id)), { trend_tickers: arr }, { merge: true })
    .catch(e => console.warn("trend save failed:", e));
}
