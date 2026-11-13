/* sideprojects.js — single source of truth for the Side Project folder.
   Used by the SPA (index.html → page-side-project + its sidebar folder) and by
   the shared report sidebar (partials/sidebar.html via js/sidebar.js).

   To add a project, append an object to PROJECTS:
     name        — card title / sidebar link text (required)
     url         — project website (required)
     group       — which section it belongs to (a key of GROUPS)
     icon        — one emoji shown in the card's icon tile
     tagline     — short subtitle under the title (don't repeat the name)
     description — one or two sentences (the card shows two lines until expanded)
     features    — short bullet points, shown when the card is expanded
     tags        — tech chips; the card shows the first 3, the rest appear when expanded
     internal    — true → a page of this site (url relative to the site root): opens in
                   the same tab, no external-link icon
     requiresAuth — true → needs a whitelisted Google sign-in: lock badge + blocked click
                   while signed out (js/tools.js) */

import { bindAuthGate, ICON_LOCK } from './tools.js';

export const GROUPS = [
  { key: 'invest', title: '投資訓練', sub: '拿真實的歷史行情與法說會練判斷力' },
  { key: 'game', title: '遊戲', sub: '' },
  { key: 'tool', title: '工具與其他', sub: '' },
];

export const PROJECTS = [
  {
    name: '盲測K線',
    group: 'invest',
    icon: '🕯️',
    url: 'blind-chart/index.html',
    internal: true,
    tagline: '紀律訓練場',
    description: '在匿名的歷史 K 線上逐根推進、照策略規則交易，結束後揭曉代號，量化「照規則」與「實際操作」的差距。',
    features: [
      '策略用 JSON 描述：指標、條件式、部位大小、可疊加停損、分批停利、加碼',
      '三個帳戶對照：你的實際帳戶、完全照規則的影子帳戶、逐一修正違規的反事實帳戶',
      '14 種違規判定與紀律分數，算出每個違規讓你少賺 / 多賠多少',
      '台 / 美 / 日 / 韓與混合盲測，單題或連關模式',
      '策略編輯器即時驗證，專業術語旁都有說明',
    ],
    tags: ['lightweight-charts', 'IndexedDB', 'DuckDB', 'GitHub Actions'],
  },
  {
    name: '法說會盲猜',
    group: 'invest',
    icon: '🎙️',
    url: 'earnings-guess/index.html',
    internal: true,
    tagline: '只看重點猜股價反應',
    description: '讀一場去識別化的法說會重點與法說前的日 K，猜股價相對產業的反應方向、幅度與信心，作答後揭曉公司與後續走勢。',
    features: [
      '重點一張一張看，附同公司前一、兩季的法說內容與當時反應',
      '方向、幅度區間、信心（Brier 校準）與猜公司四種計分',
      '揭曉後接上法說後四週的日 K 與產業 ETF 對照',
      '統計頁：校準曲線、各產業命中率、你 vs 法說會情緒模型',
      '題目不限量，作答紀錄可匯出 JSON / CSV',
    ],
    tags: ['yfinance', 'lightweight-charts', 'Pydantic', 'GitHub Actions'],
  },
  {
    name: 'NIBBLE',
    group: 'game',
    icon: '⚾',
    url: 'https://nibble-beryl.vercel.app/',
    tagline: '配球策略遊戲',
    description: '用真實 Statcast 數據模擬投打對決：決定配球、猜球路，看球數、跑者與出局數怎麼改變每一球的機率。',
    features: [
      '四種模式：策略模擬、投手對決、打者猜球、實戰比對',
      '情境感知機率：球數、壘上跑者、出局、比數與投打左右',
      'Statcast 擊球數據：初速、仰角、距離、xBA 與 Barrel',
      '跨聯盟對決（例：MLB 王牌 vs NPB 強打）與聯盟強度校正',
      '3D 投打動畫與打席結果動畫',
    ],
    tags: ['Next.js', 'DuckDB-WASM', 'Monte Carlo', 'Web Worker', 'Python Pipeline'],
  },
  {
    name: 'fish-craft',
    group: 'game',
    icon: '🐟',
    url: 'https://fish-craft.vercel.app',
    tagline: '魚世無爭',
    description: '經營一個魚族王朝：在家園礁繁殖、照顧、裝備你的族群，出征七片海域，讓魚王一代代傳承下去。',
    features: [
      '家園礁：繁殖、照顧與裝備你的魚族',
      '出征七片海域',
      '魚王世代傳承',
      '帳號與雲端存檔（選用）',
    ],
    tags: ['Vite', 'TypeScript', 'Canvas 2D', 'Supabase', 'Vercel'],
  },
  {
    name: '大叔釣魚',
    group: 'game',
    icon: '🎣',
    url: 'https://fish-craft.vercel.app/fishing/',
    tagline: '像素療癒放置釣魚',
    description: '坐在船首紅色塑膠椅上的大叔幫你釣魚，開著分頁放著看就好，偶爾開船換漁場、賣魚升級裝備。',
    features: [
      '9,243 種真實魚類（臺灣 2,070 種＋世界 21 片海域）與 22 種神話生物，每種都有像素圖',
      '108 個漁場：從桃園永安漁港、世界各海域到東海龍宮、冥河、銀河',
      '18 支釣竿、21 艘船、25 種魚餌，從 HDMI 線到諾亞方舟、航空母艦',
      '19 種買家與隨時間漲跌的動態市場，油價、魚的新鮮度都要算',
      '颱風、聖嬰現象、軍事演習等事件影響出航與漁獲',
      '書本式圖鑑、販賣紀錄與釣魚日誌',
    ],
    tags: ['Canvas 2D', 'Pixel Art', 'Idle Game', 'localStorage', 'Vercel'],
  },
  {
    name: '下班倒數',
    group: 'tool',
    icon: '⏰',
    url: 'countdown/index.html',
    internal: true,
    tagline: '上班時間的劇場',
    description: '不只告訴你還剩多久：像素世界隨時間演進，動物輪流來翻時間牌，最後五分鐘是跨年等級的像素煙火秀。',
    features: [
      '15 個主題：隕石墜落、定時炸彈、發射按鈕、高鐵月台、媽媽的訊息、最後通牒、廚房計時器、碼表…',
      '四隻動物翻牌彩蛋、便當、下午茶、UFO 等時間軸事件',
      '荒謬時間換算文案：「3 小時夠你從台北飛到東京了」',
      '最後 5 分鐘四幕像素煙火高潮，全程無音效',
      '彩蛋圖鑑、成就徽章與動物造型解鎖，可截圖分享',
    ],
    tags: ['Canvas 2D', 'Pixel Art', 'PWA', 'ES Modules', 'localStorage'],
  },
  {
    name: '旅遊分帳',
    group: 'tool',
    icon: '🧾',
    url: 'split/index.html',
    internal: true,
    requiresAuth: true,
    tagline: '多人多幣別記帳',
    description: '旅行時記下誰付了什麼，自動統整並一鍵算出誰該付誰多少；多幣別、各自時區，邀請連結就能讓旅伴一起記。',
    features: [
      '多幣別記帳，結算時可合併成主要幣別或各幣別分開算',
      '一鍵結算：最少轉帳次數算出誰該付誰',
      '邀請連結：旅伴登入後就能一起記帳',
      '每筆款項記自己的時區，跨時區旅行不會算錯日期',
      '手機底部抽屜、電腦雙欄，按 N 快速新增',
    ],
    tags: ['Firestore', 'Google 登入', 'ES Modules'],
  },
  {
    name: 'War Atlas',
    group: 'tool',
    icon: '🗺️',
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
    tags: ['Leaflet', 'Firestore', 'LLM Skill', 'GitHub Pages'],
  },
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hostOf = url => { try { return new URL(url).host; } catch { return url; } };

const ICON_EXTERNAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const ICON_MAP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>';
const ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';

/** Fill a sidebar folder's children with one link per project. `base` prefixes internal
    (site-relative) urls — "../" on the report pages one folder down. */
export function renderSideProjectNav(container, base = '') {
  if (!container) return;
  container.innerHTML = PROJECTS.map(p => p.internal ? `
    <a class="nav-item${p.requiresAuth ? ' tool-item tool-auth' : ''}" href="${esc(base + p.url)}">
      <span class="nav-icon">${ICON_MAP}</span>
      ${esc(p.name)}${p.requiresAuth ? ICON_LOCK : ''}
    </a>` : `
    <a class="nav-item" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(p.url)}">
      <span class="nav-icon">${ICON_EXTERNAL}</span>
      ${esc(p.name)}
    </a>`).join('');
  bindAuthGate(container);
}

const ICON_CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"/></svg>';
const TAGS_SHOWN = 3;

function cardHTML(p, i) {
  const tags = p.tags || [];
  return `
    <article class="sp-card">
      <button type="button" class="sp-head" aria-expanded="false" aria-controls="spBody${i}">
        <span class="sp-icon" aria-hidden="true">${esc(p.icon || '✦')}</span>
        <span class="sp-head-text">
          <span class="sp-name">${esc(p.name)}</span>
          ${p.tagline ? `<span class="sp-tagline">${esc(p.tagline)}</span>` : ''}
        </span>
        <span class="sp-chevron">${ICON_CHEVRON}</span>
      </button>
      <p class="sp-desc">${esc(p.description || '')}</p>
      ${tags.length ? `<div class="sp-tags">${tags.map((t, k) =>
        `<span class="sp-tag${k >= TAGS_SHOWN ? ' sp-tag-extra' : ''}">${esc(t)}</span>`).join('')}${tags.length > TAGS_SHOWN
        ? `<span class="sp-tag sp-tag-more">+${tags.length - TAGS_SHOWN}</span>` : ''}</div>` : ''}
      <div class="sp-body" id="spBody${i}"><div class="sp-body-inner">
        ${p.features?.length ? `<ul class="sp-features">${p.features.map(f =>
          `<li><span class="sp-check">${ICON_CHECK}</span>${esc(f)}</li>`).join('')}</ul>` : ''}
      </div></div>
      <div class="sp-foot">
        ${p.features?.length ? `<button type="button" class="sp-more" data-n="${p.features.length}">${p.features.length} 項功能</button>` : '<span></span>'}
        ${p.internal
          ? `<a class="sp-link${p.requiresAuth ? ' tool-auth' : ''}" href="${esc(p.url)}">${p.requiresAuth ? ICON_LOCK : ''}<span>開啟</span>${ICON_ARROW}</a>`
          : `<a class="sp-link sp-link-ext" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(hostOf(p.url))}"><span>前往</span>${ICON_EXTERNAL}</a>`}
      </div>
    </article>`;
}

/** Render the intro page: one section per group, cards in an even grid.
    Cards start collapsed (title, two-line description, three tags, link); the
    header toggles the feature list. `toggleAllBtn` expands / collapses all. */
export function renderSideProjectPage(container, toggleAllBtn) {
  if (!container) return;
  if (!PROJECTS.length) {
    container.innerHTML = '<p class="sp-empty">尚無專案，敬請期待。</p>';
    return;
  }
  let i = 0;
  const groups = [...GROUPS, { key: undefined, title: '其他', sub: '' }];
  container.innerHTML = groups.map(g => {
    const list = PROJECTS.filter(p => (g.key ? p.group === g.key : !GROUPS.some(x => x.key === p.group)));
    if (!list.length) return '';
    return `
      <section class="sp-section">
        <header class="sp-section-head">
          <h3 class="sp-section-title">${esc(g.title)}</h3>
          <span class="sp-section-count">${list.length}</span>
          ${g.sub ? `<span class="sp-section-sub">${esc(g.sub)}</span>` : ''}
        </header>
        <div class="sp-grid">${list.map(p => cardHTML(p, i++)).join('')}</div>
      </section>`;
  }).join('');

  bindAuthGate(container);
  const cards = [...container.querySelectorAll('.sp-card')];
  const setOpen = (card, open) => {
    card.classList.toggle('open', open);
    card.querySelector('.sp-head').setAttribute('aria-expanded', String(open));
    const more = card.querySelector('.sp-more');
    if (more) more.textContent = open ? '收合' : `${more.dataset.n} 項功能`;
  };
  const syncAll = () => {
    if (toggleAllBtn) toggleAllBtn.textContent = cards.every(c => c.classList.contains('open')) ? '全部收合' : '全部展開';
  };
  cards.forEach(card => {
    const flip = () => { setOpen(card, !card.classList.contains('open')); syncAll(); };
    card.querySelector('.sp-head').addEventListener('click', flip);
    card.querySelector('.sp-more')?.addEventListener('click', flip);
  });
  toggleAllBtn?.addEventListener('click', () => {
    const open = !cards.every(c => c.classList.contains('open'));
    cards.forEach(c => setOpen(c, open));
    syncAll();
  });
  syncAll();
}
