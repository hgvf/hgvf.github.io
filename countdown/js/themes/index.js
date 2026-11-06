/* themes/index.js — theme registry. A theme is { id, name, render(g, p, dt, st),
   renderEnd(g, t, st) → stillPlaying, resetEnd?(), click?(x, y), hud?: 'none' }.
   Adding a theme = add a file and list it here; the core never changes. */

import meteor from './meteor.js';
import rocket from './rocket.js';
import hourglass from './hourglass.js';
import digital from './digital.js';
import doomsday from './doomsday.js';
import command from './command.js';
import plant from './plant.js';
import train from './train.js';
import bomb from './bomb.js';
import wrist from './wrist.js';
import kitchen from './kitchen.js';
import stopwatch from './stopwatch.js';
import mom from './mom.js';
import ultimatum from './ultimatum.js';
import launch from './launch.js';
import { hashStr } from '../pixel.js';

export const THEMES = [meteor, rocket, hourglass, digital, doomsday, command, plant,
  train, bomb, wrist, kitchen, stopwatch, mom, ultimatum, launch];
export const byId = id => THEMES.find(t => t.id === id) || meteor;

/** 'random' picks one per calendar day (stable for the whole day). */
export function themeFor(setting, date) {
  if (setting !== 'random') return byId(setting);
  return THEMES[hashStr('theme' + date) % THEMES.length];
}
