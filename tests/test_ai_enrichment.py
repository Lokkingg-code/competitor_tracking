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

from scripts import merge_signals as MERGE_SIGNALS


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "enrich_signals.py"
SPEC = importlib.util.spec_from_file_location("enrich_signals", MODULE_PATH)
ENRICH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENRICH)


class AIEnrichmentTests(unittest.TestCase):
    def test_customer_interview_is_not_a_customer_win_without_new_commitment(self):
        signal = {
            "id": "finnair-interview",
            "competitor": "Lufthansa Systems",
            "product": "Lido mPilot",
            "headline": "How does digital navigation support pilots in their daily operations?",
            "summary": "In this customer interview, Mikko Lehtinen, EFB Key User at Finnair, shares how pilots use Lido mPilot throughout their journey, from gate to gate.",
            "type": "customer_win",
            "product_focus": "efb",
        }
        model_result = {
            "suggested_type": "messaging_shift",
            "type_confidence": 0.95,
            "suggested_product_focus": "efb",
            "focus_confidence": 0.9,
            "is_ai_related": False,
            "ai_confidence": 0.1,
            "ai_evidence": "",
        }
        response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(model_result)}]}}]}

        with patch.object(ENRICH, "gemini_request", return_value=response) as request:
            result = ENRICH.classify_signal(signal, "test-key")

        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("customer interview", prompt)
        self.assertIn("NOT a customer win", prompt)
        self.assertEqual(result["suggested_type"], "messaging_shift")
        self.assertEqual(signal["type"], "messaging_shift")
        self.assertEqual(result["original_type"], "customer_win")

    def test_upcoming_product_webinar_is_not_a_product_launch(self):
        signal = {
            "id": "connect-webinar", "competitor": "Aviobook", "product": "AvioBook Connect",
            "headline": "One more sleep. Our Connect 3.0 webinar goes live tomorrow",
            "summary": "A colleague will cover the wider AvioBook product suite and answer questions.",
            "type": "product_launch", "product_focus": "efb",
        }
        model_result = {
            "suggested_type": "messaging_shift", "type_confidence": 0.95,
            "suggested_product_focus": "efb", "focus_confidence": 0.9,
            "is_ai_related": False, "ai_confidence": 0.95, "ai_evidence": "",
        }
        response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(model_result)}]}}]}

        with patch.object(ENRICH, "gemini_request", return_value=response) as request:
            result = ENRICH.classify_signal(signal, "test-key")

        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("future webinar", prompt)
        self.assertIn("not product_launch", prompt)
        self.assertEqual(result["suggested_type"], "messaging_shift")
        self.assertEqual(signal["type"], "messaging_shift")
        self.assertEqual(result["original_type"], "product_launch")

    def test_manual_interview_correction_survives_merge_sanitization(self):
        reviewed = {
            "from": "customer_win",
            "to": "messaging_shift",
            "reason": "Finnair is interviewed about existing Lido mPilot use; no new commitment is announced.",
        }
        sanitized = MERGE_SIGNALS.sanitize_signal({
            "id": "finnair-interview", "competitor": "Lufthansa Systems",
            "headline": "Finnair Lido mPilot interview", "summary": "Existing-use interview.",
            "type": "messaging_shift", "priority": "low", "product_focus": "efb",
            "analyst_type_review": reviewed,
        })
        self.assertEqual(sanitized["type"], "messaging_shift")
        self.assertEqual(sanitized["analyst_type_review"], reviewed)

    def test_classification_keeps_message_type_separate_from_ai_flag(self):
        for ai_related, confidence in ((True, 0.95), (False, 0.95), (False, 0.5)):
            with self.subTest(ai_related=ai_related, confidence=confidence):
                signal = {
                    "id": "example", "competitor": "Example Vendor", "product": "Platform",
                    "headline": "Example Vendor adds AI agents to Platform" if ai_related else "Example Air signs a five-year Platform agreement",
                    "summary": "Captured source evidence.", "type": "unknown", "product_focus": "other",
                }
                model_result = {
                    "suggested_type": "feature_change" if ai_related else "customer_win",
                    "type_confidence": confidence, "suggested_product_focus": "eff", "focus_confidence": confidence,
                    "is_ai_related": ai_related, "ai_confidence": 0.95, "ai_evidence": "AI agents" if ai_related else "",
                }
                response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(model_result)}]}}]}
                with patch.object(ENRICH, "gemini_request", return_value=response) as request:
                    result = ENRICH.classify_signal(signal, "test-key")
                self.assertEqual(result["is_ai_related"], ai_related)
                self.assertEqual(result["suggested_type"], model_result["suggested_type"])
                if confidence >= 0.8:
                    self.assertEqual(signal["type"], model_result["suggested_type"])
                    self.assertEqual(result["original_type"], "messaging_shift")
                    self.assertEqual(signal["product_focus"], "eff")
                else:
                    self.assertEqual(signal["type"], "messaging_shift")
                    self.assertEqual(signal["product_focus"], "other")
                self.assertNotIn("ai_brief", signal)
                self.assertIn("NOT a signal type", request.call_args.args[2]["contents"][0]["parts"][0]["text"])

    def test_unknown_ai_type_and_personnel_move_fall_back_to_messaging_shift(self):
        signal = {
            "id": "nagarro-personnel-move",
            "competitor": "Jeppesen",
            "headline": "Jeppesen ForeFlight Product Manager joins Nagarro as Aviation Product Consultant",
            "summary": "The employee has moved to a new consulting role; no product release or customer deal is announced.",
            "type": "unknown",
            "product_focus": "other",
        }
        model_result = {
            "suggested_type": "unknown", "type_confidence": 0.55,
            "suggested_product_focus": "other", "focus_confidence": 0.9,
            "is_ai_related": False, "ai_confidence": 0.0, "ai_evidence": "",
        }
        response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(model_result)}]}}]}
        with patch.object(ENRICH, "gemini_request", return_value=response) as request:
            result = ENRICH.classify_signal(signal, "test-key")
        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("employees joining, leaving, or changing roles", prompt)
        self.assertEqual(result["suggested_type"], "messaging_shift")
        self.assertEqual(signal["type"], "messaging_shift")
        self.assertEqual(signal["type_normalized_from"], "unknown")

    def test_classification_rejects_ai_flag_without_source_quote(self):
        result = {
            "suggested_type": "feature_change", "type_confidence": 0.95,
            "suggested_product_focus": "eff", "focus_confidence": 0.95,
            "is_ai_related": True, "ai_confidence": 0.95, "ai_evidence": "AI agents",
        }
        response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(result)}]}}]}
        signal = {"headline": "Workflow automation update", "summary": "New dispatch workflow", "type": "unknown"}
        with patch.object(ENRICH, "gemini_request", return_value=response):
            with self.assertRaisesRegex(ENRICH.EnrichmentError, "supporting quote"):
                ENRICH.classify_signal(signal, "test-key")
        self.assertEqual(signal["type"], "messaging_shift")

    def test_eff_watchlist_overrides_model_efb_suggestion_with_audit(self):
        signal = {
            "id": "bytron-efb-copy", "competitor": "Bytron Skybook", "product": "Bytron Skybook",
            "headline": "Skybook EFB update", "summary": "Bytron improves its flight folder EFB.",
            "type": "feature_change", "product_focus": "efb",
        }
        model_result = {
            "suggested_type": "feature_change", "type_confidence": 0.95,
            "suggested_product_focus": "efb", "focus_confidence": 0.99,
            "is_ai_related": False, "ai_confidence": 0.9, "ai_evidence": "",
        }
        response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(model_result)}]}}]}

        with patch.object(ENRICH, "gemini_request", return_value=response) as request:
            result = ENRICH.classify_signal(signal, "test-key")

        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("Bytron Skybook", prompt)
        self.assertEqual(result["model_suggested_product_focus"], "efb")
        self.assertEqual(result["suggested_product_focus"], "eff")
        self.assertEqual(result["focus_rule_override"], "eff_competitor_watchlist")
        self.assertTrue(result["focus_auto_applied"])
        self.assertEqual(signal["product_focus"], "eff")
        self.assertEqual(result["original_product_focus"], "efb")

    def test_classifier_prompt_carries_full_eff_vendor_knowledge(self):
        model_result = {
            "suggested_type": "messaging_shift", "type_confidence": 0.9,
            "suggested_product_focus": "eff", "focus_confidence": 0.9,
            "is_ai_related": False, "ai_confidence": 0.9, "ai_evidence": "",
        }
        response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(model_result)}]}}]}
        signal = {"id": "domain", "competitor": "Lufthansa Systems", "product": "Lido Flight 4D", "headline": "Flight planning", "summary": "Digital briefing"}
        with patch.object(ENRICH, "gemini_request", return_value=response) as request:
            ENRICH.classify_signal(signal, "test-key")
        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        for product in ENRICH.EFF_WATCHLIST_PRODUCTS:
            with self.subTest(product=product):
                self.assertIn(product, prompt)
        self.assertIn("product/vendor identity outranks generic terminology", prompt)
        self.assertIn("Lido Flight 4D", prompt)
        self.assertIn("Lido mBriefing", prompt)
        self.assertIn("AvioBook Connect", prompt)

    def test_lido_flight4d_domain_rule_overrides_eff_model_suggestion(self):
        signal = {
            "id": "lido-flight-4d", "competitor": "Lufthansa Systems", "product": None,
            "headline": "Kenya Airways implements Lido Flight 4D",
            "summary": "The system combines flight planning, digital briefing, and real-time fleet visibility.",
            "type": "implementation", "product_focus": "eff",
        }
        result = {"suggested_product_focus": "eff", "focus_confidence": 0.95}

        ENRICH.apply_eff_watchlist_focus(signal, result)

        self.assertEqual(result["suggested_product_focus"], "adjacent")
        self.assertEqual(result["focus_rule_override"], "lido_flight_4d_flight_planning")
        self.assertEqual(result["model_suggested_product_focus"], "eff")
        self.assertEqual(result["focus_confidence"], 1.0)

    def test_brief_batches_resume_without_changing_classification_or_existing_analysis(self):
        with tempfile.TemporaryDirectory() as directory:
            feed_path = Path(directory) / "signals.json"
            archive_path = Path(directory) / "signals.archive.json"
            saved_analysis = {"schema_version": 2, "summary": "Previous analysis"}
            signals = [
                {"id": "ram", "headline": "Original headline", "summary": "Captured evidence", "type": "customer_win", "product_focus": "efb", "ai_enrichment": saved_analysis},
                {"id": "other", "headline": "Other headline", "summary": "Other evidence", "type": "messaging_shift", "product_focus": "eff"},
            ]
            feed_path.write_text(json.dumps({"signals": signals}))
            brief = {"brief_version": 1, "title": "A competitor move", "summary": "Saved first-stage summary."}
            with (
                patch.object(ENRICH, "SIGNALS_PATH", feed_path),
                patch.object(ENRICH, "ARCHIVE_PATH", archive_path),
                patch.object(ENRICH, "base_signal_ids", return_value={"ram", "other"}),
                patch.object(ENRICH, "brief_signal", return_value=brief) as generate,
                patch.object(ENRICH, "enrich_signal") as classify,
                patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}),
                patch.object(sys, "argv", ["enrich_signals.py", "--base-ref", "test", "--max-signals", "1"]),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(ENRICH.main(), 0)
                first_pass = json.loads(feed_path.read_text())
                self.assertEqual(sum("ai_brief" in item for item in first_pass["signals"]), 1)
                self.assertEqual(ENRICH.main(), 0)
                self.assertEqual(ENRICH.main(), 0)
            self.assertEqual(generate.call_count, 2)
            classify.assert_not_called()
            feed = json.loads(feed_path.read_text())
            archive = json.loads(archive_path.read_text())
            self.assertEqual(feed["signals"], archive["signals"])
            customer = next(item for item in feed["signals"] if item["id"] == "ram")
            self.assertEqual(customer["type"], "customer_win")
            self.assertEqual(customer["product_focus"], "efb")
            self.assertEqual(customer["headline"], "Original headline")
            self.assertEqual(customer["summary"], "Captured evidence")
            self.assertEqual(customer["ai_enrichment"], saved_analysis)
            self.assertNotIn("ai_brief_status", customer)

    def test_brief_reads_source_text_and_prints_two_fields_without_saving(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "signals.json"
            source_path = Path(directory) / "article.txt"
            path.write_text(json.dumps({"signals": [{
                "id": "one", "headline": "Original", "summary": "Preview",
                "competitor": "Example Systems", "product": "Example Platform", "date": "2026-10-15",
            }]}))
            source_path.write_text("Example Air selected a flight operations platform.", encoding="utf-8")
            original = path.read_bytes()
            response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [
                {"thought": True, "text": "private reasoning"},
                {"text": '```json\n{"title": "Example Air selects platform", "summary": "Example Air selected a flight operations platform."}\n```'},
            ]}}]}
            output = io.StringIO()
            with (
                patch.object(ENRICH, "SIGNALS_PATH", path),
                patch.object(ENRICH, "gemini_request", return_value=response) as request,
                patch.object(ENRICH, "persist_payloads") as persist,
                patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}),
                patch.object(sys, "argv", ["enrich_signals.py", "--test-signal", "one", "--test-mode", "brief", "--source-text-file", str(source_path)]),
                contextlib.redirect_stdout(output),
            ):
                self.assertEqual(ENRICH.main(), 0)
            persist.assert_not_called()
            request.assert_called_once()
            prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
            self.assertIn("Example Air selected", prompt)
            evidence = json.loads(prompt.split("Evidence JSON:\n", 1)[1])
            self.assertEqual(evidence["competitor"], "Example Systems")
            self.assertEqual(evidence["product"], "Example Platform")
            self.assertEqual(evidence["source_text"], source_path.read_text())
            self.assertNotIn("summary", evidence)
            self.assertIn("not as proof of a customer deal", prompt)
            self.assertIn("no concrete change is established", prompt)
            self.assertNotIn("suggested_type", prompt)
            self.assertIn('"title": "Example Air selects platform."', output.getvalue())
            self.assertIn('"evidence_scope": "supplied_source_text"', output.getvalue())
            self.assertNotIn("private reasoning", output.getvalue())
            self.assertEqual(path.read_bytes(), original)

    def test_summary_only_mode_sends_no_full_schema_and_does_not_save(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "signals.json"
            path.write_text(json.dumps({"signals": [{"id": "one", "headline": "Test headline", "summary": "Test evidence"}]}))
            response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [
                {"text": "private reasoning", "thought": True}, {"text": "A short summary."},
            ]}}]}
            output = io.StringIO()
            with (
                patch.object(ENRICH, "SIGNALS_PATH", path),
                patch.object(ENRICH, "gemini_request", return_value=response) as request,
                patch.object(ENRICH, "persist_payloads") as persist,
                patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}),
                patch.object(sys, "argv", ["enrich_signals.py", "--test-signal", "one", "--test-mode", "summary"]),
                contextlib.redirect_stdout(output),
            ):
                self.assertEqual(ENRICH.main(), 0)
            persist.assert_not_called()
            request.assert_called_once()
            prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
            self.assertIn("Test evidence", prompt)
            self.assertNotIn("suggested_type", prompt)
            self.assertIn("A short summary.", output.getvalue())
            self.assertNotIn("private reasoning", output.getvalue())

    def test_single_signal_test_does_not_persist_or_load_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "signals.json"
            path.write_text(json.dumps({"signals": [{"id": "one"}, {"id": "two"}]}))
            original = path.read_bytes()
            with (
                patch.object(ENRICH, "SIGNALS_PATH", path),
                patch.object(ENRICH, "enrich_signal", return_value={"summary": "Validated response"}) as enrich,
                patch.object(ENRICH, "persist_payloads") as persist,
                patch.object(ENRICH, "base_signal_ids") as baseline,
                patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}),
                patch.object(sys, "argv", ["enrich_signals.py", "--test-signal", "one"]),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(ENRICH.main(), 0)
            enrich.assert_called_once_with({"id": "one"}, "test-key")
            persist.assert_not_called()
            baseline.assert_not_called()
            self.assertEqual(path.read_bytes(), original)

    def test_model_defaults_to_gemma_4(self):
        self.assertEqual(ENRICH.MODEL_ID, "gemma-4-26b-a4b-it")

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
        response = {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}
        signal = {
            "id": "test-signal", "competitor": "Example Systems", "date": "2026-10-14",
            "headline": "Example Air selects an EFB platform", "summary": "A customer announcement.",
            "type": "customer_win", "product_focus": "efb", "product": "Example EFB",
        }

        with patch.object(ENRICH, "gemini_request", return_value=response) as request:
            ENRICH.enrich_signal(signal, "test-key")

        request.assert_called_once()
        request_args = request.call_args.args
        self.assertEqual(request_args[0], "test-key")
        self.assertEqual(request_args[1], ENRICH.MODEL_ID)
        self.assertEqual(request_args[2]["contents"][0]["role"], "user")
        self.assertNotIn("responseMimeType", request_args[2]["generationConfig"])
        self.assertEqual(request_args[2]["generationConfig"]["maxOutputTokens"], 4096)

    def test_prompt_classifies_explicit_freight_operator_as_cargo_not_lcc(self):
        result = {
            "headline_summary": "IFS selected by MY FREIGHTER LLC.",
            "summary": "MY FREIGHTER LLC is Central Asia's largest air cargo operator and selected EFBOne.",
            "announcement_tone": "Neutral",
            "competitive_insight": "IFS adds a cargo EFB customer.",
            "caveat": "Fleet deployment details are limited.",
            "customer_airline": "MY FREIGHTER LLC",
            "customer_relationship": "selected",
            "customer_segment": "cargo",
            "customer_confidence": 0.95,
            "customer_segment_confidence": 0.98,
            "suggested_type": "customer_win",
            "type_confidence": 0.95,
            "suggested_product_focus": "eff",
            "focus_confidence": 0.95,
        }
        response = {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}
        signal = {
            "id": "my-freighter-cargo", "competitor": "IFS", "date": "2026-09-08",
            "headline": "MY FREIGHTER LLC selects EFBOne",
            "summary": "MY FREIGHTER LLC is Central Asia's largest air cargo operator and selected EFBOne.",
            "type": "customer_win", "product_focus": "eff", "product": "IFS EFBOne",
        }
        with patch.object(ENRICH, "gemini_request", return_value=response) as request:
            enriched = ENRICH.enrich_signal(signal, "test-key")
        prompt = request.call_args.args[2]["contents"][0]["parts"][0]["text"]
        self.assertIn("air-cargo or freight operator", prompt)
        self.assertIn("MY FREIGHTER LLC / MY FREIGHTER (Centrum Air) is an LCC", prompt)
        self.assertIn("LLC is a legal suffix, not an LCC label", prompt)
        self.assertEqual(enriched["customer_segment"], "cargo")
        self.assertEqual(enriched["customer_segment_confidence"], 0.98)

    def test_thought_parts_are_not_treated_as_final_answer(self):
        response = {
            "candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [
                {"text": "Reasoning text, not a final response", "thought": True},
            ]}}],
        }
        with patch.object(ENRICH, "gemini_request", return_value=response):
            with self.assertRaisesRegex(ENRICH.EnrichmentError, "response_chars=0"):
                ENRICH.enrich_signal({"id": "thought-only"}, "test-key")

    def test_empty_truncated_response_reports_safe_usage_metadata(self):
        signal = {"id": "truncated", "competitor": "Example Systems", "date": "2026-10-14"}
        response = {
            "candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": []}}],
            "usageMetadata": {"candidatesTokenCount": 4096},
        }

        with patch.object(ENRICH, "gemini_request", return_value=response):
            with self.assertRaises(ENRICH.EnrichmentError) as raised:
                ENRICH.enrich_signal(signal, "test-key")

        self.assertIn("finish_reason=MAX_TOKENS", str(raised.exception))
        self.assertIn("completion_tokens=4096", str(raised.exception))
        self.assertIn("response_chars=0", str(raised.exception))
        self.assertIn("response_fields=candidates,usageMetadata", str(raised.exception))
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
                patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}),
                patch.object(sys, "argv", ["enrich_signals.py", "--base-ref", "test", "--max-signals", "3", "--enrichment-stage", "full"]),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                result = ENRICH.main()

            saved = json.loads(signals_path.read_text(encoding="utf-8"))

        self.assertEqual(result, 0)
        self.assertEqual(enrich.call_count, 1)
        self.assertEqual(len(saved["signals"]), 3)
        self.assertTrue(all(signal["ai_enrichment_status"] == "pending" for signal in saved["signals"]))

    def test_gemini_http_error_includes_provider_message(self):
        body = json.dumps({"error": {"message": "API key not valid"}}).encode()
        error = ENRICH.urllib.error.HTTPError(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
            400,
            "Bad Request",
            hdrs=None,
            fp=io.BytesIO(body),
        )

        with patch.object(ENRICH.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(ENRICH.EnrichmentError) as raised:
                ENRICH.gemini_request("test-key", "gemini-3.8-flash", {"contents": []})

        self.assertEqual(raised.exception.http_status, 400)
        self.assertIn("API key not valid", str(raised.exception))
        error.close()

    def test_request_failures_distinguish_timeout_network_and_invalid_json(self):
        cases = [
            (TimeoutError(), "timed out"),
            (ENRICH.http.client.RemoteDisconnected("Remote end closed connection without response"), "closed before an HTTP response"),
            (ENRICH.urllib.error.URLError(TimeoutError()), "timed out"),
            (ENRICH.urllib.error.URLError(OSError()), "network request failed"),
            (json.JSONDecodeError("invalid", "", 0), "invalid JSON response body"),
        ]
        for error, expected in cases:
            with self.subTest(expected=expected, error_type=type(error).__name__):
                with patch.object(ENRICH.urllib.request, "urlopen", side_effect=error):
                    with self.assertRaisesRegex(ENRICH.EnrichmentError, expected):
                        ENRICH.gemini_request("test-key", "gemma-4-26b-a4b-it", {"contents": []})

    def test_request_uses_configured_socket_timeout(self):
        with (
            patch.dict(os.environ, {"AI_ENRICH_REQUEST_TIMEOUT_SECONDS": "180"}),
            patch.object(ENRICH.urllib.request, "urlopen", side_effect=TimeoutError()) as request,
        ):
            with self.assertRaisesRegex(ENRICH.EnrichmentError, "180-second socket timeout"):
                ENRICH.gemini_request("test-key", "gemma-4-26b-a4b-it", {"contents": []})
        self.assertEqual(request.call_args.kwargs["timeout"], 180)

    def test_invalid_socket_timeout_sends_no_request(self):
        for value in ("0", "301", "invalid"):
            with (
                self.subTest(value=value),
                patch.dict(os.environ, {"AI_ENRICH_REQUEST_TIMEOUT_SECONDS": value}),
                patch.object(ENRICH.urllib.request, "urlopen") as request,
            ):
                with self.assertRaisesRegex(ENRICH.EnrichmentError, "integer from 1 to 300"):
                    ENRICH.gemini_request("test-key", "gemma-4-26b-a4b-it", {"contents": []})
                request.assert_not_called()

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