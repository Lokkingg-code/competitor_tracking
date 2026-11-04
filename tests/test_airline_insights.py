import json
import unittest

from scripts.build_airline_insights import build, country_info, feature_indexes


WORLD = {
    "features": [
        {"properties": {"ADMIN": "United States of America", "NAME": "United States of America", "REGION_WB": "North America"}, "geometry": {}},
        {"properties": {"ADMIN": "India", "NAME": "India", "REGION_WB": "South Asia"}, "geometry": {}},
        {"properties": {"ADMIN": "France", "NAME": "France", "REGION_WB": "Europe & Central Asia"}, "geometry": {}},
    ],
}


class AirlineInsightsTests(unittest.TestCase):
    def test_country_alias_maps_airtable_hq_to_world_feature(self):
        by_name, by_alias = feature_indexes(WORLD)
        self.assertEqual(country_info("United States", by_name, by_alias), {
            "map_name": "United States of America",
            "region": "North America",
        })

    def test_ulcc_is_grouped_with_lcc(self):
        result = build([{
            "Airline": "Ultra Example", "Fleet size": "25", "HQ": "France",
            "Airline Type": "ULCC", "EFF Status": "AvioBook",
            "Flight Planning System": "Lido",
        }], [], WORLD)
        self.assertEqual(result["airline_types"], ["LCC"])
        self.assertEqual(result["overall"]["airline_types"], [{"name": "LCC", "count": 1}])
        self.assertEqual(result["airline_profiles"][0]["airline_type"], "LCC")

    def test_exact_name_airline_type_override_updates_aggregates_and_profile(self):
        result = build([{
            "Airline": " Example Air ", "Fleet size": "25", "HQ": "France",
            "Airline Type": "", "EFF Status": "AvioBook",
            "Flight Planning System": "Lido",
        }], [], WORLD, airline_type_overrides={"Example Air": "Charter"})
        self.assertEqual(result["airline_types"], ["Charter"])
        self.assertEqual(result["overall"]["airline_types"], [{"name": "Charter", "count": 1}])
        self.assertEqual(result["airline_profiles"][0]["airline_type"], "Charter")
        self.assertEqual(result["airline_type_overrides_applied"], 1)

    def test_exact_name_hq_override_assigns_country_and_region(self):
        result = build([{
            "Airline": "Korean Group", "Fleet size": "20", "HQ": "",
            "Airline Type": "LCC", "EFF Status": "",
            "Flight Planning System": "",
        }], [], WORLD, airline_hq_overrides={"Korean Group": "India"})
        profile = result["airline_profiles"][0]
        self.assertEqual(profile["country"], "India")
        self.assertEqual(profile["region"], "South Asia")
        self.assertEqual(result["airline_hq_overrides_applied"], 1)

    def test_dedupes_airline_rows_and_counts_multiselect_coverage_once(self):
        rows = [
            {
                "Airline": "Example Air", "IATA Code": "EX", "Fleet size": "35",
                "HQ": "United States", "Airline Type": "LCC",
                "EFF Status": "NavBlue Mission+,Aviobook", "Flight Planning System": "Lido",
                "Contacts": "Private Contact", "Notes": "Private note",
                "Last Modified": "1/1/2025 9:00am",
            },
            {
                "Airline": "Example Air", "IATA Code": "", "Fleet size": "40",
                "HQ": "United States", "Airline Type": "LCC",
                "EFF Status": "", "Flight Planning System": "",
                "Contacts": "Another Private Contact", "Notes": "Another note",
                "Last Modified": "1/1/2026 9:00am",
            },
            {
                "Airline": "India Air", "IATA Code": "IA", "Fleet size": "80",
                "HQ": "India", "Airline Type": "Flag Carrier",
                "EFF Status": "", "Flight Planning System": "",
                "Contacts": "Private Contact", "Notes": "Private note",
                "Last Modified": "1/1/2026 9:00am",
            },
        ]
        result = build(rows, [], WORLD)
        self.assertEqual(result["unique_airline_count"], 2)
        self.assertEqual(result["duplicate_name_groups"], 1)
        self.assertEqual(result["overall"]["eff_known"], 1)
        self.assertEqual(sum(item["count"] for item in result["overall"]["eff_systems"]), 2)
        self.assertEqual(result["overall"]["planning_known"], 1)
        self.assertEqual(len(result["airline_profiles"]), 2)
        example = next(profile for profile in result["airline_profiles"] if profile["airline"] == "Example Air")
        self.assertEqual(example["airline_type"], "LCC")
        self.assertEqual(example["fleet_band"], "Small · 1–50")
        self.assertEqual(set(example["eff_systems"]), {"Navblue Mission+", "AvioBook"})
        serialized = json.dumps(result)
        self.assertNotIn("Private Contact", serialized)
        self.assertNotIn("Private note", serialized)
        self.assertNotIn("contacts", example)
        self.assertNotIn("notes", example)

    def test_conference_date_conflict_is_flagged_and_not_counted_as_upcoming(self):
        rows = [{
            "Airline": "Example Air", "Fleet size": "20", "HQ": "France",
            "Airline Type": "Regional Airline", "EFF Status": "Paper",
            "Flight Planning System": "",
        }]
        events = [{
            "Event Name": "Historical conference", "Nature": "Conference",
            "Start Date": "June 9, 2026", "End Date": "June 10, 2025",
            "Location": "Amsterdam", "Airline": "Example Air",
            "Notes": "Private event note",
        }]
        result = build(rows, events, WORLD)
        self.assertEqual(result["coverage"]["upcoming_conferences_recorded"], 0)
        self.assertTrue(result["conferences"][0]["date_conflict"])
        self.assertNotIn("Private event note", json.dumps(result))

    def test_conference_attendees_are_joined_from_airline_attendance_field(self):
        airlines = [
            {
                "Airline": "Gulf Helicopters", "Fleet size": "20", "HQ": "Qatar",
                "Airline Type": "Charter", "Conferences Attended": "Aircraft Commerce IT Bangkok (2025)",
            },
            {
                "Airline": "Other Air", "Fleet size": "10", "HQ": "India",
                "Airline Type": "LCC", "Conferences Attended": "",
            },
        ]
        events = [{
            "Event Name": "Aircraft Commerce IT Bangkok (2025)", "Nature": "Conference",
            "Start Date": "October 15, 2025", "End Date": "October 16, 2025",
            "Location": "Bangkok", "Airline": "",
        }]
        result = build(airlines, events, WORLD)
        event = result["conferences"][0]
        self.assertEqual(event["linked_airline_count"], 1)
        self.assertEqual(event["attending_airlines"], ["Gulf Helicopters"])

    def test_conference_end_date_override_clears_confirmed_conflict(self):
        events = [{
            "Event Name": "Aircraft Commerce IT EMEA (2026)", "Nature": "Conference",
            "Start Date": "June 9, 2026", "End Date": "June 10, 2025",
            "Location": "Amsterdam", "Airline": "",
        }]
        result = build([], events, WORLD, event_end_date_overrides={"Aircraft Commerce IT EMEA (2026)": None})
        event = result["conferences"][0]
        self.assertEqual(event["start_date"], "2026-06-09")
        self.assertIsNone(event["end_date"])
        self.assertFalse(event["date_conflict"])
        self.assertEqual(result["coverage"]["upcoming_conferences_recorded"], 0)


if __name__ == "__main__":
    unittest.main()