#!/usr/bin/env python3
"""Write a source-health report and reject failed required public captures."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def configured_public_sources(config: dict) -> dict[str, dict]:
    sources = {}
    for feed in config.get("rss_feeds", []):
        sources[feed.get("name", feed["url"])] = {
            "competitor": feed["competitor"],
            "kind": "rss",
            "url": feed["url"],
        }
    for newsroom in config.get("newsrooms", []):
        sources[newsroom.get("name", newsroom["index_url"])] = {
            "competitor": newsroom["competitor"],
            "kind": "newsroom",
            "url": newsroom["index_url"],
        }
    return sources


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate public-source capture health")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("sources.json"))
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--linkedin", type=Path, help="Optional manual LinkedIn capture status")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    config = load_json(args.config)
    raw = load_json(args.raw)
    required = configured_public_sources(config)
    by_source = {name: [] for name in required}
    for item in raw.get("items", []):
        if item.get("source_name") in by_source:
            by_source[item["source_name"]].append(item)

    sources = []
    failures = []
    for name, definition in required.items():
        items = by_source[name]
        errors = [item for item in items if item.get("error")]
        status = "failed" if errors else "healthy" if items else "missing"
        record = {
            "name": name,
            **definition,
            "status": status,
            "captured_items": len(items) - len(errors),
            "errors": [item.get("summary", "Unknown capture error") for item in errors],
        }
        sources.append(record)
        if status != "healthy":
            failures.append(f"{name}: {status}")

    linkedin_status = None
    if args.linkedin and args.linkedin.exists():
        linkedin = load_json(args.linkedin)
        linkedin_status = {
            "mode": "manual",
            "captured_at": linkedin.get("captured_at"),
            "captured_items": linkedin.get("count", 0),
            "status": "attention_needed" if linkedin.get("count", 0) == 0 else "available",
        }

    report = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "raw_capture_at": raw.get("captured_at"),
        "status": "failed" if failures else "healthy",
        "required_public_sources": sources,
        "manual_linkedin": linkedin_status,
        "failures": failures,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if failures:
        print("Capture health check failed: " + "; ".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print(f"Capture health check passed for {len(sources)} required public sources")


if __name__ == "__main__":
    main()