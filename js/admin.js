/* ── Admin modal UI ───────────────────────────────────────────────── */
import { uploadResearchImage } from './storage.js';
import {
  addSector, updateSector, deleteSector,
  addSubsector, updateSubsector, deleteSubsector, updateSubsectorNotes,
  addTicker, updateTicker, deleteTicker,
  addAnalysis, updateAnalysis, deleteAnalysis,
  addResearchNote, updateResearchNote, deleteResearchNote,
  addAllowedEmail, removeAllowedEmail, getAllowedEmails,
} from './db.js';

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function confirmDialog(msg) { return window.confirm(msg); }

export function initAdminModals() {
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal-overlay')?.classList.remove('open'));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  });
  _initImageUpload();
}

function _initImageUpload() {
  const textarea  = document.getElementById('inputResearchContent');
  const fileInput = document.getElementById('inputResearchImage');
  const status    = document.getElementById('imgUploadStatus');
  if (!textarea || !fileInput) return;

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    status.textContent = '上傳中…';
    status.className = 'img-upload-status uploading';
    textarea.classList.add('img-uploading');
    try {
      const url = await uploadResearchImage(file);
      const alt = file.name.replace(/\.[^.]+$/, '');
      const md  = `![${alt}](${url})`;
      const start = textarea.selectionStart;
      const before = textarea.value.slice(0, start);
      const after  = textarea.value.slice(textarea.selectionEnd);
      // Insert on its own line
      const prefix = before && !before.endsWith('\n') ? '\n' : '';
      const suffix = after  && !after.startsWith('\n') ? '\n' : '';
      textarea.value = before + prefix + md + suffix + after;
      textarea.selectionStart = textarea.selectionEnd = start + prefix.length + md.length;
      textarea.focus();
      status.textContent = '✓ 上傳完成';
      status.className = 'img-upload-status ok';
      setTimeout(() => { status.textContent = ''; status.className = 'img-upload-status'; }, 3000);
    } catch (e) {
      status.textContent = '上傳失敗: ' + e.message;
      status.className = 'img-upload-status err';
    } finally {
      textarea.classList.remove('img-uploading');
      fileInput.value = '';
    }
  }

  // Drag and drop
  textarea.addEventListener('dragover', e => { e.preventDefault(); textarea.classList.add('img-drop-active'); });
  textarea.addEventListener('dragleave', () => textarea.classList.remove('img-drop-active'));
  textarea.addEventListener('drop', e => {
    e.preventDefault();
    textarea.classList.remove('img-drop-active');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });

  // Click-to-browse
  fileInput.addEventListener('change', () => handleImageFile(fileInput.files[0]));
}

export function openAddSector(nextOrder) {
  const form = document.getElementById('formSector');
  form.reset(); form.dataset.mode = 'add'; delete form.dataset.id;
  document.getElementById('sectorModalTitle').textContent = 'Add Sector';
  document.getElementById('inputSectorOrder').value = nextOrder || 0;
  openModal('modalSector');
}

export function openEditSector(sector) {
  const form = document.getElementById('formSector');
  form.dataset.mode = 'edit'; form.dataset.id = sector.id;
  document.getElementById('sectorModalTitle').textContent = 'Edit Sector';
  document.getElementById('inputSectorName').value = sector.name || '';
  document.getElementById('inputSectorOrder').value = sector.order ?? 0;
  document.getElementById('inputSectorOverview').value = (sector.ticker_overview || []).join(', ');
  openModal('modalSector');
}

export async function submitSector(onDone) {
  const form  = document.getElementById('formSector');
  const name  = document.getElementById('inputSectorName').value.trim();
  const order = parseInt(document.getElementById('inputSectorOrder').value) || 0;
  const ticker_overview = document.getElementById('inputSectorOverview').value.split(',').map(s => s.trim()).filter(Boolean);
  if (!name) return;
  if (form.dataset.mode === 'edit') await updateSector(form.dataset.id, { name, order, ticker_overview });
  else await addSector({ name, order, ticker_overview });
  closeModal('modalSector'); onDone?.();
}

