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

const els = {
  windowFilter: document.getElementById("windowFilter"),
  competitorFilter: document.getElementById("competitorFilter"),
  typeFilter: document.getElementById("typeFilter"),
  focusFilter: document.getElementById("focusFilter"),
  searchInput: document.getElementById("searchInput"),
  clearSearch: document.getElementById("clearSearch"),
  metrics: document.getElementById("metrics"),
  feedCount: document.getElementById("feedCount"),
  signalFeed: document.getElementById("signalFeed"),
  briefing: document.getElementById("briefing"),
  heatmap: document.getElementById("heatmap"),
  dataMeta: document.getElementById("dataMeta"),
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
  const blob = `${signal.headline || ""} ${signal.summary || ""} ${signal.why_it_matters || ""}`;
  if (signal.competitor === "Aviobook" && /\b(?:AvioBook|Aviobook)\s+Connect\b/i.test(blob)) return "adjacent";

  const strongEff = [/\bEFF\b/i, /\bEFFCore\b/i, /electronic flight folder/i, /flight folder/i, /briefing pack/i, /DOC Manager/i, /\bskybook\b/i];
  const strongEfb = [/\bEFB\b/i, /electronic flight bag/i, /FliteDeck/i, /Manage My EFB/i, /Mission\+ FLIGHT/i];
  const hasStrongEff = strongEff.some((p) => p.test(blob));
  const hasStrongEfb = strongEfb.some((p) => p.test(blob));
  const inEffDomain = EFF_PATTERNS.some((p) => p.test(blob));

  if (hasStrongEff && !hasStrongEfb) return "eff";
  if (hasStrongEfb && !inEffDomain) return "efb";
  if (inEffDomain) return "eff";
  if (hasStrongEfb || EFB_PATTERNS.some((p) => p.test(blob))) return "efb";
  if (ADJACENT_PATTERNS.some((p) => p.test(blob))) return "adjacent";
  return "other";
}

function detectProduct(signal) {
  if (signal.product) return signal.product;
  const blob = `${signal.headline || ""} ${signal.summary || ""} ${signal.why_it_matters || ""}`;
  return PRODUCT_PATTERNS.find(([, pattern]) => pattern.test(blob))?.[0] || "Unspecified product";
}

