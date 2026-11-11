// app.js — 旅遊分帳 (split/). Signed-in users only.
//
// Storage: Firestore `split_tables/{id}`, one doc per table holding members
// and every expense in a map field (`expenses.<id>`). A single list query
// (access array-contains my email) feeds both the list and the open table,
// so the whole app costs one read per change. Rules: firestore.rules.

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, where, onSnapshot, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from '../../js/config.js';
import * as L from './ledger.js';
import { confetti, coins, countUp, buzz } from './fx.js';

/* ── Firebase ─────────────────────────────────────────────────── */
const fbApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
let db;
try {
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch { db = getFirestore(fbApp); }
const COLL = 'split_tables';

/* ── State ────────────────────────────────────────────────────── */
const S = {
  user: null,
  tables: new Map(),
  loaded: false,
  unsub: null,
  cur: null,              // open table id
  tab: 'list',
  filter: '',             // member filter on 明細
  openMembers: new Set(), // expanded member cards on 統整
  settleShown: false,
  settleAnim: false,
};

/* ── Helpers ──────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const PALETTE = ['#D9644A', '#4F7FB8', '#5E9E7A', '#E8A33D', '#8E6BBF', '#C2577F', '#3A9C9C', '#8B5E3C', '#6C8A3A', '#B8664F'];
const EMOJIS = ['✈️', '🏝️', '🗻', '🏯', '🍣', '🎡', '🏕️', '🚗', '🎿', '🍻', '🏖️', '🗺️'];
const WD = '日一二三四五六';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const meKey = id => `split_me_${id}`;
const myMember = t => {
  const id = store.get(meKey(t.id));
  return t.members?.find(m => m.id === id) || null;
};

const curTable = () => S.tables.get(S.cur) || null;
const memberOf = (t, id) => t.members?.find(m => m.id === id) || { id, name: '?', color: '#999' };
const avatar = (m, size = '') =>
  `<span class="av ${size}" style="--c:${esc(m.color)}" title="${esc(m.name)}">${esc([...(m.name || '?')][0])}</span>`;

function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}/${d}（${WD[dt.getDay()]}）`;
}
const DEVICE_TZ = L.deviceTz();
// Time of an expense in its own zone, plus a badge when that zone isn't this device's.
const timeOf = e => {
  const tz = L.validTz(e.tz) ? e.tz : DEVICE_TZ;
  return L.hhmm(e.ts, tz) + (tz !== DEVICE_TZ ? ` <span class="tzb">${esc(L.tzName(tz))}</span>` : '');
};
const tzPrefKey = id => `split_tz_${id}`;
function tzOptions(selected) {
  const now = Date.now();
  const opt = z => `<option value="${esc(z)}" ${z === selected ? 'selected' : ''}>${esc(L.tzName(z))} ${L.gmtLabel(now, z)}</option>`;
  const common = L.COMMON_TZ.map(([z]) => z).filter(L.validTz);
  const rest = L.allTimeZones().filter(z => !common.includes(z));
  return `<option value="" ${selected ? '' : 'selected'}>📍 自動：${esc(L.tzName(DEVICE_TZ))} ${L.gmtLabel(now, DEVICE_TZ)}</option>
    <optgroup label="常用">${common.map(opt).join('')}</optgroup>
    <optgroup label="全部時區">${rest.map(opt).join('')}</optgroup>`;
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function guessCat(title) {
  const s = title.toLowerCase();
  // Order matters: 住宿/交通 before 餐飲 so 「飯店」 isn't read as a meal.
  const rules = [
    ['stay', /住|飯店|旅館|民宿|hotel|airbnb|hostel|房/],
    ['traffic', /車|計程|uber|捷運|地鐵|電車|新幹線|高鐵|火車|機票|航空|巴士|公車|加油|停車|油錢|過路|taxi|train|flight|bus/],
    ['ticket', /票|門票|入場|樂園|博物館|展|ticket|pass|體驗/],
    ['drink', /咖啡|飲料|啤酒|酒|奶茶|茶|coffee|beer|bar|星巴克/],
    ['food', /餐|飯|麵|早|午|晚|宵夜|拉麵|壽司|燒肉|火鍋|便當|小吃|甜點|蛋糕|吃|食|food|lunch|dinner|breakfast/],
    ['shop', /買|伴手禮|紀念品|藥妝|購|超市|便利商店|7-11|全家|outlet|shop/],
  ];
  return rules.find(([, re]) => re.test(s))?.[0] || '';
}

/* ── Views & routing ──────────────────────────────────────────── */
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === view));
}

function route() {
  if (!S.user) return;
  const m = location.hash.match(/^#t=([\w-]+)/);
  if (!m) { S.cur = null; show('vList'); renderList(); return; }
  if (!S.loaded) return;                         // wait for the first snapshot
  if (!S.tables.has(m[1])) {
    toast('找不到這張分帳表（可能已刪除或沒有權限）');
    history.replaceState(null, '', location.pathname);
    route();
    return;
  }
  if (S.cur !== m[1]) {
    S.cur = m[1]; S.tab = 'list'; S.filter = ''; S.openMembers.clear();
    S.settleShown = false;
    $('heroTotal').dataset.v = '0';
  }
  show('vTable');
  renderTable();
  $('tScroll').scrollTop = 0;
}
addEventListener('popstate', route);

function openTable(id) {
  history.pushState({ fromList: 1 }, '', `#t=${id}`);
  route();
}
$('btnBack').addEventListener('click', () => {
  if (history.state?.fromList) history.back();
  else { history.replaceState(null, '', location.pathname); route(); }
});

/* ── Auth ─────────────────────────────────────────────────────── */
async function login() {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') {
      toast('登入失敗：' + (e?.message || e));
    }
  }
}
$('btnGateLogin').addEventListener('click', login);

