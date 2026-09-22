import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "merge_signals.py"
SPEC = importlib.util.spec_from_file_location("merge_signals", MODULE_PATH)
MERGE_SIGNALS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MERGE_SIGNALS)


class ProductFocusTests(unittest.TestCase):
    def test_reviewed_product_focus_examples(self):
        cases = [
            ("Corsair adopts Mission+ FLIGHT EFB configuration", "efb"),
            ("Braathens customer story highlights smooth AvioBook EFB rollout", "efb"),
            ("FliteDeck Pro adds graphical NOTAMs", "efb"),
            ("Manage My EFB launches for airline crews", "efb"),
            ("EFBOne as its Electronic Flight Bag platform", "efb"),
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
                self.assertEqual(MERGE_SIGNALS.classify_product_focus(text), expected)


if __name__ == "__main__":
    unittest.main()