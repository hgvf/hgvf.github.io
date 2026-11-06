#!/usr/bin/env python3
"""
prune_news.py — delete news older than N days (default 180) from Firestore.

Collections pruned (by the item's own date, not when it was ingested):
    supply_chain_news          date        (供應鏈瓶頸新聞)
    supply_chain_events        event_date  (產業消息)
    supply_chain_daily_digest  doc id = YYYY-MM-DD (產業消息每日 digest)
    mil_defense_daily          _date / data.event_date (每日軍武合約)
    military_news              event_date  (News / Military)
    industry_news              doc id = YYYY-MM-DD daily payload (News / Industry)

NEVER deleted: anything collected into 重點新聞 (highlight_collected — its doc
id is the news doc id; a doc is also kept if any event it embeds has a
collected event_id). earnings_calls and price_snapshots are not touched.
Docs with no parsable date are kept.

    python scripts/prune_news.py                 # dry run: list what would go
    python scripts/prune_news.py --apply         # actually delete
    python scripts/prune_news.py --days 90 --apply

Credentials (needed for --apply): --credentials <path> or
$FIREBASE_SERVICE_ACCOUNT, same as publish.py. A dry run without credentials
falls back to the public web API key (all these collections are public-read).
After deleting, run `publish.py --type reindex` so indexes/ticker_events and
indexes/mil_defense_daily drop entries for removed docs (the daily workflow
does this). Single-doc indexes/military_news / indexes/industry_news, if they
exist, are pruned in place here.
"""
import argparse
import json
import os
import re
import sys
from datetime import date, timedelta

import requests

PROJECT = "watchlist-7fd99"
API_KEY = "AIzaSyDT4eEQZXnqTBn17LGrg9isYFRFFNCbI-I"   # public web key (js/config.js)
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
SCOPE = "https://www.googleapis.com/auth/datastore"

# collection → how to read the item's date from (doc_id, fields)
TARGETS = {
    "supply_chain_news": lambda did, f: _s(f, "date"),
    "supply_chain_events": lambda did, f: _s(f, "event_date") or did_date(did),
    "supply_chain_daily_digest": lambda did, f: did,
    "mil_defense_daily": lambda did, f: _s(f, "_date") or _s(_m(f, "data"), "event_date"),
    "military_news": lambda did, f: _s(f, "event_date"),
    "industry_news": lambda did, f: did if DATE_RE.match(did) else _s(_m(f, "event_window"), "start"),
}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _s(fields, k):
    v = fields.get(k) or {}
    return v.get("stringValue") or v.get("timestampValue") or ""


def _m(fields, k):
    return ((fields.get(k) or {}).get("mapValue") or {}).get("fields", {})


def embedded_ids(fields):
    """event_id / id of the doc itself, its `data` wrapper, and events[]."""
    ids = []
    for f in (fields, _m(fields, "data")):
        for k in ("event_id", "id"):
            if _s(f, k):
                ids.append(_s(f, k))
    for v in (fields.get("events") or {}).get("arrayValue", {}).get("values", []) or []:
        ev = (v.get("mapValue") or {}).get("fields", {})
        for k in ("event_id", "id"):
            if _s(ev, k):
                ids.append(_s(ev, k))
    return ids


def did_date(did):  # SC-20260820-001 → 2026-08-20
    m = re.search(r"(\d{4})(\d{2})(\d{2})", did)
    return f"{m[1]}-{m[2]}-{m[3]}" if m else ""


