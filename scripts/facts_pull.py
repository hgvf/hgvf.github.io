#!/usr/bin/env python3
"""
facts_pull.py — Pull tracked facts (事實追蹤) out of Firestore for research.

Reads the `tracked_facts` collection and emits a compact JSON the fact-tracker
skill can hand to Claude: one entry per fact with its thesis, verification
checklist, and a short tail of existing updates (so the researcher knows what's
already recorded and doesn't duplicate). Feed the output to a web-research pass,
then write the results back with facts_push.py.

Uses the Firestore REST API + google-auth (same lightweight deps as
publish.py) — no firebase-admin needed.

Setup:
    pip install google-auth requests

Usage:
    python scripts/facts_pull.py                       # open facts -> stdout
    python scripts/facts_pull.py --status due          # only items due for a check
    python scripts/facts_pull.py --status all          # include verified/invalidated
    python scripts/facts_pull.py --ticker RKLB --ticker 2449.TW
    python scripts/facts_pull.py --out /tmp/facts.json

Credentials are resolved in this order (identical to publish.py):
    1. --credentials <path>
    2. $FIREBASE_SERVICE_ACCOUNT  (raw JSON string, e.g. a Routine env var)
    3. scripts/serviceAccount.json

Output shape (stdout or --out):
    {
      "generated_at": "2026-09-04T...Z",
      "status_filter": "open",
      "count": 3,
      "facts": [
        {
          "id": "rklb-f-abc123",           # doc id — pass back verbatim to push
          "ticker": "RKLB", "company": "Rocket Lab Corporation",
          "title": "Neutron Stage 1 與全箭整合靜態點火測試是否順利完成",
          "thesis": "...", "kind": "fact",           # fact | watch
          "state": "pending", "confidence": "medium",
          "source": {"quarter": "2026 Q2", "date": "2026-08-10", "sentiment": "bullish"},
          "next_check": "", "base_date": "2026-08-10",
          "checklist": [{"text": "...", "done": false}],
          "update_count": 0,
          "recent_updates": [{"date": "2026-08-20", "text": "...", "state": "on_track"}]
        }
      ]
    }
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

SCOPE = "https://www.googleapis.com/auth/datastore"
COLLECTION = "tracked_facts"

OPEN_STATES = {"pending", "not_started", "on_track", "behind"}
ALL_STATES = OPEN_STATES | {"verified", "invalidated"}


# ─── Credentials / auth (mirrors publish.py) ───────────────────────────
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
    sys.exit("ERROR: no credentials. Pass --credentials, set "
             "$FIREBASE_SERVICE_ACCOUNT, or provide scripts/serviceAccount.json")


def access_token(info):
    try:
        from google.oauth2 import service_account
        import google.auth.transport.requests
    except ImportError:
        sys.exit("ERROR: google-auth not installed. Run: pip install google-auth requests")
    creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


# ─── Firestore REST decode + list ──────────────────────────────────────
def decode(v):
    if not isinstance(v, dict):
        return v
    if "nullValue" in v:
        return None
    if "booleanValue" in v:
        return v["booleanValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "stringValue" in v:
        return v["stringValue"]
    if "timestampValue" in v:
        return v["timestampValue"]
    if "arrayValue" in v:
        return [decode(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: decode(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def list_collection(session, base, token, collection):
    docs, page_token = [], None
    while True:
        url = f"{base}/{collection}?pageSize=300"
        if page_token:
            url += f"&pageToken={page_token}"
        r = session.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
        if r.status_code == 404:
            break  # collection has no documents yet
        if r.status_code >= 300:
            sys.exit(f"ERROR {r.status_code} listing {collection}: {r.text[:300]}")
        j = r.json()
        for d in j.get("documents", []):
            doc_id = d["name"].rsplit("/", 1)[-1]
            docs.append((doc_id, {k: decode(v) for k, v in d.get("fields", {}).items()}))
        page_token = j.get("nextPageToken")
        if not page_token:
            break
    return docs


# ─── Selection + shaping ───────────────────────────────────────────────
def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def is_due(fact):
    """Open and its next check is empty (awaiting next report) or already due."""
    if fact.get("state") not in OPEN_STATES:
        return False
    nc = fact.get("next_check") or ""
    return (not nc) or nc <= today()


def compact(doc_id, f, recent=5):
    updates = f.get("updates") or []
    # newest first by `at` (fall back to date)
    updates = sorted(updates, key=lambda u: str(u.get("at") or u.get("date") or ""), reverse=True)
    return {
        "id": f.get("id") or doc_id,
        "ticker": f.get("ticker", ""),
        "company": f.get("company", ""),
        "title": f.get("title", ""),
        "thesis": f.get("thesis", ""),
        "kind": f.get("kind", "fact"),
        "state": f.get("state", "pending"),
        "confidence": f.get("confidence", "medium"),
        "source": f.get("source"),
        "next_check": f.get("next_check", ""),
        "base_date": f.get("base_date", ""),
        "checklist": [
            {"text": c.get("text", ""), "done": bool(c.get("done"))}
            for c in (f.get("checklist") or []) if c.get("text")
        ],
        "update_count": len(updates),
        "recent_updates": [
            {"date": u.get("date", ""), "text": u.get("text", ""), "state": u.get("state")}
            for u in updates[:recent]
        ],
    }


def main():
    ap = argparse.ArgumentParser(description="Pull tracked facts from Firestore for research.")
    ap.add_argument("--credentials", help="Path to Firebase service account JSON")
    ap.add_argument("--status", choices=["open", "due", "all"], default="open",
                    help="open (default) = still tracking; due = tracking and next check reached; all = include verified/invalidated")
    ap.add_argument("--ticker", action="append", default=[],
                    help="Only these tickers (repeatable). Case-insensitive.")
    ap.add_argument("--limit", type=int, default=0, help="Cap the number of facts returned")
    ap.add_argument("--out", help="Write JSON here instead of stdout")
    args = ap.parse_args()

    try:
        import requests
    except ImportError:
        sys.exit("ERROR: requests not installed. Run: pip install google-auth requests")

    info = load_service_account(args.credentials)
    project = info["project_id"]
    token = access_token(info)
    base = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents"
    session = requests.Session()

    rows = list_collection(session, base, token, COLLECTION)
    tickers = {t.upper() for t in args.ticker}

    facts = []
    for doc_id, f in rows:
        state = f.get("state", "pending")
        if state not in ALL_STATES:
            state = "pending"
        if args.status == "open" and state not in OPEN_STATES:
            continue
        if args.status == "due" and not is_due(f):
            continue
        if tickers and str(f.get("ticker", "")).upper() not in tickers:
            continue
        facts.append(compact(doc_id, f))

    # Soonest / never-checked first, then by ticker for stable output.
    facts.sort(key=lambda x: (x["next_check"] or "0000-00-00", x["ticker"]))
    if args.limit > 0:
        facts = facts[:args.limit]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status_filter": args.status,
        "count": len(facts),
        "facts": facts,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"Wrote {len(facts)} fact(s) to {args.out}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
