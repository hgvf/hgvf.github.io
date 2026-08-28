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
    python scripts/publish.py --type defense  --file defense.json   # -> mil_defense_daily
    python scripts/publish.py --type conflict --file war.json        # -> mil_conflicts   (② 戰役消耗)
    python scripts/publish.py --type arsenal  --file weapons.json    # -> mil_weapons     (③ 系統譜系)
    python scripts/publish.py --type explorer --file modern.json     # -> mil_weapons_modern (① 武器探索)
    python scripts/publish.py --type events   --file sc_events.json   # -> supply_chain_events + supply_chain_daily_digest (產業消息)

A scheduler can call this after producing the JSON, e.g.:
    claude ... > /tmp/defense.json && \
    python scripts/publish.py --type defense --file /tmp/defense.json

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
      ],
      "watch": ["future watch point", ...]  # optional; [] or missing = none
    }

defense:  {"run": {...}, "events": [...]}, a bare list, or a single event.
          The `run` block is ignored (audit only). Each event follows the
          defense-acquisition schema; only `title` or `title_zh` is required,
          and at least one official source is expected. Written to
          mil_defense_daily as { _date, _country, _type, _score, updated_at,
          data:<event> } — identical to the site's ADD JSON writer, so the doc
          id (event_id, else country_date_contract/title) upserts cleanly no
          matter which path published it.

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


def decode(v):
    """Firestore typed value -> Python (inverse of encode; used to read back
    the small index doc before merging)."""
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


def upsert(session, base, token, collection, doc_id, data):
    # PATCH with no updateMask creates the doc if missing, or overwrites it.
    url = f"{base}/{collection}/{doc_id}"
    body = {"fields": {k: encode(v) for k, v in data.items()}}
    r = session.patch(url, headers={"Authorization": f"Bearer {token}"}, json=body, timeout=30)
    if r.status_code >= 300:
        print(f"  ERROR {r.status_code} writing {collection}/{doc_id}: {r.text[:300]}")
        return False
    return True


def get_doc(session, base, token, collection, doc_id):
    """Return a doc's fields as a Python dict, or None if it doesn't exist."""
    url = f"{base}/{collection}/{doc_id}"
    r = session.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code == 404:
        return None
    if r.status_code >= 300:
        print(f"  WARN {r.status_code} reading {collection}/{doc_id}: {r.text[:200]}")
        return None
    return {k: decode(v) for k, v in r.json().get("fields", {}).items()}


# ─── Payload builders ──────────────────────────────────────────────────
def slug(text, n=60):
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:n]


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
            "credibility": it.get("credibility", ""),
            "tags": it.get("tags", []),
            "effect": it.get("effect", ""),
            "advise": it.get("advise", ""),
            "chain": it.get("chain", {}),
            "alternatives": it.get("alternatives", []),
            "signals": it.get("signals", ""),
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
        raw_watch = c.get("watch", [])
        if isinstance(raw_watch, str):
            raw_watch = [raw_watch] if raw_watch.strip() else []
        watch = [str(w) for w in raw_watch if str(w).strip()]
        yield doc_id, {
            "ticker": ticker,
            "company": c.get("company", ticker),
            "year": int(year),
            "quarter": quarter,
            "date": c.get("date", ""),
            "summary": c.get("summary", ""),
            "highlights": highlights,
            "watch": watch,
            "updated_at": now_iso,
        }


