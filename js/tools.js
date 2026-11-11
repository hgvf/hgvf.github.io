/* tools.js — single source of truth for the Tools sidebar folder.
   Used by the SPA (index.html) and by the shared report sidebar
   (partials/sidebar.html via js/sidebar.js).

   Each tool is a page of this site (url relative to the site root).
   requiresAuth → while signed out the link shows a lock and clicking it is
   blocked with a toast; the tool page itself also gates on sign-in, and the
   Firestore rules enforce it server-side. */

export const TOOLS = [
  {
    name: '旅遊分帳',
    url: 'split/index.html',
    requiresAuth: true,
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>',
  },
];

const ICON_LOCK = '<svg class="tool-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _signedIn = false;
let _containers = [];

function toast(msg) {
  let el = document.getElementById('toolToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toolToast';
    el.className = 'tool-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('show');
  void el.offsetWidth;              // restart the animation
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Fill a sidebar folder's children with one link per tool. `base` prefixes
    the site-relative url ("../" on report pages one folder down). */
export function renderToolsNav(container, base = '') {
  if (!container) return;
  container.innerHTML = TOOLS.map((t, i) => `
    <a class="nav-item tool-item${t.requiresAuth ? ' tool-auth' : ''}" data-tool="${i}" href="${esc(base + t.url)}">
      <span class="nav-icon">${t.icon}</span>
      <span class="tool-name">${esc(t.name)}</span>
      ${t.requiresAuth ? ICON_LOCK : ''}
    </a>`).join('');
  container.querySelectorAll('.tool-auth').forEach(a =>
    a.addEventListener('click', e => {
      if (_signedIn) return;
      e.preventDefault();
      a.classList.remove('tool-shake');
      void a.offsetWidth;
      a.classList.add('tool-shake');
      toast('🔒 需要先登入（左下 Sign In）才能使用');
    }));
  _containers.push(container);
  setToolsSignedIn(_signedIn);
}

/** Call from the page's auth listener so the lock badges follow sign-in state. */
export function setToolsSignedIn(signedIn) {
  _signedIn = !!signedIn;
  _containers.forEach(c => c.classList.toggle('tools-unlocked', _signedIn));
}
