// sidebar.js — inject the shared site sidebar into a report page and wire
// folder toggles, the mobile menu button, active highlighting, and auth.

import { onAuth, signInGoogle, signOutUser } from "./reports.js";
import { renderSideProjectNav } from "./sideprojects.js";

export async function mountSidebar(activeReport) {
  const host = document.getElementById("siteSidebar");
  if (!host) return;
  try {
    host.innerHTML = await (await fetch("../partials/sidebar.html")).text();
  } catch (e) { console.error("sidebar load failed", e); return; }

  if (activeReport) {
    const activeLink = host.querySelector(`[data-report="${activeReport}"]`);
    activeLink?.classList.add("active");
    // Folders default collapsed; open only the one holding the current page so
    // its context is visible (matches the SPA's newest-first layout).
    activeLink?.closest(".nav-folder")?.classList.add("open");
  }

  renderSideProjectNav(host.querySelector("#sideProjectNav"));

  // Headers with data-href (Side Project) open their intro page in the SPA.
  host.querySelectorAll(".nav-folder-header").forEach(btn =>
    btn.addEventListener("click", () => {
      if (btn.dataset.href) { location.href = btn.dataset.href; return; }
      btn.closest(".nav-folder")?.classList.toggle("open");
    }));

  document.getElementById("menuToggle")?.addEventListener("click", () =>
    document.getElementById("sidebar")?.classList.toggle("open"));

  const loginBtn = host.querySelector("#btnLogin");
  const logoutBtn = host.querySelector("#btnLogout");
  const userInfo = host.querySelector("#userInfo");
  loginBtn?.addEventListener("click", () => signInGoogle().catch(console.error));
  logoutBtn?.addEventListener("click", () => signOutUser().catch(console.error));
  onAuth(({ user }) => {
    if (user) {
      if (loginBtn) loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "";
      if (userInfo) userInfo.textContent = user.displayName || user.email;
    } else {
      if (loginBtn) loginBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (userInfo) userInfo.textContent = "";
    }
  });
}
