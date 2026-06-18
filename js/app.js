function initNav() {
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  const navTriggers = document.querySelectorAll('.nav-trigger[data-page]');

  function goToPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');
    const navEl = document.querySelector('.nav-item[data-page="' + pageId + '"]');
    if (navEl) navEl.classList.add('active');
    if (pageId === 'watchlist' && !window._watchlistLoaded) {
      window._watchlistLoaded = true;
      loadWatchlist();
    }
  }

  navItems.forEach(item => { item.addEventListener('click', e => { e.preventDefault(); goToPage(item.dataset.page); }); });
  navTriggers.forEach(item => { item.addEventListener('click', e => { e.preventDefault(); goToPage(item.dataset.page); }); });
}

function initSidebar() {
  const btn = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  if (!btn || !sidebar) return;
  btn.addEventListener('click', () => sidebar.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== btn)
      sidebar.classList.remove('open');
  });
}

async function loadWatchlist() {
  let watchlistData, priceData;
  try {
    const [wlRes, prRes] = await Promise.all([fetch('data/watchlist.json'), fetch('data/prices.json')]);
    watchlistData = await wlRes.json();
    priceData     = await prRes.json();
  } catch (err) {
    document.getElementById('sectorContent').innerHTML = '<p class="state-msg">Failed to load watchlist data.</p>';
    console.error(err);
    return;
  }
  const upd = document.getElementById('lastUpdated');
  if (upd && priceData.last_updated) upd.textContent = 'Updated: ' + priceData.last_updated;
  renderSectors(watchlistData.sectors, priceData.prices || {});
}

function renderSectors(sectors, prices) {
  const tabbar = document.getElementById('sectorTabbar');
  const tickerBarInner = document.getElementById('tickerBarInner');
  const content = document.getElementById('sectorContent');
  tabbar.innerHTML = '';
  content.innerHTML = '';
  if (!sectors || sectors.length === 0) { content.innerHTML = '<p class="state-msg">No sectors configured.</p>'; return; }
  sectors.forEach((sector, idx) => {
    const tab = document.createElement('button');
    tab.className = 'sector-tab' + (idx === 0 ? ' active' : '');
    tab.textContent = sector.name;
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sector-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showSector(sector, prices, tickerBarInner, content);
    });
    tabbar.appendChild(tab);
  });
  showSector(sectors[0], prices, tickerBarInner, content);
}

function showSector(sector, prices, tickerBarInner, content) {
  tickerBarInner.innerHTML = '';
  (sector.ticker_overview || []).forEach(sym => tickerBarInner.appendChild(buildTickerCard(sym, prices[sym] || {})));
  content.innerHTML = '';
  (sector.subsectors || []).forEach(sub => content.appendChild(buildSubsectorBlock(sub, prices)));
}

function buildTickerCard(symbol, p) {
  const dayChg = p.day_change_pct ?? null;
  // cls is 'positive' | 'negative' | 'neutral' — used directly in CSS
  const cls = changeClass(dayChg);
  const colorMap = { positive: 'var(--positive)', negative: 'var(--negative)', neutral: 'var(--neutral)' };
  const card = document.createElement('a');
  card.className = 'ticker-card';
  card.href = tradingViewUrl(symbol);
  card.target = '_blank';
  card.rel = 'noopener';
  card.style.setProperty('--indicator-color', colorMap[cls]);
  card.title = 'Open in TradingView';
  const price = p.last != null ? formatPrice(p.last, symbol) : '—';
  const chgStr = dayChg != null ? (dayChg >= 0 ? '+' : '') + dayChg.toFixed(2) + '%' : '—';
  card.innerHTML = `<span class="tc-symbol">${symbol}</span><span class="tc-name">${p.name || ''}</span><span class="tc-price">${price}</span><span class="tc-change ${cls}">${chgStr}</span>`;
  return card;
}

