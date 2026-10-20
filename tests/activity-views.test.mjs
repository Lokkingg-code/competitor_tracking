import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:8766/index.html";
const payload = JSON.parse(await readFile(new URL("../data/signals.json", import.meta.url), "utf8"));
const activitySummarySnapshot = {
  status: "ready",
  lead: "Fixture synthesis",
  insights: [],
  activity_summaries: payload.competitors.map((competitor) => {
    const signal = payload.signals.find((item) => item.competitor === competitor);
    const evidenceIds = signal ? [signal.id] : [];
    const summary = (period) => ({
      main_movement: `${competitor} ${period} AI movement includes AirAsia.`,
      trend_context: `${competitor} broader Artificial Intelligence and fastjet activity.`,
      evidence_ids: evidenceIds,
      context_evidence_ids: evidenceIds,
      captured_signals: evidenceIds.length,
      linkedin_captures: evidenceIds.length,
    });
    return { competitor, monthly: summary("monthly"), quarterly: summary("quarterly"), yearly: summary("yearly") };
  }),
};

test("overview and activity quick look remain independent of feed filters", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({ time: new Date("2026-09-29T12:00:00Z") });
      await page.route("**/data/signals.json", (route) => route.fulfill({ json: payload }));
      await page.route("**/data/competitive-insights.json", (route) => route.fulfill({ json: activitySummarySnapshot }));
      await page.addInitScript(() => {
        sessionStorage.setItem("ct-matrix-signal-ids", '["cap-bab00bf9c288"]');
        sessionStorage.setItem("ct-matrix-competitor", "Bytron Skybook");
        localStorage.setItem("ct-theme", "light");
      });
      await page.goto(baseUrl);
      await page.waitForSelector(".activity-summary-row");
      assert.equal(await page.locator("#activityPeriodFilter").inputValue(), "monthly");
      assert.deepEqual(await page.locator("#activityPeriodFilter option").evaluateAll((options) => options.map((option) => option.textContent)), ["Monthly · 30 days", "Quarterly · 90 days", "Yearly · 12 months"]);
      assert.equal(await page.locator("#activityWindow").count(), 0);
      assert.deepEqual(await page.locator(".activity-summary-header [role='columnheader']").allTextContents(), ["Competitor", "Monthly · 30 days main movement", "Broader trend · 12 months", "Evidence"]);
      assert.equal(await page.locator("#windowFilter").count(), 0);
      assert.equal(await page.locator("#focusFilter").count(), 0);
      assert.equal(await page.locator("#metrics").count(), 0);
      const expectedLastUpdate = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        timeZone: "UTC", timeZoneName: "short",
      }).format(new Date(payload.generated_at));
      assert.equal(await page.locator("#lastUpdate").textContent(), `Last update: ${expectedLastUpdate}`);
      assert.equal(await page.locator("#insightsHeading").textContent(), "Competitive Intelligence");
      assert.equal(await page.locator(".insight-model-label").count(), 0);
      assert.equal(await page.locator(".activity-summary-row").count(), payload.competitors.length);
      const firstMovement = page.locator(".activity-summary-movement").first();
      assert.match(await firstMovement.textContent(), /monthly AI movement includes AirAsia/);
      assert.ok(await firstMovement.locator(".title-ai").count());
      assert.ok(await firstMovement.locator(".title-airline").filter({ hasText: "AirAsia" }).count());
      await page.locator("#activityPeriodFilter").selectOption("quarterly");
      assert.match(await page.locator(".activity-summary-movement").first().textContent(), /quarterly AI movement includes AirAsia/);
      await page.locator("#activityPeriodFilter").selectOption("yearly");
      assert.match(await page.locator(".activity-summary-movement").first().textContent(), /yearly AI movement includes AirAsia/);
      await page.locator("#activityPeriodFilter").selectOption("monthly");
      assert.ok(await page.locator(".activity-overview").evaluate((element) => element.previousElementSibling.classList.contains("competitive-insights") && element.previousElementSibling.previousElementSibling.classList.contains("heat-panel")));
      const original = await page.locator("#activitySummary").innerHTML();
      for (const [selector, value] of [["#competitorFilter", "IFS"], ["#typeFilter", "customer_win"]]) {
        await page.locator(selector).selectOption(value);
        assert.equal(await page.locator("#activitySummary").innerHTML(), original);
      }
      await page.locator("#searchInput").fill("no-match-validation");
      assert.equal(await page.locator("#activitySummary").innerHTML(), original);
      const evidence = page.locator(".activity-summary-evidence").first();
      const evidenceIds = await evidence.getAttribute("data-activity-evidence");
      const expectedEvidenceCount = JSON.parse(evidenceIds).length;
      await evidence.click();
      assert.equal(await page.locator("#quickLookList .signal-row").count(), expectedEvidenceCount);
      await page.locator("#quickLookClose").click();
      await page.locator(".activity-overview").screenshot({ path: `/tmp/activity-overview-${width}.png` });
      assert.equal(await page.locator(".trend-line-series").count(), 7);
      assert.ok(await page.locator(".trend-point").count() > 0);
      assert.equal(await page.locator(".trend-area").count(), 7);
      assert.equal(await page.locator(".panel-head p").filter({ hasText: "Signal volume by competitor" }).count(), 0);
      const allSourcePoints = await page.locator(".trend-point").count();
      const allSourcesButton = page.locator('[data-chart-source="all"]');
      const linkedinButton = page.locator('[data-chart-source="linkedin"]');
      assert.equal(await allSourcesButton.getAttribute("aria-pressed"), "true");
      await linkedinButton.click();
      const linkedinPointCount = await page.locator(".trend-point").count();
      assert.ok(linkedinPointCount > 0 && linkedinPointCount < allSourcePoints);
      assert.equal(await linkedinButton.getAttribute("aria-pressed"), "true");
      const linkedinPoint = page.locator(".trend-point").first();
      const linkedinCompetitor = await linkedinPoint.getAttribute("data-competitor");
      const linkedinMonth = await linkedinPoint.getAttribute("data-month");
      await linkedinPoint.focus();
      await page.keyboard.press("Enter");
      const expectedLinkedinSignals = payload.signals.filter((signal) => signal.source_channel === "linkedin" && signal.competitor === linkedinCompetitor && signal.date.startsWith(linkedinMonth));
      assert.equal(await page.locator("#quickLookList .signal-row").count(), expectedLinkedinSignals.length);
      await page.locator("#quickLookClose").click();
      await allSourcesButton.click();
      assert.equal(await page.locator(".trend-point").count(), allSourcePoints);
      assert.equal(await allSourcesButton.getAttribute("aria-pressed"), "true");
      await page.locator(".heat-panel").screenshot({ path: `/tmp/activity-trend-${width}.png` });
      const point = page.locator('.trend-point[data-competitor="Bytron Skybook"][data-month="2025-10"]');
      await point.scrollIntoViewIfNeeded();
      await point.hover();
      assert.equal(await page.locator(".trend-tooltip").isVisible(), true);
      assert.equal(await page.locator(".trend-tooltip-name").textContent(), "Bytron Skybook");
      assert.equal(await page.locator(".trend-tooltip-detail").textContent(), "Oct '25 · 2 signals");
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await point.click();
      const expected = payload.signals.filter((signal) => signal.competitor === "Bytron Skybook" && signal.date.startsWith("2025-10"));
      assert.equal(await page.locator("#quickLookList .signal-row").count(), expected.length);
      await page.locator("#quickLookList .signal-row").first().click();
      await page.locator("#quickLook").screenshot({ path: `/tmp/activity-quick-look-${width}.png` });
      assert.ok(await page.locator("#quickLook").evaluate((element) => element.scrollWidth <= element.clientWidth));
      await page.locator("#quickLookBack").click();
      assert.equal(await page.locator("#quickLookList .signal-row").first().evaluate((element) => element === document.activeElement), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#quickLook").isVisible(), false);
      assert.equal(await point.evaluate((element) => element === document.activeElement), true);
      assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore) < 3);
      assert.equal(await page.locator("#searchInput").inputValue(), "no-match-validation");
      assert.equal(await page.locator("#competitorFilter").inputValue(), "IFS");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("keeps equal-count competitor markers visible and independently clickable", async () => {
  const competitors = ["Jeppesen", "Aviobook", "IFS"];
  const tiedPayload = {
    generated_at: "2026-10-16T03:16:42Z",
    lookback_days: 365,
    signals: competitors.map((competitor) => ({
      id: `tie-${competitor.toLowerCase().replaceAll(" ", "-")}`,
      competitor,
      date: "2026-10-08",
      type: "feature_change",
      priority: "medium",
      confidence: 0.9,
      headline: `${competitor} update`,
      summary: `${competitor} reports a product update.`,
      source_channel: "linkedin",
      product_focus: "other",
      sources: [],
    })),
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
    await page.route("**/data/signals.json", (route) => route.fulfill({ json: tiedPayload }));
    await page.goto(baseUrl);
    const points = page.locator('.trend-point[data-month="2026-10"]');
    assert.equal(await points.count(), 3);
    const xPositions = await points.evaluateAll((nodes) => nodes.map((node) => Number(node.querySelector(".trend-marker").getAttribute("cx"))));
    assert.equal(new Set(xPositions).size, 3);

    for (const point of await points.all()) {
      const competitor = await point.getAttribute("data-competitor");
      await point.scrollIntoViewIfNeeded();
      await point.click();
      const quickLookTitle = await page.locator("#quickLookTitle").textContent();
      assert.ok(quickLookTitle.includes(competitor), `${competitor} marker opened "${quickLookTitle}"`);
      await page.locator("#quickLookClose").click();
    }
    await browser.close();
  } finally {
    await browser.close();
  }
});

