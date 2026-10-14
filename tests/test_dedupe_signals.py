import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import dedupe_signals, enrich_signals


def signal(signal_id, *, airline="Royal Air Maroc", product="AvioBook Flight", date="2026-10-08", confidence=0.95, competitor="Thales", relationship="signed", url=None, summary="Announcement"):
    return {
        "id": signal_id,
        "competitor": competitor,
        "product": product,
        "date": date,
        "summary": summary,
        "sources": [{"title": signal_id, "url": url or f"https://example.com/{signal_id}"}],
        "ai_enrichment": {
            "customer_airline": airline,
            "customer_relationship": relationship,
            "customer_confidence": confidence,
            "headline_summary": "Royal Air Maroc selected AvioBook Flight.",
        },
    }


class CustomerEventDedupeTests(unittest.TestCase):
    def test_unenriched_english_and_dutch_deal_captures_collapse(self):
        signals = [
            {
                "id": "english",
                "competitor": "Aviobook",
                "product": "AvioBook",
                "date": "2026-10-13",
                "headline": "Royal Air Maroc has signed a five-year agreement with Thales to equip pilots with AvioBook Flight.",
                "summary": "A fleet-wide agreement for AvioBook.",
                "sources": [{"url": "https://example.com/english"}],
            },
            {
                "id": "dutch",
                "competitor": "Aviobook",
                "product": "AvioBook",
                "date": "2026-10-09",
                "headline": "Royal Air Maroc kiest voor vijf jaar AvioBook Flight.",
                "summary": "Royal Air Maroc kiest voor AvioBook.",
                "sources": [{"url": "https://example.com/dutch"}],
            },
        ]

        records = dedupe_signals.deduplicate_customer_events(signals)

        self.assertEqual(sum(not record.get("duplicate_of") for record in records), 1)
        canonical = next(record for record in records if not record.get("duplicate_of"))
        self.assertEqual(canonical["duplicate_count"], 1)
        self.assertEqual(len(canonical["sources"]), 2)

    def test_unenriched_matches_require_explicit_product_and_deal_language(self):
        signals = [
            {
                "id": "deal",
                "competitor": "Aviobook",
                "product": "AvioBook",
                "date": "2026-10-13",
                "headline": "Royal Air Maroc signed an agreement for AvioBook Flight.",
            },
            {
                "id": "product-mention",
                "competitor": "Aviobook",
                "product": "AvioBook",
                "date": "2026-10-12",
                "headline": "Royal Air Maroc discussed flight operations with AvioBook.",
            },
        ]

        records = dedupe_signals.deduplicate_customer_events(signals)

        self.assertEqual(len(records), 2)
        self.assertTrue(all(not record.get("duplicate_of") for record in records))

    def test_duplicate_customer_deal_collapses_with_provenance(self):
        signals = [
            signal("linkedin", date="2026-10-08", summary="Short post"),
            signal("news", date="2026-10-13", summary="Longer corroborating news article with more details"),
            signal("dutch", date="2026-10-09", relationship="selected"),
        ]

        records = dedupe_signals.deduplicate_customer_events(signals)
        feed = [record for record in records if not record.get("duplicate_of")]

        self.assertEqual(len(feed), 1)
        self.assertEqual(feed[0]["id"], "news")
        self.assertEqual(feed[0]["duplicate_count"], 2)
        self.assertEqual(set(feed[0]["duplicate_signal_ids"]), {"linkedin", "dutch"})
        self.assertEqual(len(feed[0]["sources"]), 3)
        self.assertEqual(sum(bool(record.get("duplicate_of")) for record in records), 2)

    def test_distinct_and_low_confidence_events_stay_separate(self):
        signals = [
            signal("base"),
            signal("other-airline", airline="Cathay Pacific"),
            signal("other-product", product="Another product"),
            signal("other-competitor", competitor="Different vendor"),
            signal("outside-window", date="2026-10-23"),
            signal("low-confidence", confidence=0.7),
            signal("unknown-customer", airline="unknown"),
        ]

        records = dedupe_signals.deduplicate_customer_events(signals)

        self.assertEqual(len(records), len(signals))
        self.assertTrue(all(not record.get("duplicate_of") for record in records))

    def test_persistence_prunes_feed_and_archive_objects_but_keeps_provenance(self):
        payload = {"generated_at": "2026-10-14T00:00:00Z", "signals": [
            signal("linkedin", url="https://example.com/post"),
            signal("news", date="2026-10-10", url="https://example.com/article"),
        ]}
        with tempfile.TemporaryDirectory() as directory:
            feed_path = Path(directory) / "signals.json"
            archive_path = Path(directory) / "signals.archive.json"
            with patch.object(enrich_signals, "SIGNALS_PATH", feed_path), patch.object(enrich_signals, "ARCHIVE_PATH", archive_path):
                enrich_signals.persist_payloads(payload)

            feed = json.loads(feed_path.read_text(encoding="utf-8"))
            archive = json.loads(archive_path.read_text(encoding="utf-8"))

        self.assertEqual([item["id"] for item in feed["signals"]], ["news"])
        self.assertEqual(len(feed["signals"][0]["sources"]), 2)
        self.assertEqual(len(archive["signals"]), 1)
        self.assertEqual(archive["signals"][0]["duplicate_count"], 1)
        self.assertEqual(archive["signals"][0]["duplicate_signal_ids"], ["linkedin"])

    def test_pruning_is_idempotent_and_preserves_duplicate_provenance(self):
        signals = [
            signal("canonical", url="https://example.com/canonical"),
            signal("duplicate", date="2026-10-06", url="https://example.com/duplicate"),
        ]

        pruned = dedupe_signals.prune_duplicate_customer_events(signals)
        pruned_again = dedupe_signals.prune_duplicate_customer_events(pruned)

        self.assertEqual(len(pruned), 1)
        self.assertEqual(pruned[0]["duplicate_signal_ids"], ["duplicate"])
        self.assertEqual(pruned[0]["duplicate_count"], 1)
        self.assertEqual(len(pruned[0]["sources"]), 2)
        self.assertEqual(pruned_again, pruned)


if __name__ == "__main__":
    unittest.main()