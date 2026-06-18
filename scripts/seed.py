#!/usr/bin/env python3
"""
seed.py — Seed Firestore from data/watchlist.json and data/prices.json.

Usage:
    pip install firebase-admin
    python scripts/seed.py --credentials path/to/service-account.json
"""

import argparse
import json
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="Seed Firestore from local JSON files")
    parser.add_argument("--credentials", required=True, help="Path to Firebase service account JSON")
    parser.add_argument(
        "--watchlist", default="data/watchlist.json", help="Path to watchlist.json"
    )
    parser.add_argument(
        "--prices", default="data/prices.json", help="Path to prices.json"
    )
    args = parser.parse_args()

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("ERROR: firebase-admin is not installed. Run: pip install firebase-admin")
        sys.exit(1)

    cred = credentials.Certificate(args.credentials)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    # ── Load files ───────────────────────────────────────────────────────────
    if not os.path.exists(args.watchlist):
        print(f"ERROR: {args.watchlist} not found")
        sys.exit(1)
    if not os.path.exists(args.prices):
        print(f"WARNING: {args.prices} not found — skipping prices")
        prices_data = {}
    else:
        with open(args.prices) as f:
            raw = json.load(f)
            prices_data = raw.get("prices", raw)

    with open(args.watchlist) as f:
        watchlist = json.load(f)

    sectors = watchlist.get("sectors", [])

    # ── Seed sectors, subsectors, tickers, analysis, research_notes ─────────
    for order_s, sector in enumerate(sectors):
        print(f"  Sector: {sector['name']}")
        sec_ref = db.collection("sectors").document()
        sec_ref.set({
            "name": sector["name"],
            "order": sector.get("order", order_s),
            "ticker_overview": sector.get("ticker_overview", []),
        })
        sector_id = sec_ref.id

        for order_sub, sub in enumerate(sector.get("subsectors", [])):
            print(f"    Subsector: {sub['name']}")
            sub_ref = db.collection("subsectors").document()
            sub_ref.set({
                "sector_id": sector_id,
                "name": sub["name"],
                "order": sub.get("order", order_sub),
                "notes": sub.get("notes", ""),
            })
            subsector_id = sub_ref.id

            for order_t, ticker in enumerate(sub.get("watchlist", sub.get("tickers", []))):
                db.collection("tickers").add({
                    "subsector_id": subsector_id,
                    "symbol": ticker["symbol"],
                    "name": ticker.get("name", ""),
                    "market": ticker.get("market", "US"),
                    "order": ticker.get("order", order_t),
                })

            for order_a, analysis in enumerate(sub.get("analysis", [])):
                db.collection("analysis").add({
                    "subsector_id": subsector_id,
                    "title": analysis.get("title", ""),
                    "columns": analysis.get("columns", []),
                    "rows": analysis.get("rows", []),
                    "order": analysis.get("order", order_a),
                })

            for order_n, note in enumerate(sub.get("research_notes", [])):
                db.collection("research_notes").add({
                    "subsector_id": subsector_id,
                    "title": note.get("title", ""),
                    "content": note.get("content", ""),
                    "order": note.get("order", order_n),
                })

    print(f"Sectors seeded: {len(sectors)}")

    # ── Seed prices ──────────────────────────────────────────────────────────
    batch_count = 0
    batch = db.batch()
    for symbol, price in prices_data.items():
        ref = db.collection("prices").document(symbol)
        batch.set(ref, price)
        batch_count += 1
        if batch_count >= 400:
            batch.commit()
            batch = db.batch()
            batch_count = 0
    if batch_count > 0:
        batch.commit()

    print(f"Prices seeded: {len(prices_data)} symbols")
    print("Done.")


if __name__ == "__main__":
    main()
