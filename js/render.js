import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12/+esm';
marked.use({ breaks: true });

/* ── Helpers ─────────────────────────────────────────────────────── */
export function tradingViewUrl(symbol) {
  if (symbol.endsWith('.TWO')) return `https://www.tradingview.com/chart/?symbol=TPEX:${symbol.slice(0,-4)}`;
  if (symbol.endsWith('.TW'))  return `https://www.tradingview.com/chart/?symbol=TWSE:${symbol.slice(0,-3)}`;
  if (symbol.endsWith('.KQ'))  return `https://www.tradingview.com/chart/?symbol=KRX:${symbol.slice(0,-3)}`;
  if (symbol.endsWith('.KS'))  return `https://www.tradingview.com/chart/?symbol=KRX:${symbol.slice(0,-3)}`;
  if (symbol.endsWith('.T'))   return `https://www.tradingview.com/chart/?symbol=TSE:${symbol.slice(0,-2)}`;
  if (symbol.endsWith('.SS'))  return `https://www.tradingview.com/chart/?symbol=SSE:${symbol.slice(0,-3)}`;
  if (symbol.endsWith('.SZ'))  return `https://www.tradingview.com/chart/?symbol=SZSE:${symbol.slice(0,-3)}`;
  if (symbol.endsWith('.HK'))  return `https://www.tradingview.com/chart/?symbol=HKEX:${symbol.slice(0,-3)}`;
  // European suffixes: .AS=Amsterdam .PA=Paris .DE=Xetra .MI=Milan .MC=Madrid
  //   .L=London .ST=Stockholm .CO=Copenhagen .HE=Helsinki .OL=Oslo .VX=Swiss
  const euMatch = symbol.match(/^(.+)\.(AS|PA|DE|MI|MC|L|ST|CO|HE|OL|VX|BR|LS|IR)$/);
  if (euMatch) {
    const exMap = { AS:'EURONEXT', PA:'EURONEXT', DE:'XETR', MI:'MIL', MC:'BME',
                    L:'LSE', ST:'OMX', CO:'OMX', HE:'OMX', OL:'OSL', VX:'SIX',
                    BR:'EURONEXT', LS:'EURONEXT', IR:'EURONEXT' };
    const ex = exMap[euMatch[2]];
    if (ex) return `https://www.tradingview.com/chart/?symbol=${ex}:${euMatch[1]}`;
  }
  return `https://www.tradingview.com/chart/?symbol=${symbol}`;
}
export function changeClass(val) {
  if (val == null) return 'neutral';
  if (val > 0) return 'positive';
  if (val < 0) return 'negative';
  return 'neutral';
}
export function fmtChg(val) {
  if (val == null) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
}
export function formatPrice(price, symbol) {
  // TW / JP / KR markets quote in whole local-currency units → no decimals.
  // Whole-unit markets: TW, JP, KR, CN A-shares, HK
  if (symbol && /\.(TW|TWO|T|KS|KQ|SS|SZ|HK)$/.test(symbol)) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtMarketCap(p) {
  if (!p.market_cap) return '—';
  return `${p.market_cap}${p.market_cap_suffix || ''} ${p.market_cap_currency || ''}`.trim();
}
export function fmtVolume(v) {
  if (!v) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toString();
}
export function parseMarkdown(text) {
  if (!text) return '';
  return marked.parse(text).replace(/<img /g, '<img loading="lazy" ');
}

/* ── Ticker bar card ─────────────────────────────────────────────── */
// Deep-link to the latest related report item. `e` = { id, date } from the
// event map; falls back to a ticker filter if no id is available.
function eventLink(page, symbol, e) {
  const base = `${page}/index.html`;
  if (e && e.id) return `${base}#item=${encodeURIComponent(e.id)}`;
  return `${base}#ticker=${encodeURIComponent(symbol)}`;
}
export function buildTickerCard(symbol, p, isAdmin, ev) {
  const dayChg = p.day_change_pct ?? null;
  const cls = changeClass(dayChg);
  const colorMap = { positive: 'var(--positive)', negative: 'var(--negative)', neutral: 'var(--neutral)' };
  const card = document.createElement('div');
  card.className = 'ticker-card';
  card.style.setProperty('--indicator-color', colorMap[cls]);
  const price = p.last != null ? formatPrice(p.last, symbol) : '—';
  const chgStr = dayChg != null ? (dayChg >= 0 ? '+' : '') + dayChg.toFixed(2) + '%' : '—';
  // Event tags — link a symbol to its latest related supply-chain / industry /
  // earnings-call record in Firestore (read-only lookup).
  const dateHint = e => (e && e.date) ? `（最新：${e.date}）` : '';
  const tags = [];
  if (ev?.supply)   tags.push(`<a class="tc-tag tg-supply" href="${eventLink('supply-chain', symbol, ev.supply)}" title="相關供應鏈新聞，前往最新一篇${dateHint(ev.supply)}">供</a>`);
  if (ev?.industry) tags.push(`<a class="tc-tag tg-industry" href="${eventLink('industry-news', symbol, ev.industry)}" title="相關產業消息，前往最新一則${dateHint(ev.industry)}">產</a>`);
  if (ev?.earnings) tags.push(`<a class="tc-tag tg-earnings" href="${eventLink('earnings', symbol, ev.earnings)}" title="法說會紀錄，前往最新一季${dateHint(ev.earnings)}">法</a>`);
  const tagHtml = tags.length ? `<div class="tc-tags">${tags.join('')}</div>` : '';
  card.innerHTML =
    `<a class="tc-main" href="${tradingViewUrl(symbol)}" target="_blank" rel="noopener" title="Open in TradingView">` +
    `<span class="tc-symbol">${symbol}</span><span class="tc-name">${p.name || ''}</span>` +
    `<span class="tc-price">${price}</span><span class="tc-change ${cls}">${chgStr}</span></a>` +
    tagHtml;

  if (!isAdmin) return card;

  // Wrap in a relative container so the ✕ button can sit on top-right
  const wrap = document.createElement('div');
  wrap.className = 'ticker-card-wrap';
  const del = document.createElement('button');
  del.className = 'ticker-card-del admin-only';
  del.dataset.action = 'del-ticker-overview';
  del.dataset.symbol = symbol;
  del.title = `Remove ${symbol} from overview`;
  del.textContent = '✕';
  wrap.appendChild(card);
  wrap.appendChild(del);
  return wrap;
}

/* ── Watchlist table ─────────────────────────────────────────────── */
export function buildWatchlistTable(tickers, prices, isAdmin) {
  const cols = ['Last', 'Day%', 'Wk%', 'Mo%', 'Yr%', 'P/E', 'Mkt Cap', 'Volume'];
  const rows = tickers.map(item => {
    const p = prices[item.symbol] || {};
    const price = p.last != null ? formatPrice(p.last, item.symbol) : '—';
    const adminBtns = isAdmin
      ? `<span class="row-admin-ctrls"><button class="btn-icon" data-action="edit-ticker" data-id="${item.id}" data-symbol="${item.symbol}" data-name="${item.name||''}" data-market="${item.market||'US'}" title="Edit">✎</button><button class="btn-icon btn-icon-del" data-action="del-ticker" data-id="${item.id}" title="Delete">✕</button></span>`
      : '';
    return `<tr>
      <td><div class="wl-name-cell"><a class="wl-symbol" href="${tradingViewUrl(item.symbol)}" target="_blank" rel="noopener">${item.symbol}</a><span class="wl-fullname">${item.name || ''}</span>${adminBtns}</div></td>
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

/* ── Analysis table ──────────────────────────────────────────────── */
export function buildAnalysisTable(a, isAdmin) {
  if (!a.columns || !a.rows) return '';
  const ths = a.columns.map(c => `<th style="text-align:left">${c}</th>`).join('');
  const trs = a.rows.map(r => {
    let cells = typeof r === 'string' ? (() => { try { return JSON.parse(r); } catch { return []; } })() : r;
    if (!Array.isArray(cells)) cells = [];
    return `<tr>${cells.map(cell => `<td style="text-align:left;font-family:var(--font-sans)">${cell}</td>`).join('')}</tr>`;
  }).join('');
  const adminBtns = isAdmin
    ? `<div class="title-admin-ctrls"><button class="btn-icon" data-action="edit-analysis" data-id="${a.id}" title="Edit">✎</button><button class="btn-icon btn-icon-del" data-action="del-analysis" data-id="${a.id}" title="Delete">✕</button></div>`
    : '';
  return `<div class="analysis-wrap">${adminBtns}<table class="wl-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/* ── Research note card ──────────────────────────────────────────── */
export function buildResearchCard(note, isAdmin) {
  const adminBtns = isAdmin
    ? `<span class="card-admin-ctrls"><button class="btn-icon" data-action="edit-research" data-id="${note.id}" title="Edit">✎</button><button class="btn-icon btn-icon-del" data-action="del-research" data-id="${note.id}" title="Delete">✕</button></span>`
    : '';
  const div = document.createElement('div');
  div.className = 'research-card glass-card';
  div.dataset.researchId = note.id;
  div.innerHTML = `
    <div class="research-header">
      <span class="research-title">${note.title || 'Note'}</span>
      ${adminBtns}
      <button class="research-toggle" aria-label="Toggle">▼</button>
    </div>
    <div class="research-body">${parseMarkdown(note.content || '')}</div>
  `;
  div.querySelector('.research-toggle').addEventListener('click', () => div.classList.toggle('open'));
  return div;
}

/* ── Full sector render ──────────────────────────────────────────── */
export function renderSectorContent(sector, subsectorsData, prices, isAdmin) {
  const wrap = document.createElement('div');

  if (isAdmin) {
    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'btn-add-row admin-only';
    addSubBtn.dataset.action = 'add-subsector';
    addSubBtn.dataset.sectorId = sector.id;
    addSubBtn.textContent = '+ Add Subsector';
    wrap.appendChild(addSubBtn);
  }

  subsectorsData.forEach(({ subsector, tickers, analysis, research_notes }) => {
    const block = document.createElement('div');
    block.className = 'subsector-block';
    block.dataset.subsectorId = subsector.id;

    // Subsector title
    const titleRow = document.createElement('div');
    titleRow.className = 'subsector-title-row';
    const title = document.createElement('h3');
    title.className = 'subsector-title';
    title.textContent = subsector.name;
    titleRow.appendChild(title);
    if (isAdmin) {
      const ctrls = document.createElement('span');
      ctrls.className = 'title-admin-ctrls';
      ctrls.innerHTML = `<button class="btn-icon" data-action="edit-subsector" data-id="${subsector.id}" data-name="${subsector.name}" title="Edit">✎</button><button class="btn-icon btn-icon-del" data-action="del-subsector" data-id="${subsector.id}" title="Delete">✕</button>`;
      titleRow.appendChild(ctrls);
    }
    block.appendChild(titleRow);

    const grid = document.createElement('div');
    grid.className = 'subsector-grid';

    // Notes
    const notesCard = document.createElement('div');
    notesCard.className = 'glass-card notes-card';
    const notesAdminBtn = isAdmin ? `<button class="btn-icon" data-action="edit-notes" data-id="${subsector.id}" title="Edit notes">✎</button>` : '';
    notesCard.innerHTML = `<p class="card-title">Notes ${notesAdminBtn}</p><div class="notes-body">${parseMarkdown(subsector.notes || '')}</div>`;
    grid.appendChild(notesCard);

    // Watchlist
    if (tickers && tickers.length > 0) {
      const wlCard = document.createElement('div');
      wlCard.className = 'glass-card wl-card';
      const addTickerBtn = isAdmin ? `<button class="btn-icon btn-add-row" data-action="add-ticker" data-subsector-id="${subsector.id}">+ Add</button>` : '';
      wlCard.innerHTML = `<p class="card-title">Watchlist ${addTickerBtn}</p><div class="wl-table-wrapper">${buildWatchlistTable(tickers, prices, isAdmin)}</div>`;
      grid.appendChild(wlCard);
    } else if (isAdmin) {
      const wlCard = document.createElement('div');
      wlCard.className = 'glass-card wl-card';
      wlCard.innerHTML = `<p class="card-title">Watchlist <button class="btn-icon btn-add-row" data-action="add-ticker" data-subsector-id="${subsector.id}">+ Add</button></p>`;
      grid.appendChild(wlCard);
    }

    block.appendChild(grid);

    // Analysis
    analysis.forEach(a => {
      const card = document.createElement('div');
      card.className = 'glass-card analysis-card';
      card.dataset.analysisId = a.id;
      card.innerHTML = `<p class="card-title">${a.title || 'Analysis'}</p><div class="wl-table-wrapper">${buildAnalysisTable(a, isAdmin)}</div>`;
      block.appendChild(card);
    });

    // Research notes
    if (research_notes && research_notes.length > 0) {
      const resSection = document.createElement('div');
      resSection.className = 'research-section';
      research_notes.forEach(note => resSection.appendChild(buildResearchCard(note, isAdmin)));
      block.appendChild(resSection);
    }
    if (isAdmin) {
      const addResBtn = document.createElement('button');
      addResBtn.className = 'btn-add-row admin-only';
      addResBtn.dataset.action = 'add-research';
      addResBtn.dataset.subsectorId = subsector.id;
      addResBtn.textContent = '+ Add Research Note';
      block.appendChild(addResBtn);
    }

    wrap.appendChild(block);
  });

  if (isAdmin) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete-sector admin-only';
    delBtn.dataset.action = 'del-sector';
    delBtn.dataset.sectorId = sector.id;
    delBtn.dataset.sectorName = sector.name;
    delBtn.textContent = '🗑 Delete this tab';
    wrap.appendChild(delBtn);
  }

  return wrap;
}

/* ── Ticker bar ──────────────────────────────────────────────────── */
// View mode is remembered per browser (localStorage), independent of Firestore.
function getTickerView() {
  try { return localStorage.getItem('wl_ticker_view') === 'subsector' ? 'subsector' : 'change'; }
  catch { return 'change'; }
}
function setTickerView(v) { try { localStorage.setItem('wl_ticker_view', v); } catch { /* private mode */ } }

// Collapsed zones are remembered per browser, keyed by "view::zone title".
function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem('wl_ticker_collapsed') || '[]')); }
  catch { return new Set(); }
}
let _collapsed = loadCollapsed();
function saveCollapsed() { try { localStorage.setItem('wl_ticker_collapsed', JSON.stringify([..._collapsed])); } catch { /* private mode */ } }
function zoneKey(title) { return `${getTickerView()}::${title}`; }

