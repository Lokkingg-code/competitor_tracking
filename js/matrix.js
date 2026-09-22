const els = {
  feed: document.getElementById("matrixFeed"),
  search: document.getElementById("matrixSearch"),
  competitor: document.getElementById("matrixCompetitor"),
  count: document.getElementById("matrixCount"),
  meta: document.getElementById("matrixMeta"),
  themeToggle: document.getElementById("themeToggle"),
};

const PRODUCT_PATTERNS = [
  ["AvioBook Connect", /(?:AvioBook|Aviobook)\s+Connect/i],
  ["AvioBook", /(?:AvioBook|Aviobook)\b/i],
  ["Boeing FlightFolder", /Boeing\s+Flight\s*Folder|FlightFolder/i],
  ["Bytron Skybook", /(?:Bytron\s+)?Skybook/i],
  ["ForeFlight EFFCore", /(?:ForeFlight\s+)?EFF\s*Core|EFFCore/i],
  ["ForeFlight FliteDeck Pro", /(?:Jeppesen\s+)?ForeFlight.*FliteDeck\s+Pro|FliteDeck\s+Pro/i],
  ["ForeFlight", /\bForeFlight\b/i],
  ["Lido mBriefing", /(?:Lido\s+)?mBriefing/i],
  ["Mission+ DOC", /Mission\+\s+DOC/i],
  ["Mission+ FLIGHT", /Mission\+\s+FLIGHT/i],
  ["IFS EFBOne", /(?:IFS\s+)?EFBOne/i],
];

let signals = [];
let airlinePattern;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === "light";
  els.themeToggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
  els.themeToggle.querySelector(".theme-icon").textContent = light ? "◐" : "☼";
  els.themeToggle.querySelector(".theme-label").textContent = light ? "Dark mode" : "Light mode";
  localStorage.setItem("ct-theme", theme);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function cleanText(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function competitorClass(name) {
  return `competitor-${name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "")}`;
}

function buildAirlinePattern(names) {
  const terms = [...new Set(names.filter(Boolean))]
    .filter((name) => name.trim().length >= 3 && name.trim().toLowerCase() !== "via")
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${terms.join("|")})\\b`, "i");
}

function extractOperator(signal) {
  const text = cleanText(`${signal.headline || ""} ${signal.summary || ""}`);
  const dictionaryMatch = airlinePattern ? text.match(airlinePattern) : null;
  if (dictionaryMatch && !/\bBytron Aviation(?: Systems)?\b/i.test(dictionaryMatch[0])) return dictionaryMatch[0];
  const fallback = text.match(/\b[A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,3}\s+(?:Airways|Airlines|Air|Aviation)\b/)?.[0];
  const isGenericIndustryTerm = /^(?:Digital|Commercial|Business|General|Civil) Aviation$/i.test(fallback || "");
  return fallback && !isGenericIndustryTerm && !/\bBytron Aviation(?: Systems)?\b/i.test(fallback) ? fallback : "N/A";
}

function detectProduct(signal) {
  if (Number(signal.confidence || 0) < 0.8) return "";
  if (signal.product && signal.product !== "Unspecified product") return signal.product;
  const text = `${signal.headline || ""} ${signal.summary || ""} ${signal.why_it_matters || ""}`;
  return PRODUCT_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function groupedRows() {
  const groups = new Map();
  for (const signal of signals) {
    const product = detectProduct(signal);
    const key = `${signal.competitor}|${product}`;
    if (!groups.has(key)) groups.set(key, { competitor: signal.competitor, product, airlines: new Map(), ids: new Set(), latest: signal.date });
    const group = groups.get(key);
    const airline = extractOperator(signal);
    if (airline !== "N/A") {
      if (!group.airlines.has(airline)) group.airlines.set(airline, new Set());
      group.airlines.get(airline).add(signal.id);
    }
    group.ids.add(signal.id);
    if (signal.date > group.latest) group.latest = signal.date;
  }
  return [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest) || a.competitor.localeCompare(b.competitor));
}

function render() {
  const query = els.search.value.trim().toLowerCase();
  const competitor = els.competitor.value;
  const rows = groupedRows().filter((row) => {
    const text = `${row.competitor} ${row.product} ${[...row.airlines.keys()].join(" ")}`.toLowerCase();
    return (competitor === "all" || row.competitor === competitor) && (!query || text.includes(query));
  });

  els.count.textContent = `${rows.length} relationships`;
  const body = rows.map((row) => `
    <div class="signal-row matrix-signal-row" role="row">
      <span class="col col-competitor"><span class="competitor-tag ${competitorClass(row.competitor)}">${escapeHtml(row.competitor)}</span></span>
      <span class="col matrix-product">${row.product ? `<strong>${escapeHtml(row.product)}</strong>` : '<span class="muted">Not asserted</span>'}</span>
      <span class="col matrix-airlines">${[...row.airlines.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, ids]) => `<button class="chip focus-other airline-chip" type="button" data-signal-ids="${[...ids].join(",")}" title="Open ${ids.size} related signal${ids.size === 1 ? "" : "s"}">${escapeHtml(name)}</button>`).join("") || '<span class="muted">N/A</span>'}</span>
      <span class="col matrix-volume"><strong>${row.ids.size}</strong><small>signals</small></span>
      <span class="col col-date">${formatDate(row.latest)}</span>
    </div>`).join("");

  els.feed.innerHTML = rows.length ? `
    <div class="feed-table matrix-feed-table">
      <div class="feed-header matrix-feed-header" aria-hidden="true">
        <span>Competitor</span><span>Product</span><span>Airline / operator</span><span>Volume</span><span>Latest</span>
      </div>
      <div class="feed-body">${body}</div>
    </div>` : '<p class="empty-state">No relationships match the current filters.</p>';

  for (const chip of els.feed.querySelectorAll(".airline-chip")) {
    chip.addEventListener("click", () => {
      sessionStorage.setItem("ct-matrix-signal-ids", JSON.stringify([...new Set(chip.dataset.signalIds.split(","))]));
      location.href = "index.html#signalFeed";
    });
  }
}

async function boot() {
  const [signalsRes, airlinesRes] = await Promise.all([
    fetch("data/signals.json", { cache: "no-store" }),
    fetch("data/airlines.json", { cache: "no-store" }),
  ]);
  if (!signalsRes.ok || !airlinesRes.ok) throw new Error("Could not load matrix data.");
  const payload = await signalsRes.json();
  const airlines = await airlinesRes.json();
  signals = payload.signals || [];
  airlinePattern = buildAirlinePattern((airlines.airlines || []).flatMap((airline) => [airline.name, airline.alias]));
  for (const name of [...new Set(signals.map((signal) => signal.competitor))].sort()) {
    els.competitor.add(new Option(name, name));
  }
  els.meta.textContent = `Generated ${payload.generated_at || "—"} · ${signals.length} public signals`;
  render();
}

els.search.addEventListener("input", render);
els.competitor.addEventListener("change", render);
setTheme(localStorage.getItem("ct-theme") === "light" ? "light" : "dark");
els.themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
boot().catch((error) => { els.feed.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`; });
