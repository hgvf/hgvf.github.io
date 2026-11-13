// strategies.js — presets + user strategies in one list.
import { PRESETS, deepClone } from '../engine/index.js';
import { customStrategies } from './store.js';
export const allStrategies = () => [...PRESETS.map(p => ({ ...deepClone(p), builtin: true })), ...customStrategies()];
export const strategyById = id => allStrategies().find(s => s.id === id) || deepClone(PRESETS[0]);
