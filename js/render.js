/* ── Rendering helpers ───────────────────────────────────────────── */

export function tradingViewUrl(symbol) {
  if (symbol.endsWith('.TW'))
    return `https://www.tradingview.com/chart/?symbol=TWSE:${symbol.replace('.TW', '')}`;
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
  if (!price && price !== 0) return '—';
  if (symbol && symbol.endsWith('.TW'))
    return price.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtMarketCap(p) {
  if (!p || !p.market_cap) return '—';
  return `${p.market_cap}${p.market_cap_suffix || ''} ${p.market_cap_currency || ''}`.trim();
}

export function fmtVolume(v) {
  if (!v) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}

/** Very minimal markdown: # h2, ## h3, **bold**, - bullet, blank line = paragraph break */
export function parseMarkdown(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => {
      if (line.startsWith('## ')) return `<h3 class="md-h3">${esc(line.slice(3))}</h3>`;
      if (line.startsWith('# '))  return `<h2 class="md-h2">${esc(line.slice(2))}</h2>`;
      line = line.replace(/\*\*(.*?)\*\*/g, (_, t) => `<strong>${esc(t)}</strong>`);
      if (line.trim().startsWith('- '))
        return `<p class="md-bullet"><span class="md-dot">·</span>${line.trim().slice(2)}</p>`;
      if (line.trim() === '') return '<div class="md-spacer"></div>';
      return `<p class="md-p">${line}</p>`;
    })
    .join('');
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Ticker performance bar ──────────────────────────────────────── */
export function buildTickerCard(symbol, p) {
  const dayChg = p?.day_change_pct ?? null;
  const cls    = changeClass(dayChg);
  const color  = cls === 'positive' ? 'var(--positive)' : cls === 'negative' ? 'var(--negative)' : 'var(--neutral)';
  const price  = p?.last != null ? formatPrice(p.last, symbol) : '—';
  const chgStr = dayChg != null ? (dayChg >= 0 ? '+' : '') + dayChg.toFixed(2) + '%' : '—';

  const a = document.createElement('a');
  a.className = 'ticker-card';
  a.href      = tradingViewUrl(symbol);
  a.target    = '_blank';
  a.rel       = 'noopener';
  a.title     = 'Open in TradingView';
  a.style.setProperty('--indicator-color', color);
  a.innerHTML = `
    <span class="tc-symbol">${symbol}</span>
    <span class="tc-name">${p?.name || ''}</span>
    <span class="tc-price">${price}</span>
    <span class="tc-change ${cls}">${chgStr}</span>`;
  return a;
}

/* ── Watchlist table ─────────────────────────────────────────────── */
export function buildWatchlistTable(tickers, prices, isAdmin, callbacks) {
  if (!tickers || tickers.length === 0) return '<p class="state-msg">No tickers yet.</p>';

  const cols = ['Last', 'Day%', 'Wk%', 'Mo%', 'Yr%', 'P/E', 'Mkt Cap', 'Volume'];
  const rows = tickers.map(item => {
    const p     = prices[item.symbol] || {};
    const price = p.last != null ? formatPrice(p.last, item.symbol) : '—';
    const adminCtrls = isAdmin ? `
      <span class="row-admin-ctrls">
        <button class="btn-icon btn-edit" data-id="${item.id}" title="Edit ticker">✎</button>
        <button class="btn-icon btn-delete" data-id="${item.id}" title="Delete ticker">✕</button>
      </span>` : '';
    return `<tr>
      <td>
        <div class="wl-name-cell">
          <a class="wl-symbol" href="${tradingViewUrl(item.symbol)}" target="_blank" rel="noopener">${item.symbol}</a>
          <span class="wl-fullname">${item.name || ''}${adminCtrls}</span>
        </div>
      </td>
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

  const addBtn = isAdmin
    ? `<tfoot><tr><td colspan="9"><button class="btn-add-row btn-add-ticker">+ Add Ticker</button></td></tr></tfoot>`
    : '';
  const headers = ['Name', ...cols].map(h => `<th>${h}</th>`).join('');

  return `<table class="wl-table">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
    ${addBtn}
  </table>`;
}

/* ── Analysis table ──────────────────────────────────────────────── */
export function buildAnalysisTable(a, isAdmin) {
  if (!a.columns || !a.rows) return '';
  const ths = a.columns.map(c => `<th style="text-align:left">${c}</th>`).join('');
  const trs = a.rows.map(r =>
    `<tr>${r.map(cell => `<td style="text-align:left;font-family:var(--font-sans)">${cell}</td>`).join('')}</tr>`
  ).join('');
  const adminBtns = isAdmin ? `
    <div class="card-admin-ctrls">
      <button class="btn-icon btn-edit" data-id="${a.id}" title="Edit table">✎</button>
      <button class="btn-icon btn-delete" data-id="${a.id}" title="Delete table">✕</button>
    </div>` : '';
  return `${adminBtns}<table class="wl-table">
    <thead><tr>${ths}</tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

/* ── Research note card ──────────────────────────────────────────── */
export function buildResearchCard(note, isAdmin) {
  const adminBtns = isAdmin ? `
    <div class="card-admin-ctrls">
      <button class="btn-icon btn-edit" data-id="${note.id}" title="Edit note">✎</button>
      <button class="btn-icon btn-delete" data-id="${note.id}" title="Delete note">✕</button>
    </div>` : '';
  return `<div class="glass-card research-card" data-note-id="${note.id}">
    <div class="research-header" role="button" tabindex="0">
      <span class="research-title">${note.title || 'Research Note'}</span>
      <span class="research-toggle">▾</span>
      ${adminBtns}
    </div>
    <div class="research-body">${parseMarkdown(note.content || '')}</div>
  </div>`;
}

/* ── Full sector page ────────────────────────────────────────────── */
export function renderSectorContent(sector, subsectorsData, prices, isAdmin) {
  const container = document.getElementById('sectorContent');
  if (!container) return;
  container.innerHTML = '';

  subsectorsData.forEach(({ subsector, tickers, analysis, research_notes }) => {
    const block = document.createElement('div');
    block.className  = 'subsector-block';
    block.dataset.id = subsector.id;

    const adminSubCtrls = isAdmin ? `
      <span class="title-admin-ctrls">
        <button class="btn-icon btn-edit-sub" data-id="${subsector.id}" title="Edit subsector">✎</button>
        <button class="btn-icon btn-delete-sub" data-id="${subsector.id}" title="Delete subsector">✕</button>
      </span>` : '';

    const grid = document.createElement('div');
    grid.className = 'subsector-grid';

    // Notes panel
    if (subsector.notes || isAdmin) {
      const notesCard = document.createElement('div');
      notesCard.className = 'glass-card notes-card';
      const editBtn = isAdmin
        ? `<button class="btn-icon btn-edit-notes admin-only" data-id="${subsector.id}" title="Edit notes">✎ Edit Notes</button>`
        : '';
      notesCard.innerHTML = `
        <p class="card-title">Notes${isAdmin ? `<button class="btn-icon btn-edit-notes" data-id="${subsector.id}" title="Edit notes" style="margin-left:0.5rem">✎</button>` : ''}</p>
        <div class="notes-body">${parseMarkdown(subsector.notes || '_No notes yet._')}</div>`;
      grid.appendChild(notesCard);
    }

    // Watchlist table
    const wlCard = document.createElement('div');
    wlCard.className = 'glass-card wl-card';
    wlCard.dataset.subsectorId = subsector.id;
    wlCard.innerHTML = `
      <p class="card-title">Watchlist</p>
      <div class="wl-table-wrapper">${buildWatchlistTable(tickers, prices, isAdmin)}</div>`;
    grid.appendChild(wlCard);

    block.innerHTML = `<h3 class="subsector-title">${subsector.name}${adminSubCtrls}</h3>`;
    block.appendChild(grid);

    // Analysis tables
    analysis.forEach(a => {
      const card = document.createElement('div');
      card.className = 'glass-card analysis-card';
      card.dataset.analysisId = a.id;
      card.innerHTML = `
        <p class="card-title">${a.title || 'Analysis'}</p>
        <div class="wl-table-wrapper">${buildAnalysisTable(a, isAdmin)}</div>`;
      block.appendChild(card);
    });
    if (isAdmin) {
      const addAnalysisBtn = document.createElement('button');
      addAnalysisBtn.className = 'btn-add-row admin-only';
      addAnalysisBtn.dataset.subsectorId = subsector.id;
      addAnalysisBtn.textContent = '+ Add Analysis Table';
      addAnalysisBtn.classList.add('btn-add-analysis');
      block.appendChild(addAnalysisBtn);
    }

    // Research notes
    if (research_notes.length > 0 || isAdmin) {
      const section = document.createElement('div');
      section.className = 'research-section';
      section.innerHTML = `<p class="card-title research-section-label">Research Notes</p>`;
      research_notes.forEach(note => {
        section.insertAdjacentHTML('beforeend', buildResearchCard(note, isAdmin));
      });
      if (isAdmin) {
        section.insertAdjacentHTML('beforeend',
          `<button class="btn-add-row btn-add-research" data-subsector-id="${subsector.id}">+ Add Research Note</button>`);
      }
      block.appendChild(section);
    }

    container.appendChild(block);
  });

  if (isAdmin) {
    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'btn-add-row btn-add-subsector';
    addSubBtn.dataset.sectorId = sector.id;
    addSubBtn.textContent = '+ Add Subsector';
    container.appendChild(addSubBtn);
  }
}

/* ── Ticker bar ──────────────────────────────────────────────────── */
export function renderTickerBar(symbols, prices) {
  const bar = document.getElementById('tickerBarInner');
  if (!bar) return;
  bar.innerHTML = '';
  symbols.forEach(sym => bar.appendChild(buildTickerCard(sym, prices[sym] || {})));
}

/* ── Live price update (no full re-render) ───────────────────────── */
export function updatePriceCells(prices) {
  // Update ticker bar
  document.querySelectorAll('.ticker-card').forEach(card => {
    const sym = card.querySelector('.tc-symbol')?.textContent;
    if (!sym || !prices[sym]) return;
    const p      = prices[sym];
    const dayChg = p.day_change_pct ?? null;
    const cls    = changeClass(dayChg);
    const color  = cls === 'positive' ? 'var(--positive)' : cls === 'negative' ? 'var(--negative)' : 'var(--neutral)';
    card.style.setProperty('--indicator-color', color);
    const priceEl = card.querySelector('.tc-price');
    const chgEl   = card.querySelector('.tc-change');
    if (priceEl) priceEl.textContent = formatPrice(p.last, sym);
    if (chgEl) {
      chgEl.textContent = dayChg != null ? (dayChg >= 0 ? '+' : '') + dayChg.toFixed(2) + '%' : '—';
      chgEl.className   = `tc-change ${cls}`;
    }
  });

  // Update table cells — find rows by wl-symbol text
  document.querySelectorAll('table.wl-table tbody tr').forEach(row => {
    const symEl = row.querySelector('.wl-symbol');
    if (!symEl) return;
    const sym = symEl.textContent.trim();
    const p   = prices[sym];
    if (!p) return;
    const cells = row.querySelectorAll('td');
    if (cells.length < 9) return;
    cells[1].textContent = formatPrice(p.last, sym);
    const chgFields = ['day_change_pct','week_change_pct','month_change_pct','year_change_pct'];
    chgFields.forEach((f, i) => {
      cells[i + 2].textContent = fmtChg(p[f]);
      cells[i + 2].className   = `chg-${changeClass(p[f])}`;
    });
    cells[6].textContent = p.pe_ratio ? p.pe_ratio.toFixed(2) : '—';
    cells[7].textContent = fmtMarketCap(p);
    cells[8].textContent = fmtVolume(p.day_volume);
  });
}
