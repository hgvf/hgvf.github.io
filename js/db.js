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
