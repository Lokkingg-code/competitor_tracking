#!/usr/bin/env python3
"""Refresh the aggregate Airline Insights snapshot from Airtable's read-only API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import build_airline_insights as snapshot_builder

BASE_ID = "appEuphkz7MCYDzOH"
AIRLINE_TABLE = "Airline"
EVENTS_TABLE = "Events"
OUTPUT_PATH = ROOT / "data" / "airline-insights.json"
AIRLINE_FIELDS = ("Airline", *snapshot_builder.FLEET_FIELDS, "Last Modified")
EVENT_FIELDS = ("Event Name", "Nature", "Start Date", "End Date", "Location", "Airline")
API_ROOT = "https://api.airtable.com/v0"
MIN_REQUEST_INTERVAL_SECONDS = 0.21


def cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        return str(value.get("name") or value.get("value") or "")
    if isinstance(value, list):
        return ", ".join(text for item in value if (text := cell_text(item)))
    return str(value)


def request_json(request: urllib.request.Request, *, opener=None, sleep=time.sleep) -> dict:
    open_url = opener or urllib.request.urlopen
    for attempt in range(3):
        try:
            with open_url(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 2:
                retry_after = error.headers.get("Retry-After", "30")
                try:
                    delay = max(1, int(retry_after))
                except ValueError:
                    delay = 30
                sleep(delay)
                continue
            raise RuntimeError(f"Airtable API returned HTTP {error.code} for a table read") from None
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError(f"Airtable API request failed: {error.reason if isinstance(error, urllib.error.URLError) else 'timeout'}") from None
    raise RuntimeError("Airtable API request failed after retries")


def fetch_table(
    table_name: str,
    fields: tuple[str, ...],
    token: str,
    *,
    opener=None,
    sleep=time.sleep,
) -> list[dict]:
    table_path = urllib.parse.quote(table_name, safe="")
    base_url = f"{API_ROOT}/{BASE_ID}/{table_path}"
    parameters = [("pageSize", "100"), *(("fields[]", field) for field in fields)]
    records = []
    offset = None
    requested_page = False

    while True:
        if requested_page:
            sleep(MIN_REQUEST_INTERVAL_SECONDS)
        query = list(parameters)
        if offset:
            query.append(("offset", offset))
        request = urllib.request.Request(
            f"{base_url}?{urllib.parse.urlencode(query)}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
        )
        page = request_json(request, opener=opener, sleep=sleep)
        page_records = page.get("records")
        if not isinstance(page_records, list):
            raise RuntimeError(f"Airtable returned an invalid records page for {table_name}")
        records.extend(page_records)
        requested_page = True
        offset = page.get("offset")
        if not offset:
            return records


def normalized_rows(
    records: list[dict], linked_fields: dict[str, dict[str, str]] | None = None
) -> list[dict[str, str]]:
    linked_fields = linked_fields or {}
    rows = []
    for record in records:
        row = {}
        for field, value in (record.get("fields") or {}).items():
            if field not in linked_fields or not isinstance(value, list):
                row[field] = cell_text(value)
                continue
            names = []
            for linked in value:
                if isinstance(linked, dict):
                    name = linked.get("name") or linked_fields[field].get(linked.get("id"))
                else:
                    name = linked_fields[field].get(str(linked))
                if name:
                    names.append(str(name))
            row[field] = ", ".join(names)
        rows.append(row)
    return rows


def builder_date(value: object) -> str:
    text = cell_text(value)
    if not text:
        return ""
    try:
        return date.fromisoformat(text[:10]).strftime("%B %d, %Y")
    except ValueError:
        return text


def event_rows(records: list[dict], airline_names: dict[str, str]) -> list[dict[str, str]]:
    rows = []
    for record in records:
        fields = record.get("fields") or {}
        row = {field: cell_text(value) for field, value in fields.items() if field != "Airline"}
        for date_field in ("Start Date", "End Date"):
            if date_field in fields:
                row[date_field] = builder_date(fields[date_field])
        linked_airlines = fields.get("Airline") or []
        if isinstance(linked_airlines, list):
            names = []
            for linked in linked_airlines:
                if isinstance(linked, dict):
                    name = linked.get("name") or airline_names.get(linked.get("id"), "")
                else:
                    name = airline_names.get(str(linked), "")
                if name:
                    names.append(str(name))
            row["Airline"] = ", ".join(names)
        else:
            row["Airline"] = cell_text(linked_airlines)
        rows.append(row)
    return rows


def load_optional_json(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def refresh(token: str, *, opener=None, sleep=time.sleep) -> dict:
    airline_records = fetch_table(AIRLINE_TABLE, AIRLINE_FIELDS, token, opener=opener, sleep=sleep)
    sleep(MIN_REQUEST_INTERVAL_SECONDS)
    event_records = fetch_table(EVENTS_TABLE, EVENT_FIELDS, token, opener=opener, sleep=sleep)
    event_names = {
        str(record.get("id")): cell_text((record.get("fields") or {}).get("Event Name"))
        for record in event_records
        if record.get("id")
    }
    airline_rows = normalized_rows(airline_records, {"Conferences Attended": event_names})
    airline_names = {
        str(record.get("id")): cell_text((record.get("fields") or {}).get("Airline"))
        for record in airline_records
        if record.get("id")
    }
    world = json.loads((ROOT / "assets" / "ne_110m_admin_0_countries.geojson").read_text(encoding="utf-8"))
    return snapshot_builder.build(
        airline_rows,
        event_rows(event_records, airline_names),
        world,
        airline_type_overrides=load_optional_json(ROOT / "data" / "airline-type-overrides.json"),
        airline_hq_overrides=load_optional_json(ROOT / "data" / "airline-hq-overrides.json"),
        event_end_date_overrides=load_optional_json(ROOT / "data" / "conference-end-date-overrides.json"),
    )


def write_snapshot(snapshot: dict, output: Path = OUTPUT_PATH) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=output.parent, delete=False
    ) as temporary:
        json.dump(snapshot, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    token = os.environ.get("AIRTABLE_API_TOKEN")
    if not token:
        parser.error("AIRTABLE_API_TOKEN is required; use a read-only token scoped to this base")

    snapshot = refresh(token)
    write_snapshot(snapshot, args.output)
    print(
        f"Wrote {snapshot['unique_airline_count']} airline profiles and "
        f"{len(snapshot['conferences'])} conferences to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