test("does not label generic aviation phrases as airlines or operators", async () => {
  const cases = [
    {
      id: "generic-commercial-aviation",
      headline: "ForeFlight Airflow Agents Debut For Commercial Aviation",
      summary: "Jeppesen introduces agents for commercial aviation.",
      expected: "N/A",
    },
    {
      id: "codic-aviation-company",
      headline: "Exciting times at Codic! We launched Codic Aviation",
      summary: "Codic has worked with crew planning and Jeppesen systems.",
      expected: "N/A",
    },
    {
      id: "known-airline",
      headline: "fastjet selects EFBOne",
      summary: "fastjet selected the EFB platform.",
      expected: "fastjet",
    },
  ];
  const operatorPayload = {
    generated_at: payload.generated_at,
    lookback_days: 365,
    signals: cases.map((item) => ({
      ...item,
      competitor: "Jeppesen",
      date: "2026-10-14",
      type: "messaging_shift",
      product_focus: "other",
      source_channel: "linkedin",
      sources: [],
    })),
  };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const item of cases) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.route("**/data/signals.json", (route) => route.fulfill({ json: operatorPayload }));
      await page.route("**/data/competitive-insights.json", (route) => route.fulfill({ json: { status: "awaiting_generation", insights: [] } }));
      await page.addInitScript((signalId) => {
        sessionStorage.setItem("ct-matrix-signal-ids", JSON.stringify([signalId]));
      }, item.id);
      await page.goto(baseUrl);
      const card = page.locator(".brief-card").filter({ hasText: "Airline / operator" });
      await card.waitFor();
      assert.equal(await card.locator("p").textContent(), item.expected);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("shows the Codic AI evidence preview without inventing an airline operator", async () => {
  const signal = payload.signals.find((item) => item.id === "cap-0e8e8ea77a5e");
  assert.ok(signal?.ai_brief?.summary);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("**/data/signals.json", (route) => route.fulfill({ json: payload }));
    await page.route("**/data/competitive-insights.json", (route) => route.fulfill({ json: { status: "awaiting_generation", insights: [] } }));
    await page.addInitScript((signalId) => {
      sessionStorage.setItem("ct-matrix-signal-ids", JSON.stringify([signalId]));
    }, signal.id);
    await page.goto(baseUrl);
    await page.locator(".briefing-summary-text").waitFor();
    assert.equal(await page.locator(".briefing-summary-label").textContent(), "AI evidence summary");
    assert.equal(await page.locator(".briefing-summary-text").textContent(), signal.ai_brief.summary);
    const operatorCard = page.locator(".brief-grid .brief-card").filter({ hasText: "Airline / operator" });
    assert.equal(await operatorCard.locator("p").textContent(), "N/A");
  } finally {
    await browser.close();
  }
});

