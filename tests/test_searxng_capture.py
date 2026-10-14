import importlib.util
import json
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "capture" / "capture_searxng.py"
SPEC = importlib.util.spec_from_file_location("capture_searxng", MODULE_PATH)
SEARXNG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SEARXNG)


class SearXNGCaptureTests(unittest.TestCase):
    def test_search_url_uses_news_engines_and_translates_lookback(self):
        url = SEARXNG.build_search_url("https://search.example/", 'Jeppesen when:365d', 365)
        parsed = urlsplit(url)
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.path, "/search")
        self.assertEqual(query["q"], ["Jeppesen"])
        self.assertEqual(query["categories"], ["news"])
        self.assertEqual(query["format"], ["json"])
        self.assertEqual(query["time_range"], ["year"])

    def test_normalizes_dated_result_to_merger_schema_with_stable_id(self):
        now = datetime(2026, 10, 9, tzinfo=timezone.utc)
        result = {
            "title": "Airline selects EFBOne",
            "url": "https://example.com/news/story?utm_source=search",
            "content": "The airline selected the platform.",
            "publishedDate": "2026-10-08T10:30:00Z",
            "engine": "example-news",
        }
        item = SEARXNG.normalize_result(result, "IFS", 30, now)
        self.assertEqual(item["competitor"], "IFS")
        self.assertEqual(item["source_channel"], "news")
        self.assertEqual(item["captured_via"], "searxng")
        self.assertEqual(item["published_at"], "2026-10-08")
        self.assertTrue(item["id"].startswith("searxng-"))
        self.assertEqual(item["id"], SEARXNG.stable_id("IFS", "https://example.com/news/story"))

    def test_rejects_undated_old_and_non_http_results(self):
        now = datetime(2026, 10, 9, tzinfo=timezone.utc)
        base = {"title": "News", "url": "https://example.com/story", "content": "Details"}
        self.assertIsNone(SEARXNG.normalize_result(base, "IFS", 30, now))
        self.assertIsNone(SEARXNG.normalize_result({**base, "publishedDate": "2020-01-01"}, "IFS", 30, now))
        self.assertIsNone(SEARXNG.normalize_result({**base, "url": "javascript:alert(1)", "publishedDate": "2026-10-08"}, "IFS", 30, now))

    def test_extracts_dates_from_article_metadata_and_blocks_private_hosts(self):
        html = '<html><head><meta content="2026-10-07T12:30:00Z" property="article:published_time"></head></html>'
        date = SEARXNG.parse_page_publication_date(html)
        self.assertEqual(date.isoformat(), "2026-10-07T12:30:00+00:00")
        self.assertFalse(SEARXNG.is_public_http_url("http://127.0.0.1:8080/search"))
        self.assertFalse(SEARXNG.is_public_http_url("http://localhost/search"))

    def test_uses_article_date_lookup_for_undated_search_results(self):
        now = datetime(2026, 10, 9, tzinfo=timezone.utc)
        result = {
            "title": "Airline selects EFBOne",
            "url": "https://example.com/story",
            "content": "The airline selected the platform.",
        }
        item = SEARXNG.normalize_result(
            result,
            "IFS",
            30,
            now,
            date_lookup=lambda _url: datetime(2026, 10, 8, tzinfo=timezone.utc),
        )
        self.assertEqual(item["published_at"], "2026-10-08")

    def test_reports_unresponsive_search_engines(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps({
                    "results": [],
                    "unresponsive_engines": [["bing news", "Too many requests"]],
                }).encode()

        query = {"competitor": "Jeppesen", "query": "Jeppesen flight software"}
        with patch.object(SEARXNG.urllib.request, "urlopen", return_value=Response()):
            items, warning = SEARXNG.fetch_query("http://localhost:8080", query, 30)
        self.assertEqual(items, [])
        self.assertIn("bing news: Too many requests", warning)


if __name__ == "__main__":
    unittest.main()