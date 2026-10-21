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
     featured    — true → accent border, like a highlighted plan card
     internal    — true → a page of this site (url relative to the site root): opens in
                   the same tab, no external-link icon */

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
  {
    name: 'fish-craft',
    url: 'https://fish-craft.vercel.app',
    tagline: 'fishcraft - 魚世無爭',
    description: '你是一個魚族王朝：在家園礁繁殖、照顧、裝備你的族群，出征七片海域，讓魚王一代代傳承下去。',
    features: [
      '家園礁：繁殖、照顧與裝備你的魚族',
      '出征七片海域',
      '魚王世代傳承',
      '帳號與雲端存檔（選用）',
    ],
    tags: ['Vite', 'TypeScript', 'Canvas 2D', 'Vercel', 'Supabase'],
  },
  {
    name: 'War Atlas',
    url: 'war-atlas/index.html',
    internal: true,
    tagline: '戰役地圖集',
    description: '互動式戰役地圖：依戰爭篩選，查看參戰方、戰鬥序列、兵力、武器型號對比與傷亡，並以時間軸播放各階段推進。',
    features: [
      '戰役檔案：參戰方、指揮官、番號、兵力與傷亡',
      '武器型號與規格並排比較',
      '分階段動畫：進攻路線、戰線與事件',
      '貼上 skill 產生的 JSON 即可登錄新戰役',
    ],
    tags: ['Leaflet', 'Firestore', 'GitHub Pages', 'LLM Skill'],
  },
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hostOf = url => { try { return new URL(url).host; } catch { return url; } };

const ICON_EXTERNAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const ICON_MAP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>';
const ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';

/** Fill a sidebar folder's children with one link per project. `base` prefixes internal
    (site-relative) urls — "../" on the report pages one folder down. */
export function renderSideProjectNav(container, base = '') {
  if (!container) return;
  container.innerHTML = PROJECTS.map(p => p.internal ? `
    <a class="nav-item" href="${esc(base + p.url)}">
      <span class="nav-icon">${ICON_MAP}</span>
      ${esc(p.name)}
    </a>` : `
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
      ${p.internal
        ? `<a class="sp-link" href="${esc(p.url)}"><span>開啟 ${esc(p.tagline || p.name)}</span></a>`
        : `<a class="sp-link" href="${esc(p.url)}" target="_blank" rel="noopener">
        ${ICON_EXTERNAL}<span>前往 ${esc(hostOf(p.url))}</span>
      </a>`}
    </article>`).join('');
}
