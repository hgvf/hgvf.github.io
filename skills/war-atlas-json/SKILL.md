---
name: "war-atlas"
description: "Research a battle or war for Kuan-Wei's own battle-map site and output exactly one importable JSON file. Use instead of war-atlas whenever a battle name or source link is given."
---

# War Atlas → one JSON

The user runs their own battle-map site. The ONLY deliverable is one importable JSON file (a `war-atlas-bundle`). Do NOT build or publish a site, do NOT make or update an Artifact, do NOT push to git, do NOT send any other file, and do NOT paste the JSON into chat.

## Steps

1. **Research.** Fetch every source the user gave, then cross-check with at least one more (other-language Wikipedia, or a non-wiki source: official history, paper, museum). `zh.wikipedia.org/zh-tw/…` often fails in WebFetch: WebSearch the battle name and fetch the en/zh URLs from the results. Ask fetches for: dates, belligerents, commanders, units (番號), strength (troops/aircraft/tanks/ships/artillery), casualties per side with each source's figure, equipment with model designations, phases with dates and named places, civilian toll, outcome, consequences. Keep numbers exact.
2. **War ids.** Reuse ids already on the site: `wwii`, `second-sino-japanese-war`, `pacific-war`, `crimean-war` (defined under Wars), plus `wwi` and `western-front-wwi` and any id the user names — for those, write the war object into `new_wars.json` with the exact id. For a new war or theatre, define a full war object (see Wars). A theatre lists its broad war as `parent`, and a record lists both ids.
3. **Write the record** to a scratch file `<id>.json` following the Schema below.
4. **Validate and bundle** with the Validator script. Fix every ERROR and rerun until it prints `ok`.
5. **Deliver** only the bundle file from `dist/` with SendUserFile (display: attach).

Several battles in one message → still one file: pass every record to the validator; they all go into the same bundle's `battles` list.

## Writing rules

- All prose in 繁體中文, Taiwan usage (戰車, 飛彈, 艦載機; 師團 for IJA divisions, 師 for NRA). Keep `model` fields in the original designation.
- Numbers: never average or invent. Best-sourced figure in `total`, the spread in `range` and `total_label`, the sources named in `casualties.note`. Unknown = `null`, not 0.
- Never put a URL in `sources` that was not actually fetched or returned by a search. A book cited second-hand: `"url": ""`, `"note": "經 … 轉引，未直接查閱"`.
- Anything added from general knowledge (common weapon models, specs, landmarks) is named in `provenance.notes`, and that field's confidence becomes `medium`.
- Coordinates come from the place names in the sources; `[lat, lng]` order. Approximate sites are still placed, with `provenance.confidence.coordinates: "approx"`. Moves are schematic arrows, not exact routes; say so in `provenance.notes`.
- Granularity: a named battle → `battle`/`siege`/`operation`; a 會戰 or multi-month campaign → `campaign` with 4–6 phases; a whole war → `war` overview whose phases are theatres or major battles.
- Record id: kebab-case English name + start year (`battle-of-midway-1942`); keep it stable, since it is the site's deep link and the key that overwrites an older import.

## Schema (schema_version 1)

Top level, ✓ = required:

| field | | notes |
|---|---|---|
| `schema_version` | ✓ | `1` |
| `id` | ✓ | see Writing rules |
| `kind` | ✓ | battle, campaign, siege, operation, war, incident |
| `title` / `title_en` / `aliases` | ✓ / – / – | 繁中 common name; English name; other names and code names |
| `wars` | ✓ | war ids, broad war AND specific theatre, e.g. `["wwii","pacific-war"]` |
| `tags` | | 2–6 short tags (城市戰, 兩棲登陸…) |
| `date` | ✓ | `{start, end, label, duration_days}`; dates `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (`THH:MM` allowed in phases, events, moves) |
| `location` | ✓ | `{name, country_then, country_now, lat, lng, zoom}`; zoom 5–13 frames the whole battle |
| `result` | ✓ | `{winner, label, detail}`; winner = a side id, `draw` or `inconclusive` |
| `summary` | ✓ | 2–4 sentences |
| `background` | | `[{title, text}]`, 3–5 causes from structural to immediate trigger (the WHY) |
| `objectives` | | `{<side_id>: "what this side wanted"}` |
| `sides` | ✓ | 1–6 sides, below |
| `phases` | ✓ | 3–7 ordered stages that drive the map animation, below |
| `places` | | `[{name, lat, lng, kind, note}]` labelled landmarks |
| `civilian` | | `{label, note}` |
| `significance` | | 3–5 consequences |
| `facts` | | `[{label, text}]` 2–4 short memorable facts |
| `disputes` | | optional `[{topic, claims:[{value, source}]}]` working notes, not displayed |
| `tracks` | | optional unit tracks across phases, see Animation fields |
| `sources` | ✓ | `[{title, url, type, lang, accessed, note}]`; type: wiki, book, paper, web, primary, video, other |
| `provenance` | ✓ | `{extracted_by, extracted_at, confidence:{coordinates, strength, casualties, weapons}, notes}`; confidence values: high, medium, low, approx, contested |

Side:

```json
{
  "id": "japan", "name": "大日本帝國", "color": "#b5452f",
  "belligerents": ["…"],
  "commanders": [{"name":"…","role":"…","fate":"陣亡|自殺|被俘|病逝"}],
  "units": [{"name":"第3師團","echelon":"師團","branch":"army","commander":"藤田進","note":"where it fought and what happened to it"}],
  "strength": {"troops":300000,"troops_label":"約 30 萬","formations":"9 個師團","aircraft":500,"tanks":300,"ships":130,"artillery":null,"note":"…"},
  "casualties": {"killed":null,"wounded":null,"missing":null,"captured":null,"total":47000,"total_label":"約 4.2 萬 – 9.9 萬死傷","range":[42202,99000],"note":"which source says what","confidence":"contested"},
  "weapons": [{"cat":"tank","name":"八九式中戰車","model":"Type 89 I-Go","qty":"約 XX 輛","year":"1929",
               "specs":{"重量":"約 13 t","主武裝":"57 mm 短砲","裝甲":"最厚約 17 mm","速度":"約 25 km/h","乘員":"4"},
               "note":"what it did in THIS battle"}]
}
```

- Colors `#rrggbb`, distinct between sides, stable per nation: ROC `#3f6e8c`, Japan `#b5452f`, USA/Allies `#3a6ea5`, UK `#2f5c8a`, Germany `#4d4d4d`, USSR/Russia `#a33a3a` (`#5d6b2f` when the other side is red), France `#2c4f9e`, Ottoman `#2f7d5c`.
- `units`: 8–18 per side, top command down to the divisions/regiments of the key actions. `branch`: army, marine, navy, air, other. `echelon`: 戰區, 集團軍, 軍, 師, 師團, 旅, 聯隊, 艦隊, 航空隊… Names should match the move `label`s.
- `weapons`: 4–14 per side. `cat`: smallarm, artillery, aa, tank, vehicle, aircraft, ship, chemical, other. Give the opposing side a counterpart in the same `cat` wherever one existed (the site compares them side by side). Use the same `specs` keys within a category, values as strings with units, approximate ones prefixed 約:

| cat | spec keys |
|---|---|
| tank / vehicle | 重量, 主武裝, 裝甲, 速度, 乘員 |
| aircraft | 類型, 最大速度, 武裝, 航程 or 載彈, 乘員 |
| ship | 排水量, 主砲 or 火砲 or 載機, 航速 |
| artillery / aa | 口徑, 射程, 重量 (aa: 射速) |
| smallarm | 口徑, 彈容, 射速 or 有效射程, 重量 |

Phase:

```json
{
  "id": "p1", "title": "…", "start": "1937-08-13", "end": "1937-08-22",
  "summary": "2–4 sentences: what happened and why it turned",
  "view": {"lat": 31.255, "lng": 121.49, "zoom": 12},
  "events": [{"date":"1937-08-13","title":"…","text":"1–3 sentences with numbers","lat":31.2585,"lng":121.4865,"type":"assault","side":"japan"}],
  "moves": [{"side":"china","kind":"attack","label":"第88師","path":[[31.275,121.455],[31.262,121.475],[31.258,121.486]]}],
  "zones": [{"side":"japan","kind":"hold","label":"…","polygon":[[lat,lng],…]},
            {"side":"china","kind":"front","label":"…","line":[[lat,lng],…]}]
}
```

- 2–6 events per phase (`side` = the side acting); event `type`: assault, defense, landing, naval, air, bombing, siege, retreat, breakthrough, atrocity, treaty, hq, other.
- 1–4 moves when there was movement; `kind`: attack, landing, retreat, naval, air, reinforce; `path` 2–5 points, start → end (arrowhead at the end), sea moves over water.
- `view.zoom`: 5–7 theatre or sea, 9–11 campaign area, 12–13 a single town.

**Animation fields (optional — fill only from sources; leave out rather than guess).** The site plays each phase on a clock from its dates: events pop in date order, moves draw as tapered arrows, a zone continuing from the previous phase morphs, and phases with hour stamps get day/night shading.

| field | on | meaning |
|---|---|---|
| `YYYY-MM-DDTHH:MM` | any date | local time; only when the source gives the hour (naval/air, landings, night actions). Keep events in narrative order |
| `start` / `end` | move | sourced begin / end of the move |
| `strength` | move | troops (or ships/aircraft) in the move; arrow width |
| `outcome` | move | `success`, `stopped`, `repulsed` (last two end in a ✕) |
| `unit` | move | exact `units[].name` of that side |
| `key` | zone | kebab-case id shared by the same zone/front across phases; a different entity gets a different key |
| `view_keys` | phase | `[{"at":"…","lat":…,"lng":…,"zoom":11}]` camera stops inside the phase |
| `tracks` | top level | `[{"unit":"<units[].name>","side":"…","points":[{"date":"…","lat":…,"lng":…,"status":"active|destroyed|withdrawn","note":"…"},{"lat":…,"lng":…},…]}]` |

`tracks`: 3–10 formations the story follows, stitched only from the record's own events, move paths and unit notes (no new coordinates or dates); first and last points dated, undated middle points are interpolated; end `destroyed`/`withdrawn` only when sourced; say in `provenance.notes` that tracks are schematic and which dates are phase dates.

## Wars

```json
{"id":"pacific-war","name":"太平洋戰爭","short":"太平洋","name_en":"Pacific War","period":"1941–1945","color":"#2f7d78","parent":"wwii"}
```

Known definitions (reuse verbatim when referenced):

```json
[
 {"id":"wwii","name":"第二次世界大戰","short":"二戰","name_en":"World War II","period":"1939–1945","color":"#b5452f"},
 {"id":"second-sino-japanese-war","name":"中日戰爭（抗日戰爭）","short":"抗戰","name_en":"Second Sino-Japanese War","period":"1937–1945","color":"#3f6e8c","parent":"wwii"},
 {"id":"pacific-war","name":"太平洋戰爭","short":"太平洋","name_en":"Pacific War","period":"1941–1945","color":"#2f7d78","parent":"wwii"},
 {"id":"crimean-war","name":"克里米亞戰爭","short":"克里米亞","name_en":"Crimean War","period":"1853–1856","color":"#8a6a2f"}
]
```

A new war: `short` ≤4 字 (the filter-chip label), a color distinct from the ones above. Put new war objects in a JSON list file for the validator.

## Validator

Run with one or more record files; add `--wars new_wars.json` when the record uses a war not listed above; add `--out name.json` to choose the file name (default: `<id>.json` for one record, `war-atlas-<date>.json` for several). The bundle is written to `dist/`, so it never overwrites the scratch record:

```bash
python3 - rec1.json [rec2.json …] [--wars new_wars.json] [--out file.json] <<'EOF'
import json, sys, re, datetime, pathlib
a = sys.argv[1:]; opt = lambda k: a[a.index(k) + 1] if k in a else None
files = [x for i, x in enumerate(a) if not x.startswith("--") and (i == 0 or a[i-1] not in ("--wars", "--out"))]
WARS = {w["id"]: w for w in [
 {"id":"wwii","name":"第二次世界大戰","short":"二戰","name_en":"World War II","period":"1939–1945","color":"#b5452f"},
 {"id":"second-sino-japanese-war","name":"中日戰爭（抗日戰爭）","short":"抗戰","name_en":"Second Sino-Japanese War","period":"1937–1945","color":"#3f6e8c","parent":"wwii"},
 {"id":"pacific-war","name":"太平洋戰爭","short":"太平洋","name_en":"Pacific War","period":"1941–1945","color":"#2f7d78","parent":"wwii"},
 {"id":"crimean-war","name":"克里米亞戰爭","short":"克里米亞","name_en":"Crimean War","period":"1853–1856","color":"#8a6a2f"}]}
for w in (json.load(open(opt("--wars"))) if opt("--wars") else []): WARS[w["id"]] = w
E = dict(kind={"battle","campaign","siege","operation","war","incident"},
 ev={"assault","defense","landing","naval","air","bombing","siege","retreat","breakthrough","atrocity","treaty","hq","other"},
 mv={"attack","landing","retreat","naval","air","reinforce"},
 cat={"smallarm","artillery","aa","tank","vehicle","aircraft","ship","chemical","other"},
 br={"army","marine","navy","air","other"}, src={"wiki","book","paper","web","primary","video","other"},
 conf={"high","medium","low","approx","contested"}, out={"success","stopped","repulsed"}, trk={"active","destroyed","withdrawn"})
DATE = re.compile(r"^-?\d{1,4}(-\d{2}(-\d{2}(T\d{2}:\d{2})?)?)?\Z", re.ASCII)
def ll(errs, where, p):
    if not (isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(x, (int, float)) for x in p) and -90 <= p[0] <= 90 and -180 <= p[1] <= 180):
        errs.append(f"{where}: bad [lat, lng] {p}")
def check(b):
    errs, warns = [], []
    for k in ["schema_version","id","kind","title","wars","date","location","result","summary","sides","phases","sources","provenance"]:
        if k not in b: errs.append("missing " + k)
    if errs: return errs, warns
    if not re.match(r"^[a-z0-9][a-z0-9-]*$", b["id"]): errs.append("id must be kebab-case ascii")
    if b["kind"] not in E["kind"]: errs.append("bad kind")
    for w in b["wars"]:
        if w not in WARS: errs.append(f"unknown war '{w}' — pass it with --wars")
    if not DATE.match(str(b["date"].get("start", ""))): errs.append("date.start must be YYYY[-MM[-DD]]")
    ll(errs, "location", [b["location"].get("lat"), b["location"].get("lng")])
    sids = {s.get("id") for s in b["sides"]}
    units = {s.get("id"): {u.get("name") if isinstance(u, dict) else u for u in s.get("units", [])} for s in b["sides"]}
    if b["result"].get("winner") not in sids | {"draw", "inconclusive"}: errs.append("result.winner must be a side id, draw or inconclusive")
    cats = {}
    for i, s in enumerate(b["sides"]):
        w = f"sides[{i}]"
        for k in ("id","name","color","commanders","units","strength","casualties","weapons"):
            if k not in s: errs.append(f"{w}: missing {k}")
        if not re.match(r"^#[0-9a-fA-F]{6}$", s.get("color", "")): errs.append(f"{w}.color must be #rrggbb")
        for j, u in enumerate(s.get("units", [])):
            if not isinstance(u, dict) or not u.get("name"): errs.append(f"{w}.units[{j}] must be an object with name")
            elif u.get("branch") not in E["br"]: errs.append(f"{w}.units[{j}].branch not in {sorted(E['br'])}")
        if len(s.get("units", [])) < 4: warns.append(f"{w}: only {len(s.get('units', []))} units")
        for j, wp in enumerate(s.get("weapons", [])):
            if wp.get("cat") not in E["cat"]: errs.append(f"{w}.weapons[{j}].cat not in {sorted(E['cat'])}")
            if not wp.get("name") or not wp.get("model"): errs.append(f"{w}.weapons[{j}] needs name and model")
            sp = wp.get("specs")
            if not isinstance(sp, dict) or not sp or not all(isinstance(v, str) for v in sp.values()): warns.append(f"{w}.weapons[{j}] '{wp.get('name')}' specs missing or not strings")
            cats.setdefault(wp.get("cat"), set()).add(s.get("id"))
        c = s.get("casualties", {})
        if not c.get("total_label"): errs.append(f"{w}.casualties.total_label required")
        if c.get("confidence") and c["confidence"] not in E["conf"]: errs.append(f"{w}.casualties.confidence invalid")
        if not s.get("strength", {}).get("troops_label"): warns.append(f"{w}.strength.troops_label missing")
    for c, ss in cats.items():
        if len(ss) < len(sids) and c not in ("chemical", "other"): warns.append(f"weapons cat '{c}' only on {sorted(ss)} — add a counterpart if one existed")
    if not 1 <= len(b["phases"]) <= 8: warns.append("aim for 3–7 phases")
    for i, p in enumerate(b["phases"]):
        w = f"phases[{i}]"
        for k in ("id","title","start","summary","view"):
            if k not in p: errs.append(f"{w}: missing {k}")
        ll(errs, f"{w}.view", [p.get("view", {}).get("lat"), p.get("view", {}).get("lng")])
        for j, e in enumerate(p.get("events", [])):
            ll(errs, f"{w}.events[{j}]", [e.get("lat"), e.get("lng")])
            if e.get("type") not in E["ev"]: errs.append(f"{w}.events[{j}].type invalid")
            if e.get("side") and e["side"] not in sids: errs.append(f"{w}.events[{j}].side not a side id")
            if e.get("date") and not DATE.match(str(e["date"])): errs.append(f"{w}.events[{j}].date invalid")
        for j, m in enumerate(p.get("moves", [])):
            if m.get("kind") not in E["mv"]: errs.append(f"{w}.moves[{j}].kind invalid")
            if m.get("side") not in sids: errs.append(f"{w}.moves[{j}].side not a side id")
            if len(m.get("path", [])) < 2: errs.append(f"{w}.moves[{j}].path needs ≥2 points")
            for pt in m.get("path", []): ll(errs, f"{w}.moves[{j}]", pt)
            for k in ("start", "end"):
                if m.get(k) and not DATE.match(str(m[k])): errs.append(f"{w}.moves[{j}].{k} invalid")
            if "strength" in m and not (isinstance(m["strength"], (int, float)) and not isinstance(m["strength"], bool) and m["strength"] > 0): errs.append(f"{w}.moves[{j}].strength must be > 0")
            if m.get("outcome") and m["outcome"] not in E["out"]: errs.append(f"{w}.moves[{j}].outcome not in {sorted(E['out'])}")
            if m.get("unit") and m["unit"] not in units.get(m.get("side"), set()): warns.append(f"{w}.moves[{j}].unit '{m['unit']}' not in units[].name")
        for j, z in enumerate(p.get("zones", [])):
            if z.get("side") not in sids: errs.append(f"{w}.zones[{j}].side not a side id")
            if "polygon" not in z and "line" not in z: errs.append(f"{w}.zones[{j}] needs polygon or line")
            for pt in z.get("polygon", z.get("line", [])): ll(errs, f"{w}.zones[{j}]", pt)
            if "key" in z and not re.match(r"^[a-z0-9][a-z0-9-]*\Z", str(z["key"])): errs.append(f"{w}.zones[{j}].key must be kebab-case")
        for j, k in enumerate(p.get("view_keys", [])):
            if not DATE.match(str(k.get("at", ""))): errs.append(f"{w}.view_keys[{j}].at invalid")
            ll(errs, f"{w}.view_keys[{j}]", [k.get("lat"), k.get("lng")])
    for i, t in enumerate(b.get("tracks", [])):
        w = f"tracks[{i}]"; pts = t.get("points", [])
        if t.get("side") not in sids: errs.append(f"{w}.side not a side id")
        if t.get("unit") not in units.get(t.get("side"), set()): warns.append(f"{w}.unit '{t.get('unit')}' not in units[].name")
        if len(pts) < 2: errs.append(f"{w}.points needs ≥2")
        for j, p in enumerate(pts):
            ll(errs, f"{w}.points[{j}]", [p.get("lat"), p.get("lng")])
            if p.get("date") and not DATE.match(str(p["date"])): errs.append(f"{w}.points[{j}].date invalid")
            if p.get("status") and p["status"] not in E["trk"]: errs.append(f"{w}.points[{j}].status not in {sorted(E['trk'])}")
            if j in (0, len(pts) - 1) and not p.get("date"): errs.append(f"{w}.points[{j}]: first and last points need a date")
    if not b["sources"]: errs.append("sources: at least one")
    for i, s in enumerate(b["sources"]):
        if s.get("type") not in E["src"] or not s.get("title"): errs.append(f"sources[{i}] needs title and valid type")
    pv = b["provenance"]
    if not pv.get("extracted_by") or not pv.get("extracted_at"): errs.append("provenance.extracted_by / extracted_at required")
    simp = sorted({ch for ch in json.dumps(b, ensure_ascii=False) if ch in set("们这国战场军队击败转发时说进对关东车马门开头机为从过还师团舰弹")})
    if simp: warns.append("possible simplified characters: " + "".join(simp))
    return errs, warns
recs, bad = [], 0
for f in files:
    b = json.load(open(f, encoding="utf-8")); errs, warns = check(b)
    for x in warns: print("WARN ", b.get("id"), x)
    for x in errs: print("ERROR", b.get("id"), x)
    bad += bool(errs); recs.append(b)
if bad: sys.exit(1)
need, todo = [], [w for b in recs for w in b["wars"]]
while todo:
    i = todo.pop(0)
    if i not in need: need.append(i); todo += [WARS[i]["parent"]] if WARS[i].get("parent") else []
need.sort(key=lambda i: bool(WARS[i].get("parent")))
name = opt("--out") or (recs[0]["id"] + ".json" if len(recs) == 1 else f"war-atlas-{datetime.date.today().isoformat()}.json")
out = {"format": "war-atlas-bundle", "schema_version": 1, "exported_at": datetime.date.today().isoformat(),
       "wars": [WARS[i] for i in need], "battles": recs}
dest = pathlib.Path("dist") / name; dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", "utf-8")
json.load(open(dest, encoding="utf-8"))
print("ok", dest, [b["id"] for b in recs], need)
EOF
```

A `possible simplified characters` warning lists characters that exist only in 簡體; replace each with its 繁體 form.

## Output contract

The delivered file is exactly:

```json
{"format":"war-atlas-bundle","schema_version":1,"exported_at":"YYYY-MM-DD",
 "wars":[every referenced war and its parents, parents first],
 "battles":[one or more records]}
```

It carries its own war definitions, so the site imports it as is (its import box, or `atlas.py import` in the repo). Records with an existing id replace the old version.

## Report back

Two or three short lines in 繁體中文: what the file covers (records, phases, sides), and what is uncertain (contested casualties, approximate coordinates, sources that failed, facts or specs added from general knowledge). No JSON in chat, no build or deploy steps.

## Rules

- Never invent sources or URLs; schematic arrows are not exact routes.
- One request → one delivered file, however many records it holds.