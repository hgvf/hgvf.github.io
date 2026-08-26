import {
  getFirestore,
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
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _db = null;

export function initDB(app) {
  _db = getFirestore(app);
  return _db;
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

export async function deleteSector(id) {
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

export async function deleteSubsector(id) {
  return deleteDoc(doc(db(), "subsectors", id));
}

export async function updateSubsectorNotes(id, notes) {
  return updateDoc(doc(db(), "subsectors", id), { notes });
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
// symbol → { supply, industry, earnings } marking which event types exist
// for that symbol. Read-only; no schema/backend change. Cached after first
// call. Any collection that fails to read is skipped silently.
let _eventTickerMap = null;
export async function getEventTickerMap() {
  if (_eventTickerMap) return _eventTickerMap;
  const map = {};
  const mark = (sym, kind) => {
    if (!sym) return;
    const s = String(sym).trim();
    if (!s) return;
    (map[s] = map[s] || { supply: false, industry: false, earnings: false })[kind] = true;
  };
  const scan = async (name, kind, extract) => {
    try {
      const snap = await getDocs(collection(db(), name));
      snap.docs.forEach(d => extract(d.data()).forEach(sym => mark(sym, kind)));
    } catch { /* collection missing or read denied — skip */ }
  };
  await Promise.all([
    scan("supply_chain_news",   "supply",   d => d.tickers || []),
    scan("supply_chain_events", "industry", d => d.tickers || []),
    scan("earnings_calls",      "earnings", d => (d.ticker ? [d.ticker] : [])),
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
