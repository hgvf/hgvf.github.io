// describe.js — 把策略規則寫成白話條列（開始頁、遊戲頁、策略頁共用）。
import { esc } from './ui.js';
import { getKnob, presetById, normalizeSpec } from '../engine/index.js';

const num = (x, d = 2) => (Number.isFinite(+x) ? String(+(+x).toFixed(d)) : String(x));
const pct = (x, d = 2) => `${num(x * 100, d)}%`;
export const fmtMoney = x => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—');

/** 短名稱 */
export function shortName(s) {
  if (!s) return '';
  if (s.short) return s.short;
  const base = s.basedOn && presetById(s.basedOn);
  const n = s.name || s.id || '';
  if (base && /（我的）|（複製）/.test(n)) return `${base.short}（自訂）`;
  return n.split('（')[0].split(' + ')[0];
}

/** {path} / {path|%} / {path|below} / {path|above} 換成目前數值（粗體）。 */
export function fillPlain(text, spec) {
  return esc(text).replace(/\{([^}|]+)(?:\|([\w%]+))?\}/g, (m, path, f) => {
    const v = getKnob(spec, path);
    if (!Number.isFinite(+v)) return '?';
    const s = f === '%' ? pct(v) : f === 'below' ? `${num((1 - v) * 100, 1)}%` : f === 'above' ? `${num((v - 1) * 100, 1)}%` : num(v, 3);
    return `<b>${s}</b>`;
  });
}

function safeNormalize(spec) { try { return normalizeSpec(spec); } catch { return null; } }

/** { buy, sell, add } 三組條列（HTML 字串陣列）。內建或改自內建的策略用白話模板，其他自動產生。 */
export function plainRules(spec) {
  const tpl = spec.plain || (spec.basedOn && presetById(spec.basedOn)?.plain);
  if (tpl) {
    const f = a => (a || []).map(t => fillPlain(t, spec));
    return { buy: f(tpl.buy), sell: f(tpl.sell), add: spec.pyramiding?.enabled ? f(tpl.add) : [] };
  }
  const ns = safeNormalize(spec);
  return {
    buy: [`條件：<code>${esc(ns?.entry?.signal || spec.entry?.signal || '')}</code>`],
    sell: describeExits(spec, ns),
    add: spec.pyramiding?.enabled ? [esc(describePyramid(spec, ns))] : [],
  };
}

/** 部位大小的白話說明。risk = 開始頁設定的每筆最多賠（比例），equity = 起始資金。 */
export function sizingPlain(spec, { risk, equity } = {}) {
  const s = spec.sizing || {}, c = s.caps || {};
  const out = [];
  const lim = risk > 0 ? risk : c.maxRiskPct;
  const riskBased = s.method === 'risk_percent' || s.method === 'max_loss_amount';
  if (riskBased) {
    const p = lim > 0 ? lim : s.method === 'risk_percent' ? s.pct ?? 0.01 : null;
    out.push(p != null
      ? `每筆最多賠帳戶 <b>${pct(p)}</b>${equity ? `（${fmtMoney(equity * p)}）` : ''}，股數 = 可賠金額 ÷ 每股停損距離`
      : `每筆最多賠 <b>${fmtMoney(s.amount ?? 10000)}</b>，股數 = 可賠金額 ÷ 每股停損距離`);
  } else {
    const m = {
      percent_equity: `每次投入帳戶 <b>${pct(s.pct ?? 0.2)}</b>`,
      total_cost: `每次投入 <b>${fmtMoney(s.cost)}</b>`,
      fixed_shares: `每次買 <b>${fmtMoney(s.shares)}</b> 股`,
      vol_target: `波動越大買越少：股數 = 帳戶 × <b>${pct(s.targetVolPct ?? 0.01)}</b> ÷ ATR`,
    }[s.method] || esc(s.method || '');
    out.push(m);
    if (lim > 0) out.push(`但每筆最多賠帳戶 <b>${pct(lim)}</b>${equity ? `（${fmtMoney(equity * lim)}）` : ''}`);
  }
  if (c.maxPositionPct != null) out.push(`單筆最多買到帳戶的 <b>${pct(c.maxPositionPct, 0)}</b>`);
  return out;
}