onAuthStateChanged(auth, user => {
  S.user = user;
  S.unsub?.(); S.unsub = null;
  S.tables.clear(); S.loaded = false;
  if (!user) { show('vGate'); return; }

  $('btnMe').innerHTML = user.photoURL
    ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : esc([...(user.displayName || user.email || '?')][0]);
  $('hello').textContent = `嗨，${user.displayName || user.email}`;
  show(location.hash.startsWith('#t=') ? 'vBoot' : 'vList');
  renderList();

  S.unsub = onSnapshot(
    query(collection(db, COLL), where('access', 'array-contains', user.email)),
    snap => {
      S.tables.clear();
      snap.docs.forEach(d => S.tables.set(d.id, { id: d.id, ...d.data() }));
      const first = !S.loaded;
      S.loaded = true;
      if (first) route();
      else if (S.cur) {
        if (S.tables.has(S.cur)) renderTable();
        else { toast('這張分帳表已被刪除'); history.replaceState(null, '', location.pathname); route(); }
      } else renderList();
    },
    err => {
      console.error(err);
      S.loaded = true;
      $('tableList').innerHTML = `<div class="empty"><div class="empty-art">⚠️</div>
        <p>讀取失敗：${esc(err.code || err.message)}</p>
        <p class="muted">若是 permission-denied，請確認 firestore.rules 已部署。</p></div>`;
      show('vList');
    });
});

$('btnMe').addEventListener('click', () => {
  const u = S.user;
  openSheet(`
    <h2 class="sheet-title">帳號</h2>
    <p class="muted">${esc(u.displayName || '')}<br>${esc(u.email)}</p>
    <div class="sheet-actions">
      <button type="button" class="btn btn-ghost" data-close>取消</button>
      <button type="button" class="btn btn-danger" id="doLogout">登出</button>
    </div>`, body => {
    body.querySelector('#doLogout').addEventListener('click', async () => {
      closeSheet(); await signOut(auth);
      history.replaceState(null, '', location.pathname);
    });
  });
});

/* ── Bottom sheet ─────────────────────────────────────────────── */
const sheetWrap = $('sheetWrap'), sheet = $('sheet'), sheetBody = $('sheetBody');
function openSheet(html, onMount) {
  sheetBody.innerHTML = html;
  sheetWrap.classList.add('open');
  sheetWrap.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  sheet.style.transform = '';
  onMount?.(sheetBody);
}
function closeSheet() {
  sheetWrap.classList.remove('open');
  sheetWrap.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('locked');
  setTimeout(() => { if (!sheetWrap.classList.contains('open')) sheetBody.innerHTML = ''; }, 300);
}
sheetWrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && sheetWrap.classList.contains('open')) closeSheet(); });

// Drag the grip down to dismiss (mobile).
(() => {
  const grip = sheet.querySelector('.sheet-grip');
  let y0 = null, dy = 0;
  grip.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; grip.setPointerCapture(e.pointerId); sheet.classList.add('dragging'); });
  grip.addEventListener('pointermove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 === null) return;
    sheet.classList.remove('dragging');
    if (dy > 90) closeSheet(); else sheet.style.transform = '';
    y0 = null;
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
})();

