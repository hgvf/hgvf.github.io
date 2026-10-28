#!/usr/bin/env python3
"""War Atlas data tool: validate battle files and build data/index.json.

Usage:
  python3 scripts/atlas.py validate [file ...]   # default: all data/battles/*.json
  python3 scripts/atlas.py build                 # validate all, then write data/index.json
  python3 scripts/atlas.py export > bundle.json  # one-file bundle (wars + all battles), same format the site imports
  python3 scripts/atlas.py import bundle.json    # split a site export (bundle / single battle / array) into data/
  python3 scripts/atlas.py backfill [file ...]   # make implicit animation links explicit (zones.key, moves.unit)

Standard library only.
"""
import json, re, sys, pathlib, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BATTLES = DATA / "battles"

KINDS = {"battle", "campaign", "siege", "operation", "war", "incident"}
EVENT_TYPES = {"assault", "defense", "landing", "naval", "air", "bombing", "siege",
               "retreat", "breakthrough", "atrocity", "treaty", "hq", "other"}
MOVE_KINDS = {"attack", "landing", "retreat", "naval", "air", "reinforce"}
WEAPON_CATS = {"smallarm", "artillery", "aa", "tank", "vehicle", "aircraft", "ship",
               "chemical", "other"}
BRANCHES = {"army", "marine", "navy", "air", "other"}
SOURCE_TYPES = {"wiki", "book", "paper", "web", "primary", "video", "other"}
CONF = {"high", "medium", "low", "approx", "contested"}
DATE_RE = re.compile(r"^-?\d{1,4}(-\d{2}(-\d{2}(T\d{2}:\d{2})?)?)?\Z", re.ASCII)  # time only with a full date
OUTCOMES = {"success", "stopped", "repulsed"}
TRACK_STATUS = {"active", "destroyed", "withdrawn"}
MODELS = {"tank", "infantry", "cavalry", "artillery", "vehicle", "ship", "carrier", "aircraft"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\Z")


def load_wars():
    return {w["id"]: w for w in json.loads((DATA / "wars.json").read_text("utf-8"))["wars"]}


def check_latlng(errs, where, lat, lng):
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lat, lng)):
        errs.append(f"{where}: lat/lng must be numbers")
    elif not (-90 <= lat <= 90 and -180 <= lng <= 180):
        errs.append(f"{where}: lat/lng out of range ({lat},{lng})")