let _barState = null;   // last args, so the view toggle can re-render in place
let _barBound = false;  // toggle listener attached once

export function renderTickerBar(symbols, prices, isAdmin, sector, opts = {}) {
  _barState = { symbols, prices, isAdmin, sector, groups: opts.groups || [], events: opts.events || {}, onReorderGroups: opts.onReorderGroups || null };
  const bar = document.getElementById('tickerBarInner');
  if (bar && !_barBound) {
    bar.addEventListener('click', e => {
      const viewBtn = e.target.closest('[data-action="toggle-ticker-view"]');
      if (viewBtn) { e.preventDefault(); setTickerView(viewBtn.dataset.view); paintTickerBar(); return; }
      const legendBtn = e.target.closest('[data-action="toggle-legend"]');
      if (legendBtn) {
        e.preventDefault();
        legendBtn.parentElement.classList.toggle('open');
        return;
      }
      const head = e.target.closest('.tz-head');
      if (head && !e.target.closest('a, button, .tz-drag')) {
        const zone = head.parentElement;
        const key = zoneKey(zone.dataset.title || '');
        const collapsed = zone.classList.toggle('collapsed');
        if (collapsed) _collapsed.add(key); else _collapsed.delete(key);
        saveCollapsed();
      }
    });
    // Close the legend popover on an outside click.
    document.addEventListener('click', e => {
      if (e.target.closest('.ticker-legend')) return;
      bar.querySelector('.ticker-legend.open')?.classList.remove('open');
    });
    _barBound = true;
  }
  paintTickerBar();
}

