const THEMES = [
  ["Airline adoption", /\b(?:selects?|selected|adopts?|adopted|signing for|customer win|welcome .{3,150} to the .{0,35}platform)\b/i],
  ["Connected operations", /\b(?:connect(?:ed)?(?:\s+3\.0)?|messaging|cockpit.{0,30}OCC|dispatcher.{0,30}pilot|unite flight|flight and technical|enhanced awareness)\b/i],
  ["Planning & automation", /\b(?:crew pairing|pairings|netline|automation|optimisation|optimization|network planning)\b/i],
  ["Product developments", /\b(?:release notes|version|new feature|latest release|launches|unveils|introduces|enhances)\b/i],
  ["Customer experience", /\b(?:customer (?:story|statement|testimonial|interview)|working with|day-to-day operations|customer support)\b/i],
  ["Events & outreach", /\b(?:webinar|conference|forum|expo)\b/i],
];

function plainText(value) {
  return String(value || "").normalize("NFKC").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function summarizeActivity(signals, competitorName = (signal) => signal.competitor) {
  const groups = new Map();
  for (const signal of signals) {
    const competitor = competitorName(signal);
    if (!groups.has(competitor)) groups.set(competitor, []);
    groups.get(competitor).push(signal);
  }
  return [...groups].map(([competitor, captured]) => {
    const relevant = captured.filter((signal) => !/\b(?:we.?re hiring|we are hiring|interview experience|open roles|job vacancies|meet .{0,60}our product analyst)\b/i.test(plainText(`${signal.headline} ${signal.summary}`)));
    const unique = new Map();
    for (const signal of [...relevant].sort((first, second) => second.date.localeCompare(first.date))) {
      const key = plainText(signal.headline).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!unique.has(key)) unique.set(key, signal);
    }
    const evidence = [...unique.values()];
    const themes = THEMES.map(([label, pattern], order) => ({
      label,
      order,
      count: evidence.filter((signal) => pattern.test(plainText(`${signal.headline} ${signal.summary}`))).length,
    })).filter((theme) => theme.count).sort((first, second) => second.count - first.count || first.order - second.order).slice(0, 2).map((theme) => theme.label);
    const summary = evidence.length
      ? `Latest: ${plainText(evidence[0].headline)}`
      : "No substantive movement identified in these captures.";
    const latestAIInsight = evidence.find((signal) => plainText(signal.ai_enrichment?.competitive_insight));
    return {
      competitor,
      capturedCount: captured.length,
      themes,
      mainMovement: latestAIInsight
        ? plainText(latestAIInsight.ai_enrichment.competitive_insight)
        : summary,
      summary,
      evidence,
    };
  }).sort((first, second) => second.capturedCount - first.capturedCount || first.competitor.localeCompare(second.competitor));
}