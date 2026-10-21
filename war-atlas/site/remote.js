// remote.js — connects the War Atlas page to the site's Firestore (website build only).
//
// Records added with the 新增戰役 button are written to Firestore so every device sees them at once;
// .github/workflows/sync_war_atlas.yml copies them back into war-atlas/data/ daily (GitHub stays the
// canonical home, see skills/war-atlas/SKILL.md).
//
//   war_atlas_battles/{id}  { json: "<full battle record>", title, wars, start, updated_at, updated_by }
//   war_atlas_wars/{id}     the wars.json entry + updated_at
//
// A battle is stored as a JSON string because Firestore cannot hold nested arrays
// (moves[].path, zones[].polygon are arrays of [lat, lng]). Public read, whitelisted write
// (firestore.rules).

import { onAuth, signInGoogle, signOutUser } from "../../js/reports.js";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../../js/config.js";

const BATTLES = "war_atlas_battles";
const WARS = "war_atlas_wars";
const atlas = window.WarAtlas;

function db() { return getFirestore(getApps().length ? getApp() : initializeApp(firebaseConfig)); }

let who = { user: null, isAdmin: false };

async function load() {
  const [bs, ws] = await Promise.all([getDocs(collection(db(), BATTLES)), getDocs(collection(db(), WARS))]);
  const wars = ws.docs.map(d => { const { updated_at, updated_by, ...w } = d.data(); return { ...w, id: d.id }; });
  const battles = [];
  for (const d of bs.docs) {
    try { battles.push(JSON.parse(d.data().json)); } catch (e) { console.warn("war-atlas: bad record", d.id, e); }
  }
  return { battles, wars };
}

async function save(battles, wars) {
  if (!who.isAdmin) throw new Error("需以白名單帳號登入");
  // Firestore batches cap at 500 writes; a skill export is a handful of records.
  const batch = writeBatch(db());
  const meta = { updated_at: new Date().toISOString(), updated_by: who.user.email };
  for (const w of wars) batch.set(doc(db(), WARS, w.id), { ...w, ...meta });
  for (const b of battles) {
    const json = JSON.stringify(b);
    if (json.length > 900_000) throw new Error(`${b.id} 超過 Firestore 單筆 1 MB 上限`);
    batch.set(doc(db(), BATTLES, b.id), {
      json, title: b.title, wars: b.wars, start: String(b.date?.start || ""), ...meta,
    });
  }
  await batch.commit();
}

if (atlas) {
  atlas.attachRemote({ save, signIn: signInGoogle, signOut: signOutUser });
  onAuth(a => { who = a; atlas.setAuth(a); });
  load().then(r => atlas.addRemote(r.battles, r.wars))
    .catch(e => console.warn("war-atlas: database unavailable, showing repo data only", e));
}
