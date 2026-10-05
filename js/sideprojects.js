/* sideprojects.js — single source of truth for the Side Project folder.
   Used by the SPA (index.html → page-side-project + its sidebar folder) and by
   the shared report sidebar (partials/sidebar.html via js/sidebar.js).

   To add a project, append an object to PROJECTS:
     name        — card label / sidebar link text (required)
     url         — project website (required)
     tagline     — big headline on the card
     description — one or two sentences under the headline
     features    — short bullet points (optional)
     tags        — small chips under the features (optional)
     featured    — true → accent border, like a highlighted plan card */

export const PROJECTS = [
  {
    name: 'NIBBLE',
    url: 'https://nibble-beryl.vercel.app/',
    tagline: 'NIBBLE - 配球策略遊戲',
    features: [
      '四種模式：策略模擬、投手對決、打者猜球、實戰比對',
      '情境感知機率：球數、壘上跑者、出局、比數與投打左右',
      'Statcast 擊球數據：初速、仰角、距離、xBA 與 Barrel',
      '跨聯盟對決（例：MLB 王牌 vs NPB 強打）與聯盟強度校正',
      '3D 投打動畫與打席結果動畫',
    ],
    tags: ['Next.js', 'DuckDB-WASM', 'Web Worker', 'Monte Carlo', 'Python Pipeline'],
    featured: true,
  },
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hostOf = url => { try { return new URL(url).host; } catch { return url; } };

const ICON_EXTERNAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';

/** Fill a sidebar folder's children with one external link per project. */
export function renderSideProjectNav(container) {
  if (!container) return;
  container.innerHTML = PROJECTS.map(p => `
    <a class="nav-item" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(p.url)}">
      <span class="nav-icon">${ICON_EXTERNAL}</span>
      ${esc(p.name)}
    </a>`).join('');
}

/** Render the intro page's card grid; the layout adapts to the card count. */
export function renderSideProjectPage(container) {
  if (!container) return;
  container.dataset.count = String(Math.min(PROJECTS.length, 3));
  if (!PROJECTS.length) {
    container.innerHTML = '<p class="sp-empty">尚無專案，敬請期待。</p>';
    return;
  }
  container.innerHTML = PROJECTS.map(p => `
    <article class="sp-card${p.featured ? ' sp-card-featured' : ''}">
      <h3 class="sp-name">${esc(p.name)}</h3>
      ${p.tagline ? `<p class="sp-tagline">${esc(p.tagline)}</p>` : ''}
      ${p.description ? `<p class="sp-desc">${esc(p.description)}</p>` : ''}
      ${p.features?.length ? `<ul class="sp-features">${p.features.map(f =>
        `<li><span class="sp-check">${ICON_CHECK}</span>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${p.tags?.length ? `<div class="sp-tags">${p.tags.map(t =>
        `<span class="sp-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <a class="sp-link" href="${esc(p.url)}" target="_blank" rel="noopener">
        ${ICON_EXTERNAL}<span>前往 ${esc(hostOf(p.url))}</span>
      </a>
    </article>`).join('');
}
