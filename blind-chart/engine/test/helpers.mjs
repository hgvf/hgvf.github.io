import { syntheticPuzzle, prepareForPuzzle, PRESETS } from '../index.js';
export const puzzles = [3, 11, 42, 77, 123, 999, 2024, 31337].map(s => syntheticPuzzle(s));
export const ctxFor = (pz, preset = PRESETS[0], opts) => prepareForPuzzle(pz, preset, opts);
export const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
