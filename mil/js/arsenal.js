// arsenal.js — ③ 系統譜系（全時代）。依 family 分組排出繼承鏈 + 服役年份橫條，
// era / bloc / 搜尋篩選；ADD JSON 插入（Firestore mil_weapons）。
import { loadJSON, showErr, esc } from "../js/milcore.js";

let FAMILIES = [], WEAPONS = [], BYW = new Map();
let era = "all", bloc = "all", q = "";
let YR0 = 1935, YR1 = 2030;
let isAdmin = false, store = null;
const root = document.getElementById("app");
const NOW_YEAR = new Date().getFullYear();

const ERAS = ["WW2", "冷戰", "現代"];
const BLOC = { west: { z: "西方", cls: "west" }, east: { z: "東方", cls: "east" }, other: { z: "其他", cls: "other" } };

async function getStore() { if (store) return store; try { store = await import("../js/milstore.js"); } catch { store = null; } return store; }

(async function () {
  root.innerHTML = `<p class="mil-meta">載入中…</p>`;
  document.body.addEventListener("mil-auth", e => { isAdmin = !!e.detail.isAdmin; const p = document.getElementById("arsImport"); if (p) { p.hidden = !isAdmin; if (isAdmin) wireImport(); } });
  try {
    const base = await loadJSON("../data/arsenal.json");
    FAMILIES = base.families || [];
    WEAPONS = base.weapons || [];
  } catch (e) { showErr(root, e.message); return; }
  const s = await getStore();
  if (s) { try {
    const docs = await s.loadWeapons();
    docs.forEach(d => { const w = d.data || d; const i = WEAPONS.findIndex(x => x.id === w.id); if (i >= 0) WEAPONS[i] = w; else WEAPONS.push(w); });
  } catch { /* ignore */ } }
  BYW = new Map(WEAPONS.map(w => [w.id, w]));
  const yrs = WEAPONS.flatMap(w => [w.service?.[0], w.service?.[1]]).filter(Boolean);
  YR0 = Math.min(YR0, ...yrs); YR1 = Math.max(YR1, ...yrs, NOW_YEAR);
  render();
})();

function render() {
  root.innerHTML = `
    <div class="mil-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span>服役年份與規格為<b>公開來源概估</b>；譜系繼承為示意（<code>parent</code> 指前一世代）。跨 WW2 / 冷戰 / 現代。</span></div>

    <details class="mil-import" id="arsImport" ${isAdmin ? "" : "hidden"}>
      <summary>匯入 / 新增武器（ADD JSON）</summary>
      <p class="hint">貼上 <code>{"weapons":[…]}</code>、陣列或單一武器。每筆需 <code>id / name_zh</code>；建議含 <code>name_en / bloc(west|east|other) / era / family / parent / role / service:[起,迄] / specs / note</code>。以 id 為主鍵寫入 Firestore <code>mil_weapons</code>，重貼同 id 覆蓋。<code>family</code> 未定義時歸入「自訂／未分類」。</p>
      <textarea id="arsJson" class="mil-textarea" rows="7" spellcheck="false" placeholder='{"weapons":[{"id":"rafale","name_zh":"疾風","name_en":"Dassault Rafale","bloc":"west","era":"現代","family":"eu_jet_fighter","parent":null,"role":"多用途戰機","service":[2001,null],"specs":{"最高速度":"Mach 1.8"},"note":"…"}]}'></textarea>
      <div class="actions"><button class="mil-btn mil-btn-primary" id="arsPub">發布到 Firebase</button><span class="mil-status" id="arsPubStatus"></span></div>
    </details>

    <div class="ars-filter">
      <div class="mil-toggle" id="eraTabs">
        <button class="mil-btn ${era==='all'?'mil-btn-primary':''}" data-era="all">全部時代</button>
        ${ERAS.map(x => `<button class="mil-btn ${era===x?'mil-btn-primary':''}" data-era="${x}">${x}</button>`).join("")}
      </div>
      <div class="mil-toggle" id="blocTabs">
        <button class="mil-btn ${bloc==='all'?'mil-btn-primary':''}" data-bloc="all">全陣營</button>
        <button class="mil-btn ${bloc==='west'?'mil-btn-primary':''}" data-bloc="west">西方</button>
        <button class="mil-btn ${bloc==='east'?'mil-btn-primary':''}" data-bloc="east">東方</button>
      </div>
      <input id="arsSearch" class="mil-input" style="max-width:240px" placeholder="搜尋名稱 / 角色…" value="${esc(q)}">
      <span class="mil-meta" id="arsCount"></span>
    </div>
    <div class="ars-legend mil-meta">橫條 = 服役區間（虛線框 = 未量產）；箭頭 = 繼承。<i class="sw" style="background:var(--allied)"></i>西方 <i class="sw" style="background:var(--japan)"></i>東方</div>
    <div class="ars-families" id="famGrid"></div>
    <section class="mil-panel" id="detailPanel"><p class="mil-meta">點任一武器節點展開詳情。</p></section>`;

  root.querySelectorAll("[data-era]").forEach(b => b.onclick = () => { era = b.dataset.era; render(); });
  root.querySelectorAll("[data-bloc]").forEach(b => b.onclick = () => { bloc = b.dataset.bloc; render(); });
  const si = root.querySelector("#arsSearch");
  si.oninput = () => { q = si.value.trim().toLowerCase(); drawFamilies(); };
  if (isAdmin) wireImport();
  drawFamilies();
}

