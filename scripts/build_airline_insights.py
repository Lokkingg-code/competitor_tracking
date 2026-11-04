#!/usr/bin/env python3
"""Build an aggregate-only airline insights snapshot from Airtable CSV exports."""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORLD_GEOJSON = ROOT / "assets" / "ne_110m_admin_0_countries.geojson"
OUTPUT_PATH = ROOT / "data" / "airline-insights.json"
FLEET_FIELDS = (
    "IATA Code", "Fleet size", "HQ", "Airline Type", "EFF Status",
    "Flight Planning System", "Conferences Attended", "Charting", "Ops Chat", "Performance Tool",
    "Weather", "MDM Solution", "Connectivity", "AID",
)
SYSTEM_FIELDS = (
    "EFF Status", "Flight Planning System", "Charting", "Ops Chat",
    "Performance Tool", "Weather", "MDM Solution", "Connectivity", "AID",
)
COUNTRY_ALIASES = {
    "united states": "united states of america",
    "macau": "macao",
    "south korea": "republic of korea",
    "north korea": "democratic people's republic of korea",
    "russia": "russian federation",
    "tanzania": "united republic of tanzania",
    "iran": "iran",
    "syria": "syrian arab republic",
    "venezuela": "venezuela",
    "bolivia": "bolivia",
    "moldova": "moldova",
    "brunei": "brunei darussalam",
    "laos": "lao people's democratic republic",
    "czech republic": "czechia",
    "turkey": "turkey",
    "netherlands & france": "",
}
UNMAPPED_REGIONS = {
    "antigua and barbuda": "Latin America & Caribbean",
    "aruba": "Latin America & Caribbean",
    "bahrain": "Middle East & North Africa",
    "bermuda": "North America",
    "cayman islands": "Latin America & Caribbean",
    "french polynesia": "East Asia & Pacific",
    "hong kong": "East Asia & Pacific",
    "macau": "East Asia & Pacific",
    "malta": "Europe & Central Asia",
    "mauritius": "Sub-Saharan Africa",
    "nauru": "East Asia & Pacific",
    "netherlands france": "Europe & Central Asia",
    "seychelles": "Sub-Saharan Africa",
    "singapore": "East Asia & Pacific",
    "united states": "North America",
    "global": "Global",
}
EVENT_CITY_REGIONS = {
    "amsterdam": "Europe & Central Asia",
    "london": "Europe & Central Asia",
    "luxembourg": "Europe & Central Asia",
    "guangzhou": "East Asia & Pacific",
    "bangkok": "East Asia & Pacific",
    "macau": "East Asia & Pacific",
    "hong kong": "East Asia & Pacific",
    "taiwan": "East Asia & Pacific",
    "montreal": "North America",
    "chicago": "North America",
}
EFF_NO_VENDOR = {"paper", "in-house built", "in house built", "own solution"}


