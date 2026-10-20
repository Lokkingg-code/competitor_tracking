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


def period_summary(main_movement, evidence_ids=(), trend_context="", context_evidence_ids=()):
    return {
        "main_movement": main_movement,
        "evidence_ids": list(evidence_ids),
        "trend_context": trend_context,
        "context_evidence_ids": list(context_evidence_ids),
    }


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
        self.assertEqual(len(ifs["monthly"]), 13)
        self.assertEqual(context["source_signal_count"], 2)
        ids = {signal_id for event in context["events"] for signal_id in event["signal_ids"]}
        self.assertEqual(ids, {"news-linkedin", "scraped-launch"})

    def test_context_keeps_configured_competitors_with_no_recent_signals(self):
        context = INSIGHTS.build_analysis_context(self.signals, date(2026, 10, 16), ["Others"])
        others = next(row for row in context["activity_windows"][0]["competitors"] if row["competitor"] == "Others")
        self.assertEqual(others["captured_signals"], 0)
        self.assertEqual(others["evidence_ids"], [])
        self.assertIn("Others", context["competitors"])

    def test_deduplicated_events_keep_citations_in_their_actual_period(self):
        signals = [
            {**self.signals[0], "id": "ifs-same-story-oct", "date": "2026-10-05"},
            {**self.signals[0], "id": "ifs-same-story-sep", "date": "2026-09-10"},
            {**self.signals[0], "id": "ifs-same-story-aug", "date": "2026-08-15"},
        ]
        context = INSIGHTS.build_analysis_context(signals, date(2026, 10, 16))
        ifs = next(row for row in context["activity_windows"][0]["competitors"] if row["competitor"] == "IFS")
        self.assertEqual(ifs["evidence_ids"], ["ifs-same-story-oct"])
        self.assertEqual(ifs["context_evidence_ids"], ["ifs-same-story-aug", "ifs-same-story-sep"])

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
            "activity_summaries": [
                {
                    "competitor": "Bytron Skybook",
                    "monthly": period_summary("Bytron posted an EFB messaging feature update.", ["scraped-launch"]),
                    "quarterly": period_summary("Bytron added EFB messaging.", ["scraped-launch"]),
                    "yearly": period_summary("Bytron's captured activity includes an EFB messaging update.", ["scraped-launch"]),
                },
                {
                    "competitor": "IFS",
                    "monthly": period_summary("No new customer event this month.", trend_context="This quarter includes fastjet's selection.", context_evidence_ids=["news-linkedin"]),
                    "quarterly": period_summary("fastjet selected EFBOne.", ["news-linkedin"]),
                    "yearly": period_summary("fastjet selected EFBOne.", ["news-linkedin"]),
                },
            ],
        }
        response = {"candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": json.dumps(model_result)}]},
        }]}
        with patch.object(INSIGHTS, "gemini_request", return_value=response) as request:
            snapshot = INSIGHTS.generate_insights(self.signals, "test-key", date(2026, 10, 16))
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["schema_version"], 3)
        self.assertEqual(snapshot["model"], "gemini-3.5-flash-lite")
        self.assertEqual(request.call_args.args[1], "gemini-3.5-flash-lite")
        self.assertEqual(snapshot["insights"][0]["evidence_ids"], ["news-linkedin"])
        ifs_summary = next(row for row in snapshot["activity_summaries"] if row["competitor"] == "IFS")
        self.assertEqual(ifs_summary["monthly"]["evidence_ids"], [])
        self.assertEqual(ifs_summary["monthly"]["main_movement"], "No signals captured in this period.")
        self.assertEqual(ifs_summary["monthly"]["context_evidence_ids"], ["news-linkedin"])
        self.assertEqual(ifs_summary["monthly"]["trend_context"], "This quarter includes fastjet's selection.")
        self.assertEqual(ifs_summary["quarterly"]["evidence_ids"], ["news-linkedin"])
        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("low-cost carriers (LCCs)", prompt)
        self.assertIn("fastjet is an African low-cost carrier (LCC)", prompt)
        self.assertIn("monthly, quarterly, and yearly", prompt)
        self.assertIn("A single-competitor finding must be worded as vendor-specific", prompt)
        self.assertIn("A mention", prompt)
        self.assertIn("Do not infer safety, efficiency", prompt)

    def test_generation_rejects_unknown_evidence_ids(self):
        context = INSIGHTS.build_analysis_context(self.signals, date(2026, 10, 16))
        with self.assertRaisesRegex(INSIGHTS.EnrichmentError, "outside the supplied evidence"):
            INSIGHTS.validate_insight_result({
                "lead": "A pattern.",
                "insights": [{"title": "Claim", "finding": "Finding", "evidence_ids": ["missing-id"]}],
                "activity_summaries": [],
            }, context)

    def test_activity_summary_rejects_citation_from_outside_competitor_window(self):
        context = INSIGHTS.build_analysis_context(self.signals, date(2026, 10, 16))
        result = {
            "lead": "A pattern.",
            "insights": [],
            "activity_summaries": [
                {
                    "competitor": competitor,
                    "monthly": period_summary("No movement.", ["scraped-launch"] if competitor == "IFS" else []),
                    "quarterly": period_summary("Window summary."),
                    "yearly": period_summary("Window summary."),
                }
                for competitor in context["competitors"]
            ],
        }
        with self.assertRaisesRegex(INSIGHTS.EnrichmentError, "outside monthly for IFS"):
            INSIGHTS.validate_insight_result(result, context)

    def test_generation_repairs_one_out_of_window_citation(self):
        def response(ifs_monthly_ids):
            result = {
                "lead": "Recent activity is vendor-specific.",
                "insights": [],
                "activity_summaries": [
                    {
                        "competitor": "Bytron Skybook",
                        "monthly": period_summary("Bytron released a feature.", ["scraped-launch"]),
                        "quarterly": period_summary("Bytron released a feature.", ["scraped-launch"]),
                        "yearly": period_summary("Bytron released a feature.", ["scraped-launch"]),
                    },
                    {
                        "competitor": "IFS",
                        "monthly": period_summary("IFS selected fastjet.", ifs_monthly_ids),
                        "quarterly": period_summary("IFS selected fastjet.", ["news-linkedin"]),
                        "yearly": period_summary("IFS selected fastjet.", ["news-linkedin"]),
                    },
                ],
            }
            return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(result)}]}}]}

        with patch.object(INSIGHTS, "gemini_request", side_effect=[response(["news-linkedin"]), response([])]) as request:
            snapshot = INSIGHTS.generate_insights(self.signals, "test-key", date(2026, 10, 16))
        self.assertEqual(request.call_count, 2)
        retry_prompt = request.call_args_list[1].args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("previous response was rejected", retry_prompt)
        ifs_summary = next(row for row in snapshot["activity_summaries"] if row["competitor"] == "IFS")
        self.assertEqual(ifs_summary["monthly"]["evidence_ids"], [])

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