// milcore.js — 軍事專區共用工具：側邊欄注入、頂部分頁、fetch 與格式化 helper。
// 站台為 GitHub Pages 純靜態，全部相對路徑；depth 由呼叫端傳入 base（"../" 或 "../../"）。

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ── 專區分頁定義（相對於 mil/ 根）──
export const MIL_PAGES = [
  { key: "explorer",  href: "explorer/index.html",  label: "武器探索",   num: "①" },
  { key: "war",       href: "war/index.html",       label: "戰役消耗",   num: "②" },
  { key: "arsenal",   href: "arsenal/index.html",   label: "系統譜系",   num: "③" },
  { key: "defense",   href: "defense/index.html",   label: "每日軍武合約", num: "④" },
];

// 頂部工具列：回主站連結 + 專區分頁 + 迷你登入。取代側邊欄。
// milToRoot：從當前 mil 子頁回到 mil/ 根的前綴（mil/war/index.html => "../"）。
export function renderMilnav(hostSel, activeKey, milToRoot = "") {
  const host = typeof hostSel === "string" ? document.querySelector(hostSel) : hostSel;
  if (!host) return;
  host.className = "milnav-bar";
  const tabs = MIL_PAGES.map(p => {
    const cur = p.key === activeKey ? ' aria-current="page"' : "";
    const num = p.num ? `<span class="num">${p.num}</span>` : "";
    return `<a href="${milToRoot}${p.href}"${cur}>${num}${p.label}</a>`;
  }).join("");
  host.innerHTML = `
    <a class="milnav-home" href="${milToRoot}../index.html" title="回主站">← 主站</a>
    <nav class="milnav">${tabs}</nav>
    <div class="milnav-auth" id="milAuth"></div>`;
}

// ── 迷你登入控制（military 頁面無側邊欄，登入改在頂部）──
// base = 從當前頁回到站台根的前綴（mil/war/index.html => "../../"）。
export async function mountMilAuth(base) {
  const host = document.getElementById("milAuth");
  if (!host) return;
  let store;
  try { store = await import(`${base}js/milstore.js`); }
  catch { host.innerHTML = ""; return; }
  const draw = (user) => {
    host.innerHTML = user
      ? `<span class="mil-user" title="${esc(user.email || "")}">${esc(user.displayName || user.email)}</span><button class="mil-auth-btn" id="milSignOut">登出</button>`
      : `<button class="mil-auth-btn" id="milSignIn">登入</button>`;
    host.querySelector("#milSignIn")?.addEventListener("click", () => store.signIn().catch(console.error));
    host.querySelector("#milSignOut")?.addEventListener("click", () => store.signOutUser().catch(console.error));
  };
  store.onAuth(({ user, isAdmin }) => {
    draw(user);
    document.body.dispatchEvent(new CustomEvent("mil-auth", { detail: { user, isAdmin } }));
  });
}

// ── fetch JSON，失敗時在 host 顯示友善提示 ──
export async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}
export function showErr(host, msg) {
  const el = typeof host === "string" ? document.querySelector(host) : host;
  if (!el) return;
  el.innerHTML = `<div class="mil-err"><b>資料載入失敗</b><br>${esc(msg || "")}<br><br>
    若以檔案方式（<code>file://</code>）直接開啟，瀏覽器會擋住 <code>fetch</code>。<br>
    請改用 <code>python3 -m http.server</code> 於本機啟動，或直接透過 GitHub Pages 開啟本頁。</div>`;
}

// ── banner ──
export function bannerHTML(text) {
  return `<div class="mil-banner">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
    <span>${text}</span></div>`;
}

// ── 格式化 ──
export function money(v) {
  if (v == null) return "未揭露";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Number(v).toLocaleString()}`;
}
export function fmtInt(v) { return v == null ? "—" : Number(v).toLocaleString(); }
export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(String(iso) + (String(iso).length <= 10 ? "T00:00:00" : ""));
  return isNaN(d) ? String(iso) : d.toLocaleDateString("en-CA");
}
export const NS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
