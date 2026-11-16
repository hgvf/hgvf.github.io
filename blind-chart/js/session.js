// session.js — 建立新的 Session（開始頁與連關下一題共用）。
// 獨立成一個模組：main.js 由 index.html 以 ?v= 載入，其他模組若 import './main.js'
// 會被當成另一個網址再執行一次（兩個 router、兩組快捷鍵 → 按一次 N 走兩根）。
import { loadBank, pickPuzzle, getPuzzle } from './bank.js';
import { saveSession, allSessions, uid } from './store.js';
import { strategyById } from './strategies.js';
import { prepareForPuzzle, scanSignals, deepClone, applyRiskLimit } from '../engine/index.js';

/** Create and save a session. campaign: { id, index, total, played[], settings } */
export async function newSession(settings, campaign = null, startEquity) {
  const bank = await loadBank();
  const spec = deepClone(strategyById(settings.presetId));
  delete spec.builtin;
  const mixed = settings.market === 'MIX';
  const played = new Set([...(campaign?.played || []), ...(await allSessions()).map(s => s.puzzleId)]);
  let puzzle = null, id = null;
  for (let tries = 0; tries < 8; tries++) {
    id = pickPuzzle(bank, { market: settings.market, presetId: spec.id, playBars: settings.playBars, played });
    if (!id) throw new Error('沒有可用的題目');
    puzzle = await getPuzzle(id);
    const known = puzzle.tags?.presets?.[spec.id];
    const nSig = known ? known.signalBars.length : scanSignals(prepareForPuzzle(puzzle, spec, { mixed })).length;
    if (nSig >= 3 || tries === 7) break;     // 隨機池：訊號數低於 minSignals 自動換下一題
    played.add(id);
  }
  const initialEquity = startEquity ?? spec.account?.initialEquity ?? 1000000;
  const risk = settings.risk ?? 0.01;
  applyRiskLimit(spec, risk, initialEquity);
  const s = {
    id: uid(), createdAt: Date.now(), status: 'playing', risk,
    puzzleId: id, market: puzzle.market, mixed, regime: puzzle.tags?.regime, synthetic: !!puzzle.synthetic,
    presetId: spec.id, spec, settings: { hint: settings.hint, hideDiscipline: !!settings.hideDiscipline, speed: settings.speed || 4 },
    playStart: puzzle.contextBars, playBars: puzzle.playBars, cursor: puzzle.contextBars,
    initialEquity,
    actions: [], campaign: campaign ? { ...campaign, played: [...(campaign.played || []), id] } : null,
  };
  await saveSession(s);
  return s;
}
