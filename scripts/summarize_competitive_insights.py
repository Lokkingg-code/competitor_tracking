#!/usr/bin/env python3
"""Generate a cited, rolling competitive insight brief from saved signals."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.enrich_signals import EnrichmentError, extract_json_result, gemini_request

SIGNALS_PATH = ROOT / "data" / "signals.json"
INSIGHTS_PATH = ROOT / "data" / "competitive-insights.json"
INSIGHT_VERSION = 1
INSIGHT_MODEL_ID = os.environ.get("GEMINI_INSIGHTS_MODEL", "").strip() or "gemini-3.5-flash-lite"
MAX_INSIGHTS = 5
CUSTOMER_RELATIONSHIPS = {"signed", "selected", "adopted", "implemented", "partnered", "mentioned"}


def parse_signal_date(signal: dict) -> date | None:
    try:
        return date.fromisoformat(str(signal.get("date", ""))[:10])
    except ValueError:
        return None


def normalized_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def build_analysis_context(signals: list[dict], as_of: date | None = None) -> dict:
    as_of = as_of or datetime.now(timezone.utc).date()
    start_month_index = as_of.year * 12 + as_of.month - 1 - 11
    start = date(start_month_index // 12, start_month_index % 12 + 1, 1)
    dated_signals = [
        (signal, signal_date)
        for signal in signals
        if (signal_date := parse_signal_date(signal)) and start <= signal_date <= as_of
    ]
    months = []
    month_cursor = date(start.year, start.month, 1)
    while month_cursor <= as_of:
        months.append(month_cursor.strftime("%Y-%m"))
        month_cursor = date(month_cursor.year + (month_cursor.month == 12), month_cursor.month % 12 + 1, 1)

    competitors = sorted({str(signal.get("competitor") or "Unknown") for signal, _ in dated_signals})
    activity = []
    for competitor in competitors:
        monthly = []
        for month in months:
            month_signals = [
                signal for signal, signal_date in dated_signals
                if signal.get("competitor") == competitor and signal_date.strftime("%Y-%m") == month
            ]
            linkedin = [signal for signal in month_signals if str(signal.get("source_channel") or "").casefold() == "linkedin"]
            origins = Counter(str(signal.get("source_origin") or "unknown").casefold() for signal in linkedin)
            monthly.append([
                month,
                len(month_signals),
                len(linkedin),
                origins.get("linkedin", 0),
                origins.get("google_news", 0),
                sum(signal.get("type") == "product_launch" for signal in month_signals),
                sum(signal.get("type") == "feature_change" for signal in month_signals),
            ])
        activity.append({"competitor": competitor, "monthly": monthly})

    grouped_events: dict[tuple[str, str], dict] = {}
    for signal, signal_date in sorted(dated_signals, key=lambda pair: pair[1], reverse=True):
        analysis = signal.get("ai_enrichment") or {}
        airline = analysis.get("customer_airline")
        relationship = analysis.get("customer_relationship")
        relevant = signal.get("type") in {"product_launch", "feature_change", "regulatory", "ma_pe"} or (
            airline and str(airline).casefold() != "unknown" and relationship in CUSTOMER_RELATIONSHIPS
        )
        if not relevant:
            continue
        brief = signal.get("ai_brief") or {}
        headline = str(brief.get("title") or signal.get("headline") or "").strip()
        if not headline:
            continue
        competitor = str(signal.get("competitor") or "Unknown")
        key = (competitor, normalized_title(headline))
        if key in grouped_events:
            grouped_events[key]["signal_ids"].append(str(signal.get("id") or ""))
            continue
        grouped_events[key] = {
            "signal_ids": [str(signal.get("id") or "")],
            "date": signal_date.isoformat(),
            "competitor": competitor,
            "type": str(signal.get("type") or "unknown"),
            "product": str(signal.get("product") or "")[:80],
            "source_channel": str(signal.get("source_channel") or "unknown"),
            "source_origin": str(signal.get("source_origin") or "unknown"),
            "headline": headline[:150],
            "summary": str(brief.get("summary") or analysis.get("headline_summary") or signal.get("summary") or "")[:170],
            "customer_airline": str(airline or ""),
            "customer_relationship": str(relationship or ""),
            "recorded_customer_segment": str(analysis.get("customer_segment") or ""),
        }

    all_events = list(grouped_events.values())
    selected_events = []
    selected_ids = set()
    for competitor in competitors:
        competitor_events = [event for event in all_events if event["competitor"] == competitor]
        product_events = [event for event in competitor_events if event["type"] in {"product_launch", "feature_change"}]
        customer_events = [
            event for event in competitor_events
            if event["customer_airline"] and event["customer_relationship"] in CUSTOMER_RELATIONSHIPS
        ]
        other_news = [event for event in competitor_events if event["type"] in {"regulatory", "ma_pe"}]
        chosen = sorted(product_events, key=lambda event: event["date"], reverse=True)[:3]
        chosen.extend(customer_events)
        chosen.extend(sorted(other_news, key=lambda event: event["date"], reverse=True)[:1])
        for event in chosen:
            event_ids = set(event["signal_ids"])
            if event_ids & selected_ids:
                continue
            selected_events.append(event)
            selected_ids.update(event_ids)

    return {
        "window_start": start.isoformat(),
        "window_end": as_of.isoformat(),
        "source_signal_count": len(dated_signals),
        "activity_by_competitor_month": activity,
        "product_event_counts_by_competitor": {
            competitor: {
                "launches": sum(signal.get("competitor") == competitor and signal.get("type") == "product_launch" for signal, _ in dated_signals),
                "feature_changes": sum(signal.get("competitor") == competitor and signal.get("type") == "feature_change" for signal, _ in dated_signals),
            }
            for competitor in competitors
        },
        "events": selected_events,
        "evidence_ids": sorted(selected_ids),
    }


def insights_prompt(context: dict) -> str:
    evidence = {key: value for key, value in context.items() if key != "evidence_ids"}
    return "\n\n".join([
        "You are an aviation competitive-intelligence analyst specializing in airline operations, EFB/EFF, flight planning, dispatch, crew systems, airline news, and low-cost carriers (LCCs).",
        "Analyze the rolling history as a whole. Identify patterns across customers, LCC adoption, posting/capture cadence, product launches/features, and strategic messaging. Prefer changes over time and cross-signal comparisons over isolated event summaries.",
        "Use aviation knowledge to classify named airlines as LCC, full-service, hybrid, regional, cargo, charter, or uncertain when useful. Keep airline segment separate from proof of a competitor relationship. A mention, testimonial, hiring post, or event attendance is not a customer win. Existing signal type labels can be wrong; teasers are not shipped features.",
        "Explicitly assess whether named airline adoption suggests LCC activity is concentrated with a competitor; classify only recognizable airlines with confidence and state when evidence is insufficient. Monthly counts show captured feed visibility, not total real-world posting frequency. LinkedIn includes both live-scraper and Google News-LinkedIn captures; use the origin counts to distinguish them. Repeated captures/headlines can describe one announcement. Event rows are representative examples, not exhaustive; use monthly totals for volume and cadence.",
        "Return at most five concise, useful insights. A single-competitor finding must be worded as vendor-specific; a cross-industry or comparative claim must cite at least two distinct competitors. Every insight must cite exact signal IDs from the supplied event examples. Do not invent facts, customer relationships, release status, or carrier classifications. Mention uncertainty explicitly. Return JSON only with schema: {\"lead\":\"1-2 sentence overall read\",\"insights\":[{\"category\":\"customer_adoption|product_news|posting_activity|strategy|market_pattern\",\"title\":\"short claim\",\"finding\":\"1-2 sentences\",\"evidence_ids\":[\"exact signal ID\"],\"aviation_context\":\"optional domain interpretation\",\"caveat\":\"uncertainty/limits\"}]}. If the data does not support a pattern, say so rather than forcing one.",
            "Do not infer safety, efficiency, cost, reliability, adoption, regulatory, or performance outcomes unless the cited source explicitly reports them. Aviation context may classify carriers and explain neutral operational terminology, but must not add causal benefits or technical details absent from the evidence.",
        "Rolling evidence JSON:\n" + json.dumps(evidence, ensure_ascii=False, separators=(",", ":")),
    ])


def validate_insight_result(result: dict, evidence_ids: set[str]) -> dict:
    lead = result.get("lead")
    insights = result.get("insights")
    if not isinstance(lead, str) or not lead.strip() or len(lead) > 700:
        raise EnrichmentError("Insight response omitted a valid overall lead")
    if not isinstance(insights, list) or len(insights) > MAX_INSIGHTS:
        raise EnrichmentError("Insight response must contain at most five insights")
    validated = []
    for insight in insights:
        if not isinstance(insight, dict):
            raise EnrichmentError("Insight response contains a malformed item")
        title = insight.get("title")
        finding = insight.get("finding")
        citations = insight.get("evidence_ids")
        if not isinstance(title, str) or not title.strip() or len(title) > 180:
            raise EnrichmentError("Insight item omitted a valid title")
        if not isinstance(finding, str) or not finding.strip() or len(finding) > 700:
            raise EnrichmentError("Insight item omitted a valid finding")
        if not isinstance(citations, list) or not citations:
            raise EnrichmentError("Insight item must cite at least one signal ID")
        citations = list(dict.fromkeys(str(signal_id) for signal_id in citations))
        if any(signal_id not in evidence_ids for signal_id in citations):
            raise EnrichmentError("Insight item cited a signal outside the supplied evidence")
        validated.append({
            "category": str(insight.get("category") or "market_pattern")[:40],
            "title": title.strip(),
            "finding": finding.strip(),
            "evidence_ids": citations,
            "aviation_context": str(insight.get("aviation_context") or "")[:400].strip(),
            "caveat": str(insight.get("caveat") or "")[:400].strip(),
        })
    return {"lead": lead.strip(), "insights": validated}


def generate_insights(signals: list[dict], api_key: str, as_of: date | None = None) -> dict:
    context = build_analysis_context(signals, as_of)
    response = gemini_request(api_key, INSIGHT_MODEL_ID, {
        "contents": [{"role": "user", "parts": [{"text": insights_prompt(context)}]}],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": int(os.environ.get("AI_INSIGHTS_MAX_OUTPUT_TOKENS", "5000")),
        },
    })
    candidates = response.get("candidates") or []
    candidate = candidates[0] if candidates else {}
    if candidate.get("finishReason") != "STOP":
        raise EnrichmentError(f"Insight generation did not complete (finish_reason={candidate.get('finishReason', 'missing')})")
    parts = (candidate.get("content") or {}).get("parts") or []
    text = "\n".join(
        part.get("text", "") for part in parts
        if isinstance(part, dict) and not part.get("thought")
    ).strip()
    result = extract_json_result(text, required={"lead", "insights"})
    validated = validate_insight_result(result, set(context["evidence_ids"]))
    return {
        "schema_version": INSIGHT_VERSION,
        "status": "ready",
        "model": INSIGHT_MODEL_ID,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window_start": context["window_start"],
        "window_end": context["window_end"],
        "source_signal_count": context["source_signal_count"],
        "lead": validated["lead"],
        "insights": validated["insights"],
        "caveat": "AI-generated synthesis of captured public signals; verify cited sources before making decisions.",
    }


def save_snapshot(path: Path, snapshot: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(snapshot, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary_path = Path(handle.name)
    temporary_path.replace(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--signals", type=Path, default=SIGNALS_PATH)
    parser.add_argument("--output", type=Path, default=INSIGHTS_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Print a valid snapshot without writing it")
    args = parser.parse_args(argv)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("AI insight refresh skipped: GEMINI_API_KEY is not configured.", file=sys.stderr)
        return 0
    try:
        payload = json.loads(args.signals.read_text(encoding="utf-8"))
        snapshot = generate_insights(payload.get("signals", []), api_key)
    except (OSError, json.JSONDecodeError, EnrichmentError, ValueError) as error:
        print(f"AI insight refresh skipped; existing snapshot preserved: {error}", file=sys.stderr)
        return 0
    if args.dry_run:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    else:
        save_snapshot(args.output, snapshot)
        print(f"Saved {len(snapshot['insights'])} cited insights from {snapshot['source_signal_count']} signals.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())