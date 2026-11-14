#!/usr/bin/env node
// backtest-presets.mjs — 每個內建策略在整個題庫上跑「影子帳戶」（完全照規則），彙整成
// config/preset-stats.json，策略頁顯示用。指標定義見 engine/backtest.js。
//
//   node blind-chart/tools/backtest-presets.mjs --bank <題庫資料夾> [--out blind-chart/config/preset-stats.json] [--limit N]
//
// 題庫資料夾 = blind-chart-puzzles 分支的內容（index.json + puzzles/）：
//   git archive origin/blind-chart-puzzles | tar -x -C /tmp/bank
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../engine/index.js';
import { runPuzzle, runBuyHold, newAccumulator, addRecord, summarize } from '../engine/backtest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
if (!args.bank) { console.error('需要 --bank <題庫資料夾>'); process.exit(1); }
const out = args.out || path.join(HERE, '../config/preset-stats.json');
const index = JSON.parse(fs.readFileSync(path.join(args.bank, 'index.json'), 'utf8'));
const list = index.puzzles.slice(0, args.limit ? +args.limit : undefined);

const accs = Object.fromEntries(PRESETS.map(p => [p.id, newAccumulator()]));
const bh = newAccumulator();
const t0 = Date.now();
list.forEach((meta, k) => {
  const pz = JSON.parse(fs.readFileSync(path.join(args.bank, 'puzzles', `${meta.id}.json`), 'utf8'));
  for (const preset of PRESETS) addRecord(accs[preset.id], runPuzzle(pz, preset), meta);
  addRecord(bh, runBuyHold(pz), meta);
  if ((k + 1) % 200 === 0) console.error(`${k + 1}/${list.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
});

const result = {
  generatedAt: new Date().toISOString(),
  bankSeed: index.seed,
  puzzles: list.length,
  method: '影子帳戶（完全照規則）在題庫每一題的可操作區間回測；每題獨立、起始權益相同；無交易成本。題庫的多頭 / 空頭 / 盤整各約 1/3，比真實市場更偏空，絕對報酬會比長期實際偏低。',
  buyHold: summarize(bh),
  presets: Object.fromEntries(PRESETS.map(p => [p.id, summarize(accs[p.id])])),
};
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`);
