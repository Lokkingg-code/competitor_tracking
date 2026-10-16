import { summarizeActivity } from "./activity-summary.js";

const COMPETITORS = [
  "Jeppesen",
  "Lufthansa Systems",
  "Aviobook",
  "Bytron Skybook",
  "Navblue",
  "IFS",
  "Others",
];

const TYPE_LABELS = {
  product_launch: "Product launch",
  feature_change: "Feature change",
  customer_win: "Customer win",
  partnership: "Partnership",
  implementation: "Implementation",
  messaging_shift: "Messaging shift",
  ma_pe: "M&A / PE",
  regulatory: "Regulatory",
};

const SOURCE_LABELS = {
  linkedin: "LinkedIn",
  google_news: "Google News",
  press_release: "Press release",
  official_site: "Official site",
  rss: "RSS feed",
  news: "News",
  curated: "Official site",
};

const FOCUS_LABELS = {
  eff: "EFF",
  efb: "EFB",
  adjacent: "Adjacent",
  other: "Other",
};

const PRODUCT_PATTERNS = [
  ["AvioBook Connect", /(?:AvioBook|Aviobook)\s+Connect/i],
  ["AvioBook", /(?:AvioBook|Aviobook)\b/i],
  ["Boeing FlightFolder", /Boeing\s+Flight\s*Folder|FlightFolder/i],
  ["Bytron Skybook", /(?:Bytron\s+)?Skybook/i],
  ["CAE eFlightManager", /(?:CAE\s+)?eFlightManager/i],
  ["Flightman", /\bFlightman\b/i],
  ["ForeFlight EFFCore", /(?:ForeFlight\s+)?EFF\s*Core|EFFCore/i],
  ["ForeFlight FliteDeck Pro", /(?:Jeppesen\s+)?ForeFlight.*FliteDeck\s+Pro|FliteDeck\s+Pro/i],
  ["ForeFlight", /\bForeFlight\b/i],
  ["Lido mBriefing", /(?:Lido\s+)?mBriefing/i],
  ["Jeppesen Aviator", /(?:Jeppesen\s+)?Aviator\b/i],
  ["Logipad", /(?:\bLogipad\b|\bTalora\b)/i],
  ["Mission+ DOC", /Mission\+\s+DOC/i],
  ["Mission+ FLIGHT", /Mission\+\s+FLIGHT/i],
  ["Mission+", /Mission\+/i],
  ["TopWings", /\bTopWings?\b/i],
  ["IFS EFBOne", /(?:IFS\s+)?EFBOne/i],
];

const FOCUS_ORDER = { eff: 0, efb: 1, adjacent: 2, other: 3 };
const COMPETITOR_COLORS = {
  Jeppesen: "#168579",
  "Lufthansa Systems": "#c78927",
  Aviobook: "#4288b5",
  "Bytron Skybook": "#bd594a",
  Navblue: "#7f6fa8",
  IFS: "#57935d",
  Others: "#647b82",
};

const EFF_PATTERNS = [
  /\bEFF\b/i,
  /\bEFFCore\b/i,
  /\bEFF Core\b/i,
  /electronic flight folder/i,
  /flight folder/i,
  /flightfolder/i,
  /Boeing FlightFolder/i,
  /Boeing Flight Folder/i,
  /(?:AvioBook|Aviobook)\b/i,
  /Skybook/i,
  /eFlightManager/i,
  /Flightman/i,
  /mBriefing/i,
  /Lido mBriefing/i,
  /Logipad/i,
  /\bTalora\b/i,
  /Topwing/i,
  /EFBOne/i,
  /(?:Jeppesen\s+)?Aviator\b/i,
  /briefing pack/i,
  /crew briefing/i,
  /dispatch briefing/i,
  /flight briefing/i,
  /operational flight plan.{0,40}(document|folder|briefing|release)/i,
  /\bOFP\b/i,
  /flight release/i,
  /flight documentation/i,
  /NOTOC/i,
  /loadsheet/i,
  /load sheet/i,
  /day-of-flight/i,
  /ground portal/i,
  /document manager/i,
  /\bskybook\b/i,
  /Electronic Flight Assistant/i,
  /Escape Routes/i,
  /Mission\+ DOC/i,
  /flight operations document/i,
  /crew briefing pack/i,
];

const EFB_PATTERNS = [
  /\bEFB\b/i,
  /electronic flight bag/i,
  /FliteDeck(?:\s+Pro)?/i,
  /Manage My EFB/i,
  /Mission\+ FLIGHT/i,
  /(?:AvioBook|Aviobook)\s+EFB/i,
];

const ADJACENT_PATTERNS = [
  /\bdispatch\b/i,
  /flight planning/i,
  /NetLine/i,
  /crew pairing/i,
  /network planning/i,
  /maintenance/i,
  /Fleet Performance/i,
  /\bConnect\b/i,
  /avionics/i,
  /\bMRO\b/i,
];

let allSignals = [];
let selectedId = null;
let selectedMatrixIds = null;
let activityChartSource = "all";

