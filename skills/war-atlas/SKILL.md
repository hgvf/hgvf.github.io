---
name: war-atlas
description: Add battles and wars to the user's cumulative interactive war map (戰役地圖集) — a Leaflet site with war filters, a dossier sidebar (參戰方、指揮官、兵力、武器型號、傷亡、經過) and animated phase playback, deployed on GitHub Pages and previewable as a claude.ai Artifact. Use when the user gives a battle/war name or a source link (Wikipedia, any site, paper) and wants it researched and put on the map; when they ask to set up, update, deploy or republish the war map / battle atlas; when importing a JSON export from the site back into the repo; or when editing a battle record or adding a new war category.
---

# War Atlas

A data-driven site: each battle is one JSON file in `data/battles/`; the map, sidebar and animation render entirely from that data. The job is almost always: **research → write one record → validate/build → deliver (git push and/or Artifact)**.

All paths below are relative to the atlas folder (`<ATLAS_DIR>`, e.g. `war-atlas/` inside the website repo). Its tool: `scripts/atlas.py` (stdlib only):

```
python3 scripts/atlas.py validate [files]   # schema + zh-TW checks
python3 scripts/atlas.py build              # validate all → data/index.json, index.html, artifact.html
python3 scripts/atlas.py import bundle.json # merge a site export into data/
python3 scripts/atlas.py export > b.json    # everything as one bundle
python3 scripts/atlas.py backfill [files]   # add inferable zones.key / moves.unit links
```

## In this repo (hgvf.github.io)