function match(w) {
  if (era !== "all" && w.era !== era) return false;
  if (bloc !== "all" && (w.bloc || "other") !== bloc) return false;
  if (q) { const hay = [w.name_zh, w.name_en, w.role, w.note].join(" ").toLowerCase(); if (!hay.includes(q)) return false; }
  return true;
}

function drawFamilies() {
  const grid = root.querySelector("#famGrid");
  const shown = WEAPONS.filter(match);
  root.querySelector("#arsCount").textContent = `${shown.length} / ${WEAPONS.length} 款`;
  // 未在 families 定義的 family → 自訂群組
  const famIds = new Set(FAMILIES.map(f => f.id));
  const groups = [...FAMILIES];
  const customFams = [...new Set(shown.map(w => w.family).filter(f => f && !famIds.has(f)))];
  customFams.forEach(f => groups.push({ id: f, name_zh: f, origin: "自訂" }));
  if (shown.some(w => !w.family)) groups.push({ id: "__none__", name_zh: "未分類", origin: "自訂" });

  const html = groups.map(fam => {
    const members = shown.filter(w => (w.family || "__none__") === fam.id);
    if (!members.length) return "";
    const roots = members.filter(m => !m.parent || !members.find(x => x.id === m.parent));
    const ordered = []; const walk = w => { ordered.push(w); members.filter(x => x.parent === w.id).forEach(walk); };
    roots.forEach(walk);
    // 若因篩選斷鏈，補上其餘
    members.forEach(m => { if (!ordered.includes(m)) ordered.push(m); });
    return `<div class="ars-family">
      <div class="ars-fam-head">${esc(fam.name_zh)} <span class="mil-meta">${esc(fam.origin||"")}</span></div>
      <div class="ars-chain">${ordered.map(nodeHTML).join("")}</div></div>`;
  }).join("");
  grid.innerHTML = html || `<p class="mil-meta">沒有符合篩選的武器。</p>`;
  grid.querySelectorAll("[data-w]").forEach(b => b.onclick = () => showWeapon(b.dataset.w));
}

