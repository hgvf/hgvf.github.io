/* ── Main application ───────────────────────────────────────────── */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { firebaseConfig, WORKER_URL } from './config.js';
import { initDB, getSectors, updateSector, getSectorTree, reorderSubsectors, subscribePrices, getHomeProfile, getEventTickerMap } from './db.js';
import { initAuth, signIn, signOutUser, onAuthChange, getIdToken } from './auth.js';
import { renderTickerBar, renderSectorContent, updatePriceCells } from './render.js';
import { getCountsByTicker as getIntelCounts, onIntelChange } from './intel.js';
import {
  initAdminModals,
  openAddSector, openEditSector, submitSector, handleDeleteSector,
  openAddSubsector, openEditSubsector, submitSubsector, handleDeleteSubsector,
  openEditNotes, submitNotes,
  openAddTicker, openEditTicker, submitTicker, handleDeleteTicker,
  openAddAnalysis, openEditAnalysis, submitAnalysis, handleDeleteAnalysis,
  openAddResearchNote, openEditResearchNote, submitResearchNote, handleDeleteResearchNote,
  openWhitelist, submitWhitelistEmail,
  openEditHome, submitHome,
  openEditPubs, submitPubs, addBlankPubRow,
} from './admin.js';
import { initExperience } from './experience.js';

/* ── App state ─────────────────────────────────────────────── */
let _isAdmin          = false;
let _homeProfile      = null;   // editable About Me / Interests (site_content/home)
let _sectors          = [];
let _currentSector    = null;
let _unsubPrices      = null;
let _prices           = {};
let _subsectorSymbols = [];  // symbols from subsector watchlist tables, kept in sync with selectSector
let _eventTickerMap   = {};  // symbol → {supply,industry,earnings}; loaded once, read-only
let _intelCounts      = {};  // symbol → # of手動輸入的產業情報 (intel_notes); live via onIntelChange

// Merge the read-only event map with the live intel-note counts so ticker cards
// render 供 / 產 / 法 tags AND the 訊<n> intel-count badge from one events object.
function mergedEvents() {
  const out = {};
  const syms = new Set([...Object.keys(_eventTickerMap), ...Object.keys(_intelCounts)]);
  syms.forEach(sym => {
    const ev = _eventTickerMap[sym];
    const n = _intelCounts[sym] || 0;
    out[sym] = { ...(ev || {}), ...(n ? { intel: { count: n } } : {}) };
  });
  return out;
}

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

document.querySelectorAll('[data-page]').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    showPage(item.dataset.page);
    if (window.innerWidth < 768) document.getElementById('sidebar')?.classList.remove('open');
  });
});
document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar')?.classList.toggle('open');
});

// Deep-link support: open a page from a URL hash (e.g. index.html#watchlist),
// used by the Reports pages' sidebar links back into the SPA.
function showPageFromHash() {
  const id = location.hash.replace('#', '');
  if (id && document.getElementById(`page-${id}`)) showPage(id);
}
showPageFromHash();
window.addEventListener('hashchange', showPageFromHash);

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

/* ── Home profile (editable About Me / Interests / Publications) ─────── */
function _escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Baseline content — mirrors the static HTML so the edit form always opens
// pre-filled with the currently-shown values, even before any Firestore doc
// exists. A stored profile overrides these field-by-field.
const HOME_DEFAULTS = {
  name: 'Kuan-Wei Tang (湯冠維)',
  about: 'I am deeply interested in the field of deep learning and am currently engaged in related work.',
  interests: ['Deep Learning', 'Seismology', 'Seismic Phase Picking'],
  publications: [
    {
      authors: 'Tang, K. W., Chen, K. Y., Chen, D. Y., Chin, T. L., & Hsu, T. Y.',
      title: 'The CWA benchmark: A seismic dataset from Taiwan for seismic research.',
      title_url: 'https://pubs.geoscienceworld.org/ssa/srl/article/96/3/2079/650394/The-CWA-Benchmark-A-Seismic-Dataset-from-Taiwan?guestAccessKey=',
      venue: 'Seismological Research Letters, 96(3), 2079-2091.',
      year: '2025',
      links: [{ label: 'Dataset', url: 'https://huggingface.co/datasets/NLPLabNTUST/Merged-CWA' }],
    },
    {
      authors: 'Tang, K. W., & Chen, K. Y.',
      title: 'SeismoDual: A dual-domain deep learning framework for robust seismic phase picking.',
      title_url: 'https://www.sciencedirect.com/science/article/pii/S0098300425002304',
      venue: 'Computers & Geosciences, 106080.',
      year: '2025',
      links: [{ label: 'Code', url: 'https://github.com/hgvf/SeismoDual.git' }],
    },
  ],
};

