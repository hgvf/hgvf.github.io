/* ── Experience & Education (editable, bilingual timeline) ──────────────
   Data-driven Experience page. Content lives in Firestore at
   site_content/experience = { work: [...], education: [...] }, each item:
     { icon, en: { date, title, org, desc }, zh: { date, title, org, desc } }
   The icon is shared across both languages. A [中/EN] toggle in the header
   switches the displayed language (remembered in localStorage); a whitelisted
   admin edits both languages side-by-side in one modal. Falls back to
   EXP_DEFAULTS (newest-first) until a stored doc exists. */
import { getExperience, saveExperience } from './db.js';
import { uploadImage } from './storage.js';

const LANGS = ['zh', 'en'];
const LS_KEY = 'exp_lang';

/* Section / page labels per language (not part of the editable content doc). */
const UI_TEXT = {
  en: { pageTitle: 'Experience & Education', work: 'Work Experience', edu: 'Education' },
  zh: { pageTitle: '經歷與學歷',              work: '工作經歷',        edu: '教育' },
};

/* ── Default icons (shown when an item has no uploaded icon) ─────────── */
const ICON_WORK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
const ICON_EDU  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/></svg>`;

function iconMarkup(icon, kind) {
  if (icon) return `<img src="${_attr(icon)}" alt="" loading="lazy" />`;
  return kind === 'education' ? ICON_EDU : ICON_WORK;
}

/* Newest-first bilingual defaults, mirroring the original page content. */
const EXP_DEFAULTS = {
  work: [
    {
      icon: '',
      en: {
        date: '2025/8-', title: 'AI Engineer',
        org: 'National Taiwan University Hospital (NTUH)',
        desc: '• Built LLM-based applications with memory mechanisms and retrieval-augmented generation pipelines, supporting summarization, knowledge retrieval, and slide generation workflows.\n'
            + '• Developed ASR applications using Whisper for speech-to-text processing and downstream language understanding tasks.\n'
            + '• Trained, evaluated, and deployed medical AI models for clinical and healthcare-related applications.',
      },
      zh: {
        date: '2025/8-', title: 'AI 工程師',
        org: '國立臺灣大學醫學院附設醫院（NTUH）',
        desc: '• 建構具備記憶機制與檢索增強生成（RAG）的 LLM 應用，支援摘要、知識檢索與投影片生成流程。\n'
            + '• 以 Whisper 開發語音轉文字（ASR）應用及下游語言理解任務。\n'
            + '• 訓練、評估並部署臨床與醫療相關的醫療 AI 模型。',
      },
    },
    {
      icon: '',
      en: {
        date: '2024/10-2025/7', title: 'AI Engineer',
        org: 'Nanya Technology Corporation - IT',
        desc: '• Developed and deployed computer vision systems for face recognition and person re-identification.\n'
            + '• Optimized computer vision models and deployment pipelines to improve recognition accuracy and practical usability.\n'
            + '• Designed zero-shot prompting workflows for LLM-based text-to-SQL generation, enabling natural language database querying.',
      },
      zh: {
        date: '2024/10-2025/7', title: 'AI 工程師',
        org: '南亞科技 - IT',
        desc: '• 開發並部署人臉辨識與行人重識別（re-ID）的電腦視覺系統。\n'
            + '• 優化電腦視覺模型與部署流程，提升辨識準確度與實用性。\n'
            + '• 設計 LLM 零樣本提示流程進行 text-to-SQL 生成，實現自然語言資料庫查詢。',
      },
    },
  ],
  education: [
    {
      icon: '',
      en: {
        date: '2021/9-2023/12',
        title: 'M.S. in Computer Science and Information Engineering',
        org: 'National Taiwan University of Science and Technology (NTUST)',
        desc: 'NLP Lab',
      },
      zh: {
        date: '2021/9-2023/12', title: '資訊工程 碩士',
        org: '國立臺灣科技大學（NTUST）', desc: 'NLP 實驗室',
      },
    },
    {
      icon: '',
      en: {
        date: '2017/9-2021/6',
        title: 'B.S. in Computer Science and Information Engineering',
        org: 'National Chung Cheng University (CCU)', desc: '',
      },
      zh: {
        date: '2017/9-2021/6', title: '資訊工程 學士',
        org: '國立中正大學（CCU）', desc: '',
      },
    },
  ],
};

let _stored = null;   // last-loaded Firestore doc (or null)
let _lang   = 'en';   // current display language

function _esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function _attr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Normalize one item to the bilingual shape. Accepts legacy flat items
// ({ date, title, org, desc, icon }) and treats their text as English.
function _normItem(raw) {
  const r = raw || {};
  const legacy = { date: r.date, title: r.title, org: r.org, desc: r.desc };
  const pick = (o, k) => (o && typeof o[k] === 'string') ? o[k] : '';
  const en = {
    date:  pick(r.en, 'date')  || pick(legacy, 'date'),
    title: pick(r.en, 'title') || pick(legacy, 'title'),
    org:   pick(r.en, 'org')   || pick(legacy, 'org'),
    desc:  pick(r.en, 'desc')  || pick(legacy, 'desc'),
  };
  const zh = {
    date:  pick(r.zh, 'date'),  title: pick(r.zh, 'title'),
    org:   pick(r.zh, 'org'),   desc:  pick(r.zh, 'desc'),
  };
  return { icon: r.icon || '', en, zh };
}

// Merge stored doc over defaults, then normalize every item.
function resolvedExperience() {
  const p = _stored || {};
  const work = (Array.isArray(p.work)      ? p.work      : EXP_DEFAULTS.work).map(_normItem);
  const edu  = (Array.isArray(p.education) ? p.education : EXP_DEFAULTS.education).map(_normItem);
  return { work, education: edu };
}

// Read a field in the current language, falling back to the other language
// when the chosen one is blank (so a half-translated entry still shows).
function _field(item, key) {
  const other = _lang === 'en' ? 'zh' : 'en';
  return (item[_lang]?.[key] || '').trim() || (item[other]?.[key] || '').trim();
}

function itemHTML(item, kind) {
  const date = _field(item, 'date'), title = _field(item, 'title');
  const org  = _field(item, 'org'),  desc  = _field(item, 'desc');
  const descHTML = desc
    ? `<p class="timeline-desc">${_esc(desc).replace(/\n/g, '<br>')}</p>`
    : '';
  return `<div class="timeline-item">
    <span class="timeline-marker"></span>
    <div class="glass-card timeline-content">
      <div class="timeline-body">
        <div class="timeline-icon">${iconMarkup(item.icon, kind)}</div>
        <div class="timeline-main">
          ${date ? `<span class="timeline-date">${_esc(date)}</span>` : ''}
          <h4 class="timeline-title">${_esc(title)}</h4>
          ${org ? `<span class="timeline-org">${_esc(org)}</span>` : ''}
          ${descHTML}
        </div>
      </div>
    </div>
  </div>`;
}

function renderExperience(data) {
  const workEl = document.getElementById('experienceWork');
  const eduEl  = document.getElementById('experienceEducation');
  if (workEl) workEl.innerHTML = (data.work || []).map(i => itemHTML(i, 'work')).join('');
  if (eduEl)  eduEl.innerHTML  = (data.education || []).map(i => itemHTML(i, 'education')).join('');

  // Section / page labels follow the language too.
  const t = UI_TEXT[_lang] || UI_TEXT.en;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('expPageTitle', t.pageTitle);
  set('expWorkHeading', t.work);
  set('expEduHeading', t.edu);

  // Reflect active state on the toggle.
  document.querySelectorAll('#expLangToggle .lang-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === _lang));
}

function rerender() { renderExperience(resolvedExperience()); }

function setLang(lang) {
  if (!LANGS.includes(lang) || lang === _lang) return;
  _lang = lang;
  try { localStorage.setItem(LS_KEY, lang); } catch { /* ignore */ }
  rerender();
}

/* ── Edit modal ─────────────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// Build one editable row: shared icon uploader + EN / 中 fields side by side.
function _addExpRow(kind, item = {}) {
  const it = _normItem(item);
  const wrap = document.getElementById(kind === 'education' ? 'expEduEditor' : 'expWorkEditor');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'exp-edit-row';
  row.dataset.icon = it.icon || '';
  row.innerHTML = `
    <div class="exp-edit-grid">
      <div class="exp-edit-icon">
        <div class="exp-edit-icon-preview">${iconMarkup(it.icon, kind)}</div>
        <label class="exp-edit-icon-btn">上傳 Icon<input type="file" accept="image/*" hidden data-f="iconfile"></label>
        <span class="exp-edit-icon-status"></span>
        <span class="exp-edit-icon-note">兩種語言共用</span>
      </div>
      <div class="exp-edit-fields exp-edit-bilingual">
        <label class="exp-edit-field">Date (EN)<input class="modal-input" data-f="date_en" value="${_attr(it.en.date)}" placeholder="2025/8-" /></label>
        <label class="exp-edit-field">日期 (中)<input class="modal-input" data-f="date_zh" value="${_attr(it.zh.date)}" placeholder="2025/8-" /></label>
        <label class="exp-edit-field">Title (EN)<input class="modal-input" data-f="title_en" value="${_attr(it.en.title)}" /></label>
        <label class="exp-edit-field">職稱／學位 (中)<input class="modal-input" data-f="title_zh" value="${_attr(it.zh.title)}" /></label>
        <label class="exp-edit-field">Organization (EN)<input class="modal-input" data-f="org_en" value="${_attr(it.en.org)}" /></label>
        <label class="exp-edit-field">單位 (中)<input class="modal-input" data-f="org_zh" value="${_attr(it.zh.org)}" /></label>
        <label class="exp-edit-field">Description (EN)（一行一項）<textarea class="modal-textarea" data-f="desc_en" rows="4">${_esc(it.en.desc)}</textarea></label>
        <label class="exp-edit-field">描述 (中)（一行一項）<textarea class="modal-textarea" data-f="desc_zh" rows="4">${_esc(it.zh.desc)}</textarea></label>
      </div>
    </div>
    <div class="exp-edit-actions">
      <button type="button" class="exp-edit-move" data-move="up" title="上移">↑</button>
      <button type="button" class="exp-edit-move" data-move="down" title="下移">↓</button>
      <button type="button" class="exp-edit-remove">× 移除</button>
    </div>`;

  row.querySelector('.exp-edit-remove').addEventListener('click', () => { row.remove(); _refreshMoveButtons(wrap); });
  row.querySelector('[data-move="up"]').addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev) { wrap.insertBefore(row, prev); _refreshMoveButtons(wrap); }
  });
  row.querySelector('[data-move="down"]').addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next) { wrap.insertBefore(next, row); _refreshMoveButtons(wrap); }
  });

  const fileInput = row.querySelector('[data-f="iconfile"]');
  const status    = row.querySelector('.exp-edit-icon-status');
  const preview   = row.querySelector('.exp-edit-icon-preview');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    status.textContent = '上傳中…';
    try {
      // Reuse the research-images/ folder (known whitelisted-write path).
      const url = await uploadImage(file, 'research-images');
      row.dataset.icon = url;
      preview.innerHTML = `<img src="${_attr(url)}" alt="" />`;
      status.textContent = '✓ 完成';
    } catch (e) {
      status.textContent = '失敗';
      console.error('icon upload failed', e);
    } finally {
      fileInput.value = '';
    }
  });

  wrap.appendChild(row);
  _refreshMoveButtons(wrap);
}

function _refreshMoveButtons(wrap) {
  const rows = [...wrap.querySelectorAll('.exp-edit-row')];
  rows.forEach((r, i) => {
    r.querySelector('[data-move="up"]').disabled   = i === 0;
    r.querySelector('[data-move="down"]').disabled = i === rows.length - 1;
  });
}

function _collect(wrap) {
  return [...wrap.querySelectorAll('.exp-edit-row')].map(r => {
    const g = f => (r.querySelector(`[data-f="${f}"]`)?.value ?? '');
    const en = {
      date: g('date_en').trim(), title: g('title_en').trim(),
      org: g('org_en').trim(), desc: g('desc_en').replace(/\r\n/g, '\n').trim(),
    };
    const zh = {
      date: g('date_zh').trim(), title: g('title_zh').trim(),
      org: g('org_zh').trim(), desc: g('desc_zh').replace(/\r\n/g, '\n').trim(),
    };
    return { icon: r.dataset.icon || '', en, zh };
  }).filter(x => x.icon || Object.values(x.en).some(Boolean) || Object.values(x.zh).some(Boolean));
}

function openEditExperience() {
  const data = resolvedExperience();
  const workWrap = document.getElementById('expWorkEditor');
  const eduWrap  = document.getElementById('expEduEditor');
  if (workWrap) workWrap.innerHTML = '';
  if (eduWrap)  eduWrap.innerHTML = '';
  (data.work || []).forEach(i => _addExpRow('work', i));
  (data.education || []).forEach(i => _addExpRow('education', i));
  openModal('modalExperience');
}

async function submitExperience() {
  const work      = _collect(document.getElementById('expWorkEditor'));
  const education = _collect(document.getElementById('expEduEditor'));
  const data = { work, education };
  await saveExperience(data);
  _stored = { ...(_stored || {}), ...data };
  rerender();
  closeModal('modalExperience');
}

/* ── Init (called once from app.js) ─────────────────────────────────── */
export async function initExperience() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (LANGS.includes(saved)) _lang = saved;
  } catch { /* ignore */ }

  try {
    _stored = await getExperience();
  } catch (err) {
    console.warn('experience load failed:', err);   // non-fatal — defaults stay
  }
  rerender();

  document.querySelectorAll('#expLangToggle .lang-opt').forEach(btn =>
    btn.addEventListener('click', () => setLang(btn.dataset.lang)));
  document.getElementById('btnEditExperience')?.addEventListener('click', openEditExperience);
  document.getElementById('btnAddExpWork')?.addEventListener('click', () => _addExpRow('work', {}));
  document.getElementById('btnAddExpEdu')?.addEventListener('click', () => _addExpRow('education', {}));
  document.getElementById('formExperience')?.addEventListener('submit', async e => {
    e.preventDefault();
    await submitExperience();
  });
}