export function openAddSubsector(sectorId, nextOrder) {
  const form = document.getElementById('formSubsector');
  form.reset(); form.dataset.mode = 'add'; form.dataset.sectorId = sectorId; delete form.dataset.id;
  document.getElementById('subsectorModalTitle').textContent = 'Add Subsector';
  document.getElementById('inputSubsectorOrder').value = nextOrder || 0;
  openModal('modalSubsector');
}

export function openEditSubsector(subsector) {
  const form = document.getElementById('formSubsector');
  form.dataset.mode = 'edit'; form.dataset.id = subsector.id;
  document.getElementById('subsectorModalTitle').textContent = 'Edit Subsector';
  document.getElementById('inputSubsectorName').value  = subsector.name  || '';
  document.getElementById('inputSubsectorOrder').value = subsector.order ?? 0;
  openModal('modalSubsector');
}

export async function submitSubsector(onDone) {
  const form  = document.getElementById('formSubsector');
  const name  = document.getElementById('inputSubsectorName').value.trim();
  const order = parseInt(document.getElementById('inputSubsectorOrder').value) || 0;
  if (!name) return;
  if (form.dataset.mode === 'edit') await updateSubsector(form.dataset.id, { name, order });
  else await addSubsector({ name, order, sector_id: form.dataset.sectorId, notes: '' });
  closeModal('modalSubsector'); onDone?.();
}

export function openEditNotes(subsector) {
  const form = document.getElementById('formNotes');
  form.dataset.id = subsector.id;
  document.getElementById('inputNotes').value = subsector.notes || '';
  openModal('modalNotes');
}

export async function submitNotes(onDone) {
  const form  = document.getElementById('formNotes');
  const notes = document.getElementById('inputNotes').value;
  await updateSubsectorNotes(form.dataset.id, notes);
  closeModal('modalNotes'); onDone?.();
}

export function openAddTicker(subsectorId, nextOrder) {
  const form = document.getElementById('formTicker');
  form.reset(); form.dataset.mode = 'add'; form.dataset.subsectorId = subsectorId; delete form.dataset.id;
  document.getElementById('tickerModalTitle').textContent = 'Add Ticker';
  document.getElementById('inputTickerOrder').value = nextOrder || 0;
  openModal('modalTicker');
}

export function openEditTicker(ticker) {
  const form = document.getElementById('formTicker');
  form.dataset.mode = 'edit'; form.dataset.id = ticker.id;
  document.getElementById('tickerModalTitle').textContent = 'Edit Ticker';
  document.getElementById('inputTickerSymbol').value = ticker.symbol || '';
  document.getElementById('inputTickerName').value   = ticker.name   || '';
  document.getElementById('inputTickerOrder').value  = ticker.order  ?? 0;
  openModal('modalTicker');
}

export async function submitTicker(onDone) {
  const form   = document.getElementById('formTicker');
  const symbol = document.getElementById('inputTickerSymbol').value.trim().toUpperCase();
  const name   = document.getElementById('inputTickerName').value.trim();
  const order  = parseInt(document.getElementById('inputTickerOrder').value) || 0;
  if (!symbol) return;
  if (form.dataset.mode === 'edit') await updateTicker(form.dataset.id, { symbol, name, order });
  else await addTicker({ symbol, name, order, subsector_id: form.dataset.subsectorId });
  closeModal('modalTicker'); onDone?.();
}

export function openAddAnalysis(subsectorId, nextOrder) {
  const form = document.getElementById('formAnalysis');
  form.reset(); form.dataset.mode = 'add'; form.dataset.subsectorId = subsectorId; delete form.dataset.id;
  document.getElementById('analysisModalTitle').textContent = 'Add Analysis Table';
  document.getElementById('inputAnalysisOrder').value = nextOrder || 0;
  openModal('modalAnalysis');
}

export function openEditAnalysis(analysis) {
  const form = document.getElementById('formAnalysis');
  form.dataset.mode = 'edit'; form.dataset.id = analysis.id;
  document.getElementById('analysisModalTitle').textContent = 'Edit Analysis Table';
  document.getElementById('inputAnalysisTitle').value   = analysis.title || '';
  document.getElementById('inputAnalysisOrder').value   = analysis.order ?? 0;
  document.getElementById('inputAnalysisColumns').value = (analysis.columns || []).join(', ');
  document.getElementById('inputAnalysisRows').value    = (analysis.rows || []).map(r => r.join('\t')).join('\n');
  openModal('modalAnalysis');
}