- `<ATLAS_DIR>` = `war-atlas/` → served at `https://hgvf.github.io/war-atlas/` (deep link `…/war-atlas/#<id>`). Listed under Side Project only — a card on the Side Projects page and a link in the sidebar's Side Project folder (`js/sideprojects.js`, `internal: true`). No top-level nav link.
- Two ways a record reaches the site; both end up in `war-atlas/data/battles/`:
  1. **Git (this skill's default):** write `data/battles/<id>.json` (+ `data/wars.json` for a new war), run `python3 war-atlas/scripts/atlas.py build`, commit `war-atlas/data/` and `war-atlas/index.html`, push.
  2. **新增 button on the page:** paste the JSON (single battle, array, or bundle with `wars` when it introduces a new war). The page validates with the same rules as `atlas.py validate`, then a whitelisted Google account writes it to Firestore — `war_atlas_battles/{id}` (`json` = the record as a string, since Firestore can't hold nested arrays) and `war_atlas_wars/{id}`. All devices see it immediately. `.github/workflows/sync_war_atlas.yml` (daily 00:30 UTC, or run manually) pulls them into `war-atlas/data/` via `scripts/war_atlas_pull.py`, rebuilds and commits.
- So when the user only has a chat (no repo access), deliver the record as JSON ready to paste into the 新增 dialog — a bundle `{"format":"war-atlas-bundle","schema_version":1,"wars":[…],"battles":[…]}` whenever it uses a war id not yet in `data/wars.json`.
- On the page, precedence for the same id is: this browser's local imports > Firestore > repo. A Firestore record keeps overriding the repo file after sync; to change a record that was added via the button, re-submit it via the button (or edit the repo file and also re-submit).
- Page source is `war-atlas/site/app.html` (+ `site/remote.js`, the Firebase module that loads Firestore records and enables 新增; it imports `../../js/reports.js` for the site's Google sign-in/whitelist). Never edit `war-atlas/index.html` by hand.
- `artifact.html` is git-ignored; build it only for an Artifact preview.

## 1. Locate the repo

- If the user's repo is reachable (linked computer, attached GitHub repo, or a clone in the workspace), work there. Read `data/wars.json` and `data/index.json` first to know existing war ids and records.
- The folder must contain `site/app.html`, `site/leaflet.min.css`, `scripts/atlas.py`, `data/`, `assets/countries-50m.json` (see Integration).

## 2. Research and write the record

Read **Research and extraction** and **Battle record schema** below before writing. Start from the closest example in `data/battles/` (battle / campaign / war overview).

1. Fetch every source the user gave, then cross-check with at least one more (other-language wiki or non-wiki).
2. Decide the war ids. If the war or theatre is new, add it to `data/wars.json` first (distinct color, ≤4-character `short`, `parent` for theatres).
3. Write `data/battles/<id>.json`: zh-TW prose, exact numbers (ranges for contested figures), a full order of battle with unit numbers (番號), weapons by category with model + specs for side-by-side comparison, 3–7 phases each with camera view, dated events, schematic moves and zones, honest `sources` and `provenance` (model id, today's date, confidence per field).

When the user sends several battles of one war, write one file per battle with the same war ids; the filter chips group them automatically.

## 3. Validate and build

Run `python3 scripts/atlas.py build`. Fix every ERROR; fix warnings unless intentional (e.g. a genuinely unknown model). The build regenerates `data/index.json`, `index.html` (GitHub Pages) and `artifact.html` (Artifact fragment).

Optional visual check: serve the repo root (`python3 -m http.server`) and screenshot one phase with Playwright. CDN scripts may be blocked in the sandbox — route `**/leaflet.js` and `**/topojson-client.min.js` to local npm copies (`npm i leaflet@1.9.4 topojson-client@3.1.0`).

## 4. Deliver

**GitHub (primary home).** Run `build`, then commit `data/` (including the regenerated `data/index.json`) and `index.html`, and push. If the site's deploy pipeline runs a build step, it may run `python3 <ATLAS_DIR>/scripts/atlas.py build` instead of committing generated files. Deep link to a record: `…/<ATLAS_DIR>/#<id>`.

**Artifact (preview / portable copy).** Publish `artifact.html` with the Artifact tool, passing `files` that map `data/wars.json`, `data/index.json`, every `data/battles/*.json` and `assets/countries-50m.json` to the same relative paths, and `capabilities: {"downloads": true}` (for the export button). On later updates publish the same file path (or the existing artifact `url`) and pass only the changed data files. Inside an Artifact online tiles are blocked by CSP, so the offline vector basemap is used; on GitHub Pages the site opens on street tiles (modern streets and labels, zoom to 19) and the 底圖 button cycles street / terrain / satellite / vector.

**Exports from the site.** If the user pastes or attaches a bundle exported from the site (battles they edited or imported on another device), save it to a file and run `atlas.py import <file>`, review the diff, then commit.

## 5. Report back

One or two lines: which record was added/updated, anything uncertain (contested casualties, approximate coordinates, sources that failed to load), and the link (Pages URL `#<id>` or the Artifact card). Do not paste the JSON unless asked.

## Rules

- Never invent sources or URLs; never present schematic arrows as exact routes.
- Keep record ids stable — they are deep links and override keys for local edits.
- Do not edit `data/index.json`, `index.html` or `artifact.html` by hand; change `site/app.html` or data and rebuild.
- Keep the site light: no new libraries, no images in data (icons are inline SVG), text-only JSON.

## Integration into an existing website

The atlas is a self-contained static page; merge it as a sub-folder, not into the site's own bundler.

```
<ATLAS_DIR>/
  index.html                 GENERATED page (full HTML document) — the URL users open
  site/app.html              page SOURCE (edit this, then build)
  site/leaflet.min.css       inlined into the page at build time
  scripts/atlas.py           validate / build / import / export (Python 3 stdlib)
  data/wars.json             war registry (filter chips)
  data/battles/*.json        one record per battle
  data/index.json            GENERATED list for the map
  assets/countries-50m.json  offline basemap (Natural Earth, ~750 KB, ~240 KB gzipped)
```

- All fetches are relative (`data/…`, `assets/…`), so the folder works at any URL path as long as `index.html` is served from `<ATLAS_DIR>/`. Link to it from the site's nav as a normal page.
- External requests: Leaflet 1.9.4 (cdnjs), topojson-client 3.1.0 (jsDelivr), Google Fonts (Noto Sans TC / Noto Serif TC / JetBrains Mono), and map tiles from Esri (ArcGIS Online; CARTO basemaps now require an API key). If the site sets a Content-Security-Policy, allow those hosts (script-src, style-src/font-src, img-src) or the page falls back to the offline vector map.
- The page uses `location.hash` (`#<battle-id>`) for deep links and `localStorage` keys `war-atlas:local:v1` and `war-atlas:base`. If the host site is an SPA with hash routing, serve the atlas as its own HTML page rather than a route inside the SPA.
- Styling is scoped to the page (CSS custom properties on `:root`, light/dark via `prefers-color-scheme` or `data-theme` on `<html>`). To match the site's look, change the tokens at the top of the second `<style>` block in `site/app.html`, then rebuild.
- Static-host config: no Jekyll processing (add `.nojekyll` at the published root for GitHub Pages); serve `.json` as `application/json`.
- `atlas.py build` also writes `artifact.html` (a fragment for claude.ai Artifacts); it can be git-ignored.

## Research and extraction

### Source plan

Fetch the source(s) the user gave first, then cross-check. Typical set for one battle:

1. The user's link (any language, any site — wiki, blog, paper PDF, museum page, YouTube description…).
2. The same article in the other main language (zh ↔ en Wikipedia; ja/ru/fr/de wiki for that belligerent's side when the battle is theirs). English Wikipedia infoboxes usually carry the most complete strength/casualty/equipment numbers.
3. One non-wiki source when available: official histories, academic papers (e.g. 政大/國史館 for 抗戰, US Army CMH, Senshi Sōsho), reputable museums.

Wikipedia access notes: `zh.wikipedia.org/zh-tw/…` pages sometimes fail in WebFetch (cache-only). If so, run a WebSearch for the battle name and fetch the result URL (en.wikipedia or the zh page from search results). WebFetch only accepts URLs that appeared in the conversation or a search result.

Ask the fetch prompt for exactly what the schema needs: dates, belligerents, commanders, strength (troops/aircraft/tanks/ships/artillery), casualties per side with each source's figure, equipment with model designations, phases with dates and named places, civilian toll, outcome, significance. Ask it to keep numbers exact.

### Extraction rules

- Write all prose in 繁體中文 (Taiwan usage: 戰車 not 坦克, 飛彈 not 導彈, 艦載機, 師團 for IJA divisions, 師 for NRA). Keep weapon `model` fields in their original designation.
- Numbers: never average or invent. Put the best-sourced figure in `total`, the spread in `range` and `total_label`, and list every distinct claim in `disputes`. Unknown = `null`.
- Attribute: anything not found in the fetched sources but added from general knowledge (common weapon models, landmarks) must be mentioned in `provenance.notes` and lowers that field's confidence to `medium`.
- Never put a URL in `sources` that you did not actually fetch or receive from a search result. A book cited inside a wiki article goes in with `"url": ""` and `"note": "經 … 轉引，未直接查閱"`.
- The `background` section answers the user's main question — why the battle happened — so give 3–5 causes, from structural to immediate trigger.
- Objectives per side make the "why" concrete; include them.

### Coordinates

- Derive from the place names in the sources. Use well-known coordinates (towns, bridges, forts, beaches, wreck sites). When a site is only approximately known, still place it, and set `provenance.confidence.coordinates` to `approx`.
- `location` = the overall battle center; `phase.view` = where that phase's action is; zoom 5–7 for theatre/sea phases, 9–11 for a campaign area, 12–13 for a single town.
- Moves are schematic arrows, not exact routes; say so in `provenance.notes`.
- Check sanity: lat −90…90, lng −180…180, `[lat, lng]` order (not GeoJSON's `[lng, lat]`).

### Animation data (second pass over the same sources)

After the record is written, read the fetched sources once more only for what drives the animation, and fill the optional fields of §4 where — and only where — a source states it:

1. **Clock**: hour stamps for naval/air actions, landings, night attacks (`THH:MM`, local time of the area; "約 10:30" → `T10:30`). Leave date-only events date-only and keep events in narrative order.
2. **Moves**: for each arrow, the sourced date it began/ended (`start`/`end`), the force in it (`strength`), how it ended (`outcome`: stopped/repulsed when the source says it was halted or thrown back), and the exact `units[].name` (`unit`).
3. **Fronts**: give the same `key` to a front/zone that continues into the next phase; a different entity gets its own key (otherwise the page would morph one into the other).
4. **Tracks**: 3–10 formations the narrative follows, stitched from your own events, move paths and unit notes (no new coordinates, no invented dates; where a unit note has no exact date use the event or phase date and say so in `provenance.notes`). End with `destroyed`/`withdrawn` only when the source says so.
5. Day/night shading appears by itself for phases with hour stamps; nothing to add.

6. **Immersion material**: media, voices, decisions and conditions — follow "Finding immersion material" in `skills/war-atlas-json/SKILL.md` (Commons file-page licence check, public-domain quotes only).
7. When editing a record in git, set `"revision"` to the current UTC time (`YYYY-MM-DDTHH:MM:SSZ`) so the site and the nightly Firestore pull keep your copy instead of an older 新增 copy.

Then run `python3 scripts/atlas.py backfill <file>` (adds inferable keys and unit links) and `validate`.

### Granularity

- A battle the user names → one record (`battle`/`siege`/`operation`).
- A 會戰 or multi-month campaign → one `campaign` record with 4–6 phases.
- A whole war (e.g. 克里米亞戰爭) → one `war` overview record whose phases are theatres/major battles; suggest splitting the biggest battles into their own records later, sharing the same war id.
- Before writing, check `data/index.json` for an existing record with the same id or title; update it instead of duplicating.

### Quality checklist (run mentally before validate)

- Every phase has a camera view and at least two events; events carry dates and numbers where sources give them.
- Every side has strength, casualties, a structured order of battle (番號 + commander + note), and ≥4 weapons with model names, `specs`, and a counterpart category on the other side.
- Contested casualty numbers: range in `casualties.range`/`total_label`, sources named in `casualties.note`.
- `sources` lists only what was actually read; `provenance` filled with model id and today's date.

## Battle record schema (schema_version 1)

Contents: 1. File layout · 2. Top-level fields · 3. sides[] · 4. phases[] · 5. Enumerations · 6. wars.json · 7. Bundle format

Every enumerated value below is enforced by `scripts/atlas.py validate`. Full worked examples: `data/battles/*.json` (Shanghai = campaign, Okinawa = battle, Crimean War = whole-war overview). Copy the closest one as a starting point.

### 1. File layout

```
data/wars.json                 war registry (filter chips); add a war here BEFORE referencing it
data/battles/<id>.json         one record per file; file name == id
data/index.json                GENERATED by `atlas.py build` — never edit by hand
```

### 2. Top-level fields

| field | req | notes |
|---|---|---|
| `schema_version` | ✓ | `1` |
| `id` | ✓ | kebab-case ASCII, English name + start year: `battle-of-midway-1942` |
| `kind` | ✓ | see §5. Use `war` for a whole-war overview whose phases span theatres |
| `title` | ✓ | 繁體中文 common name (台灣慣用譯名) |
| `title_en` |  | English name |
| `aliases` |  | other names, code names, original-language names |
| `wars` | ✓ | war ids from wars.json; list the broad war AND the specific theatre/war, e.g. `["wwii","pacific-war"]` |
| `tags` |  | 2–6 short zh-TW tags (城市戰, 兩棲登陸, 圍城戰…) |
| `date` | ✓ | `{start, end, label, duration_days}`; dates `YYYY`, `YYYY-MM`, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`; `label` is human zh-TW text |
| `location` | ✓ | `{name, country_then, country_now, lat, lng, zoom}`; lat/lng = marker on the overview map; zoom 5–13 frames the whole battle |
| `result` | ✓ | `{winner, label, detail}`; `winner` = a side id, `draw` or `inconclusive` |
| `summary` | ✓ | 2–4 sentences; first 140 chars appear in the list |
| `background` |  | `[{title, text}]` — the WHY: 3–5 causes, most proximate last |
| `objectives` |  | `{<side_id>: "what this side wanted"}` |
| `sides` | ✓ | 1–6 sides, see §3 |
| `phases` | ✓ | ordered stages that drive the map animation, see §4 |
| `places` |  | `[{name, lat, lng, kind, note}]` permanent labelled landmarks (bridges, forts, towns) |
| `civilian` |  | `{label, note}` civilian toll and atrocities |
| `significance` |  | consequences, 3–5 bullets |
| `facts` |  | `[{label, text}]` 2–4 short memorable facts (shown as tiles) |
| `disputes` |  | `[{topic, claims:[{value, source}]}]` — optional working notes for contested numbers (not shown on the site; the casualty `note`/`range` carries what readers see) |
| `sources` | ✓ | `[{title, url, type, lang, accessed, note}]`; `url` may be `""` for books cited second-hand (say so in `note`) |
| `provenance` | ✓ | `{extracted_by, extracted_at, confidence:{…}, notes}` — kept in the file for maintenance, not shown on the site |

### 3. sides[]

```json
{
  "id": "japan",                       // short ascii, referenced by result.winner / events / moves / zones
  "name": "大日本帝國",
  "color": "#b5452f",                  // #rrggbb, distinct between sides; keep a nation's color stable across records
  "belligerents": ["…"],               // formal participants on this side
  "commanders": [{"name":"…","role":"…","fate":"陣亡|自殺|被俘|病逝"}],
  "units": [                            // ORDER OF BATTLE — headline section, one card per formation, big-to-small
    {"name":"第88師","echelon":"師","branch":"army","commander":"孫元良","note":"德械師；閘北、八字橋，後留一營守四行倉庫"}
  ],                                    // branch: army | marine | navy | air | other; echelon = 戰區/集團軍/軍/師/師團/旅/聯隊/艦隊/航空隊…
  "strength": {
    "troops": 300000, "troops_label": "約 30 萬",   // number drives the bar; label is what readers see
    "formations": "9 個師團、1 個旅團",
    "aircraft": 500, "tanks": 300, "ships": 130, "artillery": null,   // null = unknown, not 0
    "note": "cumulative vs. at-a-time, etc."
  },
  "casualties": {
    "killed": null, "wounded": null, "missing": null, "captured": null,
    "total": 47000,                     // single best figure
    "total_label": "約 4.2 萬 – 9.9 萬死傷",   // headline; show the range when sources disagree
    "range": [42202, 99000],
    "note": "which source says what",
    "confidence": "contested"
  },
  "weapons": [
    {"cat":"tank","name":"八九式中戰車","model":"Type 89 I-Go","note":"how it mattered in THIS battle",
     "qty":"約 XX 輛","year":"1929",
     "specs":{"重量":"約 13 t","主武裝":"57 mm 短砲","裝甲":"最厚約 17 mm","速度":"約 25 km/h","乘員":"4"}}
  ]
}
```

Units: 8–18 per side, from the top command down to the divisions/regiments that fought the key actions; `note` says where they fought and what happened to them. Unit names should match the `label`s used in phase moves.

Weapons: 4–14 per side, and give the OPPOSING side something in the same `cat` wherever it existed — the site shows each category as a side-by-side column with a spec comparison table. `specs` values are strings with units; use the SAME keys within a category so rows line up:

| cat | spec keys |
|---|---|
| tank / vehicle | 重量, 主武裝, 裝甲, 速度, 乘員 |
| aircraft | 類型, 最大速度, 武裝, 航程 or 載彈, 乘員 |
| ship | 排水量, 主砲 or 火砲 or 載機, 航速 |
| artillery / aa | 口徑, 射程, 重量 (aa: 射速) |
| smallarm | 口徑, 彈容, 射速 or 有效射程, 重量 |

`qty` = how many were present in THIS battle (free text), `year` = entry into service. Specs are general published figures for the model — prefix approximate values with 約. `name` = 繁中 common name, `model` = exact designation (manufacturer + model/mark, caliber for guns). Prefer equipment that shaped the fighting; the `note` must say what it did here, not a generic spec.

Recommended side colors (keep consistent across the atlas): China/ROC `#3f6e8c`, Japan `#b5452f`, USA/Allies `#3a6ea5`, UK `#2f5c8a`, Germany `#4d4d4d`, USSR/Russia `#a33a3a` (or `#5d6b2f` when Russia faces a red side), France `#2c4f9e`, Ottoman `#2f7d5c`.

### 4. phases[]

```json
{
  "id": "p1", "title": "市區攻勢：圍攻虹口",
  "start": "1937-08-13", "end": "1937-08-22",
  "summary": "2–4 sentences: what happened and why it turned",
  "view": {"lat": 31.255, "lng": 121.49, "zoom": 13},     // camera for this phase
  "events": [
    {"date":"1937-08-13","title":"八字橋交火","text":"1–3 sentences with numbers",
     "lat":31.2585,"lng":121.4865,"type":"assault","side":"japan"}   // side = the side ACTING
  ],
  "moves": [
    {"side":"china","kind":"attack","label":"第88師","path":[[31.275,121.455],[31.262,121.475],[31.258,121.486]]}
  ],
  "zones": [
    {"side":"japan","kind":"hold","label":"日軍據點","polygon":[[lat,lng],…]},   // area held
    {"side":"china","kind":"front","label":"蘊藻浜防線","line":[[lat,lng],…]}   // front line
  ]
}
```

- 3–7 phases. Each phase gets 2–6 events and 1–4 moves when there was movement.
- `moves.path`: 2–5 points, `[lat, lng]`, start → end (arrowhead drawn at the end). Land moves follow roads/valleys roughly; sea moves stay over water.
- Phases may overlap in time (land vs. sea stages) — order them as a reader should follow.
- Keep `view.zoom` ≤ 12 unless the fighting is inside one town; the offline vector basemap has no street detail.

**How the page animates a phase.** Each phase plays on a clock mapped from its `start`–`end` (5–12 s, longer phases play longer; a ticker shows the date and battle day). Events pop in date order and are narrated under the timeline; moves draw as tapered arrows with a unit token riding the tip; a zone that continues from the previous phase morphs into its new shape; earlier phases' arrows stay as faint trails. Everything below is optional and only refines that — leave a field out rather than guess.

| field | on | meaning |
|---|---|---|
| dates `YYYY-MM-DDTHH:MM` | any date | local time of the battle area; use only when sources give the hour (naval/air actions, landings). The ticker then shows hours |
| `start` / `end` | move | when this move began / ended (sourced). Without them the page draws the move just before its side's next event |
| `strength` | move | troops (or ships / aircraft) in this move; arrow width grows on a log scale |
| `outcome` | move | `success`, `stopped` or `repulsed`; the last two end in a crossbar and a ✕ |
| `unit` | move | exact `units[].name` of that side; clicking the arrow scrolls to the unit (the page also matches `label`) |
| `key` | zone | kebab-case id shared by the same zone/front across phases, so it morphs instead of reappearing (`python3 scripts/atlas.py backfill` adds keys and `unit` links it can infer) |
| `view_keys` | phase | `[{"at":"1939-08-24","lat":…,"lng":…,"zoom":11}]` extra camera stops inside the phase |
| `tracks` | record (top level) | units followed across phases, see below |

In a phase that has hour stamps, a date-only event plays right after the event listed before it, so keep events in narrative order.

Phases with hour stamps that span about a day or less also get day/night shading (solar terminator at the clock time, local time taken as mean solar time) and a 白晝／晨昏／夜間 tag on the ticker. The timeline's ⦿ button records the whole playback to a WebM video (tab capture; desktop Chrome/Edge/Firefox on the website, not inside an Artifact preview).

**`tracks`** (optional, top level): a unit token that stays on the map across phases, moved by the battle clock, with a dotted trail behind it. Use it for the 3–10 formations the story follows (the ones whose `note` says where they went and what happened to them), built from the record's own dated events, moves and unit notes — never invent a route.

```json
"tracks": [
  {"unit":"安岡支隊（第1戰車團）","side":"japan","points":[
    {"date":"1939-07-02","lat":47.8,"lng":118.74,"note":"夜襲東岸蘇軍"},
    {"lat":47.78,"lng":118.68},
    {"date":"1939-07-09","lat":47.77,"lng":118.66,"status":"withdrawn","note":"被擊退後解散"}]}
]
```
- `unit` = exact `units[].name` of `side` (the token links to it; a move with the same unit/label hands its riding token over to the track).
- `points`: ≥2, first and last dated, dates non-decreasing; undated middle points are spread evenly in time. `status`: `active` (default), `destroyed`, `withdrawn` — from that point on. A track that ends `active` disappears a day after its last point; one that ends destroyed/withdrawn stays as a faded marker.
- Say in `provenance.notes` that tracks are stitched from the record's events and moves and are schematic.

### Immersion fields (optional): first-hand voices, period media, commander decisions, conditions

**Licensing rule — no exceptions:** a voice or media item goes in only if its licence needs no permission: `license.code` ∈ `pd` (public domain, e.g. US federal government works "PD-USGov", or author dead long enough), `cc0`, `cc-by`, `cc-by-sa`. Check the licence on the file's own page (Wikimedia Commons file page, archive catalogue record) and link that page. Skip anything "all rights reserved", NC/ND, "fair use", "permission granted", unclear, or whose public-domain status depends on a country rule you cannot confirm. Quotations: only from public-domain texts (official reports, PD memoirs); your own Chinese translation is fine (`translated`). Never invent or paraphrase a quote as if it were a quote.

```json
"voices": [{"phase":"p4","event":"甘比爾灣號沉沒","date":"1944-10-25T09:07","side":"allies","who":"C. A. F. Sprague","role":"第77.4.3特遣分隊指揮官",
  "quote":"（中譯）…","original":"…","lang":"en","translated":"本站",
  "source":{"title":"Action Report …","url":"https://…"},"license":{"code":"pd","name":"公有領域（美國政府著作）","url":"https://…"}}],
"media": [{"phase":"p4","event":"…","type":"image","title":"…","caption":"…","date":"1944-10-25",
  "url":"https://upload.wikimedia.org/…jpg","thumb":"https://upload.wikimedia.org/…/640px-…jpg","page":"https://commons.wikimedia.org/wiki/File:…",
  "credit":"U.S. Navy (NARA 80-G-…)","license":{"code":"pd","name":"公有領域（美國海軍）","url":"https://commons.wikimedia.org/wiki/Template:PD-USGov-Military-Navy"},"sensitive":false}],
"decisions": [{"phase":"p2","at":"1944-10-24T20:00","side":"allies","commander":"海爾賽","title":"北上追擊小澤，還是守住聖貝納迪諾海峽？",
  "situation":"…（只寫他當時知道的）","intel":["…"],"options":[{"label":"…","detail":"…"},{"label":"…"}],"chosen":0,
  "outcome":"…","hindsight":"…（事後才知道的）","sources":[{"title":"…","url":"https://…"}]}],
"phases[].conditions": {"weather":"…","temp":"…","wind":"…","sea":"…","visibility":"…","ground":"…","light":"…","note":"…","fx":["rain"],"sources":[{"title":"…","url":"https://…"}]}
```
- Items are tied to a phase (`phase` id) and appear on the clock at `date`/`at`, else with `event` (an event title in that phase), else at the phase start. Voices and media show as a card during playback and in the phase's dossier block; decisions pause the playback (抉擇模式, on by default) and reveal what happened after the reader chooses.
- `sensitive: true` blurs an image/quote until clicked — use for dead bodies, atrocities, executions.
- `conditions.fx`: rain, snow, fog, smoke, dust, storm — a light overlay on the map; only when a source states it. Every field must come from `conditions.sources`.
- `decisions`: 1–3 per record, at real turning points where sources describe the options the commander weighed. `situation`/`intel` = only what he knew then; `hindsight` = what was learned later.

### 3D view and unit models

The timeline's `3D` button tilts the map over open terrain (AWS Terrain Tiles, attribution shown; sea floor flattened) and turns track and arrow tokens into simplified 3D models; `鏡頭` follows a unit. Models are chosen from the unit (branch, name, move kind); set `model` on a move or track to override: tank, infantry, cavalry, artillery, vehicle, ship, carrier, aircraft.

```json
{"side":"ussr","kind":"attack","label":"南翼集團","unit":"第57特別軍","strength":20000,
 "start":"1939-08-20","end":"1939-08-24","outcome":"success","path":[[47.6,118.6],[47.62,118.8],[47.75,118.88]]}
```

### 5. Enumerations

- `kind`: battle, campaign, siege, operation, war, incident
- `events[].type`: assault, defense, landing, naval, air, bombing, siege, retreat, breakthrough, atrocity, treaty, hq, other
- `moves[].kind`: attack, landing, retreat, naval, air, reinforce
- `moves[].outcome`: success, stopped, repulsed
- `weapons[].cat`: smallarm, artillery, aa, tank, vehicle, aircraft, ship, chemical, other
- `units[].branch`: army, marine, navy, air, other
- `sources[].type`: wiki, book, paper, web, primary, video, other
- confidence values: high, medium, low, approx, contested

### 6. wars.json

```json
{"id":"pacific-war","name":"太平洋戰爭","short":"太平洋","name_en":"Pacific War","period":"1941–1945","color":"#2f7d78","parent":"wwii"}
```
`short` (≤4 字) is the chip label. `parent` nests a theatre under a broad war; a record should list both ids. Pick a color distinct from existing chips.

### 7. Bundle format (site import/export)

```json
{"format":"war-atlas-bundle","schema_version":1,"exported_at":"2026-10-21","wars":[…],"battles":[…]}
```
The site also accepts a single battle object or an array of battles. `python3 scripts/atlas.py import <file>` splits a bundle into `data/`.