// Merge the stored profile over the defaults, field by field.
function resolvedProfile() {
  const p = _homeProfile || {};
  return {
    name:         (p.name && p.name.trim()) ? p.name : HOME_DEFAULTS.name,
    about:        (typeof p.about === 'string' && p.about.trim()) ? p.about : HOME_DEFAULTS.about,
    interests:    Array.isArray(p.interests) ? p.interests : HOME_DEFAULTS.interests,
    publications: Array.isArray(p.publications) ? p.publications : HOME_DEFAULTS.publications,
  };
}

function renderHomeProfile(profile) {
  const nameEl = document.getElementById('homeName');
  if (nameEl) nameEl.textContent = profile.name;

  const aboutEl = document.getElementById('homeAbout');
  if (aboutEl) {
    aboutEl.innerHTML = profile.about.split(/\n+/).filter(Boolean)
      .map(line => `<p>${_escHtml(line)}</p>`).join('');
  }

  const wrap = document.getElementById('homeInterestsWrap');
  const tags = document.getElementById('homeInterests');
  if (tags) tags.innerHTML = (profile.interests || [])
    .map(t => `<span class="about-tag">${_escHtml(t)}</span>`).join('');
  if (wrap) wrap.style.display = (profile.interests || []).length ? '' : 'none';
}

function pubItemHTML(p) {
  const links = (p.links || []).filter(l => l && l.label).map(l =>
    l.url ? `[<a href="${_escHtml(l.url)}" target="_blank" rel="noopener">${_escHtml(l.label)}</a>]`
          : `[${_escHtml(l.label)}]`).join(' ');
  const title = p.title_url
    ? `<a class="pub-title" href="${_escHtml(p.title_url)}" target="_blank" rel="noopener">${_escHtml(p.title)}</a>`
    : `<span class="pub-title">${_escHtml(p.title)}</span>`;
  return `<li class="publication-item">
    <span class="pub-authors">${_escHtml(p.authors)}</span>.
    ${title}.
    <span class="pub-venue">${_escHtml(p.venue)}</span>${p.year ? ',' : ''}
    ${p.year ? `<span class="pub-year">${_escHtml(p.year)}</span>.` : ''}
    ${links ? `<span class="pub-links">${links}</span>` : ''}
  </li>`;
}

function renderPublications(pubs) {
  const ol = document.getElementById('publicationList');
  if (ol) ol.innerHTML = (pubs || []).map(pubItemHTML).join('');
}

function renderAllHome() {
  const r = resolvedProfile();
  renderHomeProfile(r);
  renderPublications(r.publications);
}

async function loadHomeProfile() {
  try {
    _homeProfile = await getHomeProfile();
  } catch (err) {
    console.warn('home profile load failed:', err);  // non-fatal — defaults stay
  }
  renderAllHome();
}
loadHomeProfile();

/* ── Experience & Education (editable timeline) ─────────────────────── */
initExperience();

document.getElementById('btnEditHome')?.addEventListener('click', () => openEditHome(resolvedProfile()));
document.getElementById('formHome')?.addEventListener('submit', async e => {
  e.preventDefault();
  await submitHome(saved => { _homeProfile = { ..._homeProfile, ...saved }; renderAllHome(); });
});