function nodeHTML(w) {
  const [s, e] = w.service || [YR0, null]; const end = e || NOW_YEAR;
  const left = ((s - YR0) / (YR1 - YR0)) * 100, width = ((end - s) / (YR1 - YR0)) * 100;
  const cls = BLOC[w.bloc]?.cls || "other";
  const parent = w.parent ? BYW.get(w.parent) : null;
  return `<button class="ars-node ${cls} ${w.status === "未量產" ? "unbuilt" : ""}" data-w="${w.id}">
    <div class="ars-node-name">${esc(w.name_zh)} <span class="mil-meta">${esc(w.name_en||"")}</span></div>
    <div class="ars-node-role mil-meta">${esc(w.role||"")} · ${esc(w.era||"")} · ${w.service?`${w.service[0]}–${w.service[1]||"服役中"}`:""}</div>
    <div class="ars-bar"><span class="ars-bar-fill ${cls}" style="left:${Math.max(0,left)}%;width:${Math.max(2,width)}%"></span></div>
    ${parent ? `<div class="ars-arrow">▲ 繼承自 ${esc(parent.name_zh)}</div>` : ""}
  </button>`;
}

function showWeapon(wid) {
  const w = BYW.get(wid); if (!w) return;
  const chain = []; let cur = w; while (cur) { chain.unshift(cur); cur = cur.parent ? BYW.get(cur.parent) : null; }
  const children = WEAPONS.filter(x => x.parent === wid);
  const cls = BLOC[w.bloc]?.cls || "other";
  const p = document.getElementById("detailPanel");
  p.innerHTML = `
    <div class="mil-panel-head"><h2 class="mil-panel-title">${esc(w.name_zh)} <span class="mil-meta">${esc(w.name_en||"")}</span></h2>
      <span class="mil-pill ${cls==='west'?'allied':cls==='east'?'japan':'brass'}">${esc(BLOC[w.bloc]?.z||"其他")} · ${esc(w.era||"")}</span></div>
    <div class="war-wd-specs">${Object.entries(w.specs||{}).map(([k,v])=>`<span><i>${esc(k)}</i> ${esc(v)}</span>`).join("")}</div>
    <p class="war-wd-note">${esc(w.note||"")}</p>
    <div class="war-lineage"><span class="mil-meta">家族位置：</span>
      ${chain.map(c => c.id === wid ? `<b class="cur">${esc(c.name_zh)}</b>` : `<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" <span class='arr'>→</span> ")}
      ${children.length ? " <span class='arr'>→</span> " + children.map(c => `<button class="link" data-w="${c.id}">${esc(c.name_zh)}</button>`).join(" / ") : ""}</div>
    <div class="mil-meta" style="margin-top:0.6rem">服役 ${w.service?`${w.service[0]}–${w.service[1]||"服役中"}`:"—"} · 家族 ${esc(w.family||"—")}</div>`;
  p.querySelectorAll("[data-w]").forEach(b => b.onclick = () => showWeapon(b.dataset.w));
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── ADD JSON（Firestore mil_weapons）──
function parseWeapons(input) {
  const d = JSON.parse(input);
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.weapons)) return d.weapons;
  if (d && d.id) return [d];
  throw new Error('格式需為 {"weapons":[…]}、陣列或單一武器');
}
function wireImport() {
  const btn = root.querySelector("#arsPub"), status = root.querySelector("#arsPubStatus"), ta = root.querySelector("#arsJson");
  if (!btn) return;
  btn.onclick = async () => {
    status.className = "mil-status"; status.textContent = "解析中…";
    try {
      const s = await getStore(); if (!s) throw new Error("Firebase SDK 無法載入");
      const list = parseWeapons(ta.value);
      list.forEach(w => { if (!w.id || !w.name_zh) throw new Error("每筆需含 id/name_zh"); });
      const n = await s.saveWeapons(list);
      // merge locally
      list.forEach(w => { const i = WEAPONS.findIndex(x => x.id === w.id); if (i >= 0) WEAPONS[i] = w; else WEAPONS.push(w); });
      BYW = new Map(WEAPONS.map(w => [w.id, w]));
      status.className = "mil-status ok"; status.textContent = `✓ 已發布 ${n} 筆`; ta.value = "";
      render();
    } catch (e) {
      status.className = "mil-status err";
      status.innerHTML = /insufficient permissions|permission-denied/i.test(e.message||"") ? "✗ 權限不足：需白名單帳號且已部署 mil_weapons 規則（<code>firebase deploy --only firestore:rules</code>）" : "✗ " + esc(e.message);
    }
  };
}
