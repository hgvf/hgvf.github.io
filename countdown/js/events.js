/* events.js — the easter-egg scheduler.
   Triggers are absolute timestamps derived from today's session: remaining-time
   marks (every whole hour left, last hour, 50 %) and wall-clock marks (12:00,
   15:00), plus 1–2 seeded rare events a day. Fired ids persist per day so a reload
   never replays; coming back to a tab replays only the most recent missed one. */

import { load, save } from './storage.js';
import { at } from './schedule.js';
import { rng, hashStr } from './pixel.js';

const H = 3600e3;
const CATCHUP = 60 * 60e3;      // a missed egg older than this is dropped silently

export function buildEvents(session) {
  const { start, end, date } = session;
  const ev = [];
  const total = end - start;
  for (let k = Math.floor(total / H); k >= 1; k--) {
    const t = end - k * H;
    if (t <= start + 30e3) continue;
    ev.push({ id: k === 1 ? 'last-hour' : `hour-${k}`, t, kind: k === 1 ? 'lastHour' : 'flip', from: k + 1, to: k });
  }
  ev.push({ id: 'half', t: start + total / 2, kind: 'half' });
  for (const [hhmm, kind] of [['12:00', 'lunch'], ['15:00', 'tea']]) {
    const t = at(date, hhmm);
    if (t > start && t < end - 5 * 60e3) ev.push({ id: kind, t, kind });
  }
  // rare events: 1–2 per day at seeded times in the middle 70 % of the day
  const r = rng(hashStr('rare' + date));
  const n = 1 + (r() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const t = start + total * (0.15 + r() * 0.7);
    ev.push({ id: `rare-${i}`, t, kind: r() < 0.5 ? 'ufo' : 'tail' });
  }
  return ev.sort((a, b) => a.t - b.t);
}

export class Scheduler {
  constructor() { this.events = []; this.key = ''; this.fired = load('fired', { date: '', ids: [] }); }

  setSession(session) {
    const key = `${session.date}|${session.start}|${session.end}`;
    if (key === this.key) return;
    this.key = key;
    this.events = buildEvents(session);
    if (this.fired.date !== session.date) { this.fired = { date: session.date, ids: [] }; save('fired', this.fired); }
  }

  /** Returns the event to play now (at most one), marking every passed one as fired. */
  poll(now) {
    const pending = this.events.filter(e => e.t <= now && !this.fired.ids.includes(e.id));
    if (!pending.length) return null;
    for (const e of pending) this.fired.ids.push(e.id);
    save('fired', this.fired);
    const latest = pending[pending.length - 1];
    if (now - latest.t > CATCHUP) return null;
    // the alert mode / last-hour gathering always wins over a smaller egg in the same batch
    const lh = pending.find(e => e.kind === 'lastHour' && now - e.t < CATCHUP);
    return lh || latest;
  }

  next(now) { return this.events.find(e => e.t > now) || null; }
}
