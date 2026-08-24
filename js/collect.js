// collect.js — a tiny localStorage-backed store for "collected" highlight news.
// Static-site friendly: the whole item snapshot is kept locally so the highlight
// section renders offline and survives reloads without re-querying Firestore.
// Changes broadcast a window CustomEvent so the sidebar buttons and the
// highlight section stay in sync.

const KEY = "sc_collected_news_v1";
const EVT = "sc-collect-change";

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function write(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* quota / disabled */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: { items: arr } }));
}

export function getCollected() { return read(); }

export function isCollected(id) { return read().some(x => x.id === id); }

// Add (or refresh) an item's snapshot. Returns the current collection.
// `source` tags where the item came from ("supply-chain" | "industry-news")
// so the consolidated 重點新聞 page can label + filter by origin and pick the
// right detail renderer. Any `_source` already on the item is preserved.
export function addCollected(item, source) {
  if (!item || !item.id) return read();
  const arr = read().filter(x => x.id !== item.id);
  arr.unshift({ ...item, _source: source || item._source || "supply-chain", _collected_at: Date.now() });
  write(arr);
  return arr;
}

export function removeCollected(id) {
  write(read().filter(x => x.id !== id));
  return read();
}

// Toggle collection membership. Returns true if now collected, false if removed.
export function toggleCollected(item, source) {
  if (!item || !item.id) return false;
  if (isCollected(item.id)) { removeCollected(item.id); return false; }
  addCollected(item, source);
  return true;
}

// Subscribe to collection changes. Returns an unsubscribe fn.
export function onCollectChange(cb) {
  const h = e => cb(e.detail ? e.detail.items : read());
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
