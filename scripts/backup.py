#!/usr/bin/env python3
"""
backup.py — Export or import Firestore data ↔ JSON cold backup files.

Usage:
    pip install firebase-admin
    python scripts/backup.py --export --credentials path/to/service-account.json
    python scripts/backup.py --import  --credentials path/to/service-account.json
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser(description="Firestore ↔ JSON backup")
    parser.add_argument("--credentials", required=True, help="Path to Firebase service account JSON")
    parser.add_argument("--export", action="store_true", help="Export Firestore → JSON")
    parser.add_argument("--import", dest="do_import", action="store_true", help="Import JSON → Firestore")
    parser.add_argument("--watchlist", default="data/watchlist.json")
    parser.add_argument("--prices", default="data/prices.json")
    args = parser.parse_args()

    if not args.export and not args.do_import:
        print("ERROR: specify --export or --import")
        sys.exit(1)

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("ERROR: firebase-admin not installed. Run: pip install firebase-admin")
        sys.exit(1)

    cred = credentials.Certificate(args.credentials)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    if args.export:
        do_export(db, args.watchlist, args.prices)
    else:
        do_import(db, args.watchlist, args.prices)


# ─── Export ───────────────────────────────────────────────────────────────────

def do_export(db, watchlist_path, prices_path):
    print("Exporting from Firestore…")

    # Sectors
    sectors_raw = list(db.collection("sectors").order_by("order").stream())
    sectors = []
    for sec_doc in sectors_raw:
        sec = sec_doc.to_dict()
        sec["id"] = sec_doc.id
        # Subsectors
        subs_raw = list(
            db.collection("subsectors")
            .where("sector_id", "==", sec_doc.id)
            .order_by("order")
            .stream()
        )
        subsectors = []
        for sub_doc in subs_raw:
            sub = sub_doc.to_dict()
            sub["id"] = sub_doc.id
            # Tickers
            tickers = [
                dict(t.to_dict(), id=t.id)
                for t in db.collection("tickers")
                .where("subsector_id", "==", sub_doc.id)
                .order_by("order")
                .stream()
            ]
            sub["tickers"] = tickers
            # Analysis
            analysis = [
                dict(a.to_dict(), id=a.id)
                for a in db.collection("analysis")
                .where("subsector_id", "==", sub_doc.id)
                .order_by("order")
                .stream()
            ]
            sub["analysis"] = analysis
            # Research notes
            notes = [
                dict(n.to_dict(), id=n.id)
                for n in db.collection("research_notes")
                .where("subsector_id", "==", sub_doc.id)
                .order_by("order")
                .stream()
            ]
            sub["research_notes"] = notes
            subsectors.append(sub)
        sec["subsectors"] = subsectors
        sectors.append(sec)

    watchlist_data = {"sectors": sectors}
    os.makedirs(os.path.dirname(watchlist_path) or ".", exist_ok=True)
    with open(watchlist_path, "w", encoding="utf-8") as f:
        json.dump(watchlist_data, f, ensure_ascii=False, indent=2)
    print(f"  Written: {watchlist_path} ({len(sectors)} sectors)")

    # Prices
    prices_raw = list(db.collection("prices").stream())
    prices = {doc.id: doc.to_dict() for doc in prices_raw}
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prices_data = {"last_updated": ts, "prices": prices}
    with open(prices_path, "w", encoding="utf-8") as f:
        json.dump(prices_data, f, ensure_ascii=False, indent=2)
    print(f"  Written: {prices_path} ({len(prices)} symbols)")
    print("Export done.")


# ─── Import ───────────────────────────────────────────────────────────────────

def do_import(db, watchlist_path, prices_path):
    print("Importing to Firestore…")

    if not os.path.exists(watchlist_path):
        print(f"ERROR: {watchlist_path} not found")
        sys.exit(1)

    with open(watchlist_path, encoding="utf-8") as f:
        watchlist = json.load(f)

    sectors = watchlist.get("sectors", [])
    for order_s, sector in enumerate(sectors):
        print(f"  Sector: {sector['name']}")
        sec_ref = db.collection("sectors").document(sector.get("id") or None)
        sec_ref.set({
            "name": sector["name"],
            "order": sector.get("order", order_s),
            "ticker_overview": sector.get("ticker_overview", []),
        }, merge=True)
        sector_id = sec_ref.id

        for order_sub, sub in enumerate(sector.get("subsectors", [])):
            sub_ref = db.collection("subsectors").document(sub.get("id") or None)
            sub_ref.set({
                "sector_id": sector_id,
                "name": sub["name"],
                "order": sub.get("order", order_sub),
                "notes": sub.get("notes", ""),
            }, merge=True)
            subsector_id = sub_ref.id

            for order_t, ticker in enumerate(sub.get("tickers", sub.get("watchlist", []))):
                t_ref = db.collection("tickers").document(ticker.get("id") or None)
                t_ref.set({
                    "subsector_id": subsector_id,
                    "symbol": ticker["symbol"],
                    "name": ticker.get("name", ""),
                    "market": ticker.get("market", "US"),
                    "order": ticker.get("order", order_t),
                }, merge=True)

            for order_a, analysis in enumerate(sub.get("analysis", [])):
                a_ref = db.collection("analysis").document(analysis.get("id") or None)
                a_ref.set({
                    "subsector_id": subsector_id,
                    "title": analysis.get("title", ""),
                    "columns": analysis.get("columns", []),
                    "rows": analysis.get("rows", []),
                    "order": analysis.get("order", order_a),
                }, merge=True)

            for order_n, note in enumerate(sub.get("research_notes", [])):
                n_ref = db.collection("research_notes").document(note.get("id") or None)
                n_ref.set({
                    "subsector_id": subsector_id,
                    "title": note.get("title", ""),
                    "content": note.get("content", ""),
                    "order": note.get("order", order_n),
                }, merge=True)

    print(f"  Watchlist imported: {len(sectors)} sectors")

    # Prices
    if os.path.exists(prices_path):
        with open(prices_path, encoding="utf-8") as f:
            raw = json.load(f)
        prices = raw.get("prices", raw)
        batch_count = 0
        batch = db.batch()
        for symbol, price in prices.items():
            ref = db.collection("prices").document(symbol)
            batch.set(ref, price, merge=True)
            batch_count += 1
            if batch_count >= 400:
                batch.commit()
                batch = db.batch()
                batch_count = 0
        if batch_count > 0:
            batch.commit()
        print(f"  Prices imported: {len(prices)} symbols")
    else:
        print(f"  Prices file not found ({prices_path}), skipped")

    print("Import done.")


if __name__ == "__main__":
    main()
