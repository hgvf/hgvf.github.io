# Watchlist Guide

How to manage the stock watchlist site day-to-day.

---

## Two Ways to Edit Watchlist Data

### Option 1: Admin UI (preferred)

1. Go to the site, click **Sign In** in the sidebar
2. The site adds edit/delete buttons next to every element
3. Changes go directly to Firestore — no rebuild needed
4. Prices update live via real-time Firestore listener

### Option 2: Edit JSON + backup.py import

1. Edit `data/watchlist.json` locally
2. Run `python scripts/backup.py --import --credentials /path/to/sa.json`
3. To export current Firestore state: `python scripts/backup.py --export --credentials /path/to/sa.json`

---

## Admin UI Button Reference

### Sector Tabs
- **✎** (next to tab name) — rename the sector or change ticker_overview symbols
- **✕** (next to tab name) — delete the sector and all its subsectors/tickers
- **+ Add Sector** — button at the end of the tab bar

### Subsector Title
- **✎** — rename subsector
- **✕** — delete subsector
- **+ Add Subsector** — button at the bottom of a sector's content area

### Notes Panel
- **✎ Edit Notes** — opens a textarea for the markdown notes
- Supports: `**bold**`, `- bullets`, `# headings`, `## subheadings`

### Watchlist Table
- **✎** (per row) — edit symbol, name, market, order
- **✕** (per row) — remove ticker
- **+ Add Ticker** — button in the table footer

### Analysis Tables
- **✎** (next to title) — edit title, columns (comma-separated), rows (one per line, `|` separator)
- **✕** (next to title) — delete table
- **+ Add Analysis** — appears below analysis tables

### Research Note Cards
- **▾** (click card header) — expand/collapse content
- **✎** — edit title, content (full markdown), order
- **✕** — delete note
- **+ Add Research Note** — appears below research cards

### Header Buttons
- **Refresh Prices** — calls the Cloudflare Worker to fetch current prices; visible to all but requires the Worker secret in Firestore to work
- **Export** (admin only) — downloads all Firestore data as `watchlist.json`
- **Import** (admin only) — uploads a JSON file and seeds Firestore

### Sidebar
- **Manage Whitelist** — add/remove admin email addresses

---

## Research Notes Format

Research notes are per-subsector expandable cards. Each note has:
- **Title** — shown in the collapsed card header (e.g. "Astera Labs 介紹")
- **Content** — full markdown:
  ```
  # Main Heading
  
  ## Subheading
  
  - **Company**: description here
  - **Another point**: more detail
  
  Plain paragraph text.
  ```
- **Order** — numeric sort order within the subsector

---

## JSON Schema (Cold Backup)

### data/watchlist.json
```json
{
  "sectors": [
    {
      "id": "optional-doc-id",
      "name": "Sector Name",
      "order": 0,
      "ticker_overview": ["SYM1", "SYM2"],
      "subsectors": [
        {
          "id": "optional-doc-id",
          "name": "Subsector Name",
          "order": 0,
          "notes": "- **Co**: description\n- **Co2**: notes",
          "tickers": [
            { "symbol": "NVDA", "name": "NVIDIA Corp.", "market": "US", "order": 0 }
          ],
          "analysis": [
            {
              "title": "Revenue Breakdown",
              "columns": ["Company", "Category", "Detail"],
              "rows": [["NVDA", "Data Center", "87%"]],
              "order": 0
            }
          ],
          "research_notes": [
            {
              "title": "NVDA Introduction",
              "content": "# NVIDIA\n\n- **GPU leader**: dominates AI training",
              "order": 0
            }
          ]
        }
      ]
    }
  ]
}
```

### data/prices.json
```json
{
  "last_updated": "2025-01-01 02:15 UTC",
  "prices": {
    "NVDA": {
      "name": "NVIDIA Corp.",
      "last": 875.50,
      "day_change_pct": 2.34,
      "week_change_pct": 5.12,
      "month_change_pct": 12.50,
      "year_change_pct": 180.25,
      "pe_ratio": 65.4,
      "market_cap": 2.15,
      "market_cap_suffix": "T",
      "market_cap_currency": "USD",
      "day_volume": 42000000,
      "last_updated": "2025-01-01 02:15:00 UTC"
    }
  }
}
```

---

## Cloudflare Worker Manual Trigger

The Worker fetches prices from Yahoo Finance and writes to Firestore.

**Via UI**: Click **Refresh Prices** button in the watchlist page header.

**Via curl** (requires knowing the secret):
```bash
curl -X POST https://watchlist-worker.YOUR_SUBDOMAIN.workers.dev/trigger \
  -H "Authorization: Bearer YOUR_TRIGGER_SECRET"
```

**Automatic schedule**: Runs at 02:00 UTC, Tuesday–Saturday (covers Mon–Fri US market closes).

---

## Adding a New Sector (Quick Reference)

1. Click **+ Add Sector** at the end of the sector tab bar
2. Enter name, order number, and comma-separated ticker_overview symbols
3. Click **Save**
4. The new sector tab appears — click it
5. Click **+ Add Subsector**, fill in name
6. Click **+ Add Ticker** in the watchlist table to add tickers
7. Click **Refresh Prices** to fetch prices for the new tickers
