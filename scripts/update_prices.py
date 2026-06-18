#!/usr/bin/env python3
"""
Fetch closing prices for all symbols in data/watchlist.json
and write the result to data/prices.json.

Run daily by GitHub Actions after market close.
Requires: pip install yfinance
"""

import json
import sys
from datetime import date
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("yfinance not installed. Run: pip install yfinance", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).parent.parent


def load_watchlist():
    with open(ROOT / "data" / "watchlist.json", encoding="utf-8") as f:
        return json.load(f)


def collect_symbols(watchlist):
    seen, symbols = set(), []
    for sector in watchlist.get("sectors", []):
        for sym in sector.get("ticker_overview", []):
            if sym not in seen:
                seen.add(sym); symbols.append(sym)
        for sub in sector.get("subsectors", []):
            for item in sub.get("watchlist", []):
                sym = item["symbol"]
                if sym not in seen:
                    seen.add(sym); symbols.append(sym)
    return symbols


def fmt_market_cap(raw):
    if raw >= 1e12: return round(raw / 1e12, 2), "T"
    if raw >= 1e9:  return round(raw / 1e9, 2),  "B"
    if raw >= 1e6:  return round(raw / 1e6, 2),  "M"
    return round(raw, 2), ""


def fetch_prices(symbols):
    result = {}
    for symbol in symbols:
        print(f"  Fetching {symbol} ...", flush=True)
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            hist = ticker.history(period="1y", auto_adjust=True)
            if hist.empty or len(hist) < 2:
                print(f"    No history for {symbol}", file=sys.stderr)
                continue
            closes, volumes = hist["Close"], hist["Volume"]
            last  = float(closes.iloc[-1])
            prev  = float(closes.iloc[-2])
            wk    = float(closes.iloc[-6])  if len(closes) > 5  else float(closes.iloc[0])
            mo    = float(closes.iloc[-22]) if len(closes) > 21 else float(closes.iloc[0])
            yr    = float(closes.iloc[0])
            def pct(a, b): return round((a - b) / b * 100, 2) if b else 0.0
            is_tw = symbol.endswith(".TW")
            currency = "TWD" if is_tw else "USD"
            price = round(last, 0) if is_tw else round(last, 2)
            raw_mc = info.get("marketCap") or 0
            mc_val, mc_sfx = fmt_market_cap(raw_mc)
            result[symbol] = {
                "name": info.get("shortName", ""),
                "last": price,
                "day_change_pct":   pct(last, prev),
                "week_change_pct":  pct(last, wk),
                "month_change_pct": pct(last, mo),
                "year_change_pct":  pct(last, yr),
                "pe_ratio":         round(info.get("trailingPE") or 0, 2),
                "market_cap":       mc_val,
                "market_cap_suffix": mc_sfx,
                "market_cap_currency": currency,
                "day_volume":       int(volumes.iloc[-1]),
            }
        except Exception as exc:
            print(f"    Error fetching {symbol}: {exc}", file=sys.stderr)
    return result


def main():
    print("Loading watchlist ...")
    watchlist = load_watchlist()
    symbols = collect_symbols(watchlist)
    print(f"Found {len(symbols)} symbols: {symbols}\n")
    prices = fetch_prices(symbols)
    output = {"last_updated": date.today().isoformat(), "prices": prices}
    out_path = ROOT / "data" / "prices.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nUpdated {len(prices)} symbols -> {out_path}")


if __name__ == "__main__":
    main()
