// annualview.js — master/detail view for the annual-report highlights page.
// Left column = a searchable company directory (companies grouped, each with
// its fiscal years) instead of a timeline/calendar — annual reports are sparse
// (one per company per year), so grouping by company scales cleanly and stays
// tidy. Right column = a tabbed rich-card view of the selected report. A
// separate section renders a single-company multi-year comparison.
//
// Renderers target the annual_report_summary_v2 schema and are defensive: all
// list access goes through asArray() so an object-where-array (or vice-versa)
// mismatch never throws and blanks the whole panel.

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
function asArray(x) { return Array.isArray(x) ? x : []; }
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
const SEV = { high: { t: "高", c: "neg" }, medium: { t: "中", c: "neu" }, low: { t: "低", c: "pos" },
  medium_to_high: { t: "中高", c: "neg" }, none: { t: "無", c: "pos" } };
function sevTag(v, prefix = "") { const s = SEV[v]; return s ? `<span class="ar-badge ${s.c}">${prefix}${s.t}</span>` : ""; }
const IMPACT = { high: "高", medium: "中", low: "低", medium_to_high: "中高", unknown: "?" };
function impactWord(v) { return IMPACT[v] || v || ""; }

function chips(arr, cls = "") {
  const a = asArray(arr).filter(x => x != null && String(x).trim());
  if (!a.length) return "";
  return `<div class="ar-chips">${a.map(x => `<span class="ar-chip ${cls}">${esc(x)}</span>`).join("")}</div>`;
}
function bullets(arr) {
  const a = asArray(arr).filter(x => x != null && String(x).trim());
  if (!a.length) return "";
  return `<ul class="ar-ul">${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
function para(label, text) {
  if (!text || !String(text).trim()) return "";
  return `<p class="ar-para">${label ? `<b>${esc(label)}</b>` : ""}${esc(text)}</p>`;
}
function joinArr(arr, sep = "、") { return asArray(arr).filter(x => x != null && String(x).trim()).map(String).join(sep); }
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
function kpiGrid(pairs, cls = "") {
  const inner = pairs.filter(Boolean).join("");
  return inner ? `<div class="ar-kpis ${cls}">${inner}</div>` : "";
}
// Compact "label — body [badges]" row.
function row(title, body, badges = "") {
  if (!title && !body && !badges) return "";
  return `<div class="ar-row">${title ? `<span class="ar-row-t">${esc(title)}</span>` : ""}${badges}
    ${body ? `<div class="ar-row-b">${esc(body)}</div>` : ""}</div>`;
}

// ── Detail: hero ───────────────────────────────────────────────────────
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

// ── Tabs ───────────────────────────────────────────────────────────────
function tabOverview(d) {
  const data = d.data || {};
  const h = data.headline || {}, fh = data.financial_highlights || {}, is = fh.income_statement || {}, iv = data.investment_view || {};
  const kpis = kpiGrid([
    kpi("營收", moneyStr(is.revenue), yoyTag(is.revenue && is.revenue.yoy_change_pct)),
    kpi("毛利率", pctStr(is.gross_margin_pct)),
    kpi("營業利益率", pctStr(is.operating_margin_pct)),
    kpi("淨利", moneyStr(is.net_income), yoyTag(is.net_income && is.net_income.yoy_change_pct)),
    kpi("毛利", moneyStr(is.gross_profit), yoyTag(is.gross_profit && is.gross_profit.yoy_change_pct)),
    kpi("營業利益", moneyStr(is.operating_profit), yoyTag(is.operating_profit && is.operating_profit.yoy_change_pct)),
  ]);
  const changeBody = para("較去年關鍵變化：", h.key_change_vs_prior_year)
    + para("核心投資問題：", h.main_investment_question)
    + para("信心理由：", h.confidence_reason);
  const review = asArray(data.operating_review).map(o => {
    const badge = o.impact ? `<span class="ar-badge ${o.impact === "positive" ? "pos" : o.impact === "negative" ? "neg" : "neu"}">${esc(o.impact)}</span>` : "";
    const detail = [o.change, o.sustainability && `永續性：${o.sustainability}`].filter(Boolean).join(" ");
    const drv = joinArr(o.driver), off = joinArr(o.offset);
    return `<div class="ar-row"><span class="ar-row-t">${esc(o.topic || "")}</span>${badge}
      <div class="ar-row-b">${esc(detail)}${drv ? ` <span class="ar-pos-sub">＋ ${esc(drv)}</span>` : ""}${off ? ` <span class="ar-neg-sub">－ ${esc(off)}</span>` : ""}</div></div>`;
  }).join("");
  return kpis
    + card("t-key", "🔑", "本期焦點", changeBody)
    + card("t-invest", "🎯", "投資主軸", para("", iv.core_thesis))
    + card("t-review", "📋", "經營回顧", review);
}

function tabPositioning(d) {
  const data = d.data || {};
  const c = data.company || {}, im = data.industry_and_market || {};
  const moats = asArray(c.competitive_moats).map(m =>
    `<div class="ar-row"><span class="ar-row-t">${esc(m.type || "")}</span>
      ${m.strength ? `<span class="ar-badge ${m.strength === "strong" ? "pos" : m.strength === "weak" ? "neg" : "neu"}">${esc(m.strength)}</span>` : ""}
      <div class="ar-row-b">${esc(m.description || "")}${m.evidence ? ` <span class="ar-muted">（${esc(m.evidence)}）</span>` : ""}</div></div>`).join("");
  const companyBody = [
    para("產業：", [c.industry, c.industry_subcategory].filter(Boolean).join(" / ")),
    para("", c.industry_description),
    para("", c.business_summary),
    para("商業模式：", c.business_model),
    asArray(c.value_chain_position).length ? `<div class="ar-sub">價值鏈定位${chips(c.value_chain_position, "v")}</div>` : "",
    asArray(c.core_competencies).length ? `<div class="ar-sub">核心競爭力${bullets(c.core_competencies)}</div>` : "",
  ].join("");
  const indMetrics = kpiGrid([
    kpi("產業成長(2025)", pctStr(im.market_growth_2025_pct)),
    kpi("公司美元營收成長", pctStr(im.tsmc_revenue_growth_usd_pct)),
    kpi(`長期CAGR${im.long_term_target_year ? "→" + esc(im.long_term_target_year) : ""}`, pctStr(im.long_term_semiconductor_cagr_ex_memory_pct)),
  ]);
  const markets = asArray(im.major_end_markets).map(m =>
    `<div class="ar-row"><span class="ar-row-t">${esc(m.market || "")}</span>
      ${m.status ? `<span class="ar-badge neu">${esc(m.status)}</span>` : ""}
      <div class="ar-row-b">${esc(m.outlook || "")}</div></div>`).join("");
  return card("t-pos", "🧭", "公司與產業定位", companyBody)
    + card("t-moat", "🛡️", "競爭護城河", moats)
    + card("t-ind", "📊", "產業與終端市場", para("", im.industry_definition) + indMetrics + markets);
}

function productCard(p) {
  const custs = asArray(p.main_customers).map(x => (x && x.company_name) || x).filter(Boolean);
  return `<div class="ar-item">
    <div class="ar-item-h"><span class="ar-item-t">${esc(p.product_name || "")}</span>
      ${p.product_status ? `<span class="ar-badge neu">${esc(p.product_status)}</span>` : ""}
      ${p.strategic_role ? `<span class="ar-tagk">${esc(p.strategic_role)}</span>` : ""}
      ${p.revenue_percentage != null ? `<span class="ar-item-pct">營收占比 ${esc(p.revenue_percentage)}%</span>` : ""}</div>
    ${p.product_description ? `<p class="ar-para">${esc(p.product_description)}</p>` : ""}
    ${asArray(p.main_applications).length ? `<div class="ar-sub">應用${chips(p.main_applications)}</div>` : ""}
    ${asArray(p.end_markets).length ? `<div class="ar-sub">終端市場${chips(p.end_markets, "v")}</div>` : ""}
    ${custs.length ? `<div class="ar-sub">主要客戶${chips(custs, "c")}</div>` : ""}
    ${asArray(p.competitive_advantages).length ? `<div class="ar-sub ar-pos-sub">優勢${bullets(p.competitive_advantages)}</div>` : ""}
    ${asArray(p.competitive_weaknesses).length ? `<div class="ar-sub ar-neg-sub">弱點${bullets(p.competitive_weaknesses)}</div>` : ""}
  </div>`;
}
function tabProducts(d) {
  const data = d.data || {};
  const pp = data.product_portfolio || {}, rd = data.research_and_development || {};
  const core = asArray(pp.current_core_products).map(productCard).join("");
  const neu = asArray(pp.newly_commercialized_products).map(p =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(p.product_name || "")}</span>
      ${p.current_stage ? `<span class="ar-badge neu">${esc(p.current_stage)}</span>` : ""}
      ${p.expected_contribution ? `<span class="ar-tagk">貢獻 ${esc(impactWord(p.expected_contribution))}</span>` : ""}
      ${p.product_category ? `<span class="ar-tagk">${esc(p.product_category)}</span>` : ""}</div>
      ${para("時程：", p.commercialization_timing)}${para("進度：", p.actual_progress)}
      ${chips(p.target_application)}</div>`).join("");
  const dev = asArray(pp.products_under_development).map(p =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(p.product_name || "")}</span>
      ${p.development_stage ? `<span class="ar-badge neu">${esc(p.development_stage)}</span>` : ""}
      ${p.product_category ? `<span class="ar-tagk">${esc(p.product_category)}</span>` : ""}</div>
      ${para("", p.technology_description)}${para("量產時程：", p.expected_mass_production_timing)}
      ${asArray(p.technical_or_commercial_risks).length ? `<div class="ar-sub ar-neg-sub">風險${bullets(p.technical_or_commercial_risks)}</div>` : ""}</div>`).join("");
  const roadmap = asArray(pp.product_roadmap).map(r =>
    `<div class="ar-row"><span class="ar-row-t">${esc(r.direction || "")}</span>
      ${r.time_horizon ? `<span class="ar-mini">${esc(r.time_horizon)}</span>` : ""}
      <div class="ar-row-b">${esc(r.strategic_objective || "")}${asArray(r.related_products_or_technologies).length ? "" : ""}</div>
      ${chips(r.related_products_or_technologies)}</div>`).join("");
  const rdExp = rd.rd_expense || {};
  const rdKpis = kpiGrid([
    kpi("研發費用", moneyStr(rdExp), yoyTag(rdExp.yoy_change_pct)),
    kpi("佔營收比", pctStr(rdExp.percentage_of_revenue)),
    kpi("研發人數", rd.rd_headcount != null ? esc(rd.rd_headcount) : ""),
  ]);
  const rdLoc = asArray(rd.rd_locations).length ? `<div class="ar-sub">研發據點${chips(rd.rd_locations, "v")}</div>` : "";
  const rdDone = asArray(rd.successfully_developed_products_last_year).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.product_or_technology || "")}</span>
      ${x.commercial_status ? `<span class="ar-badge neu">${esc(x.commercial_status)}</span>` : ""}
      <div class="ar-row-b">${esc(x.achievement_description || "")}${x.strategic_significance ? ` <span class="ar-muted">（${esc(x.strategic_significance)}）</span>` : ""}</div></div>`).join("");
  const patents = rd.patents_and_intellectual_property || {};
  const rdBody = rdKpis + rdLoc + rdDone
    + (asArray(patents.recognition).length ? `<div class="ar-sub">專利與獎項${bullets(patents.recognition)}</div>` : "");
  return card("t-prod", "📦", "主力產品", core)
    + card("t-new", "✨", "新產品與商業化", neu)
    + card("t-dev", "🔬", "研發中產品", dev)
    + card("t-road", "🗺️", "產品路線圖", roadmap)
    + card("t-rd", "🧪", "研發投入", rdBody);
}

