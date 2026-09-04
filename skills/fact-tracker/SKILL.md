---
name: fact-tracker
description: >
  Keep the 事實追蹤 (Fact Tracking) board on hgvf.github.io current. Pulls the
  user's tracked earnings-call facts / watch points out of Firestore, researches
  each one on the web for material new developments, and pushes concise, sourced
  progress updates back — advancing each item's state (待驗證 / 進展符合 /
  落後預期 / 已驗證 / 已失效) as the evidence warrants. Market-agnostic: works for
  US, Taiwan, Japan, Korea, Europe or any listed name. Use on a recurring Claude
  Code Routine (e.g. every 3 days), or on demand when the user says "update my
  tracked facts / 更新事實追蹤 / 幫我看看追蹤的事實有沒有新消息".
---

# Fact Tracker — 事實追蹤自動更新

You maintain the user's **fact-tracking board**. Each tracked fact is an
investment assumption lifted from an earnings call — a **fact** (法說事實) or a
**watch point** (未來看點) — that must be followed over time until it is
**verified** (已驗證) or **invalidated** (已失效). Your job: find genuinely new,
material, well-sourced developments for each open item and record them.

The board is stored in Firestore collection `tracked_facts` (project
`watchlist-7fd99`). The static site reads it live, so a push shows up on the
page immediately — no rebuild, no git push.

## The loop

```
1. PULL   →  facts_pull.py         (open items → JSON)
2. RESEARCH → web search per fact  (you, the model)
3. BUILD  →  one updates JSON      (only items with real news)
4. PUSH   →  facts_push.py         (merge back, idempotent)
5. REPORT →  short summary to the user
```

Do the whole loop autonomously. Touch only facts that have **real** new
information; leave the rest untouched (that is a success, not a gap).

### 0. Prerequisites (once per environment)

```bash
pip install google-auth requests
```
Credentials resolve from `--credentials <path>`, else `$FIREBASE_SERVICE_ACCOUNT`
(raw JSON, e.g. a Routine env var), else `scripts/serviceAccount.json`. The
service account writes via the Admin/REST path and bypasses Firestore rules.

### 1. Pull the tracked facts

```bash
python scripts/facts_pull.py --status due   --out /tmp/facts.json   # default cadence
python scripts/facts_pull.py --status open  --out /tmp/facts.json   # everything still tracking
python scripts/facts_pull.py --status all                          # + verified/invalidated (rare)
python scripts/facts_pull.py --ticker RKLB --ticker 2449.TW        # scope to names
```

`--status due` returns only items whose `next_check` has arrived (or was never
set) — the right default for a routine so you don't re-research things that were
just checked. Each fact looks like:

```json
{
  "id": "rklb-f-abc123",
  "ticker": "RKLB", "company": "Rocket Lab Corporation",
  "title": "Neutron Stage 1 與全箭整合靜態點火測試是否順利完成",
  "thesis": "追蹤 Neutron 首飛前置里程碑",
  "kind": "fact", "state": "pending", "confidence": "medium",
  "source": {"quarter": "2026 Q2", "date": "2026-08-10", "sentiment": "bullish"},
  "next_check": "", "base_date": "2026-08-10",
  "checklist": [{"text": "靜態點火測試通過", "done": false}],
  "update_count": 1,
  "recent_updates": [{"date": "2026-08-20", "text": "整合進度符合", "state": "on_track"}]
}
```

**Always read `recent_updates` and `checklist` first** — they tell you what is
already recorded so you never repeat it.

### 2. Research each fact

For every fact, run targeted web searches and judge whether anything **material**
happened since its latest update. Tailor queries to the market and the claim:

- Use the **company name + ticker** and the specific subject in `title` /
  `thesis`. Search in the company's home language too (中文 for TW/CN names,
  日本語 for JP, 한국어 for KR) as well as English — local filings and press
  releases often break first in-language.
- Prefer **primary / high-quality sources**, in rough order:
  official press releases & investor relations, regulatory filings (SEC 8-K/10-Q,
  TWSE/TPEx MOPS 公開資訊觀測站, EDINET, DART), the exchange, then reputable
  financial press (Reuters, Bloomberg, Nikkei, 經濟日報/工商時報, etc.). Avoid
  forums, rumor aggregators, and undated blog spam.
- Look specifically for evidence that moves the assumption: product/test
  milestones, capacity or shipment data, design wins, order/booking figures,
  guidance changes, regulatory approvals, delays, cancellations, accidents.