/* ── List view ────────────────────────────────────────────────── */
function tableTotal(t) { return L.stats(t).total; }
function tableRange(t) {
  const ex = Object.values(t.expenses || {}).filter(e => e?.ts).sort((a, b) => a.ts - b.ts);
  if (!ex.length) return '還沒有任何紀錄';
  const f = e => { const [, m, d] = L.dayKey(e.ts, e.tz).split('-').map(Number); return `${m}/${d}`; };
  const a = f(ex[0]), b = f(ex[ex.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}

function renderList() {
  const box = $('tableList');
  if (!S.loaded) {
    box.innerHTML = '<div class="skel"></div><div class="skel"></div>';
    return;
  }
  const list = [...S.tables.values()].sort((a, b) =>
    (b.updatedAt?.toMillis?.() || b.createdMs || 0) - (a.updatedAt?.toMillis?.() || a.createdMs || 0));
  if (!list.length) {
    box.innerHTML = `<div class="empty">
      <div class="empty-art bob">🧳</div>
      <p><b>還沒有分帳表</b></p>
      <p class="muted">按下方「建立分帳表」，<br>輸入旅伴名字就能開始記帳。</p></div>`;
    return;
  }
  box.innerHTML = list.map((t, i) => {
    const total = tableTotal(t);
    const mine = t.owner === S.user.uid;
    return `<button type="button" class="tcard" data-id="${esc(t.id)}" style="--i:${i}">
      <span class="tcard-emoji">${esc(t.emoji || '✈️')}</span>
      <span class="tcard-main">
        <span class="tcard-name">${esc(t.name)}</span>
        <span class="tcard-meta">${esc(tableRange(t))} · ${t.members?.length || 0} 人${mine ? '' : ' · 共用'}</span>
        <span class="av-stack">${(t.members || []).slice(0, 6).map(m => avatar(m, 'sm')).join('')}</span>
      </span>
      <span class="tcard-total">${esc(L.fmt(total, t.currency))}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.tcard').forEach(b => b.addEventListener('click', () => openTable(b.dataset.id)));
}

/* ── Create table ─────────────────────────────────────────────── */
$('btnNewTable').addEventListener('click', () => {
  const me = S.user.displayName?.split(' ')[0] || '我';
  let n = 3;
  openSheet(`
    <h2 class="sheet-title">建立分帳表</h2>
    <label class="field"><span>名稱</span>
      <input id="cName" maxlength="40" placeholder="例如：東京五天四夜" autocomplete="off"></label>
    <div class="field"><span>圖示</span>
      <div class="emoji-row" id="cEmoji">${EMOJIS.map((e, i) =>
        `<button type="button" class="emoji-opt${i ? '' : ' on'}" data-e="${e}">${e}</button>`).join('')}</div></div>
    <label class="field"><span>幣別</span>
      <select id="cCur">${Object.entries(L.CURRENCIES).map(([k, v]) =>
        `<option value="${k}">${v.label}（${k}）</option>`).join('')}</select></label>
    <div class="field"><span>人數</span>
      <div class="stepper">
        <button type="button" class="step" id="cMinus" aria-label="減少">−</button>
        <b id="cN">${n}</b>
        <button type="button" class="step" id="cPlus" aria-label="增加">＋</button>
      </div></div>
    <div class="field"><span>成員名字</span><div class="names" id="cNames"></div></div>
    <label class="field"><span>共同編輯者 Gmail <em>選填，對方登入後就能一起記帳</em></span>
      <textarea id="cShare" rows="2" placeholder="friend@gmail.com, buddy@gmail.com"></textarea></label>
    <div class="sheet-actions">
      <button type="button" class="btn btn-ghost" data-close>取消</button>
      <button type="button" class="btn btn-primary" id="cGo">建立</button>
    </div>`, body => {
    let emoji = EMOJIS[0];
    const namesBox = body.querySelector('#cNames');
    const draw = () => {
      const prev = [...namesBox.querySelectorAll('input')].map(i => i.value);
      namesBox.innerHTML = Array.from({ length: n }, (_, i) => `
        <label class="name-in" style="--c:${PALETTE[i % PALETTE.length]}">
          <span class="av sm" style="--c:${PALETTE[i % PALETTE.length]}">${i + 1}</span>
          <input maxlength="16" placeholder="成員 ${i + 1}" value="${esc(prev[i] ?? (i === 0 ? me : ''))}">
        </label>`).join('');
      body.querySelector('#cN').textContent = n;
    };
    draw();
    body.querySelector('#cMinus').addEventListener('click', () => { if (n > 2) { n--; draw(); buzz(6); } });
    body.querySelector('#cPlus').addEventListener('click', () => { if (n < 20) { n++; draw(); buzz(6); } });
    body.querySelector('#cEmoji').addEventListener('click', e => {
      const b = e.target.closest('.emoji-opt'); if (!b) return;
      body.querySelectorAll('.emoji-opt').forEach(x => x.classList.toggle('on', x === b));
      emoji = b.dataset.e;
    });
    body.querySelector('#cName').focus();
    body.querySelector('#cGo').addEventListener('click', async e => {
      const name = body.querySelector('#cName').value.trim();
      const names = [...namesBox.querySelectorAll('input')].map((i, k) => i.value.trim() || `成員${k + 1}`);
      if (!name) { body.querySelector('#cName').focus(); toast('幫分帳表取個名字吧'); return; }
      if (new Set(names).size !== names.length) { toast('成員名字不能重複'); return; }
      const emails = parseEmails(body.querySelector('#cShare').value);
      if (emails === null) { toast('Email 格式不太對'); return; }
      const members = names.map((nm, i) => ({ id: uid('m'), name: nm, color: PALETTE[i % PALETTE.length] }));
      const ref = doc(collection(db, COLL));
      e.target.disabled = true;
      try {
        await setDoc(ref, {
          name, emoji, currency: body.querySelector('#cCur').value,
          owner: S.user.uid, ownerName: S.user.displayName || S.user.email,
          access: [S.user.email, ...emails.filter(x => x !== S.user.email)],
          members, expenses: {},
          createdMs: Date.now(), updatedAt: serverTimestamp(),
        });
        store.set(meKey(ref.id), members[0].id);
        closeSheet();
        confetti({ n: 90 });
        buzz(20);
        openTable(ref.id);
      } catch (err) { console.error(err); toast('建立失敗：' + (err.code || err.message)); e.target.disabled = false; }
    });
  });
});

function parseEmails(text) {
  const list = String(text || '').split(/[\s,;，、]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.some(s => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))) return null;
  return [...new Set(list)];
}

/* ── Table view ───────────────────────────────────────────────── */
function renderTable() {
  const t = curTable(); if (!t) return;
  const st = L.stats(t);
  const bal = L.balances(t);
  const c = t.currency;
  $('tTitle').innerHTML = `<span class="tt-emoji">${esc(t.emoji || '✈️')}</span>${esc(t.name)}`;
  countUp($('heroTotal'), st.total, v => L.fmt(v, c));
  const n = t.members?.length || 1;
  $('heroSub').textContent = `${st.count} 筆 · 人均 ${L.fmt(Math.round(st.total / n), c)}`;

  const me = myMember(t);
  if (me) {
    const net = bal[me.id]?.net || 0;
    $('heroMe').innerHTML = net > 0
      ? `${avatar(me, 'xs')} 你可以收回 <b class="pos">${esc(L.fmt(net, c))}</b>`
      : net < 0
        ? `${avatar(me, 'xs')} 你還需要付 <b class="neg">${esc(L.fmt(-net, c))}</b>`
        : `${avatar(me, 'xs')} 你目前收支平衡 👌`;
  } else {
    $('heroMe').innerHTML = `<button type="button" class="chip-btn" id="pickMe">我是誰？點這裡設定</button>`;
    $('pickMe').addEventListener('click', () => pickMeSheet(t));
  }
  $('heroMembers').innerHTML = (t.members || []).map(m => {
    const net = bal[m.id]?.net || 0;
    return `<span class="hm${me?.id === m.id ? ' me' : ''}">${avatar(m)}
      <span class="hm-name">${esc(m.name)}</span>
      <span class="hm-net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${net > 0 ? '+' : net < 0 ? '−' : ''}${esc(L.fmtNum(Math.abs(net), c))}</span></span>`;
  }).join('');

  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'p' + S.tab[0].toUpperCase() + S.tab.slice(1)));
  moveInk();
  $('btnAdd').classList.toggle('hide', S.tab === 'settle');

  renderListPanel(t);
  renderSummaryPanel(t, bal, st);
  renderSettlePanel(t, bal);
}

function moveInk() {
  const a = document.querySelector('.tab.active'); const ink = $('tabInk');
  if (!a) return;
  ink.style.width = a.offsetWidth + 'px';
  ink.style.transform = `translateX(${a.offsetLeft}px)`;
}
addEventListener('resize', moveInk);
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  if (S.tab === b.dataset.tab) return;
  S.tab = b.dataset.tab; buzz(5); renderTable();
}));

function pickMeSheet(t) {
  openSheet(`
    <h2 class="sheet-title">你是哪一位？</h2>
    <p class="muted">只存在這台裝置，用來顯示「你還需要付多少」。</p>
    <div class="pick-grid">${t.members.map(m =>
      `<button type="button" class="pick" data-id="${esc(m.id)}">${avatar(m, 'lg')}<span>${esc(m.name)}</span></button>`).join('')}</div>`,
  body => body.querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => {
    store.set(meKey(t.id), b.dataset.id); closeSheet(); buzz(10); renderTable();
  })));
}