# ─── Military defense contracts (mil_defense_daily) ────────────────────
# Doc shape MUST match the front-end writer (js/defensedata.js saveDefenseEvents)
# so the page renders scheduler-written and hand-pasted events identically:
#   { _date, _country, _type, _score, updated_at, data: <event> }
# Accepts {"run":{...},"events":[...]}, a bare list, or a single event object.
def defense_events_from(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if isinstance(data.get("events"), list):
            return data["events"]
        if data.get("event_id") or data.get("title") or data.get("title_zh"):
            return [data]
    print('ERROR: expected {"events":[...]}, a list, or a single event object')
    sys.exit(1)


def defense_docs(events, now_iso):
    for e in events:
        if not e.get("title") and not e.get("title_zh"):
            print(f"  skip (missing title/title_zh): {json.dumps(e, ensure_ascii=False)[:80]}")
            continue
        contract_no = (e.get("contract") or {}).get("contract_number")
        id_base = e.get("event_id") or "{}_{}_{}".format(
            e.get("country", "xx"),
            e.get("publication_date") or e.get("event_date") or "nodate",
            contract_no or (e.get("title") or e.get("title_zh") or "")[:24],
        )
        try:
            score = int(float(e.get("importance_score") or 0))
        except (TypeError, ValueError):
            score = 0
        yield slug(id_base, 90), {
            "_date": e.get("publication_date") or e.get("event_date") or "",
            "_country": e.get("country", ""),
            "_type": e.get("event_type", ""),
            "_score": score,
            "updated_at": now_iso,
            "data": e,
        }


# ─── Military war conflicts (mil_conflicts) + weapon pools ─────────────
# Doc shapes mirror the front-end writers (js/defensedata.js) so scheduler
# and hand-pasted data upsert identically:
#   mil_conflicts/{id}        -> { id, updated_at, data:<conflict> }
#   mil_weapons/{id}          -> { updated_at, data:<weapon> }   (arsenal ③)
#   mil_weapons_modern/{id}   -> { updated_at, data:<weapon> }   (explorer ①)
def conflicts_from(data):
    if isinstance(data, dict) and isinstance(data.get("conflicts"), list):
        return data["conflicts"]
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and data.get("id"):
        return [data]
    print('ERROR: expected a conflict object, a list, or {"conflicts":[...]}')
    sys.exit(1)


def conflict_docs(items, now_iso):
    for c in items:
        if not c.get("id"):
            print(f"  skip (missing id): {json.dumps(c, ensure_ascii=False)[:80]}")
            continue
        yield slug(c["id"], 90), {"id": c["id"], "updated_at": now_iso, "data": c}


def weapons_from(data):
    if isinstance(data, dict) and isinstance(data.get("weapons"), list):
        return data["weapons"]
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and data.get("id"):
        return [data]
    print('ERROR: expected a weapon object, a list, or {"weapons":[...]}')
    sys.exit(1)


def weapon_docs(items, now_iso):
    for w in items:
        if not w.get("id") or not w.get("name_zh"):
            print(f"  skip (missing id/name_zh): {json.dumps(w, ensure_ascii=False)[:80]}")
            continue
        yield slug(w["id"], 90), {"updated_at": now_iso, "data": w}


# ─── 產業消息 / supply-chain intelligence events (supply_chain_events) ──
# Consumes the JSON emitted by the supply-chain-intelligence-daily skill:
#   { "schema_version": "1.x", "events": [ ... ], "digest": {...},
#     "event_window": {"start": "YYYY-MM-DD"}, ... }
# or a bare list of events, or a single event object.
#
# Each event upserts to supply_chain_events/<event_id> (idempotent — the whole
# event object is stored flat so the front-end can filter on event_type /
# themes[] / regions[] / tickers[] / importance_tier / search_keywords[]).
# The per-day digest upserts to supply_chain_daily_digest/<event_date>.
SCHEMA_VERSION_SUPPORTED = "1."  # accept 1.x


def events_payload(data):
    """Return (events_list, full_payload_or_None). full_payload carries the
    top-level digest/event_window when the input is the skill's envelope."""
    if isinstance(data, dict) and isinstance(data.get("events"), list):
        version = str(data.get("schema_version", "1.0"))
        if not version.startswith(SCHEMA_VERSION_SUPPORTED):
            print(f"ERROR: unsupported schema_version {version!r}; publisher supports "
                  f"{SCHEMA_VERSION_SUPPORTED}x")
            sys.exit(1)
        return data["events"], data
    if isinstance(data, list):
        return data, None
    if isinstance(data, dict) and (data.get("event_id") or data.get("title_zh")):
        return [data], None
    print('ERROR: expected {"events":[...]}, a list, or a single event object')
    sys.exit(1)


def event_docs(events, now_iso):
    """Yield (doc_id, event) with event_id as the deterministic doc id and a
    server-side ingested_at stamped so the "new since last visit" badge works."""
    for e in events:
        eid = e.get("event_id")
        date = e.get("event_date") or (e.get("event_window") or {}).get("start")
        if not eid or not date:
            print(f"  skip (missing event_id/event_date): "
                  f"{json.dumps(e, ensure_ascii=False)[:80]}")
            continue
        doc = dict(e)
        doc["ingested_at"] = now_iso  # overwrite with the actual publish time
        # event_id is the canonical doc id; only sanitize chars Firestore
        # forbids in a document id ("/"), keep case so it matches the schema.
        yield str(eid).replace("/", "-")[:1500], doc


def digest_doc(payload, events, now_iso):
    """Build the supply_chain_daily_digest/<date> doc. Uses the skill's
    precomputed digest when present, else derives one from the events."""
    window = (payload or {}).get("event_window") or {}
    date_key = window.get("start")
    if not date_key and events:
        date_key = events[0].get("event_date")
    if not date_key:
        return None, None

    digest = (payload or {}).get("digest") or {}
    if not digest:
        themes, tiers, tickers = {}, {}, {}
        for e in events:
            for t in e.get("themes", []) or []:
                themes[t] = themes.get(t, 0) + 1
            tier = e.get("importance_tier")
            if tier:
                tiers[tier] = tiers.get(tier, 0) + 1
            for tk in e.get("tickers", []) or []:
                tickers[tk] = tickers.get(tk, 0) + 1
        top = [k for k, _ in sorted(tickers.items(), key=lambda kv: -kv[1])[:8]]
        digest = {
            "themes_distribution": themes,
            "importance_distribution": tiers,
            "top_tickers": top,
        }

    return date_key, {
        "date": date_key,
        "event_count": (payload or {}).get("event_count", len(events)),
        "event_window": window,
        "digest": digest,
        "schema_version": (payload or {}).get("schema_version", "1.0"),
        "generator": (payload or {}).get("generator", {}),
        "generated_at": (payload or {}).get("generated_at", now_iso),
        "updated_at": now_iso,
    }


# ─── Ticker → latest-event index (indexes/ticker_events) ───────────────
# Front-end reads this single doc to tag each ticker card with links to the
# latest related supply / industry / earnings record — one read instead of
# scanning three whole collections on every page load (js/db.js
# getEventTickerMap). Merged incrementally: each publish folds its batch in,
# keeping the newest date per (symbol, kind). Shape:
#   indexes/ticker_events = { updated_at, map: { "<symbol>": {
#       "supply":   {id, date},   # supply_chain_news
#       "industry": {id, date},   # supply_chain_events
#       "earnings": {id, date} } } }  # earnings_calls
INDEX_COLLECTION = "indexes"
INDEX_DOC = "ticker_events"


def index_entries(kind, docs):
    """From published (doc_id, payload) pairs, yield (symbol, kind, id, date).
    `supply`/`industry` read tickers[]; `earnings` reads the scalar ticker."""
    for doc_id, payload in docs:
        if kind == "earnings":
            syms = [payload.get("ticker")] if payload.get("ticker") else []
            date = payload.get("date", "")
        else:
            syms = payload.get("tickers", []) or []
            date = payload.get("event_date") or payload.get("date", "")
        for sym in syms:
            if sym and date:
                yield str(sym).strip(), kind, doc_id, str(date)


def list_collection(session, base, token, collection):
    """Read every doc in a collection via the REST list API (paginated).
    Returns [(doc_id, fields_dict), ...]. Used only by --type reindex."""
    docs, page_token = [], None
    while True:
        url = f"{base}/{collection}?pageSize=300"
        if page_token:
            url += f"&pageToken={page_token}"
        r = session.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
        if r.status_code >= 300:
            print(f"  WARN {r.status_code} listing {collection}: {r.text[:200]}")
            break
        j = r.json()
        for d in j.get("documents", []):
            doc_id = d["name"].rsplit("/", 1)[-1]
            docs.append((doc_id, {k: decode(v) for k, v in d.get("fields", {}).items()}))
        page_token = j.get("nextPageToken")
        if not page_token:
            break
    return docs


def rebuild_event_index(session, base, token, now_iso):
    """One-time full rebuild of indexes/ticker_events from the existing report
    collections (backfills history the incremental merge never saw)."""
    mp = {}
    def fold(kind, docs):
        for symbol, k, doc_id, date in index_entries(kind, docs):
            cur = (mp.get(symbol) or {}).get(k)
            if not cur or date > str(cur.get("date", "")):
                mp.setdefault(symbol, {})[k] = {"id": doc_id, "date": date}
    fold("supply",   list_collection(session, base, token, "supply_chain_news"))
    fold("industry", list_collection(session, base, token, "supply_chain_events"))
    fold("earnings", list_collection(session, base, token, "earnings_calls"))
    if upsert(session, base, token, INDEX_COLLECTION, INDEX_DOC,
              {"map": mp, "updated_at": now_iso}):
        print(f"Rebuilt indexes/{INDEX_DOC}: {len(mp)} symbol(s).")


# ─── Defense daily → single-doc index (indexes/mil_defense_daily) ──────
# The military "每日軍武合約" page reads this ONE doc instead of scanning the
# whole mil_defense_daily collection on every page load (Firestore reads grow
# linearly with accumulated events otherwise — same problem ticker_events
# solved for the watchlist). Holds the most-recent N events flattened to the
# exact rows the front-end expects (js/defensedata.js loadDefenseEvents):
#   indexes/mil_defense_daily = { updated_at, count, events: [
#       { id, _date, _country, _type, _score, data:<event> }, ... ] }
# ~3KB/event × 250 ≈ 0.7MB, safely under Firestore's 1MB doc limit.
DEFENSE_INDEX_DOC = "mil_defense_daily"
DEFENSE_INDEX_MAX = 250


def rebuild_defense_index(session, base, token, now_iso):
    docs = list_collection(session, base, token, "mil_defense_daily")
    rows = []
    for doc_id, f in docs:
        rows.append({
            "id": doc_id,
            "_date": f.get("_date", ""),
            "_country": f.get("_country", ""),
            "_type": f.get("_type", ""),
            "_score": f.get("_score", 0),
            "data": f.get("data", {}),
        })
    rows.sort(key=lambda r: str(r.get("_date", "")), reverse=True)
    rows = rows[:DEFENSE_INDEX_MAX]
    if upsert(session, base, token, INDEX_COLLECTION, DEFENSE_INDEX_DOC,
              {"updated_at": now_iso, "count": len(rows), "events": rows}):
        print(f"Rebuilt indexes/{DEFENSE_INDEX_DOC}: {len(rows)} event(s).")


def update_event_index(session, base, token, entries, now_iso):
    entries = [e for e in entries if e[0] and e[2] and e[3]]
    if not entries:
        return
    existing = get_doc(session, base, token, INDEX_COLLECTION, INDEX_DOC) or {}
    mp = existing.get("map") or {}
    changed = 0
    for symbol, kind, doc_id, date in entries:
        cur = (mp.get(symbol) or {}).get(kind)
        if not cur or date > str(cur.get("date", "")):
            mp.setdefault(symbol, {})[kind] = {"id": doc_id, "date": date}
            changed += 1
    if not changed:
        print("Event index already current.")
        return
    if upsert(session, base, token, INDEX_COLLECTION, INDEX_DOC,
              {"map": mp, "updated_at": now_iso}):
        print(f"Updated indexes/{INDEX_DOC}: {changed} entr(y/ies).")


def main():
    ap = argparse.ArgumentParser(description="Publish report data to Firestore")
    ap.add_argument("--type", required=True,
                    choices=["news", "earnings", "defense", "conflict",
                             "arsenal", "explorer", "events", "reindex"])
    ap.add_argument("--file", help="Path to input JSON (not needed for reindex)")
    ap.add_argument("--credentials", help="Path to Firebase service account JSON")
    ap.add_argument("--collection",
                    help="Override target collection (events only; "
                         "default supply_chain_events)")
    ap.add_argument("--digest-collection",
                    help="Digest collection for --type events "
                         "(default supply_chain_daily_digest)")
    args = ap.parse_args()

    try:
        import requests
    except ImportError:
        print("ERROR: requests not installed. Run: pip install google-auth requests")
        sys.exit(1)

    if args.type != "reindex":
        if not args.file:
            print("ERROR: --file is required for --type " + args.type)
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

    session = requests.Session()

    if args.type == "reindex":
        rebuild_event_index(session, base, token, now_iso)
        rebuild_defense_index(session, base, token, now_iso)
        return

    collection = {
        "news": "supply_chain_news",
        "earnings": "earnings_calls",
        "defense": "mil_defense_daily",
        "conflict": "mil_conflicts",
        "arsenal": "mil_weapons",
        "explorer": "mil_weapons_modern",
        "events": args.collection or "supply_chain_events",
    }[args.type]

    # 產業消息: events + a per-day digest (two collections).
    if args.type == "events":
        events, envelope = events_payload(data)
        docs = list(event_docs(events, now_iso))
        ok = 0
        for doc_id, payload in docs:
            if upsert(session, base, token, collection, doc_id, payload):
                ok += 1
        print(f"Published {ok} event document(s) to {collection}.")

        date_key, digest = digest_doc(envelope, events, now_iso)
        if date_key and digest:
            dcol = args.digest_collection or "supply_chain_daily_digest"
            if upsert(session, base, token, dcol, date_key, digest):
                print(f"Wrote digest for {date_key} to {dcol}.")
        # Only fold the default events collection into the ticker index (an
        # override collection is a separate feed and shouldn't pollute it).
        if collection == "supply_chain_events":
            update_event_index(session, base, token,
                               list(index_entries("industry", docs)), now_iso)
        return

    if args.type == "news":
        docs = list(news_docs(as_list(data, "items"), now_iso))
    elif args.type == "earnings":
        docs = list(earnings_docs(as_list(data, "calls"), now_iso))
    elif args.type == "defense":
        docs = defense_docs(defense_events_from(data), now_iso)
    elif args.type == "conflict":
        docs = conflict_docs(conflicts_from(data), now_iso)
    else:  # arsenal | explorer
        docs = weapon_docs(weapons_from(data), now_iso)

    ok = 0
    for doc_id, payload in docs:
        if upsert(session, base, token, collection, doc_id, payload):
            ok += 1
    print(f"Published {ok} {args.type} document(s) to {collection}.")

    # Fold news/earnings into the ticker → latest-event index (see
    # update_event_index). `docs` is materialized above for these two types.
    if args.type == "news":
        update_event_index(session, base, token,
                           list(index_entries("supply", docs)), now_iso)
    elif args.type == "earnings":
        update_event_index(session, base, token,
                           list(index_entries("earnings", docs)), now_iso)
    elif args.type == "defense":
        # Refresh the single-doc index the 每日軍武合約 page reads (1 read/load).
        rebuild_defense_index(session, base, token, now_iso)


if __name__ == "__main__":
    main()
