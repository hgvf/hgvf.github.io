/* ── Main application ───────────────────────────────────────────── */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { firebaseConfig, WORKER_URL } from './config.js';
import { initDB, getSectors, getSubsectors, getTickers, getAnalysis, getResearchNotes, subscribePrices } from './db.js';
import { initAuth, signIn, signOutUser, onAuthChange, getIdToken } from './auth.js';
import { renderTickerBar, renderSectorContent, updatePriceCells } from './render.js';
import {
  initAdminModals,
  openAddSector, submitSector,
  openAddSubsector, openEditSubsector, submitSubsector, handleDeleteSubsector,
  openEditNotes, submitNotes,
  openAddTicker, openEditTicker, submitTicker, handleDeleteTicker,
  openAddAnalysis, openEditAnalysis, submitAnalysis, handleDeleteAnalysis,
  openAddResearchNote, openEditResearchNote, submitResearchNote, handleDeleteResearchNote,
  openWhitelist, submitWhitelistEmail,
} from './admin.js';

/* ── App state ─────────────────────────────────────────────── */
let _isAdmin       = false;
let _sectors       = [];
let _currentSector = null;
let _unsubPrices   = null;
let _prices        = {};

/* ── Firebase init ─────────────────────────────────────────────── */
const app  = initializeApp(firebaseConfig);
initDB(app);
initAuth(app);

/* ── Navigation ────────────────────────────────────────────────── */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page    = document.getElementById(`page-${pageId}`);
  const navItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (page)    page.classList.add('active');
  if (navItem) navItem.classList.add('active');
  if (pageId === 'watchlist') loadWatchlist();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    showPage(item.dataset.page);
    if (window.innerWidth < 768) document.getElementById('sidebar')?.classList.remove('open');
  });
});
document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar')?.classList.toggle('open');
});

/* ── Auth ────────────────────────────────────────────────────── */
onAuthChange(({ user, isAdmin }) => {
  _isAdmin = isAdmin;
  const loginBtn  = document.getElementById('btnLogin');
  const logoutBtn = document.getElementById('btnLogout');
  const userInfo  = document.getElementById('userInfo');

  if (user) {
    if (loginBtn)  loginBtn.style.display  = 'none';
    if (logoutBtn) logoutBtn.style.display = '';
    if (userInfo)  userInfo.textContent    = user.displayName || user.email;
  } else {
    if (loginBtn)  loginBtn.style.display  = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userInfo)  userInfo.textContent    = '';
  }
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  const wlPage = document.getElementById('page-watchlist');
  if (wlPage?.classList.contains('active')) loadWatchlist();
});

document.getElementById('btnLogin')?.addEventListener('click',  () => signIn().catch(console.error));
document.getElementById('btnLogout')?.addEventListener('click', () => signOutUser().catch(console.error));

/* ── Watchlist loader ─────────────────────────────────────────────── */
async function loadWatchlist() {
  const sectorTabsEl = document.getElementById('sectorTabs');
  const statusEl     = document.getElementById('priceStatus');
  if (statusEl) statusEl.textContent = 'Loading…';

  try {
    _sectors = await getSectors();
  } catch (err) {
    console.error('getSectors failed:', err);
    if (statusEl) statusEl.textContent = 'Failed to load sectors: ' + err.message;
    return;
  }

  if (sectorTabsEl) {
    sectorTabsEl.innerHTML = '';
    _sectors.forEach(s => {
      const btn = document.createElement('button');
      btn.className        = 'sector-tab';
      btn.dataset.sectorId = s.id;
      btn.textContent      = s.name;
      btn.addEventListener('click', () => selectSector(s.id));
      sectorTabsEl.appendChild(btn);
    });
    if (_isAdmin) {
      const addSubBtn = document.createElement('button');
      addSubBtn.className = 'sector-tab sector-tab-add admin-only';
      addSubBtn.textContent = '+ Block';
      addSubBtn.addEventListener('click', () => {
        if (_currentSector) openAddSubsector(_currentSector.id, 0);
      });
      sectorTabsEl.appendChild(addSubBtn);
    }
  }

  try {
    if (_sectors.length > 0) await selectSector(_sectors[0].id);
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    console.error('selectSector failed:', err);
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
}

async function selectSector(sectorId) {
  _currentSector = _sectors.find(s => s.id === sectorId) || null;
  if (!_currentSector) return;

  document.querySelectorAll('.sector-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sectorId === sectorId);
  });

  _unsubPrices?.();

  const subsectors = await getSubsectors(sectorId);
  const subsectorsData = await Promise.all(
    subsectors.map(async sub => ({
      subsector:      sub,
      tickers:        await getTickers(sub.id),
      analysis:       await getAnalysis(sub.id),
      research_notes: await getResearchNotes(sub.id),
    }))
  );

  const tickerSymbols   = subsectorsData.flatMap(({ tickers }) => tickers.map(t => t.symbol));
  const overviewSymbols = _currentSector.ticker_overview || [];
  // Ticker bar shows every ticker in the sector (US/TW/JP/KR), overview first.
  const allSymbols      = [...new Set([...overviewSymbols, ...tickerSymbols])];

  renderTickerBar(allSymbols, _prices);
  const sectorContentEl = document.getElementById('sectorContent');
  if (sectorContentEl) {
    sectorContentEl.innerHTML = '';
    sectorContentEl.appendChild(renderSectorContent(_currentSector, subsectorsData, _prices, _isAdmin));
  }
  bindSectorEvents(subsectorsData);

  _unsubPrices = subscribePrices(allSymbols, newPrices => {
    _prices = newPrices;
    updatePriceCells(_prices);
    renderTickerBar(allSymbols, _prices);
  });
}