/* 明細 */
function renderListPanel(t) {
  const c = t.currency;
  const entries = Object.entries(t.expenses || {})
    .filter(([, e]) => e && e.amount > 0)
    .filter(([id, e]) => !S.filter || e.payer === S.filter || e.to === S.filter
      || Object.keys(L.sharesOf(e, id)).includes(S.filter))
    .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  const chips = `<div class="filter-row">
    <button type="button" class="fchip${S.filter ? '' : ' on'}" data-f="">全部</button>
    ${t.members.map(m => `<button type="button" class="fchip${S.filter === m.id ? ' on' : ''}" data-f="${esc(m.id)}" style="--c:${esc(m.color)}">${esc(m.name)}</button>`).join('')}
  </div>`;
  let html = chips;
  if (!Object.keys(t.expenses || {}).length) {
    html += `<div class="empty"><div class="empty-art bob">🧾</div><p><b>記下第一筆吧</b></p>
      <p class="muted">金額、項目、誰付的，三秒就記好。<br>日期時間會自動帶入現在。</p></div>`;
  } else if (!entries.length) {
    html += `<div class="empty small"><p class="muted">這個人還沒有相關紀錄</p></div>`;
  } else {
    const groups = new Map();
    entries.forEach(en => {
      const k = L.dayKey(en[1].ts, en[1].tz);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(en);
    });
    html += [...groups].map(([k, rows]) => {
      const sum = rows.reduce((s, [, e]) => s + (e.kind === 'transfer' ? 0 : e.amount), 0);
      return `<div class="day">
        <div class="day-head"><span>${dayLabel(k)}</span><span>${esc(L.fmt(sum, c))}</span></div>
        ${rows.map(([id, e]) => rowHtml(t, id, e)).join('')}
      </div>`;
    }).join('');
  }
  const p = $('pList');
  p.innerHTML = html;
  p.querySelectorAll('.fchip').forEach(b => b.addEventListener('click', () => { S.filter = b.dataset.f; renderListPanel(t); }));
  p.querySelectorAll('.row').forEach(r => r.addEventListener('click', () => expenseSheet(t, r.dataset.id)));
}

function rowHtml(t, id, e) {
  const c = t.currency;
  const payer = memberOf(t, e.payer);
  if (e.kind === 'transfer') {
    const to = memberOf(t, e.to);
    return `<button type="button" class="row row-transfer" data-id="${esc(id)}">
      <span class="row-ic">💸</span>
      <span class="row-main"><span class="row-title">${esc(payer.name)} 還給 ${esc(to.name)}</span>
      <span class="row-sub">${timeOf(e)} · 還款紀錄</span></span>
      <span class="row-amt">${esc(L.fmt(e.amount, c))}</span></button>`;
  }
  const cat = L.catOf(e.cat);
  const sh = Object.keys(L.sharesOf(e, id));
  const who = sh.length === t.members.length ? '全員' : sh.map(m => memberOf(t, m).name).join('、');
  return `<button type="button" class="row" data-id="${esc(id)}">
    <span class="row-ic">${cat.emoji}</span>
    <span class="row-main"><span class="row-title">${esc(e.title || cat.label)}</span>
    <span class="row-sub">${timeOf(e)} · ${avatar(payer, 'xs')} ${esc(payer.name)} 付 · 分給 ${esc(who)}${e.custom ? '（自訂）' : ''}</span></span>
    <span class="row-amt">${esc(L.fmt(e.amount, c))}</span></button>`;
}

/* 統整 */
function renderSummaryPanel(t, bal, st) {
  const c = t.currency;
  const p = $('pSummary');
  if (!st.count) { p.innerHTML = `<div class="empty"><div class="empty-art">📊</div><p class="muted">有紀錄之後，這裡會整理每個人付了什麼。</p></div>`; return; }
  const maxAbs = Math.max(1, ...Object.values(bal).map(b => Math.abs(b.net)));
  const exps = Object.entries(t.expenses || {}).filter(([, e]) => e && e.kind !== 'transfer' && e.amount > 0)
    .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));

  const people = t.members.map(m => {
    const b = bal[m.id] || { paid: 0, share: 0, net: 0, sent: 0, recv: 0 };
    const paidList = exps.filter(([, e]) => e.payer === m.id);
    const w = Math.abs(b.net) / maxAbs * 50;
    const open = S.openMembers.has(m.id);
    return `<div class="pcard${open ? ' open' : ''}" data-id="${esc(m.id)}">
      <button type="button" class="pcard-head">
        ${avatar(m)}
        <span class="pcard-name">${esc(m.name)}<small>付了 ${paidList.length} 筆</small></span>
        <span class="pcard-nums">
          <span>已付 <b>${esc(L.fmt(b.paid, c))}</b></span>
          <span>應分攤 <b>${esc(L.fmt(b.share, c))}</b></span>
        </span>
      </button>
      <div class="netbar"><span class="netbar-mid"></span>
        <span class="netbar-fill ${b.net >= 0 ? 'pos' : 'neg'}" style="--w:${w}%"></span></div>
      <div class="pcard-net ${b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : ''}">${b.net > 0 ? '應收 ' : b.net < 0 ? '應付 ' : '已平衡 '}${b.net ? esc(L.fmt(Math.abs(b.net), c)) : ''}
        ${b.sent || b.recv ? `<small>（含還款 ${b.sent ? '付出 ' + esc(L.fmt(b.sent, c)) : ''}${b.sent && b.recv ? '、' : ''}${b.recv ? '收到 ' + esc(L.fmt(b.recv, c)) : ''}）</small>` : ''}</div>
      <div class="pcard-body"><div>
        ${paidList.length ? paidList.map(([, e]) => `<div class="mini">
          <span>${L.catOf(e.cat).emoji} ${esc(e.title || L.catOf(e.cat).label)}</span>
          <span class="muted">${dayLabel(L.dayKey(e.ts, e.tz))}</span>
          <b>${esc(L.fmt(e.amount, c))}</b></div>`).join('') : '<p class="muted">還沒有付過錢 😇</p>'}
      </div></div>
    </div>`;
  }).join('');

  const cats = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]);
  const catColors = { food: '#D9644A', traffic: '#4F7FB8', stay: '#8E6BBF', ticket: '#E8A33D', shop: '#C2577F', drink: '#3A9C9C', other: '#9B7E68' };
  const catBar = cats.map(([k, v]) => `<span style="flex:${v};background:${catColors[k] || '#999'}" title="${esc(L.catOf(k).label)}"></span>`).join('');
  const catList = cats.map(([k, v]) => `<div class="cat-li"><i style="background:${catColors[k] || '#999'}"></i>
    <span>${L.catOf(k).emoji} ${L.catOf(k).label}</span><span class="muted">${Math.round(v / st.total * 100)}%</span><b>${esc(L.fmt(v, c))}</b></div>`).join('');

  const days = Object.entries(st.byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const maxDay = Math.max(1, ...days.map(d => d[1]));
  const dayBars = days.map(([k, v], i) => `<div class="dbar" style="--h:${Math.max(4, v / maxDay * 100)}%;--i:${i}">
    <span class="dbar-v">${esc(L.fmtNum(v, c))}</span><span class="dbar-col"></span><span class="dbar-k">${dayLabel(k).replace(/（.）/, '')}</span></div>`).join('');

  p.innerHTML = `
    <h3 class="sec">每個人 <small>點開看誰付了哪些</small></h3>
    <div class="people">${people}</div>
    <h3 class="sec">花在哪裡</h3>
    <div class="card"><div class="catbar">${catBar}</div>${catList}</div>
    <h3 class="sec">每日花費</h3>
    <div class="card"><div class="dbars">${dayBars}</div></div>`;
  p.querySelectorAll('.pcard-head').forEach(h => h.addEventListener('click', () => {
    const card = h.closest('.pcard'); const id = card.dataset.id;
    if (S.openMembers.has(id)) S.openMembers.delete(id); else S.openMembers.add(id);
    card.classList.toggle('open');
  }));
}

