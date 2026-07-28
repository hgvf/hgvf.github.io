#!/usr/bin/env python3
"""
publish.py — Write report data into Firestore (news / earnings).

Uses the Firestore REST API + google-auth (lightweight, pure-Python deps) so
there is NO firebase-admin / grpcio dependency to install. The static pages
read these collections live, so publishing updates the site immediately — no
page rebuild or git push required.

Setup:
    pip install google-auth requests

Usage:
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
      "effect": "...",                      # optional, downstream impact / costs
      "advise": "...",                      # optional, investment takeaway
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

Docs use deterministic IDs so re-running is idempotent (upsert, not duplicate).
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

VALID_SENTIMENT = {"bullish", "bearish", "neutral"}
SCOPE = "https://www.googleapis.com/auth/datastore"


# ─── Credentials / auth ────────────────────────────────────────────────
def load_service_account(path_arg):
    if path_arg:
        with open(path_arg, encoding="utf-8") as f:
            return json.load(f)
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if raw:
        return json.loads(raw)
    default = os.path.join(os.path.dirname(__file__), "serviceAccount.json")
    if os.path.exists(default):
        with open(default, encoding="utf-8") as f:
            return json.load(f)
    print("ERROR: no credentials. Pass --credentials, set "
          "$FIREBASE_SERVICE_ACCOUNT, or provide scripts/serviceAccount.json")
    sys.exit(1)


def access_token(info):
    try:
        from google.oauth2 import service_account
        import google.auth.transport.requests
    except ImportError:
        print("ERROR: google-auth not installed. Run: pip install google-auth requests")
        sys.exit(1)
    creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


# ─── Firestore REST helpers ────────────────────────────────────────────
def encode(v):
    """Python value -> Firestore typed value."""
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [encode(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: encode(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}


def upsert(session, base, token, collection, doc_id, data):
    # PATCH with no updateMask creates the doc if missing, or overwrites it.
    url = f"{base}/{collection}/{doc_id}"
    body = {"fields": {k: encode(v) for k, v in data.items()}}
    r = session.patch(url, headers={"Authorization": f"Bearer {token}"}, json=body, timeout=30)
    if r.status_code >= 300:
        print(f"  ERROR {r.status_code} writing {collection}/{doc_id}: {r.text[:300]}")
        return False
    return True


# ─── Payload builders ──────────────────────────────────────────────────
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


def news_docs(items, now_iso):
    for it in items:
        date, headline = it.get("date"), it.get("headline")
        if not date or not headline:
            print(f"  skip (missing date/headline): {it!r}")
            continue
        doc_id = f"{date}-{hashlib.sha1(headline.encode()).hexdigest()[:10]}"
        yield doc_id, {
            "date": date,
            "tickers": it.get("tickers", []),
            "headline": headline,
            "content": it.get("content", ""),
            "sentiment": norm_sentiment(it.get("sentiment")),
            "effect": it.get("effect", ""),
            "advise": it.get("advise", ""),
            "sources": it.get("sources", []),
            "updated_at": now_iso,
        }


def earnings_docs(calls, now_iso):
    for c in calls:
        ticker, year, quarter = c.get("ticker"), c.get("year"), c.get("quarter")
        if not ticker or not year or not quarter:
            print(f"  skip (missing ticker/year/quarter): {c!r}")
            continue
        doc_id = f"{slug(ticker)}-{year}-{slug(quarter)}"
        highlights = [
            {"text": h.get("text", ""), "sentiment": norm_sentiment(h.get("sentiment"))}
            for h in c.get("highlights", []) if h.get("text")
        ]
        yield doc_id, {
            "ticker": ticker,
            "company": c.get("company", ticker),
            "year": int(year),
            "quarter": quarter,
            "date": c.get("date", ""),
            "summary": c.get("summary", ""),
            "highlights": highlights,
            "updated_at": now_iso,
        }


def main():
    ap = argparse.ArgumentParser(description="Publish report data to Firestore")
    ap.add_argument("--type", required=True, choices=["news", "earnings"])
    ap.add_argument("--file", required=True, help="Path to input JSON")
    ap.add_argument("--credentials", help="Path to Firebase service account JSON")
    args = ap.parse_args()

    try:
        import requests
    except ImportError:
        print("ERROR: requests not installed. Run: pip install google-auth requests")
        sys.exit(1)

    with open(args.file, encoding="utf-8") as f:
        data = json.load(f)

    info = load_service_account(args.credentials)
    project = info.get("project_id")
    if not project:
        print("ERROR: service account JSON has no project_id")
        sys.exit(1)

    token = access_token(info)
    base = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents"
    now_iso = datetime.now(timezone.utc).isoformat()

    collection = "supply_chain_news" if args.type == "news" else "earnings_calls"
    if args.type == "news":
        docs = news_docs(as_list(data, "items"), now_iso)
    else:
        docs = earnings_docs(as_list(data, "calls"), now_iso)

    session = requests.Session()
    ok = 0
    for doc_id, payload in docs:
        if upsert(session, base, token, collection, doc_id, payload):
            ok += 1
    print(f"Published {ok} {args.type} document(s) to {collection}.")


if __name__ == "__main__":
    main()
