// explorer.js — Weapon Research Explorer 應用邏輯。
// hash 路由：#/（首頁）｜#/w/<id>（武器頁）｜#/tag/<value>（Tag 頁）｜#/compare?ids=a,b
import { loadJSON, showErr, esc, fmtDate } from "../js/milcore.js";
// 3D 檢視器（Three.js，經 CDN importmap）採動態載入：即使 CDN 不可用，
// 武器頁其餘資訊（規格 / Tag / 相似 / 比較）仍正常呈現。

let WEAPONS = [], BYID = new Map(), TAGS = null, WEIGHTS = {};
let tray = [];             // in-memory 比較盤（不使用 localStorage）
let viewer = null;
let isAdmin = false, store = null;
const app = document.getElementById("app");
async function getStore() { if (store) return store; try { store = await import("../js/milstore.js"); } catch { store = null; } return store; }

// ── Tag helpers ──────────────────────────────────────────────
const tagInfo = v => (TAGS.tags[v]) || { type: "role", label_en: v, label_zh: v, desc_zh: "" };
const tagLabelZh = v => tagInfo(v).label_zh;
const tagLabelEn = v => tagInfo(v).label_en;
const tagsOf = w => (w.tags || []).map(t => t.value);
const tagsByType = (w, type) => (w.tags || []).filter(t => t.type === type).map(t => t.value);
function tagChip(v, opts = {}) {
  const i = tagInfo(v);
  const cls = opts.active ? " active" : "";
  return `<a class="mil-chip${cls}" data-type="${i.type}" href="#/tag/${encodeURIComponent(v)}"
    title="${esc(i.desc_zh || "")}"><span class="zh">${esc(i.label_zh)}</span><span class="en">${esc(i.label_en)}</span></a>`;
}

// ── 相似度（Tag similarity，權重見 tags.json）──────────────────
function similarity(a, b) {
  let score = 0;
  for (const type in WEIGHTS) {
    const A = new Set(tagsByType(a, type)), B = new Set(tagsByType(b, type));
    if (!A.size && !B.size) continue;
    const inter = [...A].filter(x => B.has(x)).length;
    const union = new Set([...A, ...B]).size;
    score += WEIGHTS[type] * (union ? inter / union : 0);
  }
  return score;
}
function sharedTags(a, b) {
  const B = new Set(tagsOf(b));
  return tagsOf(a).filter(v => B.has(v));
}

// ── 比較盤 ───────────────────────────────────────────────────
function inTray(id) { return tray.includes(id); }
function toggleTray(id) {
  if (inTray(id)) tray = tray.filter(x => x !== id);
  else if (tray.length < 4) tray.push(id);
  renderTray(); syncTrayButtons();
}
function renderTray() {
  let bar = document.getElementById("compareTray");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "compareTray"; bar.className = "cmp-tray";
    document.body.appendChild(bar);
  }
  if (!tray.length) { bar.classList.remove("show"); bar.innerHTML = ""; return; }
  bar.classList.add("show");
  bar.innerHTML = `<span class="cmp-tray-label">比較盤</span>
    ${tray.map(id => { const w = BYID.get(id); return `<span class="cmp-pill">${esc(w.name_zh)}
      <button data-rm="${id}" aria-label="移除">×</button></span>`; }).join("")}
    <a class="mil-btn mil-btn-primary" href="#/compare?ids=${tray.join(",")}">比較 (${tray.length}) →</a>`;
  bar.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => toggleTray(b.dataset.rm));
}
function syncTrayButtons() {
  document.querySelectorAll("[data-tray]").forEach(b => {
    const on = inTray(b.dataset.tray);
    b.textContent = on ? "✓ 已加入比較" : "＋ 加入比較";
    b.classList.toggle("mil-btn-primary", on);
  });
}