// ── 自訂策略沒有白話模板時，由規則自動產生 ──
export function describeStop(st, ns) {
  const p = st.params || {};
  const atr = p.atrId || 'ATR';
  const d = {
    atr_initial: `停損：買價往下 ${num(p.k ?? 2)} 倍 ${atr}`,
    pct_initial: `停損：買價往下 ${pct(p.p ?? 0.08)}`,
    structure: `停損：波段低點（${p.swingId || 'swing'}）${p.bufferAtr ? `再往下 ${num(p.bufferAtr)} 倍 ${atr}` : ''}${p.bufferPct ? `再往下 ${pct(p.bufferPct)}` : ''}`,
    atr_trailing: `移動停損：收盤往下 ${num(p.k ?? 3)} 倍 ${atr}`,
    chandelier: `從最高點回落 ${num(p.k ?? 3)} 倍 ${atr} 就賣`,
    ma_trailing: `${(p.trigger ?? 'close') === 'close' ? '收盤跌破' : '盤中碰到'} ${p.maId}${p.bufferAtr ? ` 再往下 ${num(p.bufferAtr)} 倍 ${atr}` : ''}${p.bufferPct ? ` 再往下 ${pct(p.bufferPct)}` : ''} 就賣`,
    donchian_trailing: `跌破最近 ${p.length ?? 10} 根最低價就賣`,
    breakeven: `賺到 ${num(p.atR ?? 1)}R，停損拉到成本`,
    step_r: `每賺 ${num(p.stepR ?? 1)}R，停損上移 ${num(p.moveR ?? 1)}R`,
    time_stop: (p.minR ?? 0.5) >= 50 ? `持有滿 ${p.bars ?? 20} 根就賣` : `持有 ${p.bars ?? 20} 根還沒賺到 ${num(p.minR ?? 0.5)}R 就賣`,
  }[st.type] || st.type;
  const act = ns?.stops?.find(x => x.type === st.type && JSON.stringify(x.params) === JSON.stringify(st.params))?.activateWhen || st.activateWhen;
  return esc(d) + (act ? ` <span class="sub">（<code>${esc(act)}</code> 之後）</span>` : '');
}
export function describeExits(spec, ns) {
  const out = (spec.stops || []).map(st => describeStop(st, ns));
  (spec.targets || []).forEach(t => out.push(esc(`賺到 ${t.at?.r != null ? `${num(t.at.r)}R` : t.at?.atr != null ? `${num(t.at.atr)} 倍 ATR` : t.at?.expr} 先賣 ${pct(t.fraction ?? 1, 0)}`)));
  (ns?.exitSignals || spec.exitSignals || []).forEach(x => out.push(`<code>${esc(x.expr)}</code> 成立就賣 ${esc(pct(x.fraction ?? 1, 0))}`));
  return out;
}
export function describePyramid(spec, ns) {
  const p = spec.pyramiding || {};
  const size = p.size?.mode === 'pyramid_decreasing' ? `每次遞減 ×${p.size?.value ?? 0.5}` : p.size?.mode === 'risk_based' ? `每次加 ${p.size?.value ?? 0.5}R 風險` : `每次加第一筆的 ${pct(p.size?.value ?? 0.5, 0)}`;
  return `條件 ${ns?.pyramiding?.trigger || p.trigger}；最多 ${p.maxAdds ?? 0} 次；${size}${p.onAdd?.moveStop?.type === 'breakeven' ? '；加碼後停損拉到成本' : ''}`;
}

/** 精簡的 JSON 排版：頂層一行一個欄位，陣列裡的物件一個一行。 */
export function prettyJson(o) {
  const one = v => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ');
  const lines = Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object')
    ? `  ${JSON.stringify(k)}: [\n${v.map(x => `    ${one(x)}`).join(',\n')}\n  ]`
    : `  ${JSON.stringify(k)}: ${one(v)}`));
  return `{\n${lines.join(',\n')}\n}`;
}

/** 條列 HTML */
export const bullets = arr => `<ul class="pl-list">${arr.map(x => `<li>${x}</li>`).join('')}</ul>`;

/** 一個策略的白話區塊（開始頁、遊戲頁、策略頁） */
export function rulesBlock(spec, opts = {}) {
  const r = plainRules(spec);
  const size = sizingPlain(spec, opts);
  const row = (lbl, cls, arr) => (arr.length ? `<div class="pl-row"><span class="pl-lbl ${cls}">${lbl}</span>${bullets(arr)}</div>` : '');
  return `<div class="pl">${row('買', 'buy', r.buy)}${row('賣', 'sell', r.sell)}${row('加碼', 'add', r.add)}${opts.noSize ? '' : row('部位', 'size', size)}</div>`;
}
