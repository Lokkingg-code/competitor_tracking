#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

BASE_REF="$(git rev-parse HEAD)"

npm run capture:linkedin
python3 scripts/capture/capture_sources.py --days 365

RAW_ARGS=(--raw data/raw/latest.json --raw data/raw/linkedin_latest.json)
if [[ -n "${SEARXNG_BASE_URL:-}" ]]; then
	python3 scripts/capture/capture_searxng.py --days 365
	RAW_ARGS+=(--raw data/raw/searxng_latest.json)
else
	echo "SEARXNG_BASE_URL is unset; skipping SearXNG capture."
fi

python3 scripts/merge_signals.py "${RAW_ARGS[@]}"

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
	python3 scripts/enrich_signals.py --base-ref "$BASE_REF"
else
	echo "GEMINI_API_KEY is unset; new signals remain pending for GitHub Actions enrichment."
fi