import contextlib
import io
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts import summarize_competitive_insights as INSIGHTS


class CompetitiveInsightTests(unittest.TestCase):
    def setUp(self):
        self.signals = [
            {
                "id": "news-linkedin",
                "competitor": "IFS",
                "date": "2026-09-10",
                "type": "customer_win",
                "product": "EFBOne",
                "source_channel": "linkedin",
                "source_origin": "google_news",
                "headline": "fastjet selects IFS EFBOne",
                "summary": "fastjet selected the EFB platform.",
                "ai_enrichment": {
                    "customer_airline": "fastjet",
                    "customer_relationship": "selected",
                    "customer_segment": "unknown",
                },
            },
            {
                "id": "scraped-launch",
                "competitor": "Bytron Skybook",
                "date": "2026-09-18",
                "type": "feature_change",
                "product": "Skybook",
                "source_channel": "linkedin",
                "source_origin": "linkedin",
                "headline": "Instant messaging connects dispatchers and pilots",
                "summary": "Feature details.",
            },
        ]

    def test_context_tracks_linkedin_origins_and_retains_event_ids(self):
        context = INSIGHTS.build_analysis_context(self.signals, date(2026, 10, 16))
        ifs = next(row for row in context["activity_by_competitor_month"] if row["competitor"] == "IFS")
        september = next(row for row in ifs["monthly"] if row[0] == "2026-09")
        self.assertEqual(september[2], 1)
        self.assertEqual(september[4], 1)
        self.assertEqual(len(ifs["monthly"]), 12)
        self.assertEqual(context["source_signal_count"], 2)
        ids = {signal_id for event in context["events"] for signal_id in event["signal_ids"]}
        self.assertEqual(ids, {"news-linkedin", "scraped-launch"})

    def test_generation_validates_citations_and_builds_snapshot(self):
        model_result = {
            "lead": "IFS has a recent customer adoption signal.",
            "insights": [{
                "category": "customer_adoption",
                "title": "IFS adds an LCC customer",
                "finding": "fastjet selected EFBOne.",
                "evidence_ids": ["news-linkedin"],
                "aviation_context": "fastjet is a low-cost carrier.",
                "caveat": "Validate the source announcement.",
            }],
        }
        response = {"candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": json.dumps(model_result)}]},
        }]}
        with patch.object(INSIGHTS, "gemini_request", return_value=response) as request:
            snapshot = INSIGHTS.generate_insights(self.signals, "test-key", date(2026, 10, 16))
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["model"], "gemini-3.5-flash-lite")
        self.assertEqual(request.call_args.args[1], "gemini-3.5-flash-lite")
        self.assertEqual(snapshot["insights"][0]["evidence_ids"], ["news-linkedin"])
        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("low-cost carriers (LCCs)", prompt)
        self.assertIn("A single-competitor finding must be worded as vendor-specific", prompt)
        self.assertIn("A mention", prompt)
        self.assertIn("Do not infer safety, efficiency", prompt)

    def test_generation_rejects_unknown_evidence_ids(self):
        with self.assertRaisesRegex(INSIGHTS.EnrichmentError, "outside the supplied evidence"):
            INSIGHTS.validate_insight_result({
                "lead": "A pattern.",
                "insights": [{"title": "Claim", "finding": "Finding", "evidence_ids": ["missing-id"]}],
            }, {"known-id"})

    def test_api_failure_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            signals_path = Path(directory) / "signals.json"
            output_path = Path(directory) / "competitive-insights.json"
            signals_path.write_text(json.dumps({"signals": self.signals}), encoding="utf-8")
            previous = '{"status":"ready","lead":"previous"}\n'
            output_path.write_text(previous, encoding="utf-8")
            with (
                patch.object(INSIGHTS, "gemini_request", side_effect=INSIGHTS.EnrichmentError("temporary failure")),
                patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                self.assertEqual(INSIGHTS.main(["--signals", str(signals_path), "--output", str(output_path)]), 0)
            self.assertEqual(output_path.read_text(encoding="utf-8"), previous)


if __name__ == "__main__":
    unittest.main()