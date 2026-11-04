import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "capture" / "capture_brightdata_linkedin.py"
SPEC = importlib.util.spec_from_file_location("capture_brightdata_linkedin", SCRIPT_PATH)
CAPTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAPTURE)


class BrightDataLinkedInCaptureTests(unittest.TestCase):
    def setUp(self):
        self.organizations = [
            {"competitor": "Jeppesen", "vanity_name": "foreflight"},
            {"competitor": "Lufthansa Systems", "vanity_name": "lufthansa-systems"},
        ]
        self.captured_at = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)

    def test_normalizes_brightdata_posts_and_preserves_browser_ids(self):
        records = [{
            "url": "https://www.linkedin.com/posts/foreflight_activity-123",
            "title": "See ForeFlight's activity on LinkedIn",
            "headline": "ForeFlight's Post",
            "post_text": "ForeFlight launches a new EFFCore feature for airline crews.",
            "date_posted": "2026-11-02T15:00:00.000Z",
            "post_type": "repost",
            "repost": {
                "repost_user_id": "aviation-dan",
                "repost_text": "Airline dispatchers can now review a new flight operations workflow.",
            },
            "discovery_input": {"url": "https://www.linkedin.com/company/foreflight"},
        }]

        payload = CAPTURE.normalize_results(records, self.organizations, self.captured_at, 14)

        self.assertEqual(payload["capture_mode"], "brightdata_api")
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["items"][0]["competitor"], "Jeppesen")
        self.assertEqual(payload["items"][0]["title"], records[0]["post_text"])
        self.assertEqual(payload["items"][0]["published_at"], "2026-11-02")
        self.assertEqual(payload["items"][0]["post_type"], "repost")
        self.assertEqual(payload["items"][0]["repost_author_id"], "aviation-dan")
        self.assertIn("Reposted content: Airline dispatchers", payload["items"][0]["summary"])
        self.assertEqual(payload["items"][0]["id"], "browser-" + __import__("hashlib").sha1(
            b"Jeppesen|https://www.linkedin.com/posts/foreflight_activity-123"
        ).hexdigest()[:12])

    def test_daily_window_covers_only_the_previous_complete_utc_day(self):
        start_date, end_date = CAPTURE.capture_window(self.captured_at, 1)
        self.assertEqual(start_date.isoformat(), "2026-11-03")
        self.assertEqual(end_date.isoformat(), "2026-11-03")

        two_day_start, two_day_end = CAPTURE.capture_window(self.captured_at, 2)
        self.assertEqual(two_day_start.isoformat(), "2026-11-02")
        self.assertEqual(two_day_end.isoformat(), "2026-11-03")

    def test_company_repost_preserves_nested_post_text(self):
        record = {
            "url": "https://www.linkedin.com/posts/bytron_notam-activity-123",
            "headline": "Less NOTAM noise, more operational awareness.",
            "post_text": "Less NOTAM noise, more operational awareness.",
            "post_type": "repost",
            "date_posted": "2026-11-03T09:25:46.159Z",
            "repost": {
                "repost_user_id": "aviation-dan",
                "repost_text": "Effective NOTAM management helps flight dispatchers prioritize critical notices.",
            },
            "discovery_input": {"url": "https://www.linkedin.com/company/bytron"},
        }
        organizations = [{"competitor": "Bytron Skybook", "vanity_name": "bytron"}]

        payload = CAPTURE.normalize_results([record], organizations, self.captured_at, 1)

        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["items"][0]["post_type"], "repost")
        self.assertEqual(payload["items"][0]["repost_author_id"], "aviation-dan")
        self.assertIn("Reposted content: Effective NOTAM management", payload["items"][0]["summary"])

    def test_skips_posts_without_a_configured_company_or_valid_date(self):
        records = [
            {
                "url": "https://www.linkedin.com/posts/foreflight_activity-123",
                "post_text": "A valid post with no company origin.",
                "date_posted": "2026-11-02",
            },
            {
                "url": "https://www.linkedin.com/posts/foreflight_activity-124",
                "post_text": "A post with a broken date.",
                "date_posted": "not-a-date",
                "discovery_input": {"url": "https://www.linkedin.com/company/foreflight"},
            },
        ]

        payload = CAPTURE.normalize_results(records, self.organizations, self.captured_at, 14)

        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["checks"][0]["posts_skipped"], 1)

    def test_batch_command_caps_every_company_input(self):
        command = CAPTURE.build_cli_command(
            self.organizations, "2026-10-21", "2026-11-04", Path("results.json"), 5
        )

        self.assertIn("--limit-per-input", command)
        self.assertEqual(command[command.index("--limit-per-input") + 1], "5")
        self.assertEqual(command.count("https://www.linkedin.com/company/foreflight"), 1)
        self.assertEqual(command.count("https://www.linkedin.com/company/lufthansa-systems"), 1)
        self.assertIn("@brightdata/cli@0.4.1", command)


if __name__ == "__main__":
    unittest.main()