const els = {
  competitorFilter: document.getElementById("competitorFilter"),
  typeFilter: document.getElementById("typeFilter"),
  searchInput: document.getElementById("searchInput"),
  clearSearch: document.getElementById("clearSearch"),
  feedCount: document.getElementById("feedCount"),
  signalFeed: document.getElementById("signalFeed"),
  briefing: document.getElementById("briefing"),
  activityChart: document.getElementById("activityChart"),
  chartSourceFilter: document.getElementById("chartSourceFilter"),
  dataMeta: document.getElementById("dataMeta"),
  lastUpdate: document.getElementById("lastUpdate"),
  themeToggle: document.getElementById("themeToggle"),
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === "light";
  if (els.themeToggle) {
    els.themeToggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
    els.themeToggle.querySelector(".theme-icon").textContent = light ? "◐" : "☼";
    els.themeToggle.querySelector(".theme-label").textContent = light ? "Dark mode" : "Light mode";
  }
  localStorage.setItem("ct-theme", theme);
}

function parseDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value) {
  const d = parseDate(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function populateFilters(signals) {
  for (const name of COMPETITORS) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    els.competitorFilter.appendChild(opt);
  }

  const types = [...new Set(signals.map((s) => s.type))].sort();
  for (const type of types) {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = TYPE_LABELS[type] || type;
    els.typeFilter.appendChild(opt);
  }
}

function displayCompetitor(name) {
  return name;
}

function matchesCompetitor(signal, selected) {
  return selected === "all" || displayCompetitor(signal.competitor) === selected;
}

function competitorClass(name) {
  const normalized = name.toLowerCase().replace(/\s+/g, "-");
  return `competitor-${normalized.replace(/[^a-z-]/g, "")}`;
}

function classifyProductFocus(signal) {
  if (["eff", "efb", "adjacent", "other"].includes(signal.product_focus)) return signal.product_focus;
  return "other";
}

function detectProduct(signal) {
  if (signal.product) return signal.product;
  const blob = `${signal.headline || ""} ${signal.summary || ""} ${signal.why_it_matters || ""}`;
  return PRODUCT_PATTERNS.find(([, pattern]) => pattern.test(blob))?.[0] || "Unspecified product";
}

function filteredSignals() {
  const cutoff = daysAgo(365);
  const competitor = els.competitorFilter.value;
  const type = els.typeFilter.value;
  const search = (els.searchInput?.value || "").trim().toLowerCase();

  return allSignals
    .filter((s) => selectedMatrixIds?.has(s.id) || parseDate(s.date) >= cutoff)
    .filter((s) => matchesCompetitor(s, competitor))
    .filter((s) => (type === "all" ? true : s.type === type))
    .filter((s) => {
      if (!search) return true;
      const sourceText = (s.sources || []).map((source) => `${source.title || ""} ${source.url || ""}`).join(" ");
      const searchable = [
        s.competitor,
        s.headline,
        s.summary,
        s.why_it_matters,
        s.product,
        s.type,
        classifyProductFocus(s),
        detectProduct(s),
        sourceText,
      ].join(" ").toLowerCase();
      return searchable.includes(search);
    })
    .sort((a, b) => {
      const focusDiff = FOCUS_ORDER[classifyProductFocus(a)] - FOCUS_ORDER[classifyProductFocus(b)];
      if (focusDiff !== 0) return focusDiff;
      return parseDate(b.date) - parseDate(a.date);
    });
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeadline(value) {
  const text = cleanText(value);
  if (!text.includes(" - ")) return text;
  const parts = text.split(" - ");
  const tail = parts[parts.length - 1];
  if (tail.length < 40) return parts.slice(0, -1).join(" - ").trim();
  return text;
}

function truncateTitleAtBoundary(text, maxLength = 150) {
  if (text.length <= maxLength) return text;
  const candidate = text.slice(0, maxLength + 1);
  const boundary = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("; "),
    candidate.lastIndexOf(": "),
    candidate.lastIndexOf(", "),
    candidate.lastIndexOf(" ")
  );
  return `${candidate.slice(0, Math.max(boundary, 1)).replace(/[\s,;:.]+$/, "")}...`;
}

function signalTypeMarkup(signal) {
  const label = escapeHtml(TYPE_LABELS[signal.type] || signal.type || "Unknown");
  const classification = signal.ai_classification;
  const aiRelated = classification?.is_ai_related === true
    && Number(classification.ai_confidence) >= 0.8;
  return aiRelated ? `${label} | <strong title="Announcement explicitly concerns AI technology">AI</strong>` : label;
}

function displaySignalTitle(signal) {
  const aiHeadline = cleanText(signal.ai_brief?.title || signal.ai_enrichment?.headline_summary);
  if (aiHeadline) return aiHeadline;

  const headline = cleanHeadline(signal.headline);
  const withoutTrailingMarker = headline.replace(/(?:\s*(?:…|\.\.\.)\s*)+$/, "").trim();
  const hasTruncationMarker = withoutTrailingMarker !== headline;
  const colonFragment = headline.match(/:\s*(.*?)$/)?.[1] || "";
  const danglingAfterColon =
    Boolean(colonFragment) &&
    (/[\p{Extended_Pictographic}]/u.test(colonFragment) || colonFragment.replace(/[^\p{L}\p{N}]/gu, "").length <= 3);

  if (headline && !danglingAfterColon) {
    return hasTruncationMarker ? `${withoutTrailingMarker}...` : headline;
  }

  if (headline && danglingAfterColon) {
    return `${headline.replace(/:\s*.*$/, ":").trim()} ...`;
  }

  const summary = cleanText(signal.summary)
    .replace(/\s+(?:linkedin\.com|…more)\b.*$/i, "")
    .trim();
  const firstSentence = summary.match(/^.+?[.!?](?=\s|$)/)?.[0] || summary;
  return truncateTitleAtBoundary(firstSentence) || "Untitled signal";
}

// Public airline and operator names used to resolve customer references in source text.
const AIRLINE_DICTIONARY = [
  "Virgin Australia",
  "AirAsia",
  "easyJet",
  "Pan American World Airways",
  "Hong Kong Air Cargo",
  "TUS Airways",
  "TUS Air",
  "Korean Air",
  "Pan Am",
  "Braathens",
  "Avia Solutions Group",
  "UrbanLink Air Mobility",
  "GE Aerospace",
  "GOL Linhas Aéreas",
  "BBN Airlines Indonesia",
  "Vietnam Airlines",
  "Philippine Airlines",
  "Wizz Air",
  "Hong Kong Air",
  "Qantas",
  "Cathay Pacific",
  "Singapore Airlines",
  "Lufthansa",
  "Emirates",
  "Qatar Airways",
  "British Airways",
  "Air France",
  "KLM",
  "American Airlines",
  "United Airlines",
  "Delta Air Lines",
];

let airlineDictionaryPattern = buildAirlineDictionaryPattern(AIRLINE_DICTIONARY);

function buildAirlineDictionaryPattern(names) {
  const terms = [...new Set(names.filter(Boolean))]
    .map((name) => name.trim())
    .filter((name) => name.length >= 3 && name.toLowerCase() !== "via" && !/^\\n$/i.test(name))
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&"));
  return new RegExp(`\\b(?:${terms.join("|")})\\b`, "i");
}

const OPERATOR_PATTERNS = [
  airlineDictionaryPattern,
  /\b(?:customer|represented by|selected by)\s*,?\s*([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,3})(?=,|\s+at\b|\s+has\s+selected\b)/,
  /\b[A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,3}\s+(?:Airways|Airlines|Air|Aviation)\b/,
];

function extractOperator(signal) {
  const text = cleanText(`${signal.headline || ""} ${signal.summary || ""}`);
  for (const pattern of OPERATOR_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const candidate = (match[1] || match[0]).replace(/\s+/g, " ").trim();
      if (/^(?:Digital|Commercial|Business|General|Civil) Aviation$/i.test(candidate)) continue;
      if (/\bBytron Aviation(?: Systems)?\b/i.test(candidate)) continue;
      return canonicalOperator(candidate);
    }
  }
  return "N/A";
}

