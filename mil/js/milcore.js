// milcore.js — 軍事專區共用工具：側邊欄注入、頂部分頁、fetch 與格式化 helper。
// 站台為 GitHub Pages 純靜態，全部相對路徑；depth 由呼叫端傳入 base（"../" 或 "../../"）。

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ── 專區七 / 九頁分頁定義（相對於 mil/ 根）──
export const MIL_PAGES = [
  { key: "hub",       href: "index.html",           label: "總覽",     num: "" },
  { key: "explorer",  href: "explorer/index.html",  label: "武器探索", num: "①" },
  { key: "war",       href: "war/index.html",       label: "戰役消耗", num: "②" },
  { key: "arsenal",   href: "arsenal/index.html",   label: "系統譜系", num: "③" },
  { key: "strait",    href: "strait/index.html",    label: "台海基線", num: "④" },
  { key: "doctrine",  href: "doctrine/index.html",  label: "文件漂移", num: "⑤" },
  { key: "exercises", href: "exercises/index.html", label: "演習行事曆", num: "⑥" },
  { key: "defense",   href: "defense/index.html",   label: "每日軍武", num: "⑦" },
  { key: "digest",    href: "digest/index.html",    label: "每日彙整", num: "⑧" },
];

// milToRoot: 從當前 mil 子頁回到 mil/ 根的前綴。
//   mil/index.html            -> ""       (root-of-mil)
//   mil/war/index.html        -> "../"
export function renderMilnav(hostSel, activeKey, milToRoot = "") {
  const host = typeof hostSel === "string" ? document.querySelector(hostSel) : hostSel;
  if (!host) return;
  host.className = "milnav";
  host.innerHTML = MIL_PAGES.map(p => {
    const cur = p.key === activeKey ? ' aria-current="page"' : "";
    const num = p.num ? `<span class="num">${p.num}</span>` : "";
    return `<a href="${milToRoot}${p.href}"${cur}>${num}${p.label}</a>`;
  }).join("");
}

// ── 共用側邊欄（重用 partials/sidebar.html）──
// base = 從當前頁回到站台根的前綴（mil/index.html => "../"，mil/war/index.html => "../../"）。
export async function mountMilSidebar(base) {
  const host = document.getElementById("siteSidebar");
  if (!host) return;
  try {
    let html = await (await fetch(`${base}partials/sidebar.html`)).text();
    // partial 內的相對連結一律以 "../" 指向站台根；改寫成正確 base。
    html = html.replace(/(?:href|src)="\.\.\//g, m => m.replace("../", base));
    host.innerHTML = html;
  } catch (e) { console.error("sidebar load failed", e); return; }

  // 標記 Military active
  host.querySelector('.nav-folder[data-folder="military"]')?.classList.add("open");

  host.querySelectorAll(".nav-folder-header").forEach(btn =>
    btn.addEventListener("click", () => btn.closest(".nav-folder")?.classList.toggle("open")));
  document.getElementById("menuToggle")?.addEventListener("click", () =>
    document.getElementById("sidebar")?.classList.toggle("open"));

  // 認證（重用 reports.js）
  try {
    const { onAuth, signInGoogle, signOutUser } = await import(`${base}js/reports.js`);
    const loginBtn = host.querySelector("#btnLogin");
    const logoutBtn = host.querySelector("#btnLogout");
    const userInfo = host.querySelector("#userInfo");
    loginBtn?.addEventListener("click", () => signInGoogle().catch(console.error));
    logoutBtn?.addEventListener("click", () => signOutUser().catch(console.error));
    onAuth(({ user, isAdmin }) => {
      if (user) {
        if (loginBtn) loginBtn.style.display = "none";
        if (logoutBtn) logoutBtn.style.display = "";
        if (userInfo) userInfo.textContent = user.displayName || user.email;
      } else {
        if (loginBtn) loginBtn.style.display = "";
        if (logoutBtn) logoutBtn.style.display = "none";
        if (userInfo) userInfo.textContent = "";
      }
      document.body.dispatchEvent(new CustomEvent("mil-auth", { detail: { user, isAdmin } }));
    });
  } catch (e) { console.warn("auth wiring skipped", e); }
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
