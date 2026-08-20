#!/usr/bin/env python3
"""scrape_mnd.py — 解析國防部「即時軍事動態」公告，輸出台海每日活動 JSON。

硬性要求（見軍事專區規格 §6.1）：
  * 純標準庫，無 pip install。
  * 公告涵蓋「前日 0600 至當日 0600」，數字須歸屬到「截止日」（後一個日期）。
  * 民國年轉西元、支援全形數字。
  * 逾越中線 > 共機總數 → 標記 suspect。
  * 每筆保留 raw 原文。append-only（--refresh 才覆蓋）。
  * parse_announcement() 為不含網路呼叫的純函式（方便移植到 Worker JS）。
  * --self-test 離線自我測試，不碰網路。

用法：
  python3 scrape_mnd.py --self-test
  python3 scrape_mnd.py                 # 抓取並附加到 ../data/strait.json
  python3 scrape_mnd.py --refresh       # 覆寫既有日期
"""
import argparse, json, os, re, sys, urllib.request, datetime

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "strait.json")
MND_URL = "https://www.mnd.gov.tw/PublishForReporterList.aspx?title=國防消息&Types=即時軍事動態&SelectStyle=即時軍事動態"

# ── 全形→半形數字 ──
_FULL = str.maketrans("０１２３４５６７８９", "0123456789")
def _norm(s: str) -> str:
    return s.translate(_FULL)

def _num(s):
    if s is None:
        return None
    s = _norm(s).replace(",", "").strip()
    return int(s) if s.isdigit() else None

def roc_to_ad(y: int) -> int:
    """民國年→西元年（<1911 視為民國）。"""
    return y + 1911 if y < 1911 else y

def parse_announcement(text: str, ref_year: int | None = None) -> dict | None:
    """純函式：解析單則公告文字，回傳歸屬到『截止日』的日別統計。

    典型句型：
      『自即日（8月18日）6時起至明（8月19日）6時止，偵獲中共機艦動態…
        計有共機27架次（逾越台海中線及其延伸線進入我西南、西南空域計12架次）、
        共艦9艘…持續在台海周邊活動。』
    數字歸屬到後一個（截止）日期 8/19。
    """
    t = _norm(text)
    if ref_year is None:
        ref_year = datetime.date.today().year

    # 找出區間內的兩個日期，取「截止日」= 第二個。支援民國/西元年前綴。
    dates = re.findall(r"(?:民國\s*)?(?:(\d{2,4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", t)
    if not dates:
        return None
    y, mo, dd = dates[-1] if len(dates) >= 2 else dates[0]
    year = roc_to_ad(int(y)) if y else ref_year
    try:
        end_date = datetime.date(year, int(mo), int(dd)).isoformat()
    except ValueError:
        return None

    m_ac = re.search(r"共機\s*([\d,]+)\s*架次", t)
    aircraft = _num(m_ac.group(1)) if m_ac else None
    m_cross = re.search(r"(?:逾越|逾)[^）)]*?([\d,]+)\s*架次", t)
    crossings = _num(m_cross.group(1)) if m_cross else 0
    m_ship = re.search(r"共艦\s*([\d,]+)\s*艘", t)
    ships = _num(m_ship.group(1)) if m_ship else None
    m_gov = re.search(r"公務船\s*([\d,]+)\s*艘", t)
    gov = _num(m_gov.group(1)) if m_gov else 0
    m_bal = re.search(r"氣球\s*([\d,]+)", t)
    balloons = _num(m_bal.group(1)) if m_bal else None

    rec = {
        "date": end_date,
        "aircraft": aircraft if aircraft is not None else 0,
        "crossings": crossings or 0,
        "ships": ships if ships is not None else 0,
        "gov_ships": gov or 0,
        "raw": text.strip(),
    }
    if balloons is not None:
        rec["balloons"] = balloons
    # 一致性：逾越中線不應超過共機總數
    if rec["crossings"] > rec["aircraft"]:
        rec["suspect"] = True
    return rec


def load_data():
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"events": [], "daily": []}


def save_data(data):
    data["daily"].sort(key=lambda r: r["date"])
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def fetch_html(url=MND_URL) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (mil-scraper)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def extract_announcements(html: str) -> list[str]:
    """從頁面粗略切出含『共機…架次』的段落。實站上線時依實際 DOM 調整。"""
    text = re.sub(r"<[^>]+>", " ", html)
    return [m.group(0) for m in re.finditer(r"[^。]*共機[^。]*架次[^。]*。", text)]


def run(refresh=False):
    data = load_data()
    seen = {r["date"] for r in data["daily"]}
    try:
        html = fetch_html()
    except Exception as e:  # noqa: BLE001
        print(f"[warn] fetch failed: {e}", file=sys.stderr)
        return 0
    added = 0
    for chunk in extract_announcements(html):
        rec = parse_announcement(chunk)
        if not rec:
            continue
        if rec["date"] in seen and not refresh:
            continue
        data["daily"] = [r for r in data["daily"] if r["date"] != rec["date"]]
        data["daily"].append(rec)
        seen.add(rec["date"])
        added += 1
    save_data(data)
    print(f"[ok] added/updated {added} day(s); total {len(data['daily'])}")
    return added


# ── 離線自我測試 ──
SELF_TESTS = [
    ("自即日（8月18日）6時起至明（8月19日）6時止，偵獲共機27架次"
     "（逾越台海中線及其延伸線進入我西南空域計12架次）、共艦9艘、公務船2艘，持續活動。",
     {"date": "2026-08-19", "aircraft": 27, "crossings": 12, "ships": 9, "gov_ships": 2}),
    ("自即（１２月３１日）６時起至明（民國115年１月１日）６時止，偵獲共機１０架次、共艦５艘。",
     {"date": "2026-01-01", "aircraft": 10, "crossings": 0, "ships": 5, "gov_ships": 0}),
    ("自即日（3月5日）6時起至明（3月6日）6時止，偵獲共機20架次"
     "（逾越中線25架次）、共艦4艘。",
     {"date": "2026-03-06", "aircraft": 20, "crossings": 25, "ships": 4, "suspect": True}),
]

def self_test() -> int:
    fails = 0
    for text, expect in SELF_TESTS:
        got = parse_announcement(text, ref_year=2026)
        for k, v in expect.items():
            if got.get(k) != v:
                print(f"FAIL [{k}] expected {v!r} got {got.get(k)!r}\n  in: {text[:40]}…")
                fails += 1
        # 日期歸屬到窗口截止日（後一個日期）
    if not fails:
        print(f"self-test OK ({len(SELF_TESTS)} cases): date attributed to window END, ROC/full-width handled, suspect flagged.")
    return fails


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(1 if self_test() else 0)
    run(refresh=args.refresh)