/* 結算 */
function renderSettlePanel(t, bal) {
  const c = t.currency;
  const p = $('pSettle');
  const st = L.stats(t);
  if (!st.count) { p.innerHTML = `<div class="empty"><div class="empty-art">🧮</div><p class="muted">先記幾筆帳，再來結算。</p></div>`; return; }
  const plan = L.settle(bal);
  if (!plan.length) {
    p.innerHTML = `<div class="done-card"><div class="done-art">🎉</div><h3>全員結清！</h3>
      <p class="muted">沒有人欠誰，可以安心規劃下一趟旅行了。</p>
      <button type="button" class="btn btn-ghost" id="btnParty">再放一次彩帶</button></div>`;
    p.querySelector('#btnParty').addEventListener('click', () => { confetti(); buzz(30); });
    return;
  }
  if (!S.settleShown) {
    p.innerHTML = `<div class="settle-start">
      <div class="ss-stack" aria-hidden="true">${t.members.slice(0, 5).map((m, i) => `<span style="--i:${i}">${avatar(m, 'lg')}</span>`).join('')}</div>
      <p>${t.members.length} 個人、${st.count} 筆帳<br>最少只要 <b>${plan.length}</b> 筆轉帳就能結清</p>
      <button type="button" class="btn btn-primary btn-lg btn-settle" id="btnSettle"><span class="bs-ic">🧮</span> 開始結算</button></div>`;
    p.querySelector('#btnSettle').addEventListener('click', e => {
      e.currentTarget.classList.add('spin');
      buzz([10, 40, 10]);
      setTimeout(() => { S.settleShown = true; S.settleAnim = true; renderSettlePanel(curTable(), L.balances(curTable())); }, 650);
    });
    return;
  }
  const anim = S.settleAnim; S.settleAnim = false;
  p.innerHTML = `
    <p class="settle-hint">照下面轉帳就能結清。付完按「已付款」，結果會即時同步給大家。</p>
    <div class="transfers">${plan.map((x, i) => {
      const f = memberOf(t, x.from), to = memberOf(t, x.to);
      return `<div class="xfer${anim ? ' in' : ''}" style="--i:${i}" data-i="${i}">
        <div class="xfer-who"><span class="xa">${avatar(f, 'lg')}<b>${esc(f.name)}</b></span>
          <span class="xfer-arrow"><span class="xfer-amt">${esc(L.fmt(x.amount, c))}</span><span class="xfer-line"><i>🪙</i></span></span>
          <span class="xb">${avatar(to, 'lg')}<b>${esc(to.name)}</b></span></div>
        <button type="button" class="btn btn-primary btn-paid">✓ 已付款</button>
      </div>`;
    }).join('')}</div>
    <div class="settle-tools">
      <button type="button" class="btn btn-ghost" id="btnCopy">📋 複製結算結果</button>
      ${navigator.share ? '<button type="button" class="btn btn-ghost" id="btnShare">📤 分享</button>' : ''}
    </div>`;
  const text = () => `【${t.emoji || ''}${t.name}】分帳結算\n總支出 ${L.fmt(st.total, c)}\n` +
    plan.map(x => `${memberOf(t, x.from).name} → ${memberOf(t, x.to).name}  ${L.fmt(x.amount, c)}`).join('\n');
  p.querySelector('#btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text()); toast('已複製，貼到群組吧'); buzz(10); }
    catch { toast('複製失敗，請手動選取'); }
  });
  p.querySelector('#btnShare')?.addEventListener('click', () => navigator.share({ text: text() }).catch(() => {}));
  p.querySelectorAll('.xfer').forEach(card => card.querySelector('.btn-paid').addEventListener('click', async ev => {
    const x = plan[Number(card.dataset.i)];
    ev.currentTarget.disabled = true;
    buzz(15);
    await coins(card.querySelector('.xa .av'), card.querySelector('.xb .av'), { n: 7 });
    card.classList.add('out');
    try {
      await writeExpense(t.id, uid('x'), { kind: 'transfer', amount: x.amount, payer: x.from, to: x.to, ts: Date.now(), tz: DEVICE_TZ });
      const left = L.settle(L.balances(curTable()));
      if (!left.length) { confetti({ n: 220 }); buzz([20, 60, 20, 60, 40]); }
    } catch (err) { toast('寫入失敗：' + (err.code || err.message)); card.classList.remove('out'); ev.currentTarget.disabled = false; }
  }));
}