// ── 首頁 ─────────────────────────────────────────────────────
function renderHome() {
  disposeViewer();
  // 熱門 tag（依使用數）
  const count = {};
  WEAPONS.forEach(w => tagsOf(w).forEach(v => count[v] = (count[v] || 0) + 1));
  const popular = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 12);

  app.innerHTML = `
    <details class="mil-import" id="expImport" ${isAdmin ? "" : "hidden"}>
      <summary>匯入 / 新增武器實體（ADD JSON）</summary>
      <p class="hint">貼上 <code>{"weapons":[…]}</code>、陣列或單一武器。每筆需 <code>id / name_zh</code>；建議含 <code>name / designation / country / entity_type / status / summary_zh / specifications / tags:[{type,value,source_id}] / variants / platforms / operators / events / sources / model_3d</code>（結構見 <code>mil/data/weapons-modern.json</code>）。tags 的 <code>value</code> 需存在於 <code>tags.json</code> 分類法。以 id 為主鍵寫入 Firestore <code>mil_weapons_modern</code>。</p>
      <textarea id="expJson" class="mil-textarea" rows="7" spellcheck="false" placeholder='{"weapons":[{"id":"jassm_er","name_zh":"增程聯合空對地飛彈","name":"AGM-158B JASSM-ER","designation":"JASSM-ER","entity_type":"missile","country":"USA","status":"operational","summary_zh":"…","specifications":{"range_km":{"value":"~1000","confidence":"medium"}},"tags":[{"type":"role","value":"land_attack"},{"type":"propulsion","value":"turbofan"}],"model_3d":{"fidelity":"c","shape":{"bodyLen":4.3,"bodyDia":0.55,"nose":"chisel","faceted":true,"wings":{"span":2.4,"chord":0.6,"axial":0.5},"tailFins":{"span":0.5,"chord":0.35,"count":3},"intake":"belly"},"annotations":[]}}]}'></textarea>
      <div class="actions"><button class="mil-btn mil-btn-primary" id="expPub">發布到 Firebase</button><span class="mil-status" id="expPubStatus"></span></div>
    </details>
    <div class="exp-search-wrap">
      <input id="expSearch" class="mil-input exp-search" placeholder="搜尋武器名稱、代號、國家、承包商…（例如 雄風、Tomahawk、ramjet）" autocomplete="off" />
    </div>
    <section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">熱門技術 Tag</h2><span class="mil-panel-note">點 Tag 探索使用相同技術的系統</span></div>
      <div class="exp-chips">${popular.map(([v, c]) => tagChip(v) .replace("</a>", ` <span class="chip-count">${c}</span></a>`)).join("")}</div>
    </section>
    <section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">武器實體</h2><span class="mil-panel-note" id="expCount"></span></div>
      <div class="exp-grid" id="expGrid"></div>
    </section>`;

  const grid = app.querySelector("#expGrid");
  const draw = list => {
    app.querySelector("#expCount").textContent = `${list.length} / ${WEAPONS.length} 款`;
    grid.innerHTML = list.map(weaponCardHTML).join("") || `<p class="mil-meta">查無符合的武器。</p>`;
    grid.querySelectorAll("[data-tray]").forEach(b => b.onclick = e => { e.preventDefault(); toggleTray(b.dataset.tray); });
    syncTrayButtons();
  };
  draw(WEAPONS);
  const inp = app.querySelector("#expSearch");
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase();
    draw(!q ? WEAPONS : WEAPONS.filter(w => {
      const hay = [w.name, w.name_zh, w.designation, w.country, (w.manufacturer || []).join(" "),
        w.summary_zh, tagsOf(w).map(tagLabelEn).join(" "), tagsOf(w).map(tagLabelZh).join(" ")].join(" ").toLowerCase();
      return hay.includes(q);
    }));
  };
  if (isAdmin) wireExpImport();
}