function paintTickerBar() {
  if (!_barState) return;
  const { symbols, prices, isAdmin, sector, groups, events, onReorderGroups } = _barState;
  const bar = document.getElementById('tickerBarInner');
  if (!bar) return;
  bar.innerHTML = '';
  const unique = [...new Set(symbols)];
  const view = getTickerView();

  // Global up/down/flat tallies (shown in both views).
  let up = 0, down = 0, flat = 0;
  unique.forEach(sym => {
    const chg = prices[sym]?.day_change_pct;
    if (chg > 0) up++; else if (chg < 0) down++; else flat++;
  });

  // Summary header: counts + view toggle + admin edit button.
  const summary = document.createElement('div');
  summary.className = 'ticker-summary';
  summary.innerHTML =
    `<span class="ts-label">總覽</span>` +
    `<span class="ts-stat ts-up">上漲 <strong>${up}</strong></span>` +
    `<span class="ts-stat ts-down">下跌 <strong>${down}</strong></span>` +
    (flat ? `<span class="ts-stat ts-flat">平盤 <strong>${flat}</strong></span>` : '');
  if (unique.length > 0) {
    // Legend explaining the 供 / 產 / 法 tags — sits left of the view toggle.
    const legend = document.createElement('div');
    legend.className = 'ticker-legend';
    legend.innerHTML =
      `<button class="tl-btn" data-action="toggle-legend" aria-label="標籤說明" title="標籤說明">ⓘ 標籤</button>` +
      `<div class="tl-pop">` +
        `<span class="tl-row"><span class="tc-tag tg-supply">供</span> 相關供應鏈新聞 · 點擊前往最新一篇</span>` +
        `<span class="tl-row"><span class="tc-tag tg-industry">產</span> 相關產業消息 · 點擊前往最新一則</span>` +
        `<span class="tl-row"><span class="tc-tag tg-earnings">法</span> 法說會紀錄 · 點擊前往最新一季</span>` +
      `</div>`;
    summary.appendChild(legend);

    const toggle = document.createElement('div');
    toggle.className = 'ticker-viewtoggle';
    toggle.setAttribute('role', 'tablist');
    toggle.innerHTML =
      `<button class="tvt-btn ${view === 'change' ? 'active' : ''}" data-action="toggle-ticker-view" data-view="change">依漲跌</button>` +
      `<button class="tvt-btn ${view === 'subsector' ? 'active' : ''}" data-action="toggle-ticker-view" data-view="subsector">依題材</button>`;
    summary.appendChild(toggle);
  }
  if (isAdmin && sector) {
    const btn = document.createElement('button');
    btn.className = 'ticker-edit-btn admin-only';
    btn.dataset.action = 'edit-ticker-overview';
    btn.title = 'Edit ticker overview list';
    btn.textContent = unique.length === 0 ? '+ Add Tickers' : '✎';
    summary.appendChild(btn);
  }
  bar.appendChild(summary);

  if (unique.length === 0) return;

  const zones = document.createElement('div');
  zones.className = 'ticker-zones';
  // Admin can drag 依題材 zones to reorder; only real subsector zones (with a
  // subId) get a handle and become draggable.
  const canReorder = isAdmin && typeof onReorderGroups === 'function';
  const buildZone = (title, syms, kind, { extraClass = '', subId = null } = {}) => {
    if (!syms.length) return;
    const zone = document.createElement('div');
    zone.className = `ticker-zone tz-${kind}${extraClass ? ' ' + extraClass : ''}`;
    zone.dataset.title = title;
    if (subId) zone.dataset.subsectorId = subId;
    if (_collapsed.has(zoneKey(title))) zone.classList.add('collapsed');
    const head = document.createElement('div');
    head.className = 'tz-head';
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.title = '點擊收合 / 展開';
    const dragHandle = (canReorder && subId)
      ? `<span class="tz-drag" title="拖曳排序" aria-label="拖曳排序">⠿</span>` : '';
    head.innerHTML = `${dragHandle}<span class="tz-caret" aria-hidden="true">▾</span><span class="tz-title">${title}</span><span class="tz-count">${syms.length}</span>`;
    zone.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'tz-grid';
    syms.forEach(sym => grid.appendChild(buildTickerCard(sym, prices[sym] || {}, isAdmin, events[sym])));
    zone.appendChild(grid);
    zones.appendChild(zone);
  };

  if (view === 'subsector') {
    // Group by subsector name; each zone sorted internally by day-change desc.
    const seen = new Set();
    const byChg = (a, b) => (prices[b]?.day_change_pct ?? -Infinity) - (prices[a]?.day_change_pct ?? -Infinity);
    (groups || []).forEach(g => {
      const syms = [...new Set(g.symbols)].filter(s => unique.includes(s) && !seen.has(s));
      syms.forEach(s => seen.add(s));
      syms.sort(byChg);
      buildZone(g.name, syms, 'theme', { subId: g.id });
    });
    const leftovers = unique.filter(s => !seen.has(s)).sort(byChg);
    buildZone('精選 / 其他', leftovers, 'theme', { extraClass: 'tz-other' });
  } else {
    const gainers = unique.filter(s => prices[s]?.day_change_pct > 0)
      .sort((a, b) => prices[b].day_change_pct - prices[a].day_change_pct);
    const losers = unique.filter(s => prices[s]?.day_change_pct < 0)
      .sort((a, b) => prices[a].day_change_pct - prices[b].day_change_pct);
    const neutrals = unique.filter(s => !(prices[s]?.day_change_pct));
    buildZone('上漲', gainers, 'up');
    buildZone('下跌', losers, 'down');
    buildZone('平盤 / 無資料', neutrals, 'flat');
  }
  bar.appendChild(zones);
  if (canReorder && view === 'subsector') setupZoneDnD(zones, onReorderGroups);
}

