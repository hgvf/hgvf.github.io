// milstore.js — 軍事專區 Firestore 讀寫。
//   mil_defense_daily : 每日軍武採購動態（白名單使用者可經前端寫入，比照 earnings/annual_reports）
//   mil_feeds         : 每日彙整（僅由 Cloudflare Worker 寫入，前端唯讀）
// 重用既有 js/config.js 的 firebaseConfig，並共用既有 default app（避免重複 initializeApp）。
import { firebaseConfig } from "../../js/config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const app = () => (getApps().length ? getApp() : initializeApp(firebaseConfig));
const db = () => getFirestore(app());
const auth = () => getAuth(app());

export function onAuth(cb) {
  return onAuthStateChanged(auth(), async user => {
    if (!user) { cb({ user: null, isAdmin: false }); return; }
    let isAdmin = false;
    try {
      const snap = await getDoc(doc(db(), "config", "auth"));
      isAdmin = snap.exists() && (snap.data().allowed_emails || []).includes(user.email);
    } catch { /* ignore */ }
    cb({ user, isAdmin });
  });
}
export const signIn = () => signInWithPopup(auth(), new GoogleAuthProvider());
export const signOutUser = () => signOut(auth());

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

// 解析 skill 產出：接受 {run,events:[...]}、bare array、或單一 event。
export function parseDefenseRun(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (Array.isArray(data)) return { events: data, run: null };
  if (data && Array.isArray(data.events)) return { events: data.events, run: data.run || null };
  if (data && (data.event_id || data.title)) return { events: [data], run: null };
  throw new Error('格式需為 {"events":[...]}、陣列、或單一 event 物件');
}

// 寫入每一則 event（doc id = event_id 或以 country+date+contract 生成），保留完整物件 + 索引欄位。
export async function saveDefenseEvents(events) {
  const now = new Date().toISOString();
  let n = 0;
  for (const e of events) {
    if (!e.title && !e.title_zh) throw new Error(`每筆需含 title：${JSON.stringify(e).slice(0, 80)}`);
    const idBase = e.event_id || `${e.country || "xx"}_${e.publication_date || e.event_date || "nodate"}_${(e.contract && e.contract.contract_number) || (e.title || "").slice(0, 24)}`;
    const id = slug(idBase);
    await setDoc(doc(db(), "mil_defense_daily", id), {
      _date: e.publication_date || e.event_date || "",
      _country: e.country || "",
      _type: e.event_type || "",
      _score: Number(e.importance_score) || 0,
      updated_at: now,
      data: e,
    }, { merge: false });
    n++;
  }
  return n;
}

export async function loadDefenseEvents(max = 300) {
  try {
    const snap = await getDocs(query(collection(db(), "mil_defense_daily"), orderBy("_date", "desc"), limit(max)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(collection(db(), "mil_defense_daily"));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => String(b._date || "").localeCompare(String(a._date || "")));
    return rows.slice(0, max);
  }
}
export const deleteDefenseEvent = id => deleteDoc(doc(db(), "mil_defense_daily", id));

// ── 戰爭 mil_conflicts（白名單前端寫；每份文件是一場自足的戰爭）──
export async function saveConflict(conflict) {
  if (!conflict || !conflict.id) throw new Error("戰爭需含 id");
  const id = slug(conflict.id);
  await setDoc(doc(db(), "mil_conflicts", id), { id: conflict.id, updated_at: new Date().toISOString(), data: conflict }, { merge: false });
  return id;
}
export async function loadConflicts() {
  const snap = await getDocs(collection(db(), "mil_conflicts"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export const deleteConflict = id => deleteDoc(doc(db(), "mil_conflicts", id));

// ── 武器 mil_weapons（系統譜系；白名單前端寫）──
export async function saveWeapons(weapons) {
  const now = new Date().toISOString();
  let n = 0;
  for (const w of weapons) {
    if (!w.id || !w.name_zh) throw new Error(`每筆需含 id/name_zh：${JSON.stringify(w).slice(0, 80)}`);
    await setDoc(doc(db(), "mil_weapons", slug(w.id)), { updated_at: now, data: w }, { merge: false });
    n++;
  }
  return n;
}
export async function loadWeapons() {
  const snap = await getDocs(collection(db(), "mil_weapons"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export const deleteWeapon = id => deleteDoc(doc(db(), "mil_weapons", id));