def validate(b, wars, fname=""):
    errs, warns = [], []
    req = ["schema_version", "id", "kind", "title", "wars", "date", "location", "result",
           "summary", "sides", "phases", "sources", "provenance"]
    for k in req:
        if k not in b:
            errs.append(f"missing field: {k}")
    if errs:
        return errs, warns
    if not ID_RE.match(b["id"]):
        errs.append("id must be kebab-case ascii")
    if fname and pathlib.Path(fname).stem != b["id"]:
        errs.append(f"file name must be <id>.json (got {pathlib.Path(fname).name})")
    if b["kind"] not in KINDS:
        errs.append(f"kind must be one of {sorted(KINDS)}")
    for w in b["wars"]:
        if w not in wars:
            errs.append(f"unknown war id '{w}' — add it to data/wars.json first")
    d = b["date"]
    for k in ("start", "end"):
        if k in d and d[k] and not DATE_RE.match(str(d[k])):
            errs.append(f"date.{k} must be YYYY[-MM[-DD[THH:MM]]]")
    if not d.get("start"):
        errs.append("date.start required")
    loc = b["location"]
    check_latlng(errs, "location", loc.get("lat"), loc.get("lng"))
    side_ids, unit_names = set(), {}
    if not (1 <= len(b["sides"]) <= 6):
        errs.append("sides: need 1–6 sides")
    for i, s in enumerate(b["sides"]):
        w = f"sides[{i}]"
        for k in ("id", "name", "color", "commanders", "strength", "casualties", "weapons"):
            if k not in s:
                errs.append(f"{w}: missing {k}")
        side_ids.add(s.get("id"))
        unit_names[s.get("id")] = {u.get("name") if isinstance(u, dict) else u for u in s.get("units", [])}
        if s.get("color") and not re.match(r"^#[0-9a-fA-F]{6}$", s["color"]):
            errs.append(f"{w}.color must be #rrggbb")
        for j, wp in enumerate(s.get("weapons", [])):
            if wp.get("cat") not in WEAPON_CATS:
                errs.append(f"{w}.weapons[{j}].cat '{wp.get('cat')}' not in {sorted(WEAPON_CATS)}")
            if not wp.get("name"):
                errs.append(f"{w}.weapons[{j}] needs name")
            if not wp.get("model"):
                warns.append(f"{w}.weapons[{j}] '{wp.get('name')}' has no model designation")
            if wp.get("specs") is not None and not (isinstance(wp["specs"], dict) and all(isinstance(v, str) for v in wp["specs"].values())):
                errs.append(f"{w}.weapons[{j}].specs must be an object of string values")
            if not wp.get("specs"):
                warns.append(f"{w}.weapons[{j}] '{wp.get('name')}' has no specs (comparison table will be thin)")
        units = s.get("units", [])
        if not units:
            warns.append(f"{w}.units empty — order of battle is a headline section")
        for j, u in enumerate(units):
            if isinstance(u, str):
                warns.append(f"{w}.units[{j}] is a plain string; use {{name, echelon, branch, commander, note}}")
            elif not u.get("name"):
                errs.append(f"{w}.units[{j}] needs name")
            elif u.get("branch") and u["branch"] not in BRANCHES:
                errs.append(f"{w}.units[{j}].branch not in {sorted(BRANCHES)}")
        cas = s.get("casualties", {})
        if cas.get("confidence") and cas["confidence"] not in CONF:
            errs.append(f"{w}.casualties.confidence must be one of {sorted(CONF)}")
        if not cas.get("total_label"):
            warns.append(f"{w}.casualties.total_label missing (shown as headline)")
        if not s.get("strength", {}).get("troops_label"):
            warns.append(f"{w}.strength.troops_label missing")
    win = b["result"].get("winner")
    if win and win not in side_ids and win not in ("draw", "inconclusive"):
        errs.append(f"result.winner '{win}' must be a side id, 'draw' or 'inconclusive'")
    if not b["phases"]:
        warns.append("no phases — map animation will be empty")
    for i, p in enumerate(b["phases"]):
        w = f"phases[{i}]"
        for k in ("id", "title", "start", "summary", "view"):
            if k not in p:
                errs.append(f"{w}: missing {k}")
        v = p.get("view", {})
        check_latlng(errs, f"{w}.view", v.get("lat"), v.get("lng"))
        for k in ("start", "end"):
            if p.get(k) and not DATE_RE.match(str(p[k])):
                errs.append(f"{w}.{k} must be YYYY[-MM[-DD[THH:MM]]]")
        for j, e in enumerate(p.get("events", [])):
            we = f"{w}.events[{j}]"
            check_latlng(errs, we, e.get("lat"), e.get("lng"))
            if e.get("type") not in EVENT_TYPES:
                errs.append(f"{we}.type '{e.get('type')}' not in {sorted(EVENT_TYPES)}")
            if e.get("side") and e["side"] not in side_ids:
                errs.append(f"{we}.side '{e['side']}' is not a side id")
            if e.get("date") and not DATE_RE.match(str(e["date"])):
                errs.append(f"{we}.date must be YYYY[-MM[-DD[THH:MM]]]")
        for j, m in enumerate(p.get("moves", [])):
            wm = f"{w}.moves[{j}]"
            if m.get("kind") not in MOVE_KINDS:
                errs.append(f"{wm}.kind not in {sorted(MOVE_KINDS)}")
            if not isinstance(m.get("side"), str) or m.get("side") not in side_ids:
                errs.append(f"{wm}.side '{m.get('side')}' is not a side id")
            pts = m.get("path", [])
            if len(pts) < 2:
                errs.append(f"{wm}.path needs ≥2 points")
            for pt in pts:
                check_latlng(errs, wm, *(pt + [None, None])[:2])
            for k in ("start", "end"):
                if m.get(k) and not DATE_RE.match(str(m[k])):
                    errs.append(f"{wm}.{k} must be YYYY[-MM[-DD[THH:MM]]]")
            st, en = str(m.get("start") or ""), str(m.get("end") or "")
            if st and en and len(st) == len(en) and en < st:   # same precision only: a date-only end means end of that day
                warns.append(f"{wm}.end is before start")
            if "strength" in m and not (isinstance(m["strength"], (int, float)) and not isinstance(m["strength"], bool) and m["strength"] > 0):
                errs.append(f"{wm}.strength must be a positive number (troops, ships or aircraft in the move)")
            if m.get("model") is not None and m["model"] not in MODELS:
                errs.append(f"{wm}.model not in {sorted(MODELS)}")
            if m.get("outcome") and not (isinstance(m["outcome"], str) and m["outcome"] in OUTCOMES):
                errs.append(f"{wm}.outcome not in {sorted(OUTCOMES)}")
            if m.get("unit") and not isinstance(m["unit"], str):
                errs.append(f"{wm}.unit must be a string")
            elif m.get("unit") and isinstance(m.get("side"), str) and m["unit"] not in unit_names.get(m.get("side"), set()):
                warns.append(f"{wm}.unit '{m['unit']}' is not in {m.get('side')}.units[].name")
        for j, z in enumerate(p.get("zones", [])):
            wz = f"{w}.zones[{j}]"
            if z.get("side") not in side_ids:
                errs.append(f"{wz}.side is not a side id")
            if "polygon" not in z and "line" not in z:
                errs.append(f"{wz} needs polygon or line")
            if "key" in z and not (isinstance(z["key"], str) and ID_RE.match(z["key"])):
                errs.append(f"{wz}.key must be a kebab-case string (same key = same zone across phases)")
        vk = p.get("view_keys", [])
        if not isinstance(vk, list):
            errs.append(f"{w}.view_keys must be a list")
            vk = []
        for j, k in enumerate(vk):
            wk = f"{w}.view_keys[{j}]"
            if not isinstance(k, dict):
                errs.append(f"{wk} must be an object {{at, lat, lng, zoom}}")
                continue
            if not DATE_RE.match(str(k.get("at", ""))):
                errs.append(f"{wk}.at must be YYYY[-MM[-DD[THH:MM]]]")
            check_latlng(errs, wk, k.get("lat"), k.get("lng"))
            if k.get("zoom") is not None and not (isinstance(k["zoom"], (int, float)) and 2 <= k["zoom"] <= 18):
                errs.append(f"{wk}.zoom must be 2–18")
    tracks = b.get("tracks", [])
    if not isinstance(tracks, list):
        errs.append("tracks must be a list")
        tracks = []
    for i, t in enumerate(tracks):
        wt = f"tracks[{i}]"
        if not isinstance(t, dict):
            errs.append(f"{wt} must be an object {{unit, side, points}}")
            continue
        if not isinstance(t.get("unit"), str) or not t.get("unit"):
            errs.append(f"{wt}.unit required (unit name)")
        elif isinstance(t.get("side"), str) and t["unit"] not in unit_names.get(t.get("side"), set()):
            warns.append(f"{wt}.unit '{t['unit']}' is not in {t.get('side')}.units[].name")
        if not isinstance(t.get("side"), str) or t.get("side") not in side_ids:
            errs.append(f"{wt}.side '{t.get('side')}' is not a side id")
        if t.get("model") is not None and t["model"] not in MODELS:
            errs.append(f"{wt}.model not in {sorted(MODELS)}")
        pts = t.get("points") if isinstance(t.get("points"), list) else []
        if len(pts) < 2:
            errs.append(f"{wt}.points needs ≥2 points")
        prev = None
        for j, p in enumerate(pts):
            wp = f"{wt}.points[{j}]"
            if not isinstance(p, dict):
                errs.append(f"{wp} must be an object {{date, lat, lng, status, note}}")
                continue
            check_latlng(errs, wp, p.get("lat"), p.get("lng"))
            if p.get("date") is not None and not DATE_RE.match(str(p["date"])):
                errs.append(f"{wp}.date must be YYYY[-MM[-DD[THH:MM]]]")
            if p.get("status") is not None and not (isinstance(p["status"], str) and p["status"] in TRACK_STATUS):
                errs.append(f"{wp}.status not in {sorted(TRACK_STATUS)}")
            if j in (0, len(pts) - 1) and not p.get("date"):
                errs.append(f"{wp}: first and last points need a date")
            if p.get("date") and prev and len(str(p["date"])) == len(prev) and str(p["date"]) < prev:
                errs.append(f"{wp}.date is before the previous point")
            if p.get("date"):
                prev = str(p["date"])
    if not b["sources"]:
        errs.append("sources: at least one required")
    for i, s in enumerate(b["sources"]):
        if s.get("type") not in SOURCE_TYPES:
            errs.append(f"sources[{i}].type not in {sorted(SOURCE_TYPES)}")
        if not s.get("title"):
            errs.append(f"sources[{i}] needs title")
    pv = b["provenance"]
    for k in ("extracted_by", "extracted_at"):
        if not pv.get(k):
            errs.append(f"provenance.{k} required")
    for k, v in (pv.get("confidence") or {}).items():
        if v not in CONF:
            errs.append(f"provenance.confidence.{k} '{v}' not in {sorted(CONF)}")
    # simplified-Chinese leakage check (site is zh-TW)
    text = json.dumps(b, ensure_ascii=False)
    simp = set("们这国战场军队击败转发时说进对关东车马门开头机为从过还")
    hits = sorted({c for c in text if c in simp})
    if hits:
        warns.append(f"possible simplified characters: {''.join(hits)} (site is 繁體中文)")
    return errs, warns


