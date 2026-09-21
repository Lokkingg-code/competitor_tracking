#!/usr/bin/env python3
"""Capture competitor signals from configured public sources (last N days).

Outputs JSON records under data/raw/ for later merge + AI filtering.
Does not require Airtable. Designed to run alongside the static web UI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
CONFIG_PATH = Path(__file__).with_name("sources.json")

USER_AGENT = "CathayTech-CompetitorTrackingEngine/0.1 (+internal-research)"


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def fetch(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_linkedin_api(url: str, token: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "LinkedIn-Version": "202501",
            "X-Restli-Protocol-Version": "2.0.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read())


def stable_id(*parts: str) -> str:
    h = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]
    return f"cap-{h}"


def parse_rss_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        iso_value = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(iso_value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            dt = datetime.strptime(value.replace("Z", "+0000") if "%z" in fmt else value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue
    return None


def text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return re.sub(r"\s+", " ", el.text).strip()


def parse_rss(content: bytes, competitor: str, source_name: str) -> list[dict]:
    root = ET.fromstring(content)
    items: list[dict] = []

    # RSS 2.0
    for item in root.findall(".//item"):
        title = text(item.find("title"))
        link = text(item.find("link"))
        desc = text(item.find("description"))
        pub = parse_rss_date(text(item.find("pubDate")))
        if not title or not link:
            continue
        items.append(
            {
                "id": stable_id(competitor, link),
                "competitor": competitor,
                "source_name": source_name,
                "captured_via": "rss",
                "source_channel": "rss",
                "title": title,
                "url": link,
                "summary": desc[:600],
                "published_at": pub.date().isoformat() if pub else None,
                "published_at_raw": text(item.find("pubDate")),
            }
        )

    # Atom
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for entry in root.findall(".//a:entry", ns):
        title = text(entry.find("a:title", ns))
        link_el = entry.find("a:link[@rel='alternate']", ns)
        if link_el is None:
            link_el = entry.find("a:link", ns)
        link = link_el.get("href") if link_el is not None else ""
        summary = text(entry.find("a:summary", ns)) or text(entry.find("a:content", ns))
        pub = parse_rss_date(text(entry.find("a:published", ns)) or text(entry.find("a:updated", ns)))
        if not title or not link:
            continue
        items.append(
            {
                "id": stable_id(competitor, link),
                "competitor": competitor,
                "source_name": source_name,
                "captured_via": "atom",
                "source_channel": "rss",
                "title": title,
                "url": link,
                "summary": summary[:600],
                "published_at": pub.date().isoformat() if pub else None,
                "published_at_raw": text(entry.find("a:published", ns)),
            }
        )
    return items


def google_news_rss(query: str, competitor: str, source_name: str = "Google News RSS", captured_via: str = "google_news") -> list[dict]:
    q = urllib.parse.quote_plus(query)
    url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    try:
        content = fetch(url)
        items = parse_rss(content, competitor, source_name)
        for item in items:
            item["captured_via"] = captured_via
            if captured_via == "linkedin":
                item["source_channel"] = "linkedin"
        return items
    except Exception as exc:
        return [
            {
                "id": stable_id(competitor, "error", query),
                "competitor": competitor,
                "source_name": source_name,
                "captured_via": "error",
                "source_channel": captured_via,
                "title": f"Capture error for query: {query}",
                "url": url,
                "summary": str(exc),
                "published_at": None,
                "error": True,
            }
        ]


def absolute_url(base: str, href: str) -> str:
    return urllib.parse.urljoin(base, href)


def canonical_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "")).lower()


def extract_meta_content(html: str, attr: str, value: str) -> str:
    patterns = [
        rf'<meta[^>]+{attr}=["\']{value}["\'][^>]+content="([^"]+)"',
        rf"<meta[^>]+{attr}=[\"']{value}[\"'][^>]+content='([^']+)'",
        rf'<meta[^>]+content="([^"]+)"[^>]+{attr}=["\']{value}["\']',
        rf"<meta[^>]+content='([^']+)'[^>]+{attr}=[\"']{value}[\"']",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.I)
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip()
    return ""


def extract_first_paragraph(html: str) -> str:
    match = re.search(r"<p[^>]*>(.*?)</p>", html, re.I | re.S)
    if not match:
        return ""
    text = re.sub(r"<[^>]+>", " ", match.group(1))
    return re.sub(r"\s+", " ", text).strip()


def extract_date_from_text(value: str) -> str | None:
    months = (
        "January|February|March|April|May|June|July|August|September|October|November|December"
    )
    patterns = [
        rf"((?:{months})\s+\d{{1,2}}(?:st|nd|rd|th),?\s+\d{{4}})",
        rf"(\d{{1,2}}(?:st|nd|rd|th)\s+(?:{months})\s+\d{{4}})",
        rf"((?:{months})\s+\d{{1,2}},?\s+\d{{4}})",
    ]
    for pattern in patterns:
        match = re.search(pattern, value, re.I)
        if not match:
            continue
        date_value = re.sub(r"(\d{1,2})(st|nd|rd|th)", r"\1", match.group(1), flags=re.I)
        for date_format in ("%B %d, %Y", "%B %d %Y", "%d %B %Y"):
            try:
                return datetime.strptime(date_value, date_format).date().isoformat()
            except ValueError:
                continue
    return None


def extract_press_date(html: str) -> str | None:
    months = (
        "January|February|March|April|May|June|July|August|September|October|November|December"
    )
    candidates = [
        r'<time[^>]+datetime=["\']([^"\']+)',
        r'<meta[^>]+(?:property|name)=["\'](?:article:published_time|datePublished|date)["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:article:published_time|datePublished|date)["\']',
        r'"datePublished"\s*:\s*"([^"]+)"',
        r'<[^>]+class=["\'][^"\']*cc-blog-date[^"\']*["\'][^>]*>\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*</',
        r'<[^>]+class=["\'][^"\']*author[^"\']*["\'][^>]*>.*?\|\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*</',
        rf"(\d{{1,2}}(?:st|nd|rd|th)\s+({months})\s+\d{{4}})",
        rf"({months})\s+\d{{1,2}},\s+\d{{4}}",
        r"(\d{1,2}/\d{1,2}/\d{4})",
    ]
    structured_candidates = candidates[:4]
    for pattern in structured_candidates:
        match = re.search(pattern, html, re.I)
        if not match:
            continue
        value = match.group(1)
        parsed = parse_rss_date(value)
        if parsed:
            return parsed.date().isoformat()
        ordinal_value = re.sub(r"(\d{1,2})(st|nd|rd|th)", r"\1", value, flags=re.I)
        try:
            return datetime.strptime(ordinal_value, "%d %B %Y").date().isoformat()
        except ValueError:
            try:
                return datetime.strptime(ordinal_value, "%d %b %Y").date().isoformat()
            except ValueError:
                try:
                    return datetime.strptime(value, "%m/%d/%Y").date().isoformat()
                except ValueError:
                    continue
    searchable_html = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    for pattern in candidates[4:]:
        match = re.search(pattern, searchable_html, re.I)
        if not match:
            continue
        value = match.group(1)
        parsed = parse_rss_date(value)
        if parsed:
            return parsed.date().isoformat()
        ordinal_value = re.sub(r"(\d{1,2})(st|nd|rd|th)", r"\1", value, flags=re.I)
        try:
            return datetime.strptime(ordinal_value, "%d %B %Y").date().isoformat()
        except ValueError:
            try:
                return datetime.strptime(ordinal_value, "%d %b %Y").date().isoformat()
            except ValueError:
                try:
                    return datetime.strptime(value, "%m/%d/%Y").date().isoformat()
                except ValueError:
                    continue
    return extract_date_from_text(re.sub(r"<[^>]+>", " ", searchable_html))


def fetch_article_excerpt(url: str) -> tuple[str, str, str | None]:
    """Return title, excerpt, and optional ISO date from a press page."""
    content = fetch(url).decode("utf-8", errors="replace")
    title = extract_meta_content(content, "property", "og:title") or extract_meta_content(
        content, "name", "title"
    )
    excerpt = extract_meta_content(content, "property", "og:description")
    if not excerpt:
        excerpt = extract_first_paragraph(content)
    excerpt = re.sub(r"\s+", " ", excerpt).strip()[:600]
    published = extract_press_date(content) or extract_date_from_text(excerpt)
    if published and published > datetime.now(timezone.utc).date().isoformat():
        published = None
    return title, excerpt, published


def capture_linkedin_post(post: dict) -> dict:
    """Capture a public LinkedIn post from its canonical URL and metadata."""
    competitor = post["competitor"]
    url = post["url"]
    try:
        title, excerpt, published = fetch_article_excerpt(url)
        return {
            "id": stable_id(competitor, url),
            "competitor": competitor,
            "source_name": "LinkedIn direct post",
            "captured_via": "linkedin",
            "source_channel": "linkedin",
            "title": title,
            "url": url,
            "summary": excerpt,
            "published_at": published,
        }
    except Exception as exc:
        return {
            "id": stable_id(competitor, url),
            "competitor": competitor,
            "source_name": "LinkedIn direct post",
            "captured_via": "error",
            "source_channel": "linkedin",
            "title": f"LinkedIn capture error: {competitor}",
            "url": url,
            "summary": str(exc),
            "published_at": None,
            "error": True,
        }


def capture_linkedin_api_posts(org: dict, token: str) -> list[dict]:
    """Capture recent organization posts through LinkedIn's approved API."""
    organization_id = org.get("organization_id")
    if not organization_id:
        vanity = urllib.parse.quote(org["vanity_name"], safe="")
        lookup = fetch_linkedin_api(
            f"https://api.linkedin.com/rest/organizations?q=vanityName&vanityName={vanity}",
            token,
        )
        elements = lookup.get("elements", [])
        organization_id = elements[0].get("id") if elements else None
    if not organization_id:
        return []

    author = urllib.parse.quote(f"urn:li:organization:{organization_id}", safe="")
    response = fetch_linkedin_api(
        f"https://api.linkedin.com/rest/posts?q=author&author={author}&count=100",
        token,
    )
    items = []
    for post in response.get("elements", []):
        post_id = post.get("id") or post.get("urn")
        commentary = post.get("commentary") or post.get("specificContent", {}).get(
            "com.linkedin.ugc.ShareContent", {}
        ).get("shareCommentary", {}).get("text", {}).get("text", "")
        if not post_id or not commentary:
            continue
        created = post.get("created", {}).get("time")
        published = datetime.fromtimestamp(created / 1000, timezone.utc).date().isoformat() if created else None
        items.append(
            {
                "id": stable_id(org["competitor"], post_id),
                "competitor": org["competitor"],
                "source_name": "LinkedIn API",
                "captured_via": "linkedin",
                "source_channel": "linkedin",
                "title": commentary.split("\n", 1)[0][:180],
                "url": f"https://www.linkedin.com/feed/update/{post_id}",
                "summary": commentary[:600],
                "published_at": published,
            }
        )
    return items


