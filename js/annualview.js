// annualview.js — master/detail view for the annual-report highlights page.
// Left column = a searchable company directory (companies grouped, each with
// its fiscal years) instead of a timeline/calendar — annual reports are sparse
// (one per company per year), so grouping by company scales cleanly and stays
// tidy. Right column = a tabbed rich-card view of the selected report. A
// separate section renders a single-company multi-year comparison.

import { loadDocs, deleteReport, esc, chartUrl } from "./reports.js";

// ── Stance (headline.stance) → colour + label ──────────────────────────
export const STANCE = {
  bullish:          { label: "偏多", cls: "pos", icon: "▲▲" },
  slightly_bullish: { label: "偏多", cls: "pos", icon: "▲" },
  neutral:          { label: "中性", cls: "neu", icon: "—" },
  slightly_bearish: { label: "偏空", cls: "neg", icon: "▽" },
  bearish:          { label: "偏空", cls: "neg", icon: "▼▼" },
};
export function stanceInfo(v) { return STANCE[v] || STANCE.neutral; }

// ── Small formatting helpers ───────────────────────────────────────────
const UNIT = { thousand: "千", million: "百萬", billion: "十億" };
export function moneyStr(m) {
  if (!m || m.value == null || m.value === "") return "";
  const num = Number(m.value);
  const shown = Number.isFinite(num) ? num.toLocaleString("en-US") : String(m.value);
  const u = UNIT[m.unit] || "";
  return `${shown}${u ? " " + u : ""}${m.currency ? " " + m.currency : ""}`;
}
export function pctStr(n) {
  if (n == null || n === "") return "";
  const num = Number(n);
  return Number.isFinite(num) ? `${num}%` : "";
}
function yoyTag(n) {
  if (n == null || n === "") return "";
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  const cls = num > 0 ? "pos" : num < 0 ? "neg" : "neu";
  const arr = num > 0 ? "▲" : num < 0 ? "▼" : "—";
  return `<span class="ar-yoy ${cls}">${arr} ${Math.abs(num)}% YoY</span>`;
}
const SEV = { high: { t: "高", c: "neg" }, medium: { t: "中", c: "neu" }, low: { t: "低", c: "pos" } };
function sevTag(v, prefix = "") { const s = SEV[v]; return s ? `<span class="ar-badge ${s.c}">${prefix}${s.t}</span>` : ""; }
const IMPACT = { high: "高", medium: "中", low: "低", unknown: "?" };

