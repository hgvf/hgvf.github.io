/* ── Experience & Education (editable timeline) ─────────────────────────
   Data-driven version of the Experience page. Content lives in Firestore at
   site_content/experience = { work: [...], education: [...] }, each item
   { date, title, org, desc, icon }. Falls back to EXP_DEFAULTS (which mirror
   the original static markup, newest-first) until a stored doc exists. A
   whitelisted admin edits everything through a modal, including per-item icon
   image uploads. */
import { getExperience, saveExperience } from './db.js';
import { uploadImage } from './storage.js';

/* ── Default icons (shown when an item has no uploaded icon) ─────────── */
const ICON_WORK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
const ICON_EDU  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/></svg>`;

function iconMarkup(icon, kind) {
  if (icon) return `<img src="${_attr(icon)}" alt="" loading="lazy" />`;
  return kind === 'education' ? ICON_EDU : ICON_WORK;
}

/* Newest-first defaults, mirroring the original page content. */
const EXP_DEFAULTS = {
  work: [
    {
      date: '2025/8-',
      title: 'AI Engineer',
      org: 'National Taiwan University Hospital (NTUH)',
      desc: '• Built LLM-based applications with memory mechanisms and retrieval-augmented generation pipelines, supporting summarization, knowledge retrieval, and slide generation workflows.\n'
          + '• Developed ASR applications using Whisper for speech-to-text processing and downstream language understanding tasks.\n'
          + '• Trained, evaluated, and deployed medical AI models for clinical and healthcare-related applications.',
      icon: '',
    },
    {
      date: '2024/10-2025/7',
      title: 'AI Engineer',
      org: 'Nanya Technology Corporation - IT',
      desc: '• Developed and deployed computer vision systems for face recognition and person re-identification.\n'
          + '• Optimized computer vision models and deployment pipelines to improve recognition accuracy and practical usability.\n'
          + '• Designed zero-shot prompting workflows for LLM-based text-to-SQL generation, enabling natural language database querying.',
      icon: '',
    },
  ],
  education: [
    {
      date: '2021/9-2023/12',
      title: 'M.S. in Computer Science and Information Engineering',
      org: 'National Taiwan University of Science and Technology (NTUST)',
      desc: 'NLP Lab',
      icon: '',
    },
    {
      date: '2017/9-2021/6',
      title: 'B.S. in Computer Science and Information Engineering',
      org: 'National Chung Cheng University (CCU)',
      desc: '',
      icon: '',
    },
  ],
};

let _stored = null;   // last-loaded Firestore doc (or null)

function _esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function _attr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Merge the stored doc over the defaults. An array present (even empty) in the
// stored doc replaces the default array wholesale.
function resolvedExperience() {
  const p = _stored || {};
  return {
    work:      Array.isArray(p.work)      ? p.work      : EXP_DEFAULTS.work,
    education: Array.isArray(p.education) ? p.education : EXP_DEFAULTS.education,
  };
}

function itemHTML(item, kind) {
  const descHTML = item.desc
    ? `<p class="timeline-desc">${_esc(item.desc).replace(/\n/g, '<br>')}</p>`
    : '';
  return `<div class="timeline-item">
    <span class="timeline-marker"></span>
    <div class="glass-card timeline-content">
      <div class="timeline-body">
        <div class="timeline-icon">${iconMarkup(item.icon, kind)}</div>
        <div class="timeline-main">
          ${item.date ? `<span class="timeline-date">${_esc(item.date)}</span>` : ''}
          <h4 class="timeline-title">${_esc(item.title)}</h4>
          ${item.org ? `<span class="timeline-org">${_esc(item.org)}</span>` : ''}
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
}

/* ── Edit modal ─────────────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// Build one editable row. `icon` is tracked on the row element (dataset) and
// updated in place when an image is uploaded.
function _addExpRow(kind, item = {}) {
  const wrap = document.getElementById(kind === 'education' ? 'expEduEditor' : 'expWorkEditor');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'exp-edit-row';
  row.dataset.icon = item.icon || '';
  row.innerHTML = `
    <div class="exp-edit-grid">
      <div class="exp-edit-icon">
        <div class="exp-edit-icon-preview">${iconMarkup(item.icon, kind)}</div>
        <label class="exp-edit-icon-btn">上傳 Icon<input type="file" accept="image/*" hidden data-f="iconfile"></label>
        <span class="exp-edit-icon-status"></span>
      </div>
      <div class="exp-edit-fields">
        <label class="exp-edit-field">Date<input class="modal-input" data-f="date" value="${_attr(item.date)}" placeholder="2025/8-" /></label>
        <label class="exp-edit-field">Title<input class="modal-input" data-f="title" value="${_attr(item.title)}" /></label>
        <label class="exp-edit-field exp-edit-full">Organization<input class="modal-input" data-f="org" value="${_attr(item.org)}" /></label>
        <label class="exp-edit-field exp-edit-full">Description（一行一項）<textarea class="modal-textarea" data-f="desc" rows="4">${_esc(item.desc)}</textarea></label>
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
    const g = f => r.querySelector(`[data-f="${f}"]`)?.value ?? '';
    return {
      date:  g('date').trim(),
      title: g('title').trim(),
      org:   g('org').trim(),
      desc:  g('desc').replace(/\r\n/g, '\n').trim(),
      icon:  r.dataset.icon || '',
    };
  }).filter(x => x.title || x.org || x.date || x.desc);
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
  renderExperience(resolvedExperience());
  closeModal('modalExperience');
}

/* ── Init (called once from app.js) ─────────────────────────────────── */
export async function initExperience() {
  try {
    _stored = await getExperience();
  } catch (err) {
    console.warn('experience load failed:', err);   // non-fatal — defaults stay
  }
  renderExperience(resolvedExperience());

  document.getElementById('btnEditExperience')?.addEventListener('click', openEditExperience);
  document.getElementById('btnAddExpWork')?.addEventListener('click', () => _addExpRow('work', {}));
  document.getElementById('btnAddExpEdu')?.addEventListener('click', () => _addExpRow('education', {}));
  document.getElementById('formExperience')?.addEventListener('submit', async e => {
    e.preventDefault();
    await submitExperience();
  });
}
