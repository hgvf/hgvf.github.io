import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  writeBatch,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _db = null;

export function initDB(app) {
  _db = makeCachedDb(app);
  return _db;
}

// Firestore with IndexedDB offline persistence. Repeat reads (revisits, page
// switches, other tabs) are served from the local cache and do NOT count
// against the daily read quota until the data actually changes on the server.
// Falls back to a plain instance if the DB was already initialized on this
// page or persistence is unavailable (e.g. private-mode browsers).
export function makeCachedDb(app) {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

function db() {
  if (!_db) throw new Error("DB not initialized — call initDB(app) first");
  return _db;
}

// ─── Sectors ─────────────────────────────────────────────────────────────
export async function getSectors() {
  const snap = await getDocs(query(collection(db(), "sectors"), orderBy("order")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addSector(data) {
  return addDoc(collection(db(), "sectors"), data);
}

export async function updateSector(id, data) {
  return updateDoc(doc(db(), "sectors", id), data);
}

// Cascade delete: removes the sector AND every subsector under it (each with
// its own tickers / analysis / research_notes). Without this, deleting a
// sector left orphaned "zombie" subsectors/tickers in Firestore that no UI
// could reach. Children are deleted per-subsector (each in its own batch) so
// no single batch exceeds Firestore's 500-write limit.
export async function deleteSector(id) {
  const subs = await getDocs(
    query(collection(db(), "subsectors"), where("sector_id", "==", id))
  );
  for (const sub of subs.docs) {
    await deleteSubsector(sub.id);
  }
  return deleteDoc(doc(db(), "sectors", id));
}

// ─── Subsectors ──────────────────────────────────────────────────────
export async function getSubsectors(sectorId) {
  const q = query(collection(db(), "subsectors"), where("sector_id", "==", sectorId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function addSubsector(data) {
  return addDoc(collection(db(), "subsectors"), data);
}

export async function updateSubsector(id, data) {
  return updateDoc(doc(db(), "subsectors", id), data);
}

// Cascade delete: removes the subsector AND all tickers / analysis /
// research_notes that reference it, in one atomic batch. Previously only the
// subsector doc was removed, orphaning its child docs in Firestore.
export async function deleteSubsector(id) {
  const batch = writeBatch(db());
  const childCollections = ["tickers", "analysis", "research_notes"];
  await Promise.all(
    childCollections.map(async name => {
      const snap = await getDocs(
        query(collection(db(), name), where("subsector_id", "==", id))
      );
      snap.docs.forEach(d => batch.delete(d.ref));
    })
  );
  batch.delete(doc(db(), "subsectors", id));
  return batch.commit();
}

export async function updateSubsectorNotes(id, notes) {
  return updateDoc(doc(db(), "subsectors", id), { notes });
}

// Persist a new subsector display order: writes order = position for each id,
// in one batch. Callers pass the ids already in the desired order.
export async function reorderSubsectors(orderedIds) {
  if (!orderedIds || !orderedIds.length) return;
  const batch = writeBatch(db());
  orderedIds.forEach((id, i) => batch.update(doc(db(), "subsectors", id), { order: i }));
  return batch.commit();
}

// ─── Whole-sector tree (fewer reads) ────────────────────────────────
// Loads a sector's subsectors plus all their tickers / analysis /
// research_notes in ONE query per collection (batched with `in`, 30 ids max
// per Firestore query), instead of 3 separate queries per subsector. This
// avoids the per-subsector minimum-1-read charge on subsectors that have no
// analysis / notes, cutting reads on sparse sectors. Results are grouped back
// by subsector, mirroring the shape selectSector() built before.
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function getBySubsectorIds(coll, subIds) {
  if (!subIds.length) return [];
  const groups = await Promise.all(
    chunk(subIds, 30).map(async ids => {
      const snap = await getDocs(
        query(collection(db(), coll), where("subsector_id", "in", ids))
      );
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    })
  );
  return groups.flat();
}

export async function getSectorTree(sectorId) {
  const subsectors = await getSubsectors(sectorId);
  const subIds = subsectors.map(s => s.id);
  const [tickers, analysis, notes] = await Promise.all([
    getBySubsectorIds("tickers", subIds),
    getBySubsectorIds("analysis", subIds),
    getBySubsectorIds("research_notes", subIds),
  ]);
  const groupBy = arr => {
    const m = {};
    arr.forEach(x => (m[x.subsector_id] ??= []).push(x));
    Object.values(m).forEach(list => list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    return m;
  };
  const t = groupBy(tickers), a = groupBy(analysis), n = groupBy(notes);
  return subsectors.map(sub => ({
    subsector:      sub,
    tickers:        t[sub.id] || [],
    analysis:       a[sub.id] || [],
    research_notes: n[sub.id] || [],
  }));
}

// ─── Tickers ───────────────────────────────────────────────────────────
export async function getTickers(subsectorId) {
  const q = query(collection(db(), "tickers"), where("subsector_id", "==", subsectorId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function addTicker(data) {
  return addDoc(collection(db(), "tickers"), data);
}

export async function updateTicker(id, data) {
  return updateDoc(doc(db(), "tickers", id), data);
}

export async function deleteTicker(id) {
  return deleteDoc(doc(db(), "tickers", id));
}

// ─── Analysis ────────────────────────────────────────────────────────────
export async function getAnalysis(subsectorId) {
  const q = query(collection(db(), "analysis"), where("subsector_id", "==", subsectorId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function addAnalysis(data) {
  return addDoc(collection(db(), "analysis"), data);
}

export async function updateAnalysis(id, data) {
  return updateDoc(doc(db(), "analysis", id), data);
}

export async function deleteAnalysis(id) {
  return deleteDoc(doc(db(), "analysis", id));
}

// ─── Research Notes ─────────────────────────────────────────────────────
export async function getResearchNotes(subsectorId) {
  const q = query(collection(db(), "research_notes"), where("subsector_id", "==", subsectorId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function addResearchNote(data) {
  return addDoc(collection(db(), "research_notes"), data);
}

export async function updateResearchNote(id, data) {
  return updateDoc(doc(db(), "research_notes", id), data);
}

export async function deleteResearchNote(id) {
  return deleteDoc(doc(db(), "research_notes", id));
}

// ─── Prices ───────────────────────────────────────────────────────────
export async function getPrices(symbols) {
  const result = {};
  await Promise.all(
    symbols.map(async sym => {
      const snap = await getDoc(doc(db(), "prices", sym));
      if (snap.exists()) result[sym] = snap.data();
    })
  );
  return result;
}

export function subscribePrices(symbols, callback) {
  if (!symbols || symbols.length === 0) return () => {};
  const result = {};
  const unsubs = symbols.map(sym => {
    return onSnapshot(doc(db(), "prices", sym), snap => {
      if (snap.exists()) result[sym] = snap.data();
      else delete result[sym];
      callback({ ...result });
    });
  });
  return () => unsubs.forEach(u => u());
}

// ─── Event tags (read-only) ────────────────────────────────────────────
// Scans the report collections that reference tickers and returns a map
// symbol → { supply, industry, earnings } where each present key is the
// LATEST matching doc for that symbol: { id, date }. Lets a ticker card link
// straight to the most recent related item. Read-only; no schema/backend
// change. Cached after first call. Any collection that fails to read is
// skipped silently.
let _eventTickerMap = null;
export async function getEventTickerMap() {
  if (_eventTickerMap) return _eventTickerMap;

  // Fast path: a single precomputed index doc (indexes/ticker_events),
  // maintained server-side by scripts/publish.py. One document read instead of
  // scanning three whole report collections on every page load.
  try {
    const snap = await getDoc(doc(db(), "indexes", "ticker_events"));
    if (snap.exists()) {
      const m = snap.data().map;
      if (m && typeof m === "object") { _eventTickerMap = m; return m; }
    }
  } catch { /* index missing or unreadable — fall through to the live scan */ }

  // Fallback: scan the report collections directly. Used until the index doc
  // has been generated at least once (run publish.py), or if it can't be read.
  const map = {};
  // Keep only the newest (by date string, YYYY-MM-DD sorts lexically) per kind.
  const mark = (sym, kind, id, date) => {
    if (!sym || !id) return;
    const s = String(sym).trim();
    if (!s) return;
    const entry = (map[s] = map[s] || {});
    const cur = entry[kind];
    if (!cur || String(date || "") > String(cur.date || "")) entry[kind] = { id, date: date || "" };
  };
  const scan = async (name, kind, tickersOf, dateOf) => {
    try {
      const snap = await getDocs(collection(db(), name));
      snap.docs.forEach(d => {
        const data = d.data();
        tickersOf(data).forEach(sym => mark(sym, kind, d.id, dateOf(data)));
      });
    } catch { /* collection missing or read denied — skip */ }
  };
  await Promise.all([
    scan("supply_chain_news",   "supply",   d => d.tickers || [],            d => d.date),
    scan("supply_chain_events", "industry", d => d.tickers || [],            d => d.event_date || d.date),
    scan("earnings_calls",      "earnings", d => (d.ticker ? [d.ticker] : []), d => d.date),
  ]);
  _eventTickerMap = map;
  return map;
}

// ─── Config / Auth ─────────────────────────────────────────────────────
export async function getAllowedEmails() {
  const snap = await getDoc(doc(db(), "config", "auth"));
  if (!snap.exists()) return [];
  return snap.data().allowed_emails || [];
}

export async function addAllowedEmail(email) {
  return updateDoc(doc(db(), "config", "auth"), {
    allowed_emails: arrayUnion(email),
  });
}

export async function removeAllowedEmail(email) {
  return updateDoc(doc(db(), "config", "auth"), {
    allowed_emails: arrayRemove(email),
  });
}

export async function getWorkerSecret() {
  const snap = await getDoc(doc(db(), "config", "worker"));
  if (!snap.exists()) return null;
  return snap.data().trigger_secret || null;
}

// ─── Editable site content (home page About Me / Interests) ─────────────
// Stored at site_content/home: { name, about, interests[] }. Public read,
// whitelist write (enforced by firestore.rules).
export async function getHomeProfile() {
  const snap = await getDoc(doc(db(), "site_content", "home"));
  return snap.exists() ? snap.data() : null;
}

export async function saveHomeProfile(data) {
  return setDoc(doc(db(), "site_content", "home"), data, { merge: true });
}
