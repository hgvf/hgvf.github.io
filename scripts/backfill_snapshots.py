#!/usr/bin/env python3
"""
backfill_snapshots.py — one-off price snapshots for every ticker cited by
existing news / industry events / earnings that is NOT in the watchlist.

Reads the (public-read) Firestore collections over REST, collects tickers,
and sends them to the Worker's POST /snapshot in batches of 25. The Worker
skips watchlist tickers and symbols that already have a snapshot, so this is
safe to re-run. No credentials needed.

    pip install requests
    python scripts/backfill_snapshots.py [--dry-run]
"""
import argparse
import os
import time

import requests

PROJECT = "watchlist-7fd99"
API_KEY = "AIzaSyDT4eEQZXnqTBn17LGrg9isYFRFFNCbI-I"   # public web key (js/config.js)
WORKER = os.environ.get("PRICE_WORKER_URL",
                        "https://watchlist-worker.kwtang8618.workers.dev")
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
COLLECTIONS = ["supply_chain_news", "supply_chain_events", "earnings_calls"]


def list_docs(s, coll):
    token = ""
    while True:
        r = s.get(f"{BASE}/{coll}", params={"pageSize": 300, "pageToken": token,
                                           "key": API_KEY}, timeout=60)
        r.raise_for_status()
        j = r.json()
        yield from j.get("documents", [])
        token = j.get("nextPageToken", "")
        if not token:
            return


def tickers_of(doc):
    f = doc.get("fields", {})
    out = []
    for v in f.get("tickers", {}).get("arrayValue", {}).get("values", []) or []:
        if "stringValue" in v:
            out.append(v["stringValue"])
        elif "mapValue" in v:  # {symbol: ...} objects
            sym = v["mapValue"].get("fields", {}).get("symbol", {}).get("stringValue")
            if sym:
                out.append(sym)
    if "ticker" in f and "stringValue" in f["ticker"]:
        out.append(f["ticker"]["stringValue"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    s = requests.Session()
    syms = []
    for coll in COLLECTIONS:
        n = 0
        for d in list_docs(s, coll):
            n += 1
            for t in tickers_of(d):
                t = str(t).strip().upper()
                if t and t not in syms:
                    syms.append(t)
        print(f"{coll}: {n} docs")
    print(f"{len(syms)} distinct tickers")
    if args.dry_run:
        return
    fetched, skipped, failed = [], [], []
    for i in range(0, len(syms), 25):
        r = s.post(f"{WORKER}/snapshot", json={"symbols": syms[i:i + 25]}, timeout=120)
        j = r.json() if r.ok else {}
        fetched += j.get("fetched", [])
        skipped += j.get("skipped", [])
        failed += j.get("failed", [])
        print(f"  batch {i // 25 + 1}: +{len(j.get('fetched', []))} "
              f"{'' if r.ok else f'HTTP {r.status_code}'}")
        time.sleep(1)
    print(f"captured {len(fetched)}, watchlist (skipped) {len(skipped)}, "
          f"no quote {len(failed)}: {failed}")


if __name__ == "__main__":
    main()