function parseWeapons(input) {
  const d = JSON.parse(input);
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.weapons)) return d.weapons;
  if (d && d.id) return [d];
  throw new Error('格式需為 {"weapons":[…]}、陣列或單一武器');
}
function wireExpImport() {
  const btn = app.querySelector("#expPub"), status = app.querySelector("#expPubStatus"), ta = app.querySelector("#expJson");
  if (!btn) return;
  btn.onclick = async () => {
    status.className = "mil-status"; status.textContent = "解析中…";
    try {
      const s = await getStore(); if (!s) throw new Error("Firebase SDK 無法載入");
      const list = parseWeapons(ta.value);
      list.forEach(w => { if (!w.id || !w.name_zh) throw new Error("每筆需含 id/name_zh"); });
      // 提醒未知 tag（不阻擋）
      const unknown = [...new Set(list.flatMap(w => (w.tags || []).map(t => t.value)).filter(v => !TAGS.tags[v]))];
      const n = await s.saveModernWeapons(list);
      list.forEach(w => { const i = WEAPONS.findIndex(x => x.id === w.id); if (i >= 0) WEAPONS[i] = w; else WEAPONS.push(w); });
      reindex();
      status.className = "mil-status ok";
      status.textContent = `✓ 已發布 ${n} 筆${unknown.length ? `（未知 tag：${unknown.join(", ")}）` : ""}`;
      ta.value = ""; renderHome();
    } catch (e) {
      status.className = "mil-status err";
      status.innerHTML = /insufficient permissions|permission-denied/i.test(e.message || "") ? "✗ 權限不足：需白名單帳號且已部署 mil_weapons_modern 規則（<code>firebase deploy --only firestore:rules</code>）" : "✗ " + esc(e.message);
    }
  };
}

function weaponCardHTML(w) {
  const role = tagsByType(w, "role").map(tagLabelZh).join(" · ") || "—";
  const chips = tagsOf(w).slice(0, 5).map(v => `<span class="mil-chip" data-type="${tagInfo(v).type}"><span class="zh">${esc(tagLabelZh(v))}</span></span>`).join("");
  return `<div class="exp-card">
    <a class="exp-card-link" href="#/w/${w.id}">
      <div class="exp-card-head">
        <div><div class="exp-card-zh">${esc(w.name_zh)}</div><div class="exp-card-en">${esc(w.name)}</div></div>
        <span class="mil-pill ${statusCls(w.status)}">${esc(statusZh(w.status))}</span>
      </div>
      <div class="exp-card-meta">${esc(w.country)} · ${esc((w.manufacturer||[])[0]||"")} · ${role}</div>
      <div class="exp-card-chips">${chips}</div>
    </a>
    <div class="exp-card-actions">
      <a class="mil-btn" href="#/w/${w.id}">3D 探索 →</a>
      <button class="mil-btn mil-btn-ghost" data-tray="${w.id}">＋ 加入比較</button>
    </div>
  </div>`;
}
const statusZh = s => ({ operational: "服役中", development: "研發中", testing: "測試中", retired: "除役" }[s] || s || "—");
const statusCls = s => (s === "operational" ? "ok" : s === "development" || s === "testing" ? "brass" : "");

