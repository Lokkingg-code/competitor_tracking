const els = {
  groups: document.getElementById("referenceGroups"),
  metrics: document.getElementById("referenceMetrics"),
  search: document.getElementById("referenceSearch"),
  meta: document.getElementById("referenceMeta"),
  themeToggle: document.getElementById("themeToggle"),
};

const GROUPS = [
  ["RSS feeds", "rss_feeds", "RSS / Atom", "Feed timestamp", "high"],
  ["LinkedIn organization pages", "linkedin_organizations", "LinkedIn browser / API", "API or post timestamp when available", "high"],
  ["Official newsrooms", "newsrooms", "Press page", "Article-header date, then metadata", "high"],
];

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === "light";
  els.themeToggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
  els.themeToggle.querySelector(".theme-icon").textContent = light ? "◐" : "☼";
  els.themeToggle.querySelector(".theme-label").textContent = light ? "Dark mode" : "Light mode";
  localStorage.setItem("ct-theme", theme);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function sourceLabel(source) {
  return source.name || source.source_name || source.title || source.url || source.vanity_name;
}

function sourceUrl(source) {
  return source.url || source.index_url || (source.vanity_name ? `https://www.linkedin.com/company/${source.vanity_name}/` : "");
}

function sourceScope(source) {
  return source.competitor || "All configured scope";
}

function confidenceForSignal(signal) {
  if (signal.error || !signal.title) return "low";
  if (signal.source_channel === "press_release") return "high";
  if (["rss", "atom"].includes(signal.captured_via) || signal.source_name === "LinkedIn API") return "high";
  if (signal.source_channel === "linkedin" || signal.captured_via === "google_news") return "medium";
  return "medium";
}

function confidenceLabel(level) {
  return { high: "High", medium: "Medium", low: "Low" }[level] || "Medium";
}

function observedStats(signals, source) {
  const name = source.name || source.source_name;
  const matches = source.discoveryType
    ? signals.filter((signal) => signal.source_name === source.discoveryType)
    : signals.filter((signal) => signal.source_name === name || signal.captured_via === source.captured_via);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const signal of matches) counts[confidenceForSignal(signal)] += 1;
  return { total: matches.length, counts };
}

function renderMetrics(config, signals) {
  const configured = GROUPS.reduce((total, [, key]) => total + (config[key] || []).length, 0) + 2;
  const totalRecords = signals.length;
  const cards = [
    ["Configured references", configured, "Registry entries"],
    ["Observed records", totalRecords, "Latest capture"],
  ];
  els.metrics.innerHTML = cards.map(([label, value, hint]) => `<article class="metric"><p class="label">${label}</p><p class="value">${value}</p><p class="hint">${hint}</p></article>`).join("");
}

function render(config, signals) {
  const query = els.search.value.trim().toLowerCase();
  const sections = GROUPS.map(([title, key, method, policy, level]) => {
    const configuredSources = config[key] || [];
    const discoverySources = key === "rss_feeds"
      ? [
          {
            name: "Google News RSS discovery",
            competitor: `${(config.news_queries || []).length} competitor queries`,
            query: "Search results delivered through Google News RSS; no single direct source URL",
            discoveryType: "Google News RSS",
            confidence: "medium",
          },
          {
            name: "Google News RSS · LinkedIn discovery",
            competitor: `${(config.linkedin_queries || []).length} LinkedIn queries`,
            query: "LinkedIn public-search results delivered through Google News RSS; no single direct source URL",
            discoveryType: "Google News · LinkedIn",
            confidence: "medium",
          },
        ]
      : [];
    const sources = [...configuredSources, ...discoverySources].filter((source) => {
      const haystack = `${sourceLabel(source)} ${sourceScope(source)} ${sourceUrl(source)} ${source.query || ""}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    if (!sources.length) return "";
    const rows = sources.map((source) => {
      const stats = observedStats(signals, source);
      const label = sourceLabel(source);
      const url = sourceUrl(source);
      const rowLevel = source.confidence || level;
      const queryText = source.query ? `<span class="reference-policy">${escapeHtml(source.query)}</span>` : `<span class="reference-policy">${escapeHtml(policy)}</span>`;
      return `<div class="reference-row">
        <div class="reference-name">${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}</div>
        <div class="reference-scope">${escapeHtml(sourceScope(source))}</div>
        <div class="reference-policy">${escapeHtml(method)}<br>${queryText}</div>
        <div><span class="confidence-chip confidence-${rowLevel}">${confidenceLabel(rowLevel)}</span></div>
        <div class="reference-count">${stats.total} observed <small>(${stats.counts.high} high · ${stats.counts.medium} medium · ${stats.counts.low} low content evidence)</small></div>
      </div>`;
    }).join("");
    return `<section class="panel reference-group"><div class="panel-head"><h2>${escapeHtml(title)}</h2><p class="muted">${sources.length} configured</p></div><div class="reference-list"><div class="reference-row header"><span>Reference</span><span>Scope</span><span>Route and confidence policy</span><span>Confidence level</span><span>Latest capture evidence</span></div>${rows}</div></section>`;
  }).join("");
  els.groups.innerHTML = sections || `<p class="reference-empty">No references match “${escapeHtml(query)}”.</p>`;
}

async function boot() {
  const [configRes, rawRes] = await Promise.all([
    fetch("scripts/capture/sources.json", { cache: "no-store" }),
    fetch("data/signals.json", { cache: "no-store" }),
  ]);
  if (!configRes.ok || !rawRes.ok) throw new Error("Could not load the source registry or latest capture.");
  const config = await configRes.json();
  const payload = await rawRes.json();
  const signals = payload.signals || [];
  renderMetrics(config, signals);
  render(config, signals);
  els.meta.textContent = `Payload ${payload.generated_at || "—"} · ${signals.length} public records · ${GROUPS.length} reference sections`;
  els.search.addEventListener("input", () => render(config, signals));
}

setTheme(localStorage.getItem("ct-theme") === "light" ? "light" : "dark");
els.themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
boot().catch((error) => {
  els.groups.innerHTML = `<p class="reference-empty">${escapeHtml(error.message)} Serve this folder over HTTP rather than opening the HTML file directly.</p>`;
});