// Drag-to-reorder for the 依題材 zones. Grabbing a zone's ⠿ handle makes that
// zone draggable; on drop we read the new order of subsector ids and hand it to
// the callback (app.js), which persists it and reorders the lower blocks.
function setupZoneDnD(zonesEl, onReorderGroups) {
  let dragEl = null;
  const ids = () => [...zonesEl.querySelectorAll('.ticker-zone[data-subsector-id]')]
    .map(z => z.dataset.subsectorId);

  zonesEl.querySelectorAll('.tz-drag').forEach(handle => {
    const zone = handle.closest('.ticker-zone');
    if (!zone || !zone.dataset.subsectorId) return;
    handle.addEventListener('pointerdown', () => { zone.draggable = true; });
    handle.addEventListener('pointerup',   () => { if (dragEl !== zone) zone.draggable = false; });
    zone.addEventListener('dragstart', e => {
      dragEl = zone;
      zone.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', zone.dataset.subsectorId); } catch { /* ignore */ }
    });
    zone.addEventListener('dragend', () => {
      const moved = !!dragEl;
      zone.classList.remove('dragging');
      zone.draggable = false;
      dragEl = null;
      if (moved) onReorderGroups(ids());
    });
  });

  zonesEl.addEventListener('dragover', e => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const others = [...zonesEl.querySelectorAll('.ticker-zone[data-subsector-id]:not(.dragging)')];
    // Reading-order (row-major) insertion point for the 2-column grid.
    const after = others.find(z => {
      const r = z.getBoundingClientRect();
      if (e.clientY < r.top) return true;                                   // pointer above this row
      return e.clientY <= r.bottom && e.clientX < r.left + r.width / 2;      // same row, left half
    });
    if (after) after.before(dragEl);
    else others[others.length - 1]?.after(dragEl);
  });
}

