# Competitor Tracking Engine

A static dashboard for reviewing public competitor signals and a separate Airtable-based Airline Insights snapshot. The browser displays saved JSON files; it does not scrape LinkedIn or query Airtable when a page opens.

## Quick Start

Requirements for viewing the dashboard: Python 3.

```sh
bash start.sh
```

Open <http://127.0.0.1:8765/> and leave the server running. Stop it with `Ctrl+C`. Serve the folder over HTTP rather than opening an HTML file directly.

No frontend build step is required. Install Node dependencies only when using the local LinkedIn browser collector or Node-based AI checks:

```sh
npm install
npx playwright install chromium
```

## Dashboard Pages

- **Signal feed** (`index.html`, `js/app.js`): searches and filters saved competitor signals and displays their briefings and activity summaries.
- **Market matrix** (`matrix.html`, `js/matrix.js`): groups signals by competitor and inferred airline/operator mentions.
- **Reference library** (`references.html`, `js/references.js`): displays the configured source registry.
- **Airline Insights** (`airline-insights.html`, `js/airline-insights.js`): displays aggregate airline, fleet, regional, and system-adoption data. This pipeline is separate from the competitor signal feed.

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for dashboard workflows.

## Competitor Signal Data

The signal pipeline is:

1. Configure public sources and LinkedIn organizations in `scripts/capture/sources.json`.
2. Collect source results into raw JSON files under `data/raw/`.
3. Normalize, filter, classify, and deduplicate candidates in `scripts/merge_signals.py`.
4. Save the dashboard feed and archive in `data/signals.json` and `data/signals.archive.json`.
5. Optionally add AI summaries and competitive insights during the GitHub Actions refresh.

The scheduled **Refresh competitor signals** workflow runs daily at 06:00 UTC. Bright Data LinkedIn capture defaults to the previous complete UTC calendar day, with a maximum of five returned posts per configured company page. The current registry has 10 LinkedIn organization pages, so the hard maximum is 50 delivered records per daily run.

To change the LinkedIn schedule, set the GitHub Actions repository variable `BRIGHTDATA_LINKEDIN_INTERVAL_DAYS` to `1` (daily, the default) or `2` (every other day, covering two complete UTC days). A manual workflow run can enable `capture_linkedin` and choose a one- or two-day lookback. The merger applies relevance and noise filters before new records enter the dashboard feed.

Required GitHub Actions secrets and optional configuration:

- `BRIGHTDATA_API_KEY`: required for Bright Data LinkedIn capture.
- `GEMINI_API_KEY`: used for AI enrichment and generated insight summaries.
- `SEARXNG_BASE_URL`: optional Actions variable for public-news search through a SearXNG instance.

Add secrets under **Settings → Secrets and variables → Actions**. Never put API keys in source files or commit them. For model names and AI behavior, see [docs/AI_CONNECTION.md](docs/AI_CONNECTION.md).

### Local Capture Options

The scheduled workflow uses Bright Data; the older browser collector remains available as a local fallback. It requires the Node dependencies, Chromium, and a signed-in LinkedIn browser profile.

```sh
npm run capture:linkedin
```

The manual full capture-and-merge path is:

```sh
npm run capture:weekly
```

These commands write capture data and may update the signal feed/archive. Review the output before committing it.

## Airline Insights Data

Airline Insights is a saved snapshot, not a live browser connection. The daily GitHub Actions refresh can read the Airtable `Airline` and `Events` tables through the API and rebuild `data/airline-insights.json`. It requests only fields used by the snapshot builder and never reads the `Contact` table. Without `AIRTABLE_API_TOKEN`, the workflow keeps the current snapshot.

For the API refresh, create a Personal Access Token with only `data.records:read`, limited to this base, and add it as the GitHub Actions secret `AIRTABLE_API_TOKEN`. Airtable Free currently allows 1,000 API requests per workspace per month and 1,000 records per base; the base-wide record limit includes all tables, not just Airline and Events. The shared Airline and Contact views already show 708 records combined, so check the other tables and total API usage in Airtable before relying on Free limits. See [Airtable's API limits](https://support.airtable.com/docs/managing-api-call-limits-in-airtable) and [plan details](https://support.airtable.com/docs/airtable-plans).

For a manual/local refresh, provide `AIRTABLE_API_TOKEN` through a secure environment-variable mechanism, then run:

```sh
python3 scripts/sync_airline_insights.py
```

The CSV builder remains available for offline exports. Keep those exports outside the repository, especially if they include contact or account notes:

```sh
python3 scripts/build_airline_insights.py \
  --airlines-csv /path/to/airline-export.csv \
  --events-csv /path/to/events-export.csv
```

The builder writes `data/airline-insights.json`. Optional override files in `data/` correct confirmed airline types, headquarters, and conference end dates. The AI summary is generated separately:

```sh
npm run insights:airline-ai
```

This command requires `GEMINI_API_KEY`; the summary uses aggregate snapshot data, not airline contacts or notes.

## Tests

Run the Python tests directly:

```sh
python3 -m unittest discover -s tests -q
```

The Node browser tests use Playwright and expect the dashboard at port `8766`.
Start a static server in one terminal, then run the tests in a second terminal:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

```sh
node --test tests/*.test.mjs
```

## Repository Map

- `index.html`, `matrix.html`, `references.html`, `airline-insights.html`: dashboard pages.
- `js/` and `css/`: browser-side behavior and styling.
- `data/`: saved dashboard JSON and source registries; `data/raw/` contains capture outputs.
- `scripts/capture/`: source configuration and collectors.
- `scripts/merge_signals.py`: signal filtering, normalization, classification, and deduplication.
- `scripts/build_airline_insights.py`: Airtable CSV to aggregate snapshot builder.
- `.github/workflows/refresh-signals.yml`: scheduled and manually dispatched signal refresh.
- `tests/`: Python and Node regression tests.
- `docs/`: user guide, signal review notes, and AI/provider setup notes.
