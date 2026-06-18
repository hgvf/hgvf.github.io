# Watchlist Guide

Two JSON files drive everything the website displays:

| File | Purpose |
|---|---|
| `data/watchlist.json` | Structure: sectors, subsectors, notes, symbol list |
| `data/prices.json` | Price data — updated daily by automation |

Only edit `watchlist.json` by hand. `prices.json` is written by the script.

---

## `data/watchlist.json` Schema

```jsonc
{
  "sectors": [
    {
      "id":   "unique-slug",
      "name": "Tab label",
      "ticker_overview": ["SYM1", "SYM2"],  // top ticker-performance bar

      "subsectors": [
        {
          "id":   "subsector-slug",
          "name": "Subsector heading",

          // Markdown-lite: **bold**, lines starting with "- " become bullets
          "notes": "- **CRDO**: description...\n- **ALAB**: ...",

          "watchlist": [
            { "symbol": "CRDO", "name": "Credo Technology", "market": "US" }
          ],

          // Optional extra analysis tables
          "analysis": [
            {
              "title": "Table heading",
              "columns": ["Col A", "Col B", "Col C"],
              "rows": [["r1a", "r1b", "r1c"], ["r2a", "r2b", "r2c"]]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Add a New Sector

1. Append an object to `"sectors"` in `data/watchlist.json`.
2. Set `ticker_overview` (4–8 symbols for the top bar).
3. Add subsectors with `notes` and `watchlist`.
4. Run the price update script once to populate the new symbols.

### Minimal example

```json
{
  "id": "asic-ip",
  "name": "ASIC/IP",
  "ticker_overview": ["AVGO", "ARM", "CDNS"],
  "subsectors": [
    {
      "id": "asic-design",
      "name": "ASIC Design & EDA",
      "notes": "- **Broadcom (AVGO)**: Custom ASIC for hyperscalers.\n- **Arm (ARM)**: CPU IP licensor.",
      "watchlist": [
        { "symbol": "AVGO", "name": "Broadcom Inc.", "market": "US" },
        { "symbol": "ARM",  "name": "Arm Holdings",  "market": "US" }
      ]
    }
  ]
}
```

---

## Symbol Formats

| Market | Format | Example |
|---|---|---|
| US (NASDAQ/NYSE) | Plain ticker | `CRDO`, `AVGO` |
| Taiwan (TWSE) | `NNNN.TW` | `3665.TW`, `2330.TW` |

TradingView links auto-generate: `.TW` → `TWSE:NNNN`, others pass through.

---

## Update Prices Manually

```bash
pip install yfinance
python scripts/update_prices.py
```

Commit and push `data/prices.json` to publish.

---

## GitHub Actions Automation

- **Schedule**: weekdays at 02:00 UTC (after US market close)
- **Manual**: Actions → Update Stock Prices → Run workflow

No API keys needed — yfinance uses free public data.

---

## Add a New Tab (non-watchlist page)

1. Add nav link in `index.html` inside `.sidebar-nav`:
   ```html
   <a class="nav-item" data-page="blog" href="#">
     <span class="nav-icon"><!-- svg --></span>
     Blog
   </a>
   ```
2. Add page section:
   ```html
   <section id="page-blog" class="page">
     <!-- content -->
   </section>
   ```
   The JS router picks it up automatically.
