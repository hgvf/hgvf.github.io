// defensedata.js — Firestore layer for 每日軍武合約 (moved out of the retired
// 軍武專區 into the Stock section). Collection: mil_defense_daily. Whitelisted
// users publish via the ADD JSON importer; everyone reads the single-doc
// index indexes/mil_defense_daily (1 read/load instead of scanning the whole
// collection). Reuses the site's shared Firebase app so there is no duplicate
// initializeApp.
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

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

// 解析 skill 產出：接受 {run,events:[...]}、bare array、或單一 event。
export function parseDefenseRun(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (Array.isArray(data)) return { events: data, run: null };
  if (data && Array.isArray(data.events)) return { events: data.events, run: data.run || null };
  if (data && (data.event_id || data.title)) return { events: [data], run: null };
  throw new Error('格式需為 {"events":[...]}、陣列、或單一 event 物件');
}

export async function saveDefenseEvents(events) {
  const now = new Date().toISOString();
  let n = 0;
  for (const e of events) {
    if (!e.title && !e.title_zh) throw new Error(`每筆需含 title：${JSON.stringify(e).slice(0, 80)}`);
    const idBase = e.event_id || `${e.country || "xx"}_${e.publication_date || e.event_date || "nodate"}_${(e.contract && e.contract.contract_number) || (e.title || "").slice(0, 24)}`;
    await setDoc(doc(db(), "mil_defense_daily", slug(idBase)), {
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

// ── 每日軍武索引（indexes/mil_defense_daily）──────────────────────────
// 存最新 N 筆事件於單一文件，讓一般訪客只讀 1 份文件即可呈現整頁。
const DEFENSE_INDEX_MAX = 250;

async function scanDefenseCollection(max = 300) {
  let docs;
  try {
    const snap = await getDocs(query(collection(db(), "mil_defense_daily"), orderBy("_date", "desc"), limit(max)));
    docs = snap.docs;
  } catch {
    const snap = await getDocs(collection(db(), "mil_defense_daily"));
    docs = snap.docs;
  }
  const rows = docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => String(b._date || "").localeCompare(String(a._date || "")));
  return rows.slice(0, max);
}

export async function loadDefenseEvents(max = 300) {
  try {
    const snap = await getDoc(doc(db(), "indexes", "mil_defense_daily"));
    if (snap.exists()) {
      const ev = snap.data().events;
      if (Array.isArray(ev) && ev.length) return ev.slice(0, max);
    }
  } catch { /* 索引不存在或讀取失敗 → 退回即時掃描 */ }
  return scanDefenseCollection(max);
}

// 白名單新增/刪除後重建索引，讓一般載入只讀該索引 1 份文件。
export async function rebuildDefenseIndex() {
  const rows = await scanDefenseCollection(DEFENSE_INDEX_MAX);
  try {
    await setDoc(doc(db(), "indexes", "mil_defense_daily"), {
      updated_at: new Date().toISOString(), count: rows.length, events: rows,
    }, { merge: false });
  } catch { /* 權限不足時忽略：索引由 CI 維護即可 */ }
  return rows;
}

export const deleteDefenseEvent = id => deleteDoc(doc(db(), "mil_defense_daily", id));