def key(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def parse_modified(value: str) -> datetime:
    value = (value or "").strip()
    for pattern in ("%m/%d/%Y %I:%M%p", "%m/%d/%Y %I:%M %p", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, pattern)
        except ValueError:
            pass
    return datetime.min


def canonical_rows(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int, int]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        airline = (row.get("Airline") or "").strip()
        if airline:
            grouped[key(airline)].append(row)

    records = []
    duplicate_groups = 0
    duplicate_conflicts = 0
    for group in grouped.values():
        ordered = sorted(group, key=lambda row: parse_modified(row.get("Last Modified", "")), reverse=True)
        if len(ordered) > 1:
            duplicate_groups += 1
            if any(len({(row.get(field) or "").strip().casefold() for row in ordered if (row.get(field) or "").strip()}) > 1 for field in ("Fleet size", "HQ", "Airline Type", "EFF Status", "Flight Planning System")):
                duplicate_conflicts += 1
        merged = dict(ordered[0])
        for field in FLEET_FIELDS:
            if not (merged.get(field) or "").strip():
                merged[field] = next(((row.get(field) or "").strip() for row in ordered[1:] if (row.get(field) or "").strip()), "")
        records.append(merged)
    return records, duplicate_groups, duplicate_conflicts


def feature_indexes(world: dict) -> tuple[dict[str, dict], dict[str, dict]]:
    by_name: dict[str, dict] = {}
    by_alias: dict[str, dict] = {}
    for feature in world.get("features", []):
        props = feature.get("properties") or {}
        admin = str(props.get("ADMIN") or "").strip()
        if not admin:
            continue
        info = {
            "map_name": admin,
            "region": str(props.get("REGION_WB") or "Unmapped"),
        }
        for field in ("ADMIN", "NAME", "NAME_LONG", "SOVEREIGNT", "FORMAL_EN", "NAME_EN"):
            candidate = str(props.get(field) or "").strip()
            if candidate:
                by_name.setdefault(key(candidate), info)
        for candidate in re.split(r"[;,]", str(props.get("NAME_ALT") or "")):
            if candidate.strip():
                by_alias.setdefault(key(candidate), info)
    return by_name, by_alias


def country_info(value: str, by_name: dict[str, dict], by_alias: dict[str, dict]) -> dict:
    raw = (value or "").strip()
    normalized = key(raw)
    alias = key(COUNTRY_ALIASES.get(normalized, normalized))
    info = by_name.get(alias) or by_alias.get(alias)
    if info:
        return dict(info)
    return {
        "map_name": None,
        "region": UNMAPPED_REGIONS.get(normalized, "Unmapped"),
    }


def canonical_category(value: str, *, field: str) -> str:
    value = re.sub(r"\s+", " ", (value or "").strip())
    normalized = key(value)
    if field == "Airline Type" and normalized == "ulcc":
        return "LCC"
    aliases = {
        "commerical": "Commercial",
        "commercial": "Commercial",
        "aviobook": "AvioBook",
        "navblue mission": "Navblue Mission+",
        "cae eflight manager": "CAE eFlightManager",
        "lido mbriefing": "Lido mBriefing",
        "ifs efbone": "IFS EFBOne",
        "topwing": "TopWing",
        "in house built": "In-house built",
    }
    if normalized in aliases:
        return aliases[normalized]
    return value


def split_multiselect(value: str, *, field: str) -> list[str]:
    return list(dict.fromkeys(
        canonical_category(part, field=field)
        for part in re.split(r"[,;]", value or "")
        if part.strip()
    ))


def fleet_band(value: str) -> str:
    try:
        size = int(float((value or "").replace(",", "").strip()))
    except ValueError:
        return "Unspecified"
    if size <= 0:
        return "Unspecified"
    if size > 1500:
        return "Check value"
    if size <= 50:
        return "Small · 1–50"
    if size <= 150:
        return "Medium · 51–150"
    return "Large · 151+"


def increment(mapping: dict[str, int], value: str, amount: int = 1) -> None:
    if value:
        mapping[value] = mapping.get(value, 0) + amount


def blank_bucket() -> dict:
    return {
        "airlines": 0,
        "fleet_values_recorded": 0,
        "fleet_known": 0,
        "fleet_sum": 0,
        "fleet_outliers": 0,
        "eff_known": 0,
        "eff_systems": {},
        "eff_no_vendor": 0,
        "planning_known": 0,
        "planning_systems": {},
        "airline_types": {},
        "fleet_bands": {},
    }


def add_record(bucket: dict, record: dict) -> None:
    bucket["airlines"] += 1
    airline_type = record["airline_type"]
    band = record["fleet_band"]
    increment(bucket["airline_types"], airline_type)
    increment(bucket["fleet_bands"], band)
    if record["fleet_size"] is not None:
        bucket["fleet_values_recorded"] += 1
        if record["fleet_size"] > 1500:
            bucket["fleet_outliers"] += 1
        else:
            bucket["fleet_known"] += 1
            bucket["fleet_sum"] += record["fleet_size"]
    if record["eff_systems"]:
        bucket["eff_known"] += 1
        if any(key(system) in EFF_NO_VENDOR for system in record["eff_systems"]):
            bucket["eff_no_vendor"] += 1
    for system in record["eff_systems"]:
        increment(bucket["eff_systems"], system)
    if record["planning_systems"]:
        bucket["planning_known"] += 1
    for system in record["planning_systems"]:
        increment(bucket["planning_systems"], system)


def date_value(value: str) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, "%B %d, %Y").date()
    except ValueError:
        return None


def event_region(location: str) -> str:
    normalized = key(location)
    return EVENT_CITY_REGIONS.get(normalized, "Unmapped")


