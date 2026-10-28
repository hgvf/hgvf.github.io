#!/usr/bin/env python3
"""
war_atlas_pull.py — Copy War Atlas records added on the website (Firestore) into the repo.

The 新增戰役 button on war-atlas/ writes to Firestore:
    war_atlas_battles/{id}  {json: "<battle record>", ...}
    war_atlas_wars/{id}     wars.json entry
A doc holding {deleted: true} is a tombstone from the page's delete-war button:
the war leaves wars.json (with its child wars), the battle file is deleted, and
remaining battles drop references to deleted wars.
This script writes each battle to war-atlas/data/battles/<id>.json, merges the
wars into war-atlas/data/wars.json, then runs `war-atlas/scripts/atlas.py build`
(validate + regenerate data/index.json and index.html). Run by
.github/workflows/sync_war_atlas.yml; commit the result.

Usage:
    pip install firebase-admin
    python scripts/war_atlas_pull.py --credentials path/to/service-account.json
"""

import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ATLAS = ROOT / "war-atlas"
DATA = ATLAS / "data"
META = ("updated_at", "updated_by")


def write_if_changed(path, obj):
    text = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text("utf-8") == text:
        return False
    path.write_text(text, "utf-8")
    return True


def main():
    parser = argparse.ArgumentParser(description="Firestore → war-atlas/data")
    parser.add_argument("--credentials", required=True, help="Path to Firebase service account JSON")
    args = parser.parse_args()

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("ERROR: firebase-admin not installed. Run: pip install firebase-admin")
        sys.exit(1)

    firebase_admin.initialize_app(credentials.Certificate(args.credentials))
    db = firestore.client()

    # Wars: update existing entries in place, append new ones (keeps chip order stable).
    wf = DATA / "wars.json"
    wj = json.loads(wf.read_text("utf-8"))
    pos = {w["id"]: i for i, w in enumerate(wj["wars"])}
    gone_wars = set()
    for d in db.collection("war_atlas_wars").stream():
        if d.to_dict().get("deleted"):
            gone_wars.add(d.id)
            continue
        w = {k: v for k, v in d.to_dict().items() if k not in META}
        w["id"] = d.id
        if d.id in pos:
            wj["wars"][pos[d.id]] = {**wj["wars"][pos[d.id]], **w}
        else:
            pos[d.id] = len(wj["wars"])
            wj["wars"].append(w)
    # a deleted war takes its child wars (theatres) with it
    while True:
        more = {w["id"] for w in wj["wars"] if w.get("parent") in gone_wars} - gone_wars
        if not more:
            break
        gone_wars |= more
    wj["wars"] = [w for w in wj["wars"] if w["id"] not in gone_wars]
    changed = 0
    if write_if_changed(wf, wj):
        changed += 1
        print("~ wars.json")

    for d in db.collection("war_atlas_battles").stream():
        doc = d.to_dict()
        if doc.get("deleted"):
            f = DATA / "battles" / f"{d.id}.json"
            try:
                mine = json.loads(f.read_text("utf-8")).get("revision", "") if f.exists() else None
            except ValueError:
                mine = ""
            # a repo copy saved after the deletion (newer revision) is kept, as on the page
            if mine is not None and str(mine) <= str(doc.get("updated_at", "")):
                f.unlink()
                changed += 1
                print(f"- {f.name}")
            continue
        try:
            b = json.loads(d.to_dict()["json"])
        except (KeyError, ValueError) as e:
            print(f"! skip {d.id}: {e}")
            continue
        if b.get("id") != d.id:
            print(f"! skip {d.id}: record id is {b.get('id')!r}")
            continue
        if gone_wars and any(w in gone_wars for w in b.get("wars", [])):
            b["wars"] = [w for w in b["wars"] if w not in gone_wars]
            if not b["wars"]:
                continue  # the final pass below deletes any repo copy
        f = DATA / "battles" / f"{d.id}.json"
        existed = f.exists()
        # a repo copy with a newer `revision` (edited in git after the last 新增) is kept; the page shows it too
        if existed:
            try:
                mine = json.loads(f.read_text("utf-8")).get("revision", "")
            except ValueError:
                mine = ""
            if str(mine) > str(b.get("revision", "")):
                print(f"= {f.name}: repo copy is newer ({mine}), kept")
                continue
        if write_if_changed(f, b):
            changed += 1
            print(("~ " if existed else "+ ") + f.name)
    # battles that stay but were tagged with a deleted war lose the tag (or go, if it was their only war)
    if gone_wars:
        for f in sorted((DATA / "battles").glob("*.json")):
            b = json.loads(f.read_text("utf-8"))
            ws = [w for w in b.get("wars", []) if w not in gone_wars]
            if ws == b.get("wars", []):
                continue
            if ws:
                b["wars"] = ws
                write_if_changed(f, b)
                print(f"~ {f.name}: dropped deleted war tag")
            else:
                f.unlink()
                print(f"- {f.name}: its only war was deleted")
            changed += 1
    print(f"{changed} file(s) changed")
    if not changed:
        return  # build stamps generated_at; skip it so an idle day makes no commit

    # Rebuild data/index.json + index.html; exits non-zero on validation errors.
    sys.exit(subprocess.call([sys.executable, str(ATLAS / "scripts" / "atlas.py"), "build"]))


if __name__ == "__main__":
    main()
