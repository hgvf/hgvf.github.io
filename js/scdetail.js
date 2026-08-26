// scdetail.js — detail-card renderer for `supply_chain_news` items
// (供應鏈瓶頸新聞). Extracted from supply-chain/index.html so the supply-chain
// page and the consolidated 重點新聞 (highlights) page render an item the same
// way. All new fields are optional & backward-safe.

import { sent, esc, fmtDate, chartUrl, tickerTrendCard } from "./reports.js";

const CRED = { "高": "pos", "中": "neu", "低": "neg" };

function credBadge(v) {
  return v ? `<span class="rp-cred ${CRED[v] || "neu"}">可信度：${esc(v)}</span>` : "";
}
function textCard(cls, icon, label, val) {
  return val ? `<div class="rp-subcard ${cls}"><div class="rp-subcard-head">${icon} ${label}</div><div class="rp-subcard-body">${esc(val)}</div></div>` : "";
}
function tagsCard(tags) {
  if (!tags || !tags.length) return "";
  return `<div class="rp-subcard rp-tags"><div class="rp-subcard-head">🏷️ 瓶頸關鍵字 / 題材</div>
    <div class="rp-chiprow">${tags.map(t => `<span class="rp-chipk">${esc(t)}</span>`).join("")}</div></div>`;
}
function chainCard(ch) {
  if (!ch) return "";
  const seg = (label, arr) => (arr && arr.length)
    ? `<div class="rp-chain-seg"><span class="rp-chain-label">${label}</span><div class="rp-chain-items">${
        arr.map(o => `<div class="rp-chain-item"><b>${esc(o.name)}</b>${o.note ? `<span>${esc(o.note)}</span>` : ""}</div>`).join("")}</div></div>`
    : "";
  const body = seg("上游", ch.upstream) + seg("中游", ch.midstream) + seg("下游", ch.downstream);
  return body ? `<div class="rp-subcard rp-chain"><div class="rp-subcard-head">🔗 供應鏈上中下游影響</div>${body}</div>` : "";
}
function altCard(alts) {
  if (!alts || !alts.length) return "";
  const rows = alts.map(a => `<div class="rp-alt-row ${a.incumbent ? "inc" : ""}">
    <span class="rp-alt-name">${esc(a.name)}${a.incumbent ? ' <span class="rp-alt-tag">現任</span>' : ""}</span>
    <span class="rp-alt-share">${esc(a.share || "—")}</span>
    ${a.note ? `<span class="rp-alt-note">${esc(a.note)}</span>` : ""}</div>`).join("");
  return `<div class="rp-subcard rp-alt"><div class="rp-subcard-head">🔄 替代品 / 公司 · 市占</div><div class="rp-alt-list">${rows}</div></div>`;
}

export function detail(it) {
  const s = sent(it.sentiment);
  const tickers = (it.tickers || []).map(t => `<a class="rp-ticker" href="${esc(chartUrl(t))}" target="_blank" rel="noopener" title="在 TradingView 看 ${esc(t)} 線圖">${esc(t)}</a>`).join("");
  const sources = (it.sources || []).length
    ? `<div class="news-src">來源：${it.sources.map(o => `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title || o.url)}</a>`).join("")}</div>`
    : "";
  return `<article class="rv-detail ${s.cls}">
    <div class="rv-detail-meta">
      <span class="rp-date">${esc(fmtDate(it.date))}</span>
      ${tickers}
      <span class="sent-tag ${s.cls}">${s.label}</span>
      ${credBadge(it.credibility)}
    </div>
    <h2 class="rv-detail-title">${esc(it.headline)}</h2>
    <p class="rv-detail-body">${esc(it.content)}</p>
    ${tagsCard(it.tags)}
    ${chainCard(it.chain)}
    ${altCard(it.alternatives)}
    ${textCard("rp-effect", "⛓️", "下游影響", it.effect)}
    ${textCard("rp-signals", "🔍", "財報 / 逐字稿線索", it.signals)}
    ${textCard("rp-advise", "💡", "投資建議", it.advise)}
    ${tickerTrendCard(it.tickers)}
    ${sources}
  </article>`;
}
