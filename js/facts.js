// facts.js — the shared "tracked facts" store.
//
// A tracked fact is an investment assumption lifted from an earnings call
// (a highlight 事實 or a future watch point 未來看點) that the user wants to
// follow over time, recording progress updates until it is verified or
// invalidated.
//
// Source of truth is Firestore (collection `tracked_facts`, public read /
// whitelist write), so the tracked list is IDENTICAL on every device and for
// every account. A localStorage mirror gives an instant first paint and keeps
// local-only items (created while signed out) until a whitelisted user is
// signed in, at which point they are pushed up automatically.
//
// The public API is synchronous (reads hit the in-memory cache); writes update
// the cache optimistically, broadcast a change event, and sync to Firestore in
// the background. A live onSnapshot keeps the cache authoritative.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const COLL = "tracked_facts";
const KEY  = "sc_tracked_facts_v1";   // localStorage mirror
const EVT  = "sc-facts-change";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  db = getFirestore(app);
}

// ─── Status model ────────────────────────────────────────────────────────
// One lifecycle field `state`. The four "open" states roll up to 追蹤中; the
// stat cards on the page derive their counts from these.
export const STATES = {
  pending:     { label: "待驗證", cls: "pending",  open: true  },
  not_started: { label: "尚未開始", cls: "notstart", open: true  },
  on_track:    { label: "進展符合", cls: "ontrack",  open: true  },
  behind:      { label: "落後預期", cls: "behind",   open: true  },
  verified:    { label: "已驗證", cls: "verified",  open: false },
  invalidated: { label: "已失效", cls: "invalid",   open: false },
};
export const STATE_ORDER = ["pending", "not_started", "on_track", "behind", "verified", "invalidated"];
export function stateInfo(s) { return STATES[s] || STATES.pending; }
export function isOpenState(s) { return stateInfo(s).open; }

export const CONFIDENCE = {
  high:   { label: "高", cls: "high" },
  medium: { label: "中", cls: "medium" },
  low:    { label: "低", cls: "low" },
};
export function confInfo(c) { return CONFIDENCE[c] || CONFIDENCE.medium; }

// ─── ids ───────────────────────────────────────────────────────────────
function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
// Stable 32-bit hash so the SAME highlight always maps to the same doc id —
// bookmarking then un-bookmarking toggles one row instead of piling up dupes.
function hash(str) {
  let h = 5381;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export function factId(ticker, kind, text) {
  return `${slug(ticker) || "x"}-${kind === "watch" ? "w" : "f"}-${hash(text)}`;
}
function docId(id) { return String(id).replace(/\//g, "_").slice(0, 1500); }

// ─── localStorage mirror ────────────────────────────────────────────────
function readLocal() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeLocal(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* quota */ } }

let _cache = readLocal();       // array of fact objects
let _cloudIds = new Set();

function sortCache() {
  // Open items first, then by next_check ascending (soonest / overdue on top),
  // finally by most recently updated.
  const rank = f => (isOpenState(f.state) ? 0 : 1);
  _cache.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const na = a.next_check || "9999", nb = b.next_check || "9999";
    if (na !== nb) return na < nb ? -1 : 1;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
}
function broadcast() {
  writeLocal(_cache);
  window.dispatchEvent(new CustomEvent(EVT, { detail: { items: _cache } }));
}

// ─── Firestore write helpers ────────────────────────────────────────────
async function writeCloud(fact) {
  await setDoc(doc(db, COLL, docId(fact.id)), fact, { merge: true });
}
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
    cloud.push({ ...data, id: data.id || d.id });
    _cloudIds.add(data.id || d.id);
  });
  const localOnly = _cache.filter(it => !_cloudIds.has(it.id));
  _cache = [...cloud, ...localOnly];
  sortCache();
  broadcast();
  pushLocalOnly(localOnly);
}, err => { console.warn("facts sync failed:", err); });

// ─── Normalisation ──────────────────────────────────────────────────────
function nowISO() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

