// newsdata.js — Firestore layer shared by the two News pages:
//   · Military（collection: military_news）— military-dynamics-intelligence skill
//   · Industry（collection: industry_news）— industry-news-daily skill
//
// Both collections may not exist yet. Reads are defensive: a missing collection
// or a permission error resolves to an empty list instead of throwing, so the
// pages render an empty-but-complete layout. Whitelisted users publish through
// the per-page "ADD JSON" importer. To keep visitor reads cheap the pages first
// try a single-doc index at indexes/<collection>; otherwise they scan the
// collection directly. Reuses the site's shared Firebase app.
import { firebaseConfig } from "./config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = () => (getApps().length ? getApp() : initializeApp(firebaseConfig));
let _db = null;
const db = () => {
  if (!_db) {
    try {
      _db = initializeFirestore(app(), { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    } catch { _db = getFirestore(app()); }
  }
  return _db;
};

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

// A stored row may be the flattened `{ _date, data, … }` wrapper (like
// mil_defense_daily) or a bare event object. Normalize to the event itself,
// tagging the Firestore doc id as __id for admin delete.
export function toEvent(row) {
  const ev = row && row.data && typeof row.data === "object" ? row.data : row;
  return { __id: row && row.id != null ? row.id : null, ...ev };
}

// Read newest-first events for a news collection. Never throws — an absent
// collection, missing index, or denied read all resolve to [].
export async function loadNews(col, { dateField = "_date", max = 500 } = {}) {
  try {
    const snap = await getDoc(doc(db(), "indexes", col));
    if (snap.exists()) {
      const ev = snap.data().events;
      if (Array.isArray(ev)) return ev.slice(0, max).map(toEvent);
    }
  } catch { /* index missing / read denied → fall through to a live scan */ }
  try {
    let docs;
    try {
      docs = (await getDocs(query(collection(db(), col), orderBy(dateField, "desc"), limit(max)))).docs;
    } catch {
      docs = (await getDocs(collection(db(), col))).docs;
    }
    const rows = docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => String(b[dateField] || "").localeCompare(String(a[dateField] || "")));
    return rows.slice(0, max).map(toEvent);
  } catch { return []; }
}

// ── Admin importer ──────────────────────────────────────────────────────
// Accept {run,events:[…]}（military）、{events:[…],event_count}（industry）、a bare
// array, or a single event object.
export function parseNewsRun(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (Array.isArray(data)) return { events: data, run: null };
  if (data && Array.isArray(data.events)) return { events: data.events, run: data.run || null };
  if (data && (data.event_id || data.title || data.title_zh)) return { events: [data], run: null };
  throw new Error('格式需為 {"events":[…]}、陣列、或單一 event 物件');
}

// Persist events to `col`, keyed by event_id (falls back to a derived slug).
// `dateOf` extracts the sortable index date for each event.
export async function saveNews(col, events, dateOf) {
  const now = new Date().toISOString();
  let n = 0;
  for (const e of events) {
    if (!e.title && !e.title_zh) throw new Error(`每筆需含 title / title_zh：${JSON.stringify(e).slice(0, 80)}`);
    const idBase = e.event_id || e.slug || `${e.country || e.industry || "xx"}_${dateOf(e) || "nodate"}_${(e.title || e.title_zh || "").slice(0, 24)}`;
    await setDoc(doc(db(), col, slug(idBase)), {
      _date: dateOf(e) || "",
      updated_at: now,
      data: e,
    }, { merge: false });
    n++;
  }
  return n;
}

export const deleteNews = (col, id) => deleteDoc(doc(db(), col, id));

// Rebuild the single-doc visitor index for a news collection (newest `max`).
export async function rebuildNewsIndex(col, dateField = "_date", max = 250) {
  let docs;
  try {
    docs = (await getDocs(query(collection(db(), col), orderBy(dateField, "desc"), limit(max + 50)))).docs;
  } catch {
    docs = (await getDocs(collection(db(), col))).docs;
  }
  const rows = docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => String(b[dateField] || "").localeCompare(String(a[dateField] || "")));
  const events = rows.slice(0, max);
  try {
    await setDoc(doc(db(), "indexes", col), { updated_at: new Date().toISOString(), count: events.length, events }, { merge: false });
  } catch { /* 權限不足時忽略 */ }
  return events.map(toEvent);
}
