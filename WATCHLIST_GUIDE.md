# Watchlist Guide

Everything the website displays is driven by two JSON files:

| File | Purpose |
|---|---|
| `data/watchlist.json` | Structure: sectors, subsectors, notes, symbol list |
| `data/prices.json` | Price data updated daily by the automation script |

You only ever edit `watchlist.json` by hand.  `prices.json` is written by the script.

---

## `data/watchlist.json` — Full Schema

```jsonc
{
  "sectors": [
    {
      "id":             "unique-slug",          // used internally; no spaces
      "name":           "Tab display name",     // shown in the sector tab bar
      "ticker_overview": ["SYM1", "SYM2"],      // shown in the top ticker-performance bar

      "subsectors": [
        {
          "id":    "subsector-slug",
          "name":  "Subsector heading",

          // Markdown-lite notes shown in the left panel.
          // Supported syntax: **bold**, lines starting with "- " become bullets.
          "notes": "- **CRDO**: description…\n- **ALAB**: description…",

          // The watchlist table shown in the right panel.
          "watchlist": [
            {
              "symbol": "CRDO",                 // must match a key in prices.json
              "name":   "Credo Technology",     // full company name
              "market": "US"                    // "US" or "TW"
            }
          ],

          // Optional extra analysis tables below the two panels.
          "analysis": [
            {
              "title": "Table heading",
              "columns": ["Col A", "Col B", "Col C"],
              "rows": [
                ["row1a", "row1b", "row1c"],
                ["row2a", "row2b", "row2c"]
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## How to Add a New Sector (Tab)

1. Open `data/watchlist.json`.
2. Append a new object to the `"sectors"` array following the schema above.
3. Set `ticker_overview` to the symbols you want in the top bar (usually 4–8).
4. Add at least one subsector with a `watchlist`.
5. Add the new symbols to `data/prices.json` temporarily with placeholder values
   (or just run the update script manually — see below).

### Minimal new sector example

```json
{
  "id": "asic-ip",
  "name": "ASIC/IP",
  "ticker_overview": ["AVGO", "ARM", "CDNS"],
  "subsectors": [
    {
      "id": "asic-design",
      "name": "ASIC Design & EDA",
      "notes": "- **Broadcom (AVGO)**: Custom ASIC leader for hyperscalers (Google TPU, Meta MTIA).\n- **Arm (ARM)**: CPU IP licensor.",
      "watchlist": [
        { "symbol": "AVGO", "name": "Broadcom Inc.", "market": "US" },
        { "symbol": "ARM",  "name": "Arm Holdings",  "market": "US" },
        { "symbol": "CDNS", "name": "Cadence Design", "market": "US" }
      ]
    }
  ]
}
```

---

## Symbol Format

| Market | Format | Example |
|---|---|---|
| US (NASDAQ/NYSE) | Plain ticker | `CRDO`, `AVGO`, `TEL` |
| Taiwan (TWSE) | `NNNN.TW` | `3665.TW`, `2330.TW` |

TradingView links are auto-generated: `.TW` symbols map to `TWSE:NNNN`, others are passed as-is.

---

## Updating Prices Manually

```bash
pip install yfinance
python scripts/update_prices.py
```

This rewrites `data/prices.json`.  Commit and push to publish.

---

## Automation (GitHub Actions)

The workflow `.github/workflows/update_prices.yml` runs automatically:

- **Schedule**: every weekday at 02:00 UTC (≈ 10 PM ET, after US market close)
- **Manual trigger**: go to *Actions → Update Stock Prices → Run workflow*

The job fetches prices, updates `data/prices.json`, commits, and pushes.
GitHub Pages then rebuilds the site automatically.

No secrets are needed — `yfinance` uses free public data.

---

## Adding a New Tab (Non-Watchlist Page)

1. In `index.html`, add a `<nav>` link inside `.sidebar-nav`:
   ```html
   <a class="nav-item" data-page="blog" href="#">
     <span class="nav-icon"><!-- svg --></span>
     Blog
   </a>
   ```
2. Add the corresponding page section:
   ```html
   <section id="page-blog" class="page">
     <!-- your content -->
   </section>
   ```
   The JS router picks it up automatically via `data-page`.
