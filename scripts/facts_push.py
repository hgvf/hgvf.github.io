#!/usr/bin/env python3
"""
facts_push.py — Write researched updates back into the `tracked_facts` collection.

Update-only + read-merge-write: for each entry it GETs the existing fact doc,
appends any genuinely new progress updates, optionally advances the fact's
state / next check / confidence / checklist, bumps updated_at, then PATCHes the
whole doc back. It never creates facts (those come from the user bookmarking on
the site) and never drops existing fields (thesis, source, base_date,
created_at, prior updates all survive). Re-running is safe: an update whose
(date, text) already exists is skipped, so no duplicates.

Uses the Firestore REST API + google-auth (same deps as publish.py).

Setup:
    pip install google-auth requests

Usage:
    python scripts/facts_push.py --file /tmp/facts_updates.json
    python scripts/facts_push.py --file /tmp/facts_updates.json --dry-run
    cat updates.json | python scripts/facts_push.py --file -

Credentials: --credentials <path>, else $FIREBASE_SERVICE_ACCOUNT, else
scripts/serviceAccount.json (identical to publish.py).

Input JSON — a list, or {"updates": [...]}, or {"facts": [...]}. Each entry:
    {
      "id": "rklb-f-abc123",              # REQUIRED — the doc id from facts_pull
      "new_updates": [                    # progress entries to append (may be [])
        {
          "date": "2026-09-04",           # ISO date; defaults to today if omitted
          "text": "靜態點火測試完成，官方新聞稿確認全程 165 秒。來源: RocketLab PR",
          "state": "on_track"             # optional: pending|not_started|on_track|behind|verified|invalidated
        }
      ],
      "state": "on_track",                # optional: set the fact's overall state
      "next_check": "2026-10-15",         # optional: ISO date, or "" to clear
      "confidence": "high",               # optional: high|medium|low
      "checklist_done": ["靜態點火測試通過"],   # optional: mark matching items done (by text)
      "checklist_add":  [{"text": "首飛日期確認"}]  # optional: add new checklist items
    }

If an entry omits an explicit "state" but its last new_update carries one, that
state is applied to the fact (mirrors the site's "add update" behaviour).
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

SCOPE = "https://www.googleapis.com/auth/datastore"
COLLECTION = "tracked_facts"

VALID_STATES = {"pending", "not_started", "on_track", "behind", "verified", "invalidated"}
VALID_CONFIDENCE = {"high", "medium", "low"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


# ─── Firestore REST helpers (mirrors publish.py) ───────────────────────
def encode(v):
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


def get_doc(session, base, token, collection, doc_id):
    url = f"{base}/{collection}/{doc_id}"
    r = session.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code == 404:
        return None
    if r.status_code >= 300:
        print(f"  WARN {r.status_code} reading {collection}/{doc_id}: {r.text[:200]}")
        return None
    return {k: decode(v) for k, v in r.json().get("fields", {}).items()}


def upsert(session, base, token, collection, doc_id, data):
    url = f"{base}/{collection}/{doc_id}"
    body = {"fields": {k: encode(v) for k, v in data.items()}}
    r = session.patch(url, headers={"Authorization": f"Bearer {token}"}, json=body, timeout=30)
    if r.status_code >= 300:
        print(f"  ERROR {r.status_code} writing {collection}/{doc_id}: {r.text[:300]}")
        return False
    return True


# ─── Merge logic ───────────────────────────────────────────────────────
def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def norm_date(v, default=None):
    v = str(v or "").strip()[:10]
    return v if DATE_RE.match(v) else default


def as_entries(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("updates", "facts", "items"):
            if isinstance(data.get(key), list):
                return data[key]
    sys.exit('ERROR: input must be a list, or {"updates":[...]}.')


def merge_entry(fact, entry):
    """Apply one research entry onto an existing fact dict (in place-ish).
    Returns (fact, summary_str) or (None, reason) if nothing to write."""
    changes = []

    # 1) Append new updates (dedup by (date, text)).
    existing = fact.get("updates") or []
    if not isinstance(existing, list):
        existing = []
    seen = {(str(u.get("date", "")), str(u.get("text", "")).strip()) for u in existing}
    appended, last_state = [], None
    for u in (entry.get("new_updates") or []):
        text = str(u.get("text", "")).strip()
        st = u.get("state")
        if st is not None and st not in VALID_STATES:
            print(f"    skip update with bad state '{st}' on {fact.get('id')}")
            continue
        if not text and not st:
            continue
        date = norm_date(u.get("date"), today())
        key = (date, text)
        if text and key in seen:
            continue  # already recorded — idempotent re-run
        seen.add(key)
        appended.append({"at": now_iso(), "date": date, "text": text,
                         "state": st if st in VALID_STATES else None})
        if st in VALID_STATES:
            last_state = st
    if appended:
        # newest first, matching the site's prepend-on-add behaviour
        fact["updates"] = appended + existing
        changes.append(f"+{len(appended)} update(s)")

    # 2) Overall state: explicit wins, else the last update's state.
    new_state = entry.get("state")
    if new_state is not None and new_state not in VALID_STATES:
        print(f"    ignore bad state '{new_state}' on {fact.get('id')}")
        new_state = None
    if new_state is None:
        new_state = last_state
    if new_state and new_state != fact.get("state"):
        changes.append(f"state {fact.get('state')}→{new_state}")
        fact["state"] = new_state

    # 3) next_check ("" clears it), confidence.
    if "next_check" in entry:
        nc = entry["next_check"]
        nc = "" if (nc is None or str(nc).strip() == "") else norm_date(nc, fact.get("next_check", ""))
        if nc != fact.get("next_check", ""):
            changes.append(f"next_check→{nc or '—'}")
            fact["next_check"] = nc
    conf = entry.get("confidence")
    if conf in VALID_CONFIDENCE and conf != fact.get("confidence"):
        changes.append(f"confidence→{conf}")
        fact["confidence"] = conf

    # 4) Checklist: add new items, mark matching items done.
    checklist = [
        {"text": str(c.get("text", "")), "done": bool(c.get("done"))}
        for c in (fact.get("checklist") or []) if c.get("text")
    ]
    for item in (entry.get("checklist_add") or []):
        text = str(item.get("text", "")).strip()
        if text and not any(c["text"] == text for c in checklist):
            checklist.append({"text": text, "done": bool(item.get("done"))})
            changes.append("checklist+")
    done_texts = {str(t).strip() for t in (entry.get("checklist_done") or [])}
    for c in checklist:
        if c["text"].strip() in done_texts and not c["done"]:
            c["done"] = True
            changes.append("checklist✓")
    fact["checklist"] = checklist

    if not changes:
        return None, "no change"

    fact["updated_at"] = now_iso()
    return fact, ", ".join(changes)


def main():
    ap = argparse.ArgumentParser(description="Push researched updates into tracked_facts.")
    ap.add_argument("--file", required=True, help="Input JSON path, or '-' for stdin")
    ap.add_argument("--credentials", help="Path to Firebase service account JSON")
    ap.add_argument("--dry-run", action="store_true", help="Show what would change; write nothing")
    args = ap.parse_args()

    try:
        import requests
    except ImportError:
        sys.exit("ERROR: requests not installed. Run: pip install google-auth requests")

    raw = sys.stdin.read() if args.file == "-" else open(args.file, encoding="utf-8").read()
    entries = as_entries(json.loads(raw))

    info = load_service_account(args.credentials)
    project = info["project_id"]
    token = access_token(info)
    base = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents"
    session = requests.Session()

    written = skipped = missing = 0
    for entry in entries:
        doc_id = str(entry.get("id") or "").strip()
        if not doc_id:
            print("  skip entry with no id"); skipped += 1; continue
        fact = get_doc(session, base, token, COLLECTION, doc_id)
        if fact is None:
            print(f"  MISSING {doc_id} — not in tracked_facts (create it on the site first)")
            missing += 1; continue
        merged, summary = merge_entry(dict(fact), entry)
        if merged is None:
            print(f"  = {doc_id}: {summary}"); skipped += 1; continue
        if args.dry_run:
            print(f"  ~ {doc_id}: {summary}  (dry-run)"); continue
        if upsert(session, base, token, COLLECTION, doc_id, merged):
            print(f"  ✓ {doc_id}: {summary}"); written += 1
        else:
            skipped += 1

    verb = "would update" if args.dry_run else "updated"
    print(f"\nDone: {verb} {written}, unchanged/skipped {skipped}, missing {missing}.")


if __name__ == "__main__":
    main()