function canonicalOperator(name) {
  if (/^(?:International|Unknown|Private flight)$/i.test(name)) return "N/A";
  if (/^(?:Pan American World Airways|Pan Am)$/i.test(name)) return "Pan Am";
  if (/^UrbanLink Air Mobility$/i.test(name)) return "UrbanLink Air Mobility";
  return name;
}

async function loadAirlineDictionary() {
  const res = await fetch("data/airlines.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load airlines.json (${res.status})`);
  const payload = await res.json();
  const publicNames = (payload.airlines || []).flatMap((airline) => [airline.name, airline.alias]);
  airlineDictionaryPattern = buildAirlineDictionaryPattern([...AIRLINE_DICTIONARY, ...publicNames]);
  OPERATOR_PATTERNS[0] = airlineDictionaryPattern;
}

function titleHighlight(signal) {
  const headline = displaySignalTitle(signal);
  const operator = extractOperator(signal);
  return { headline, operator };
}

function competitorTitleTerms(name) {
  const terms = {
    Jeppesen: ["Jeppesen"],
    "Bytron Skybook": ["Bytron Skybook", "Bytron", "Skybook"],
    Navblue: ["Navblue", "NAVBLUE", "Skywise", "Mission+"],
  };
  return terms[name] || [name];
}

function highlightTitle(signal) {
  const title = escapeHtml(displaySignalTitle(signal));
  const competitor = displayCompetitor(signal.competitor);
  const operator = extractOperator(signal);
  const terms = [
    ...competitorTitleTerms(competitor).map((value) => ({ value, className: "title-competitor" })),
    { value: operator, className: "title-airline" },
    ...["Agentic AI", "artificial intelligence", "AI"].map((value) => ({ value, className: "title-ai" })),
  ]
    .filter(({ value }) => value && value !== "N/A")
    .sort((a, b) => b.value.length - a.value.length);
  if (!terms.length) return title;
  const pattern = terms
    .map(({ value, className }) => {
      const escaped = escapeHtml(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return className === "title-ai" ? `\\b${escaped}\\b` : escaped;
    })
    .join("|");
  return title.replace(new RegExp(`(${pattern})`, "gi"), (match) => {
    const term = terms.find(({ value }) => value.toLowerCase() === match.toLowerCase());
    return `<mark class="title-emphasis ${term?.className || "title-competitor"}">${match}</mark>`;
  });
}

function buildBriefingSummary(signal) {
  const headline = displaySignalTitle(signal);
  const summary = cleanText(signal.summary);
  const why = cleanText(signal.why_it_matters);
  const typeLabel = TYPE_LABELS[signal.type] || signal.type;
  const isAuto = (signal.tags || []).includes("auto-capture");
  const summaryLooksLikeHtml =
    summary.includes("<") || summary.includes("&nbsp;") || summary.includes('target="_blank"');
  const summaryIsUseful =
    summary.length > 40 &&
    summary.toLowerCase() !== headline.toLowerCase() &&
    !summaryLooksLikeHtml;

  if (summaryIsUseful && !isAuto) {
    return summary;
  }

  if (summaryIsUseful && isAuto && !why.includes("Auto-captured")) {
    return summary;
  }

  if (why && !why.includes("Auto-captured")) {
    return `${headline}. ${why}`;
  }

  return `${signal.competitor} · ${typeLabel}: ${headline}. This item was auto-captured from public sources — open the source link below to confirm the update and assess relevance for Cathay Technologies.`;
}

function conciseEvidenceSummary(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "No summary available. Open the source for the original update.";
  const sentences = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)].map((part) => part.segment.trim())
    : (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text]).map((sentence) => sentence.trim());
  const selected = [];
  let wordCount = 0;
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    if (selected.length >= 3 || wordCount + words.length > 60) break;
    selected.push(sentence);
    wordCount += words.length;
  }
  if (!selected.length) return `${text.split(/\s+/).slice(0, 60).join(" ").replace(/[.!?]+$/, "").trim()}.`;
  return selected.join(" ");
}

