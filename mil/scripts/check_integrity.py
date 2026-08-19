#!/usr/bin/env python3
"""check_integrity.py — 資料檔參照完整性檢查（純標準庫）。

驗證（見規格 §7）：
  * battle_weapons 的 key 必須存在於 pacific-war.json battles
  * battle_weapons 的 value 必須存在於 weapons.json weapons
  * weapon.parent / weapon.family 必須存在
  * 各 JSON 可正確解析
  * 現代武器 tags 的 {type,value} 必須存在於 tags.json

回傳非零 exit code 表示有錯誤（可用於 CI）。
用法：python3 mil/scripts/check_integrity.py
"""
import json, os, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "data")


def load(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    errors = []
    pw = load("pacific-war.json")
    wp = load("weapons.json")
    bw = load("battle-weapons.json")
    tags = load("tags.json")
    modern = load("weapons-modern.json")

    battles = {b["id"] for b in pw["battles"]}
    weapons = {w["id"] for w in wp["weapons"]}
    families = {f["id"] for f in wp["families"]}

    for k, vs in bw["battle_weapons"].items():
        if k not in battles:
            errors.append(f"battle-weapons: battle '{k}' not in pacific-war.json")
        for v in vs:
            if v not in weapons:
                errors.append(f"battle-weapons: weapon '{v}' (in {k}) not in weapons.json")

    for w in wp["weapons"]:
        if w["family"] not in families:
            errors.append(f"weapons: '{w['id']}' family '{w['family']}' undefined")
        if w.get("parent") and w["parent"] not in weapons:
            errors.append(f"weapons: '{w['id']}' parent '{w['parent']}' undefined")

    # phases cover conflict span
    for b in pw["battles"]:
        if b["phase"] not in {p["id"] for p in pw["phases"]}:
            errors.append(f"pacific-war: battle '{b['id']}' phase '{b['phase']}' undefined")

    # modern weapons tag references
    tagset = set(tags["tags"].keys())
    for w in modern["weapons"]:
        for t in w.get("tags", []):
            if t["value"] not in tagset:
                errors.append(f"weapons-modern: '{w['id']}' tag value '{t['value']}' not in tags.json")
            elif tags["tags"][t["value"]]["type"] != t["type"]:
                errors.append(f"weapons-modern: '{w['id']}' tag '{t['value']}' type mismatch")
        # source_id referenced by specs must exist
        srcids = {s["id"] for s in w.get("sources", [])}
        for k, v in (w.get("specifications") or {}).items():
            if isinstance(v, dict) and v.get("source_id") and v["source_id"] not in srcids:
                errors.append(f"weapons-modern: '{w['id']}' spec '{k}' source_id '{v['source_id']}' missing")

    if errors:
        print("INTEGRITY ERRORS:")
        for e in errors:
            print("  ✗", e)
        return 1
    print(f"integrity OK — {len(battles)} battles, {len(weapons)} WW2 weapons, "
          f"{len(modern['weapons'])} modern weapons, {len(tagset)} tags.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