test("uses current AI classification instead of an older enrichment type suggestion", async () => {
  const signal = payload.signals[0];
  const reviewedPayload = {
    ...payload,
    signals: [{
      ...signal,
      type: "messaging_shift",
      analyst_type_review: { from: "implementation", to: "messaging_shift", reason: "Existing customer case study; no new deployment announced." },
      ai_enrichment: { suggested_type: "implementation", type_confidence: 0.85, type_auto_applied: true, original_type: "messaging_shift", suggested_product_focus: "efb", focus_confidence: 0.7 },
      ai_classification: { suggested_type: "messaging_shift", type_confidence: 0.9, suggested_product_focus: "eff", focus_confidence: 1 },
    }],
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/data/signals.json", (route) => route.fulfill({ json: reviewedPayload }));
    await page.route("**/data/competitive-insights.json", (route) => route.fulfill({ json: { status: "awaiting_generation", insights: [] } }));
    await page.addInitScript((signalId) => sessionStorage.setItem("ct-matrix-signal-ids", JSON.stringify([signalId])), signal.id);
    await page.goto(baseUrl);
    assert.ok(await page.locator(".ai-analysis-details").getByText(/Signal type: Messaging shift · 90% confidence · Reviewed from Implementation/).count());
    assert.ok(await page.locator(".ai-analysis-details").getByText(/Product focus: EFF · 100% confidence/).count());
  } finally {
    await browser.close();
  }
});