function buildSubsectorBlock(sub, prices) {
  const block = document.createElement('div');
  block.className = 'subsector-block';
  const title = document.createElement('h3');
  title.className = 'subsector-title';
  title.textContent = sub.name;
  block.appendChild(title);
  const grid = document.createElement('div');
  grid.className = 'subsector-grid';
  if (sub.notes) {
    const notesCard = document.createElement('div');
    notesCard.className = 'glass-card notes-card';
    notesCard.innerHTML = `<p class="card-title">Notes</p><div class="notes-body">${parseNotes(sub.notes)}</div>`;
    grid.appendChild(notesCard);
  }
  if (sub.watchlist && sub.watchlist.length > 0) {
    const wlCard = document.createElement('div');
    wlCard.className = 'glass-card wl-card';
    wlCard.innerHTML = `<p class="card-title">Watchlist</p><div class="wl-table-wrapper">${buildWatchlistTable(sub.watchlist, prices)}</div>`;
    grid.appendChild(wlCard);
  }
  block.appendChild(grid);
  if (sub.analysis && sub.analysis.length > 0) {
    sub.analysis.forEach(a => {
      const card = document.createElement('div');
      card.className = 'glass-card analysis-card';
      card.innerHTML = `<p class="card-title">${a.title || 'Analysis'}</p><div class="wl-table-wrapper">${buildAnalysisTable(a)}</div>`;
      block.appendChild(card);
    });
  }
  return block;
}

function buildWatchlistTable(watchlist, prices) {
  const cols = ['Last', 'Day%', 'Wk%', 'Mo%', 'Yr%', 'P/E', 'Mkt Cap', 'Volume'];
  const rows = watchlist.map(item => {
    const p = prices[item.symbol] || {};
    const price = p.last != null ? formatPrice(p.last, item.symbol) : '—';
    // changeClass returns 'positive'|'negative'|'neutral' matching CSS .chg-positive etc via td class
    return `<tr>
      <td><div class="wl-name-cell"><a class="wl-symbol" href="${tradingViewUrl(item.symbol)}" target="_blank" rel="noopener" title="TradingView">${item.symbol}</a><span class="wl-fullname">${item.name || ''}</span></div></td>
      <td>${price}</td>
      <td class="chg-${changeClass(p.day_change_pct)}">${fmtChg(p.day_change_pct)}</td>
      <td class="chg-${changeClass(p.week_change_pct)}">${fmtChg(p.week_change_pct)}</td>
      <td class="chg-${changeClass(p.month_change_pct)}">${fmtChg(p.month_change_pct)}</td>
      <td class="chg-${changeClass(p.year_change_pct)}">${fmtChg(p.year_change_pct)}</td>
      <td>${p.pe_ratio ? p.pe_ratio.toFixed(2) : '—'}</td>
      <td>${fmtMarketCap(p)}</td>
      <td>${fmtVolume(p.day_volume)}</td>
    </tr>`;
  }).join('');
  const headers = ['Name', ...cols].map(h => `<th>${h}</th>`).join('');
  return `<table class="wl-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function buildAnalysisTable(a) {
  if (!a.columns || !a.rows) return '';
  const ths = a.columns.map(c => `<th style="text-align:left">${c}</th>`).join('');
  const trs = a.rows.map(r => `<tr>${r.map(cell => `<td style="text-align:left;font-family:var(--font-sans)">${cell}</td>`).join('')}</tr>`).join('');
  return `<table class="wl-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ── Helpers ── */
function tradingViewUrl(symbol) {
  if (symbol.endsWith('.TW')) return `https://www.tradingview.com/chart/?symbol=TWSE:${symbol.replace('.TW', '')}`;
  return `https://www.tradingview.com/chart/?symbol=${symbol}`;
}
// Returns 'positive' | 'negative' | 'neutral'
function changeClass(val) {
  if (val == null) return 'neutral';
  if (val > 0) return 'positive';
  if (val < 0) return 'negative';
  return 'neutral';
}
function fmtChg(val) {
  if (val == null) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
}
function formatPrice(price, symbol) {
  if (symbol && symbol.endsWith('.TW')) return price.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMarketCap(p) {
  if (!p.market_cap) return '—';
  return `${p.market_cap}${p.market_cap_suffix || ''} ${p.market_cap_currency || ''}`.trim();
}
function fmtVolume(v) {
  if (!v) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toString();
}
function parseNotes(text) {
  return text.split('\n').map(line => {
    line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    if (line.trim().startsWith('- ')) return `<p style="padding-left:0.85rem;position:relative"><span style="position:absolute;left:0;color:var(--accent)">·</span>${line.trim().slice(2)}</p>`;
    return line ? `<p>${line}</p>` : '';
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => { initNav(); initSidebar(); });
