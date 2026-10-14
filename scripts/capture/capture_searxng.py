#!/usr/bin/env python3
"""Capture public competitor news results from an optional SearXNG instance."""

from __future__ import annotations

import argparse
import html
import ipaddress
import hashlib
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).with_name("sources.json")
DEFAULT_OUTPUT = ROOT / "data" / "raw" / "searxng_latest.json"
USER_AGENT = "CompetitorTrackingEngine/0.1 (public news discovery)"
MAX_DATE_LOOKUPS_PER_QUERY = 3
MAX_ARTICLE_BYTES = 512_000


def search_time_range(days: int) -> str:
    if days <= 1:
        return "day"
    if days <= 7:
        return "week"
    if days <= 31:
        return "month"
    return "year"


def clean_query(query: str) -> str:
    return re.sub(r"\s+when:\d+d\b", "", query, flags=re.IGNORECASE).strip()


def build_search_url(base_url: str, query: str, days: int) -> str:
    parameters = urllib.parse.urlencode({
        "q": clean_query(query),
        "format": "json",
        "categories": "news",
        "language": "en",
        "time_range": search_time_range(days),
    })
    return f"{base_url.rstrip('/')}/search?{parameters}"


def result_date(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_page_publication_date(page: str) -> datetime | None:
    for tag in re.findall(r"<meta\b[^>]*>", page, flags=re.IGNORECASE):
        attrs = {
            key.lower(): html.unescape(value)
            for key, value in re.findall(r"([\w:-]+)\s*=\s*[\"']([^\"']*)[\"']", tag)
        }
        name = (attrs.get("property") or attrs.get("name") or "").casefold()
        if name in {"article:published_time", "datepublished", "date"}:
            parsed = result_date(attrs.get("content"))
            if parsed:
                return parsed

    for match in re.finditer(r"<time\b[^>]*>", page, flags=re.IGNORECASE):
        attrs = {
            key.lower(): html.unescape(value)
            for key, value in re.findall(r"([\w:-]+)\s*=\s*[\"']([^\"']*)[\"']", match.group(0))
        }
        parsed = result_date(attrs.get("datetime"))
        if parsed:
            return parsed

    match = re.search(r"[\"']datePublished[\"']\s*:\s*[\"']([^\"']+)", page, flags=re.IGNORECASE)
    return result_date(match.group(1)) if match else None


def is_public_http_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        hostname = parsed.hostname.casefold()
        if hostname == "localhost" or hostname.endswith((".local", ".internal", ".localhost")):
            return False
        try:
            addresses = [ipaddress.ip_address(hostname)]
        except ValueError:
            addresses = [
                ipaddress.ip_address(info[4][0])
                for info in socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
            ]
        return bool(addresses) and all(address.is_global for address in addresses)
    except (ValueError, OSError):
        return False


class PublicRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        if not is_public_http_url(new_url):
            return None
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def fetch_page_publication_date(url: str, timeout: int = 8) -> datetime | None:
    if not is_public_http_url(url):
        return None
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    opener = urllib.request.build_opener(PublicRedirectHandler())
    try:
        with opener.open(request, timeout=timeout) as response:
            if not is_public_http_url(response.geturl()):
                return None
            page = response.read(MAX_ARTICLE_BYTES).decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    return parse_page_publication_date(page)


def stable_id(competitor: str, url: str) -> str:
    canonical = urllib.parse.urlsplit(url)
    normalized_url = urllib.parse.urlunsplit((canonical.scheme.lower(), canonical.netloc.lower(), canonical.path.rstrip("/"), "", ""))
    digest = hashlib.sha1(f"{competitor}|{normalized_url}".encode("utf-8")).hexdigest()[:12]
    return f"searxng-{digest}"


def normalize_result(
    result: dict,
    competitor: str,
    days: int,
    now: datetime | None = None,
    date_lookup=None,
) -> dict | None:
    title = result.get("title")
    url = result.get("url")
    if not isinstance(title, str) or not title.strip() or not isinstance(url, str):
        return None
    parsed_url = urllib.parse.urlsplit(url.strip())
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        return None

    published = result_date(result.get("publishedDate"))
    if not published and date_lookup:
        published = date_lookup(url.strip())
    if not published:
        return None
    current = now or datetime.now(timezone.utc)
    if published > current + timedelta(days=1) or published < current - timedelta(days=days):
        return None

    content = result.get("content")
    if not isinstance(content, str):
        content = ""
    engine = result.get("engine")
    source_name = f"SearXNG · {engine}" if isinstance(engine, str) and engine.strip() else "SearXNG public news search"
    return {
        "id": stable_id(competitor, url),
        "competitor": competitor,
        "source_name": source_name,
        "captured_via": "searxng",
        "source_channel": "news",
        "title": title.strip()[:500],
        "url": url.strip(),
        "summary": content.strip()[:1200],
        "published_at": published.date().isoformat(),
        "published_at_raw": result.get("publishedDate"),
    }


def fetch_query(
    base_url: str,
    query: dict,
    days: int,
    timeout: int = 25,
    date_lookup_limit: int = MAX_DATE_LOOKUPS_PER_QUERY,
) -> tuple[list[dict], str | None]:
    url = build_search_url(base_url, query["query"], days)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        return [], f"SearXNG request failed for {query['competitor']}: {type(error).__name__}"

    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        return [], f"SearXNG returned no results list for {query['competitor']}"
    unresponsive = payload.get("unresponsive_engines", [])
    engine_issues = [
        f"{str(item[0])[:80]}: {str(item[1])[:120]}"
        for item in unresponsive[:6]
        if isinstance(item, (list, tuple)) and len(item) >= 2
    ]
    items = []
    date_lookups = 0
    for result in results:
        if not isinstance(result, dict):
            continue
        has_search_date = bool(result_date(result.get("publishedDate")))
        lookup = None
        if not has_search_date and date_lookups < date_lookup_limit:
            lookup = fetch_page_publication_date
            date_lookups += 1
        item = normalize_result(result, query["competitor"], days, date_lookup=lookup)
        if item:
            items.append(item)
    warning = "; ".join(engine_issues) if engine_issues else None
    return items, warning


def capture(base_url: str, config: dict, days: int = 365, delay: float = 0.5) -> tuple[list[dict], list[str]]:
    items: list[dict] = []
    warnings: list[str] = []
    seen: set[str] = set()
    queries = config.get("news_queries", [])
    for index, query in enumerate(queries):
        found, warning = fetch_query(base_url, query, days)
        if warning:
            warnings.append(warning)
        for item in found:
            if item["id"] not in seen:
                seen.add(item["id"])
                items.append(item)
        print(f"[searxng] {query['competitor']}: {len(found)} dated results")
        if index + 1 < len(queries) and delay > 0:
            time.sleep(delay)
    return items, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture public news through SearXNG")
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days must be at least 1")

    base_url = os.environ.get("SEARXNG_BASE_URL", "").strip()
    if not base_url:
        print("SEARXNG_BASE_URL is unset; skipping SearXNG capture.")
        return 0
    parsed_base = urllib.parse.urlsplit(base_url)
    if parsed_base.scheme not in {"http", "https"} or not parsed_base.netloc:
        print("SEARXNG_BASE_URL must be an http(s) instance URL.", file=sys.stderr)
        return 2

    with CONFIG_PATH.open(encoding="utf-8") as source:
        config = json.load(source)
    items, warnings = capture(base_url, config, args.days, args.delay)
    now = datetime.now(timezone.utc)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "captured_at": now.isoformat(timespec="seconds"),
        "lookback_days": args.days,
        "source_mode": "searxng_public_news",
        "count": len(items),
        "items": items,
    }
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(items)} SearXNG news items to {args.output}")
    for warning in warnings:
        print(f"::warning::{warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())