function renderSavedAIAnalysis(signal) {
  const analysis = signal.ai_enrichment;
  const reviewNotes = [];
  if (signal.analyst_type_review) {
    const previous = TYPE_LABELS[signal.analyst_type_review.from] || signal.analyst_type_review.from || "previous type";
    reviewNotes.push(`Signal type reviewed from ${previous}`);
  }
  if (signal.analyst_product_focus_review) {
    const previous = FOCUS_LABELS[signal.analyst_product_focus_review.from] || signal.analyst_product_focus_review.from || "previous focus";
    reviewNotes.push(`Product focus reviewed from ${previous}`);
  }
  const reviewMarkup = reviewNotes.length
    ? `<p class="ai-summary-result">${escapeHtml(reviewNotes.join(" · "))}</p>`
    : "";
  if (!analysis) {
    if (signal.ai_brief?.summary) return reviewMarkup;
    const status = signal.ai_enrichment_status === "pending"
      ? "AI analysis is queued for the next background enrichment run."
      : "No saved AI analysis for this signal.";
    return `<p class="ai-summary-result">${escapeHtml(status)}</p>${reviewMarkup}`;
  }

  const currentType = TYPE_LABELS[signal.type] || signal.type || "Unknown";
  const suggestedType = TYPE_LABELS[analysis.suggested_type] || analysis.suggested_type;
  const currentFocus = FOCUS_LABELS[signal.product_focus] || signal.product_focus || "Unknown";
  const suggestedFocus = FOCUS_LABELS[analysis.suggested_product_focus] || analysis.suggested_product_focus;
  const typeStatus = signal.analyst_type_review
    ? `Reviewed from ${TYPE_LABELS[signal.analyst_type_review.from] || signal.analyst_type_review.from || "previous type"}`
    : analysis.type_auto_applied
    ? `AI updated from ${TYPE_LABELS[analysis.original_type] || analysis.original_type || "Unknown"}`
    : analysis.type_matches_existing
      ? "Matches current label"
      : `Review suggestion · current: ${currentType}`;
  const reviewedFocus = signal.analyst_product_focus_review;
  const focusStatus = reviewedFocus
    ? `Reviewed from ${FOCUS_LABELS[reviewedFocus.from] || reviewedFocus.from || "Unknown"}`
    : analysis.focus_auto_applied
    ? `AI updated from ${FOCUS_LABELS[analysis.original_product_focus] || analysis.original_product_focus || "Unknown"}`
    : analysis.focus_matches_existing
      ? "Matches current label"
      : `Review suggestion · current: ${currentFocus}`;
  const rates = analysis.catalog_pricing;
  const rateNote = rates
    && Number.isFinite(rates.prompt)
    && Number.isFinite(rates.completion)
    ? ` · rates per 1M tokens USD: input $${(rates.prompt * 1_000_000).toFixed(3)}, output $${(rates.completion * 1_000_000).toFixed(3)}`
    : "";

  return `
    <div class="ai-analysis-details">
      <p><strong>Announcement tone:</strong> ${escapeHtml(analysis.announcement_tone)}</p>
      <p><strong>Signal type:</strong> ${escapeHtml(suggestedType)} · ${Math.round(analysis.type_confidence * 100)}% confidence · ${escapeHtml(typeStatus)}</p>
      <p><strong>Product focus:</strong> ${escapeHtml(suggestedFocus)} · ${Math.round(analysis.focus_confidence * 100)}% confidence · ${escapeHtml(focusStatus)}</p>
      <p><strong>Competitive insight:</strong> ${escapeHtml(analysis.competitive_insight)}</p>
      <p><strong>Caveat:</strong> ${escapeHtml(analysis.caveat || "No additional caveat provided.")}</p>
    </div>
    <p class="ai-summary-note">${escapeHtml(analysis.model)} · saved ${escapeHtml(analysis.enriched_at)}${escapeHtml(rateNote)}</p>
  `;
}

