// industrydetail.js — detail-card renderer for `supply_chain_events` items
// (產業消息 / supply-chain-intelligence-daily). Renders the rich event schema:
// title / summary / why-it-matters / change delta / supply-chain graph /
// companies / financials / classification chips / sources. Shared by the
// 產業消息 page and the consolidated 重點新聞 (highlights) page.

import { esc, fmtDate, chartUrl, tickerTrendCard } from "./reports.js";

// ── Enum → label maps (front-end display only) ──────────────────────────
export const EVENT_TYPE_LABEL = {
  supplier_change:      "供應商變動",
  supply_agreement:     "供應協議",
  capacity:             "產能",
  raw_material_bom:     "原料 / BOM",
  supply_disruption:    "供應中斷",
  trade_policy:         "貿易 / 關稅",
  strategic_investment: "戰略投資",
  permit_regulatory:    "許可 / 法規",
};
export const TIER_LABEL = { critical: "關鍵 Critical", high: "重要 High", relevant: "相關 Relevant" };
export const TIER_CLASS = { critical: "tier-critical", high: "tier-high", relevant: "tier-relevant" };
export const EVIDENCE_LABEL = { confirmed: "已確認", reported: "已報導", inferred: "推論", rumor: "傳聞" };
export const ROLE_LABEL = {
  supplier: "供應商", customer: "客戶", new_supplier: "新供應商",
  incumbent_supplier: "現任供應商", investor: "投資方", investee: "被投資",
  regulator: "監管機關", disruptor: "破壞者", affected_party: "受影響方",
};

export function eventTypeLabel(t) { return EVENT_TYPE_LABEL[t] || t || "—"; }
export function tierClass(t) { return TIER_CLASS[t] || "tier-relevant"; }

// ── Sub-cards ───────────────────────────────────────────────────────────
function whyCard(v) {
  return v ? `<div class="rp-subcard rp-advise"><div class="rp-subcard-head">💡 為何重要</div>
    <div class="rp-subcard-body">${esc(v)}</div></div>` : "";
}

function changeCard(ch) {
  if (!ch || (!ch.before && !ch.after)) return "";
  const type = ch.type ? `<span class="in-change-type">${esc(ch.type)}</span>` : "";
  return `<div class="rp-subcard in-change"><div class="rp-subcard-head">🔀 供應鏈變化 ${type}</div>
    <div class="in-change-flow">
      <div class="in-change-side"><span class="in-change-lbl">變化前</span><span>${esc(ch.before || "—")}</span></div>
      <span class="in-change-arrow">→</span>
      <div class="in-change-side after"><span class="in-change-lbl">變化後</span><span>${esc(ch.after || "—")}</span></div>
    </div></div>`;
}

function chainCard(sc) {
  if (!sc) return "";
  const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
  const row = (label, items) => items.length
    ? `<div class="in-chain-row"><span class="in-chain-lbl">${label}</span>
        <span class="in-chain-vals">${items.map(x => `<span class="rp-chipk">${esc(x)}</span>`).join("")}</span></div>`
    : "";
  const body = row("上游", arr(sc.upstream))
    + row("元件", arr(sc.component))
    + row("供應商", arr(sc.supplier))
    + row("客戶", arr(sc.customer))
    + row("終端市場", arr(sc.end_market));
  return body ? `<div class="rp-subcard rp-chain"><div class="rp-subcard-head">🔗 供應鏈鏈路</div>${body}</div>` : "";
}

function companiesCard(companies) {
  if (!companies || !companies.length) return "";
  const rows = companies.map(c => {
    const sym = c.ticker ? `<a class="rp-ticker" href="${esc(chartUrl(c.ticker))}" target="_blank" rel="noopener">${esc(c.ticker)}</a>` : "";
    const role = c.role ? `<span class="in-role">${esc(ROLE_LABEL[c.role] || c.role)}</span>` : "";
    const geo = [c.exchange, c.country].filter(Boolean).join(" · ");
    return `<div class="in-co-row">
      <span class="in-co-name">${esc(c.name || "")}</span>
      ${sym}${role}
      ${geo ? `<span class="in-co-geo">${esc(geo)}</span>` : ""}
    </div>`;
  }).join("");
  return `<div class="rp-subcard rp-alt"><div class="rp-subcard-head">🏢 相關公司 / 角色</div>
    <div class="in-co-list">${rows}</div></div>`;
}