function chips(arr, cls = "") {
  const a = (arr || []).filter(x => x != null && String(x).trim());
  if (!a.length) return "";
  return `<div class="ar-chips">${a.map(x => `<span class="ar-chip ${cls}">${esc(x)}</span>`).join("")}</div>`;
}
function bullets(arr) {
  const a = (arr || []).filter(x => x != null && String(x).trim());
  if (!a.length) return "";
  return `<ul class="ar-ul">${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
function para(label, text) {
  if (!text || !String(text).trim()) return "";
  return `<p class="ar-para">${label ? `<b>${esc(label)}</b>` : ""}${esc(text)}</p>`;
}
function bar(label, pct, sub) {
  const p = Number(pct);
  const w = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
  const valTxt = (pct != null && pct !== "" && Number.isFinite(p)) ? `${p}%` : "";
  return `<div class="ar-bar"><div class="ar-bar-top"><span class="ar-bar-label">${esc(label)}</span>
    <span class="ar-bar-val">${valTxt}${sub ? ` <span class="ar-bar-sub">${sub}</span>` : ""}</span></div>
    <div class="ar-bar-track"><span class="ar-bar-fill" style="width:${w}%"></span></div></div>`;
}
// A titled sub-card; returns "" when the body is empty so empty sections vanish.
function card(cls, icon, title, body) {
  if (!body || !String(body).trim()) return "";
  return `<div class="ar-card ${cls}"><div class="ar-card-h">${icon} ${esc(title)}</div><div class="ar-card-b">${body}</div></div>`;
}
function kpi(label, value, sub) {
  if (value == null || value === "") return "";
  return `<div class="ar-kpi"><span class="ar-kpi-label">${esc(label)}</span>
    <span class="ar-kpi-val">${value}</span>${sub ? `<span class="ar-kpi-sub">${sub}</span>` : ""}</div>`;
}

// ── Detail: hero + tabs ────────────────────────────────────────────────
function heroHTML(d) {
  const data = d.data || {};
  const c = data.company || {}, doc = data.document || {}, h = data.headline || {};
  const st = stanceInfo(d._stance);
  const ticker = c.ticker
    ? `<a class="ar-ticker" href="${esc(chartUrl(c.ticker))}" target="_blank" rel="noopener" title="在 TradingView 看 ${esc(c.ticker)} 線圖">${esc(c.ticker)} 📈</a>`
    : "";
  const meta = [doc.market, doc.document_type, c.exchange].filter(Boolean).map(esc).join(" · ");
  return `<div class="ar-hero ${st.cls}">
    <div class="ar-hero-top">
      <div class="ar-hero-id">
        <span class="ar-hero-name">${esc(c.name || d._company)}</span>
        ${c.name_english ? `<span class="ar-hero-en">${esc(c.name_english)}</span>` : ""}
        ${ticker}
      </div>
      <div class="ar-hero-tags">
        <span class="ar-yearbadge">FY ${esc(d._year)}</span>
        <span class="ar-stance ${st.cls}">${st.icon} ${st.label}</span>
        ${h.confidence ? `<span class="ar-conf">信心 ${esc(h.confidence)}</span>` : ""}
      </div>
    </div>
    ${meta ? `<div class="ar-hero-meta">${meta}${c.industry ? " · " + esc(c.industry) : ""}</div>` : ""}
    ${h.title ? `<h2 class="ar-hero-title">${esc(h.title)}</h2>` : ""}
    ${h.one_sentence_summary ? `<p class="ar-hero-sum">${esc(h.one_sentence_summary)}</p>` : ""}
    ${chips(data.tags, "k")}
  </div>`;
}

function tabOverview(d) {
  const data = d.data || {};
  const h = data.headline || {}, fh = data.financial_highlights || {}, iv = data.investment_view || {};
  const kpis = [
    kpi("營收", moneyStr(fh.revenue), yoyTag(fh.revenue && fh.revenue.yoy_change_pct)),
    kpi("毛利率", pctStr(fh.gross_margin_pct), fh.gross_margin_yoy_change_ppt != null && fh.gross_margin_yoy_change_ppt !== "" ? `${Number(fh.gross_margin_yoy_change_ppt) > 0 ? "+" : ""}${esc(fh.gross_margin_yoy_change_ppt)} ppt` : ""),
    kpi("營益率", pctStr(fh.operating_margin_pct)),
    kpi("淨利", moneyStr(fh.net_income), yoyTag(fh.net_income && fh.net_income.yoy_change_pct)),
    kpi("EPS", fh.eps != null && fh.eps !== "" ? esc(fh.eps) : ""),
    kpi("營運現金流", moneyStr(fh.operating_cash_flow)),
    kpi("自由現金流", moneyStr(fh.free_cash_flow)),
    kpi("資本支出", moneyStr(fh.capital_expenditure)),
  ].filter(Boolean).join("");
  const kpiGrid = kpis ? `<div class="ar-kpis">${kpis}</div>` : "";
  const changeBody = [
    para("較去年關鍵變化：", h.key_change_vs_prior_year),
    para("核心投資問題：", h.main_investment_question),
    para("信心理由：", h.confidence_reason),
  ].join("");
  return kpiGrid
    + card("t-key", "🔑", "本期焦點", changeBody)
    + card("t-invest", "🎯", "投資主軸", para("", iv.core_thesis) + bullets(iv.thesis));
}

function tabPositioning(d) {
  const data = d.data || {};
  const c = data.company || {}, im = data.industry_and_market || {};
  const moats = (c.competitive_moats || []).map(m =>
    `<div class="ar-row"><span class="ar-row-t">${esc(m.type || "")}</span>
      ${m.strength ? `<span class="ar-badge ${m.strength === "strong" ? "pos" : m.strength === "weak" ? "neg" : "neu"}">${esc(m.strength)}</span>` : ""}
      <div class="ar-row-b">${esc(m.description || "")}${m.evidence ? ` <span class="ar-muted">（${esc(m.evidence)}）</span>` : ""}</div></div>`).join("");
  const companyBody = [
    para("產業：", [c.industry, c.industry_subcategory].filter(Boolean).join(" / ")),
    para("", c.industry_description),
    para("", c.business_summary),
    para("商業模式：", c.business_model),
    c.value_chain_position && c.value_chain_position.length ? `<div class="ar-sub">價值鏈定位${chips(c.value_chain_position, "v")}</div>` : "",
    c.core_competencies && c.core_competencies.length ? `<div class="ar-sub">核心競爭力${bullets(c.core_competencies)}</div>` : "",
  ].join("");
  const techTrends = (im.technology_trends || []).map(t =>
    `<div class="ar-row"><span class="ar-row-t">${esc(t.technology || "")}</span>
      ${t.company_position ? `<span class="ar-badge neu">${esc(t.company_position)}</span>` : ""}
      <div class="ar-row-b">${esc(t.impact_on_company || "")}</div></div>`).join("");
  const share = (im.market_size_and_share || []).map(s =>
    `<div class="ar-row"><span class="ar-row-t">${esc(s.market || "")}</span>
      <div class="ar-row-b">${[s.market_size && `規模 ${esc(s.market_size)}`, s.company_market_share_pct != null && `市占 ${esc(s.company_market_share_pct)}%`, s.company_ranking && `排名 ${esc(s.company_ranking)}`].filter(Boolean).join("　")}</div></div>`).join("");
  return card("t-pos", "🧭", "公司與產業定位", companyBody)
    + card("t-moat", "🛡️", "競爭護城河", moats)
    + card("t-ind", "📊", "產業現況與技術趨勢", para("", im.industry_current_status) + techTrends + share);
}

function productCard(p) {
  const custs = (p.main_customers || []).map(x => x.company_name).filter(Boolean);
  return `<div class="ar-item">
    <div class="ar-item-h"><span class="ar-item-t">${esc(p.product_name || "")}</span>
      ${p.product_status ? `<span class="ar-badge neu">${esc(p.product_status)}</span>` : ""}
      ${p.strategic_role ? `<span class="ar-tagk">${esc(p.strategic_role)}</span>` : ""}
      ${p.revenue_percentage != null ? `<span class="ar-item-pct">營收占比 ${esc(p.revenue_percentage)}%</span>` : ""}</div>
    ${p.product_description ? `<p class="ar-para">${esc(p.product_description)}</p>` : ""}
    ${p.main_applications && p.main_applications.length ? `<div class="ar-sub">應用${chips(p.main_applications)}</div>` : ""}
    ${custs.length ? `<div class="ar-sub">主要客戶${chips(custs, "c")}</div>` : ""}
    ${p.competitive_advantages && p.competitive_advantages.length ? `<div class="ar-sub ar-pos-sub">優勢${bullets(p.competitive_advantages)}</div>` : ""}
    ${p.competitive_weaknesses && p.competitive_weaknesses.length ? `<div class="ar-sub ar-neg-sub">弱點${bullets(p.competitive_weaknesses)}</div>` : ""}
  </div>`;
}
function tabProducts(d) {
  const data = d.data || {};
  const pp = data.product_portfolio || {}, rd = data.research_and_development || {};
  const core = (pp.current_core_products || []).map(productCard).join("");
  const neu = (pp.newly_commercialized_products || []).map(p =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(p.product_name || "")}</span>
      ${p.current_stage ? `<span class="ar-badge neu">${esc(p.current_stage)}</span>` : ""}
      ${p.expected_contribution ? `<span class="ar-tagk">貢獻 ${esc(IMPACT[p.expected_contribution] || p.expected_contribution)}</span>` : ""}</div>
      ${para("時程：", p.commercialization_timing)}${para("進度：", p.actual_progress)}
      ${chips(p.target_application)}</div>`).join("");
  const dev = (pp.products_under_development || []).map(p =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(p.product_name || "")}</span>
      ${p.development_stage ? `<span class="ar-badge neu">${esc(p.development_stage)}</span>` : ""}</div>
      ${para("", p.technology_description)}${para("量產時程：", p.expected_mass_production_timing)}
      ${p.technical_or_commercial_risks && p.technical_or_commercial_risks.length ? `<div class="ar-sub ar-neg-sub">風險${bullets(p.technical_or_commercial_risks)}</div>` : ""}</div>`).join("");
  const rdExp = rd.rd_expense || {};
  const rdKpis = [
    kpi("研發費用", moneyStr(rdExp), yoyTag(rdExp.yoy_change_pct)),
    kpi("佔營收比", pctStr(rdExp.percentage_of_revenue)),
    kpi("研發人數", rd.rd_headcount != null ? esc(rd.rd_headcount) : ""),
  ].filter(Boolean).join("");
  const rdDone = (rd.successfully_developed_products_last_year || []).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.product_or_technology || "")}</span>
      ${x.commercial_status ? `<span class="ar-badge neu">${esc(x.commercial_status)}</span>` : ""}
      <div class="ar-row-b">${esc(x.achievement_description || "")}</div></div>`).join("");
  return card("t-prod", "📦", "主力產品", core)
    + card("t-new", "✨", "新產品與商業化", neu)
    + card("t-dev", "🔬", "研發中產品", dev)
    + card("t-rd", "🧪", "研發投入", (rdKpis ? `<div class="ar-kpis">${rdKpis}</div>` : "") + rdDone);
}

