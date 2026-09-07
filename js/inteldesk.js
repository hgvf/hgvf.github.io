// inteldesk.js — the 產業情報站 (Intel Desk) controller.
//
// A hand-curated monitoring dashboard for industry / community intel. There is
// NO JSON schema here on purpose — the user fills plain form fields so they can
// practise structuring trade-relevant information themselves. Each note is one
// event / information unit; its content bullets and future watch points can be
// bookmarked ("收藏") into the shared fact-tracking store, exactly like an
// earnings-call highlight, and the watchlist ticker cards show a 訊<n> badge
// counting the notes per symbol.

import { marked } from "https://cdn.jsdelivr.net/npm/marked@12/+esm";
import {
  getNotes, getNote, saveNote, removeNote, onIntelChange,
  newBulletId, normTickers,
} from "./intel.js";
import {
  factId, isFactTracked, saveFact, removeFact, onFactsChange, getFacts,
} from "./facts.js";
import { onAuth, esc, chartUrl, fmtDate } from "./reports.js";

marked.use({ breaks: true });
function md(text) {
  if (!text) return "";
  try { return marked.parse(String(text)).replace(/<img /g, '<img loading="lazy" '); }
  catch { return esc(text); }
}

// ─── Fact-bookmark helpers (shared with the facts page) ───────────────────
// A note may cover several tickers ("盡量一次一個" but multiple allowed). A
// bullet's bookmark therefore fans out to one tracked fact PER ticker, kept in
// lock-step: the toggle is "on" only when every ticker is tracked.
function factSeed(note, kind, text, ticker) {
  return {
    ticker,
    company: note.company || ticker,
    kind,
    title: text,
    state: "pending",
    source: {
      origin: "intel",
      label: note.source || "",
      url: note.source_url || "",
      note_id: note.id || "",
      date: note.date || "",
    },
  };
}
function bulletTracked(note, kind, text) {
  const tks = note.tickers || [];
  if (!tks.length) return false;
  return tks.every(t => isFactTracked(factId(t, kind, text)));
}
function toggleBulletBookmark(note, kind, text) {
  const tks = note.tickers || [];
  if (!tks.length || !text) return false;
  const want = !bulletTracked(note, kind, text);
  tks.forEach(t => {
    const id = factId(t, kind, text);
    if (want && !isFactTracked(id)) saveFact(factSeed(note, kind, text, t));
    else if (!want && isFactTracked(id)) removeFact(id);
  });
  return want;
}