def load_token(path):
    raw = None
    if path:
        raw = open(path, encoding="utf-8").read()
    elif os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
        raw = os.environ["FIREBASE_SERVICE_ACCOUNT"]
    if not raw:
        return None
    from google.oauth2 import service_account
    import google.auth.transport.requests
    creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=[SCOPE])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def list_docs(s, coll, token):
    page = ""
    while True:
        params = {"pageSize": 300}
        if page:
            params["pageToken"] = page
        if not token:
            params["key"] = API_KEY
        r = s.get(f"{BASE}/{coll}", params=params, timeout=60,
                  headers={"Authorization": f"Bearer {token}"} if token else {})
        if r.status_code >= 300:
            sys.exit(f"ERROR listing {coll}: {r.status_code} {r.text[:200]}")
        j = r.json()
        for d in j.get("documents", []):
            yield d["name"].rsplit("/", 1)[-1], d.get("fields", {})
        page = j.get("nextPageToken", "")
        if not page:
            return


def prune_index(s, token, coll, gone):
    """Drop rows for deleted docs from a single-doc indexes/<coll>, if any."""
    if not gone:
        return
    h = {"Authorization": f"Bearer {token}"}
    r = s.get(f"{BASE}/indexes/{coll}", headers=h, timeout=30)
    if r.status_code != 200:
        return
    f = r.json().get("fields", {})
    rows = (f.get("events") or {}).get("arrayValue", {}).get("values", []) or []
    kept = [v for v in rows
            if _s((v.get("mapValue") or {}).get("fields", {}), "id") not in gone]
    if len(kept) == len(rows):
        return
    body = {"fields": {**f, "events": {"arrayValue": {"values": kept}},
                       "count": {"integerValue": str(len(kept))}}}
    s.patch(f"{BASE}/indexes/{coll}", headers=h, json=body, timeout=30)
    print(f"indexes/{coll}: {len(rows)} → {len(kept)} row(s)")


def main():
    ap = argparse.ArgumentParser(description="Delete news older than N days")
    ap.add_argument("--days", type=int, default=180)
    ap.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    ap.add_argument("--credentials")
    args = ap.parse_args()

    token = load_token(args.credentials)
    if args.apply and not token:
        sys.exit("ERROR: --apply needs credentials (--credentials or $FIREBASE_SERVICE_ACCOUNT)")
    s = requests.Session()
    cutoff = (date.today() - timedelta(days=args.days)).isoformat()

    # Collected (重點新聞) items are protected: their doc id == the news doc id.
    keep = {did for did, _ in list_docs(s, "highlight_collected", token)}
    for did, f in list_docs(s, "highlight_collected", token):
        item = (f.get("item") or {}).get("mapValue", {}).get("fields", {})
        if item.get("id", {}).get("stringValue"):
            keep.add(item["id"]["stringValue"])
    print(f"cutoff: date < {cutoff}  ·  protected (收藏): {len(keep)}  ·  "
          f"{'APPLY' if args.apply else 'DRY RUN'}")

    total = 0
    deleted = {}
    for coll, get_date in TARGETS.items():
        old, kept_fav, n = [], 0, 0
        for did, f in list_docs(s, coll, token):
            n += 1
            d = get_date(did, f)[:10]
            if not DATE_RE.match(d) or d >= cutoff:
                continue
            if did in keep or did.replace("/", "_") in keep or \
                    any(i in keep or i.replace("/", "_") in keep for i in embedded_ids(f)):
                kept_fav += 1
                continue
            old.append((did, d))
        print(f"{coll}: {n} docs, {len(old)} older than cutoff"
              + (f", {kept_fav} kept (收藏)" if kept_fav else ""))
        for did, d in sorted(old, key=lambda x: x[1]):
            if not args.apply:
                print(f"   would delete {d}  {did}")
                continue
            r = s.delete(f"{BASE}/{coll}/{did}", timeout=30,
                         headers={"Authorization": f"Bearer {token}"})
            if r.status_code >= 300:
                print(f"   ERROR {r.status_code} deleting {coll}/{did}: {r.text[:200]}")
            else:
                total += 1
                deleted.setdefault(coll, set()).add(did)
    if args.apply:
        print(f"deleted {total} document(s)")
        for coll in ("military_news", "industry_news"):
            prune_index(s, token, coll, deleted.get(coll, set()))


if __name__ == "__main__":
    main()
