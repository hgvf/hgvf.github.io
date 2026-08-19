// digest.js — ⑧ 每日彙整。唯讀 mil_feeds（LLM → Worker → Firestore），
// orderBy date desc limit 7；按日分組渲染。讀取數 = 顯示天數（與條目數無關）。
import { esc, fmtDate } from "../js/milcore.js";

const root = document.getElementById("app");
const SENT = { positive: { c: "var(--ok)", z: "正面" }, negative: { c: "var(--japan)", z: "負面" }, neutral: { c: "var(--muted)", z: "中性" } };
const CONF = { high: "高", medium: "中", low: "低" };

(async function () {
  root.innerHTML = `<p class="mil-meta">載入中…</p>`;
  let feeds = [];
  try { const s = await import("../js/milstore.js"); feeds = await s.loadFeeds(7); } catch (e) { /* SDK 或連線失敗 → 空狀態 */ }
  render(feeds);
})();

function render(feeds) {
  const banner = `<div class="mil-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    <span>內容由 <b>LLM 彙整可能有誤，一律以來源連結為準</b>。此頁由排程任務經 Cloudflare Worker 寫入 Firestore <code>mil_feeds</code>，前端唯讀（每次僅讀 7 份文件）。</span></div>`;

  if (!feeds.length) {
    root.innerHTML = banner + `<section class="mil-panel"><div class="mil-panel-head"><h2 class="mil-panel-title">尚無彙整資料</h2></div>
      <p class="mil-meta" style="line-height:1.9">Firestore <code>mil_feeds</code> 目前沒有文件。此管線需部署 <code>mil/worker/ingest.js</code>（驗 token → 驗 schema → 服務帳號寫入）並由排程任務（<code>defense-digest</code> skill）每日 POST。<br>
      驗證與寫入邏輯已備妥於 <code>mil/worker/</code> 與 <code>mil/skills/defense-digest/</code>；接上 GCP 服務帳號後即可運作。</p></section>`;
    return;
  }
  root.innerHTML = banner + feeds.map(dayHTML).join("");
}

function dayHTML(feed) {
  const items = feed.items || [];
  return `<section class="mil-panel">
    <div class="mil-panel-head"><h2 class="mil-panel-title">${esc(fmtDate(feed.date))}</h2>
      <span class="mil-panel-note">${esc(feed.feed || "")} · ${items.length} 則 · ${esc(feed.model || "")}</span></div>
    <div class="dig-items">${items.map(itemHTML).join("")}</div>
  </section>`;
}
function itemHTML(it) {
  const s = SENT[it.sentiment] || SENT.neutral;
  return `<article class="dig-item"><span class="dig-sent" style="background:${s.c}"></span>
    <div class="dig-body">
      <h3 class="dig-head">${esc(it.headline || "")}</h3>
      <p class="dig-sum">${esc(it.summary || "")}</p>
      <div class="dig-foot">
        ${it.source_url ? `<a class="dig-src" href="${esc(it.source_url)}" target="_blank" rel="noopener">${esc(it.source_name || "來源")} ↗</a>` : `<span class="mil-meta">無來源</span>`}
        ${it.published_at ? `<span class="mil-meta">${esc(fmtDate(it.published_at))}</span>` : ""}
        <span class="mil-pill" style="color:${s.c};border-color:${s.c}">${s.z}</span>
        ${it.confidence ? `<span class="mil-pill">可信度 ${esc(CONF[it.confidence] || it.confidence)}</span>` : ""}
        ${(it.tags || []).map(t => `<span class="dig-tag">#${esc(t)}</span>`).join("")}
        ${(it.entities || []).map(e => `<span class="dig-ent">${esc(e)}</span>`).join("")}
      </div>
    </div></article>`;
}
