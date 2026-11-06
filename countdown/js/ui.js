/* ui.js — DOM side: pixel thumbnails for the dex, badges, toasts, the stats card
   and share-image composition. */

import { C } from './palette.js';
import { makeCanvas, rect, disc, ring, drawText, silhouette } from './pixel.js';
import { animal, ufo, ANIMALS, ANIMAL_NAMES, SKIN_NAMES } from './sprites.js';
import { EGGS, BADGES, SKIN_AT } from './achievements.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = ms => { const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

function spriteFor(thumb, opts = {}) {
  if (thumb[0] === 'ufo') return opts.silhouette ? silhouette(ufo(0)) : ufo(0);
  return animal(thumb[0], thumb[1], opts.frame || 0, opts);
}

/** 52×52 framed thumbnail; locked → dark silhouette. */
export function thumb(thumbDef, locked, skins = {}) {
  const { c, g } = makeCanvas(52, 52);
  rect(g, 0, 0, 52, 52, locked ? C.ink : C.navy);
  rect(g, 0, 40, 52, 12, locked ? C.ink : C.deepblue);
  const s = spriteFor(thumbDef, { silhouette: locked, skin: skins[thumbDef[0]] });
  g.drawImage(s, Math.round((52 - s.width) / 2), Math.round(48 - s.height));
  if (locked) drawText(g, '?', 46, 0, C.gray, { align: 'right' });
  return c;
}

/** Pixel medal: ribbon + gold rim + sprite. */
export function badgeArt(def, locked, skins = {}) {
  const { c, g } = makeCanvas(64, 72);
  const rib1 = locked ? C.darkgray : C.red, rib2 = locked ? C.gray : C.blue;
  rect(g, 18, 46, 10, 24, rib1); rect(g, 36, 46, 10, 24, rib2);
  rect(g, 18, 66, 4, 6, C.ink); rect(g, 42, 66, 4, 6, C.ink);
  disc(g, 32, 32, 29, C.outline);
  disc(g, 32, 32, 28, locked ? C.gray : C.amber);
  disc(g, 32, 31, 27, locked ? C.lightgray : C.yellow);
  disc(g, 32, 32, 22, locked ? C.ink : C.navy);
  ring(g, 32, 32, 25, locked ? C.gray : C.rust);
  const { c: inner, g: ig } = makeCanvas(44, 44);
  disc(ig, 22, 22, 21, '#000');
  ig.globalCompositeOperation = 'source-in';
  const s = spriteFor(def.thumb, { silhouette: locked, skin: skins[def.thumb[0]] });
  ig.drawImage(s, Math.round((44 - s.width) / 2), Math.round(44 - s.height + 2));
  g.drawImage(inner, 10, 10);
  if (!locked) { rect(g, 14, 12, 3, 2, C.white); }
  return c;
}