function chipsCard(icon, label, items, cls = "") {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";
  return `<div class="rp-subcard rp-tags"><div class="rp-subcard-head">${icon} ${label}</div>
    <div class="rp-chiprow">${list.map(t => `<span class="rp-chipk ${cls}">${esc(t)}</span>`).join("")}</div></div>`;
}

function financialCard(f) {
  if (!f) return "";
  const money = (v, cur) => v == null ? null
    : `${(cur || "USD")} ${Number(v).toLocaleString("en-US")}`;
  const rows = [
    ["金額", money(f.amount, f.currency)],
    ["產能變動", f.capacity_change_pct != null ? `${f.capacity_change_pct}%` : null],
    ["價格變動", f.price_change_pct != null ? `${f.price_change_pct}%` : null],
    ["營收曝險", f.revenue_exposure_pct != null ? `${f.revenue_exposure_pct}%` : null],
    ["合約年限", f.contract_duration_years != null ? `${f.contract_duration_years} 年` : null],
    ["生效日", f.effective_date || null],
  ].filter(r => r[1] != null);
  if (!rows.length) return "";
  return `<div class="rp-subcard rp-effect"><div class="rp-subcard-head">💰 財務數據</div>
    <div class="in-fin-grid">${rows.map(([k, v]) =>
      `<div class="in-fin-item"><span class="in-fin-k">${esc(k)}</span><span class="in-fin-v">${esc(v)}</span></div>`).join("")}</div></div>`;
}

function sourcesCard(sources) {
  if (!sources || !sources.length) return "";
  const links = sources.map(o => {
    const badge = o.is_primary ? `<span class="in-src-primary">主要</span>` : "";
    const type = o.source_type ? `<span class="in-src-type">${esc(o.source_type)}</span>` : "";
    return `<a class="in-src-link" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.publisher || o.url)}${type}${badge}</a>`;
  }).join("");
  return `<div class="news-src in-src">來源：${links}</div>`;
}

// ── Main renderer ───────────────────────────────────────────────────────
export function detail(ev) {
  const tier = ev.importance_tier || "relevant";
  const tcls = tierClass(tier);
  const tickers = (ev.tickers || []).map(t =>
    `<a class="rp-ticker" href="${esc(chartUrl(t))}" target="_blank" rel="noopener" title="在 TradingView 看 ${esc(t)} 線圖">${esc(t)}</a>`).join("");
  const regions = (ev.regions || []).map(r => `<span class="in-region">${esc(r)}</span>`).join("");
  const secondary = (ev.event_type_secondary || []).map(t =>
    `<span class="in-etype in-etype-sec">${esc(eventTypeLabel(t))}</span>`).join("");

  return `<article class="rv-detail in-detail ${tcls}">
    <div class="rv-detail-meta in-meta">
      <span class="rp-date">${esc(fmtDate(ev.event_date))}</span>
      <span class="in-etype">${esc(eventTypeLabel(ev.event_type))}</span>
      ${secondary}
      ${tickers}
      ${regions}
      <span class="in-tier ${tcls}">${esc(TIER_LABEL[tier] || tier)}${ev.importance_score != null ? ` · ${esc(ev.importance_score)}` : ""}</span>
      ${ev.evidence_level ? `<span class="in-evi in-evi-${esc(ev.evidence_level)}">${esc(EVIDENCE_LABEL[ev.evidence_level] || ev.evidence_level)}</span>` : ""}
    </div>
    <h2 class="rv-detail-title">${esc(ev.title_zh || ev.title_original || "")}</h2>
    ${ev.title_original && ev.title_original !== ev.title_zh ? `<p class="in-title-en">${esc(ev.title_original)}</p>` : ""}
    <p class="rv-detail-body">${esc(ev.summary_zh || "")}</p>
    ${whyCard(ev.why_it_matters)}
    ${changeCard(ev.change)}
    ${chainCard(ev.supply_chain)}
    ${companiesCard(ev.companies)}
    ${financialCard(ev.financial_data)}
    ${chipsCard("🏷️", "題材 Themes", ev.themes)}
    ${chipsCard("🧩", "產品 / 材料", [...(ev.products || []), ...(ev.materials || [])])}
    ${chipsCard("🔍", "搜尋關鍵字", ev.search_keywords, "in-kw")}
    ${tickerTrendCard(ev.tickers)}
    ${sourcesCard(ev.sources)}
  </article>`;
}