/* ── Expense add / edit ───────────────────────────────────────── */
async function writeExpense(tableId, id, rec) {
  await updateDoc(doc(db, COLL, tableId), {
    [`expenses.${id}`]: { ...rec, by: S.user.email, at: Date.now() },
    updatedAt: serverTimestamp(),
  });
}
async function removeExpense(tableId, id) {
  await updateDoc(doc(db, COLL, tableId), { [`expenses.${id}`]: deleteField(), updatedAt: serverTimestamp() });
}

$('btnAdd').addEventListener('click', () => { const t = curTable(); if (t) expenseSheet(t, null); });
// Desktop shortcut: press N on a table to add an expense.
addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (sheetWrap.classList.contains('open') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  const t = S.cur && curTable(); if (t) { e.preventDefault(); expenseSheet(t, null); }
});

function expenseSheet(t, id) {
  const old = id ? t.expenses[id] : null;
  const c = t.currency, dec = L.cur(c).dec;
  if (old?.kind === 'transfer') {
    const f = memberOf(t, old.payer), to = memberOf(t, old.to);
    openSheet(`<h2 class="sheet-title">還款紀錄</h2>
      <div class="xfer-who static"><span class="xa">${avatar(f, 'lg')}<b>${esc(f.name)}</b></span>
        <span class="xfer-arrow"><span class="xfer-amt">${esc(L.fmt(old.amount, c))}</span><span class="xfer-line"></span></span>
        <span class="xb">${avatar(to, 'lg')}<b>${esc(to.name)}</b></span></div>
      <p class="muted center">${esc(new Date(old.ts).toLocaleString('zh-TW', { timeZone: L.validTz(old.tz) ? old.tz : DEVICE_TZ }))}（${esc(L.tzName(L.validTz(old.tz) ? old.tz : DEVICE_TZ))}）</p>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-close>關閉</button>
      <button type="button" class="btn btn-danger" id="eDel">刪除這筆還款</button></div>`, body => {
      armDelete(body.querySelector('#eDel'), async () => { closeSheet(); await removeExpense(t.id, id); toast('已刪除'); });
    });
    return;
  }
  const lastPayer = store.get(`split_last_${t.id}`);
  const me = myMember(t);
  const st = {
    payer: old?.payer || (t.members.find(m => m.id === lastPayer) ? lastPayer : me?.id || t.members[0].id),
    among: new Set(old ? Object.keys(L.sharesOf(old, id)) : t.members.map(m => m.id)),
    cat: old?.cat || '',
    catTouched: !!old,
    custom: !!old?.custom,
  };
  const customVals = old?.custom || {};
  // Zone: editing keeps the stored zone; new entries use this table's sticky
  // choice ('' = follow the device, i.e. auto-detect).
  const tzPref = old ? (L.validTz(old.tz) ? old.tz : '') : (L.validTz(store.get(tzPrefKey(t.id))) ? store.get(tzPrefKey(t.id)) : '');
  let tzSel = tzPref;
  const effTz = () => tzSel || DEVICE_TZ;
  let timeTouched = !!old;

  openSheet(`
    <h2 class="sheet-title">${old ? '編輯這筆' : '記一筆'}</h2>
    <div class="amount-in"><span class="cur-sym">${esc(L.cur(c).sym)}</span>
      <input id="eAmt" inputmode="decimal" autocomplete="off" placeholder="0" value="${old ? esc(L.fmtNum(old.amount, c).replace(/,/g, '')) : ''}"></div>
    <label class="field"><span>款項</span>
      <input id="eTitle" maxlength="40" placeholder="例如：一蘭拉麵、計程車" value="${esc(old?.title || '')}" autocomplete="off"></label>
    <div class="cat-row" id="eCat">${L.CATEGORIES.map(k =>
      `<button type="button" class="cat-opt" data-c="${k.id}"><span>${k.emoji}</span>${k.label}</button>`).join('')}</div>
    <div class="field-2">
      <label class="field"><span>日期時間 <button type="button" class="link-btn" id="eNow">設為現在</button></span>
        <input id="eTs" type="datetime-local" value="${L.tsToWall(old?.ts || Date.now(), effTz())}"></label>
      <label class="field"><span>時區</span>
        <select id="eTz">${tzOptions(tzSel)}</select></label>
    </div>
    <div class="field"><span>誰付的</span>
      <div class="who-row" id="ePayer">${t.members.map(m =>
        `<button type="button" class="who" data-id="${esc(m.id)}">${avatar(m)}<span>${esc(m.name)}</span></button>`).join('')}</div></div>
    <div class="field"><span>分給誰
      <span class="seg" id="eMode"><button type="button" data-m="eq">均分</button><button type="button" data-m="cu">自訂金額</button></span></span>
      <div class="who-row multi" id="eAmong">${t.members.map(m =>
        `<button type="button" class="who" data-id="${esc(m.id)}">${avatar(m)}<span>${esc(m.name)}</span></button>`).join('')}</div>
      <div class="custom-box" id="eCustom"></div>
      <div class="split-preview" id="ePrev"></div></div>
    <div class="sheet-actions">
      ${old ? '<button type="button" class="btn btn-danger-ghost" id="eDel">刪除</button>' : '<button type="button" class="btn btn-ghost" data-close>取消</button>'}
      <button type="button" class="btn btn-primary" id="eSave">${old ? '儲存' : '記下來'}</button>
    </div>`, body => {
    const amtIn = body.querySelector('#eAmt'), titleIn = body.querySelector('#eTitle');
    const amount = () => L.toMinor(amtIn.value, c);

    const paint = () => {
      body.querySelectorAll('#eCat .cat-opt').forEach(b => b.classList.toggle('on', b.dataset.c === st.cat));
      body.querySelectorAll('#ePayer .who').forEach(b => b.classList.toggle('on', b.dataset.id === st.payer));
      body.querySelectorAll('#eAmong .who').forEach(b => b.classList.toggle('on', st.among.has(b.dataset.id)));
      body.querySelectorAll('#eMode button').forEach(b => b.classList.toggle('on', (b.dataset.m === 'cu') === st.custom));
      const box = body.querySelector('#eCustom');
      if (st.custom) {
        const prev = Object.fromEntries([...box.querySelectorAll('input')].map(i => [i.dataset.id, i.value]));
        box.innerHTML = t.members.filter(m => st.among.has(m.id)).map(m => `<label class="cu">${avatar(m, 'sm')}<span>${esc(m.name)}</span>
          <input inputmode="decimal" data-id="${esc(m.id)}" placeholder="0" value="${esc(prev[m.id] ?? (customVals[m.id] != null ? L.fmtNum(customVals[m.id], c).replace(/,/g, '') : ''))}"></label>`).join('');
        box.querySelectorAll('input').forEach(i => i.addEventListener('input', preview));
      } else box.innerHTML = '';
      preview();
    };
    const customSum = () => [...body.querySelectorAll('#eCustom input')].reduce((s, i) => s + (L.toMinor(i.value || '0', c) || 0), 0);
    const preview = () => {
      const a = amount(), n = st.among.size, pv = body.querySelector('#ePrev');
      if (!(a > 0) || !n) { pv.textContent = n ? '' : '至少選一個人'; pv.className = 'split-preview' + (n ? '' : ' warn'); return; }
      if (st.custom) {
        const diff = a - customSum();
        pv.className = 'split-preview' + (diff ? ' warn' : ' ok');
        pv.textContent = diff ? (diff > 0 ? `還差 ${L.fmt(diff, c)}` : `超出 ${L.fmt(-diff, c)}`) : '金額剛好 ✓';
      } else {
        pv.className = 'split-preview';
        const each = a / n;
        pv.textContent = `每人約 ${L.cur(c).sym}${(each / 10 ** dec).toLocaleString('en-US', { maximumFractionDigits: dec })}`;
      }
    };

    amtIn.addEventListener('input', preview);
    titleIn.addEventListener('input', () => {
      if (st.catTouched) return;
      st.cat = guessCat(titleIn.value); paint();
    });
    body.querySelector('#eCat').addEventListener('click', e => {
      const b = e.target.closest('.cat-opt'); if (!b) return;
      st.cat = st.cat === b.dataset.c ? '' : b.dataset.c; st.catTouched = true; buzz(5); paint();
    });
    const tsIn = body.querySelector('#eTs');
    body.querySelector('#eNow').addEventListener('click', () => { tsIn.value = L.tsToWall(Date.now(), effTz()); timeTouched = false; buzz(5); });
    tsIn.addEventListener('input', () => { timeTouched = true; });
    // Changing zone: an untouched "now" is re-expressed in the new zone; a time
    // the user typed is kept as wall-clock (they typed the receipt's local time).
    body.querySelector('#eTz').addEventListener('change', e => {
      tzSel = e.target.value;
      if (!timeTouched) tsIn.value = L.tsToWall(Date.now(), effTz());
    });
    body.querySelector('#ePayer').addEventListener('click', e => {
      const b = e.target.closest('.who'); if (!b) return; st.payer = b.dataset.id; buzz(5); paint();
    });
    body.querySelector('#eAmong').addEventListener('click', e => {
      const b = e.target.closest('.who'); if (!b) return;
      const idm = b.dataset.id;
      if (st.among.has(idm)) st.among.delete(idm); else st.among.add(idm);
      buzz(5); paint();
    });
    body.querySelector('#eMode').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return; st.custom = b.dataset.m === 'cu'; paint();
    });
    paint();
    if (!old) setTimeout(() => amtIn.focus(), 250);
    body.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target === amtIn || e.target === titleIn)) {
        e.preventDefault(); body.querySelector('#eSave').click();
      }
    });

    const del = body.querySelector('#eDel');
    if (del) armDelete(del, async () => { closeSheet(); await removeExpense(t.id, id); toast('已刪除'); });

    body.querySelector('#eSave').addEventListener('click', async e => {
      const a = amount();
      if (!(a > 0)) { amtIn.focus(); amtIn.closest('.amount-in').classList.add('shake'); setTimeout(() => amtIn.closest('.amount-in').classList.remove('shake'), 400); return; }
      if (!st.among.size) { toast('至少選一個人分攤'); return; }
      const wall = L.wallToTs(tsIn.value, effTz());
      const ts = Number.isFinite(wall) ? wall : Date.now();
      const rec = {
        kind: 'expense', amount: a, title: titleIn.value.trim(), cat: st.cat || 'other',
        ts, tz: effTz(), payer: st.payer, among: t.members.filter(m => st.among.has(m.id)).map(m => m.id),
      };
      if (st.custom) {
        const cu = {};
        body.querySelectorAll('#eCustom input').forEach(i => { const v = L.toMinor(i.value || '0', c) || 0; if (v > 0) cu[i.dataset.id] = v; });
        if (Object.values(cu).reduce((s, v) => s + v, 0) !== a) { toast('自訂金額加總要等於總金額'); return; }
        rec.custom = cu;
        rec.among = Object.keys(cu);
      }
      e.currentTarget.disabled = true;
      store.set(`split_last_${t.id}`, st.payer);
      if (!old) store.set(tzPrefKey(t.id), tzSel);
      const fab = $('btnAdd');
      closeSheet();
      try {
        const p = writeExpense(t.id, id || uid('e'), rec);
        buzz(15);
        if (!old) coins(fab, $('heroTotal'), { n: 6 });
        await p;
        if (!old) toast(`已記下 ${L.fmt(a, c)} 🪙`);
      } catch (err) { console.error(err); toast('儲存失敗：' + (err.code || err.message)); }
    });
  });
}

