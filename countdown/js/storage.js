/* storage.js — localStorage with every read/write wrapped (private windows,
   blocked storage and quota errors all degrade to in-memory defaults). */

const PREFIX = 'offwork.';
const memory = new Map();

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return memory.has(key) ? memory.get(key) : clone(fallback);
    return JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : clone(fallback);
  }
}

export function save(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* memory only */ }
}

export function remove(key) {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

/** Every key this app owns, for export. */
export function dumpAll() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k));
    }
  } catch { /* fall through to memory */ }
  for (const [k, v] of memory) if (!(k in out)) out[k] = v;
  return out;
}

export function restoreAll(obj) {
  for (const [k, v] of Object.entries(obj || {})) save(k, v);
}

const clone = v => (v == null || typeof v !== 'object') ? v : JSON.parse(JSON.stringify(v));