def extract_newsroom_links(html: str, base_url: str, link_pattern: str) -> list[str]:
    pattern = re.compile(link_pattern, re.I)
    hrefs = re.findall(r"""href=["']([^"'#]+)["']""", html, re.I)
    urls: list[str] = []
    for href in hrefs:
        url = absolute_url(base_url, href)
        if pattern.search(url) and url not in urls:
            urls.append(url)
    return urls


def capture_newsroom(room: dict, sleep: float) -> list[dict]:
    competitor = room["competitor"]
    name = room.get("name", room["index_url"])
    try:
        index_html = fetch(room["index_url"]).decode("utf-8", errors="replace")
        links = extract_newsroom_links(index_html, room["index_url"], room["link_pattern"])
        links = links[: room.get("max_articles", 10)]
    except Exception as exc:
        return [
            {
                "id": stable_id(competitor, "error", room["index_url"]),
                "competitor": competitor,
                "source_name": name,
                "captured_via": "error",
                "source_channel": "press_release",
                "title": f"Newsroom capture error: {name}",
                "url": room["index_url"],
                "summary": str(exc),
                "published_at": None,
                "error": True,
            }
        ]

    items: list[dict] = []
    for link in links:
        try:
            title, excerpt, published = fetch_article_excerpt(link)
            if not title:
                title = link.rsplit("/", 1)[-1].replace("-", " ").title()
            items.append(
                {
                    "id": stable_id(competitor, link),
                    "competitor": competitor,
                    "source_name": name,
                    "captured_via": "press_release",
                    "source_channel": "press_release",
                    "title": title,
                    "url": link,
                    "summary": excerpt,
                    "published_at": published,
                    "date_is_estimated": published is None,
                }
            )
        except Exception:
            items.append(
                {
                    "id": stable_id(competitor, link),
                    "competitor": competitor,
                    "source_name": name,
                    "captured_via": "press_release",
                    "source_channel": "press_release",
                    "title": link.rsplit("/", 1)[-1].replace("-", " ").title(),
                    "url": link,
                    "summary": "",
                    "published_at": None,
                    "date_is_estimated": True,
                }
            )
        time.sleep(sleep)
    return items


