/* schedule.js — settings + today's record → { start, end, state }.
   Rules: { type:'offset', hours } | { type:'fixed', time:'18:00' } | { type:'manual' }
   (manual reads today's day.manualEnd, a datetime-local string). */

import { load, save } from './storage.js';

export const DEFAULT_SETTINGS = {
  configured: false,
  label: '下班',
  startTime: '09:00',
  rule: { type: 'offset', hours: 9 },
  fixedTime: '18:00',
  lunch: { counted: true, minutes: 60 },
  theme: 'meteor',
  motion: 'full',          // full | lowkey | reduced
  eggs: {},                // egg id → false to disable
  workdays: [1, 2, 3, 4, 5],
  idleMinutes: 5,
  skins: {},               // animal → false to hide an unlocked outfit
};

const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const todayStr = (t = Date.now()) => dateStr(new Date(t));

export function at(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
}

export function loadSettings() {
  const s = load('settings', DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s, lunch: { ...DEFAULT_SETTINGS.lunch, ...(s.lunch || {}) } };
}
export const saveSettings = s => save('settings', s);

/** Today's record; rolls over automatically when the calendar day changes. */
export function loadDay(t) {
  const today = todayStr(t);
  const d = load('day', null);
  if (!d || !d.date || (d.date < today && !d.pinned)) return freshDay(today);
  return d;
}
export const freshDay = date => ({ date, punch: null, manualEnd: null, extraMinutes: 0, working: false, pinned: false, asked: false });
export const saveDay = d => save('day', d);

export function isWorkday(settings, date) {
  const [y, m, d] = date.split('-').map(Number);
  return settings.workdays.includes(new Date(y, m - 1, d).getDay());
}

export function computeSession(settings, day, t) {
  const start = at(day.date, day.punch || settings.startTime);
  let end;
  const r = settings.rule || { type: 'offset', hours: 9 };
  if (r.type === 'fixed') {
    end = at(day.date, settings.fixedTime || '18:00');
    if (end <= start) end += 86400e3;
  } else if (r.type === 'manual' && day.manualEnd) {
    end = new Date(day.manualEnd).getTime();
    if (!(end > start)) end = start + 9 * 3600e3;
  } else {
    const hours = Number(r.hours) || 9;
    end = start + hours * 3600e3 + (settings.lunch.counted ? 0 : (Number(settings.lunch.minutes) || 0) * 60e3);
  }
  end += (day.extraMinutes || 0) * 60e3;

  const workday = isWorkday(settings, day.date) || day.working || !!day.punch;
  let state;
  if (!workday) state = 'weekend';
  else if (t < start) state = 'before';
  else if (t < end) state = 'working';
  else state = 'after';
  return { start, end, state, date: day.date };
}

/** Start of the next working day (strictly after t's calendar day unless before today's start). */
export function nextWorkStart(settings, t) {
  const d = new Date(t);
  for (let i = 0; i < 14; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const ds = dateStr(day);
    if (!settings.workdays.includes(day.getDay())) continue;
    const s = at(ds, settings.startTime);
    if (s > t) return s;
  }
  return t + 86400e3;
}
