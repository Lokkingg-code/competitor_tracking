#!/usr/bin/env python3
"""Collapse high-confidence duplicate customer events for the public feed."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

CUSTOMER_DEAL_RELATIONSHIPS = {"signed", "selected", "adopted", "implemented"}
MIN_CUSTOMER_CONFIDENCE = 0.85
EVENT_WINDOW_DAYS = 14
ROOT = Path(__file__).resolve().parents[1]
AIRLINES_PATH = ROOT / "data" / "airlines.json"
DEAL_ACTION_TOKENS = {
    "adopt", "adopted", "adopts", "agreement", "contract", "deal", "equip", "equipped",
    "equips", "implement", "implemented", "implements", "kiest", "gekozen", "select",
    "selected", "selects", "signed", "signing", "signs", "choose", "chooses", "chose",
}
_AIRLINE_NAMES: list[tuple[str, str]] | None = None


def normalized_key(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "").casefold())
    ascii_text = "".join(character for character in normalized if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", " ", ascii_text).strip()


def registered_airline_names() -> list[tuple[str, str]]:
    global _AIRLINE_NAMES
    if _AIRLINE_NAMES is None:
        try:
            payload = json.loads(AIRLINES_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            _AIRLINE_NAMES = []
        else:
            aliases = set()
            for airline in payload.get("airlines", []):
                if not isinstance(airline, dict):
                    continue
                canonical = normalized_key(airline.get("name"))
                if not canonical or canonical in {"unknown", "private flight"}:
                    continue
                for value in (airline.get("name"), airline.get("alias")):
                    alias = normalized_key(value)
                    if len(alias) >= 3 and alias not in {"n", "unknown", "private flight"}:
                        aliases.add((alias, canonical))
            _AIRLINE_NAMES = sorted(aliases, key=lambda item: len(item[0]), reverse=True)
    return _AIRLINE_NAMES


def evidenced_airline(signal: dict, evidence: str) -> str | None:
    evidence_key = f" {normalized_key(evidence)} "
    for alias, canonical in registered_airline_names():
        if f" {alias} " in evidence_key:
            return canonical
    return None


def canonical_airline_key(value: object) -> str | None:
    airline_key = normalized_key(value)
    if not airline_key or airline_key == "unknown":
        return None
    padded_key = f" {airline_key} "
    for alias, canonical in registered_airline_names():
        if f" {alias} " in padded_key:
            return canonical
    return airline_key


def explicit_customer_deal_key(signal: dict, competitor: str, product: str) -> tuple[str, str, str, str] | None:
    evidence = " ".join((str(signal.get("headline") or ""), str(signal.get("summary") or "")))
    evidence_key = f" {normalized_key(evidence)} "
    if f" {product} " not in evidence_key:
        return None
    if not DEAL_ACTION_TOKENS.intersection(evidence_key.split()):
        return None
    airline = evidenced_airline(signal, evidence)
    if airline is None:
        return None
    return competitor, airline, product, "customer_deal"


def customer_event_key(signal: dict) -> tuple[str, str, str, str] | None:
    analysis = signal.get("ai_enrichment")
    competitor = normalized_key(signal.get("competitor"))
    product = normalized_key(signal.get("product"))
    if not competitor or not product:
        return None
    if isinstance(analysis, dict):
        airline = canonical_airline_key(analysis.get("customer_airline"))
        relationship = analysis.get("customer_relationship")
        confidence = analysis.get("customer_confidence")
        if (
            airline
            and relationship in CUSTOMER_DEAL_RELATIONSHIPS
            and not isinstance(confidence, bool)
            and isinstance(confidence, (int, float))
            and confidence >= MIN_CUSTOMER_CONFIDENCE
        ):
            return competitor, airline, product, "customer_deal"
    return explicit_customer_deal_key(signal, competitor, product)


def signal_date(signal: dict) -> date | None:
    try:
        return date.fromisoformat(str(signal.get("date", ""))[:10])
    except ValueError:
        return None


def evidence_score(signal: dict) -> tuple[int, int, str]:
    analysis = signal.get("ai_enrichment") or {}
    source_count = len(signal.get("sources") or [])
    summary_length = len(str(signal.get("summary") or ""))
    return source_count, summary_length + len(str(analysis.get("headline_summary") or "")), str(signal.get("date", ""))


def merge_sources(canonical: dict, duplicates: list[dict]) -> None:
    sources = []
    seen = set()
    for signal in [canonical, *duplicates]:
        for source in signal.get("sources") or []:
            url = str(source.get("url") or "").strip()
            key = url.split("?", 1)[0].rstrip("/").casefold()
            if not key or key in seen:
                continue
            seen.add(key)
            sources.append(source)
    canonical["sources"] = sources
    prior_ids = canonical.get("duplicate_signal_ids") or []
    duplicate_ids = list(dict.fromkeys([
        *(signal_id for signal_id in prior_ids if signal_id),
        *(signal.get("id") for signal in duplicates if signal.get("id")),
    ]))
    prior_count = canonical.get("duplicate_count", 0)
    if isinstance(prior_count, bool) or not isinstance(prior_count, int):
        prior_count = 0
    unidentified_duplicates = sum(not signal.get("id") for signal in duplicates)
    canonical["duplicate_count"] = max(len(duplicate_ids), prior_count + unidentified_duplicates)
    canonical["duplicate_signal_ids"] = duplicate_ids


def deduplicate_customer_events(signals: list[dict], window_days: int = EVENT_WINDOW_DAYS) -> list[dict]:
    """Keep one best-evidence feed record while retaining duplicate objects with markers."""
    records = []
    for original in signals:
        signal = dict(original)
        signal.pop("duplicate_of", None)
        signal.pop("duplicate_reason", None)
        records.append(signal)

    groups: dict[tuple[str, str, str, str], list[int]] = {}
    dates: dict[int, date] = {}
    for index, signal in enumerate(records):
        key = customer_event_key(signal)
        item_date = signal_date(signal)
        if key is None or item_date is None:
            continue
        groups.setdefault(key, []).append(index)
        dates[index] = item_date

    for indexes in groups.values():
        if len(indexes) < 2:
            continue
        remaining = set(indexes)
        while remaining:
            anchor = min(remaining, key=lambda index: dates[index])
            cluster = [index for index in remaining if abs((dates[index] - dates[anchor]).days) <= window_days]
            remaining.difference_update(cluster)
            if len(cluster) < 2:
                continue
            canonical_index = max(cluster, key=lambda index: evidence_score(records[index]))
            canonical = records[canonical_index]
            duplicate_indexes = [index for index in cluster if index != canonical_index]
            merge_sources(canonical, [records[index] for index in duplicate_indexes])
            for index in duplicate_indexes:
                records[index]["duplicate_of"] = canonical.get("id")
                records[index]["duplicate_reason"] = "Same high-confidence customer deal, competitor, product, and date window"

    return records


def prune_duplicate_customer_events(signals: list[dict], window_days: int = EVENT_WINDOW_DAYS) -> list[dict]:
    """Remove duplicate objects but retain their IDs and source links on canonical records."""
    records = deduplicate_customer_events(signals, window_days=window_days)
    return [record for record in records if not record.get("duplicate_of")]


def main() -> int:
    parser = argparse.ArgumentParser(description="Prune duplicate customer events from feed and archive JSON.")
    parser.add_argument("--apply", action="store_true", help="Write pruned records; otherwise print a dry-run report.")
    parser.add_argument("--archive", type=Path, default=ROOT / "data" / "signals.archive.json")
    parser.add_argument("--feed", type=Path, default=ROOT / "data" / "signals.json")
    args = parser.parse_args()

    updates = []
    for path in (args.archive, args.feed):
        payload = json.loads(path.read_text(encoding="utf-8"))
        records = deduplicate_customer_events(payload.get("signals", []))
        duplicates = [record for record in records if record.get("duplicate_of")]
        payload["signals"] = [record for record in records if not record.get("duplicate_of")]
        updates.append((path, payload, duplicates))
        print(f"{path}: {len(records)} records, {len(duplicates)} duplicates")
        for duplicate in duplicates:
            print(f"  {duplicate.get('id')} -> {duplicate.get('duplicate_of')}")

    if not args.apply:
        print("Dry run only; pass --apply to write these changes.")
        return 0

    temporary_paths = []
    try:
        for path, payload, _ in updates:
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            temporary_paths.append((temporary, path))
        for temporary, path in temporary_paths:
            temporary.replace(path)
    finally:
        for temporary, _ in temporary_paths:
            temporary.unlink(missing_ok=True)
    print("Pruned duplicate objects; canonical signals retain their source links and duplicate IDs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())