// ── 武器頁 ───────────────────────────────────────────────────
function renderWeapon(id) {
  disposeViewer();
  const w = BYID.get(id);
  if (!w) { app.innerHTML = `<p class="mil-meta">查無此武器：${esc(id)}</p>`; return; }

  const sims = WEAPONS.filter(x => x.id !== id).map(x => ({ w: x, s: similarity(w, x) }))
    .sort((a, b) => b.s - a.s).slice(0, 5);

  app.innerHTML = `
    <a class="exp-back" href="#/">← 返回列表</a>
    <header class="wp-head">
      <div>
        <div class="wp-desig mil-meta">${esc(w.designation || "")} · ${esc(w.country)}</div>
        <h1 class="wp-name">${esc(w.name_zh)} <span class="wp-name-en">${esc(w.name)}</span></h1>
        <div class="wp-mfr mil-meta">${esc((w.manufacturer || []).join(" / "))}</div>
      </div>
      <div class="wp-head-side">
        <span class="mil-pill ${statusCls(w.status)}">${esc(statusZh(w.status))}</span>
        <button class="mil-btn" data-tray="${w.id}">＋ 加入比較</button>
      </div>
    </header>

    <div class="wp-grid">
      <section class="mil-panel wp-viewer-panel">
        <div class="mil-panel-head">
          <h2 class="mil-panel-title">3D Weapon View</h2>
          <span class="mil-fidelity ${w.model_3d?.fidelity || 'c'}">Fidelity ${(w.model_3d?.fidelity||'c').toUpperCase()} · 外型近似</span>
        </div>
        <div id="viewer" class="wp-viewer"></div>
        <div class="wp-viewer-ctl">
          <button class="mil-btn" id="btnExplode">◇ 爆炸視圖</button>
          <button class="mil-btn" id="btnReset">↺ 重置視角</button>
          <span class="mil-meta">拖曳旋轉 · 滾輪縮放 · 點黃色熱點看零件</span>
        </div>
        <div id="inspector" class="wp-inspector"></div>
      </section>

      <aside class="wp-side">
        <div class="mil-panel">
          <div class="mil-panel-head"><h2 class="mil-panel-title">At a Glance</h2></div>
          <p class="wp-summary">${esc(w.summary_zh)}</p>
          <div class="wp-tags">${tagsOf(w).map(v => tagChip(v)).join("")}</div>
        </div>
      </aside>
    </div>

    <section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">規格 Specifications</h2><span class="mil-panel-note">每項數值可追來源</span></div>
      <div class="wp-specs">${specRows(w)}</div>
    </section>

    ${w.variants && w.variants.length ? `<section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">型號譜系 Variants</h2></div>
      <div class="wp-variants">${variantHTML(w)}</div>
    </section>` : ""}

    <div class="wp-two">
      <section class="mil-panel">
        <div class="mil-panel-head"><h2 class="mil-panel-title">平台 Platforms</h2></div>
        <ul class="wp-list">${(w.platforms || []).map(p => `<li><span class="mil-pill">${esc(p.type)}</span> ${esc(p.name_zh)} <span class="mil-meta">${esc(p.name)}</span></li>`).join("") || "<li class='mil-meta'>—</li>"}</ul>
      </section>
      <section class="mil-panel">
        <div class="mil-panel-head"><h2 class="mil-panel-title">部署國家 Operators</h2></div>
        <ul class="wp-list">${(w.operators || []).map(o => `<li><b>${esc(o.name_zh)}</b> <span class="mil-pill ${o.status==='operational'?'ok':'brass'}">${esc(opZh(o.status))}</span> <span class="mil-meta">${esc(o.note||"")}</span></li>`).join("") || "<li class='mil-meta'>—</li>"}</ul>
      </section>
    </div>

    <section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">Timeline</h2></div>
      <div class="wp-timeline">${(w.events || []).sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(evHTML).join("") || "<span class='mil-meta'>—</span>"}</div>
    </section>

    <section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">相似武器 Similar Weapons</h2><span class="mil-panel-note">依 Tag 相似度</span></div>
      <div class="wp-similar">${sims.map(s => similarRowHTML(w, s)).join("")}</div>
    </section>

    <section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">來源 Sources</h2></div>
      <ul class="wp-sources">${(w.sources || []).map(srcHTML).join("")}</ul>
    </section>`;

  // 3D（動態載入 Three.js；失敗則優雅降級）
  const vc = app.querySelector("#viewer");
  const insp = app.querySelector("#inspector");
  vc.innerHTML = `<div class="wp-viewer-loading mil-meta">載入 3D 檢視器…</div>`;
  import("../js/viewer3d.js").then(({ WeaponViewer }) => {
    vc.innerHTML = "";
    viewer = new WeaponViewer(vc);
    viewer.setModel(w.model_3d);
    wireViewer(w, viewer, insp);
    app.querySelector("#btnExplode").onclick = e => { viewer.toggleExploded(); e.target.classList.toggle("mil-btn-primary", viewer.exploded); };
    app.querySelector("#btnReset").onclick = () => viewer.resetView();
  }).catch(() => {
    vc.innerHTML = `<div class="wp-viewer-fallback">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2 2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <p>3D 檢視器需連線載入 Three.js（CDN）。<br>目前無法載入；下方規格、Tag、相似與比較功能不受影響。</p>
      <div class="wp-fallback-tags">${(w.model_3d?.annotations || []).map(a => a.tag ? tagChip(a.tag.split(":")[1]) : "").join("")}</div>
    </div>`;
    app.querySelector("#btnExplode").disabled = true;
    app.querySelector("#btnReset").disabled = true;
  });

  app.querySelectorAll("[data-tray]").forEach(b => b.onclick = () => toggleTray(b.dataset.tray));
  app.querySelectorAll("[data-simadd]").forEach(b => b.onclick = () => toggleTray(b.dataset.simadd));
  syncTrayButtons();
}