function renderFeed(signals) {
  els.feedCount.textContent = `${signals.length} signals`;

  if (!signals.length) {
    els.signalFeed.innerHTML = `<p class="empty-state" style="padding:16px">No signals match the current filters.</p>`;
    return;
  }

  if (!signals.some((s) => s.id === selectedId)) {
    selectedId = signals[0].id;
  }

  const rows = signals
    .map((s) => {
      const active = s.id === selectedId ? "active" : "";
      const focus = classifyProductFocus(s);
      const focusClass = focus === "eff" ? "focus-eff" : focus === "efb" ? "focus-efb" : "focus-other";
      return `
        <button class="signal-row ${active}" role="option" aria-selected="${s.id === selectedId}" data-id="${s.id}">
          <span class="col col-date">${formatDate(s.date)}</span>
          <span class="col col-competitor"><span class="competitor-tag ${competitorClass(displayCompetitor(s.competitor))}">${escapeHtml(displayCompetitor(s.competitor))}</span></span>
          <span class="col col-type">${signalTypeMarkup(s)}</span>
          <span class="col col-focus"><span class="chip ${focusClass}">${FOCUS_LABELS[focus] || focus}</span></span>
          <span class="col col-title"><strong class="title-headline">${highlightTitle(s)}</strong></span>
        </button>`;
    })
    .join("");

  els.signalFeed.innerHTML = `
    <div class="feed-table">
      <div class="feed-header" aria-hidden="true">
        <span class="col col-date">Date</span>
        <span class="col col-competitor">Competitor</span>
        <span class="col col-type">Signal type</span>
        <span class="col col-focus">Focus</span>
        <span class="col col-title">Title</span>
      </div>
      <div class="feed-body">${rows}</div>
    </div>`;

  for (const btn of els.signalFeed.querySelectorAll(".signal-row")) {
    btn.addEventListener("click", () => {
      selectedId = btn.dataset.id;
      render();
    });
  }
}

function renderBriefing(signals, target = els.briefing, activeId = selectedId) {
  const signal = signals.find((s) => s.id === activeId) || signals[0];
  if (!signal) {
    target.innerHTML = `<p class="empty-state">Select a signal to open the briefing.</p>`;
    return;
  }

  const sources = (signal.sources || [])
    .map((src) => `<li><a href="${escapeAttr(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.title || src.url)}</a></li>`)
    .join("");

  const evidenceSummary = conciseEvidenceSummary(cleanText(signal.ai_brief?.summary || signal.ai_enrichment?.summary || signal.summary));
  const evidenceLabel = signal.ai_brief?.summary || signal.ai_enrichment?.summary ? "AI evidence summary" : "Evidence preview";
  const capturedHeadline = signal.ai_brief?.title || signal.ai_enrichment?.headline_summary
    ? `<p class="ai-source-headline"><strong>Captured headline:</strong> ${escapeHtml(cleanHeadline(signal.headline))}</p>`
    : "";
  const sourceLabel = SOURCE_LABELS[signal.source_origin] || SOURCE_LABELS[signal.source_channel] || signal.source_origin || signal.source_channel || "Source";
  const operatorLabel = extractOperator(signal);
  const aiAnalysis = renderSavedAIAnalysis(signal);

  target.innerHTML = `
    <p class="kicker">${escapeHtml(signal.competitor)} · ${escapeHtml(operatorLabel)} · ${escapeHtml(sourceLabel)}</p>
    <h3>${highlightTitle(signal)}</h3>
    <div class="briefing-summary">
      <p class="briefing-summary-label">${escapeHtml(evidenceLabel)}</p>
      ${capturedHeadline}
      <p class="briefing-summary-text">${escapeHtml(evidenceSummary)}</p>
    </div>
    <section class="ai-summary" aria-label="AI-generated signal summary">
      <div class="ai-summary-head">
        <div>
          <p class="ai-summary-note">AI analysis from captured evidence · verify against the original source</p>
        </div>
      </div>
      <div role="status">${aiAnalysis}</div>
    </section>
    <div class="brief-grid">
      <div class="brief-card">
        <h4>Competitor</h4>
        <p>${escapeHtml(signal.competitor)}</p>
      </div>
      <div class="brief-card">
        <h4>Airline / operator</h4>
        <p>${escapeHtml(operatorLabel)}</p>
      </div>
      <div class="brief-card">
        <h4>Date</h4>
        <p>${formatDate(signal.date)}</p>
      </div>
      <div class="brief-card">
        <h4>Source</h4>
        <p>${escapeHtml(sourceLabel)}</p>
      </div>
    </div>
    <div class="section">
      <h4>Original source</h4>
      <ul>${sources || "<li>No source link available.</li>"}</ul>
    </div>
  `;

}

