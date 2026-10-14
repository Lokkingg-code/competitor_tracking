import importlib.util
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "enrich_signals.py"
SPEC = importlib.util.spec_from_file_location("enrich_signals", MODULE_PATH)
ENRICH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENRICH)


class AIEnrichmentTests(unittest.TestCase):
    def test_deepseek_model_defaults_to_chat(self):
        self.assertEqual(ENRICH.MODEL_ID, "deepseek-chat")

    def test_enrichment_requests_json_object_response_from_selected_model(self):
        result = {
            "headline_summary": "A competitor selected an airline for its EFB platform.",
            "summary": "The airline selected the EFB platform. The source describes the operational use.",
            "announcement_tone": "Positive",
            "competitive_insight": "This adds another airline to the competitor's customer base.",
            "caveat": "Contract terms are not stated.",
            "customer_airline": "Example Air",
            "customer_relationship": "selected",
            "customer_segment": "unknown",
            "customer_confidence": 0.95,
            "customer_segment_confidence": 0,
            "suggested_type": "customer_win",
            "type_confidence": 0.9,
            "suggested_product_focus": "efb",
            "focus_confidence": 0.9,
        }
        response = {"choices": [{"message": {"content": json.dumps(result)}}]}
        signal = {
            "id": "test-signal", "competitor": "Example Systems", "date": "2026-10-14",
            "headline": "Example Air selects an EFB platform", "summary": "A customer announcement.",
            "type": "customer_win", "product_focus": "efb", "product": "Example EFB",
        }

        with patch.object(ENRICH, "deepseek_request", return_value=response) as request:
            ENRICH.enrich_signal(signal, "test-key")

        request.assert_called_once()
        request_args = request.call_args.args
        self.assertEqual(request_args[0], "test-key")
        self.assertEqual(request_args[1]["model"], ENRICH.MODEL_ID)
        self.assertEqual(request_args[1]["response_format"], {"type": "json_object"})
        self.assertEqual(request_args[1]["max_tokens"], 4096)

    def test_empty_truncated_response_reports_safe_usage_metadata(self):
        signal = {"id": "truncated", "competitor": "Example Systems", "date": "2026-10-14"}
        response = {
            "choices": [{"finish_reason": "length", "message": {"content": None, "reasoning": "hidden"}}],
            "usage": {"completion_tokens": 1600},
        }

        with patch.object(ENRICH, "deepseek_request", return_value=response):
            with self.assertRaises(ENRICH.EnrichmentError) as raised:
                ENRICH.enrich_signal(signal, "test-key")

        self.assertIn("finish_reason=length", str(raised.exception))
        self.assertIn("completion_tokens=1600", str(raised.exception))
        self.assertIn("response_chars=0", str(raised.exception))
        self.assertIn("message_fields=content,reasoning", str(raised.exception))
        self.assertNotIn("hidden", str(raised.exception))
    def test_http_402_stops_batch_and_leaves_all_signals_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            signals_path = Path(directory) / "signals.json"
            archive_path = Path(directory) / "signals.archive.json"
            payload = {"signals": [{"id": f"signal-{index}"} for index in range(3)]}
            signals_path.write_text(json.dumps(payload), encoding="utf-8")
            with (
                patch.object(ENRICH, "SIGNALS_PATH", signals_path),
                patch.object(ENRICH, "ARCHIVE_PATH", archive_path),
                patch.object(ENRICH, "base_signal_ids", return_value=set()),
                patch.object(ENRICH, "enrich_signal", side_effect=ENRICH.EnrichmentError("HTTP 402", http_status=402)) as enrich,
                patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}),
                patch.object(sys, "argv", ["enrich_signals.py", "--base-ref", "test", "--max-signals", "3"]),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                result = ENRICH.main()

            saved = json.loads(signals_path.read_text(encoding="utf-8"))

        self.assertEqual(result, 0)
        self.assertEqual(enrich.call_count, 1)
        self.assertEqual(len(saved["signals"]), 3)
        self.assertTrue(all(signal["ai_enrichment_status"] == "pending" for signal in saved["signals"]))

    def test_deepseek_http_error_includes_provider_message(self):
        body = json.dumps({"error": {"message": "Insufficient balance"}}).encode()
        error = ENRICH.urllib.error.HTTPError(
            "https://api.deepseek.com/chat/completions",
            402,
            "Payment Required",
            hdrs=None,
            fp=io.BytesIO(body),
        )

        with patch.object(ENRICH.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(ENRICH.EnrichmentError) as raised:
                ENRICH.deepseek_request("test-key", {"model": "deepseek-chat"})

        self.assertEqual(raised.exception.http_status, 402)
        self.assertIn("Insufficient balance", str(raised.exception))
        error.close()

    def test_selects_new_and_pending_signals_but_skips_completed(self):
        signals = [
            {"id": "old"},
            {"id": "new"},
            {"id": "retry", "ai_enrichment_status": "pending"},
            {"id": "done", "ai_enrichment": {"schema_version": ENRICH.ENRICHMENT_SCHEMA_VERSION}, "ai_enrichment_status": "pending"},
        ]
        selected = ENRICH.newly_added_signals(signals, {"old", "retry", "done"})
        self.assertEqual([signal["id"] for signal in selected], ["new", "retry"])
        self.assertEqual(signals[1]["ai_enrichment_status"], "pending")
        self.assertNotIn("ai_enrichment_status", signals[3])

    def test_backfill_selects_historical_signals_once(self):
        signals = [
            {"id": "historical"},
            {"id": "legacy", "ai_enrichment": {"summary": "old prompt result"}},
            {"id": "already-done", "ai_enrichment": {"schema_version": ENRICH.ENRICHMENT_SCHEMA_VERSION}},
            {"id": "current-fields", "ai_enrichment": {key: "present" for key in ENRICH.CURRENT_ENRICHMENT_FIELDS}},
        ]
        selected = ENRICH.newly_added_signals(signals, {signal["id"] for signal in signals}, backfill_missing=True)
        self.assertEqual([signal["id"] for signal in selected], ["historical", "legacy"])
        self.assertEqual(signals[0]["ai_enrichment_status"], "pending")

    def test_parses_structured_review_without_overwriting_existing_labels(self):
        signal = {"id": "new", "type": "customer_win", "product_focus": "other"}
        output = {
            "headline_summary": "A flight-folder feature adds airline operational tooling.",
            "summary": "A new flight-folder feature was announced.",
            "announcement_tone": "Positive",
            "competitive_insight": "It may improve operational document workflows.",
            "caveat": "Customer impact is not specified.",
            "customer_airline": "unknown",
            "customer_relationship": "unknown",
            "customer_segment": "unknown",
            "customer_confidence": 0.2,
            "customer_segment_confidence": 0.2,
            "suggested_type": "feature_change",
            "type_confidence": 0.91,
            "suggested_product_focus": "eff",
            "focus_confidence": 0.88,
        }
        result = ENRICH.parse_enrichment(json.dumps(output), signal)
        self.assertEqual(result["schema_version"], ENRICH.ENRICHMENT_SCHEMA_VERSION)
        self.assertEqual(result["headline_summary"], "A flight-folder feature adds airline operational tooling.")
        self.assertEqual(result["suggested_type"], "feature_change")
        self.assertFalse(result["type_matches_existing"])
        self.assertEqual(result["suggested_product_focus"], "eff")
        self.assertFalse(result["focus_matches_existing"])
        self.assertEqual(signal["type"], "customer_win")
        self.assertEqual(signal["product_focus"], "other")
        self.assertEqual(len(result["source_sha256"]), 64)

    def test_applies_only_high_confidence_type_and_focus_corrections(self):
        signal = {"type": "customer_win", "product_focus": "other"}
        enrichment = {
            "suggested_type": "feature_change",
            "type_confidence": 0.9,
            "suggested_product_focus": "eff",
            "focus_confidence": 0.8,
        }
        ENRICH.apply_confident_classifications(signal, enrichment)
        self.assertEqual(signal["type"], "feature_change")
        self.assertEqual(signal["product_focus"], "eff")
        self.assertEqual(enrichment["original_type"], "customer_win")
        self.assertEqual(enrichment["original_product_focus"], "other")
        self.assertTrue(enrichment["type_auto_applied"])
        self.assertTrue(enrichment["focus_auto_applied"])

        low_confidence_signal = {"type": "customer_win", "product_focus": "other"}
        low_confidence = {**enrichment, "type_confidence": 0.79, "focus_confidence": 0.79}
        ENRICH.apply_confident_classifications(low_confidence_signal, low_confidence)
        self.assertEqual(low_confidence_signal, {"type": "customer_win", "product_focus": "other"})
        self.assertFalse(low_confidence["type_auto_applied"])
        self.assertFalse(low_confidence["focus_auto_applied"])

    def test_extracts_text_blocks_and_rejects_invalid_classification(self):
        content = [{"type": "text", "text": '{"summary": "test"}'}]
        self.assertEqual(ENRICH.extract_text(content), '{"summary": "test"}')
        invalid = {
            "headline_summary": "Test headline.",
            "summary": "Test summary.",
            "announcement_tone": "Positive",
            "competitive_insight": "Test insight.",
            "caveat": "",
            "customer_airline": "unknown",
            "customer_relationship": "unknown",
            "customer_segment": "unknown",
            "customer_confidence": 0.5,
            "customer_segment_confidence": 0.5,
            "suggested_type": "invented_type",
            "type_confidence": 0.5,
            "suggested_product_focus": "eff",
            "focus_confidence": 0.5,
        }
        with self.assertRaises(ENRICH.EnrichmentError):
            ENRICH.parse_enrichment(json.dumps(invalid), {"id": "test"})

    def test_parses_explanatory_fenced_json_and_normalizes_labels(self):
        output = {
            "headline_summary": "A flight-folder feature adds airline operational tooling.",
            "summary": "A flight-folder feature was announced.",
            "announcement_tone": "Positive (promotional)",
            "competitive_insight": "It may improve disruption coordination.",
            "caveat": "Impact is not quantified.",
            "customer_airline": "unknown",
            "customer_relationship": "unknown",
            "customer_segment": "unknown",
            "customer_confidence": 0.2,
            "customer_segment_confidence": 0.2,
            "suggested_type": "Feature change",
            "type_confidence": "91%",
            "suggested_product_focus": "Electronic Flight Folder (EFF)",
            "focus_confidence": "high",
        }
        content = f"Here is the requested analysis:\n```json\n{json.dumps(output)}\n```\nEnd of result."
        result = ENRICH.parse_enrichment(content, {"id": "variant", "type": "customer_win", "product_focus": "other"})
        self.assertEqual(result["suggested_type"], "feature_change")
        self.assertEqual(result["suggested_product_focus"], "eff")
        self.assertEqual(result["type_confidence"], 0.91)
        self.assertEqual(result["focus_confidence"], 0.85)

    def test_summary_prompt_targets_existing_evidence_preview(self):
        self.assertIn("2 short sentences", ENRICH.SUMMARY_INSTRUCTIONS)
        self.assertIn("never exceed 60 words", ENRICH.SUMMARY_INSTRUCTIONS)
        self.assertIn("replaces the dashboard Evidence Preview", ENRICH.SUMMARY_INSTRUCTIONS)
        self.assertIn("do not add competitive implications", ENRICH.SUMMARY_INSTRUCTIONS)

    def test_summary_is_clamped_to_three_sentences_and_sixty_words(self):
        text = "First concise sentence. Second concise sentence. Third concise sentence. Fourth sentence should not appear."
        self.assertEqual(
            ENRICH.concise_summary(text),
            "First concise sentence. Second concise sentence. Third concise sentence.",
        )
        long_text = " ".join(["Evidence"] * 70) + "."
        self.assertLessEqual(len(ENRICH.concise_summary(long_text).split()), 60)

    def test_persistence_keeps_enriched_signals_and_prior_archive_entries(self):
        original_signals_path = ENRICH.SIGNALS_PATH
        original_archive_path = ENRICH.ARCHIVE_PATH
        with tempfile.TemporaryDirectory() as directory:
            ENRICH.SIGNALS_PATH = Path(directory) / "signals.json"
            ENRICH.ARCHIVE_PATH = Path(directory) / "signals.archive.json"
            prior_archive = {
                "generated_at": "old",
                "signals": [{"id": "prior", "headline": "Prior signal"}],
            }
            ENRICH.ARCHIVE_PATH.write_text(json.dumps(prior_archive), encoding="utf-8")
            payload = {
                "generated_at": "new",
                "signals": [{"id": "new", "ai_enrichment": {"summary": "Saved once"}}],
            }

            ENRICH.persist_payloads(payload)

            feed = json.loads(ENRICH.SIGNALS_PATH.read_text(encoding="utf-8"))
            archive = json.loads(ENRICH.ARCHIVE_PATH.read_text(encoding="utf-8"))
            self.assertEqual(feed["signals"][0]["ai_enrichment"]["summary"], "Saved once")
            self.assertEqual({signal["id"] for signal in archive["signals"]}, {"prior", "new"})
            self.assertEqual(archive["signals"][-1]["ai_enrichment"]["summary"], "Saved once")
        ENRICH.SIGNALS_PATH = original_signals_path
        ENRICH.ARCHIVE_PATH = original_archive_path


if __name__ == "__main__":
    unittest.main()