def capture_feed(feed: dict) -> list[dict]:
    try:
        content = fetch(feed["url"])
        return parse_rss(content, feed["competitor"], feed.get("name", feed["url"]))
    except Exception as exc:
        return [
            {
                "id": stable_id(feed["competitor"], "error", feed["url"]),
                "competitor": feed["competitor"],
                "source_name": feed.get("name", feed["url"]),
                "captured_via": "error",
                "title": f"Capture error: {feed.get('name', feed['url'])}",
                "url": feed["url"],
                "summary": str(exc),
                "published_at": None,
                "error": True,
            }
        ]


def within_lookback(item: dict, cutoff: datetime) -> bool:
    if item.get("error"):
        return True
    published = item.get("published_at")
    if not published:
        return True  # keep undated for manual review
    try:
        dt = datetime.strptime(published, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        return True
    return dt >= cutoff


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture competitor signals (public sources)")
    parser.add_argument("--days", type=int, default=365, help="Lookback window in days")
    parser.add_argument("--sleep", type=float, default=0.8, help="Delay between remote calls")
    args = parser.parse_args()

    cfg = load_config()
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    collected: list[dict] = []

    for feed in cfg.get("rss_feeds", []):
        print(f"[rss] {feed.get('name')} …")
        collected.extend(capture_feed(feed))
        time.sleep(args.sleep)

    for q in cfg.get("news_queries", []):
        print(f"[news] {q['competitor']}: {q['query'][:60]}…")
        collected.extend(google_news_rss(q["query"], q["competitor"]))
        time.sleep(args.sleep)

    for q in cfg.get("linkedin_queries", []):
        print(f"[linkedin] {q['competitor']}: {q['query'][:60]}…")
        collected.extend(
            google_news_rss(
                q["query"],
                q["competitor"],
                source_name="Google News · LinkedIn",
                captured_via="linkedin",
            )
        )
        time.sleep(args.sleep)

    linkedin_token = os.environ.get("LINKEDIN_ACCESS_TOKEN")
    if linkedin_token:
        for org in cfg.get("linkedin_organizations", []):
            print(f"[linkedin-api] {org['competitor']} …")
            try:
                collected.extend(capture_linkedin_api_posts(org, linkedin_token))
            except Exception as exc:
                print(f"[linkedin-api] skipped {org['competitor']}: {exc}")
            time.sleep(args.sleep)

    for post in cfg.get("direct_linkedin_posts", []):
        print(f"[linkedin-direct] {post['competitor']}: {post['url']}")
        collected.append(capture_linkedin_post(post))
        time.sleep(args.sleep)

    for room in cfg.get("newsrooms", []):
        print(f"[press] {room.get('name')} …")
        collected.extend(capture_newsroom(room, args.sleep))
        time.sleep(args.sleep)

    filtered = [i for i in collected if within_lookback(i, cutoff)]

    # de-dupe by url/id
    seen = set()
    unique = []
    for item in filtered:
        key = canonical_url(item.get("url", "")) or item["id"]
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = RAW_DIR / f"capture_{stamp}.json"
    latest_path = RAW_DIR / "latest.json"
    payload = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "lookback_days": args.days,
        "cutoff": cutoff.date().isoformat(),
        "count": len(unique),
        "items": unique,
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    latest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(unique)} items → {out_path.relative_to(ROOT)}")
    print(f"Also updated {latest_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