export function updatePriceCells(prices) {
  document.querySelectorAll('.wl-symbol').forEach(el => {
    const symbol = el.textContent.trim();
    const p = prices[symbol];
    if (!p) return;
    const row = el.closest('tr');
    if (!row) return;
    const cells = row.querySelectorAll('td');
    if (cells.length < 9) return;
    cells[1].textContent = p.last != null ? formatPrice(p.last, symbol) : '—';
    const chgFields = ['day_change_pct', 'week_change_pct', 'month_change_pct', 'year_change_pct'];
    chgFields.forEach((field, i) => {
      cells[2 + i].textContent = fmtChg(p[field]);
      cells[2 + i].className = 'chg-' + changeClass(p[field]);
    });
    cells[6].textContent = p.pe_ratio ? p.pe_ratio.toFixed(2) : '—';
    cells[7].textContent = fmtMarketCap(p);
    cells[8].textContent = fmtVolume(p.day_volume);
  });
  document.querySelectorAll('.ticker-card').forEach(card => {
    const sym = card.querySelector('.tc-symbol')?.textContent.trim();
    const p = sym && prices[sym];
    if (!p) return;
    const cls = changeClass(p.day_change_pct);
    const colorMap = { positive: 'var(--positive)', negative: 'var(--negative)', neutral: 'var(--neutral)' };
    card.style.setProperty('--indicator-color', colorMap[cls]);
    const priceEl = card.querySelector('.tc-price');
    const chgEl = card.querySelector('.tc-change');
    if (priceEl) priceEl.textContent = p.last != null ? formatPrice(p.last, sym) : '—';
    if (chgEl) {
      chgEl.textContent = p.day_change_pct != null ? (p.day_change_pct >= 0 ? '+' : '') + p.day_change_pct.toFixed(2) + '%' : '—';
      chgEl.className = `tc-change ${cls}`;
    }
  });
}
