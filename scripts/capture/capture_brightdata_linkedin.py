#!/usr/bin/env python3
"""Capture recent LinkedIn company posts with Bright Data and normalize them."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "scripts" / "capture" / "sources.json"
DEFAULT_OUTPUT = ROOT / "data" / "raw" / "linkedin_brightdata_latest.json"
DATASET_ID = "gd_lyy3tktm25m4avu764"
CLI_VERSION = "0.4.1"
MAX_RECORDS_PER_COMPANY = 5


def company_vanity_name(url: str) -> str | None:
    parts = [part for part in urlparse(url).path.split("/") if part]
    if len(parts) >= 2 and parts[0].lower() == "company":
        return parts[1].casefold()
    return None


def discovery_company_url(record: dict) -> str | None:
    discovery_input = record.get("discovery_input")
    if isinstance(discovery_input, dict):
        url = discovery_input.get("url")
        if isinstance(url, str) and company_vanity_name(url):
            return url
    return None


def post_date(value: object) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def capture_window(captured_at: datetime, lookback_days: int) -> tuple[date, date]:
    end_date = captured_at.date() - timedelta(days=1)
    start_date = end_date - timedelta(days=lookback_days - 1)
    return start_date, end_date


def clean_text(value: object) -> str:
    text = str(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"')
    return re.sub(r"\s+", " ", text).strip()


def post_title(record: dict, summary: str) -> str:
    for candidate in (record.get("headline"), record.get("title")):
        title = clean_text(candidate)
        if not title:
            continue
        if re.search(r"\bactivity on linkedin\b|\b(?:foreflight|linkedin)(?:'|\u2019)s post\b", title, re.I):
            continue
        return title[:180]
    return summary[:180]


def post_summary(record: dict) -> str:
    summary = clean_text(record.get("post_text") or record.get("original_post_text") or record.get("post_text_html"))
    repost = record.get("repost")
    repost_text = clean_text(repost.get("repost_text")) if isinstance(repost, dict) else ""
    if repost_text and repost_text.casefold() not in summary.casefold():
        summary = f"{summary}\nReposted content: {repost_text}" if summary else repost_text
    return summary


def normalize_results(
    records: list[dict],
    organizations: list[dict],
    captured_at: datetime,
    lookback_days: int,
) -> dict:
    organizations_by_vanity = {
        str(organization["vanity_name"]).casefold(): organization
        for organization in organizations
        if organization.get("vanity_name")
    }
    checks = {
        vanity: {
            "competitor": organization.get("competitor", "Others"),
            "vanity_name": vanity,
            "requested_url": f"https://www.linkedin.com/company/{vanity}",
            "posts_seen": 0,
            "posts_captured": 0,
            "posts_skipped": 0,
            "errors": 0,
            "status": "ok",
        }
        for vanity, organization in organizations_by_vanity.items()
    }
    cutoff, window_end = capture_window(captured_at, lookback_days)
    items = []
    seen_urls = set()

    for record in records:
        if not isinstance(record, dict):
            continue
        origin_url = discovery_company_url(record)
        vanity = company_vanity_name(origin_url or "")
        if vanity not in organizations_by_vanity:
            continue
        check = checks[vanity]
        check["posts_seen"] += 1
        if record.get("error"):
            check["errors"] += 1
            check["status"] = "partial_capture"
            continue

        url = str(record.get("url") or "").split("#", 1)[0].strip()
        canonical_url = url.split("?", 1)[0].rstrip("/").casefold()
        published = post_date(record.get("date_posted") or record.get("published_at") or record.get("timestamp"))
        summary = post_summary(record)
        title_source = clean_text(
            record.get("post_text") or record.get("original_post_text") or record.get("post_text_html")
        ) or summary
        if not url.startswith("https://www.linkedin.com/") or not published or not summary:
            check["posts_skipped"] += 1
            continue
        if published < cutoff or published > window_end or canonical_url in seen_urls:
            check["posts_skipped"] += 1
            continue

        organization = organizations_by_vanity[vanity]
        competitor = organization.get("competitor", "Others")
        identifier = hashlib.sha1(f"{competitor}|{url}".encode()).hexdigest()[:12]
        normalized_item = {
            "id": f"browser-{identifier}",
            "competitor": competitor,
            "source_name": "LinkedIn Bright Data collector",
            "captured_via": "brightdata_linkedin",
            "source_channel": "linkedin",
            "post_type": record.get("post_type", "post"),
            "title": post_title(record, title_source),
            "url": url,
            "summary": summary[:5000],
            "published_at": published.isoformat(),
        }
        repost = record.get("repost")
        if isinstance(repost, dict) and repost.get("repost_user_id"):
            normalized_item["repost_author_id"] = repost["repost_user_id"]
        items.append(normalized_item)
        seen_urls.add(canonical_url)
        check["posts_captured"] += 1

    return {
        "captured_at": captured_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "capture_mode": "brightdata_api",
        "lookback_days": lookback_days,
        "cutoff": cutoff.isoformat(),
        "window_end": window_end.isoformat(),
        "limit_per_company": MAX_RECORDS_PER_COMPANY,
        "count": len(items),
        "checks": list(checks.values()),
        "items": items,
    }


def build_cli_command(
    organizations: list[dict],
    start_date: str,
    end_date: str,
    result_path: Path,
    limit_per_company: int,
) -> list[str]:
    urls = [
        f"https://www.linkedin.com/company/{organization['vanity_name']}"
        for organization in organizations
    ]
    return [
        "npx", "--yes", "--package", f"@brightdata/cli@{CLI_VERSION}",
        "brightdata", "pipelines", "run", DATASET_ID, "discover_by_company_url",
        *urls,
        "--start_date", start_date,
        "--end_date", end_date,
        "--limit-per-input", str(limit_per_company),
        "--format", "json",
        "--output", str(result_path),
    ]


def load_organizations() -> list[dict]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return config.get("linkedin_organizations", [])


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture configured LinkedIn companies via Bright Data")
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--limit-per-company", type=int, default=MAX_RECORDS_PER_COMPANY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if not os.environ.get("BRIGHTDATA_API_KEY"):
        parser.error("BRIGHTDATA_API_KEY is required")
    if not 1 <= args.days <= 90:
        parser.error("--days must be between 1 and 90")
    if not 1 <= args.limit_per_company <= MAX_RECORDS_PER_COMPANY:
        parser.error(f"--limit-per-company must be between 1 and {MAX_RECORDS_PER_COMPANY}")

    organizations = load_organizations()
    if not organizations:
        parser.error("No LinkedIn organizations are configured in sources.json")
    captured_at = datetime.now(timezone.utc)
    start_date, end_date = capture_window(captured_at, args.days)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temporary_directory:
        result_path = Path(temporary_directory) / "brightdata-results.json"
        command = build_cli_command(
            organizations,
            start_date.isoformat(),
            end_date.isoformat(),
            result_path,
            args.limit_per_company,
        )
        subprocess.run(command, check=True, cwd=ROOT)
        records = json.loads(result_path.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise ValueError("Bright Data returned an unexpected result shape")

    payload = normalize_results(records, organizations, captured_at, args.days)
    temporary_output = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary_output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary_output.replace(args.output)
    print(f"Bright Data LinkedIn capture: {payload['count']} posts from {len(organizations)} company pages")
    for check in payload["checks"]:
        print(
            f"  {check['vanity_name']}: captured={check['posts_captured']} "
            f"skipped={check['posts_skipped']} errors={check['errors']}"
        )
    print(f"Wrote {args.output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()