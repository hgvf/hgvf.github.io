# 自動化：供應鏈新聞（每日）＋ 財報分析（手動）

本站有兩個由 Claude 維護的區塊：

| 區塊 | 目錄 | 更新方式 | 誰維護 |
|------|------|----------|--------|
| 供應鏈瓶頸新聞 | `supply-chain/` | **每日自動** | Claude Code **Routine**（排程） |
| 財報電話會議分析 | `earnings/` | **手動** | Claude Code **web session**（你觸發） |

兩者各自 commit 到不同目錄，靠 Git 協調，永遠不會互相衝突。GitHub Pages 服務 `main` 分支根目錄，push 後即上線。

> 皆使用 **claude.ai 訂閱額度**，不需要 Claude API。

---

## A. 供應鏈新聞 — 設定 Routine（一次性）

在 **[claude.ai/code/routines](https://claude.ai/code/routines) → New routine**（或任一 CLI session 打 `/schedule`）：

1. **Repository**：`hgvf/hgvf.github.io`
2. **Trigger → Schedule → Daily**，挑當地早上、避開 `12:00 UTC`（firestore sync 時間），例如台北 **08:07**。
3. **環境 → Network access → Full**（或 Custom 加新聞網域）。
   預設 *Trusted* 會擋掉抓任意新聞網站（`403 host_not_allowed`），一定要改。
4. **Permissions → 開啟「Allow unrestricted branch pushes」** for this repo（才能直接 push `main`）。
5. **Prompt**：貼下方那段。
6. **Create** → 可先按 **Run now** 測一次，點進 run 確認有抓到新聞、有 push。

### Routine prompt（直接複製）

```
You maintain the supply-chain news section of the hgvf.github.io static site.
Do ONLY the following, and ONLY touch files under supply-chain/:

1. Use WebSearch (and WebFetch for detail) to find today's most important
   supply-chain bottleneck news: shipping/port congestion, semiconductor and
   component shortages, freight rates, key-material supply disruptions,
   export controls affecting supply. Focus on the last 24-48 hours.
2. Select the 5-8 most material items. For each: headline, 1-2 sentence
   summary in Traditional Chinese, why it matters for supply chains, and the
   source link.
3. Write supply-chain/YYYY-MM-DD.html (today's date, Asia/Taipei) by copying
   the structure of the existing supply-chain/2026-07-28.html placeholder:
   reuse ../css/style.css, keep the same layout, fill the items between the
   ITEMS_START / ITEMS_END markers, and remove the yellow placeholder banner.
4. Update supply-chain/index.html: add today's entry as the FIRST child inside
   the DIGEST_LIST_START / DIGEST_LIST_END block (newest first), keeping all
   existing entries. Use the same <a class="glass-card digest-item"> markup.
5. Commit directly to main with message "chore: supply-chain digest YYYY-MM-DD"
   and push. If the push is rejected, run `git pull --rebase` then push again.
6. Do NOT modify any file outside supply-chain/. Do NOT open a pull request.
```

### 管理
- 暫停：routine 詳情頁 **Repeats** 的開關。
- 改時間 / 改 prompt：**Edit routine**，或 CLI `/schedule update`。
- 手動補跑：**Run now**。

---

## B. 財報分析 — 手動流程（每份 transcript 一次）

開一個 **Claude Code web session** 在 `hgvf/hgvf.github.io` 上，貼上／上傳 transcript，說：

> 分析這份 transcript，依 `earnings/_template.html` 的版面產生
> `earnings/<公司>-<季度>.html`（例如 `earnings/TSMC-2026Q2.html`），
> 節錄：一句話總結、營運財務重點、財測展望、**供應鏈訊號**、風險。
> 然後在 `earnings/index.html` 的 CALL_LIST 區塊最上面新增一條連結
> （若還是「尚無分析」的空狀態就整個取代掉）。commit 到 main 並 push。

一站式：同一個 session 完成分析 + 產生 HTML + push。

> 若想沿用你現有的 claude.ai **Project**：在 Project 裡分析完，把成品貼進一個 Claude Code web session 轉 HTML 並 push（Project 聊天本身無法 push GitHub）。

---

## 檔案結構

```
supply-chain/
  index.html         # 總覽，DIGEST_LIST_START/END 之間插每日條目
  2026-07-28.html    # 每日頁範本（placeholder）
earnings/
  index.html         # 總覽，CALL_LIST_START/END 之間插每份分析
  _template.html     # 每份分析的版面範本
```

首頁 `index.html` 側欄「Reports」資料夾已加入兩個入口連結。