function tabRevenue(d) {
  const data = d.data || {};
  const segs = data.business_segments || [], mix = data.revenue_mix || [], fh = data.financial_highlights || {};
  const segBars = segs.map(s =>
    bar(s.segment_name || "", s.revenue_percentage,
      [s.growth_status && `<span class="ar-mini">${esc(s.growth_status)}</span>`, s.operating_margin_pct != null && `營益率 ${esc(s.operating_margin_pct)}%`, yoyTag(s.revenue_yoy_change_pct)].filter(Boolean).join(" "))
  ).join("");
  const mixBars = mix.map(m =>
    bar(`${m.name || ""}${m.dimension ? `（${m.dimension}）` : ""}`, m.percentage, yoyTag(m.yoy_change_pct))
  ).join("");
  const fhKpis = [
    kpi("營收", moneyStr(fh.revenue), yoyTag(fh.revenue && fh.revenue.yoy_change_pct)),
    kpi("毛利", moneyStr(fh.gross_profit), yoyTag(fh.gross_profit && fh.gross_profit.yoy_change_pct)),
    kpi("毛利率", pctStr(fh.gross_margin_pct)),
    kpi("營業利益", moneyStr(fh.operating_income), yoyTag(fh.operating_income && fh.operating_income.yoy_change_pct)),
    kpi("淨利", moneyStr(fh.net_income), yoyTag(fh.net_income && fh.net_income.yoy_change_pct)),
    kpi("EPS", fh.eps != null && fh.eps !== "" ? esc(fh.eps) : ""),
    kpi("在手訂單", moneyStr(fh.backlog_or_order_book), fh.backlog_or_order_book && fh.backlog_or_order_book.coverage_period ? esc(fh.backlog_or_order_book.coverage_period) : ""),
    kpi("存貨天數", fh.inventory && fh.inventory.inventory_days != null ? esc(fh.inventory.inventory_days) : ""),
  ].filter(Boolean).join("");
  return card("t-seg", "🏢", "營運部門", segBars)
    + card("t-mix", "🥧", "營收組成", mixBars)
    + card("t-fin", "💰", "財務重點", fhKpis ? `<div class="ar-kpis">${fhKpis}</div>` : "");
}

