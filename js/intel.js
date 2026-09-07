// intel.js — the shared "產業情報 / industry intel" store.
//
// An intel note is ONE unit of industry news / community intelligence the user
// manually gathers (from X, Reddit, Discord, newsletters, …) about one or more
// tickers. Unlike the earnings / supply-chain pages, there is NO JSON schema:
// the user fills in plain form fields, and each content bullet / future watch
// point can be bookmarked ("收藏") into the shared fact-tracking store
// (facts.js), exactly like an earnings-call highlight.
//
// Source of truth is Firestore (collection `intel_notes`, public read /
// whitelist write), so the list is IDENTICAL on every device and for every
// account. A localStorage mirror gives an instant first paint and keeps
// local-only notes (drafted while signed out) until a whitelisted user is
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

const COLL = "intel_notes";
const KEY  = "sc_intel_notes_v1";   // localStorage mirror
const EVT  = "sc-intel-change";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  db = getFirestore(app);
}

// ─── ids ─────────────────────────────────────────────────────────────────
function docId(id) { return String(id).replace(/\//g, "_").slice(0, 1500); }
function rand() { return Math.random().toString(36).slice(2, 8); }
export function newNoteId() { return `intel-${Date.now().toString(36)}-${rand()}`; }
export function newBulletId() { return `b-${Date.now().toString(36)}-${rand()}`; }

// ─── localStorage mirror ──────────────────────────────────────────────────
function readLocal() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeLocal(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* quota */ } }

let _cache = readLocal();       // array of note objects (newest first)
let _cloudIds = new Set();

function sortCache() {
  // Newest first — by the note's own date, then by creation time.
  _cache.sort((a, b) => {
    const da = String(a.date || ""), dbb = String(b.date || "");
    if (da !== dbb) return da < dbb ? 1 : -1;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}
function broadcast() {
  writeLocal(_cache);
  window.dispatchEvent(new CustomEvent(EVT, { detail: { items: _cache } }));
}

// ─── Firestore write helpers ──────────────────────────────────────────────
async function writeCloud(note) {
  await setDoc(doc(db, COLL, docId(note.id)), note, { merge: true });
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

// ─── Live sync ────────────────────────────────────────────────────────────
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
}, err => { console.warn("intel sync failed:", err); });

// ─── Normalisation ────────────────────────────────────────────────────────
function nowISO() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

// Uppercase, trim, de-dupe a ticker list; keep original order.
export function normTickers(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : String(list || "").split(/[,\s]+/))
    .map(s => String(s || "").trim().toUpperCase())
    .filter(Boolean)
    .forEach(s => { if (!seen.has(s)) { seen.add(s); out.push(s); } });
  return out;
}

function normBullets(list) {
  return (Array.isArray(list) ? list : [])
    .map(b => (typeof b === "string" ? { text: b } : b))
    .filter(b => b && String(b.text || "").trim())
    .map(b => ({ id: b.id || newBulletId(), text: String(b.text).trim() }));
}

function normNote(n) {
  return {
    id: n.id || newNoteId(),
    tickers: normTickers(n.tickers),
    company: String(n.company || "").trim(),
    source: String(n.source || "").trim(),
    source_url: String(n.source_url || "").trim(),
    bullets: normBullets(n.bullets),
    notes_md: String(n.notes_md || ""),
    watch: (Array.isArray(n.watch) ? n.watch : [])
      .map(w => String(w || "").trim()).filter(Boolean),
    date: n.date ? String(n.date).slice(0, 10) : today(),
    created_at: n.created_at || nowISO(),
    updated_at: nowISO(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────
export function getNotes() { return _cache.slice(); }
export function getNote(id) { return _cache.find(n => n.id === id) || null; }
export function getNotesByTicker(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  return _cache.filter(n => (n.tickers || []).includes(t));
}

// Create or overwrite a note from a seed object. Returns the stored note.
export function saveNote(seed) {
  const existing = seed.id ? getNote(seed.id) : null;
  const merged = { ...(existing || {}), ...seed };
  if (existing) merged.created_at = existing.created_at;
  const note = normNote(merged);
  _cache = [note, ..._cache.filter(n => n.id !== note.id)];
  sortCache();
  broadcast();
  writeCloud(note).catch(e => console.warn("intel save failed:", e));
  return note;
}

export function removeNote(id) {
  _cache = _cache.filter(n => n.id !== id);
  broadcast();
  deleteDoc(doc(db, COLL, docId(id))).catch(e => console.warn("intel remove failed:", e));
  return _cache.slice();
}

// symbol → number of intel notes referencing it. Powers the 訊 count badge on
// the watchlist ticker cards. One note = one event / information unit.
export function getCountsByTicker() {
  const m = {};
  _cache.forEach(n => (n.tickers || []).forEach(t => { m[t] = (m[t] || 0) + 1; }));
  return m;
}
export function countForTicker(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  return _cache.reduce((acc, n) => acc + ((n.tickers || []).includes(t) ? 1 : 0), 0);
}

export function onIntelChange(cb) {
  const h = e => cb(e.detail ? e.detail.items : getNotes());
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