export async function submitAnalysis(onDone) {
  const form    = document.getElementById('formAnalysis');
  const title   = document.getElementById('inputAnalysisTitle').value.trim();
  const order   = parseInt(document.getElementById('inputAnalysisOrder').value) || 0;
  const columns = document.getElementById('inputAnalysisColumns').value.split(',').map(s => s.trim()).filter(Boolean);
  const rows    = document.getElementById('inputAnalysisRows').value.split('\n').filter(l => l.trim()).map(l => l.split('\t').map(c => c.trim()));
  if (!title || columns.length === 0) return;
  if (form.dataset.mode === 'edit') await updateAnalysis(form.dataset.id, { title, order, columns, rows });
  else await addAnalysis({ title, order, columns, rows, subsector_id: form.dataset.subsectorId });
  closeModal('modalAnalysis'); onDone?.();
}

export function openAddResearchNote(subsectorId, nextOrder) {
  const form = document.getElementById('formResearch');
  form.reset(); form.dataset.mode = 'add'; form.dataset.subsectorId = subsectorId; delete form.dataset.id;
  document.getElementById('researchModalTitle').textContent = 'Add Research Note';
  document.getElementById('inputResearchOrder').value = nextOrder || 0;
  openModal('modalResearch');
}

export function openEditResearchNote(note) {
  const form = document.getElementById('formResearch');
  form.dataset.mode = 'edit'; form.dataset.id = note.id;
  document.getElementById('researchModalTitle').textContent = 'Edit Research Note';
  document.getElementById('inputResearchTitle').value   = note.title   || '';
  document.getElementById('inputResearchContent').value = note.content || '';
  document.getElementById('inputResearchOrder').value   = note.order   ?? 0;
  openModal('modalResearch');
}

export async function submitResearchNote(onDone) {
  const form    = document.getElementById('formResearch');
  const title   = document.getElementById('inputResearchTitle').value.trim();
  const content = document.getElementById('inputResearchContent').value;
  const order   = parseInt(document.getElementById('inputResearchOrder').value) || 0;
  if (!title) return;
  if (form.dataset.mode === 'edit') await updateResearchNote(form.dataset.id, { title, content, order });
  else await addResearchNote({ title, content, order, subsector_id: form.dataset.subsectorId });
  closeModal('modalResearch'); onDone?.();
}

export async function handleDeleteSector(id, name, onDone) {
  if (!confirmDialog(`確定要刪除題材「${name}」嗎？\n此操作會刪除該 tab，但不會自動刪除其下的 subsector / ticker / note 等子資料。`)) return;
  if (!confirmDialog(`再次確認：永久刪除「${name}」tab？`)) return;
  await deleteSector(id);
  onDone?.();
}

export async function handleDeleteSubsector(id, onDone) {
  if (!confirmDialog('Delete this subsector and all its data?')) return;
  await deleteSubsector(id); onDone?.();
}
export async function handleDeleteTicker(id, onDone) {
  if (!confirmDialog('Delete this ticker?')) return;
  await deleteTicker(id); onDone?.();
}
export async function handleDeleteAnalysis(id, onDone) {
  if (!confirmDialog('Delete this analysis table?')) return;
  await deleteAnalysis(id); onDone?.();
}
export async function handleDeleteResearchNote(id, onDone) {
  if (!confirmDialog('Delete this research note?')) return;
  await deleteResearchNote(id); onDone?.();
}

export async function openWhitelist() {
  const list = document.getElementById('whitelistEmails');
  list.innerHTML = '<li>Loading…</li>';
  openModal('modalWhitelist');
  const emails = await getAllowedEmails();
  list.innerHTML = emails.map(e =>
    `<li>${e} <button class="btn-icon btn-remove-email" data-email="${e}">✕</button></li>`
  ).join('') || '<li>No emails yet.</li>';
  list.querySelectorAll('.btn-remove-email').forEach(btn => {
    btn.addEventListener('click', async () => { await removeAllowedEmail(btn.dataset.email); openWhitelist(); });
  });
}

export async function submitWhitelistEmail() {
  const input = document.getElementById('inputWhitelistEmail');
  const email = input.value.trim();
  if (!email) return;
  await addAllowedEmail(email);
  input.value = '';
  openWhitelist();
}