function wireViewer(w, viewer, insp) {
  viewer.onSelect(a => {
    const t = a.tag ? a.tag.split(":") : null;
    insp.classList.add("show");
    insp.innerHTML = `<div class="insp-name">${esc(a.name_zh)} <span class="mil-meta">${esc(a.name||"")}</span></div>
      ${t ? `<div class="insp-tag">${tagChip(t[1])}</div>` : ""}
      ${a.source_id ? `<div class="mil-meta">來源：${esc(srcTitle(w, a.source_id))}</div>` : ""}
      <div class="insp-flow mil-meta">零件 → Tag → 相似系統 → 比較</div>`;
  });
}

const opZh = s => ({ operational: "服役", acquisition: "獲得/整合", procurement: "採購/規劃", integration: "整合", historical: "曾使用", test: "測試" }[s] || s);
function specRows(w) {
  const order = [["range_km","射程 (km)"],["speed","速度"],["propulsion","推進"],["guidance","導引"],["warhead","彈頭"],["length_m","長度 (m)"],["diameter_m","直徑 (m)"],["weight_kg","重量 (kg)"]];
  return order.map(([k, label]) => {
    const s = w.specifications?.[k]; if (!s) return "";
    const val = typeof s === "object" ? s.value : s;
    const conf = s.confidence ? `<span class="conf ${s.confidence}">${confZh(s.confidence)}</span>` : "";
    const src = s.source_id ? `<a class="spec-src" href="${esc(srcUrl(w, s.source_id))}" target="_blank" rel="noopener" title="${esc(srcTitle(w, s.source_id))}">來源 ↗</a>` : "";
    return `<div class="spec-row"><span class="spec-k">${label}</span><span class="spec-v">${esc(val ?? "—")}</span><span class="spec-extra">${conf}${src}</span></div>`;
  }).join("");
}
const confZh = c => ({ high: "高信心", medium: "中信心", low: "低信心" }[c] || c);
function variantHTML(w) {
  return `<div class="var-rail">${w.variants.map((v, i) =>
    `<div class="var-node"><span class="var-dot">${i + 1}</span><div class="var-name">${esc(v.name_zh)}<span class="mil-meta">${esc(v.name)}</span></div>
      ${Object.keys(v.changes || {}).length ? `<ul class="var-changes">${Object.entries(v.changes).map(([k, val]) => `<li><b>${esc(k)}</b>: ${esc(val)}</li>`).join("")}</ul>` : "<div class='mil-meta'>基準型</div>"}</div>`
  ).join("<span class='var-arrow'>→</span>")}</div>`;
}
function evHTML(e) {
  return `<div class="tl-row"><span class="tl-date">${esc(fmtDate(e.date))}</span>
    <span class="mil-pill">${esc(evTypeZh(e.type))}</span>
    <span class="tl-title">${esc(e.title_zh || e.title || "")}</span></div>`;
}
const evTypeZh = t => ({ development:"研發", prototype:"原型", test:"測試", production:"量產", procurement:"採購", export:"外銷", integration:"整合", deployment:"部署", upgrade:"升級", combat_use:"實戰", retirement:"除役" }[t] || t);
function similarRowHTML(base, s) {
  const shared = sharedTags(base, s.w);
  const pct = Math.round(s.s * 100);
  return `<div class="sim-row">
    <a class="sim-main" href="#/w/${s.w.id}">
      <span class="sim-name">${esc(s.w.name_zh)} <span class="mil-meta">${esc(s.w.name)}</span></span>
      <span class="sim-bar"><span class="sim-fill" style="width:${pct}%"></span></span>
      <span class="sim-pct">${pct}%</span>
    </a>
    <div class="sim-shared">${shared.map(v => `<span class="mil-chip" data-type="${tagInfo(v).type}"><span class="zh">✓ ${esc(tagLabelZh(v))}</span></span>`).join("")}</div>
    <button class="mil-btn mil-btn-ghost sim-add" data-simadd="${s.w.id}">＋ 比較</button>
  </div>`;
}
const srcOf = (w, id) => (w.sources || []).find(s => s.id === id);
const srcUrl = (w, id) => srcOf(w, id)?.url || "#";
const srcTitle = (w, id) => { const s = srcOf(w, id); return s ? `${s.publisher} — ${s.title}` : id; };
function srcHTML(s) {
  return `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)} ↗</a>
    <span class="mil-pill ${s.reliability==='tier_1'?'ok':'brass'}">${esc(s.publisher)} · ${esc(relZh(s.reliability))}</span></li>`;
}
const relZh = r => ({ tier_1: "一級官方", tier_2: "研究機構", tier_3: "專業媒體" }[r] || r);

