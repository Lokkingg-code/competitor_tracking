import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "merge_signals.py"
SPEC = importlib.util.spec_from_file_location("merge_signals", MODULE_PATH)
MERGE_SIGNALS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MERGE_SIGNALS)


class ProductFocusTests(unittest.TestCase):
    def test_skybook_release_notes_are_feature_changes(self):
        with (MODULE_PATH.parents[1] / "data" / "signals.json").open() as source:
            signal = next(item for item in json.load(source)["signals"] if item["id"] == "cap-bab00bf9c288")
        text = f"{signal['headline']} {signal['summary']}"
        self.assertEqual(MERGE_SIGNALS.infer_type(text, headline=signal["headline"]), "feature_change")
        self.assertEqual(MERGE_SIGNALS.infer_type(text), "feature_change")
        captured = MERGE_SIGNALS.raw_to_signal({
            "id": signal["id"], "competitor": signal["competitor"],
            "title": signal["headline"], "summary": signal["summary"],
            "published_at": signal["date"], "source_channel": "press_release",
            "url": signal["sources"][0]["url"],
        })
        self.assertIsNotNone(captured)
        self.assertEqual(captured["type"], "feature_change")
        self.assertEqual(captured["product_focus"], "eff")
        self.assertEqual(captured["ai_enrichment_status"], "pending")
        self.assertEqual(MERGE_SIGNALS.sanitize_signal({**signal, "type": "customer_win"})["type"], "feature_change")
        self.assertEqual(MERGE_SIGNALS.sanitize_signal({**signal, "tags": ["curated"], "type": "customer_win"})["type"], "customer_win")

    def test_operational_signoff_is_not_a_customer_win(self):
        for phrase in ("signed-off sectors", "signed off sectors", "redesigned sectors"):
            with self.subTest(phrase=phrase):
                self.assertEqual(MERGE_SIGNALS.infer_type(f"Update: users can edit data for {phrase}"), "feature_change")
        self.assertEqual(MERGE_SIGNALS.infer_type("Airline signed a contract for skybook"), "customer_win")
        self.assertEqual(MERGE_SIGNALS.infer_type("Airline signs for skybook"), "customer_win")
        self.assertEqual(MERGE_SIGNALS.infer_type("Airline selects skybook; see release notes for product details", headline="Airline selects skybook"), "customer_win")

    def test_eff_watchlist_defaults(self):
        for product in ("Aviobook", "Boeing flightfolder", "Bytron skybook", "CAE eflightmanager", "Flightman", "Foreflight", "Lido mbriefing", "Logipad", "Mission+", "Topwing", "IFS EFBOne"):
            with self.subTest(product=product):
                self.assertEqual(MERGE_SIGNALS.classify_product_focus(product, product=product), "eff")

    def test_eff_watchlist_overrides_generic_efb_wording(self):
        for product in ("Aviobook", "Boeing FlightFolder", "Bytron Skybook", "CAE eFlightManager", "Flightman", "ForeFlight", "Lido mBriefing", "Logipad", "Mission+", "Topwing", "IFS EFBOne"):
            with self.subTest(product=product):
                self.assertEqual(MERGE_SIGNALS.classify_product_focus(f"{product} EFB electronic flight bag platform", product=product), "eff")

    def test_lido_flight4d_is_adjacent_while_mbriefing_is_eff(self):
        self.assertEqual(
            MERGE_SIGNALS.classify_product_focus(
                "Lido Flight 4D combines flight planning and digital briefing",
                "Lufthansa Systems", "Lido Flight 4D",
            ),
            "adjacent",
        )
        self.assertEqual(
            MERGE_SIGNALS.classify_product_focus(
                "Lido mBriefing delivers electronic pilot briefings",
                "Lufthansa Systems", "Lido mBriefing",
            ),
            "eff",
        )

    def test_lido_flight4d_is_adjacent_but_lido_mbriefing_is_eff(self):
        self.assertEqual(
            MERGE_SIGNALS.classify_product_focus(
                "Lufthansa Systems Lido Flight 4D combines flight planning and digital briefing",
                "Lufthansa Systems", "Lido Flight 4D",
            ),
            "adjacent",
        )
        self.assertEqual(
            MERGE_SIGNALS.classify_product_focus(
                "Lido mBriefing delivers paperless pilot briefings",
                "Lufthansa Systems", "Lido mBriefing",
            ),
            "eff",
        )

    def test_recruitment_is_omitted_before_product_classification(self):
        for text in (
            "New opportunities at AvioBook! Check out our open roles below. #WeAreHiring",
            "ForeFlight product manager job vacancies",
            "Interview experience: Senior Software Engineer @ Lufthansa Systems (Netline)",
            "AvioBook #NowHiring aviation software developers",
        ):
            with self.subTest(text=text):
                self.assertIsNone(MERGE_SIGNALS.raw_to_signal({
                    "id": "recruitment", "competitor": "Aviobook", "title": text,
                    "summary": "AvioBook flight operations platform", "published_at": "2026-09-22",
                    "source_channel": "linkedin", "url": "https://example.com/post",
                }))
        self.assertFalse(MERGE_SIGNALS.is_noise("Aviobook launches a new flight operations platform"))

    def test_archived_recruitment_cannot_reenter_feed(self):
        signal = {"headline": "New opportunities at AvioBook!", "summary": "Check our open roles", "tags": ["auto-capture"]}
        self.assertTrue(MERGE_SIGNALS.omit_archived_signal(signal))
        self.assertFalse(MERGE_SIGNALS.omit_archived_signal({**signal, "tags": ["curated"]}))
        self.assertFalse(MERGE_SIGNALS.omit_archived_signal({**signal, "headline": "AvioBook product release", "summary": "New flight folder capabilities"}))

    def test_merge_sanitization_preserves_saved_ai_enrichment(self):
        saved = {
            "summary": "Saved once",
            "suggested_type": "feature_change",
            "suggested_product_focus": "eff",
        }
        signal = {
            "id": "enriched",
            "competitor": "Aviobook",
            "date": "2026-10-08",
            "type": "customer_win",
            "priority": "medium",
            "headline": "Aviobook release notes for a flight-folder update",
            "summary": "Aviobook release notes describe flight-folder features.",
            "tags": ["auto-capture"],
            "product_focus": "efb",
            "ai_enrichment": {**saved, "suggested_type": "customer_win", "suggested_product_focus": "efb"},
        }
        sanitized = MERGE_SIGNALS.sanitize_signal(signal)
        self.assertEqual(sanitized["ai_enrichment"]["summary"], saved["summary"])
        self.assertEqual(sanitized["type"], "customer_win")
        self.assertEqual(sanitized["product_focus"], "efb")

    def test_merge_sanitization_preserves_analyst_product_focus_review(self):
        review = {"from": "efb", "to": "eff", "rule": "eff_competitor_watchlist"}
        sanitized = MERGE_SIGNALS.sanitize_signal({
            "id": "reviewed-focus", "competitor": "Bytron Skybook", "product": "Bytron Skybook",
            "headline": "Bytron Skybook EFB update", "summary": "Release notes for Skybook EFB.",
            "type": "feature_change", "priority": "medium", "product_focus": "eff",
            "analyst_product_focus_review": review,
        })
        self.assertEqual(sanitized["product_focus"], "eff")
        self.assertEqual(sanitized["analyst_product_focus_review"], review)

    def test_explicit_context_overrides_generic_foreflight_indicator(self):
        self.assertEqual(MERGE_SIGNALS.classify_product_focus("ForeFlight crew pairing automation"), "adjacent")
        self.assertEqual(MERGE_SIGNALS.classify_product_focus("ForeFlight Insurance Marketplace"), "other")
        self.assertEqual(MERGE_SIGNALS.classify_product_focus("ForeFlight announces executive appointments"), "other")
        self.assertEqual(MERGE_SIGNALS.classify_product_focus("Jeppesen ForeFlight launches Airflow AI Engine"), "adjacent")

    def test_welcome_to_platform_is_customer_win(self):
        announcement = (
            "Excited to welcome MY FREIGHTER (Centrum Air), Central Asia's largest "
            "air cargo operator, to the EFBOne platform. A big thank you to their "
            "teams for the outstanding collaboration on this project."
        )
        self.assertEqual(MERGE_SIGNALS.infer_type(announcement), "customer_win")
        self.assertEqual(
            MERGE_SIGNALS.infer_type("We welcome researchers to our strategic research partnership"),
            "partnership",
        )
        self.assertEqual(
            MERGE_SIGNALS.infer_type("Welcome to our product launch webinar and new platform release"),
            "product_launch",
        )

    def test_reviewed_product_focus_examples(self):
        cases = [
            ("Corsair adopts Mission+ FLIGHT EFB configuration", "eff"),
            ("Braathens customer story highlights smooth AvioBook EFB rollout", "eff"),
            ("FliteDeck Pro adds graphical NOTAMs", "efb"),
            ("Manage My EFB launches for airline crews", "efb"),
            ("EFBOne as its Electronic Flight Bag platform", "eff"),
            ("Instant messaging connects dispatchers and pilots through the EFB", "efb"),
            ("Skybook adds electronic flight folder briefing", "eff"),
            ("ForeFlight EFFCore release improves crew briefing", "eff"),
            ("Mission+ DOC improves flight operations documentation", "eff"),
            ("Boeing FlightFolder adds loadsheet distribution", "eff"),
            ("Aviobook Connect adds secure flight-ops communications", "adjacent"),
            ("NetLine network planning update", "adjacent"),
            ("New crew pairing capabilities", "adjacent"),
            ("Company leadership announcement", "other"),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(MERGE_SIGNALS.classify_product_focus(text, product=text), expected)


if __name__ == "__main__":
    unittest.main()