#!/usr/bin/env python3
"""
Fetch closing prices for all symbols in data/watchlist.json
and write the result to data/prices.json.

Run daily by GitHub Actions after market close.
Requires: pip install yfinance
"""

import json
import sys
from datetime import datetime, date
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("yfinance not installed. Run: pip install yfinance", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).parent.parent


def load_watchlist() -> dict:
    with open(ROOT / "data" / "watchlist.json", encoding="utf-8") as f:
        return json.load(f)


def collect_symbols(watchlist: dict) -> list[str]:
    """Return deduplicated list of every symbol referenced in the watchlist."""
    seen: set[str] = set()
    symbols: list[str] = []

    for sector in watchlist.get("sectors", []):
        for sym in sector.get("ticker_overview", []):
            if sym not in seen:
                seen.add(sym)
                symbols.append(sym)
        for sub in sector.get("subsectors", []):
            for item in sub.get("watchlist", []):
                sym = item["symbol"]
                if sym not in seen:
                    seen.add(sym)
                    symbols.append(sym)

    return symbols


def fmt_market_cap(raw: float) -> tuple[float, str]:
    """Return (value, suffix) rounded to 2 dp."""
    if raw >= 1e12:
        return round(raw / 1e12, 2), "T"
    if raw >= 1e9:
        return round(raw / 1e9, 2), "B"
    if raw >= 1e6:
        return round(raw / 1e6, 2), "M"
    return round(raw, 2), ""


def detect_currency(symbol: str) -> str:
    if symbol.endswith(".TW"):
        return "TWD"
    return "USD"


def fetch_prices(symbols: list[str]) -> dict:
    result: dict = {}

    for symbol in symbols:
        print(f"  Fetching {symbol} …", flush=True)
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}

            # Use 1-year daily history for change calculations
            hist = ticker.history(period="1y", auto_adjust=True)

            if hist.empty or len(hist) < 2:
                print(f"    ⚠ No history for {symbol}", file=sys.stderr)
                continue

            closes = hist["Close"]
            volumes = hist["Volume"]

            last_close  = float(closes.iloc[-1])
            prev_close  = float(closes.iloc[-2])
            week_ago    = float(closes.iloc[-6])   if len(closes) > 5  else float(closes.iloc[0])
            month_ago   = float(closes.iloc[-22])  if len(closes) > 21 else float(closes.iloc[0])
            year_ago    = float(closes.iloc[0])
            day_volume  = int(volumes.iloc[-1])

            def pct(a, b):
                return round((a - b) / b * 100, 2) if b else 0.0

            raw_mcap = info.get("marketCap") or 0
            mcap_val, mcap_sfx = fmt_market_cap(raw_mcap)
            currency = detect_currency(symbol)

            # Round price appropriately
            price = round(last_close, 0) if currency == "TWD" else round(last_close, 2)

            result[symbol] = {
                "name": info.get("shortName", ""),
                "last": price,
                "day_change_pct":   pct(last_close, prev_close),
                "week_change_pct":  pct(last_close, week_ago),
                "month_change_pct": pct(last_close, month_ago),
                "year_change_pct":  pct(last_close, year_ago),
                "pe_ratio":         round(info.get("trailingPE") or 0, 2),
                "market_cap":       mcap_val,
                "market_cap_suffix": mcap_sfx,
                "market_cap_currency": currency,
                "day_volume":       day_volume,
            }

        except Exception as exc:
            print(f"    ✗ Error fetching {symbol}: {exc}", file=sys.stderr)

    return result


def main():
    print("Loading watchlist …")
    watchlist = load_watchlist()
    symbols   = collect_symbols(watchlist)
    print(f"Found {len(symbols)} symbols: {symbols}\n")

    print("Fetching prices …")
    prices = fetch_prices(symbols)

    output = {
        "last_updated": date.today().isoformat(),
        "prices": prices,
    }

    out_path = ROOT / "data" / "prices.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Updated {len(prices)} symbols → {out_path}")


if __name__ == "__main__":
    main()