function tabCustomers(d) {
  const data = d.data || {};
  const cu = data.customers || {};
  const named = (cu.named_customers || []).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.company_name || "")}</span>
      ${x.importance ? `<span class="ar-badge ${x.importance === "high" ? "neg" : "neu"}">重要度 ${esc(IMPACT[x.importance] || x.importance)}</span>` : ""}
      ${x.revenue_percentage != null ? `<span class="ar-item-pct">${esc(x.revenue_percentage)}%</span>` : ""}
      <div class="ar-row-b">${[x.customer_type, x.country_or_region, x.relationship_status].filter(Boolean).map(esc).join(" · ")}${x.description ? " — " + esc(x.description) : ""}</div></div>`).join("");
  const conc = (cu.customer_concentration || []).map(x =>
    bar(x.customer_name_or_label || "", x.revenue_percentage,
      [x.trend && `<span class="ar-mini">${esc(x.trend)}</span>`, x.prior_year_percentage != null && `去年 ${esc(x.prior_year_percentage)}%`].filter(Boolean).join(" "))).join("");
  const regions = (cu.customer_regions || []).map(r =>
    bar(r.region || "", r.revenue_percentage, yoyTag(r.yoy_change_pct))).join("");
  const changes = (cu.customer_changes || []).map(x =>
    `<div class="ar-row"><span class="ar-tagk">${esc(x.event || "")}</span>
      <div class="ar-row-b">${esc(x.customer_name_or_description || "")}${x.financial_impact ? " — " + esc(x.financial_impact) : ""}</div></div>`).join("");
  return card("t-cust", "🤝", "主要客戶", named)
    + card("t-conc", "⚠️", "客戶集中度", conc)
    + card("t-region", "🌏", "客戶地區分布", regions)
    + card("t-cchg", "🔁", "客戶變動", changes);
}

// Supply chain — an upstream → company → downstream flow diagram.
function flowNode(title, subs) {
  const s = (subs || []).filter(x => x != null && String(x).trim());
  return `<div class="ar-fnode"><span class="ar-fnode-t">${esc(title)}</span>${
    s.map(x => `<span class="ar-fnode-s">${esc(x)}</span>`).join("")}</div>`;
}
function tabSupply(d) {
  const data = d.data || {};
  const sc = data.supply_chain || {}, c = data.company || {};
  const up = sc.upstream_materials_and_components || [];
  const mfg = sc.manufacturing_and_operations || [];
  const down = sc.downstream_channels_and_customers || [];
  let flow = "";
  if (up.length || mfg.length || down.length) {
    const upNodes = up.map(m => flowNode(m.material_or_component || "",
      [m.category, (m.major_suppliers || []).map(s => s.company_name).filter(Boolean).join("、"),
       m.supply_status && `供給:${m.supply_status}`])).join("") || `<div class="ar-fnode empty">—</div>`;
    const midNodes = mfg.length
      ? mfg.map(m => flowNode(m.site_name || m.country_or_region || "製造",
          [m.country_or_region, (m.main_products_or_processes || []).join("、"),
           m.utilization_rate_pct != null && `稼動率 ${m.utilization_rate_pct}%`])).join("")
      : flowNode(c.name || d._company, [c.business_model]);
    const downNodes = down.map(x => flowNode(x.company_or_channel || "",
      [x.type, x.region, x.importance && `重要度:${IMPACT[x.importance] || x.importance}`])).join("") || `<div class="ar-fnode empty">—</div>`;
    flow = `<div class="ar-flow">
      <div class="ar-fcol"><div class="ar-fcol-h up">上游 · 材料/供應商</div>${upNodes}</div>
      <div class="ar-farrow">→</div>
      <div class="ar-fcol"><div class="ar-fcol-h mid">本公司 · 製造/營運</div><div class="ar-fcompany">${esc(c.name || d._company)}</div>${midNodes}</div>
      <div class="ar-farrow">→</div>
      <div class="ar-fcol"><div class="ar-fcol-h down">下游 · 通路/客戶</div>${downNodes}</div>
    </div>`;
  }
  const outsourcing = chips((sc.outsourcing_partners || []).map(o => `${o.company_name || ""}${o.service_type ? "（" + o.service_type + "）" : ""}`), "c");
  const risks = (sc.supply_chain_risks || []).map(r =>
    `<div class="ar-row"><span class="ar-row-t">${esc(r.risk || "")}</span>${sevTag(r.severity, "嚴重度 ")}
      ${r.trend ? `<span class="ar-mini">${esc(r.trend)}</span>` : ""}
      <div class="ar-row-b">${[r.affected_material_product_or_site, r.mitigation && `因應：${r.mitigation}`].filter(Boolean).map(esc).join(" · ")}</div></div>`).join("");
  return (flow ? `<div class="ar-card t-supply"><div class="ar-card-h">🔗 供應鏈流向</div><div class="ar-card-b">${flow}</div></div>` : "")
    + card("t-out", "🏭", "委外夥伴", outsourcing)
    + card("t-scrisk", "🚨", "供應鏈風險", risks);
}

function tabCapacity(d) {
  const data = d.data || {};
  const sc = data.supply_chain || {}, fs = data.future_strategy || {};
  const sites = (sc.manufacturing_and_operations || []).map(m =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(m.site_name || m.country_or_region || "")}</span>
      ${m.current_status ? `<span class="ar-badge neu">${esc(m.current_status)}</span>` : ""}
      ${m.utilization_rate_pct != null ? `<span class="ar-item-pct">稼動率 ${esc(m.utilization_rate_pct)}%</span>` : ""}</div>
      ${para("產能：", m.capacity)}${para("擴產：", m.expansion_plan)}
      ${m.bottlenecks && m.bottlenecks.length ? `<div class="ar-sub ar-neg-sub">瓶頸${bullets(m.bottlenecks)}</div>` : ""}</div>`).join("");
  const exp = (fs.capacity_expansion_plans || []).map(x =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(x.site_or_project || "")}</span>
      ${x.country_or_region ? `<span class="ar-tagk">${esc(x.country_or_region)}</span>` : ""}</div>
      ${para("投資：", x.investment_amount)}${para("新增產能：", x.capacity_increase)}
      ${para("量產時程：", x.mass_production_timing || x.completion_timing)}${para("預期影響：", x.expected_impact)}
      ${x.risks && x.risks.length ? `<div class="ar-sub ar-neg-sub">風險${bullets(x.risks)}</div>` : ""}</div>`).join("");
  const ma = (fs.ma_and_partnerships || []).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.partner_or_target || "")}</span>
      <span class="ar-tagk">${esc(x.type || "")}</span>${x.current_status ? `<span class="ar-badge neu">${esc(x.current_status)}</span>` : ""}
      <div class="ar-row-b">${esc(x.purpose || "")}${x.expected_impact ? " — " + esc(x.expected_impact) : ""}</div></div>`).join("");
  return card("t-cap", "🏗️", "產能與營運據點", sites)
    + card("t-exp", "📈", "擴產計畫", exp)
    + card("t-ma", "🤝", "併購與策略合作", ma);
}