export function renderDex(tab, ach, skinsEnabled, onToggleSkin) {
  const grid = $('#dexGrid');
  const r = ach.r;
  grid.innerHTML = '';
  const add = (canvas, html, locked, cls = '') => {
    const cell = document.createElement('div');
    cell.className = 'dex-cell' + (locked ? ' locked' : '');
    canvas.className = cls;
    cell.appendChild(canvas);
    cell.insertAdjacentHTML('beforeend', html);
    grid.appendChild(cell);
    return cell;
  };
  if (tab === 'eggs') {
    const seen = EGGS.filter(e => r.eggs[e.id]).length;
    $('#dexSummary').textContent = `已解鎖 ${seen} / ${EGGS.length} 個彩蛋。沒看過的只會顯示剪影和一句提示。`;
    for (const e of EGGS) {
      const rec = r.eggs[e.id];
      add(thumb(e.thumb, !rec, skinsEnabled), rec
        ? `<div class="name">${esc(e.name)}</div><div class="meta">首次 ${fmtDate(rec.first)} · ${rec.count} 次</div>`
        : `<div class="name">？？？</div><div class="meta">${esc(e.hint)}</div>`, !rec);
    }
  } else if (tab === 'badges') {
    const got = BADGES.filter(b => r.badges[b.id]).length;
    $('#dexSummary').textContent = `已獲得 ${got} / ${BADGES.length} 個成就徽章。連續上班天數：${ach.streak()} 天。`;
    for (const b of BADGES) {
      const when = r.badges[b.id];
      add(badgeArt(b, !when, skinsEnabled), `<div class="name">${esc(when ? b.name : '？？？')}</div><div class="meta">${esc(b.desc)}${when ? `<br>${fmtDate(when)} 解鎖` : ''}</div>`, !when, 'badge');
    }
  } else {
    $('#dexSummary').textContent = `每隻動物翻牌 ${SKIN_AT} 次就會解鎖新造型。`;
    for (const a of ANIMALS) {
      const n = r.flips[a] || 0, unlocked = n >= SKIN_AT;
      const { c, g } = makeCanvas(52, 52);
      rect(g, 0, 0, 52, 52, C.navy); rect(g, 0, 40, 52, 12, C.deepblue);
      const s = animal(a, 'stand', 0, { skin: unlocked && skinsEnabled[a] });
      g.drawImage(s, 1, -2);
      const cell = add(c, `<div class="name">${ANIMAL_NAMES[a]}</div><div class="meta">翻牌 ${n} 次</div>
        <div class="bar"><i style="width:${Math.min(100, n / SKIN_AT * 100)}%"></i></div>
        <div class="meta">${unlocked ? `已解鎖：${SKIN_NAMES[a]}` : `再翻 ${SKIN_AT - n} 次解鎖：？？？`}</div>
        ${unlocked ? `<label class="check" style="justify-content:center"><input type="checkbox" ${skinsEnabled[a] ? 'checked' : ''}> 穿上</label>` : ''}`, false);
      const cb = cell.querySelector('input');
      if (cb) cb.addEventListener('change', () => onToggleSkin(a, cb.checked));
    }
  }
}

export function toast(title, sub, art) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  if (art) { art.style.width = '48px'; art.style.height = art.height / art.width * 48 + 'px'; el.appendChild(art); }
  el.insertAdjacentHTML('beforeend', `<div>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`);
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 4200);
}

/** Today's flippers lined up on a little stage (stats card header). */
export function drawStatsArt(canvas, flips, skins) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  rect(g, 0, 0, 320, 80, C.navy);
  rect(g, 0, 64, 320, 16, C.deepblue);
  rect(g, 0, 64, 320, 1, C.blue);
  const list = ANIMALS.filter(a => flips[a]);
  const show = list.length ? list : ANIMALS;
  show.forEach((a, i) => {
    const x = 160 - show.length * 34 + i * 68 + 9;
    g.drawImage(animal(a, 'stand', 0, { hat: true, skin: skins[a] }), x, 18, 50, 50);
    if (flips[a]) drawText(g, `×${flips[a]}`, x + 44, 52, C.yellow, { outline: C.ink });
  });
  for (let i = 0; i < 30; i++) { g.fillStyle = [C.yellow, C.pink, C.cyan, C.lime][i % 4]; g.fillRect((i * 53) % 320, (i * 29) % 40, 2, 2); }
}

/** Compose the stage + a caption into a 2× PNG blob for sharing. */
export function composeShare(stage, caption, footer = 'hgvf.github.io/countdown') {
  const S = 2;
  const { c, g } = makeCanvas(640 * S, 360 * S + 64);
  g.drawImage(stage, 0, 0, 640 * S, 360 * S);
  rect(g, 0, 360 * S, 640 * S, 64, C.ink);
  rect(g, 0, 360 * S, 640 * S, 4, C.outline);
  let text = caption || '';
  const maxChars = 50;
  if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…';
  drawText(g, text, 640, 360 * S + 12, C.cream, { align: 'center', scale: 2 });
  drawText(g, footer, 640 * S - 12, 360 * S + 46, C.gray, { align: 'right' });
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}

export async function shareBlob(blob, name = 'offwork.png') {
  try {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '下班倒數' }); return 'shared'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

/** 16×16 favicon-ish brand mark: the hour card. */
export function drawBrand(canvas) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  rect(g, 0, 0, 16, 16, C.outline);
  rect(g, 1, 1, 14, 14, C.paper);
  rect(g, 1, 1, 14, 5, C.red);
  rect(g, 6, 8, 4, 1, C.ink); rect(g, 9, 9, 1, 2, C.ink); rect(g, 6, 11, 4, 1, C.ink); rect(g, 6, 12, 1, 2, C.ink); rect(g, 6, 14, 4, 1, C.ink);
  rect(g, 3, 3, 1, 1, C.yellow); rect(g, 12, 3, 1, 1, C.yellow);
}
