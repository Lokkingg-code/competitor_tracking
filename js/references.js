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
  return source.url || source.index_url || (source.vanity_name ? `https://www.linkedin.com/company/${source.vanity_name}/posts/` : "");
}

function sourceScope(source) {
  return source.scope || source.competitor || "All configured scope";
}

function confidenceLabel(level) {
  return { high: "High", medium: "Medium", low: "Low" }[level] || "Medium";
}

function renderMetrics(config) {
  const configured = GROUPS.reduce((total, [, key]) => total + (config[key] || []).length, 0) + 2;
  const cards = [["Configured references", configured, "Registry entries"]];
  els.metrics.innerHTML = cards.map(([label, value, hint]) => `<article class="metric"><p class="label">${label}</p><p class="value">${value}</p><p class="hint">${hint}</p></article>`).join("");
}

function render(config) {
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
      const label = sourceLabel(source);
      const url = sourceUrl(source);
      const rowLevel = source.confidence || level;
      const queryText = source.query ? `<span class="reference-policy">${escapeHtml(source.query)}</span>` : `<span class="reference-policy">${escapeHtml(policy)}</span>`;
      return `<div class="reference-row">
        <div class="reference-name">${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}</div>
        <div class="reference-scope">${escapeHtml(sourceScope(source))}</div>
        <div class="reference-policy">${escapeHtml(method)}<br>${queryText}</div>
        <div><span class="confidence-chip confidence-${rowLevel}">${confidenceLabel(rowLevel)}</span></div>
      </div>`;
    }).join("");
    return `<section class="panel reference-group"><div class="panel-head"><h2>${escapeHtml(title)}</h2><p class="muted">${sources.length} configured</p></div><div class="reference-list"><div class="reference-row header"><span>Reference</span><span>Scope</span><span>Route and confidence policy</span><span>Confidence level</span></div>${rows}</div></section>`;
  }).join("");
  els.groups.innerHTML = sections || `<p class="reference-empty">No references match “${escapeHtml(query)}”.</p>`;
}

async function boot() {
  const configRes = await fetch("scripts/capture/sources.json", { cache: "no-store" });
  if (!configRes.ok) throw new Error("Could not load the source registry.");
  const config = await configRes.json();
  renderMetrics(config);
  render(config);
  els.meta.textContent = `${GROUPS.length} reference sections · Source registry configuration`;
  els.search.addEventListener("input", () => render(config));
}

setTheme(localStorage.getItem("ct-theme") === "light" ? "light" : "dark");
els.themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
boot().catch((error) => {
  els.groups.innerHTML = `<p class="reference-empty">${escapeHtml(error.message)} Serve this folder over HTTP rather than opening the HTML file directly.</p>`;
});