function monthKey(date) {
  const d = parseDate(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function last12MonthKeys() {
  const keys = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function monthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return `${monthName} '${String(year).slice(-2)}`;
}

function renderActivityChart(signals) {
  const chartSignals = activityChartSource === "linkedin"
    ? signals.filter((signal) => String(signal.source_channel || "").toLowerCase() === "linkedin")
    : signals;
  const months = last12MonthKeys();
  const counts = {};
  for (const c of COMPETITORS) {
    counts[c] = Object.fromEntries(months.map((m) => [m, 0]));
  }
  for (const s of chartSignals) {
    const key = monthKey(s.date);
    const competitor = displayCompetitor(s.competitor);
    if (counts[competitor] && key in counts[competitor]) {
      counts[competitor][key] += 1;
    }
  }

  const chartWidth = 1040;
  const chartHeight = 360;
  const plot = { left: 58, right: 20, top: 20, bottom: 292 };
  const plotWidth = chartWidth - plot.left - plot.right;
  const plotHeight = plot.bottom - plot.top;
  const maxCount = Math.max(0, ...COMPETITORS.flatMap((competitor) => Object.values(counts[competitor])));
  const tickStep = Math.max(1, Math.ceil(maxCount / 4));
  const yMax = tickStep * 4;
  const xPosition = (index) => plot.left + (plotWidth * index) / (months.length - 1);
  const yPosition = (count) => plot.bottom - (count / yMax) * plotHeight;
  const markerOffsets = Object.fromEntries(COMPETITORS.map((competitor) => [competitor, {}]));
  for (const month of months) {
    const competitorsByCount = new Map();
    for (const competitor of COMPETITORS) {
      const count = counts[competitor][month];
      if (count === 0) continue;
      const group = competitorsByCount.get(count) || [];
      group.push(competitor);
      competitorsByCount.set(count, group);
    }
    for (const competitors of competitorsByCount.values()) {
      competitors.forEach((competitor, index) => {
        markerOffsets[competitor][month] = (index - (competitors.length - 1) / 2) * 10;
      });
    }
  }

  const horizontalGrid = Array.from({ length: 5 }, (_, index) => {
    const value = tickStep * index;
    const y = yPosition(value);
    return `<g class="trend-y-tick"><line class="trend-grid-line" x1="${plot.left}" y1="${y}" x2="${chartWidth - plot.right}" y2="${y}" /><text class="trend-axis-label" x="${plot.left - 12}" y="${y + 4}" text-anchor="end">${value}</text></g>`;
  }).join("");

  const monthAxis = months.map((month, index) => {
    const x = xPosition(index);
    return `<g><line class="trend-month-grid" x1="${x}" y1="${plot.top}" x2="${x}" y2="${plot.bottom}" /><text class="trend-axis-label trend-month-label" x="${x}" y="${plot.bottom + 24}" text-anchor="middle">${monthLabel(month)}</text></g>`;
  }).join("");

  const series = COMPETITORS.map((competitor) => {
    const values = months.map((month) => counts[competitor][month]);
    const path = values.map((value, index) => `${index === 0 ? "M" : "L"} ${xPosition(index)} ${yPosition(value)}`).join(" ");
    const areaPath = `M ${xPosition(0)} ${plot.bottom} ${values.map((value, index) => `L ${xPosition(index)} ${yPosition(value)}`).join(" ")} L ${xPosition(months.length - 1)} ${plot.bottom} Z`;
    return `<g class="trend-series trend-line-series" data-competitor="${escapeAttr(competitor)}" style="--series-color:${COMPETITOR_COLORS[competitor]}"><path class="trend-area" d="${areaPath}" /><path class="trend-hover-line" d="${path}" /><path class="trend-line" d="${path}" /></g>`;
  }).join("");

  const points = COMPETITORS.map((competitor) => {
    const competitorPoints = months.map((month, index) => {
      const value = counts[competitor][month];
      const lineX = xPosition(index);
      const offset = markerOffsets[competitor][month] || 0;
      const x = lineX + offset;
      const y = yPosition(value);
      if (value === 0) return `<circle class="trend-zero" cx="${x}" cy="${y}" r="2.5" />`;
      const stem = offset ? `<line class="trend-point-stem" x1="${lineX}" y1="${y}" x2="${x}" y2="${y}" />` : "";
      return `<g class="trend-point" role="button" tabindex="0" data-competitor="${escapeAttr(competitor)}" data-month="${month}" aria-label="${escapeAttr(competitor)} ${monthLabel(month)}: ${value} signals" title="${escapeAttr(competitor)} · ${monthLabel(month)}: ${value} signals">${stem}<circle class="trend-hit-area" cx="${x}" cy="${y}" r="4.5" /><circle class="trend-marker" cx="${x}" cy="${y}" r="4" /></g>`;
    }).join("");
    return `<g class="trend-series trend-point-series" data-competitor="${escapeAttr(competitor)}" style="--series-color:${COMPETITOR_COLORS[competitor]}">${competitorPoints}</g>`;
  }).join("");

  const legend = COMPETITORS.map((competitor) => `<span class="trend-legend-item"><span class="trend-legend-swatch" style="--series-color:${COMPETITOR_COLORS[competitor]}" aria-hidden="true"></span>${escapeHtml(competitor)}</span>`).join("");

  els.activityChart.innerHTML = `
    <svg class="trend-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="group" aria-label="Monthly ${activityChartSource === "linkedin" ? "LinkedIn post" : "all source"} volume for each competitor">
      <title>12-month ${activityChartSource === "linkedin" ? "LinkedIn post" : "signal"} volume by competitor</title>
      ${horizontalGrid}${monthAxis}${series}${points}
    </svg>
    <div class="trend-legend" aria-label="Competitors">${legend}</div>
    <div class="trend-tooltip" role="tooltip" hidden>
      <strong class="trend-tooltip-name"></strong>
      <span class="trend-tooltip-detail"></span>
    </div>`;

  const tooltip = els.activityChart.querySelector(".trend-tooltip");
  const showTooltip = (competitor, index, clientX, clientY) => {
    const month = months[index];
    tooltip.querySelector(".trend-tooltip-name").textContent = competitor;
    tooltip.querySelector(".trend-tooltip-detail").textContent = `${monthLabel(month)} · ${counts[competitor][month]} signals`;
    tooltip.style.setProperty("--series-color", COMPETITOR_COLORS[competitor]);
    tooltip.hidden = false;
    const bounds = els.activityChart.getBoundingClientRect();
    const left = clientX - bounds.left + 12;
    const top = clientY - bounds.top + 12;
    tooltip.style.left = `${Math.max(8, Math.min(els.activityChart.clientWidth - tooltip.offsetWidth - 8, left))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(chartHeight - tooltip.offsetHeight - 8, top))}px`;
  };

  els.activityChart.querySelectorAll(".trend-point").forEach((point) => {
    const series = point.closest(".trend-series");
    const showPointTooltip = () => {
      const bounds = point.getBoundingClientRect();
      const index = months.indexOf(point.dataset.month);
      showTooltip(point.dataset.competitor, index, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    };
    const openSignals = () => {
      const { competitor, month } = point.dataset;
      const matches = chartSignals.filter((signal) => displayCompetitor(signal.competitor) === competitor && monthKey(signal.date) === month);
      openQuickLook(matches, `${competitor} · ${month}`);
    };
    point.addEventListener("click", openSignals);
    point.addEventListener("focus", showPointTooltip);
    point.addEventListener("blur", () => {
      if (!series.matches(":hover")) tooltip.hidden = true;
    });
    point.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSignals();
      }
    });
  });

  els.activityChart.querySelectorAll(".trend-series").forEach((series) => {
    series.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      const competitor = series.dataset.competitor;
      const bounds = els.activityChart.querySelector(".trend-chart").getBoundingClientRect();
      const chartX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
      const index = Math.max(0, Math.min(months.length - 1, Math.round(((chartX - plot.left) / plotWidth) * (months.length - 1))));
      showTooltip(competitor, index, event.clientX, event.clientY);
    });
    series.addEventListener("pointerleave", () => {
      if (!series.contains(document.activeElement)) tooltip.hidden = true;
    });
  });

  els.chartSourceFilter.querySelectorAll("[data-chart-source]").forEach((button) => {
    const selected = button.dataset.chartSource === activityChartSource;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function compactSignalRows(signals) {
  return signals.map((signal) => `<button type="button" class="signal-row compact-signal" data-quick-signal="${escapeAttr(signal.id)}">
    <span class="col-date">${formatDate(signal.date)}</span>
    <span class="competitor-tag ${competitorClass(displayCompetitor(signal.competitor))}">${escapeHtml(displayCompetitor(signal.competitor))}</span>
    <span class="col-type">${signalTypeMarkup(signal)}</span>
    <span class="chip">${escapeHtml(FOCUS_LABELS[classifyProductFocus(signal)])}</span>
    <strong class="title-headline">${highlightTitle(signal)}</strong>
  </button>`).join("");
}

function openQuickLook(signals, title, initialId = null) {
  const dialog = document.getElementById("quickLook");
  const list = document.getElementById("quickLookList");
  const briefing = document.getElementById("quickLookBriefing");
  const back = document.getElementById("quickLookBack");
  const ordered = [...signals].sort((first, second) => second.date.localeCompare(first.date));
  document.getElementById("quickLookTitle").textContent = `${title} · ${ordered.length} signals`;
  list.innerHTML = compactSignalRows(ordered);
  let activeButton = null;
  const showSignal = (signalId) => {
    activeButton = [...list.querySelectorAll("[data-quick-signal]")].find((button) => button.dataset.quickSignal === signalId);
    list.hidden = true;
    briefing.hidden = false;
    back.hidden = false;
    renderBriefing(ordered, briefing, signalId);
    briefing.scrollTop = 0;
    briefing.focus({ preventScroll: true });
  };
  back.onclick = () => {
    briefing.hidden = true;
    list.hidden = false;
    back.hidden = true;
    activeButton?.focus({ preventScroll: true });
  };
  briefing.hidden = true;
  list.hidden = false;
  back.hidden = true;
  list.querySelectorAll("[data-quick-signal]").forEach((button) => {
    button.addEventListener("click", () => showSignal(button.dataset.quickSignal));
  });
  dialog.showModal();
  if (initialId) showSignal(initialId);
}

document.getElementById("quickLookClose").addEventListener("click", () => document.getElementById("quickLook").close());

function renderActivitySummary() {
  const container = document.getElementById("activitySummary");
  const period = document.getElementById("activityPeriod");
  if (!container || !period) return;
  const windowSelect = document.getElementById("activityWindow");
  const cutoff = daysAgo(Number(windowSelect.value));
  const now = new Date();
  const signals = allSignals.filter((signal) => parseDate(signal.date) >= cutoff && parseDate(signal.date) <= now);
  period.textContent = `${windowSelect.selectedOptions[0].textContent} · ${signals.length} captured signals`;
  const rows = summarizeActivity(signals, (signal) => displayCompetitor(signal.competitor));
  if (!rows.length) {
    container.innerHTML = '<p class="muted">No activity in this period.</p>';
    return;
  }
  container.innerHTML = `<div class="activity-columns" aria-hidden="true"><span>Competitor</span><span>Main movement</span><span>Evidence</span></div>${rows.map((row) => `<details class="activity-group">
    <summary class="activity-columns"><span><span class="competitor-tag ${competitorClass(row.competitor)}">${escapeHtml(row.competitor)}</span></span>
      <strong class="activity-movement">${escapeHtml(row.mainMovement)}</strong>
      <span class="activity-evidence">${row.evidence.length} supporting signals <span class="muted">(${row.capturedCount} captured)</span></span>
    </summary>
    <div class="compact-signals">${compactSignalRows(row.evidence) || '<p class="muted">No substantive evidence in these captures.</p>'}</div>
  </details>`).join("")}`;
  container.querySelectorAll("[data-quick-signal]").forEach((button) => {
    const row = rows.find((entry) => entry.evidence.some((signal) => signal.id === button.dataset.quickSignal));
    button.addEventListener("click", () => openQuickLook(row.evidence, row.competitor, button.dataset.quickSignal));
  });
}

function renderCompetitiveInsights(snapshot) {
  const status = document.getElementById("insightStatus");
  const lead = document.getElementById("insightLead");
  const rows = document.getElementById("insightRows");
  const meta = document.getElementById("insightMeta");
  if (snapshot?.status !== "ready" || !Array.isArray(snapshot.insights)) {
    status.textContent = "No saved synthesis yet. It will appear after a successful data refresh.";
    return;
  }

  status.hidden = true;
  lead.hidden = false;
  lead.textContent = snapshot.lead;
  const generated = formatTimestamp(snapshot.generated_at);
  meta.textContent = `${snapshot.window_start} to ${snapshot.window_end} · ${snapshot.source_signal_count} captured signals · Updated ${generated}`;
  rows.innerHTML = snapshot.insights.map((insight) => {
    const citations = (insight.evidence_ids || []).map((signalId) => {
      const signal = allSignals.find((item) => item.id === signalId);
      if (!signal) return "";
      return `<button type="button" class="insight-evidence" data-insight-signal="${escapeAttr(signalId)}">${escapeHtml(displayCompetitor(signal.competitor))} · ${escapeHtml(formatDate(signal.date))}</button>`;
    }).join("");
    return `<article class="insight-row">
      <p class="insight-category">${escapeHtml(String(insight.category || "Pattern").replaceAll("_", " "))}</p>
      <h3>${escapeHtml(insight.title)}</h3>
      <p>${escapeHtml(insight.finding)}</p>
      ${insight.aviation_context ? `<p class="insight-context">${escapeHtml(insight.aviation_context)}</p>` : ""}
      ${insight.caveat ? `<p class="insight-caveat muted">${escapeHtml(insight.caveat)}</p>` : ""}
      <div class="insight-evidence-list" aria-label="Evidence">${citations}</div>
    </article>`;
  }).join("");
  if (!snapshot.insights.length) {
    rows.innerHTML = '<p class="muted">No robust cross-signal pattern was found in the latest window.</p>';
  }
  rows.querySelectorAll("[data-insight-signal]").forEach((button) => {
    const signal = allSignals.find((item) => item.id === button.dataset.insightSignal);
    button.addEventListener("click", () => {
      if (signal) openQuickLook([signal], `${displayCompetitor(signal.competitor)} · ${formatDate(signal.date)}`, signal.id);
    });
  });
}

async function loadCompetitiveInsights() {
  try {
    const response = await fetch("data/competitive-insights.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Insight snapshot unavailable (${response.status})`);
    renderCompetitiveInsights(await response.json());
  } catch {
    renderCompetitiveInsights(null);
  }
}

function render() {
  const baseSignals = filteredSignals();
  const signals = selectedMatrixIds ? baseSignals.filter((signal) => selectedMatrixIds.has(signal.id)) : baseSignals;
  renderFeed(signals);
  renderBriefing(signals);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

async function boot() {
  const [res] = await Promise.all([
    fetch("data/signals.json", { cache: "no-store" }),
    loadAirlineDictionary(),
  ]);
  if (!res.ok) throw new Error(`Failed to load signals.json (${res.status})`);
  const payload = await res.json();
  allSignals = payload.signals || [];
  const updatedAt = new Date(payload.generated_at);
  els.lastUpdate.textContent = `Last update: ${formatTimestamp(payload.generated_at)}`;
  if (!Number.isNaN(updatedAt.getTime())) els.lastUpdate.dateTime = updatedAt.toISOString();
  const matrixSelection = sessionStorage.getItem("ct-matrix-signal-ids");
  const matrixCompetitor = sessionStorage.getItem("ct-matrix-competitor");
  if (matrixSelection) {
    selectedMatrixIds = new Set(JSON.parse(matrixSelection));
    sessionStorage.removeItem("ct-matrix-signal-ids");
  }
  els.dataMeta.textContent = `${payload.lookback_days || 365}-day lookback · ${allSignals.length} raw signals`;
  populateFilters(allSignals);
  if (matrixCompetitor && [...els.competitorFilter.options].some((option) => option.value === matrixCompetitor)) {
    els.competitorFilter.value = matrixCompetitor;
    sessionStorage.removeItem("ct-matrix-competitor");
  }
  render();
  const activityWindow = document.getElementById("activityWindow");
  activityWindow.value = "30";
  activityWindow.addEventListener("change", renderActivitySummary);
  renderActivitySummary();
  renderActivityChart(allSignals);
  loadCompetitiveInsights();
}

els.chartSourceFilter?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chart-source]");
  if (!button || button.dataset.chartSource === activityChartSource) return;
  activityChartSource = button.dataset.chartSource;
  renderActivityChart(allSignals);
});

for (const el of [els.competitorFilter, els.typeFilter].filter(Boolean)) {
  el.addEventListener("change", render);
}

els.searchInput?.addEventListener("input", () => {
  if (els.clearSearch) els.clearSearch.hidden = !els.searchInput.value;
  render();
});

els.clearSearch?.addEventListener("click", () => {
  if (!els.searchInput) return;
  els.searchInput.value = "";
  els.clearSearch.hidden = true;
  els.searchInput.focus();
  render();
});

const savedTheme = localStorage.getItem("ct-theme");
setTheme(savedTheme === "light" ? "light" : "dark");
els.themeToggle?.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

boot().catch((err) => {
  els.signalFeed.innerHTML = `<p class="empty-state" style="padding:16px">Could not load data. Serve this folder over HTTP (not file://). ${escapeHtml(err.message)}</p>`;
});