function normFact(f) {
  const state = STATES[f.state] ? f.state : "pending";
  return {
    id: f.id,
    ticker: String(f.ticker || "").trim(),
    company: String(f.company || "").trim(),
    title: String(f.title || "").trim(),
    thesis: String(f.thesis || "").trim(),
    kind: f.kind === "watch" ? "watch" : "fact",
    state,
    confidence: CONFIDENCE[f.confidence] ? f.confidence : "medium",
    source: f.source && typeof f.source === "object" ? {
      // `origin` distinguishes where a tracked fact was collected from:
      // "earnings" (default, from a 法說會 highlight) or "intel" (from the
      // 產業情報站). `label`/`url` carry the intel provenance so the fact page
      // can show the right back-link instead of always pointing at 財報分析.
      origin: String(f.source.origin || ""),
      quarter: String(f.source.quarter || ""),
      label: String(f.source.label || ""),
      url: String(f.source.url || ""),
      note_id: String(f.source.note_id || ""),
      date: String(f.source.date || ""),
      sentiment: String(f.source.sentiment || ""),
    } : null,
    checklist: Array.isArray(f.checklist)
      ? f.checklist.filter(c => c && c.text).map(c => ({ text: String(c.text), done: !!c.done }))
      : [],
    updates: Array.isArray(f.updates)
      ? f.updates.filter(u => u && (u.text || u.state)).map(u => ({
          at: u.at || nowISO(),
          date: u.date || (u.at ? String(u.at).slice(0, 10) : today()),
          text: String(u.text || ""),
          state: STATES[u.state] ? u.state : null,
        }))
      : [],
    next_check: f.next_check ? String(f.next_check).slice(0, 10) : "",
    base_date: f.base_date ? String(f.base_date).slice(0, 10) : (f.source && f.source.date ? String(f.source.date).slice(0, 10) : today()),
    created_at: f.created_at || nowISO(),
    updated_at: nowISO(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────
export function getFacts() { return _cache.slice(); }
export function getFact(id) { return _cache.find(f => f.id === id) || null; }
export function getFactsByTicker(ticker) {
  const t = String(ticker || "").trim();
  return _cache.filter(f => f.ticker === t);
}
export function isFactTracked(id) { return _cache.some(f => f.id === id); }
export function hasFactsForTicker(ticker) {
  const t = String(ticker || "").trim();
  return !!t && _cache.some(f => f.ticker === t);
}

// Create or overwrite a fact from a seed object. Returns the stored fact.
export function saveFact(seed) {
  const existing = seed.id ? getFact(seed.id) : null;
  const merged = { ...(existing || {}), ...seed };
  if (!merged.id) merged.id = factId(merged.ticker, merged.kind, merged.title);
  if (existing) merged.created_at = existing.created_at;
  const fact = normFact(merged);
  _cache = [fact, ..._cache.filter(f => f.id !== fact.id)];
  sortCache();
  broadcast();
  writeCloud(fact).catch(e => console.warn("fact save failed:", e));
  return fact;
}

// Shallow patch of an existing fact (state, checklist, next_check, …).
export function patchFact(id, patch) {
  const cur = getFact(id);
  if (!cur) return null;
  return saveFact({ ...cur, ...patch, id });
}

export function removeFact(id) {
  _cache = _cache.filter(f => f.id !== id);
  broadcast();
  deleteDoc(doc(db, COLL, docId(id))).catch(e => console.warn("fact remove failed:", e));
  return _cache.slice();
}

// Append a progress update (and optionally advance the fact's state).
export function addUpdate(id, { text, date, state } = {}) {
  const cur = getFact(id);
  if (!cur) return null;
  const upd = {
    at: nowISO(),
    date: date || today(),
    text: String(text || ""),
    state: STATES[state] ? state : null,
  };
  const patch = { updates: [upd, ...(cur.updates || [])] };
  if (upd.state) patch.state = upd.state;
  return saveFact({ ...cur, ...patch, id });
}

export function removeUpdate(id, at) {
  const cur = getFact(id);
  if (!cur) return null;
  return saveFact({ ...cur, updates: (cur.updates || []).filter(u => u.at !== at), id });
}

// Toggle a bookmark from an earnings highlight / watch point. `seed` needs at
// least { ticker, kind, title }. Returns true if now tracked, false if removed.
export function toggleFactBookmark(seed) {
  if (!seed || !seed.title || !seed.ticker) return false;
  const id = factId(seed.ticker, seed.kind, seed.title);
  if (isFactTracked(id)) { removeFact(id); return false; }
  saveFact({ ...seed, id, state: "pending" });
  return true;
}

export function onFactsChange(cb) {
  const h = e => cb(e.detail ? e.detail.items : getFacts());
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