// ── Tag 頁 ───────────────────────────────────────────────────
function renderTag(v) {
  disposeViewer();
  const info = tagInfo(v);
  const users = WEAPONS.filter(w => tagsOf(w).includes(v));
  // 相關 tag：與此 tag 常共現者
  const co = {};
  users.forEach(w => tagsOf(w).forEach(x => { if (x !== v) co[x] = (co[x] || 0) + 1; }));
  const related = Object.entries(co).sort((a, b) => b[1] - a[1]).slice(0, 8);
  app.innerHTML = `
    <a class="exp-back" href="#/">← 返回列表</a>
    <header class="wp-head">
      <div>
        <div class="mil-meta">${esc(TAGS.types[info.type]?.label_zh || info.type)} · TAG</div>
        <h1 class="wp-name">${esc(info.label_zh)} <span class="wp-name-en">${esc(info.label_en)}</span></h1>
        <p class="wp-mfr" style="color:var(--muted)">${esc(info.desc_zh || "")}</p>
      </div>
      ${users.length > 1 ? `<a class="mil-btn mil-btn-primary" href="#/compare?ids=${users.slice(0,4).map(w=>w.id).join(",")}">比較前 ${Math.min(4,users.length)} 款 →</a>` : ""}
    </header>
    <section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">使用此技術的系統</h2><span class="mil-panel-note">${users.length} 款</span></div>
      <div class="exp-grid">${users.map(weaponCardHTML).join("")}</div>
    </section>
    ${related.length ? `<section class="mil-panel">
      <div class="mil-panel-head"><h2 class="mil-panel-title">相關 Tag</h2></div>
      <div class="exp-chips">${related.map(([x, c]) => tagChip(x).replace("</a>", ` <span class="chip-count">${c}</span></a>`)).join("")}</div>
    </section>` : ""}`;
  app.querySelectorAll("[data-tray]").forEach(b => b.onclick = e => { e.preventDefault(); toggleTray(b.dataset.tray); });
  syncTrayButtons();
}

