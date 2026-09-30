#!/usr/bin/env python3
"""Merge curated seed signals with captured raw items into data/signals.json.

Heuristic filter drops obvious noise (hiring, culture posts). High-value
keywords are promoted. Manual/AI review can refine battlecards later.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "signals.seed.json"
SIGNALS_PATH = ROOT / "data" / "signals.json"
ARCHIVE_PATH = ROOT / "data" / "signals.archive.json"
RAW_LATEST = ROOT / "data" / "raw" / "latest.json"

RECRUITMENT_PATTERNS = [
    r"\bopen roles?\b",
    r"\bopen positions?\b",
    r"\bjob (?:vacanc(?:y|ies)|ad(?:vert)?s?|opportunities)\b",
    r"\binterview experience\b",
    r"#(?:wearehiring|nowhiring|aviationjobs)\b",
    r"\bhiring\b",
    r"\bwe'?re hiring\b",
    r"\bjoin our team\b",
    r"\bjob opening\b",
]

NOISE_PATTERNS = RECRUITMENT_PATTERNS + [
    r"\bculture\b",
    r"\bemployee spotlight\b",
    r"\bcongratulations to\b",
    r"\bhappy holidays\b",
    r"\bbooth\s+number\b",
    r"\bvisit us at booth\b",
    r"\bstop by booth\b",
    r"certified aircraft dispatcher",
    r"pokémon jet",
    r"pokemon jet",
]

LINKEDIN_NOISE_PATTERNS = [
    r"#hiring\b",
    r"#lifeat",
    r"#team",
    r"\bwe'?re hiring\b",
    r"\bjoin our team\b",
    r"\bopen role\b",
    r"\bopen positions?\b",
    r"\bcareer fair\b",
    r"\bintern(ship)?\b",
    r"\bemployee spotlight\b",
    r"\bwork anniversary\b",
    r"\bpleased to announce.* appointment\b",
    r"\bcongratulations\b",
    r"\binspiring evening\b",
    r"\bwomen in aviation\b",
    r"\bcolleague.* guest\b",
    r"\bpodcast\b",
    r"\bwas recently a guest\b",
]

LINKEDIN_VALUE_PATTERNS = [
    r"\blaunch",
    r"\brelease\b",
    r"\bproduct\b",
    r"\bcustomer\b",
    r"\bairline\b",
    r"\bEFB\b",
    r"\bEFBOne\b",
    r"\bpartner",
    r"\bwebinar\b",
    r"\bdemo\b",
    r"\bimplement",
    r"\brollout\b",
    r"\bconnect\b",
    r"\bversion\b",
]

VALUE_PATTERNS = [
    r"\blaunch",
    r"\brelease\b",
    r"\bselect(s|ed)?\b",
    r"\badopt",
    r"\bpartner",
    r"\bimplement",
    r"\bwin\b",
    r"\bcontract\b",
    r"\bEFF\b",
    r"\bEFB\b",
    r"\bdispatch\b",
    r"\bflight folder",
    r"\bbriefing pack",
    r"\bMission\+",
    r"\bNetLine",
    r"\bacqui",
    r"\bmerger\b",
]

COMPETITOR_ALIASES = {
    "Jeppesen": ("jeppesen", "foreflight"),
    "Lufthansa Systems": ("lufthansa systems", "lido", "netline"),
    "Aviobook": ("aviobook", "aviovision"),
    "Bytron Skybook": ("bytron", "skybook"),
    "Navblue": ("navblue", "skywise", "mission+"),
    "IFS": ("ifs", "international flight support", "efbone"),
    "Others": (
        "boeing flight folder",
        "flightfolder",
        "eFlightManager",
        "flightman",
        "lido mbriefing",
        "mbriefing",
        "logipad",
        "topwing",
        "topwings",
        "efbone",
        "mission+ doc",
    ),
    "EFF market": (
        "boeing flight folder",
        "flightfolder",
        "eFlightManager",
        "flightman",
        "lido mbriefing",
        "mbriefing",
        "logipad",
        "topwing",
        "topwings",
        "efbone",
        "mission+ doc",
    ),
}

EFF_PATTERNS = [
    r"\bEFF\b",
    r"\bEFFCore\b",
    r"\bEFF Core\b",
    r"electronic flight folder",
    r"flight folder",
    r"flightfolder",
    r"Boeing FlightFolder",
    r"Boeing Flight Folder",
    r"(?:AvioBook|Aviobook)\b",
    r"Skybook",
    r"eFlightManager",
    r"Flightman",
    r"mBriefing",
    r"Lido mBriefing",
    r"Logipad",
    r"Topwing",
    r"EFBOne",
    r"(?:Jeppesen\s+)?Aviator\b",
    r"briefing pack",
    r"crew briefing",
    r"dispatch briefing",
    r"flight briefing",
    r"operational flight plan.{0,40}(document|folder|briefing|release)",
    r"\bOFP\b",
    r"flight release",
    r"flight documentation",
    r"flight papers",
    r"\bNOTOC\b",
    r"loadsheet",
    r"load sheet",
    r"day-of-flight",
    r"ground portal",
    r"document manager",
    r"DOC Manager",
    r"flight ops documentation",
    r"\bskybook\b",
    r"Electronic Flight Assistant",
    r"Escape Routes",
    r"Mission\+ DOC",
    r"flight operations document",
    r"crew briefing pack",
]

EFB_PATTERNS = [
    r"\bEFB\b",
    r"electronic flight bag",
    r"FliteDeck(?:\s+Pro)?",
    r"flitedeck",
    r"Manage My EFB",
    r"charting",
    r"cockpit tablet",
    r"Mission\+ FLIGHT",
    r"(?:AvioBook|Aviobook)\s+EFB",
    r"pilot workflow",
]

ADJACENT_PATTERNS = [
    r"\bdispatch\b",
    r"flight planning",
    r"flight planning system",
    r"flight planning solution",
    r"flight planning tool",
    r"\bNetLine",
    r"crew pairing",
    r"network planning",
    r"maintenance",
    r"Fleet Performance",
    r"\bConnect\b",
    r"ops comm",
    r"retailing",
    r"\bAI engine\b",
    r"avionics",
    r"MRO\b",
]

PRODUCT_PATTERNS = [
    ("AvioBook Connect", r"(?:AvioBook|Aviobook)\s+Connect"),
    ("AvioBook", r"(?:AvioBook|Aviobook)\b"),
    ("Boeing FlightFolder", r"Boeing\s+Flight\s*Folder|FlightFolder"),
    ("Bytron Skybook", r"(?:Bytron\s+)?Skybook"),
    ("CAE eFlightManager", r"(?:CAE\s+)?eFlightManager"),
    ("Flightman", r"\bFlightman\b"),
    ("ForeFlight EFFCore", r"(?:ForeFlight\s+)?EFF\s*Core|EFFCore"),
    ("ForeFlight FliteDeck Pro", r"(?:Jeppesen\s+)?ForeFlight.*FliteDeck\s+Pro|FliteDeck\s+Pro"),
    ("ForeFlight", r"\bForeFlight\b"),
    ("Lido mBriefing", r"(?:Lido\s+)?mBriefing"),
    ("Jeppesen Aviator", r"(?:Jeppesen\s+)?Aviator\b"),
    ("Logipad", r"\bLogipad\b"),
    ("Mission+ DOC", r"Mission\+\s+DOC"),
    ("Mission+ FLIGHT", r"Mission\+\s+FLIGHT"),
    ("Mission+", r"Mission\+"),
    ("TopWings", r"\bTopWings?\b"),
    ("IFS EFBOne", r"(?:IFS\s+)?EFBOne"),
]


def is_noise(text: str) -> bool:
    text = unicodedata.normalize("NFKC", text)
    return any(re.search(p, text, re.I) for p in NOISE_PATTERNS)


def is_recruitment(text: str) -> bool:
    text = unicodedata.normalize("NFKC", text)
    return any(re.search(pattern, text, re.I) for pattern in RECRUITMENT_PATTERNS)


def omit_archived_signal(signal: dict) -> bool:
    return "auto-capture" in signal.get("tags", []) and is_recruitment(
        f"{signal.get('headline', '')} {signal.get('summary', '')}"
    )


def is_linkedin_noise(text: str) -> bool:
    return any(re.search(p, text, re.I) for p in LINKEDIN_NOISE_PATTERNS)


def linkedin_looks_valuable(text: str) -> bool:
    return any(re.search(p, text, re.I) for p in LINKEDIN_VALUE_PATTERNS)


def detect_source_channel(item: dict) -> str:
    if item.get("source_channel"):
        return item["source_channel"]
    url = (item.get("url") or "").lower()
    via = item.get("captured_via", "")
    if via == "linkedin" or "linkedin.com" in url:
        return "linkedin"
    if via == "press_release" or any(k in url for k in ("/news/", "/press-release", "/release-notes")):
        return "press_release"
    if via in {"rss", "atom"}:
        return "rss"
    return "news"


def detect_source_origin(item: dict) -> str:
    urls = [source.get("url", "") for source in item.get("sources", [])]
    if item.get("url"):
        urls.append(item["url"])
    combined = " ".join(urls).lower()
    if "linkedin.com" in combined or "lnkd.in" in combined:
        return "linkedin"
    if "news.google.com" in combined:
        return "google_news"
    if any(marker in combined for marker in ("/press-release", "/press_releases", "/release-notes")):
        return "press_release"
    if urls:
        return "official_site" if any(url.startswith("https://") for url in urls) else "news"
    return "news"


def looks_valuable(text: str) -> bool:
    return any(re.search(p, text, re.I) for p in VALUE_PATTERNS)


def _matches_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(p, text, re.I) for p in patterns)


def detect_product(text: str) -> str | None:
    for product, pattern in PRODUCT_PATTERNS:
        if re.search(pattern, text, re.I):
            return product
    return None


def classify_product_focus(text: str, competitor: str = "") -> str:
    """Classify product focus using explicit product precedence."""
    text = unicodedata.normalize("NFKC", text)
    if re.search(r"\b(?:AvioBook|Aviobook)\s+Connect\b", text, re.I):
        return "adjacent"

    efb_product_patterns = [
        r"Mission\+ FLIGHT",
        r"FliteDeck(?:\s+Pro)?",
        r"Manage My EFB",
        r"(?:AvioBook|Aviobook)\s+EFB",
    ]
    eff_product_patterns = [
        r"\bEFF\b",
        r"\bEFFCore\b",
        r"electronic flight folder",
        r"flight folder",
        r"flightfolder",
        r"briefing pack",
        r"DOC Manager",
        r"\bskybook\b",
        r"Escape Routes",
        r"Mission\+ DOC",
    ]
    efb_domain_patterns = [
        r"\bEFB\b",
        r"electronic flight bag",
    ]

    if _matches_any(text, efb_product_patterns):
        return "efb"
    if _matches_any(text, eff_product_patterns):
        return "eff"
    if _matches_any(text, efb_domain_patterns):
        return "efb"
    if _matches_any(text, EFF_PATTERNS):
        return "eff"
    if _matches_any(text, ADJACENT_PATTERNS):
        return "adjacent"
    if re.search(r"\bForeFlight\b|\bMission\+", text, re.I):
        if re.search(r"\b(?:executive appointments?|standalone company|private equity|acquisition|layoffs|insurance|leadership|department of defense)\b", text, re.I):
            return "other"
        return "eff"
    return "other"


VALID_PRODUCT_FOCUSES = {"eff", "efb", "adjacent", "other"}


def adjust_priority_for_focus(priority: str, focus: str, signal_type: str) -> str:
    if focus == "eff":
        if priority == "low":
            return "medium"
        if priority == "medium" and signal_type in {"customer_win", "ma_pe", "implementation", "product_launch"}:
            return "high"
        return priority
    if signal_type == "customer_win" and priority in {"critical", "high"}:
        return priority
    # EFB and broader ops tech remain visible but deprioritised vs EFF
    if focus in {"efb", "adjacent", "other"}:
        return "low"
    return priority


def strip_html(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = (
        cleaned.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return re.sub(r"\s+", " ", cleaned).strip()


def clean_headline(title: str) -> str:
    text = strip_html(title)
    # Google News titles often end with " - Publisher"
    if " - " in text:
        parts = text.rsplit(" - ", 1)
        if len(parts[1]) < 40:
            return parts[0].strip()
    return text


def ranked_sentences(text: str) -> list[str]:
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", strip_html(text)) if sentence.strip()]
    signal_terms = (
        "customer", "airline", "carrier", "efb", "aviobook", "rollout", "implementation",
        "deploy", "deployment", "launch", "selected", "adopt", "partner", "reliab", "improv",
        "operat", "fleet", "agreement", "contract", "using", "introduced",
    )

    def score(sentence: str) -> tuple[int, int]:
        lowered = sentence.lower()
        keyword_score = sum(lowered.count(term) for term in signal_terms)
        entity_score = len(re.findall(r"\b[A-Z][A-Za-z0-9&+.-]{2,}\b", sentence))
        return keyword_score * 3 + entity_score, -len(sentence)

    return sorted(enumerate(sentences), key=lambda item: (score(item[1]), -item[0]), reverse=True)


def extractive_preview(text: str, max_chars: int = 420) -> str:
    cleaned = strip_html(text)
    ranked = ranked_sentences(cleaned)
    selected = sorted((index, sentence) for index, sentence in ranked[:2])
    preview = " ".join(sentence for _, sentence in selected)
    if not preview:
        return cleaned[:max_chars].rstrip()
    if len(preview) <= max_chars:
        return preview
    return preview[: max_chars - 1].rsplit(" ", 1)[0].rstrip(" .,;:") + "…"


def derive_auto_headline(title: str, summary: str) -> str:
    headline = clean_headline(title)
    if not headline:
        headline = extractive_preview(summary, 140)
    if len(headline) <= 140:
        return headline
    ranked = ranked_sentences(headline)
    if ranked:
        best_sentence = ranked[0][1]
        if 24 <= len(best_sentence) <= 140:
            return best_sentence
    words = headline.split()
    return " ".join(words[:14]).rstrip(" .,;:") + "…"


def summary_is_useful(headline: str, summary: str) -> bool:
    if not summary or len(summary) < 60:
        return False
    if summary.lower() == headline.lower():
        return False
    if summary.lower().startswith(headline.lower()):
        remainder = summary[len(headline) :].strip(" .-")
        if len(remainder) < 35:
            return False
    return True


def build_summary(item: dict, headline: str, signal_type: str, competitor: str) -> str:
    raw = strip_html(item.get("summary") or "")
    if summary_is_useful(headline, raw):
        return extractive_preview(raw)

    type_label = signal_type.replace("_", " ")
    return (
        f"{competitor} reported a {type_label} update: {headline}. "
        "Open the linked source to verify details and assess impact for Cathay Technologies."
    )


def canonical_url(url: str) -> str:
    """Remove tracking/query variants so one article becomes one signal."""
    parsed = url.split("?", 1)[0].split("#", 1)[0].rstrip("/").lower()
    return parsed.replace("www.", "")


def mentions_competitor(text: str, competitor: str) -> bool:
    aliases = COMPETITOR_ALIASES.get(competitor, (competitor.lower(),))
    lowered = text.lower()
    return any(alias in lowered for alias in aliases)


def duplicate_headline_key(headline: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", headline.lower()).strip()
    release = re.search(r"(skybook\s+\d+(?:\.\d+)+\s+release notes)", normalized)
    return release.group(1) if release else normalized


def duplicate_content_key(text: str) -> str:
    normalized = re.sub(r"https?://\S+", " ", text.lower())
    normalized = re.sub(r"(?:\.{3}|\u2026)\s*more\b", " ", normalized)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized).strip()
    return normalized[:140]


def is_release_notes(headline: str) -> bool:
    return bool(re.search(r"\brelease\s+notes\b", headline, re.I))


def infer_type(text: str, headline: str | None = None) -> str:
    if is_release_notes(headline if headline is not None else text):
        return "feature_change"
    t = text.lower()
    if any(k in t for k in ("acqui", "merger", "merges", "private equity")):
        return "ma_pe"
    if re.search(r"\bwelcom(?:e|ing)\b\s+[^.]{3,150}?\s+to (?:the |our )?(?:[\w-]+ ){0,3}(?:platform|suite)\b", t):
        return "customer_win"
    if re.search(r"\bsign(?:s|ed)\b(?![-\s]+off\b)", t) or any(k in t for k in ("select", "adopt", "chooses", "awarded", "renew", "renews", "confidence in", "signing for", "customer testimonial", "customer testimony", "customer story", "customer interview", "customer experience", "customer success")):
        return "customer_win"
    if any(k in t for k in ("partner", "integrat", "collaborat", "joint solution", "strategic alliance", "united to improve", "working with")):
        return "partnership"
    if any(k in t for k in ("launch", "release", "unveils", "introduces", "version")):
        return "product_launch"
    if any(k in t for k in ("implement", "deploy", "rollout", "goes live")):
        return "implementation"
    if any(k in t for k in ("feature", "enhancement", "update", "improves")):
        return "feature_change"
    return "messaging_shift"


def priority_for(text: str, signal_type: str) -> str:
    if signal_type in {"ma_pe", "customer_win"} and looks_valuable(text):
        return "high"
    if signal_type == "product_launch":
        return "medium"
    return "low"


def load_seed() -> dict:
    path = SEED_PATH if SEED_PATH.exists() else SIGNALS_PATH
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_archive(seed: dict) -> dict:
    path = ARCHIVE_PATH if ARCHIVE_PATH.exists() else SIGNALS_PATH
    if not path.exists():
        return {"signals": seed.get("signals", [])}
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def raw_to_signal(item: dict) -> dict | None:
    if item.get("error"):
        return None

    if item.get("competitor") == "EFF market":
        item = {**item, "competitor": "Others"}

    source_channel = detect_source_channel(item)
    blob = f"{item.get('title', '')} {item.get('summary', '')}"

    if not item.get("published_at"):
        return None
    if not mentions_competitor(blob, item["competitor"]):
        return None

    if is_noise(blob):
        return None
    if source_channel == "linkedin":
        if is_linkedin_noise(blob):
            return None
        if not linkedin_looks_valuable(blob):
            return None
    elif not looks_valuable(blob) and not item.get("published_at"):
        return None

    signal_type = infer_type(blob, headline=item.get("title", ""))
    product_focus = classify_product_focus(blob, item["competitor"])
    product = detect_product(blob)
    priority = adjust_priority_for_focus(priority_for(blob, signal_type), product_focus, signal_type)
    if source_channel == "press_release" and product_focus == "eff" and priority == "medium":
        priority = "high"
    if source_channel != "press_release" and not looks_valuable(blob) and priority == "low":
        return None

    headline = derive_auto_headline(item.get("title", "").strip(), item.get("summary", ""))
    summary = build_summary(item, headline, signal_type, item["competitor"])
    confidence = 0.75 if source_channel == "press_release" else 0.6 if source_channel == "linkedin" else 0.55
    if item.get("published_at"):
        confidence += 0.05

    return {
        "id": item["id"],
        "competitor": item["competitor"],
        "date": item["published_at"],
        "date_is_estimated": bool(item.get("date_is_estimated")),
        "type": signal_type,
        "priority": priority,
        "severity": 4 if priority == "high" else 3 if priority == "medium" else 2,
        "confidence": min(confidence, 0.9),
        "headline": headline,
        "summary": summary,
        "source_channel": source_channel,
        "source_origin": detect_source_origin(item),
        "product_focus": product_focus,
        "product": product,
        "why_it_matters": (
            "Direct press release — higher confidence source for competitor product and customer moves."
            if source_channel == "press_release"
            else "LinkedIn company post — useful for product launches and customer stories; verify before executive distribution."
            if source_channel == "linkedin"
            else "Auto-captured signal — verify source and enrich into a battlecard before executive distribution."
        ),
        "segment": "Unknown",
        "implications": [
            "Needs analyst confirmation before executive distribution.",
        ],
        "next_actions": [
            "Open source link, validate claim, upgrade confidence.",
            "If confirmed, add implications for Cathay Technologies.",
        ],
        "sources": [
            {
                "title": item.get("source_name") or "Captured source",
                "url": item.get("url"),
            }
        ],
        "tags": ["auto-capture", item.get("captured_via", "unknown"), source_channel],
    }


def sanitize_signal(signal: dict) -> dict:
    cleaned = dict(signal)
    if cleaned.get("competitor") == "EFF market":
        cleaned["competitor"] = "Others"
    cleaned["headline"] = clean_headline(cleaned.get("headline", ""))
    if "auto-capture" in cleaned.get("tags", []):
        cleaned["headline"] = derive_auto_headline(cleaned["headline"], cleaned.get("summary", ""))
    summary = strip_html(cleaned.get("summary", ""))
    is_auto = "auto-capture" in cleaned.get("tags", [])
    if is_auto and is_release_notes(cleaned["headline"]):
        cleaned["type"] = "feature_change"

    if is_auto or not summary_is_useful(cleaned["headline"], summary):
        cleaned["summary"] = build_summary(
            {"summary": summary},
            cleaned["headline"],
            cleaned.get("type", "messaging_shift"),
            cleaned.get("competitor", "Unknown"),
        )
    else:
        cleaned["summary"] = extractive_preview(summary)
    if not cleaned.get("source_channel"):
        cleaned["source_channel"] = "curated" if not is_auto else "news"
    cleaned["source_origin"] = detect_source_origin(cleaned)
    blob = f"{cleaned.get('headline', '')} {cleaned.get('summary', '')} {cleaned.get('why_it_matters', '')}"
    cleaned["product"] = cleaned.get("product") or detect_product(blob)
    product_focus = cleaned.get("product_focus")
    if product_focus not in VALID_PRODUCT_FOCUSES or is_auto:
        product_focus = classify_product_focus(blob, cleaned.get("competitor", ""))
    cleaned["product_focus"] = product_focus
    cleaned["priority"] = adjust_priority_for_focus(
        cleaned.get("priority", "low"),
        cleaned["product_focus"],
        cleaned.get("type", "messaging_shift"),
    )
    cleaned["severity"] = (
        5 if cleaned["priority"] == "critical"
        else 4 if cleaned["priority"] == "high"
        else 3 if cleaned["priority"] == "medium"
        else 2
    )
    cleaned["why_it_matters"] = strip_html(cleaned.get("why_it_matters", ""))
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, action="append", default=None)
    args = parser.parse_args()
    raw_paths = args.raw or [RAW_LATEST]

    seed = load_seed()
    # Persist canonical seed once
    if not SEED_PATH.exists():
        SEED_PATH.write_text(json.dumps(seed, indent=2) + "\n", encoding="utf-8")

    seed_signals = {s["id"]: s for s in seed.get("signals", [])}
    archive = load_archive(seed)
    merged = dict(seed_signals)
    merged.update({s["id"]: s for s in archive.get("signals", [])})
    omitted_ids = [signal_id for signal_id, signal in merged.items() if omit_archived_signal(signal)]
    for signal_id in omitted_ids:
        del merged[signal_id]
    print(f"Omitted {len(omitted_ids)} archived recruitment signals")

    for raw_path in raw_paths:
        if not raw_path.exists():
            print(f"No raw capture at {raw_path} — skipping")
            continue
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        added = 0
        seen_urls = {
            canonical_url(source.get("url", ""))
            for signal in merged.values()
            for source in signal.get("sources", [])
            if canonical_url(source.get("url", ""))
        }
        seen_headlines = {duplicate_headline_key(s.get("headline", "")) for s in merged.values()}
        seen_content = {
            duplicate_content_key(s.get("summary") or s.get("headline", ""))
            for s in merged.values()
            if s.get("summary") or s.get("headline")
        }
        for item in raw.get("items", []):
            signal = raw_to_signal(item)
            if not signal:
                continue
            if signal["id"] in merged:
                continue
            source_url = canonical_url(item.get("url", ""))
            if source_url and source_url in seen_urls:
                continue
            # skip near-duplicate headlines already in seed
            headline = duplicate_headline_key(signal["headline"])
            content = duplicate_content_key(signal.get("summary") or signal["headline"])
            if headline in seen_headlines or (content and content in seen_content):
                continue
            merged[signal["id"]] = signal
            if source_url:
                seen_urls.add(source_url)
            seen_headlines.add(headline)
            if content:
                seen_content.add(content)
            added += 1
        print(f"Merged +{added} auto signals from {raw_path}")

    signals = sorted(
        (sanitize_signal(s) for s in merged.values()),
        key=lambda s: s["date"],
        reverse=True,
    )
    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lookback_days": seed.get("lookback_days", 365),
        "source_mode": "seed_plus_capture",
        "competitors": seed.get("competitors"),
        "signals": signals,
    }
    ARCHIVE_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    SIGNALS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(signals)} signals → data/signals.json")


if __name__ == "__main__":
    main()