def all_files():
    return sorted(BATTLES.glob("*.json"))


def cmd_validate(files):
    wars = load_wars()
    bad = 0
    ids = {}
    for f in files:
        f = pathlib.Path(f)
        try:
            b = json.loads(f.read_text("utf-8"))
        except Exception as e:
            print(f"✗ {f.name}: invalid JSON — {e}")
            bad += 1
            continue
        errs, warns = validate(b, wars, str(f))
        if b.get("id") in ids:
            errs.append(f"duplicate id with {ids[b['id']]}")
        ids[b.get("id")] = f.name
        mark = "✗" if errs else "✓"
        print(f"{mark} {f.name}  ({len(b.get('phases', []))} phases, "
              f"{sum(len(p.get('events', [])) for p in b.get('phases', []))} events)")
        for e in errs:
            print(f"    ERROR  {e}")
        for w in warns:
            print(f"    warn   {w}")
        bad += bool(errs)
    return bad


def summary_entry(b, fname):
    return {
        "id": b["id"], "file": f"battles/{fname}", "kind": b["kind"], "title": b["title"],
        "title_en": b.get("title_en", ""), "wars": b["wars"], "date": b["date"],
        "lat": b["location"]["lat"], "lng": b["location"]["lng"], "zoom": b["location"].get("zoom", 8),
        "summary": b["summary"][:140], "result": b["result"].get("label", ""),
        "sides": [{"id": s["id"], "name": s["name"], "color": s["color"]} for s in b["sides"]],
    }


