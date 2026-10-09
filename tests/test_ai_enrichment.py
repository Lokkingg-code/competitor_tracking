import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "enrich_signals.py"
SPEC = importlib.util.spec_from_file_location("enrich_signals", MODULE_PATH)
ENRICH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENRICH)


class AIEnrichmentTests(unittest.TestCase):
    def test_selects_new_and_pending_signals_but_skips_completed(self):
        signals = [
            {"id": "old"},
            {"id": "new"},
            {"id": "retry", "ai_enrichment_status": "pending"},
            {"id": "done", "ai_enrichment": {"summary": "saved"}, "ai_enrichment_status": "pending"},
        ]
        selected = ENRICH.newly_added_signals(signals, {"old", "retry", "done"})
        self.assertEqual([signal["id"] for signal in selected], ["new", "retry"])
        self.assertEqual(signals[1]["ai_enrichment_status"], "pending")
        self.assertNotIn("ai_enrichment_status", signals[3])

    def test_backfill_selects_historical_signals_once(self):
        signals = [
            {"id": "historical"},
            {"id": "already-done", "ai_enrichment": {"summary": "saved"}},
        ]
        selected = ENRICH.newly_added_signals(signals, {"historical", "already-done"}, backfill_missing=True)
        self.assertEqual([signal["id"] for signal in selected], ["historical"])
        self.assertEqual(signals[0]["ai_enrichment_status"], "pending")

    def test_parses_structured_review_without_overwriting_existing_labels(self):
        signal = {"id": "new", "type": "customer_win", "product_focus": "other"}
        output = {
            "summary": "A new flight-folder feature was announced.",
            "announcement_tone": "Positive",
            "competitive_insight": "It may improve operational document workflows.",
            "caveat": "Customer impact is not specified.",
            "suggested_type": "feature_change",
            "type_confidence": 0.91,
            "suggested_product_focus": "eff",
            "focus_confidence": 0.88,
        }
        result = ENRICH.parse_enrichment(json.dumps(output), signal)
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
            "summary": "Test summary.",
            "announcement_tone": "Positive",
            "competitive_insight": "Test insight.",
            "caveat": "",
            "suggested_type": "invented_type",
            "type_confidence": 0.5,
            "suggested_product_focus": "eff",
            "focus_confidence": 0.5,
        }
        with self.assertRaises(ENRICH.EnrichmentError):
            ENRICH.parse_enrichment(json.dumps(invalid), {"id": "test"})

    def test_parses_explanatory_fenced_json_and_normalizes_labels(self):
        output = {
            "summary": "A flight-folder feature was announced.",
            "announcement_tone": "Positive (promotional)",
            "competitive_insight": "It may improve disruption coordination.",
            "caveat": "Impact is not quantified.",
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