function tabRevenue(d) {
  const data = d.data || {};
  const segs = asArray(data.business_segments), mix = asArray(data.revenue_mix);
  const fh = data.financial_highlights || {}, is = fh.income_statement || {}, bs = fh.balance_sheet || {};
  const segBars = segs.map(s =>
    bar(s.segment_name || "", s.revenue_percentage,
      [s.growth_status && `<span class="ar-mini">${esc(s.growth_status)}</span>`, s.operating_margin_pct != null && `營益率 ${esc(s.operating_margin_pct)}%`, yoyTag(s.revenue_yoy_change_pct)].filter(Boolean).join(" "))
  ).join("");
  // Revenue mix is split by dimension (product / geography / …) — group each
  // dimension into its own labelled block so different 100%-bases never mix.
  const DIM = { product: "依產品", segment: "依部門", customer: "依客戶", geography: "依地區",
    channel: "依通路", application: "依應用", end_market: "依終端市場", other: "其他" };
  const mixGroups = {};
  mix.forEach(m => { const k = m.dimension || "其他"; (mixGroups[k] = mixGroups[k] || []).push(m); });
  const mixBars = Object.keys(mixGroups).map(k => {
    const bars = mixGroups[k].map(m => bar(m.name || "", m.percentage, yoyTag(m.yoy_change_pct))).join("");
    return `<div class="ar-mixgroup"><div class="ar-mixgroup-h">${esc(DIM[k] || k)}</div>${bars}</div>`;
  }).join("");
  const fhKpis = kpiGrid([
    kpi("營收", moneyStr(is.revenue), yoyTag(is.revenue && is.revenue.yoy_change_pct)),
    kpi("毛利", moneyStr(is.gross_profit), yoyTag(is.gross_profit && is.gross_profit.yoy_change_pct)),
    kpi("毛利率", pctStr(is.gross_margin_pct)),
    kpi("營業利益", moneyStr(is.operating_profit), yoyTag(is.operating_profit && is.operating_profit.yoy_change_pct)),
    kpi("營益率", pctStr(is.operating_margin_pct)),
    kpi("淨利", moneyStr(is.net_income), yoyTag(is.net_income && is.net_income.yoy_change_pct)),
    kpi("總資產", moneyStr(bs.total_assets), yoyTag(bs.total_assets && bs.total_assets.yoy_change_pct)),
    kpi("股東權益", moneyStr(bs.total_equity), yoyTag(bs.total_equity && bs.total_equity.yoy_change_pct)),
    kpi("總負債", moneyStr(bs.total_liabilities), yoyTag(bs.total_liabilities && bs.total_liabilities.yoy_change_pct)),
    kpi("不動產廠房設備", moneyStr(bs.property_plant_and_equipment), yoyTag(bs.property_plant_and_equipment && bs.property_plant_and_equipment.yoy_change_pct)),
  ]);
  const drivers = asArray(fh.performance_drivers).length ? `<div class="ar-sub">績效驅動${chips(fh.performance_drivers, "k")}</div>` : "";
  return card("t-seg", "🏢", "營運部門", segBars)
    + card("t-mix", "🥧", "營收組成", mixBars)
    + card("t-fin", "💰", "財務重點", fhKpis + drivers);
}