// Two-tap delete: first tap arms (button turns red + text changes), second confirms.
function armDelete(btn, action) {
  let armed = false;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true; btn.classList.add('armed'); btn.dataset.txt = btn.textContent; btn.textContent = '再按一次確認刪除';
      buzz(20);
      setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.textContent = btn.dataset.txt; }, 3000);
      return;
    }
    action();
  });
}

/* ── Table settings ───────────────────────────────────────────── */
$('btnTableMenu').addEventListener('click', () => { const t = curTable(); if (t) settingsSheet(t); });

function settingsSheet(t) {
  const isOwner = t.owner === S.user.uid;
  const used = new Set();
  Object.entries(t.expenses || {}).forEach(([id, e]) => {
    used.add(e.payer); if (e.to) used.add(e.to);
    Object.keys(L.sharesOf(e, id)).forEach(m => used.add(m));
  });
  const hasExp = Object.keys(t.expenses || {}).length > 0;
  let members = t.members.map(m => ({ ...m }));
  let emoji = t.emoji || EMOJIS[0];
  const me = myMember(t);

  openSheet(`
    <h2 class="sheet-title">分帳表設定</h2>
    <label class="field"><span>名稱</span><input id="sName" maxlength="40" value="${esc(t.name)}"></label>
    <div class="field"><span>圖示</span><div class="emoji-row" id="sEmoji">${EMOJIS.map(e =>
      `<button type="button" class="emoji-opt${e === emoji ? ' on' : ''}" data-e="${e}">${e}</button>`).join('')}</div></div>
    <label class="field"><span>幣別 ${hasExp ? '<em>已有紀錄，不能更改</em>' : ''}</span>
      <select id="sCur" ${hasExp ? 'disabled' : ''}>${Object.entries(L.CURRENCIES).map(([k, v]) =>
        `<option value="${k}" ${k === t.currency ? 'selected' : ''}>${v.label}（${k}）</option>`).join('')}</select></label>
    <div class="field"><span>我是誰 <em>只存在這台裝置</em></span>
      <button type="button" class="chip-btn" id="sMe">${me ? `${avatar(me, 'xs')} ${esc(me.name)}（點此更改）` : '尚未設定，點此選擇'}</button></div>
    <div class="field"><span>成員</span><div class="names" id="sMembers"></div>
      <div class="add-row"><input id="sNew" maxlength="16" placeholder="新增成員名字"><button type="button" class="btn btn-ghost" id="sAdd">加入</button></div></div>
    <label class="field"><span>共同編輯者 Gmail ${isOwner ? '' : '<em>只有建立者能修改</em>'}</span>
      <textarea id="sShare" rows="2" ${isOwner ? '' : 'disabled'} placeholder="friend@gmail.com">${esc((t.access || []).filter(x => x !== S.user.email || !isOwner).join(', '))}</textarea></label>
    <p class="muted small">建立者：${esc(t.ownerName || '')}</p>
    <div class="sheet-actions">
      <button type="button" class="btn btn-ghost" data-close>取消</button>
      <button type="button" class="btn btn-primary" id="sSave">儲存</button>
    </div>
    ${isOwner ? `<div class="danger-zone"><button type="button" class="btn btn-danger-ghost" id="sDel">刪除這張分帳表</button></div>` : ''}`, body => {
    const box = body.querySelector('#sMembers');
    const draw = () => {
      box.innerHTML = members.map((m, i) => `<label class="name-in">${avatar(m, 'sm')}
        <input data-i="${i}" maxlength="16" value="${esc(m.name)}">
        ${used.has(m.id) ? '' : `<button type="button" class="x" data-rm="${i}" aria-label="移除">✕</button>`}</label>`).join('');
      box.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { members[inp.dataset.i].name = inp.value; }));
      box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
        if (members.length <= 1) return; members.splice(Number(b.dataset.rm), 1); draw();
      }));
    };
    draw();
    const add = () => {
      const inp = body.querySelector('#sNew'); const nm = inp.value.trim(); if (!nm) return;
      const taken = new Set(members.map(m => m.color));
      members.push({ id: uid('m'), name: nm, color: PALETTE.find(p => !taken.has(p)) || PALETTE[members.length % PALETTE.length] });
      inp.value = ''; draw(); buzz(8);
    };
    body.querySelector('#sAdd').addEventListener('click', add);
    body.querySelector('#sNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    body.querySelector('#sEmoji').addEventListener('click', e => {
      const b = e.target.closest('.emoji-opt'); if (!b) return;
      body.querySelectorAll('#sEmoji .emoji-opt').forEach(x => x.classList.toggle('on', x === b)); emoji = b.dataset.e;
    });
    body.querySelector('#sMe').addEventListener('click', () => pickMeSheet(t));

    body.querySelector('#sSave').addEventListener('click', async e => {
      const name = body.querySelector('#sName').value.trim();
      members = members.map(m => ({ ...m, name: m.name.trim() }));
      if (!name) { toast('名稱不能空白'); return; }
      if (members.some(m => !m.name)) { toast('成員名字不能空白'); return; }
      if (new Set(members.map(m => m.name)).size !== members.length) { toast('成員名字不能重複'); return; }
      const patch = { name, emoji, members, updatedAt: serverTimestamp() };
      if (!hasExp) patch.currency = body.querySelector('#sCur').value;
      if (isOwner) {
        const emails = parseEmails(body.querySelector('#sShare').value);
        if (emails === null) { toast('Email 格式不太對'); return; }
        patch.access = [S.user.email, ...emails.filter(x => x !== S.user.email)];
      }
      e.currentTarget.disabled = true;
      try { await updateDoc(doc(db, COLL, t.id), patch); closeSheet(); toast('已儲存'); }
      catch (err) { toast('儲存失敗：' + (err.code || err.message)); e.currentTarget.disabled = false; }
    });

    const del = body.querySelector('#sDel');
    if (del) armDelete(del, async () => {
      closeSheet();
      try {
        await deleteDoc(doc(db, COLL, t.id));
        history.replaceState(null, '', location.pathname);
        route();
        toast(`已刪除「${t.name}」`);
      } catch (err) { toast('刪除失敗：' + (err.code || err.message)); }
    });
  });
}
