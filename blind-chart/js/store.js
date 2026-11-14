// store.js — sessions in IndexedDB (localStorage fallback), settings & custom
// strategies in localStorage. Everything is exportable as JSON (SDD 6.4).
const DB = 'blind-chart', STORE = 'sessions';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
const LS = 'bc.sessions';
const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const lsSave = o => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* quota */ } };

export async function saveSession(s) {
  s.updatedAt = Date.now();
  const d = await db();
  if (!d) { const all = lsAll(); all[s.id] = s; lsSave(all); return s; }
  await new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(s); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  return s;
}
export async function getSession(id) {
  const d = await db();
  if (!d) return lsAll()[id] || null;
  return new Promise(res => { const r = d.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
}
export async function allSessions() {
  const d = await db();
  const list = !d ? Object.values(lsAll()) : await new Promise(res => { const r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function deleteSession(id) {
  const d = await db();
  if (!d) { const all = lsAll(); delete all[id]; lsSave(all); return; }
  await new Promise(res => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = res; });
}

export function getSettings() {
  try { return { hint: 'full', hideDiscipline: false, market: 'TW', presetId: 'donchian-breakout-v1', playBars: 250, mode: 'single', campaignN: 10, speed: 4, risk: 0.01, ...JSON.parse(localStorage.getItem('bc.settings') || '{}') }; }
  catch { return { hint: 'full', market: 'TW', presetId: 'donchian-breakout-v1', playBars: 250, mode: 'single', campaignN: 10, speed: 4, risk: 0.01 }; }
}
export function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { localStorage.setItem('bc.settings', JSON.stringify(s)); } catch { /* ignore */ }
  return s;
}
export function customStrategies() { try { return JSON.parse(localStorage.getItem('bc.strategies') || '[]'); } catch { return []; } }
export function saveCustomStrategy(spec) {
  const list = customStrategies().filter(s => s.id !== spec.id);
  list.unshift(spec);
  try { localStorage.setItem('bc.strategies', JSON.stringify(list)); } catch { /* ignore */ }
}
export function deleteCustomStrategy(id) {
  try { localStorage.setItem('bc.strategies', JSON.stringify(customStrategies().filter(s => s.id !== id))); } catch { /* ignore */ }
}
export const uid = (p = 's') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
