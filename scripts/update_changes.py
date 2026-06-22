#!/usr/bin/env python3
"""
update_changes.py — Compute week / month / year change % for every watchlist
symbol and MERGE them into the Firestore `prices` collection.

Why this exists
---------------
The Cloudflare Worker owns the *intraday* fields (last, day%, P/E, market cap,
volume) and refreshes them on demand. Historical change percentages, however,
need ~1 year of daily closes per symbol — too many sub-requests for the Worker
to fetch for ~600 symbols within Cloudflare's per-invocation limit. So we
compute them here, in GitHub Actions (no sub-request cap), once a day BEFORE the
Firestore→JSON sync runs, and write them back with merge=True so the Worker's
fields are preserved.

Single batched download (`yf.download`) keeps the number of outbound requests
bounded regardless of how many symbols are in the watchlist.

Requires: pip install yfinance firebase-admin
Usage:    python scripts/update_changes.py --credentials path/to/service-account.json
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def load_symbols():
    """Collect unique symbols from data/watchlist.json (handles both the
    exported `tickers` shape and the legacy `watchlist` shape)."""
    with open(ROOT / "data" / "watchlist.json", encoding="utf-8") as f:
        watchlist = json.load(f)
    seen, symbols = set(), []

    def add(sym):
        if sym and sym not in seen:
            seen.add(sym)
            symbols.append(sym)

    for sector in watchlist.get("sectors", []):
        for sym in sector.get("ticker_overview", []):
            add(sym)
        for sub in sector.get("subsectors", []):
            for item in sub.get("tickers", sub.get("watchlist", [])):
                add(item.get("symbol"))
    return symbols


def compute_changes(symbols):
    """Return {symbol: {week_change_pct, month_change_pct, year_change_pct}}
    using a single batched yfinance download (bounded request count)."""
    import yfinance as yf

    print(f"Downloading 1y daily history for {len(symbols)} symbols …", flush=True)
    data = yf.download(
        tickers=symbols,
        period="1y",
        interval="1d",
        group_by="ticker",
        auto_adjust=True,
        threads=True,
        progress=False,
    )

    def pct(last, prev):
        return round((last - prev) / prev * 100, 2) if prev else None

    out = {}
    for sym in symbols:
        try:
            # With multiple tickers yfinance returns a column-grouped frame;
            # with a single ticker it's flat. Handle both defensively.
            closes = (data[sym]["Close"] if sym in data.columns.get_level_values(0)
                      else data["Close"]).dropna()
        except Exception:
            print(f"  skip {sym}: no data", file=sys.stderr)
            continue
        if len(closes) < 2:
            print(f"  skip {sym}: insufficient history", file=sys.stderr)
            continue
        vals = [float(v) for v in closes.tolist()]
        last = vals[-1]
        # Indices mirror the Worker's spark logic so both data sources agree:
        #   week  ≈ 5 trading days back, month ≈ 22 trading days back, year = first close.
        wk = vals[-6]  if len(vals) > 5  else vals[0]
        mo = vals[-23] if len(vals) > 22 else vals[0]
        yr = vals[0]
        out[sym] = {
            "week_change_pct":  pct(last, wk),
            "month_change_pct": pct(last, mo),
            "year_change_pct":  pct(last, yr),
        }
    return out


def write_to_firestore(credentials_path, changes):
    import firebase_admin
    from firebase_admin import credentials, firestore

    cred = credentials.Certificate(credentials_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    count = 0
    batch = db.batch()
    for symbol, fields in changes.items():
        ref = db.collection("prices").document(symbol)
        batch.set(ref, fields, merge=True)  # merge: preserve Worker-owned fields
        count += 1
        if count % 400 == 0:
            batch.commit()
            batch = db.batch()
    if count % 400 != 0:
        batch.commit()
    return count


def main():
    parser = argparse.ArgumentParser(description="Merge week/month/year % into Firestore")
    parser.add_argument("--credentials", required=True, help="Firebase service account JSON")
    args = parser.parse_args()

    try:
        import yfinance  # noqa: F401
    except ImportError:
        print("yfinance not installed. Run: pip install yfinance", file=sys.stderr)
        sys.exit(1)

    symbols = load_symbols()
    if not symbols:
        print("No symbols found in watchlist.json", file=sys.stderr)
        sys.exit(1)

    changes = compute_changes(symbols)
    if not changes:
        print("No change data computed — aborting without writing.", file=sys.stderr)
        sys.exit(1)

    written = write_to_firestore(args.credentials, changes)
    print(f"\nMerged week/month/year % into {written} Firestore price docs.")


if __name__ == "__main__":
    main()