function tabCompetition(d) {
  const data = d.data || {};
  const cp = data.competition || {};
  const comps = (cp.named_competitors || []).map(x =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(x.company_name || "")}</span>
      ${x.ticker ? `<span class="ar-tagk">${esc(x.ticker)}</span>` : ""}
      ${x.relative_position ? `<span class="ar-badge ${x.relative_position === "stronger" ? "neg" : x.relative_position === "weaker" ? "pos" : "neu"}">相對 ${esc(x.relative_position)}</span>` : ""}</div>
      ${x.competing_products_or_markets && x.competing_products_or_markets.length ? `<div class="ar-sub">競爭領域${chips(x.competing_products_or_markets)}</div>` : ""}
      ${x.company_advantages_vs_competitor && x.company_advantages_vs_competitor.length ? `<div class="ar-sub ar-pos-sub">我方優勢${bullets(x.company_advantages_vs_competitor)}</div>` : ""}
      ${x.company_disadvantages_vs_competitor && x.company_disadvantages_vs_competitor.length ? `<div class="ar-sub ar-neg-sub">我方劣勢${bullets(x.company_disadvantages_vs_competitor)}</div>` : ""}</div>`).join("");
  const factors = (cp.competitive_factors || []).map(f =>
    `<div class="ar-row"><span class="ar-row-t">${esc(f.factor || "")}</span>
      <span class="ar-badge ${f.company_position === "strong" ? "pos" : f.company_position === "weak" ? "neg" : "neu"}">${esc(f.company_position || "")}</span>
      <div class="ar-row-b">${esc(f.description || "")}</div></div>`).join("");
  return card("t-comp", "⚔️", "競爭格局", para("", cp.competitive_environment_summary) + comps)
    + card("t-factor", "🎚️", "競爭要素定位", factors);
}

function tabChallenges(d) {
  const data = d.data || {};
  const challenges = (data.company_challenges || []).map(x =>
    `<div class="ar-item ${SEV[x.severity] ? "sev-" + SEV[x.severity].c : ""}"><div class="ar-item-h">
      <span class="ar-item-t">${esc(x.title || "")}</span>${sevTag(x.severity, "嚴重 ")}
      ${x.trend ? `<span class="ar-mini">${esc(x.trend)}</span>` : ""}</div>
      ${para("", x.description)}${para("影響：", x.financial_or_operational_impact)}${para("因應：", x.management_response)}
      ${chips(x.affected_products_or_segments)}</div>`).join("");
  const risks = (data.risks || []).map(x =>
    `<div class="ar-item ${SEV[x.severity] ? "sev-" + SEV[x.severity].c : ""}"><div class="ar-item-h">
      <span class="ar-item-t">${esc(x.title || "")}</span>${sevTag(x.severity, "嚴重 ")}
      ${x.probability ? `<span class="ar-mini">機率 ${esc(IMPACT[x.probability] || x.probability)}</span>` : ""}</div>
      ${para("", x.detail)}${para("潛在影響：", x.potential_impact)}${para("因應：", x.mitigation)}</div>`).join("");
  const flags = (data.financial_and_accounting_flags || []).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.title || "")}</span>${sevTag(x.severity)}
      <div class="ar-row-b">${esc(x.detail || "")}${x.quantitative_evidence ? ` <span class="ar-muted">（${esc(x.quantitative_evidence)}）</span>` : ""}</div></div>`).join("");
  const gov = (data.governance_flags || []).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.title || "")}</span>${sevTag(x.severity)}
      <div class="ar-row-b">${esc(x.detail || "")}</div></div>`).join("");
  return card("t-chal", "🧗", "公司目前困境", challenges)
    + card("t-risk", "⚠️", "風險", risks)
    + card("t-flag", "🚩", "財務 / 會計紅旗", flags)
    + card("t-gov", "🏛️", "公司治理紅旗", gov);
}

function tabOutlook(d) {
  const data = d.data || {};
  const im = data.industry_and_market || {}, fs = data.future_strategy || {};
  const outlook = (im.industry_outlook || []).map(o =>
    `<div class="ar-row"><span class="ar-row-t">${esc(o.theme || "")}</span>
      <span class="ar-badge ${o.direction === "positive" ? "pos" : o.direction === "negative" ? "neg" : "neu"}">${esc(o.direction || "")}</span>
      ${o.time_horizon ? `<span class="ar-mini">${esc(o.time_horizon)}</span>` : ""}
      <div class="ar-row-b">${esc(o.description || "")}</div></div>`).join("");
  const drivers = (data.growth_drivers || []).map(x =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(x.title || "")}</span>
      ${x.expected_impact ? `<span class="ar-badge pos">影響 ${esc(IMPACT[x.expected_impact] || x.expected_impact)}</span>` : ""}
      ${x.time_horizon ? `<span class="ar-mini">${esc(x.time_horizon)}</span>` : ""}
      ${x.current_stage ? `<span class="ar-tagk">${esc(x.current_stage)}</span>` : ""}</div>
      ${para("", x.detail)}${para("量化目標：", x.quantitative_target)}${chips(x.related_products_or_segments)}</div>`).join("");
  const priorities = (fs.management_priorities || []).map(p =>
    `<div class="ar-row"><span class="ar-row-t">${esc(p.priority || "")}</span>
      ${p.time_horizon ? `<span class="ar-mini">${esc(p.time_horizon)}</span>` : ""}
      <div class="ar-row-b">${[p.target, p.progress].filter(Boolean).map(esc).join(" · ")}</div></div>`).join("");
  return card("t-outlook", "🔭", "產業前景", outlook)
    + card("t-driver", "🚀", "成長題材", drivers)
    + card("t-prio", "📌", "管理層優先事項", priorities);
}