// ── Compare 頁 ───────────────────────────────────────────────
function renderCompare(ids) {
  disposeViewer();
  const list = ids.map(id => BYID.get(id)).filter(Boolean);
  if (list.length < 1) { app.innerHTML = `<p class="mil-meta">請先加入武器至比較盤。</p><a class="exp-back" href="#/">← 返回</a>`; return; }
  const attrs = [
    ["role", "任務角色", w => tagsByType(w, "role").map(tagLabelZh).join(" / ")],
    ["propulsion", "推進", w => tagsByType(w, "propulsion").map(tagLabelZh).join(" / ")],
    ["speed", "速度", w => (w.specifications?.speed?.value) || tagsByType(w, "speed").map(tagLabelZh).join(" / ")],
    ["guidance", "導引", w => tagsByType(w, "guidance").map(tagLabelZh).join(" / ")],
    ["flight", "飛行模式", w => tagsByType(w, "flight").map(tagLabelZh).join(" / ")],
    ["launch", "發射平台", w => tagsByType(w, "launch").map(tagLabelZh).join(" / ")],
    ["range", "射程 (km)", w => specVal(w, "range_km")],
    ["length", "長度 (m)", w => specVal(w, "length_m")],
    ["country", "國家", w => w.country],
  ];
  app.innerHTML = `
    <a class="exp-back" href="#/">← 返回列表</a>
    <header class="wp-head"><h1 class="wp-name">武器比較 <span class="wp-name-en">Compare</span></h1></header>
    <div class="cmp-scroll"><table class="cmp-table">
      <thead><tr><th>屬性</th>${list.map(w => `<th><a href="#/w/${w.id}">${esc(w.name_zh)}</a><div class="mil-meta">${esc(w.name)}</div></th>`).join("")}</tr></thead>
      <tbody>${attrs.map(([k, label, fn]) => `<tr><td class="cmp-attr">${label}</td>${list.map(w => `<td>${esc(fn(w) || "—")}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p class="mil-meta" style="margin-top:0.8rem">分享此比較：<code>${location.origin}${location.pathname}#/compare?ids=${list.map(w=>w.id).join(",")}</code></p>`;
}
function specVal(w, k) { const s = w.specifications?.[k]; return s ? (typeof s === "object" ? s.value : s) : "—"; }

// ── 路由 ─────────────────────────────────────────────────────
function disposeViewer() { if (viewer) { viewer.dispose(); viewer = null; } document.getElementById("inspector")?.classList.remove("show"); }
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  window.scrollTo(0, 0);
  if (h.startsWith("w/")) return renderWeapon(decodeURIComponent(h.slice(2)));
  if (h.startsWith("tag/")) return renderTag(decodeURIComponent(h.slice(4)));
  if (h.startsWith("compare")) {
    const q = new URLSearchParams(h.split("?")[1] || "");
    return renderCompare((q.get("ids") || "").split(",").filter(Boolean));
  }
  return renderHome();
}

// ── init ─────────────────────────────────────────────────────
function reindex() { BYID = new Map(WEAPONS.map(w => [w.id, w])); }

(async function init() {
  try {
    const [wd, td] = await Promise.all([loadJSON("../data/weapons-modern.json"), loadJSON("../data/tags.json")]);
    WEAPONS = wd.weapons; TAGS = td; WEIGHTS = td.weights || {};
    reindex();
    // 併入 Firestore mil_weapons_modern（若可用）
    const s = await getStore();
    if (s) {
      try {
        const docs = await s.loadModernWeapons();
        docs.forEach(d => { const w = d.data || d; const i = WEAPONS.findIndex(x => x.id === w.id); if (i >= 0) WEAPONS[i] = w; else WEAPONS.push(w); });
        reindex();
      } catch { /* ignore */ }
      s.onAuth(({ isAdmin: a }) => { isAdmin = a; const p = document.getElementById("expImport"); if (p) p.hidden = !a; if (a && document.getElementById("expImport")) wireExpImport(); });
    }
    window.addEventListener("hashchange", route);
    route();
    renderTray();
  } catch (e) {
    showErr(app, e.message);
  }
})();