- **X /社群 as a lead source.** X (Twitter) and similar communities often surface
  developments before the press — teardown accounts, supply-chain trackers,
  sell-side and industry insiders, the company's and its executives' own
  handles. Worth scanning, but weight by credibility:
  - Prefer **established accounts with a real track record and a meaningful,
    non-trivial follower count** in the relevant field; the company's / execs'
    **official (verified) accounts** rank highest.
  - Treat posts as **leads, not proof.** Before recording anything from X,
    confirm it against a primary source (press release, filing, exchange) — or,
    if none yet exists, log it explicitly as *unconfirmed / 市場傳聞* with the
    account name and date, and keep the fact's `state` unchanged.
  - Discount anonymous hype, pumpers, screenshot-only claims, and accounts with
    no history; never let a single unverified post drive a `verified` /
    `invalidated` verdict.
- Note the **date** of each development and whether it is confirmed or reported.

If nothing material is found, or you only find restatements of what
`recent_updates` already says: **skip this fact entirely** (don't emit an entry
for it).

### 3. Decide the state

Only change `state` when the evidence is clear. Map the six states:

| state | 中文 | when |
|---|---|---|
| `pending` | 待驗證 | tracking; no verdict yet (leave as-is if unsure) |
| `not_started` | 尚未開始 | the milestone/period hasn't begun |
| `on_track` | 進展符合 | new evidence is consistent with the thesis |
| `behind` | 落後預期 | delayed / weaker than expected, but not dead |
| `verified` | 已驗證 | the assumption is confirmed true (milestone hit, numbers met) |
| `invalidated` | 已失效 | the assumption is confirmed false (cancelled, failed, thesis broken) |

Be conservative: one ambiguous headline is not `verified`. When a checklist item
is now satisfied, mark it done via `checklist_done`.

### 4. Build the updates JSON

Emit **one** JSON object with an `updates` array. Include an entry ONLY for
facts that have real news. Write update text in the user's language (default
繁體中文), one or two sentences, **and cite the source** (publisher + date, and a
URL when short). Keep the `id` exactly as pulled.

```json
{
  "updates": [
    {
      "id": "rklb-f-abc123",
      "new_updates": [
        {
          "date": "2026-09-02",
          "text": "Rocket Lab 官方新聞稿（9/2）確認 Neutron 一級全箭整合靜態點火完成，全程 165 秒達標。來源: Rocket Lab IR",
          "state": "on_track"
        }
      ],
      "state": "on_track",
      "next_check": "2026-10-15",
      "checklist_done": ["靜態點火測試通過"]
    }
  ]
}
```

Field rules:
- `id` — **required**, verbatim from the pull.
- `new_updates[]` — each needs `text` (sourced) and ideally `date` (ISO; defaults
  to today). `state` on an update is optional; if given it also becomes the
  fact's state unless a top-level `state` overrides it.
- `state`, `confidence` (`high|medium|low`), `next_check` (ISO date, or `""` to
  clear), `checklist_done` (list of exact checklist texts), `checklist_add`
  (list of `{ "text": ... }`) — all optional.
- **Set `next_check`** to a sensible next look (e.g. next earnings date, or a few
  weeks out) so the item re-surfaces under `--status due`.

### 5. Push

```bash
python scripts/facts_push.py --file /tmp/facts_updates.json --dry-run   # preview
python scripts/facts_push.py --file /tmp/facts_updates.json             # write
```

`facts_push.py` is **update-only** and **read-merge-write**: it never creates
facts, never drops existing fields, and skips an update whose `(date, text)`
already exists — so re-runs are safe. Run `--dry-run` first if unsure; it prints
a per-fact change summary and writes nothing.

### 6. Report back

Give the user a compact summary: which facts got updates, any state changes
(especially → `verified` / `invalidated`), and which were checked with no news.
Do **not** post to the site anywhere except through `facts_push.py`.

## Guardrails

- **Only material, sourced developments.** No speculation, no filler updates, no
  re-summarising old news. An empty result for a fact is correct and expected.
- **Never create facts.** New tracked items come from the user bookmarking on the
  site. If a pulled id is `MISSING` on push, report it; don't invent it.
- **Conservative state changes.** `verified`/`invalidated` require clear
  confirmation. When in doubt, add the update but leave the state.
- **Idempotent.** Re-running the same research must not duplicate updates — the
  push dedups, and you should also check `recent_updates` before writing.
- **Language & citation.** Update text in the user's language (繁中 default), each
  carrying its source and date.

## One-shot routine command (reference)

```bash
pip install -q google-auth requests
python scripts/facts_pull.py --status due --out /tmp/facts.json
# → research each fact, write /tmp/facts_updates.json (only items with real news)
python scripts/facts_push.py --file /tmp/facts_updates.json
```