function tabCustomers(d) {
  const data = d.data || {};
  const cu = data.customers || {};
  const types = asArray(cu.customer_types).map(x =>
    row(x.type || "", x.importance || "", "")).join("");
  const named = asArray(cu.named_customers).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.company_name || "")}</span>
      ${x.importance ? `<span class="ar-badge ${x.importance === "high" ? "neg" : "neu"}">重要度 ${esc(impactWord(x.importance))}</span>` : ""}
      ${x.revenue_percentage != null ? `<span class="ar-item-pct">${esc(x.revenue_percentage)}%</span>` : ""}
      <div class="ar-row-b">${[x.customer_type, x.country_or_region].filter(Boolean).map(esc).join(" · ")}${x.description ? " — " + esc(x.description) : ""}</div></div>`).join("");
  // customer_concentration may be an object (summary) or an array (per-customer).
  let conc = "";
  const cc = cu.customer_concentration;
  if (Array.isArray(cc)) {
    conc = cc.map(x => bar(x.customer_name_or_label || "", x.revenue_percentage,
      [x.trend && `<span class="ar-mini">${esc(x.trend)}</span>`, x.prior_year_percentage != null && `去年 ${esc(x.prior_year_percentage)}%`].filter(Boolean).join(" "))).join("");
  } else if (cc && typeof cc === "object") {
    conc = para("狀態：", cc.status)
      + (cc.largest_customer_name ? para("最大客戶：", cc.largest_customer_name) : "")
      + (cc.largest_customer_percentage != null ? para("最大客戶占比：", `${cc.largest_customer_percentage}%`) : "")
      + (cc.disclosure_status ? `<span class="ar-tagk">${esc(cc.disclosure_status)}</span>` : "");
  }
  const geo = asArray(cu.geographic_distribution || cu.customer_regions).map(r =>
    `<div class="ar-row"><span class="ar-row-t">${esc(r.region || "")}</span>
      ${r.percentage != null ? `<span class="ar-item-pct">${esc(r.percentage)}%</span>` : (r.revenue_percentage != null ? `<span class="ar-item-pct">${esc(r.revenue_percentage)}%</span>` : "")}
      <div class="ar-row-b">${asArray(r.main_demand).length ? "需求：" + esc(joinArr(r.main_demand)) : ""}${r.risk ? ` <span class="ar-neg-sub">風險：${esc(r.risk)}</span>` : ""}</div></div>`).join("");
  const changes = bullets(cu.key_changes);
  return card("t-ctype", "👥", "客戶類型", types)
    + card("t-cust", "🤝", "主要客戶", named)
    + card("t-conc", "⚠️", "客戶集中度", conc)
    + card("t-region", "🌏", "客戶地區分布", geo)
    + card("t-cchg", "🔁", "客戶變動", changes);
}

// Supply chain — an upstream → company → downstream flow diagram.
function flowNode(title, subs) {
  const s = asArray(subs).filter(x => x != null && String(x).trim());
  return `<div class="ar-fnode"><span class="ar-fnode-t">${esc(title)}</span>${
    s.map(x => `<span class="ar-fnode-s">${esc(x)}</span>`).join("")}</div>`;
}
function tabSupply(d) {
  const data = d.data || {};
  const sc = data.supply_chain || {}, c = data.company || {}, im = data.industry_and_market || {};
  // Upstream: real schema `upstream_materials`, older `upstream_materials_and_components`.
  const up = asArray(sc.upstream_materials).length ? asArray(sc.upstream_materials) : asArray(sc.upstream_materials_and_components);
  // Midstream: real schema `manufacturing_nodes` (strings), older objects.
  const nodes = asArray(sc.manufacturing_nodes);
  const mfgObjs = asArray(sc.manufacturing_and_operations);
  // Downstream: no explicit field in v2 — use industry end markets as demand side.
  const down = asArray(im.major_end_markets).length ? asArray(im.major_end_markets)
    : asArray(sc.downstream_channels_and_customers);
  let flow = "";
  if (up.length || nodes.length || mfgObjs.length || down.length) {
    const upNodes = up.map(m => flowNode(m.name || m.material_or_component || "",
      [m.role || m.category, joinArr((m.major_suppliers || []).map(s => s.company_name)), m.supply_status && `供給:${m.supply_status}`])).join("")
      || `<div class="ar-fnode empty">—</div>`;
    let midNodes;
    if (nodes.length) midNodes = nodes.map(n => flowNode(n, [])).join("");
    else if (mfgObjs.length) midNodes = mfgObjs.map(m => flowNode(m.site_name || m.country_or_region || "製造",
      [m.country_or_region, joinArr(m.main_products_or_processes), m.utilization_rate_pct != null && `稼動率 ${m.utilization_rate_pct}%`])).join("");
    else midNodes = flowNode(c.name || d._company, [c.business_model]);
    const downNodes = down.map(x => flowNode(x.market || x.company_or_channel || "",
      [x.status || x.type, x.region])).join("") || `<div class="ar-fnode empty">—</div>`;
    flow = `<div class="ar-flow">
      <div class="ar-fcol"><div class="ar-fcol-h up">上游 · 材料/供應</div>${upNodes}</div>
      <div class="ar-farrow">→</div>
      <div class="ar-fcol"><div class="ar-fcol-h mid">本公司 · 製造據點</div><div class="ar-fcompany">${esc(c.name || d._company)}</div>${midNodes}</div>
      <div class="ar-farrow">→</div>
      <div class="ar-fcol"><div class="ar-fcol-h down">下游 · 終端需求</div>${downNodes}</div>
    </div>`;
  }
  // Supplier concentration (anonymised) as bars.
  const supConc = asArray(sc.supplier_concentration).map(s =>
    bar(s.supplier || "", s.percentage, moneyStr({ value: s.purchase_amount, unit: s.unit, currency: s.currency }))).join("");
  // Design ecosystem partner counts.
  const de = sc.design_ecosystem || {};
  const deKpis = kpiGrid([
    kpi("EDA", de.eda_partners), kpi("雲端", de.cloud_partners), kpi("IP", de.ip_partners),
    kpi("設計中心", de.design_center_partners), kpi("VCA", de.value_chain_aggregators), kpi("3DIC", de.three_dic_partners),
  ], "sm");
  const measures = bullets(sc.management_measures);
  const risks = asArray(sc.supply_chain_risks).length
    ? asArray(sc.supply_chain_risks).map(r =>
        `<div class="ar-row"><span class="ar-row-t">${esc(r.risk || "")}</span>${sevTag(r.severity, "嚴重度 ")}
          <div class="ar-row-b">${[r.affected_material_product_or_site, r.mitigation && `因應：${r.mitigation}`].filter(Boolean).map(esc).join(" · ")}</div></div>`).join("")
    : bullets(sc.key_risks);
  return (flow ? `<div class="ar-card t-supply"><div class="ar-card-h">🔗 供應鏈流向</div><div class="ar-card-b">${flow}</div></div>` : "")
    + card("t-supconc", "📦", "主要供應商採購集中度", supConc)
    + card("t-eco", "🌐", "設計生態系夥伴", deKpis)
    + card("t-meas", "🧰", "供應鏈管理措施", measures)
    + card("t-scrisk", "🚨", "供應鏈風險", risks);
}

function tabCapacity(d) {
  const data = d.data || {};
  const sc = data.supply_chain || {}, fs = data.future_strategy || {};
  // v2: future_strategy.capacity_expansion (location/technology/status/expected_timing)
  const exp = asArray(fs.capacity_expansion).length ? asArray(fs.capacity_expansion) : asArray(fs.capacity_expansion_plans);
  const expItems = exp.map(x =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(x.location || x.site_or_project || "")}</span>
      ${(x.technology) ? `<span class="ar-tagk">${esc(x.technology)}</span>` : ""}
      ${x.country_or_region ? `<span class="ar-tagk">${esc(x.country_or_region)}</span>` : ""}
      ${x.expected_timing || x.completion_timing || x.mass_production_timing ? `<span class="ar-mini">${esc(x.expected_timing || x.completion_timing || x.mass_production_timing)}</span>` : ""}</div>
      ${para("狀態：", x.status)}${para("投資：", x.investment_amount)}${para("新增產能：", x.capacity_increase)}${para("預期影響：", x.expected_impact)}
      ${asArray(x.risks).length ? `<div class="ar-sub ar-neg-sub">風險${bullets(x.risks)}</div>` : ""}</div>`).join("");
  const nodes = asArray(sc.manufacturing_nodes).length ? `<div class="ar-sub">全球製造據點${chips(sc.manufacturing_nodes, "v")}</div>` : "";
  const sites = asArray(sc.manufacturing_and_operations).map(m =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(m.site_name || m.country_or_region || "")}</span>
      ${m.current_status ? `<span class="ar-badge neu">${esc(m.current_status)}</span>` : ""}
      ${m.utilization_rate_pct != null ? `<span class="ar-item-pct">稼動率 ${esc(m.utilization_rate_pct)}%</span>` : ""}</div>
      ${para("產能：", m.capacity)}${para("擴產：", m.expansion_plan)}</div>`).join("");
  return card("t-exp", "🏗️", "擴產計畫", expItems + nodes)
    + card("t-cap", "🏭", "營運據點", sites);
}

function tabCompetition(d) {
  const data = d.data || {};
  const cp = data.competition || {};
  const landscape = asArray(cp.competitive_landscape).map(x =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(x.area || "")}</span>
      ${x.risk_level ? `<span class="ar-badge ${x.risk_level === "high" ? "neg" : x.risk_level === "low" ? "pos" : "neu"}">競爭風險 ${esc(impactWord(x.risk_level))}</span>` : ""}</div>
      ${para("", x.company_position)}
      ${asArray(x.competition_factors).length ? `<div class="ar-sub">競爭要素${chips(x.competition_factors)}</div>` : ""}</div>`).join("");
  const comps = asArray(cp.named_competitors).map(x =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(x.company_name || "")}</span>
      ${x.ticker ? `<span class="ar-tagk">${esc(x.ticker)}</span>` : ""}
      ${x.relative_position ? `<span class="ar-badge ${x.relative_position === "stronger" ? "neg" : x.relative_position === "weaker" ? "pos" : "neu"}">相對 ${esc(x.relative_position)}</span>` : ""}</div>
      ${asArray(x.company_advantages_vs_competitor).length ? `<div class="ar-sub ar-pos-sub">我方優勢${bullets(x.company_advantages_vs_competitor)}</div>` : ""}
      ${asArray(x.company_disadvantages_vs_competitor).length ? `<div class="ar-sub ar-neg-sub">我方劣勢${bullets(x.company_disadvantages_vs_competitor)}</div>` : ""}</div>`).join("");
  const rel = (asArray(cp.relative_strengths).length ? `<div class="ar-sub ar-pos-sub">相對優勢${bullets(cp.relative_strengths)}</div>` : "")
    + (asArray(cp.relative_weaknesses).length ? `<div class="ar-sub ar-neg-sub">相對劣勢${bullets(cp.relative_weaknesses)}</div>` : "");
  return card("t-comp", "⚔️", "競爭格局", para("", cp.competitive_environment_summary) + landscape + comps)
    + card("t-rel", "⚖️", "相對優劣勢", rel);
}

function tabChallenges(d) {
  const data = d.data || {};
  const challenges = asArray(data.company_challenges).map(x => {
    const sev = SEV[x.severity];
    return `<div class="ar-item ${sev ? "sev-" + sev.c : ""}"><div class="ar-item-h">
      <span class="ar-item-t">${esc(x.challenge || x.title || "")}</span>${sevTag(x.severity, "嚴重 ")}</div>
      ${para("", x.current_impact || x.description)}${para("影響：", x.financial_or_operational_impact)}${para("因應：", x.management_response)}
      ${chips(x.affected_business || x.affected_products_or_segments)}</div>`;
  }).join("");
  const risks = asArray(data.risks).map(x => {
    const sevKey = x.impact || x.severity;
    const sev = SEV[sevKey];
    return `<div class="ar-item ${sev ? "sev-" + sev.c : ""}"><div class="ar-item-h">
      <span class="ar-item-t">${esc(x.risk || x.title || "")}</span>${sevTag(sevKey, "衝擊 ")}
      ${x.probability ? `<span class="ar-mini">機率 ${esc(impactWord(x.probability))}</span>` : ""}
      ${x.category ? `<span class="ar-tagk">${esc(x.category)}</span>` : ""}</div>
      ${para("", x.impact_path || x.detail)}${para("潛在影響：", x.potential_impact)}
      ${joinArr(x.mitigation) ? para("因應：", joinArr(x.mitigation)) : ""}
      ${chips(x.affected_products)}</div>`;
  }).join("");
  const flags = asArray(data.financial_and_accounting_flags).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.flag || x.title || "")}</span>${sevTag(x.severity)}
      <div class="ar-row-b">${esc(x.observation || x.detail || "")}${x.potential_implication ? ` <span class="ar-muted">→ ${esc(x.potential_implication)}</span>` : ""}${x.quantitative_evidence ? ` <span class="ar-muted">（${esc(x.quantitative_evidence)}）</span>` : ""}</div></div>`).join("");
  const gov = asArray(data.governance_flags).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.flag || x.title || "")}</span>${sevTag(x.severity)}
      <div class="ar-row-b">${esc(x.observation || x.detail || "")}${x.mitigating_factor ? ` <span class="ar-pos-sub">緩解：${esc(x.mitigating_factor)}</span>` : ""}</div></div>`).join("");
  return card("t-chal", "🧗", "公司目前困境", challenges)
    + card("t-risk", "⚠️", "風險", risks)
    + card("t-flag", "🚩", "財務 / 會計紅旗", flags)
    + card("t-gov", "🏛️", "公司治理紅旗", gov);
}

function tabOutlook(d) {
  const data = d.data || {};
  const im = data.industry_and_market || {}, fs = data.future_strategy || {};
  const drivers = asArray(data.growth_drivers).map(x =>
    `<div class="ar-item"><div class="ar-item-h"><span class="ar-item-t">${esc(x.driver || x.title || "")}</span>
      ${(x.impact_level || x.expected_impact) ? `<span class="ar-badge pos">影響 ${esc(impactWord(x.impact_level || x.expected_impact))}</span>` : ""}
      ${(x.expected_timing || x.time_horizon) ? `<span class="ar-mini">${esc(x.expected_timing || x.time_horizon)}</span>` : ""}
      ${x.current_stage ? `<span class="ar-tagk">${esc(x.current_stage)}</span>` : ""}</div>
      ${para("", x.potential_impact || x.detail)}${para("量化目標：", x.quantitative_target)}
      ${asArray(x.success_conditions).length ? `<div class="ar-sub">成立條件${bullets(x.success_conditions)}</div>` : ""}
      ${chips(x.related_products || x.related_products_or_segments)}</div>`).join("");
  const priorities = bullets(fs.management_priorities);
  const partners = bullets(fs.partnership_strategy);
  const tech = chips(im.technology_trends, "v");
  const policy = bullets(im.policy_factors);
  // Older schema: industry_outlook array of objects.
  const outlookRows = asArray(im.industry_outlook).map(o =>
    `<div class="ar-row"><span class="ar-row-t">${esc(o.theme || "")}</span>
      <span class="ar-badge ${o.direction === "positive" ? "pos" : o.direction === "negative" ? "neg" : "neu"}">${esc(o.direction || "")}</span>
      <div class="ar-row-b">${esc(o.description || "")}</div></div>`).join("");
  return card("t-driver", "🚀", "成長題材", drivers)
    + card("t-prio", "📌", "管理層優先事項", priorities)
    + card("t-partner", "🤝", "夥伴策略", partners)
    + card("t-tech", "🧠", "技術趨勢", tech)
    + card("t-policy", "🏛️", "政策因素", policy)
    + card("t-outlook", "🔭", "產業前景", outlookRows);
}

// Investment scenario column from an object {conditions/triggers, beneficiaries,
// financial_path, expected_outcome, confirmation/negative indicators}.
function caseCol(title, cls, obj) {
  if (!obj || typeof obj !== "object") return "";
  const body = [
    bullets(obj.conditions || obj.triggers),
    obj.beneficiaries || obj.affected_products ? `<div class="ar-sub">${obj.beneficiaries ? "受惠" : "受影響"}${chips(obj.beneficiaries || obj.affected_products)}</div>` : "",
    para("", obj.financial_path || obj.expected_outcome),
    asArray(obj.confirmation_indicators || obj.negative_indicators).length
      ? `<div class="ar-sub">${obj.negative_indicators ? "警訊指標" : "確認指標"}${chips(obj.confirmation_indicators || obj.negative_indicators)}</div>` : "",
  ].join("");
  if (!body.trim()) return "";
  return `<div class="ar-case-col"><div class="ar-case-h ${cls}">${title}</div><div class="ar-scn ${cls}">${body}</div></div>`;
}
function tabInvest(d) {
  const data = d.data || {};
  const iv = data.investment_view || {};
  // v2 cases are objects; older schema used arrays of {scenario}. Handle both.
  const mkCol = (title, cls, v) => Array.isArray(v)
    ? (v.length ? `<div class="ar-case-col"><div class="ar-case-h ${cls}">${title}</div>${v.map(s => `<div class="ar-scn ${cls}"><div class="ar-scn-t">${esc(s.scenario || "")}</div>${para("", s.expected_impact || s.expected_outcome)}${chips(s.required_conditions || s.trigger_conditions)}</div>`).join("")}</div>` : "")
    : caseCol(title, cls, v);
  const casesInner = [
    mkCol("🐂 多方", "pos", iv.bull_case),
    mkCol("⚖️ 基本", "neu", iv.base_case),
    mkCol("🐻 空方", "neg", iv.bear_case),
  ].filter(Boolean).join("");
  const catalysts = asArray(iv.catalysts).map(x =>
    `<div class="ar-row"><span class="ar-row-t">${esc(x.catalyst || x.event || "")}</span>
      ${x.expected_timing ? `<span class="ar-mini">${esc(x.expected_timing)}</span>` : ""}
      ${(x.impact || x.potential_impact) ? `<span class="ar-badge neu">影響 ${esc(impactWord(x.impact || x.potential_impact))}</span>` : ""}</div>`).join("");
  const metrics = asArray(iv.monitoring_indicators).length
    ? chips(iv.monitoring_indicators, "k")
    : asArray(iv.monitoring_metrics).map(m =>
        `<div class="ar-row"><span class="ar-row-t">${esc(m.metric || "")}</span>
          <div class="ar-row-b">${esc(m.reason || "")}</div></div>`).join("");
  const questions = bullets(iv.questions_for_next_report || iv.key_questions_for_next_report);
  return card("t-thesis", "🎯", "核心論點", para("", iv.core_thesis))
    + (casesInner ? `<div class="ar-card t-cases"><div class="ar-card-h">🎲 情境分析</div><div class="ar-card-b"><div class="ar-cases">${casesInner}</div></div></div>` : "")
    + card("t-cat", "⏰", "催化劑", catalysts)
    + card("t-metric", "📡", "追蹤指標", metrics)
    + card("t-q", "❓", "下期年報要看的問題", questions)
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
  // Each renderer is wrapped so a single bad section can't blank the panel.
  const tabs = TABS.map(t => {
    let html = "";
    try { html = t.fn(d); } catch (e) { console.error("tab render failed:", t.key, e); }
    return { ...t, html };
  }).filter(t => t.html && t.html.trim());
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

  const DIR_LIMIT = 20; // when not searching, only show the newest N reports
  function renderLeft() {
    const filtered = all.filter(matches); // `all` is already _date-desc
    const truncated = !search && filtered.length > DIR_LIMIT;
    const items = truncated ? filtered.slice(0, DIR_LIMIT) : filtered;
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
          ${g.market ? `<span class="ar-group-mk">${esc(g.market)}</span>` : ""}
          <span class="ar-group-n">${g.items.length}</span>
        </button>
        <div class="ar-group-body">${rows}</div>
      </section>`;
    }).join("");
    if (truncated) dirEl.innerHTML += `<div class="ar-dir-more">僅顯示最新 ${DIR_LIMIT} 筆（共 ${filtered.length} 筆），用上方搜尋可找更多。</div>`;
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
    const body = rightEl.querySelector(".ar-tabbody");
    if (body) body.scrollTop = 0;
  });

  let searchTimer;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = searchEl.value.trim(); renderLeft(); }, 120);
  });

  // ── Multi-year comparison ────────────────────────────────────────────
  let cmpKey = null;
  function cmpCol(d) {
    const data = d.data || {}, fh = data.financial_highlights || {}, is = fh.income_statement || {}, h = data.headline || {};
    const st = stanceInfo(d._stance);
    const kpis = kpiGrid([
      kpi("營收", moneyStr(is.revenue), yoyTag(is.revenue && is.revenue.yoy_change_pct)),
      kpi("毛利率", pctStr(is.gross_margin_pct)),
      kpi("營益率", pctStr(is.operating_margin_pct)),
      kpi("淨利", moneyStr(is.net_income), yoyTag(is.net_income && is.net_income.yoy_change_pct)),
    ], "sm");
    const topChal = asArray(data.company_challenges)[0];
    const topDrv = asArray(data.growth_drivers)[0];
    const drvTxt = topDrv && (topDrv.driver || topDrv.title);
    const chalTxt = topChal && (topChal.challenge || topChal.title);
    return `<div class="ar-cmp-col ${st.cls}">
      <div class="ar-cmp-top"><span class="ar-cmp-fy">FY ${esc(d._year)}</span><span class="ar-stance ${st.cls}">${st.icon} ${st.label}</span></div>
      ${h.one_sentence_summary ? `<p class="ar-cmp-sum">${esc(h.one_sentence_summary)}</p>` : ""}
      ${kpis}
      ${h.key_change_vs_prior_year ? `<div class="ar-cmp-chg"><b>年度變化</b>${esc(h.key_change_vs_prior_year)}</div>` : ""}
      ${drvTxt ? `<div class="ar-cmp-line pos">🚀 ${esc(drvTxt)}</div>` : ""}
      ${chalTxt ? `<div class="ar-cmp-line neg">🧗 ${esc(chalTxt)}</div>` : ""}
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
