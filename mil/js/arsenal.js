// arsenal.js — ③ 系統譜系。依 family 分組排出繼承鏈 + 服役年份橫條；
// 點節點看規格 / 設計取捨 / 家族位置 / 參戰戰役 / 變更紀錄（示意）。與①共用 weapons.json。
import { loadJSON, showErr, esc } from "../js/milcore.js";

let WPN, BW, BYW = new Map();
const root = document.getElementById("app");
const YR0 = 1935, YR1 = 1946;

// 示意變更紀錄（每月重抽 + diff 之呈現格式；真實版由抓取腳本產生）
const CHANGELOG = {
  f6f: [{ date: "2026-08-01", field: "note", from: "擊墜比資料待補", to: "太平洋戰場擊墜比約 19:1（美海軍統計）" }],
  a6m5: [{ date: "2026-08-01", field: "service[end]", from: "1944", to: "1945" }],
};

(async function () {
  try {
    [WPN, BW] = await Promise.all([loadJSON("../data/weapons.json"), loadJSON("../data/battle-weapons.json")]);
    BYW = new Map(WPN.weapons.map(w => [w.id, w]));
    render();
  } catch (e) { showErr(root, e.message); }
})();

function render() {
  root.innerHTML = `
    <div class="mil-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span>服役年份與規格為<b>公開來源概估</b>；變更紀錄區塊為示意格式（真實版由每月重抽 + diff 產生）。</span></div>
    <div class="ars-legend mil-meta">橫條 = 服役區間（虛線框 = 未量產）；箭頭 = 型號繼承。藍 = 盟軍，紅 = 日本。</div>
    <div class="ars-families">${WPN.families.map(familyHTML).join("")}</div>
    <section class="mil-panel" id="detailPanel"><p class="mil-meta">點任一武器節點展開詳情。</p></section>`;
  root.querySelectorAll("[data-w]").forEach(b => b.onclick = () => showWeapon(b.dataset.w));
}

function familyHTML(fam) {
  const members = WPN.weapons.filter(w => w.family === fam.id);
  if (!members.length) return "";
  // 依繼承鏈排序（root 先）
  const roots = members.filter(m => !m.parent || !members.find(x => x.id === m.parent));
  const ordered = [];
  const walk = w => { ordered.push(w); members.filter(x => x.parent === w.id).forEach(walk); };
  roots.forEach(walk);
  return `<div class="ars-family">
    <div class="ars-fam-head">${esc(fam.name_zh)} <span class="mil-meta">${esc(fam.origin)}</span></div>
    <div class="ars-chain">${ordered.map(nodeHTML).join("")}</div>
  </div>`;
}

function nodeHTML(w) {
  const [s, e] = w.service; const end = e || YR1;
  const left = ((s - YR0) / (YR1 - YR0)) * 100, width = ((end - s) / (YR1 - YR0)) * 100;
  const arrow = w.parent ? `<span class="ars-arrow">▲ 繼承自 ${esc(BYW.get(w.parent)?.name_zh || "")}</span>` : "";
  return `<button class="ars-node ${w.side} ${w.status === "未量產" ? "unbuilt" : ""}" data-w="${w.id}">
    <div class="ars-node-name">${esc(w.name_zh)} <span class="mil-meta">${esc(w.name_en)}</span></div>
    <div class="ars-node-role mil-meta">${esc(w.role)} · ${w.service[0]}–${w.service[1] || "戰後"}</div>
    <div class="ars-bar"><span class="ars-bar-fill ${w.side}" style="left:${left}%;width:${Math.max(2,width)}%"></span></div>
    ${arrow}
  </button>`;
}

function showWeapon(wid) {
  const w = BYW.get(wid);
  const chain = []; let cur = w;
  while (cur) { chain.unshift(cur); cur = cur.parent ? BYW.get(cur.parent) : null; }
  const children = WPN.weapons.filter(x => x.parent === wid);
  const inBattles = Object.entries(BW.battle_weapons).filter(([, v]) => v.includes(wid)).map(([k]) => k);
  const log = CHANGELOG[wid] || [];
  const p = document.getElementById("detailPanel");
  p.innerHTML = `
    <div class="mil-panel-head"><h2 class="mil-panel-title">${esc(w.name_zh)} <span class="mil-meta">${esc(w.name_en)}</span></h2>
      <span class="mil-pill ${w.side === "allied" ? "allied" : "japan"}">${w.side === "allied" ? "盟軍" : "日本"}</span></div>
    <div class="war-wd-specs">${Object.entries(w.specs || {}).map(([k, v]) => `<span><i>${esc(k)}</i> ${esc(v)}</span>`).join("")}</div>
    <p class="war-wd-note">${esc(w.note)}</p>
    <div class="war-lineage"><span class="mil-meta">家族位置：</span>
      ${chain.map(c => c.id === wid ? `<b class="cur">${esc(c.name_zh)}</b>` : `<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" <span class='arr'>→</span> ")}
      ${children.length ? " <span class='arr'>→</span> " + children.map(c => `<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" / ") : ""}</div>
    <div class="war-appears"><span class="mil-meta">參戰戰役：</span>${inBattles.length ? inBattles.map(b => `<a class="link" href="../war/index.html">${esc(b)}</a>`).join(" · ") : "—"} <span class="mil-meta">（於「戰役消耗帳」可下鑽）</span></div>
    <div class="mil-panel-head" style="margin-top:1rem"><h3 class="mil-panel-title">變更紀錄 Changelog</h3><span class="mil-panel-note">示意格式</span></div>
    ${log.length ? `<div class="ars-log">${log.map(l => `<div class="ars-log-row"><span class="ars-log-date">${esc(l.date)}</span><span class="ars-log-field">${esc(l.field)}</span><span class="ars-log-diff"><del>${esc(l.from)}</del> → <ins>${esc(l.to)}</ins></span></div>`).join("")}</div>` : `<p class="mil-meta">尚無紀錄。真實版將於每月重抽時自動產生欄位級 diff。</p>`}`;
  p.querySelectorAll("[data-w]").forEach(b => b.onclick = () => showWeapon(b.dataset.w));
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
