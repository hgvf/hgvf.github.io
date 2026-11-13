// violations.js — ViolationRule registry (SDD 7.2). Detection lives in sim.js
// (it needs the replay state); this registry carries names, default weights
// and how the counterfactual fixes each one. Weights can be overridden in
// spec.discipline.weights.
export const VIOLATIONS = {};
export function registerViolation(v) { VIOLATIONS[v.code] = v; }

[
  ['STOP_IGNORED', '破停損未出場', 10, '規則觸發停損後超過 stopGraceBars 仍持有'],
  ['TRAIL_IGNORED', '移動停利觸發未出場', 6, '同上，用於已獲利部位（停損 ≥ 均價）'],
  ['AVERAGE_DOWN', '虧損中加碼', 10, 'pos.unrealizedR < 0 時買進'],
  ['ADD_OFF_RULE', '不符規則加碼', 5, '加碼時 trigger 不成立或已達 maxAdds'],
  ['RISK_CAP', '超過風險上限', 8, '成交後 openRiskR > maxOpenRiskR'],
  ['OVERSIZE', '部位過大', 5, '股數比建議多超過 sizeTolerancePct'],
  ['UNDERSIZE', '部位過小', 2, '股數比建議少超過 sizeTolerancePct'],
  ['NO_SIGNAL_ENTRY', '無訊號進場', 6, '進場當下無訊號且不在 entryWindowBars 內'],
  ['CHASE', '追價', 4, '成交價 > 訊號價 + chaseAtr × ATR'],
  ['EARLY_EXIT', '提早出場', 4, '無規則觸發就賣出（allowDiscretionaryExit = false 時才算）'],
  ['TARGET_IGNORED', '達停利未減碼', 2, '分批停利觸發後未賣出對應比例'],
  ['EXIT_SIGNAL_IGNORED', '出場訊號未執行', 4, 'exitSignals 成立後未在寬限內賣出（SDD 外新增）'],
  ['MISSED_SIGNAL', '錯失訊號', 1, '訊號成立但未進場（可設 scoreMissedSignal=false 只記錄）'],
  ['REVENGE', '停損後報復性進場', 6, '停損出場後 3 根內無訊號再進場'],
].forEach(([code, name, weight, desc]) => registerViolation({ code, name, weight, desc }));
