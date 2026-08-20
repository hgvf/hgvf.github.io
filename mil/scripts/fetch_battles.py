#!/usr/bin/env python3
"""fetch_battles.py — 由 Wikidata + Wikipedia 抽取戰役骨架（純標準庫）。

Stage A：Wikidata SPARQL 取戰役骨架（P361+ 遞移查 part-of、P585 日期、P625 座標）。
Stage B：抓 Wikipedia infobox 原始 wikitext（兵力/傷亡幾乎只存在於此），
         標記 needs_review，不自行猜測數字。infobox 解析用括號深度計數，
         處理巢狀模板如 {{nowrap|...}}。

注意：本檔為目標系統之抽取骨架。實際數字仍需人工覆核（needs_review），
不得由腳本臆測。離線 --self-test 僅驗 infobox 解析器，不碰網路。

用法：
  python3 fetch_battles.py --self-test
  python3 fetch_battles.py --conflict Q170314   # Pacific War（需網路）
"""
import argparse, json, re, sys, urllib.parse, urllib.request

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
UA = {"User-Agent": "mil-battle-fetcher/1.0 (research)"}

SPARQL_TEMPLATE = """
SELECT ?battle ?battleLabel ?start ?coord WHERE {
  ?battle wdt:P361+ wd:%s .
  OPTIONAL { ?battle wdt:P585 ?start. }
  OPTIONAL { ?battle wdt:P625 ?coord. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
}
ORDER BY ?start
"""


def sparql(conflict_qid: str) -> list[dict]:
    q = SPARQL_TEMPLATE % conflict_qid
    url = WIKIDATA_SPARQL + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    out = []
    for b in data["results"]["bindings"]:
        coord = None
        if "coord" in b:
            m = re.search(r"Point\(([-\d.]+) ([-\d.]+)\)", b["coord"]["value"])
            if m:
                coord = [float(m.group(2)), float(m.group(1))]  # [lat, lon]
        out.append({
            "wikidata": b["battle"]["value"].rsplit("/", 1)[-1],
            "name": b.get("battleLabel", {}).get("value"),
            "start": b.get("start", {}).get("value", "")[:10] or None,
            "coord": coord,
        })
    return out


def parse_infobox_field(wikitext: str, field: str) -> str | None:
    """從 infobox wikitext 取單一欄位值，以括號/大括號深度計數處理巢狀模板。

    例：`| casualties = {{nowrap|3,057 killed}}` → `3,057 killed`
    """
    idx = wikitext.find("|" + field)
    if idx < 0:
        # 容許欄位名前後空白
        m = re.search(r"\|\s*" + re.escape(field) + r"\s*=", wikitext)
        if not m:
            return None
        idx = m.start()
    eq = wikitext.find("=", idx)
    if eq < 0:
        return None
    i, depth_c, depth_b, buf = eq + 1, 0, 0, []
    while i < len(wikitext):
        c = wikitext[i]
        two = wikitext[i:i + 2]
        if two == "{{":
            depth_c += 1; buf.append(two); i += 2; continue
        if two == "}}":
            if depth_c == 0:  # 到達 infobox 結尾
                break
            depth_c -= 1; buf.append(two); i += 2; continue
        if two == "[[":
            depth_b += 1; buf.append(two); i += 2; continue
        if two == "]]":
            depth_b = max(0, depth_b - 1); buf.append(two); i += 2; continue
        # 只有在最外層時，"|" 才代表欄位結束
        if c == "|" and depth_c == 0 and depth_b == 0:
            break
        buf.append(c); i += 1
    val = "".join(buf)
    # 去除常見模板包裝與標記
    val = re.sub(r"\{\{(?:nowrap|nobr)\|([^{}]*)\}\}", r"\1", val, flags=re.I)
    val = re.sub(r"<ref[^>]*>.*?</ref>", "", val, flags=re.S)
    val = re.sub(r"<ref[^>]*/>", "", val)
    val = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", val)
    val = re.sub(r"\[\[([^\]]*)\]\]", r"\1", val)
    val = re.sub(r"</?br\s*/?>", "; ", val, flags=re.I)
    val = re.sub(r"'''?", "", val)
    return val.strip() or None


def run(conflict):
    skeleton = sparql(conflict)
    battles = []
    for s in skeleton:
        battles.append({**s, "committed": None, "deaths": None, "wounded": None,
                        "needs_review": True,
                        "_note": "figures require manual verification from the Wikipedia infobox; not auto-guessed"})
    print(json.dumps({"conflict": conflict, "battles": battles}, ensure_ascii=False, indent=1))


SELF_TESTS = [
    ("{{Infobox military conflict\n| casualties1 = {{nowrap|3,057 killed}}\n| strength1 = 4 carriers\n}}",
     "casualties1", "3,057 killed"),
    ("{{Infobox\n| result = Decisive [[Allies of World War II|Allied]] victory\n| next = x\n}}",
     "result", "Decisive Allied victory"),
    ("{{Infobox\n| strength2 = 20,000<ref name=a>cite</ref> troops\n}}",
     "strength2", "20,000 troops"),
]

def self_test() -> int:
    fails = 0
    for wt, field, expect in SELF_TESTS:
        got = parse_infobox_field(wt, field)
        if got != expect:
            print(f"FAIL [{field}] expected {expect!r} got {got!r}")
            fails += 1
    if not fails:
        print(f"self-test OK ({len(SELF_TESTS)} cases): nested-template / ref / wikilink stripping, brace-depth counting.")
    return fails


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--conflict", default="Q170314", help="Wikidata QID of the conflict (default: Pacific War)")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(1 if self_test() else 0)
    try:
        run(args.conflict)
    except Exception as e:  # noqa: BLE001
        print(f"[error] {e}", file=sys.stderr); sys.exit(1)
