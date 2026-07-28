#!/usr/bin/env python3
"""
publish.py — Write report data into Firestore (news / earnings).

The static pages read these collections live, so publishing here updates the
site immediately — no page rebuild or git push required.

Usage:
    pip install firebase-admin
    python scripts/publish.py --type news     --file news.json
    python scripts/publish.py --type earnings --file earnings.json

Credentials are resolved in this order:
    1. --credentials <path>
    2. $FIREBASE_SERVICE_ACCOUNT  (raw JSON string, e.g. a Routine env var)
    3. scripts/serviceAccount.json

Input JSON shapes
-----------------
news:     a list of items, or {"items": [...]}. Each item:
    {
      "date": "2026-06-02",                 # required, ISO date
      "tickers": ["NVDA"],                  # optional
      "headline": "...",                    # required
      "content": "...",                     # required, 1-3 sentences
      "sentiment": "bullish|bearish|neutral",
      "sources": [{"title": "...", "url": "..."}]
    }

earnings: a list of calls, or {"calls": [...]}. Each call:
    {
      "ticker": "NVDA",                     # required
      "company": "NVIDIA Corp",
      "year": 2026,                         # required
      "quarter": "Q2",                      # required
      "date": "2026-05-28",                 # required, ISO date
      "summary": "one-line takeaway",
      "highlights": [                       # required
        {"text": "...", "sentiment": "bullish|bearish|neutral"}
      ]
    }

Docs use deterministic IDs so re-running is idempotent (updates, not duplicates).
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

VALID_SENTIMENT = {"bullish", "bearish", "neutral"}


def load_credentials(path_arg):
    from firebase_admin import credentials

    if path_arg:
        return credentials.Certificate(path_arg)

    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if raw:
        return credentials.Certificate(json.loads(raw))

    default = os.path.join(os.path.dirname(__file__), "serviceAccount.json")
    if os.path.exists(default):
        return credentials.Certificate(default)

    print("ERROR: no credentials. Pass --credentials, set "
          "$FIREBASE_SERVICE_ACCOUNT, or provide scripts/serviceAccount.json")
    sys.exit(1)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:60]


def norm_sentiment(v):
    v = (v or "neutral").lower()
    return v if v in VALID_SENTIMENT else "neutral"


def as_list(data, key):
    if isinstance(data, dict):
        data = data.get(key, [])
    if not isinstance(data, list):
        print(f"ERROR: expected a list (or {{'{key}': [...]}})")
        sys.exit(1)
    return data


def publish_news(db, items):
    col = db.collection("supply_chain_news")
    now = datetime.now(timezone.utc)
    n = 0
    for it in items:
        date = it.get("date")
        headline = it.get("headline")
        if not date or not headline:
            print(f"  skip (missing date/headline): {it!r}")
            continue
        doc_id = f"{date}-{hashlib.sha1(headline.encode()).hexdigest()[:10]}"
        col.document(doc_id).set({
            "date": date,
            "tickers": it.get("tickers", []),
            "headline": headline,
            "content": it.get("content", ""),
            "sentiment": norm_sentiment(it.get("sentiment")),
            "sources": it.get("sources", []),
            "updated_at": now,
        }, merge=True)
        n += 1
    return n


def publish_earnings(db, calls):
    col = db.collection("earnings_calls")
    now = datetime.now(timezone.utc)
    n = 0
    for c in calls:
        ticker = c.get("ticker")
        year = c.get("year")
        quarter = c.get("quarter")
        if not ticker or not year or not quarter:
            print(f"  skip (missing ticker/year/quarter): {c!r}")
            continue
        doc_id = f"{slug(ticker)}-{year}-{slug(quarter)}"
        highlights = [
            {"text": h.get("text", ""), "sentiment": norm_sentiment(h.get("sentiment"))}
            for h in c.get("highlights", []) if h.get("text")
        ]
        col.document(doc_id).set({
            "ticker": ticker,
            "company": c.get("company", ticker),
            "year": int(year),
            "quarter": quarter,
            "date": c.get("date", ""),
            "summary": c.get("summary", ""),
            "highlights": highlights,
            "updated_at": now,
        }, merge=True)
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description="Publish report data to Firestore")
    ap.add_argument("--type", required=True, choices=["news", "earnings"])
    ap.add_argument("--file", required=True, help="Path to input JSON")
    ap.add_argument("--credentials", help="Path to Firebase service account JSON")
    args = ap.parse_args()

    try:
        import firebase_admin
        from firebase_admin import firestore
    except ImportError:
        print("ERROR: firebase-admin not installed. Run: pip install firebase-admin")
        sys.exit(1)

    with open(args.file, encoding="utf-8") as f:
        data = json.load(f)

    cred = load_credentials(args.credentials)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    if args.type == "news":
        count = publish_news(db, as_list(data, "items"))
        print(f"Published {count} news item(s) to supply_chain_news.")
    else:
        count = publish_earnings(db, as_list(data, "calls"))
        print(f"Published {count} earnings call(s) to earnings_calls.")


if __name__ == "__main__":
    main()