test("renders dataset-level AI findings with signal evidence links", async () => {
  const signal = payload.signals[0];
  const insightPayload = {
    schema_version: 1,
    status: "ready",
    model: "gemma-4-26b-a4b-it",
    generated_at: "2026-10-16T03:16:42Z",
    window_start: "2025-11-01",
    window_end: "2026-10-16",
    source_signal_count: 160,
    lead: "AI and artificial intelligence product news is increasing across captured feeds.",
    insights: [{
      category: "customer_adoption",
      title: "IFS EFBOne appears in recent airline selections",
      finding: "AirAsia and fastjet are adopting AI-enabled flight operations tools.",
      evidence_ids: [signal.id],
      aviation_context: "fastjet is a low-cost carrier and artificial intelligence is an emerging aviation capability.",
      caveat: "Verify the linked announcement before treating it as a confirmed deployment.",
    }],
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("**/data/signals.json", (route) => route.fulfill({ json: payload }));
    await page.route("**/data/competitive-insights.json", (route) => route.fulfill({ json: insightPayload }));
    await page.goto(baseUrl);
    await page.locator(".insight-row").waitFor();
    assert.equal(await page.locator("#insightLead").textContent(), insightPayload.lead);
    assert.equal(await page.locator(".insight-row h3").textContent(), insightPayload.insights[0].title);
    assert.deepEqual(await page.locator("#insightLead .title-ai").allTextContents(), ["AI", "artificial intelligence"]);
    assert.ok(await page.locator(".insight-row .title-ai").count() >= 2);
    assert.ok(await page.locator(".insight-row .title-airline").filter({ hasText: "AirAsia" }).count());
    assert.ok(await page.locator(".insight-row .title-airline").filter({ hasText: "fastjet" }).count());
    await page.locator(`[data-insight-signal="${signal.id}"]`).click();
    await page.locator("#quickLookBriefing").waitFor({ state: "visible" });
    assert.ok((await page.locator("#quickLookTitle").textContent()).includes(signal.competitor));
  } finally {
    await browser.close();
  }
});