document.getElementById('btnEditPubs')?.addEventListener('click', () => openEditPubs(resolvedProfile().publications));
document.getElementById('btnAddPub')?.addEventListener('click', () => addBlankPubRow());
document.getElementById('formPublications')?.addEventListener('submit', async e => {
  e.preventDefault();
  await submitPubs(pubs => { _homeProfile = { ..._homeProfile, publications: pubs }; renderAllHome(); });
});

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
      if (_isAdmin) {
        btn.addEventListener('dblclick', e => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.className = 'sector-tab-rename-input';
          input.value = s.name;
          btn.textContent = '';
          btn.appendChild(input);
          input.focus();
          input.select();
          const commit = async () => {
            const newName = input.value.trim();
            if (newName && newName !== s.name) {
              await updateSector(s.id, { name: newName });
              s.name = newName;
            }
            btn.textContent = s.name;
          };
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = s.name; input.blur(); }
          });
          input.addEventListener('blur', commit);
        });
      }
      sectorTabsEl.appendChild(btn);
    });
    if (_isAdmin) {
      const addTabBtn = document.createElement('button');
      addTabBtn.className = 'sector-tab sector-tab-add admin-only';
      addTabBtn.textContent = '+ Tab';
      addTabBtn.addEventListener('click', () => openAddSector(_sectors.length));
      sectorTabsEl.appendChild(addTabBtn);
    }
  }

  try {
    if (_sectors.length > 0) await selectSector(_sectors[0].id);
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    console.error('selectSector failed:', err);
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }

  // Load event tags in the background (never blocks the watchlist). When ready,
  // re-render the current sector so cards pick up 供 / 產 / 法 tags.
  getEventTickerMap()
    .then(map => { _eventTickerMap = map; if (_currentSector) selectSector(_currentSector.id); })
    .catch(err => console.warn('event tags unavailable:', err));

  // Intel-note counts arrive from a live Firestore listener (intel.js). Seed the
  // current counts and re-render the ticker bar whenever a note is added / edited
  // / removed so the 訊<n> badge stays in sync across tabs and devices.
  _intelCounts = getIntelCounts();
  onIntelChange(() => {
    _intelCounts = getIntelCounts();
    if (_currentSector) selectSector(_currentSector.id);
  });
}

async function selectSector(sectorId) {
  _currentSector = _sectors.find(s => s.id === sectorId) || null;
  if (!_currentSector) return;

  document.querySelectorAll('.sector-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sectorId === sectorId);
  });

  _unsubPrices?.();

  // One query per collection for the whole sector (see getSectorTree) instead
  // of three queries per subsector.
  const subsectorsData = await getSectorTree(sectorId);

  _subsectorSymbols     = subsectorsData.flatMap(({ tickers }) => tickers.map(t => t.symbol));
  const overviewSymbols = _currentSector.ticker_overview || [];
  // Ticker bar shows every ticker in the sector (US/TW/JP/KR), overview first.
  const allSymbols      = [...new Set([...overviewSymbols, ..._subsectorSymbols])];

  // Subsector groups for the "依題材" view (name → its watchlist symbols).
  const groups = subsectorsData.map(({ subsector, tickers }) => ({
    id: subsector.id, name: subsector.name, symbols: tickers.map(t => t.symbol),
  }));
  // Admin: drag a 依題材 zone in the ticker bar to reorder. Persist the new
  // order and make the lower notes/watchlist blocks follow (they aren't
  // draggable themselves). Only real subsector zones carry an id — the
  // leftover 精選/其他 zone is excluded by render.js.
  const onReorderGroups = _isAdmin ? async orderedIds => {
    subsectorsData.sort((a, b) => orderedIds.indexOf(a.subsector.id) - orderedIds.indexOf(b.subsector.id));
    barOpts.groups = subsectorsData.map(({ subsector, tickers }) => ({
      id: subsector.id, name: subsector.name, symbols: tickers.map(t => t.symbol),
    }));
    reorderSubsectorBlocks(orderedIds);
    try { await reorderSubsectors(orderedIds); }
    catch (err) { console.error('reorder persist failed:', err); }
  } : null;
  const barOpts = { groups, events: mergedEvents(), onReorderGroups };

  renderTickerBar(allSymbols, _prices, _isAdmin, _currentSector, barOpts);

  const sectorContentEl = document.getElementById('sectorContent');
  if (sectorContentEl) {
    sectorContentEl.innerHTML = '';
    sectorContentEl.appendChild(renderSectorContent(_currentSector, subsectorsData, _prices, _isAdmin));
  }
  bindSectorEvents(subsectorsData);

  _unsubPrices = subscribePrices(allSymbols, newPrices => {
    _prices = newPrices;
    updatePriceCells(_prices);
    renderTickerBar(allSymbols, _prices, _isAdmin, _currentSector, barOpts);
  });
}

/* ── Reorder lower subsector blocks to follow the ticker-bar drag ────────
   The 依題材 zones (top) are the draggable surface; when one is dropped this
   moves the matching lower notes/watchlist blocks into the same order in
   place (no re-render, no refetch). */
