import json
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from scripts import sync_airline_insights as sync


class FakeResponse:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.value).encode("utf-8")


class AirtableSyncTests(unittest.TestCase):
    def test_fetch_table_paginates_and_requests_only_selected_fields(self):
        pages = [
            {"records": [{"id": "rec1", "fields": {"Airline": "Example Air"}}], "offset": "next-page"},
            {"records": [{"id": "rec2", "fields": {"Airline": "Sample Air"}}]},
        ]
        requests = []
        delays = []

        def open_url(request, timeout):
            requests.append(request)
            self.assertEqual(timeout, 30)
            self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
            return FakeResponse(pages[len(requests) - 1])

        records = sync.fetch_table(
            "Airline", ("Airline", "Fleet size"), "test-token", opener=open_url, sleep=delays.append
        )

        self.assertEqual([record["id"] for record in records], ["rec1", "rec2"])
        first_query = parse_qs(urlsplit(requests[0].full_url).query)
        second_query = parse_qs(urlsplit(requests[1].full_url).query)
        self.assertEqual(first_query["pageSize"], ["100"])
        self.assertEqual(first_query["fields[]"], ["Airline", "Fleet size"])
        self.assertEqual(second_query["offset"], ["next-page"])
        self.assertNotIn("Contact", first_query["fields[]"])
        self.assertNotIn("test-token", requests[0].full_url)
        self.assertEqual(delays, [sync.MIN_REQUEST_INTERVAL_SECONDS])

    def test_cell_text_normalizes_single_and_multiple_select_values(self):
        self.assertEqual(sync.cell_text({"id": "opt1", "name": "LCC"}), "LCC")
        self.assertEqual(
            sync.cell_text([{"name": "Bytron Skybook"}, {"name": "ForeFlight"}]),
            "Bytron Skybook, ForeFlight",
        )
        self.assertEqual(sync.cell_text(None), "")

    def test_normalized_rows_resolve_linked_conference_ids(self):
        records = [{
            "fields": {
                "Airline": "Example Air",
                "Conferences Attended": ["rec-event-1", "rec-event-2"],
            },
        }]

        rows = sync.normalized_rows(records, {
            "Conferences Attended": {
                "rec-event-1": "Flight Operations Expo",
                "rec-event-2": "Airline Tech Forum",
            },
        })

        self.assertEqual(rows[0]["Conferences Attended"], "Flight Operations Expo, Airline Tech Forum")

    def test_event_rows_convert_api_dates_and_linked_airlines(self):
        records = [{
            "id": "event1",
            "fields": {
                "Event Name": "Flight Operations Expo",
                "Nature": {"name": "Conference"},
                "Start Date": "2026-11-10",
                "End Date": "2026-11-12T00:00:00.000Z",
                "Location": "London",
                "Airline": ["rec-airline-1", "rec-unknown"],
            },
        }]

        rows = sync.event_rows(records, {"rec-airline-1": "Example Air"})

        self.assertEqual(rows[0]["Nature"], "Conference")
        self.assertEqual(rows[0]["Start Date"], "November 10, 2026")
        self.assertEqual(rows[0]["End Date"], "November 12, 2026")
        self.assertEqual(rows[0]["Airline"], "Example Air")

    def test_refresh_builds_snapshot_from_airline_and_event_api_records(self):
        airline_records = [{
            "id": "rec-airline-1",
            "fields": {
                "Airline": "Example Air",
                "IATA Code": "EX",
                "Fleet size": 35,
                "HQ": "United Kingdom",
                "Airline Type": {"name": "LCC"},
                "EFF Status": [{"name": "Bytron Skybook"}],
                "Flight Planning System": [{"name": "Lido mBriefing"}],
                "Conferences Attended": ["rec-event-1"],
                "Charting": "",
                "Ops Chat": "",
                "Performance Tool": "",
                "Weather": "",
                "MDM Solution": "",
                "Connectivity": "",
                "AID": "",
                "Last Modified": "2026-11-01T00:00:00.000Z",
            },
        }]
        event_records = [{
            "id": "rec-event-1",
            "fields": {
                "Event Name": "Flight Operations Expo",
                "Nature": {"name": "Conference"},
                "Start Date": "2026-11-10",
                "End Date": "2026-11-12",
                "Location": "London",
                "Airline": ["rec-airline-1"],
            },
        }]

        with patch.object(sync, "fetch_table", side_effect=[airline_records, event_records]):
            snapshot = sync.refresh("test-token", sleep=lambda _delay: None)

        self.assertEqual(snapshot["unique_airline_count"], 1)
        self.assertEqual(snapshot["airline_profiles"][0]["airline"], "Example Air")
        self.assertEqual(snapshot["conferences"][0]["start_date"], "2026-11-10")
        self.assertEqual(snapshot["conferences"][0]["attending_airlines"], ["Example Air"])


if __name__ == "__main__":
    unittest.main()
