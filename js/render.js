/* ── Helpers ─────────────────────────────────────────────────────── */
export function tradingViewUrl(symbol) {
  if (symbol.endsWith('.TW')) return `https://www.tradingview.com/chart/?symbol=TWSE:${symbol.replace('.TW', '')}`;
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
  if (symbol && symbol.endsWith('.TW')) return price.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
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
  return text.split('\n').map(line => {
    if (line.startsWith('# '))  return `<p class="md-h2">${line.slice(2)}</p>`;
    if (line.startsWith('## ')) return `<p class="md-h3">${line.slice(3)}</p>`;
    line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    if (line.trim().startsWith('- ')) return `<p class="md-bullet"><span class="md-dot">·</span>${line.trim().slice(2)}</p>`;
    return line ? `<p class="md-p">${line}</p>` : '<p class="md-spacer"></p>';
  }).join('');
}

/* ── Ticker bar card ─────────────────────────────────────────────── */
export function buildTickerCard(symbol, p) {
  const dayChg = p.day_change_pct ?? null;
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
    const cells = typeof r === 'string' ? JSON.parse(r) : r;
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
    if (isAdmin) {
      const addAnalysisBtn = document.createElement('button');
      addAnalysisBtn.className = 'btn-add-row admin-only';
      addAnalysisBtn.dataset.action = 'add-analysis';
      addAnalysisBtn.dataset.subsectorId = subsector.id;
      addAnalysisBtn.classList.add('btn-add-analysis');
      addAnalysisBtn.textContent = '+ Add Analysis Table';
      block.appendChild(addAnalysisBtn);
    }

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

  return wrap;
}

/* ── Ticker bar ──────────────────────────────────────────────────── */
export function renderTickerBar(symbols, prices) {
  const bar = document.getElementById('tickerBarInner');
  if (!bar) return;
  bar.innerHTML = '';
  symbols.forEach(sym => bar.appendChild(buildTickerCard(sym, prices[sym] || {})));
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