test("renders first-stage briefs ahead of older enrichment without API calls", async () => {
  const signal = payload.signals[0];
  const briefPayload = { ...payload, signals: [{
    ...signal,
    type: "feature_change",
    analyst_product_focus_review: { from: "efb", to: "eff", reason: "Watchlist" },
    ai_classification: { is_ai_related: true, ai_confidence: 0.95 },
    ai_brief: { title: "Jeppesen adds AI, Agentic AI and artificial intelligence tools for AirAsia", summary: "Royal Air Maroc selected AvioBook Flight. The agreement runs for five years." },
    ai_enrichment: { headline_summary: "Older AI title", summary: "Older AI summary" },
  }] };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let apiRequests = 0;
    await page.route("**/data/signals.json", (route) => route.fulfill({ json: briefPayload }));
    await page.route("**/api/**", (route) => {
      apiRequests += 1;
      return route.fulfill({ status: 500 });
    });
    await page.addInitScript((signalId) => {
      sessionStorage.setItem("ct-matrix-signal-ids", JSON.stringify([signalId]));
    }, signal.id);
    await page.goto(baseUrl);
    await page.locator(".briefing-summary-text").waitFor();
    assert.equal(await page.locator("h3").first().textContent(), briefPayload.signals[0].ai_brief.title);
    assert.deepEqual(await page.locator("h3 .title-ai").allTextContents(), ["AI", "Agentic AI", "artificial intelligence"]);
    assert.equal(await page.locator(".title-ai").filter({ hasText: "AirAsia" }).count(), 0);
    assert.equal(await page.locator(".briefing-summary-text").textContent(), briefPayload.signals[0].ai_brief.summary);
    assert.ok(await page.locator(".ai-analysis-details p").filter({ hasText: "Reviewed from EFB" }).count());
    assert.equal(await page.locator(".ai-source-headline").textContent(), `Captured headline: ${signal.headline}`);
    assert.equal(apiRequests, 0);
    assert.ok(await page.locator(".col-type").filter({ hasText: "Feature change | AI" }).count());
  } finally {
    await browser.close();
  }
});

test("renders saved AI enrichment without calling the summary API again", async () => {
  const signal = payload.signals[0];
  const enrichedPayload = {
    ...payload,
    signals: payload.signals.map((item) => item.id === signal.id ? {
      ...item,
      ai_brief: null,
      ai_classification: null,
      analyst_type_review: { from: "customer_win", to: "messaging_shift", reason: "Interview, no new commitment" },
      analyst_product_focus_review: { from: "efb", to: "eff", reason: "Watchlist" },
      ai_enrichment: {
        model: "nvidia/nemotron-3.5-lightning",
        enriched_at: "2026-10-08T00:00:00+00:00",
        headline_summary: "Navblue adds Skywise flight operations intelligence.",
        summary: "First concise sentence. Second concise sentence. Third concise sentence. Fourth sentence should be hidden.",
        announcement_tone: "Positive",
        competitive_insight: "This could improve operations visibility.",
        caveat: "Customer impact remains unverified.",
        suggested_type: "feature_change",
        type_confidence: 0.91,
        type_matches_existing: false,
        type_auto_applied: true,
        original_type: "customer_win",
        suggested_product_focus: "eff",
        focus_confidence: 0.88,
        focus_matches_existing: false,
        focus_auto_applied: true,
        original_product_focus: "other",
        catalog_pricing: { prompt: 0.000000049, completion: 0.00000014 },
      },
    } : item),
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let summaryRequests = 0;
    await page.route("**/data/signals.json", (route) => route.fulfill({ json: enrichedPayload }));
    await page.route("**/data/competitive-insights.json", (route) => route.fulfill({ json: { status: "ready", lead: "", insights: [] } }));
    await page.route("**/api/ai-summary**", (route) => {
      summaryRequests += 1;
      return route.fulfill({ status: 500, body: "Should not be called for saved analyses." });
    });
    await page.addInitScript((signalId) => {
      sessionStorage.setItem("ct-matrix-signal-ids", JSON.stringify([signalId]));
    }, signal.id);

    await page.goto(baseUrl);
    await page.getByText("First concise sentence.").waitFor({ state: "visible" });
    assert.equal(await page.locator("h3").first().textContent(), "Navblue adds Skywise flight operations intelligence.");
    assert.equal(await page.locator(".briefing-summary-text").textContent(), "First concise sentence. Second concise sentence. Third concise sentence.");
    assert.equal(await page.getByText("Fourth sentence should be hidden.").count(), 0);
    assert.equal(await page.locator(".ai-source-headline").textContent(), `Captured headline: ${signal.headline}`);
    assert.equal(await page.locator(".briefing-summary-label").textContent(), "AI evidence summary");
    assert.equal(await page.locator(".ai-summary-result").count(), 0);
    assert.ok(await page.getByText(/Signal type: Feature change.*Reviewed from Customer win/).count());
    assert.ok(await page.getByText(/Product focus: EFF.*Reviewed from EFB/).count());
    assert.ok(await page.locator(".activity-summary-empty").filter({ hasText: "AI period summaries" }).count());
    assert.ok(await page.getByText(/rates per 1M tokens USD: input \$0.049, output \$0.140/).count());
    assert.equal(summaryRequests, 0);
  } finally {
    await browser.close();
  }
});