function scenarioList(arr, cls) {
  return (arr || []).map(s => `<div class="ar-scn ${cls}">
    <div class="ar-scn-t">${esc(s.scenario || "")}</div>
    ${s.expected_impact ? `<div class="ar-scn-b">${esc(s.expected_impact)}</div>` : ""}
    ${s.expected_outcome ? `<div class="ar-scn-b">${esc(s.expected_outcome)}</div>` : ""}
    ${(s.required_conditions || s.trigger_conditions) ? chips(s.required_conditions || s.trigger_conditions) : ""}
  </div>`).join("");
}
function tabInvest(d) {
  const data = d.data || {};
  const iv = data.investment_view || {};
  const bull = scenarioList(iv.bull_case, "pos"), base = scenarioList(iv.base_case, "neu"), bear = scenarioList(iv.bear_case, "neg");
  const casesInner = [
    bull && `<div class="ar-case-col"><div class="ar-case-h pos">🐂 多方</div>${bull}</div>`,
    base && `<div class="ar-case-col"><div class="ar-case-h neu">⚖️ 基本</div>${base}</div>`,
    bear && `<div class="ar-case-col"><div class="ar-case-h neg">🐻 空方</div>${bear}</div>`,
  ].filter(Boolean).join("");
  const cases = `<div class="ar-cases">${casesInner}</div>`;
  const catalysts = (iv.catalysts || []).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.event || "")}</span>
      ${x.expected_timing ? `<span class="ar-mini">${esc(x.expected_timing)}</span>` : ""}
      ${x.potential_impact ? `<span class="ar-badge neu">影響 ${esc(IMPACT[x.potential_impact] || x.potential_impact)}</span>` : ""}</div>`).join("");
  const metrics = (iv.monitoring_metrics || []).map(m =>
    `<div class="ar-row"><span class="ar-row-t">${esc(m.metric || "")}</span>
      <div class="ar-row-b">${esc(m.reason || "")}${m.positive_signal ? ` <span class="ar-pos-sub">↑ ${esc(m.positive_signal)}</span>` : ""}${m.negative_signal ? ` <span class="ar-neg-sub">↓ ${esc(m.negative_signal)}</span>` : ""}</div></div>`).join("");
  return card("t-thesis", "🎯", "核心論點", para("", iv.core_thesis) + bullets(iv.thesis))
    + (casesInner ? `<div class="ar-card t-cases"><div class="ar-card-h">🎲 情境分析</div><div class="ar-card-b">${cases}</div></div>` : "")
    + card("t-cat", "⏰", "催化劑", catalysts)
    + card("t-metric", "📡", "追蹤指標", metrics)
    + card("t-q", "❓", "下期年報要看的問題", bullets(iv.key_questions_for_next_report))
    + card("t-final", "✅", "總評", para("", iv.final_assessment));
}

const TABS = [
  { key: "overview", label: "總覽", fn: tabOverview },
  { key: "pos", label: "定位", fn: tabPositioning },
  { key: "prod", label: "產品", fn: tabProducts },
  { key: "rev", label: "營收", fn: tabRevenue },
  { key: "cust", label: "客戶", fn: tabCustomers },
  { key: "supply", label: "供應鏈", fn: tabSupply },
  { key: "cap", label: "產能", fn: tabCapacity },
  { key: "comp", label: "競爭", fn: tabCompetition },
  { key: "chal", label: "困境/風險", fn: tabChallenges },
  { key: "outlook", label: "前景", fn: tabOutlook },
  { key: "invest", label: "投資判斷", fn: tabInvest },
];

function detailHTML(d) {
  const tabs = TABS.map(t => ({ ...t, html: t.fn(d) })).filter(t => t.html && t.html.trim());
  const nav = tabs.map((t, i) =>
    `<button class="ar-tab${i === 0 ? " active" : ""}" data-tab="${t.key}">${t.label}</button>`).join("");
  const bodies = tabs.map((t, i) =>
    `<div class="ar-tabpane${i === 0 ? " active" : ""}" data-pane="${t.key}">${t.html}</div>`).join("");
  return `<article class="ar-detail">
    ${heroHTML(d)}
    <div class="ar-tabnav">${nav}</div>
    <div class="ar-tabbody">${bodies}</div>
  </article>`;
}

// ── Mount ──────────────────────────────────────────────────────────────
export async function mountAnnualView(opts) {
  const { root, compareRoot, compareSelect, onData } = opts;
  let all = [], selectedId = null, search = "", canDelete = false;

  root.innerHTML = `
    <div class="ar-split">
      <div class="ar-left">
        <div class="ar-search"><input type="search" id="arSearch" placeholder="搜尋公司 / 代號…" autocomplete="off" /></div>
        <div class="ar-dir" id="arDir"></div>
      </div>
      <div class="ar-right" id="arRight"></div>
    </div>`;
  const dirEl = root.querySelector("#arDir");
  const rightEl = root.querySelector("#arRight");
  const searchEl = root.querySelector("#arSearch");

  const emptyRight = () => `<div class="rv-empty rv-empty-right">← 點選左側公司年度，年報重點會顯示在這裡</div>`;

  function groupKey(d) { return d._ticker || d._company; }
  function matches(d) {
    if (!search) return true;
    const q = search.toLowerCase();
    return [d._company, d._company_en, d._ticker, d._industry].filter(Boolean).some(x => String(x).toLowerCase().includes(q));
  }

  function renderLeft() {
    const items = all.filter(matches);
    if (!items.length) { dirEl.innerHTML = `<div class="rv-empty">${all.length ? "找不到符合的公司。" : "尚無年報資料。"}</div>`; return; }
    const groups = {};
    items.forEach(d => { const k = groupKey(d); (groups[k] = groups[k] || { name: d._company, ticker: d._ticker, industry: d._industry, market: d._market, items: [] }).items.push(d); });
    const keys = Object.keys(groups).sort((a, b) => String(groups[a].name).localeCompare(String(groups[b].name)));
    dirEl.innerHTML = keys.map(k => {
      const g = groups[k];
      g.items.sort((a, b) => String(b._year).localeCompare(String(a._year)));
      const rows = g.items.map(d => {
        const st = stanceInfo(d._stance);
        const h = (d.data && d.data.headline) || {};
        return `<div class="ar-yearrow${d.id === selectedId ? " active" : ""}" data-id="${esc(d.id)}" role="button" tabindex="0">
          <span class="ar-dot ${st.cls}"></span>
          <span class="ar-yr">FY ${esc(d._year)}</span>
          <span class="ar-yr-title">${esc(h.title || h.one_sentence_summary || d._industry || "")}</span>
          <span class="ar-del" data-del="${esc(d.id)}" role="button" title="刪除" aria-label="刪除">×</span>
        </div>`;
      }).join("");
      return `<section class="ar-group open" data-key="${esc(k)}">
        <button type="button" class="ar-group-h">
          <span class="ar-group-chev">▾</span>
          <span class="ar-group-name">${esc(g.name)}</span>
          ${g.ticker ? `<span class="ar-group-tk">${esc(g.ticker)}</span>` : ""}
          <span class="ar-group-n">${g.items.length}</span>
        </button>
        <div class="ar-group-body">${rows}</div>
      </section>`;
    }).join("");
  }

  function selectItem(id) {
    selectedId = id;
    const d = all.find(x => x.id === id);
    rightEl.innerHTML = d ? detailHTML(d) : emptyRight();
    dirEl.querySelectorAll(".ar-yearrow").forEach(n => n.classList.toggle("active", n.dataset.id === id));
    if (window.innerWidth <= 900) rightEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDelete(id) {
    if (!canDelete) return;
    const d = all.find(x => x.id === id);
    const label = d ? `${d._company} FY${d._year}` : id;
    if (!window.confirm(`確定刪除「${label}」？此動作無法復原。`)) return;
    try {
      await deleteReport("annual_reports", id);
      if (selectedId === id) { selectedId = null; rightEl.innerHTML = emptyRight(); }
      await reload();
    } catch (e) {
      window.alert("刪除失敗：" + (e.code === "permission-denied" ? "需以白名單管理員登入。" : e.message));
    }
  }

  dirEl.addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); handleDelete(del.dataset.del); return; }
    const gh = e.target.closest(".ar-group-h");
    if (gh) { gh.closest(".ar-group").classList.toggle("open"); return; }
    const row = e.target.closest("[data-id]");
    if (row) selectItem(row.dataset.id);
  });
  dirEl.addEventListener("keydown", e => {
    if (e.key === "Enter") { const row = e.target.closest(".ar-yearrow"); if (row) selectItem(row.dataset.id); }
  });

  // Tab switching within the detail (event delegation on the right panel).
  rightEl.addEventListener("click", e => {
    const tab = e.target.closest(".ar-tab");
    if (!tab) return;
    const pane = tab.dataset.tab;
    rightEl.querySelectorAll(".ar-tab").forEach(t => t.classList.toggle("active", t === tab));
    rightEl.querySelectorAll(".ar-tabpane").forEach(p => p.classList.toggle("active", p.dataset.pane === pane));
    rightEl.querySelector(".ar-tabbody").scrollTop = 0;
  });

  let searchTimer;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = searchEl.value.trim(); renderLeft(); }, 120);
  });

  // ── Multi-year comparison ────────────────────────────────────────────
  let cmpKey = null;
  function cmpCol(d) {
    const data = d.data || {}, fh = data.financial_highlights || {}, h = data.headline || {};
    const st = stanceInfo(d._stance);
    const kpis = [
      kpi("營收", moneyStr(fh.revenue), yoyTag(fh.revenue && fh.revenue.yoy_change_pct)),
      kpi("毛利率", pctStr(fh.gross_margin_pct)),
      kpi("營益率", pctStr(fh.operating_margin_pct)),
      kpi("EPS", fh.eps != null && fh.eps !== "" ? esc(fh.eps) : ""),
    ].filter(Boolean).join("");
    const topChal = (data.company_challenges || [])[0];
    const topDrv = (data.growth_drivers || [])[0];
    return `<div class="ar-cmp-col ${st.cls}">
      <div class="ar-cmp-top"><span class="ar-cmp-fy">FY ${esc(d._year)}</span><span class="ar-stance ${st.cls}">${st.icon} ${st.label}</span></div>
      ${h.one_sentence_summary ? `<p class="ar-cmp-sum">${esc(h.one_sentence_summary)}</p>` : ""}
      ${kpis ? `<div class="ar-kpis sm">${kpis}</div>` : ""}
      ${h.key_change_vs_prior_year ? `<div class="ar-cmp-chg"><b>年度變化</b>${esc(h.key_change_vs_prior_year)}</div>` : ""}
      ${topDrv ? `<div class="ar-cmp-line pos">🚀 ${esc(topDrv.title || "")}</div>` : ""}
      ${topChal ? `<div class="ar-cmp-line neg">🧗 ${esc(topChal.title || "")}</div>` : ""}
    </div>`;
  }
  function renderCompare() {
    if (!compareRoot) return;
    if (!cmpKey) { compareRoot.innerHTML = ""; return; }
    const cols = all.filter(d => groupKey(d) === cmpKey)
      .sort((a, b) => String(a._year).localeCompare(String(b._year)));
    if (cols.length < 1) { compareRoot.innerHTML = `<div class="rv-empty">此公司尚無年報。</div>`; return; }
    compareRoot.innerHTML = cols.map(cmpCol).join('<div class="ar-cmp-arrow">→</div>');
  }
  function buildCompareSelect() {
    if (!compareSelect) return;
    const map = {};
    all.forEach(d => { const k = groupKey(d); if (!map[k]) map[k] = d._company + (d._ticker ? ` (${d._ticker})` : ""); });
    const keys = Object.keys(map).sort((a, b) => String(map[a]).localeCompare(String(map[b])));
    compareSelect.innerHTML = keys.map(k => `<option value="${esc(k)}">${esc(map[k])}</option>`).join("");
    if (!keys.includes(cmpKey)) cmpKey = keys[0] || null;
    if (cmpKey) compareSelect.value = cmpKey;
    const wrap = compareSelect.closest(".ar-compare");
    if (wrap) wrap.hidden = keys.length === 0;
  }
  if (compareSelect) compareSelect.addEventListener("change", () => { cmpKey = compareSelect.value; renderCompare(); });

  async function reload() {
    all = await loadDocs("annual_reports", "_date", "desc");
    if (selectedId && !all.some(x => x.id === selectedId)) selectedId = null;
    renderLeft();
    rightEl.innerHTML = selectedId ? detailHTML(all.find(x => x.id === selectedId)) : emptyRight();
    buildCompareSelect();
    renderCompare();
    if (onData) onData(all);
  }
  function setAdmin(v) { canDelete = !!v; root.classList.toggle("ar-can-delete", canDelete); }

  await reload();
  return { reload, setAdmin };
}