def cmd_build():
    if cmd_validate(all_files()):
        print("build aborted: fix errors above")
        return 1
    items = []
    for f in all_files():
        b = json.loads(f.read_text("utf-8"))
        items.append(summary_entry(b, f.name))
    items.sort(key=lambda x: str(x["date"].get("start", "")))
    out = {"schema_version": 1, "generated_at": datetime.date.today().isoformat(), "battles": items}
    (DATA / "index.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote data/index.json ({len(items)} entries)")
    build_site()
    return 0


def build_site():
    """site/app.html (+ inlined Leaflet CSS) -> index.html (full document for GitHub Pages)
    and artifact.html (body fragment for claude.ai Artifacts). Both load data/ and assets/ relatively."""
    site = ROOT / "site"
    frag = (site / "app.html").read_text("utf-8").replace("/*LEAFLET_CSS*/", (site / "leaflet.min.css").read_text("utf-8"))
    (ROOT / "artifact.html").write_text(frag, "utf-8")
    head, _, rest = frag.partition("<style>")
    doc = ('<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
           + head + "<style>" + rest.split("</style>", 1)[0] + "</style>\n"
           + "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n"
           + "</head>\n<body>\n" + rest.split("</style>", 1)[1] + "\n</body>\n</html>\n")
    (ROOT / "index.html").write_text(doc, "utf-8")
    print("wrote index.html (GitHub Pages) and artifact.html (Artifact fragment)")