export function mountIntelDesk({ root }) {
  let notes = getNotes();
  let isAdmin = false;
  let filterTicker = "";      // "" = all
  let queryStr = "";          // free-text search
  let composer = null;        // { mode:'new'|'edit', id } | null

  // Deep-link ?ticker= / #ticker= (from the 訊 badge or the facts back-link).
  (function preselect() {
    const q = new URLSearchParams(location.search).get("ticker");
    const h = (location.hash.match(/ticker=([^&]+)/) || [])[1];
    const t = (q || (h ? decodeURIComponent(h) : "") || "").trim().toUpperCase();
    if (t) filterTicker = t;
  })();

  root.innerHTML = `
    <section class="id-wrap">
      <div class="id-kpis" id="idKpis"></div>
      <div class="id-controls">
        <div class="id-filter">
          <span class="id-filter-ic">⌕</span>
          <input class="id-search" id="idSearch" type="text" placeholder="搜尋 ticker / 公司 / 內容…" spellcheck="false" />
          <span class="id-sel-wrap"><select class="id-select" id="idTickerSel"></select></span>
        </div>
        <button class="id-newbtn" id="idNewBtn" hidden>＋ 新增情報</button>
      </div>
      <div id="idComposer"></div>
      <div class="id-feed" id="idFeed"></div>
    </section>`;

  const kpisEl   = root.querySelector("#idKpis");
  const feedEl   = root.querySelector("#idFeed");
  const compEl   = root.querySelector("#idComposer");
  const searchEl = root.querySelector("#idSearch");
  const selEl    = root.querySelector("#idTickerSel");
  const newBtn   = root.querySelector("#idNewBtn");

  searchEl.value = queryStr;

  // ── KPIs ────────────────────────────────────────────────────────────────
  function renderKpis() {
    const tickers = new Set();
    let bullets = 0, watch = 0;
    notes.forEach(n => {
      (n.tickers || []).forEach(t => tickers.add(t));
      bullets += (n.bullets || []).length;
      watch += (n.watch || []).length;
    });
    const trackedIntel = getFacts().filter(f => f.source && f.source.origin === "intel").length;
    const tiles = [
      ["情報則數", notes.length, "累積記錄的事件 / 資訊單位"],
      ["覆蓋標的", tickers.size, "被情報提及的不重複 ticker"],
      ["內容節點", bullets, "可收藏成追蹤事實的 bullet"],
      ["未來看點", watch, "待觀察的後續發展"],
      ["已追蹤事實", trackedIntel, "本頁收藏進事實追蹤的假設"],
    ];
    kpisEl.innerHTML = tiles.map(([label, val, hint]) => `
      <div class="id-kpi" title="${esc(hint)}">
        <span class="id-kpi-v">${val}</span>
        <span class="id-kpi-l">${esc(label)}</span>
      </div>`).join("");
  }

  // ── Ticker filter <select> ────────────────────────────────────────────────
  function renderTickerSelect() {
    const tickers = [...new Set(notes.flatMap(n => n.tickers || []))].sort();
    if (filterTicker && !tickers.includes(filterTicker)) filterTicker = "";
    selEl.innerHTML =
      `<option value="">全部標的（${tickers.length}）</option>` +
      tickers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    selEl.value = filterTicker;
  }

  // ── Feed ──────────────────────────────────────────────────────────────────
  function matches(n) {
    if (filterTicker && !(n.tickers || []).includes(filterTicker)) return false;
    if (queryStr) {
      const hay = [
        (n.tickers || []).join(" "), n.company, n.source, n.notes_md,
        (n.bullets || []).map(b => b.text).join(" "),
        (n.watch || []).join(" "),
      ].join(" ").toLowerCase();
      if (!hay.includes(queryStr.toLowerCase())) return false;
    }
    return true;
  }

  function tickerChip(t) {
    return `<a class="id-tk" href="${esc(chartUrl(t))}" target="_blank" rel="noopener" title="在 TradingView 看 ${esc(t)}">${esc(t)}</a>`;
  }
  function collectBtn(note, kind, text) {
    const on = bulletTracked(note, kind, text);
    const dis = isAdmin ? "" : " disabled";
    const title = !isAdmin ? "登入白名單帳號後可收藏"
      : on ? "已收藏至事實追蹤（再按取消）" : "收藏為追蹤事實";
    return `<button class="id-fbm${on ? " on" : ""}" data-collect data-kind="${kind}"`
      + ` data-text="${esc(text)}"${dis} title="${esc(title)}" aria-label="收藏事實">${on ? "★" : "☆"}</button>`;
  }

  function noteCard(n) {
    const bullets = (n.bullets || []).map(b =>
      `<li class="id-bl">
        <span class="id-bl-dot">▹</span>
        <span class="id-bl-tx">${esc(b.text)}</span>
        ${collectBtn(n, "fact", b.text)}
      </li>`).join("");
    const watch = (n.watch || []).map(w =>
      `<li class="id-wl">
        <span class="id-wl-dot">◆</span>
        <span class="id-wl-tx">${esc(w)}</span>
        ${collectBtn(n, "watch", w)}
      </li>`).join("");
    const factLink = (n.tickers || []).length
      ? `<a class="id-factlink" href="../facts/index.html?ticker=${encodeURIComponent(n.tickers[0])}" title="查看 ${esc(n.tickers[0])} 事實追蹤">📌 事實追蹤</a>`
      : "";
    const srcHtml = n.source
      ? (n.source_url
          ? `<a class="id-src" href="${esc(n.source_url)}" target="_blank" rel="noopener">🔗 ${esc(n.source)}</a>`
          : `<span class="id-src">🗞 ${esc(n.source)}</span>`)
      : "";
    const admin = isAdmin
      ? `<div class="id-card-adm">
           <button class="id-icobtn" data-edit="${esc(n.id)}" title="編輯">✎</button>
           <button class="id-icobtn id-del" data-del="${esc(n.id)}" title="刪除">✕</button>
         </div>`
      : "";
    return `<article class="id-card" data-id="${esc(n.id)}">
      <div class="id-card-top">
        <div class="id-tks">${(n.tickers || []).map(tickerChip).join("") || '<span class="id-tk id-tk-none">未指定標的</span>'}</div>
        ${admin}
      </div>
      <div class="id-card-meta">
        ${n.company ? `<span class="id-co">${esc(n.company)}</span>` : ""}
        ${srcHtml}
        <span class="id-date">${n.date ? esc(fmtDate(n.date)) : ""}</span>
        ${factLink}
      </div>
      ${bullets ? `<ul class="id-bls">${bullets}</ul>` : ""}
      ${n.notes_md ? `<div class="id-md">${md(n.notes_md)}</div>` : ""}
      ${watch ? `<div class="id-watch"><div class="id-watch-h">🔮 未來看點</div><ul class="id-wls">${watch}</ul></div>` : ""}
    </article>`;
  }

  function renderFeed() {
    const list = notes.filter(matches);
    if (!list.length) {
      feedEl.innerHTML = `<div class="id-empty">${
        notes.length
          ? "沒有符合條件的情報，換個關鍵字或標的試試。"
          : (isAdmin ? "還沒有任何情報 — 點右上「＋ 新增情報」開始記錄你在社群看到的產業消息。"
                     : "目前尚無情報記錄。")
      }</div>`;
      return;
    }
    feedEl.innerHTML = list.map(noteCard).join("");
  }

  // ── Composer (new / edit) ─────────────────────────────────────────────────
  function bulletRow(text = "") {
    return `<div class="id-ed-row" data-bulletrow>
      <span class="id-ed-bullet">▹</span>
      <input class="id-ed-input" data-bullettext type="text" value="${esc(text)}" placeholder="一條內容重點（可重複新增）…" />
      <button type="button" class="id-ed-del" data-delrow title="刪除此條" aria-label="刪除">✕</button>
    </div>`;
  }
  function watchRow(text = "") {
    return `<div class="id-ed-row" data-watchrow>
      <span class="id-ed-bullet">◆</span>
      <input class="id-ed-input" data-watchtext type="text" value="${esc(text)}" placeholder="一項未來看點…" />
      <button type="button" class="id-ed-del" data-delrow title="刪除此項" aria-label="刪除">✕</button>
    </div>`;
  }

  function renderComposer() {
    if (!composer) { compEl.innerHTML = ""; return; }
    const editing = composer.mode === "edit";
    const n = editing ? (getNote(composer.id) || {}) : {};
    const bulletRows = (n.bullets || []).map(b => bulletRow(b.text)).join("") || bulletRow();
    const watchRows = (n.watch || []).map(watchRow).join("") || watchRow();
    compEl.innerHTML = `
      <form class="id-composer" data-composer>
        <div class="id-comp-head">
          <span class="id-comp-title">${editing ? "編輯情報" : "新增情報"}</span>
          <span class="id-comp-sub">每一筆是一個事件 / 資訊單位</span>
        </div>
        <div class="id-grid2">
          <label class="id-fld">
            <span class="id-fld-l">Ticker（可多個，逗號或空白分隔）</span>
            <input class="id-in" name="tickers" type="text" value="${esc((n.tickers || []).join(", "))}" placeholder="例：NVDA, TSM" spellcheck="false" />
          </label>
          <label class="id-fld">
            <span class="id-fld-l">公司名稱</span>
            <input class="id-in" name="company" type="text" value="${esc(n.company || "")}" placeholder="例：NVIDIA Corp" />
          </label>
          <label class="id-fld">
            <span class="id-fld-l">情報來源</span>
            <input class="id-in" name="source" type="text" value="${esc(n.source || "")}" placeholder="例：X @handle、Reddit、電子報…" />
          </label>
          <label class="id-fld">
            <span class="id-fld-l">來源連結（選填）</span>
            <input class="id-in" name="source_url" type="url" value="${esc(n.source_url || "")}" placeholder="https://…" spellcheck="false" />
          </label>
          <label class="id-fld">
            <span class="id-fld-l">記錄日期</span>
            <input class="id-in" name="date" type="date" value="${esc(n.date || new Date().toISOString().slice(0,10))}" />
          </label>
        </div>

        <div class="id-fld">
          <span class="id-fld-l">內容重點（bullet points · 每一條都可收藏）</span>
          <div class="id-ed-list" data-bulletlist>${bulletRows}</div>
          <button type="button" class="id-ghost" data-addbullet>＋ 新增一條內容</button>
        </div>

        <label class="id-fld">
          <span class="id-fld-l">彈性筆記（支援 Markdown，可直接貼上表格）</span>
          <textarea class="id-in id-ta" name="notes_md" rows="5" spellcheck="false" placeholder="| 項目 | 數字 |&#10;| --- | --- |&#10;| 出貨 | +20% |">${esc(n.notes_md || "")}</textarea>
          <span class="id-hint">支援 GitHub 風格 Markdown：表格、**粗體**、清單、連結…</span>
        </label>

        <div class="id-fld">
          <span class="id-fld-l">🔮 未來看點（每一項都可收藏成追蹤事實）</span>
          <div class="id-ed-list" data-watchlist>${watchRows}</div>
          <button type="button" class="id-ghost" data-addwatch>＋ 新增未來看點</button>
        </div>

        <div class="id-comp-actions">
          <button type="submit" class="id-btn">💾 ${editing ? "儲存變更" : "發布情報"}</button>
          <button type="button" class="id-btn ghost" data-cancel>取消</button>
          <span class="id-status" data-status></span>
        </div>
      </form>`;
    compEl.querySelector(".id-composer")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function collectForm() {
    const form = compEl.querySelector("[data-composer]");
    if (!form) return null;
    const val = name => (form.querySelector(`[name="${name}"]`)?.value || "").trim();
    const bullets = [...form.querySelectorAll("[data-bullettext]")]
      .map(i => i.value.trim()).filter(Boolean).map(text => ({ id: newBulletId(), text }));
    const watch = [...form.querySelectorAll("[data-watchtext]")]
      .map(i => i.value.trim()).filter(Boolean);
    return {
      tickers: normTickers(val("tickers")),
      company: val("company"),
      source: val("source"),
      source_url: val("source_url"),
      date: val("date"),
      bullets,
      watch,
      notes_md: form.querySelector('[name="notes_md"]')?.value || "",
    };
  }

  // ── Events ────────────────────────────────────────────────────────────────
  newBtn.addEventListener("click", () => { composer = { mode: "new" }; renderComposer(); });
  selEl.addEventListener("change", () => { filterTicker = selEl.value; renderFeed(); });
  searchEl.addEventListener("input", () => { queryStr = searchEl.value.trim(); renderFeed(); });

  // Composer interactions (add / delete rows, cancel, submit).
  compEl.addEventListener("click", async e => {
    if (e.target.closest("[data-addbullet]")) {
      compEl.querySelector("[data-bulletlist]").insertAdjacentHTML("beforeend", bulletRow());
      return;
    }
    if (e.target.closest("[data-addwatch]")) {
      compEl.querySelector("[data-watchlist]").insertAdjacentHTML("beforeend", watchRow());
      return;
    }
    const del = e.target.closest("[data-delrow]");
    if (del) { del.closest("[data-bulletrow], [data-watchrow]").remove(); return; }
    if (e.target.closest("[data-cancel]")) { composer = null; renderComposer(); return; }
  });
  compEl.addEventListener("submit", async e => {
    const form = e.target.closest("[data-composer]");
    if (!form) return;
    e.preventDefault();
    const status = form.querySelector("[data-status]");
    const data = collectForm();
    if (!data.tickers.length && !data.company) {
      status.className = "id-status err"; status.textContent = "請至少填入一個 ticker 或公司名稱。"; return;
    }
    if (!data.bullets.length && !data.notes_md.trim() && !data.watch.length) {
      status.className = "id-status err"; status.textContent = "請至少填入一條內容、筆記或未來看點。"; return;
    }
    status.className = "id-status"; status.textContent = "儲存中…";
    try {
      const seed = composer.mode === "edit" ? { ...data, id: composer.id } : data;
      saveNote(seed);           // optimistic; Firestore sync happens in背景
      composer = null;
      renderComposer();
    } catch (err) {
      status.className = "id-status err";
      status.textContent = "儲存失敗：" + (err.code === "permission-denied" ? "需以白名單管理員登入。" : err.message);
    }
  });

  // Feed interactions (edit / delete / collect).
  feedEl.addEventListener("click", e => {
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) { composer = { mode: "edit", id: editBtn.dataset.edit }; renderComposer(); return; }
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      const n = getNote(delBtn.dataset.del);
      if (n && confirm(`確定刪除這則情報${n.tickers?.length ? "（" + n.tickers.join(", ") + "）" : ""}？`)) removeNote(n.id);
      return;
    }
    const col = e.target.closest("[data-collect]");
    if (col) {
      if (col.disabled) return;
      const card = col.closest(".id-card");
      const n = getNote(card?.dataset.id);
      if (!n) return;
      const kind = col.dataset.kind, text = col.dataset.text;
      const on = toggleBulletBookmark(n, kind, text);
      col.classList.toggle("on", on);
      col.textContent = on ? "★" : "☆";
      col.title = on ? "已收藏至事實追蹤（再按取消）" : "收藏為追蹤事實";
      renderKpis();
      return;
    }
  });

  // ── Live store subscriptions ──────────────────────────────────────────────
  function full() { renderKpis(); renderTickerSelect(); renderFeed(); }
  onIntelChange(list => { notes = list; full(); });
  onFactsChange(() => { renderKpis(); renderFeed(); });   // reflect ★ state from other tabs / facts page
  onAuth(({ isAdmin: a }) => {
    isAdmin = a;
    newBtn.hidden = !a;
    if (!a && composer) { composer = null; renderComposer(); }
    renderFeed();
  });

  full();
}