/* ── Admin event delegation ──────────────────────────────────────────── */
function bindSectorEvents(subsectorsData) {
  const container = document.getElementById('sectorContent');
  if (!container) return;

  const fresh = container.cloneNode(true);
  container.parentNode.replaceChild(fresh, container);
  const c = document.getElementById('sectorContent');

  c.addEventListener('click', e => {
    const header = e.target.closest('.research-header');
    if (header && !e.target.closest('.card-admin-ctrls')) {
      header.closest('.research-card')?.classList.toggle('open');
    }
  });
  c.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const header = e.target.closest('.research-header[role="button"]');
    if (header) { e.preventDefault(); header.closest('.research-card')?.classList.toggle('open'); }
  });

  if (!_isAdmin) return;

  const reload = () => selectSector(_currentSector?.id);

  c.addEventListener('click', async e => {
    const t = e.target.closest('button') || e.target;
    const action = t.dataset?.action;
    if (!action) return;

    if (action === 'edit-subsector') {
      const sub = subsectorsData.find(d => d.subsector.id === t.dataset.id)?.subsector;
      if (sub) openEditSubsector(sub);
    } else if (action === 'del-subsector') {
      await handleDeleteSubsector(t.dataset.id, reload);
    } else if (action === 'edit-notes') {
      const sub = subsectorsData.find(d => d.subsector.id === t.dataset.id)?.subsector;
      if (sub) openEditNotes(sub);
    } else if (action === 'add-ticker') {
      const subId = t.dataset.subsectorId;
      const sub   = subsectorsData.find(d => d.subsector.id === subId);
      if (subId) openAddTicker(subId, sub?.tickers.length || 0);
    } else if (action === 'edit-ticker') {
      const sub = subsectorsData.find(d => d.tickers.some(tk => tk.id === t.dataset.id));
      const ticker = sub?.tickers.find(tk => tk.id === t.dataset.id);
      if (ticker) openEditTicker(ticker);
    } else if (action === 'del-ticker') {
      await handleDeleteTicker(t.dataset.id, reload);
    } else if (action === 'add-analysis') {
      const subId = t.dataset.subsectorId;
      const sub   = subsectorsData.find(d => d.subsector.id === subId);
      openAddAnalysis(subId, sub?.analysis.length || 0);
    } else if (action === 'edit-analysis') {
      const a = subsectorsData.flatMap(d => d.analysis).find(x => x.id === t.dataset.id);
      if (a) openEditAnalysis(a);
    } else if (action === 'del-analysis') {
      await handleDeleteAnalysis(t.dataset.id, reload);
    } else if (action === 'add-research') {
      const subId = t.dataset.subsectorId;
      const sub   = subsectorsData.find(d => d.subsector.id === subId);
      openAddResearchNote(subId, sub?.research_notes.length || 0);
    } else if (action === 'edit-research') {
      const note = subsectorsData.flatMap(d => d.research_notes).find(n => n.id === t.dataset.id);
      if (note) openEditResearchNote(note);
    } else if (action === 'del-research') {
      await handleDeleteResearchNote(t.dataset.id, reload);
    }
  });
}

/* ── Modal form submissions ──────────────────────────────────────────── */
document.getElementById('formSector')?.addEventListener('submit', async e => {
  e.preventDefault(); await submitSector(() => loadWatchlist());
});
document.getElementById('formSubsector')?.addEventListener('submit', async e => {
  e.preventDefault(); await submitSubsector(() => selectSector(_currentSector?.id));
});
document.getElementById('formNotes')?.addEventListener('submit', async e => {
  e.preventDefault(); await submitNotes(() => selectSector(_currentSector?.id));
});
document.getElementById('formTicker')?.addEventListener('submit', async e => {
  e.preventDefault(); await submitTicker(() => selectSector(_currentSector?.id));
});
document.getElementById('formAnalysis')?.addEventListener('submit', async e => {
  e.preventDefault(); await submitAnalysis(() => selectSector(_currentSector?.id));
});
document.getElementById('formResearch')?.addEventListener('submit', async e => {
  e.preventDefault(); await submitResearchNote(() => selectSector(_currentSector?.id));
});
document.getElementById('formWhitelistEmail')?.addEventListener('submit', async e => {
  e.preventDefault(); await submitWhitelistEmail();
});

/* ── Admin toolbar ────────────────────────────────────────────────────── */
document.getElementById('btnWhitelist')?.addEventListener('click', () => openWhitelist());

/* ── Manual price refresh ─────────────────────────────────────────────── */
document.getElementById('btnRefreshPrices')?.addEventListener('click', async () => {
  const btn      = document.getElementById('btnRefreshPrices');
  const statusEl = document.getElementById('priceStatus');
  btn.disabled   = true;
  if (statusEl) { statusEl.textContent = 'Fetching…'; statusEl.className = 'price-status'; }

  try {
    const token = await getIdToken();
    const res   = await fetch(`${WORKER_URL}/trigger`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (statusEl) { statusEl.textContent = `Updated ${data.updated ?? '?'} symbols`; statusEl.className = 'price-status ok'; }
    } else {
      if (statusEl) { statusEl.textContent = `Error: ${data.error || res.status}`; statusEl.className = 'price-status err'; }
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = `Failed: ${err.message}`; statusEl.className = 'price-status err'; }
  } finally {
    btn.disabled = false;
  }
});

/* ── Boot ───────────────────────────────────────────────────────────── */
initAdminModals();
showPage('home');
