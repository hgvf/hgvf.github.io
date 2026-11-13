/* tools.js — sign-in gate for links that need a whitelisted Google account
   (e.g. 旅遊分帳, now listed under Side Project → 工具與其他).

   Any <a class="tool-auth"> inside a container passed to bindAuthGate():
   while signed out it shows a lock (.tool-lock) and clicking is blocked with a
   toast; the target page also gates on sign-in and Firestore rules enforce it
   server-side. Call setToolsSignedIn() from the page's auth listener. */

export const ICON_LOCK = '<svg class="tool-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

let _signedIn = false;
const _containers = new Set();

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

/** Guard every .tool-auth link inside `container`. */
export function bindAuthGate(container) {
  if (!container) return;
  container.querySelectorAll('.tool-auth').forEach(a => {
    if (a.dataset.gated) return;
    a.dataset.gated = '1';
    a.addEventListener('click', e => {
      if (_signedIn) return;
      e.preventDefault();
      a.classList.remove('tool-shake');
      void a.offsetWidth;
      a.classList.add('tool-shake');
      toast('🔒 需要先登入（左下 Sign In）才能使用');
    });
  });
  _containers.add(container);
  container.classList.toggle('tools-unlocked', _signedIn);
}

/** Call from the page's auth listener so the lock badges follow sign-in state. */
export function setToolsSignedIn(signedIn) {
  _signedIn = !!signedIn;
  _containers.forEach(c => c.classList.toggle('tools-unlocked', _signedIn));
}
