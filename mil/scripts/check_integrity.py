#!/usr/bin/env python3
"""check_integrity.py — 資料檔參照完整性檢查（純標準庫）。

驗證：
  * wars/index.json 的每個 file 存在且可解析
  * 每場戰爭自足：battle.weapons ⊂ 該戰爭 weapons ids；weapon.parent 存在；battle.coord 為 [lat,lon]
  * arsenal.json：weapon.parent 存在；family 存在於 families（或允許自訂）
  * weapons-modern.json：tags 的 {type,value} 存在於 tags.json；spec source_id 存在
回傳非零 exit code 表示有錯誤（CI 可用）。
"""
import json, os, sys

DATA = os.path.join(os.path.dirname(__file__), "..", "data")


def load(*parts):
    with open(os.path.join(DATA, *parts), encoding="utf-8") as f:
        return json.load(f)


def check_conflict(c, errors):
    wid = {w["id"] for w in c.get("weapons", [])}
    for w in c.get("weapons", []):
        if w.get("parent") and w["parent"] not in wid:
            errors.append(f"[{c['id']}] weapon '{w['id']}' parent '{w['parent']}' missing")
    phases = {p["id"] for p in c.get("phases", [])}
    for b in c.get("battles", []):
        if not isinstance(b.get("coord"), list) or len(b["coord"]) != 2:
            errors.append(f"[{c['id']}] battle '{b.get('id')}' coord must be [lat,lon]")
        if b.get("phase") and b["phase"] not in phases:
            errors.append(f"[{c['id']}] battle '{b.get('id')}' phase '{b['phase']}' undefined")
        for w in b.get("weapons", []):
            if w not in wid:
                errors.append(f"[{c['id']}] battle '{b.get('id')}' weapon '{w}' not in conflict weapons[]")


def main() -> int:
    errors = []

    # ── wars ──
    idx = load("wars", "index.json")
    n_battles = n_wweapons = 0
    for reg in idx["conflicts"]:
        try:
            c = load("wars", reg["file"])
        except Exception as e:  # noqa: BLE001
            errors.append(f"wars/{reg['file']} unreadable: {e}"); continue
        check_conflict(c, errors)
        n_battles += len(c.get("battles", []))
        n_wweapons += len(c.get("weapons", []))

    # ── arsenal ──
    ars = load("arsenal.json")
    fams = {f["id"] for f in ars["families"]}
    wid = {w["id"] for w in ars["weapons"]}
    for w in ars["weapons"]:
        if w.get("parent") and w["parent"] not in wid:
            errors.append(f"arsenal: '{w['id']}' parent '{w['parent']}' missing")
        # family may be custom (not in families); only warn if referenced parent chain broken
    # ── modern weapons + tags ──
    tags = load("tags.json")
    modern = load("weapons-modern.json")
    tagset = set(tags["tags"].keys())
    for w in modern["weapons"]:
        srcids = {s["id"] for s in w.get("sources", [])}
        for t in w.get("tags", []):
            if t["value"] not in tagset:
                errors.append(f"weapons-modern: '{w['id']}' tag '{t['value']}' not in tags.json")
            elif tags["tags"][t["value"]]["type"] != t["type"]:
                errors.append(f"weapons-modern: '{w['id']}' tag '{t['value']}' type mismatch")
        for k, v in (w.get("specifications") or {}).items():
            if isinstance(v, dict) and v.get("source_id") and v["source_id"] not in srcids:
                errors.append(f"weapons-modern: '{w['id']}' spec '{k}' source_id '{v['source_id']}' missing")

    if errors:
        print("INTEGRITY ERRORS:")
        for e in errors:
            print("  ✗", e)
        return 1
    print(f"integrity OK — {len(idx['conflicts'])} conflicts / {n_battles} battles / {n_wweapons} war-weapons, "
          f"{len(ars['weapons'])} arsenal weapons, {len(modern['weapons'])} modern weapons, {len(tagset)} tags.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