def cmd_export():
    wars = json.loads((DATA / "wars.json").read_text("utf-8"))["wars"]
    battles = [json.loads(f.read_text("utf-8")) for f in all_files()]
    json.dump({"format": "war-atlas-bundle", "schema_version": 1, "wars": wars, "battles": battles},
              sys.stdout, ensure_ascii=False, indent=1)
    return 0


def cmd_import(path):
    """Merge a site export into the repo: new wars appended to wars.json, each battle written to
    data/battles/<id>.json (existing files overwritten), then rebuild."""
    o = json.loads(pathlib.Path(path).read_text("utf-8"))
    battles = o if isinstance(o, list) else o.get("battles", [o] if "id" in o else [])
    wf = DATA / "wars.json"
    wj = json.loads(wf.read_text("utf-8"))
    known = {w["id"] for w in wj["wars"]}
    for w in (o.get("wars", []) if isinstance(o, dict) else []):
        if w.get("id") and w["id"] not in known:
            wj["wars"].append(w); known.add(w["id"]); print(f"+ war {w['id']}")
    wf.write_text(json.dumps(wj, ensure_ascii=False, indent=2) + "\n", "utf-8")
    for b in battles:
        f = BATTLES / f"{b['id']}.json"
        print(("~ " if f.exists() else "+ ") + f.name)
        f.write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return cmd_build()


def zone_shape(z):
    return "polygon" if "polygon" in z else "line"


def cmd_backfill(files):
    """Write the links the page otherwise infers at runtime into the records, so they survive edits:
    zones.key chains a zone that continues into the next phase (the page morphs it), and moves.unit
    names the units[] entry an arrow belongs to (clicking the arrow opens it). Timing (moves.start)
    is left alone: it must come from sources, the page already paces undated moves by their events."""
    for f in map(pathlib.Path, files):
        b = json.loads(f.read_text("utf-8"))
        names = {s.get("id"): {u.get("name") if isinstance(u, dict) else u for u in s.get("units", [])} for s in b.get("sides", [])}
        n_unit = n_key = 0
        for p in b.get("phases", []):
            for m in p.get("moves", []):
                if not m.get("unit") and m.get("label") in names.get(m.get("side"), ()):
                    m["unit"] = m["label"]; n_unit += 1
        phases = b.get("phases", [])
        used = {z["key"] for p in phases for z in p.get("zones", []) if z.get("key")}
        for i in range(1, len(phases)):
            prev, cur = phases[i - 1].get("zones", []), phases[i].get("zones", [])
            claimed = {o["key"] for o in cur if o.get("key")}
            for z in cur:
                if z.get("key"):
                    continue
                sig = lambda o: (o.get("side"), o.get("kind"), zone_shape(o))
                same = [o for o in prev if sig(o) == sig(z)]
                peers = [o for o in cur if sig(o) == sig(z)]
                hit = next((o for o in same if o.get("label") and o.get("label") == z.get("label")), None)
                if not hit and len(same) == 1 and len(peers) == 1:
                    hit = same[0]
                if not hit or (hit.get("key") and hit["key"] in claimed):
                    continue
                if not hit.get("key"):
                    base = f"{hit.get('side')}-{hit.get('kind') or 'zone'}"
                    k, n = base, 2
                    while k in used:
                        k, n = f"{base}-{n}", n + 1
                    hit["key"] = k; used.add(k); n_key += 1
                z["key"] = hit["key"]; claimed.add(z["key"]); n_key += 1
        f.write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n", "utf-8")
        print(f"{f.name}: +{n_unit} moves.unit, +{n_key} zones.key")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:] or ["build"]
    if a[0] == "validate":
        sys.exit(1 if cmd_validate(a[1:] or all_files()) else 0)
    if a[0] == "build":
        sys.exit(cmd_build())
    if a[0] == "import" and len(a) > 1:
        sys.exit(cmd_import(a[1]))
    if a[0] == "backfill":
        sys.exit(cmd_backfill(a[1:] or all_files()))
    if a[0] == "export":
        sys.exit(cmd_export())
    print(__doc__)
    sys.exit(2)