function filteredSignals({ ignoreFocus = false, windowDays = Number(els.windowFilter.value) } = {}) {
  const cutoff = daysAgo(windowDays);
  const competitor = els.competitorFilter.value;
  const type = els.typeFilter.value;
  const focus = els.focusFilter?.value || "all";
  const search = (els.searchInput?.value || "").trim().toLowerCase();

  return allSignals
    .filter((s) => parseDate(s.date) >= cutoff)
    .filter((s) => matchesCompetitor(s, competitor))
    .filter((s) => (type === "all" ? true : s.type === type))
    .filter((s) => ignoreFocus || focus === "all" || classifyProductFocus(s) === focus)
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

function renderMetrics(signals) {
  const byCompetitor = Object.fromEntries(COMPETITORS.map((c) => [c, 0]));
  const byFocus = { eff: 0, efb: 0, adjacent: 0, other: 0 };

  for (const s of signals) {
    byCompetitor[s.competitor] = (byCompetitor[s.competitor] || 0) + 1;
    const focus = classifyProductFocus(s);
    byFocus[focus] = (byFocus[focus] || 0) + 1;
  }

  const cards = [
    { label: "EFF-related", value: String(byFocus.eff), hint: "Core flight-folder products", focus: "eff" },
    { label: "EFB-related", value: String(byFocus.efb), hint: "Flight-deck products", focus: "efb" },
    { label: "Adjacent operations", value: String(byFocus.adjacent), hint: "Dispatch, planning, etc.", focus: "adjacent" },
    { label: "Outside current focus", value: String(byFocus.other), hint: "Needs analyst review", focus: "other" },
    { label: "Total in window", value: String(signals.length), hint: "All competitors · 12-month view", focus: "all" },
    { label: "Last 14 days", value: `+${filteredSignals({ ignoreFocus: true, windowDays: 14 }).length}`, hint: "Recent signals · click to view", focus: "all", window: "14", className: "metric-recent" },
  ];

  els.metrics.innerHTML = cards
    .map(
      (c, i) => `
      <button class="metric ${c.className || ""}${els.focusFilter.value === c.focus && (!c.window || els.windowFilter.value === c.window) ? " is-selected" : ""}" type="button" data-focus="${c.focus}"${c.window ? ` data-window="${c.window}"` : ""} aria-pressed="${els.focusFilter.value === c.focus && (!c.window || els.windowFilter.value === c.window)}" style="animation-delay:${i * 40}ms">
        <p class="label">${c.label}</p>
        <p class="value">${c.value}</p>
        <p class="hint">${c.hint}</p>
      </button>`
    )
    .join("");
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
      return candidate;
    }
  }
  return "N/A";
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
  const headline = cleanHeadline(signal.headline);
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
  const title = escapeHtml(cleanHeadline(signal.headline));
  const competitor = displayCompetitor(signal.competitor);
  const operator = extractOperator(signal);
  const terms = [
    ...competitorTitleTerms(competitor).map((value) => ({ value, className: "title-competitor" })),
    { value: operator, className: "title-airline" },
  ]
    .filter(({ value }) => value && value !== "N/A")
    .sort((a, b) => b.value.length - a.value.length);
  if (!terms.length) return title;
  const pattern = terms
    .map(({ value }) => escapeHtml(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return title.replace(new RegExp(`(${pattern})`, "gi"), (match) => {
    const term = terms.find(({ value }) => value.toLowerCase() === match.toLowerCase());
    return `<mark class="title-emphasis ${term?.className || "title-competitor"}">${match}</mark>`;
  });
}

function buildBriefingSummary(signal) {
  const headline = cleanHeadline(signal.headline);
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
          <span class="col col-type">${TYPE_LABELS[s.type] || s.type}</span>
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

function renderBriefing(signals) {
  const signal = signals.find((s) => s.id === selectedId) || signals[0];
  if (!signal) {
    els.briefing.innerHTML = `<p class="empty-state">Select a signal to open the briefing.</p>`;
    return;
  }

  const sources = (signal.sources || [])
    .map((src) => `<li><a href="${escapeAttr(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.title || src.url)}</a></li>`)
    .join("");

  const evidenceSummary = cleanText(signal.summary) || "No summary available. Open the source for the original update.";
  const sourceLabel = SOURCE_LABELS[signal.source_origin] || SOURCE_LABELS[signal.source_channel] || signal.source_origin || signal.source_channel || "Source";
  const operatorLabel = extractOperator(signal);

  els.briefing.innerHTML = `
    <p class="kicker">${escapeHtml(signal.competitor)} · ${escapeHtml(operatorLabel)} · ${escapeHtml(sourceLabel)}</p>
    <h3>${escapeHtml(cleanHeadline(signal.headline))}</h3>
    <div class="briefing-summary">
      <p class="briefing-summary-label">Evidence preview</p>
      <p class="briefing-summary-text">${escapeHtml(evidenceSummary)}</p>
    </div>
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

function renderHeatmap(signals) {
  const months = last12MonthKeys();
  const counts = {};
  for (const c of COMPETITORS) {
    counts[c] = Object.fromEntries(months.map((m) => [m, 0]));
  }
  for (const s of signals) {
    const key = monthKey(s.date);
    const competitor = displayCompetitor(s.competitor);
    if (counts[competitor] && key in counts[competitor]) {
      counts[competitor][key] += 1;
    }
  }

  const max = Math.max(1, ...signals.map(() => 0), ...COMPETITORS.flatMap((c) => Object.values(counts[c])));

  const header = `<div class="heatmap-header"><span></span>${months
    .map((m) => `<span>${m.slice(2)}</span>`)
    .join("")}</div>`;

  const rows = COMPETITORS.map((c) => {
    const cells = months
      .map((m) => {
        const n = counts[c][m];
        const intensity = n === 0 ? 0 : 0.18 + (n / max) * 0.82;
        const bg = `rgba(42, 143, 132, ${intensity.toFixed(2)})`;
        return `<div class="heat-cell" style="background:${bg}" title="${c} ${m}: ${n}">${n || ""}</div>`;
      })
      .join("");
    return `<div class="heatmap-row"><div class="heatmap-label">${c}</div>${cells}</div>`;
  }).join("");

  els.heatmap.innerHTML = header + rows;
}

function render() {
  const baseSignals = filteredSignals();
  const signals = selectedMatrixIds ? baseSignals.filter((signal) => selectedMatrixIds.has(signal.id)) : baseSignals;
  renderMetrics(filteredSignals({ ignoreFocus: true, windowDays: 365 }));
  renderFeed(signals);
  renderBriefing(signals);
  renderHeatmap(signals);
}

els.metrics?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-focus]");
  if (!card || !els.focusFilter) return;
  els.focusFilter.value = card.dataset.focus;
  els.windowFilter.value = card.dataset.window || "365";
  render();
});

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
  const matrixSelection = sessionStorage.getItem("ct-matrix-signal-ids");
  if (matrixSelection) {
    selectedMatrixIds = new Set(JSON.parse(matrixSelection));
    sessionStorage.removeItem("ct-matrix-signal-ids");
  }
  els.dataMeta.textContent = `Generated ${payload.generated_at || "—"} · ${payload.lookback_days || 365}-day lookback · ${allSignals.length} raw signals`;
  populateFilters(allSignals);
  render();
}

for (const el of [els.windowFilter, els.competitorFilter, els.typeFilter, els.focusFilter].filter(Boolean)) {
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