function reorderSubsectorBlocks(orderedIds) {
  const container = document.getElementById('sectorContent');
  if (!container) return;
  const blocks = new Map(
    [...container.querySelectorAll('.subsector-block')].map(b => [b.dataset.subsectorId, b])
  );
  // Leave the first block where it sits and chain the rest after it — this
  // keeps the run between the "+ Add Subsector" and "Delete tab" buttons.
  let prev = null;
  orderedIds.forEach(id => {
    const block = blocks.get(id);
    if (!block) return;
    if (prev) prev.after(block);
    prev = block;
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

    if (action === 'del-sector') {
      await handleDeleteSector(t.dataset.sectorId, t.dataset.sectorName, () => loadWatchlist());
    } else if (action === 'add-subsector') {
      const sectorId = t.dataset.sectorId;
      if (sectorId) openAddSubsector(sectorId, subsectorsData.length);
    } else if (action === 'edit-subsector') {
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
  e.preventDefault(); await submitSector(async () => {
    const prevId = _currentSector?.id;
    await loadWatchlist();
    if (prevId && _sectors.find(s => s.id === prevId)) await selectSector(prevId);
  });
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
      if (statusEl) {
        const failed = Array.isArray(data.failed) ? data.failed : [];
        let msg = `Updated ${data.updated ?? '?'} symbols`;
        if (failed.length) msg += ` · ${failed.length} not updated: ${failed.slice(0, 8).join(', ')}${failed.length > 8 ? '…' : ''}`;
        // When nothing came back, name the likely cause from the worker's diag
        // (Yahoo crumb/cookie failed vs. a rate-limited batch) instead of just
        // "0 updated".
        if (data.updated === 0 && data.diag) {
          msg += data.diag.sessionOk === false
            ? ' · Yahoo session failed (crumb/cookie) — 稍後再試'
            : ' · Yahoo returned no quotes (rate-limited?) — 稍後再試';
        }
        statusEl.textContent = msg;
        statusEl.className   = `price-status ${failed.length ? 'warn' : 'ok'}`;
        if (failed.length) statusEl.title = failed.join(', ');
      }
    } else {
      if (statusEl) { statusEl.textContent = `Error: ${data.error || res.status}`; statusEl.className = 'price-status err'; }
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = `Failed: ${err.message}`; statusEl.className = 'price-status err'; }
  } finally {
    btn.disabled = false;
  }
});

/* ── Ticker bar admin actions (delegated once) ─────────────────────── */
document.getElementById('tickerBarInner')?.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  e.preventDefault();
  if (btn.dataset.action === 'edit-ticker-overview') {
    if (_currentSector) openEditSector(_currentSector);
  } else if (btn.dataset.action === 'del-ticker-overview') {
    const sym = btn.dataset.symbol;
    if (!_currentSector || !sym) return;
    const updated = [...new Set((_currentSector.ticker_overview || []).filter(s => s !== sym))];
    await updateSector(_currentSector.id, { ticker_overview: updated });
    _currentSector.ticker_overview = updated;
    const allSymbols = [...new Set([...updated, ..._subsectorSymbols])];
    renderTickerBar(allSymbols, _prices, _isAdmin, _currentSector, { events: mergedEvents() });
    _unsubPrices?.();
    _unsubPrices = subscribePrices(allSymbols, newPrices => {
      _prices = newPrices;
      updatePriceCells(_prices);
      renderTickerBar(allSymbols, _prices, _isAdmin, _currentSector, { events: mergedEvents() });
    });
  }
});

/* ── Boot ───────────────────────────────────────────────────────────── */
initAdminModals();

document.querySelectorAll('.nav-trigger').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();

    const pageId = item.dataset.page;

    if (!pageId) return;

    showPage(pageId);

    if (window.innerWidth < 768) {
      document.getElementById('sidebar')
        ?.classList.remove('open');
    }
  });
});

// Default to home only when no deep-link hash (e.g. index.html#watchlist) has
// already selected another page — otherwise this would override the hash and
// snap the Reports-sidebar "Stock Watchlist" link back to the home page.
{
  const hashId = location.hash.replace('#', '');
  if (!(hashId && document.getElementById(`page-${hashId}`))) showPage('home');
}