def build(
    airline_rows: list[dict[str, str]],
    event_rows: list[dict[str, str]],
    world: dict,
    *,
    airline_type_overrides: dict[str, str] | None = None,
    airline_hq_overrides: dict[str, str] | None = None,
    event_end_date_overrides: dict[str, str | None] | None = None,
) -> dict:
    by_name, by_alias = feature_indexes(world)
    records, duplicate_groups, duplicate_conflicts = canonical_rows(airline_rows)
    normalized_type_overrides = {key(name): value for name, value in (airline_type_overrides or {}).items()}
    normalized_hq_overrides = {key(name): value for name, value in (airline_hq_overrides or {}).items()}
    normalized_event_date_overrides = {key(name): value for name, value in (event_end_date_overrides or {}).items()}
    for record in records:
        airline_key = key(record.get("Airline", ""))
        type_override = normalized_type_overrides.get(airline_key)
        hq_override = normalized_hq_overrides.get(airline_key)
        if type_override:
            record["Airline Type"] = type_override
        if hq_override:
            record["HQ"] = hq_override
    country_buckets: dict[str, dict] = {}
    region_buckets: dict[str, dict] = {}
    segment_buckets: dict[tuple[str, str, str], dict] = {}
    country_segment_buckets: dict[tuple[str, str, str, str], dict] = {}
    airline_profiles = []
    overall = blank_bucket()
    quality = Counter()

    for row in records:
        country = (row.get("HQ") or "").strip()
        location = country_info(country, by_name, by_alias)
        region = location["region"] or "Unmapped"
        try:
            fleet_size = int(float((row.get("Fleet size") or "").replace(",", "").strip()))
            if fleet_size <= 0:
                fleet_size = None
        except ValueError:
            fleet_size = None
        airline_type = canonical_category(row.get("Airline Type", ""), field="Airline Type") or "Unclassified"
        eff_systems = split_multiselect(row.get("EFF Status", ""), field="EFF Status")
        planning_systems = split_multiselect(row.get("Flight Planning System", ""), field="Flight Planning System")
        record = {
            "airline": (row.get("Airline") or "").strip(),
            "country": country or "Unspecified",
            "region": region,
            "airline_type": airline_type,
            "fleet_size": fleet_size,
            "fleet_band": fleet_band(row.get("Fleet size", "")),
            "eff_systems": eff_systems,
            "planning_systems": planning_systems,
        }
        airline_profiles.append(record)
        if not country:
            quality["missing_hq"] += 1
        elif not location.get("map_name"):
            quality["hq_not_mapped"] += 1
        if not location.get("region") or location["region"] == "Unmapped":
            quality["hq_region_unassigned"] += 1
        if not row.get("Airline Type", "").strip():
            quality["missing_airline_type"] += 1
        if not row.get("Fleet size", "").strip():
            quality["missing_fleet_size"] += 1
        if fleet_size and fleet_size > 1500:
            quality["fleet_size_outliers"] += 1
        if not eff_systems:
            quality["missing_eff_status"] += 1
        if not planning_systems:
            quality["missing_flight_planning"] += 1

        add_record(overall, record)
        country_key = country or "Unspecified"
        country_bucket = country_buckets.setdefault(country_key, blank_bucket())
        add_record(country_bucket, record)
        region_bucket = region_buckets.setdefault(region, blank_bucket())
        add_record(region_bucket, record)
        segment_key = (region, airline_type, record["fleet_band"])
        segment_bucket = segment_buckets.setdefault(segment_key, blank_bucket())
        add_record(segment_bucket, record)
        country_segment_key = (country_key, region, airline_type, record["fleet_band"])
        country_segment_bucket = country_segment_buckets.setdefault(country_segment_key, blank_bucket())
        add_record(country_segment_bucket, record)

    all_airlines = len(records)
    airline_names = {key(row.get("Airline", "")): row.get("Airline", "").strip() for row in records if row.get("Airline", "").strip()}
    attendance_by_event: dict[str, set[str]] = defaultdict(set)
    for row in records:
        airline = row.get("Airline", "").strip()
        for event_name in split_multiselect(row.get("Conferences Attended", ""), field="Conference"):
            if event_name:
                attendance_by_event[key(event_name)].add(airline)

    def linked_airline_names(value: str) -> set[str]:
        raw = (value or "").strip()
        if not raw:
            return set()
        exact = airline_names.get(key(raw))
        if exact:
            return {exact}
        return {airline_names[normalized] for part in raw.split(",") if (normalized := key(part)) in airline_names}

    events = []
    for row in event_rows:
        nature = (row.get("Nature") or "").strip()
        if key(nature) != "conference":
            continue
        start = date_value(row.get("Start Date", ""))
        end = date_value(row.get("End Date", ""))
        location = (row.get("Location") or "").strip()
        name = (row.get("Event Name") or "").strip()
        if key(name) in normalized_event_date_overrides:
            end_override = normalized_event_date_overrides[key(name)]
            end = date_value(end_override) if end_override else None
        attending_airlines = attendance_by_event.get(key(name), set()) | linked_airline_names(row.get("Airline", ""))
        events.append({
            "name": name,
            "start_date": start.isoformat() if start else None,
            "end_date": end.isoformat() if end else None,
            "date_conflict": bool(start and end and end < start),
            "location": location or "Location not recorded",
            "region": event_region(location),
            "attending_airlines": sorted(attending_airlines, key=str.casefold),
            "linked_airline_count": len(attending_airlines),
            "nature": nature,
        })
    today = date.today()
    upcoming = [event for event in events if not event["date_conflict"] and event["end_date"] and date.fromisoformat(event["end_date"]) >= today]
    event_region_counts = Counter(event["region"] for event in events)

    def sorted_counts(mapping: dict[str, int]) -> list[dict]:
        return [{"name": name, "count": count} for name, count in sorted(mapping.items(), key=lambda item: (-item[1], item[0]))]

    countries = []
    for country, bucket in country_buckets.items():
        location = country_info(country, by_name, by_alias)
        countries.append({
            "country": country,
            "map_name": location.get("map_name"),
            "region": location["region"],
            "airlines": bucket["airlines"],
            "fleet_values_recorded": bucket["fleet_values_recorded"],
            "fleet_known": bucket["fleet_known"],
            "fleet_sum": bucket["fleet_sum"],
            "fleet_outliers": bucket["fleet_outliers"],
            "eff_known": bucket["eff_known"],
            "eff_no_vendor": bucket["eff_no_vendor"],
            "eff_systems": sorted_counts(bucket["eff_systems"]),
            "planning_known": bucket["planning_known"],
            "planning_systems": sorted_counts(bucket["planning_systems"]),
        })
    countries.sort(key=lambda item: (-item["airlines"], item["country"]))

    def region_summary(name: str, bucket: dict) -> dict:
        return {
            "name": name,
            "airlines": bucket["airlines"],
            "fleet_known": bucket["fleet_known"],
            "fleet_outliers": bucket["fleet_outliers"],
            "eff_known": bucket["eff_known"],
            "eff_no_vendor": bucket["eff_no_vendor"],
            "eff_systems": sorted_counts(bucket["eff_systems"]),
            "planning_known": bucket["planning_known"],
            "planning_systems": sorted_counts(bucket["planning_systems"]),
            "airline_types": sorted_counts(bucket["airline_types"]),
            "fleet_bands": sorted_counts(bucket["fleet_bands"]),
            "conference_count": event_region_counts.get(name, 0),
        }
    regions = [region_summary(name, bucket) for name, bucket in sorted(region_buckets.items(), key=lambda item: (-item[1]["airlines"], item[0]))]
    segments = [
        {"region": region, "airline_type": airline_type, "fleet_band": band, **region_summary(region, bucket)}
        for (region, airline_type, band), bucket in sorted(segment_buckets.items())
    ]
    country_segments = []
    for (country, region, airline_type, band), bucket in sorted(country_segment_buckets.items()):
        location = country_info(country, by_name, by_alias)
        country_segments.append({
            "country": country,
            "map_name": location.get("map_name"),
            "region": region,
            "airline_type": airline_type,
            "fleet_band": band,
            "airlines": bucket["airlines"],
            "fleet_values_recorded": bucket["fleet_values_recorded"],
            "fleet_known": bucket["fleet_known"],
            "fleet_sum": bucket["fleet_sum"],
            "fleet_outliers": bucket["fleet_outliers"],
            "eff_known": bucket["eff_known"],
            "eff_no_vendor": bucket["eff_no_vendor"],
            "eff_systems": sorted_counts(bucket["eff_systems"]),
            "planning_known": bucket["planning_known"],
            "planning_systems": sorted_counts(bucket["planning_systems"]),
        })
    return {
        "schema_version": 1,
        "source": "Airtable Airline Customer Pipeline shared view",
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_record_count": len(airline_rows),
        "unique_airline_count": all_airlines,
        "duplicate_name_groups": duplicate_groups,
        "duplicate_conflict_groups": duplicate_conflicts,
        "airline_type_overrides_applied": sum(key(record.get("Airline", "")) in normalized_type_overrides for record in records),
        "airline_hq_overrides_applied": sum(key(record.get("Airline", "")) in normalized_hq_overrides for record in records),
        "fleet_bands": ["Small · 1–50", "Medium · 51–150", "Large · 151+", "Check value", "Unspecified"],
        "region_names": sorted(region_buckets),
        "airline_types": sorted({record["airline_type"] for record in [
            {"airline_type": canonical_category(row.get("Airline Type", ""), field="Airline Type") or "Unclassified"}
            for row in records
        ]}),
        "coverage": {
            "hq_known": all_airlines - quality["missing_hq"],
            "hq_region_assigned": all_airlines - quality["hq_region_unassigned"],
            "hq_mapped": all_airlines - quality["missing_hq"] - quality["hq_not_mapped"],
            "fleet_values_recorded": overall["fleet_values_recorded"],
            "fleet_known": overall["fleet_known"],
            "fleet_size_outliers": overall["fleet_outliers"],
            "airline_type_known": all_airlines - quality["missing_airline_type"],
            "eff_status_known": overall["eff_known"],
            "flight_planning_known": overall["planning_known"],
            "conferences_recorded": len(events),
            "upcoming_conferences_recorded": len(upcoming),
            "unmapped_event_regions": sum(event["region"] == "Unmapped" for event in events),
            "quality_flags": dict(quality),
        },
        "overall": region_summary("All", overall),
        "regions": regions,
        "countries": countries,
        "segments": segments,
        "country_segments": country_segments,
        "airline_profiles": sorted(airline_profiles, key=lambda item: (item["airline"].casefold(), item["country"])),
        "conferences": events,
        "methodology": {
            "analysis_scope": "Airtable Airlines and Events tables only; signal-feed data is not used.",
            "duplicate_airlines": "Exact airline names are deduplicated. Newest Last Modified row wins; blank fields fall back to older nonblank values.",
            "fleet_bands": "Small 1-50; Medium 51-150; Large 151+. Values above 1,500 are flagged as needing verification and excluded from size means.",
            "carrier_types": "ULCC labels are grouped with LCC. Optional exact-name overrides apply updated Airtable Airline Type labels.",
            "headquarters": "Optional exact-name HQ overrides fill confirmed missing headquarters values before country and region mapping.",
            "conference_dates": "Optional exact-name end-date overrides resolve confirmed Airtable date errors without changing the source export.",
            "eff_and_planning": "Only recorded Airtable values are counted. Blank fields are missing coverage, not evidence of no adoption.",
            "conference_priority": "Historical conference records are summarized with linked-airline counts. Counts are coverage signals, not measured event ROI.",
            "excluded_fields": ["Contacts", "Status", "Notes", "Questions Raised", "Potential Enhancements", "Recording Link", "RFP Website", "Remarks", "Demo Lead"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--airlines-csv", type=Path, required=True, help="Airtable Airline table CSV export")
    parser.add_argument("--events-csv", type=Path, help="Optional Airtable Events table CSV export")
    parser.add_argument("--airline-type-overrides", type=Path, help="Optional JSON map of exact airline names to updated Airtable types")
    parser.add_argument("--airline-hq-overrides", type=Path, help="Optional JSON map of exact airline names to confirmed headquarters countries")
    parser.add_argument("--event-end-date-overrides", type=Path, help="Optional JSON map of conference names to corrected end dates; use null to clear a bad end date")
    parser.add_argument("--world-geojson", type=Path, default=DEFAULT_WORLD_GEOJSON)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    for path in (args.airlines_csv, args.world_geojson):
        if not path.exists():
            parser.error(f"Input file does not exist: {path}")
    if args.airline_type_overrides and not args.airline_type_overrides.exists():
        parser.error(f"Airline type overrides file does not exist: {args.airline_type_overrides}")
    if args.airline_hq_overrides and not args.airline_hq_overrides.exists():
        parser.error(f"Airline HQ overrides file does not exist: {args.airline_hq_overrides}")
    if args.event_end_date_overrides and not args.event_end_date_overrides.exists():
        parser.error(f"Conference date overrides file does not exist: {args.event_end_date_overrides}")
    if args.events_csv and not args.events_csv.exists():
        parser.error(f"Events CSV does not exist: {args.events_csv}")
    event_rows = read_csv(args.events_csv) if args.events_csv else []
    overrides = json.loads(args.airline_type_overrides.read_text(encoding="utf-8")) if args.airline_type_overrides else None
    hq_overrides = json.loads(args.airline_hq_overrides.read_text(encoding="utf-8")) if args.airline_hq_overrides else None
    event_date_overrides = json.loads(args.event_end_date_overrides.read_text(encoding="utf-8")) if args.event_end_date_overrides else None
    data = build(
        read_csv(args.airlines_csv),
        event_rows,
        json.loads(args.world_geojson.read_text(encoding="utf-8")),
        airline_type_overrides=overrides,
        airline_hq_overrides=hq_overrides,
        event_end_date_overrides=event_date_overrides,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote aggregates and {data['unique_airline_count']} airline profiles to {args.output} ({data['airline_type_overrides_applied']} type, {data['airline_hq_overrides_applied']} HQ overrides)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())