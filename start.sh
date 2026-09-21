#!/usr/bin/env bash
# Start the Competitor Tracking Engine locally
cd "$(dirname "$0")"
echo "Starting at http://127.0.0.1:8765/"
python3 -m http.server 8765 --bind 127.0.0.1
