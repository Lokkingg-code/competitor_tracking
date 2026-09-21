#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

npm run capture:linkedin
python3 scripts/capture/capture_sources.py --days 365
python3 scripts/merge_signals.py --raw data/raw/latest.json --raw data/raw/linkedin_latest.json