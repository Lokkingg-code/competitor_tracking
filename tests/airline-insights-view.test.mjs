import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { applyFleetFilter, excludeMainlandChina, excludeNonAirlineEntities } from "../js/airline-fleet-filter.js";
import { normalizeMapRegions, regionalProviderRace, gradientProviders, providerColors } from "../js/airline-provider-map.js";

const baseUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:8766/airline-insights.html";
const snapshot = JSON.parse(await readFile(new URL("../data/airline-insights.json", import.meta.url), "utf8"));

test("fleet toggle updates the whole airline view and preserves its selection", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/data/airline-insights-ai.json", (route) => route.fulfill({ json: {
        snapshot_generated_at: snapshot.generated_at,
        region_scheme: "mainland-china-rest-asia-v2",
        entity_exclusion_version: 1,
        model: "test-model",
        overall: { headline: "Unfiltered AI", observations: ["Unfiltered analysis."], caveat: "Sample." },
        regions: [],
      } }));
      await page.goto(baseUrl);
      const toggle = page.locator("#airlineFleetFilter");
      const count = page.locator("#airlineCount");
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      const airlines = snapshot.airline_profiles.filter((profile) => !["Embraer", "Exchange Income Corporation"].includes(profile.airline));
      const filteredCount = airlines.filter((profile) => profile.fleet_size === null || profile.fleet_size >= 10).length;
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await count.textContent(), filteredCount.toLocaleString("en-US"));
      assert.equal(await page.locator(".airline-ai-badge").textContent(), "Data summary");
      const globalRow = page.locator("[data-global-system-mix]");
      assert.equal(await globalRow.count(), 1);
      assert.equal(await page.locator("#airlineRegionRows tr").count(), 1);
      assert.equal(await page.locator("#airlineRegionSelect").count(), 0);
      assert.equal(await page.locator("#airlineRegionReset").isVisible(), false);
      assert.match(await globalRow.locator("th").textContent(), new RegExp(`${filteredCount} airlines`));
      for (const mode of ["eff", "planning"]) {
        const field = `${mode}_systems`;
        const known = airlines.filter((profile) => (profile.fleet_size === null || profile.fleet_size >= 10) && profile[field].length).length;
        const cell = globalRow.locator(mode === "eff" ? "td:nth-child(2)" : "td:nth-child(3)");
        assert.match(await cell.locator(".airline-global-coverage").textContent(), new RegExp(`^${known} known$`));
        const buttons = cell.locator("[data-system-name]");
        const expectedNames = new Set(airlines.filter((profile) => profile.fleet_size === null || profile.fleet_size >= 10).flatMap((profile) => profile[field]));
        assert.deepEqual(new Set(await buttons.evaluateAll((items) => items.map((item) => item.dataset.systemName))), expectedNames);
        const shades = await buttons.evaluateAll((items) => items.map((item) => parseFloat(item.style.getPropertyValue("--rank-tint"))));
        assert.ok(shades.every((shade, index) => !index || shade < shades[index - 1]));
        if (shades.length > 3) {
          assert.ok(shades[3] > 0 && shades[3] < shades[2]);
          assert.notEqual(await buttons.nth(2).evaluate((item) => getComputedStyle(item).backgroundColor), await buttons.nth(3).evaluate((item) => getComputedStyle(item).backgroundColor));
        }
        assert.equal(await buttons.first().getAttribute("data-system-region"), "all");
        const name = await buttons.first().getAttribute("data-system-name");
        const matches = airlines.filter((profile) => (profile.fleet_size === null || profile.fleet_size >= 10) && profile[field].includes(name)).length;
        assert.equal(Number(await buttons.first().locator(".airline-mix-count").textContent()), matches);
        await buttons.first().click();
        assert.equal(await page.locator("#airlineQuickLookRows tr").count(), matches);
        await page.locator("#airlineQuickLookClose").click();
      }
      await page.locator('[data-country="Japan"]').dispatchEvent("click");
      assert.equal(await globalRow.count(), 0);
      assert.ok(await page.locator("#airlineRegionRows tr").count() > 1);
      assert.equal(await page.locator("#airlineRegionReset").isVisible(), true);
      assert.equal(await page.locator("#airlineRegionRows tr").first().locator("[data-region-select]").getAttribute("data-region-select"), "Rest of Asia & Pacific");
      assert.equal(await page.locator("#airlineRegionRows tr").first().getAttribute("class"), "is-selected");
      assert.ok(await page.locator("#airlineRegionRows tr").first().locator('td:nth-child(2) [data-system-name]').count() <= 3);
      await page.locator('[data-region-select="Europe & Central Asia"]').click();
      assert.equal(await page.locator("#airlineRegionRows tr").first().locator("[data-region-select]").getAttribute("data-region-select"), "Europe & Central Asia");
      await page.locator("#airlineRegionReset").click();
      assert.equal(await globalRow.count(), 1);
      assert.equal(await page.locator("#airlineRegionRows tr").count(), 1);
      assert.equal(await page.locator("#airlineRegionReset").isVisible(), false);
      const filteredMapTotal = await page.locator("#airlineMapTotal").textContent();
      await toggle.uncheck();
      assert.equal(await count.textContent(), airlines.length.toLocaleString("en-US"));
      assert.match(await globalRow.locator("th").textContent(), new RegExp(`${airlines.length} airlines`));
      for (const mode of ["eff", "planning"]) {
        const expectedNames = new Set(airlines.flatMap((profile) => profile[`${mode}_systems`]));
        const buttons = globalRow.locator(`[data-system-mode="${mode}"]`);
        assert.deepEqual(new Set(await buttons.evaluateAll((items) => items.map((item) => item.dataset.systemName))), expectedNames);
      }
      assert.match(await page.locator(".airline-ai-badge").textContent(), /AI synthesis/);
      assert.notEqual(await page.locator("#airlineMapTotal").textContent(), filteredMapTotal);
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await count.textContent(), airlines.length.toLocaleString("en-US"));
      await page.locator("[data-profile-dimension=fleet]").click();
      assert.match(await page.locator("#airlineProfileNote").textContent(), /Valid fleet sizes/);
      assert.match(await page.locator("#airlineProfileRows").textContent(), /Small · 1–50/);
      assert.doesNotMatch(await page.locator("#airlineProfileRows").textContent(), /Check value|Unspecified/);
      assert.equal(await count.textContent(), airlines.length.toLocaleString("en-US"));
      await toggle.check();
      assert.equal(await count.textContent(), filteredCount.toLocaleString("en-US"));
      assert.match(await page.locator("#airlineProfileRows").textContent(), /Small · 10–50/);
      assert.doesNotMatch(await page.locator("#airlineProfileRows").textContent(), /Check value|Unspecified/);
      await page.locator('[data-airline-system="planning"]').click();
      assert.doesNotMatch(await page.locator("#airlineProfileRows").textContent(), /Check value|Unspecified/);
      await page.locator('[data-airline-map-metric="eff"]').click();
      assert.match(await page.locator("#airlineMapSummary").textContent(), /providers by region/);
      const china = page.locator('[data-country="China"]');
      assert.equal(await china.getAttribute("data-region"), "Mainland China");
      const japan = page.locator('[data-country="Japan"]');
      assert.equal(await japan.getAttribute("data-region"), "Rest of Asia & Pacific");
      assert.equal(await page.locator('[data-country="India"]').getAttribute("data-region"), "Rest of Asia & Pacific");
      for (const name of ["Russia", "Fiji", "United States of America"]) {
        const parts = page.locator(`[data-country="${name}"] path`);
        assert.ok(await parts.count() > 1, `${name} should have independently rendered landmasses`);
        const bounds = await parts.evaluateAll((paths) => paths.map((path) => path.getBBox().width));
        assert.ok(Math.max(...bounds) < 800, `${name} should not stretch a landmass gradient across the world map`);
        const fills = await parts.evaluateAll((paths) => paths.map((path) => path.getAttribute("fill")));
        assert.ok(fills.every((fill) => fill === fills[0]), `${name} landmasses should use the same regional colours`);
      }
      assert.equal(await page.locator("#airlineWorldMap pattern").count(), 0);
      assert.equal(await page.locator("#airlineMapComparison").count(), 0);
      assert.ok(await page.locator("#airlineWorldMap linearGradient").count() > 0);
      const filteredSnapshot = applyFleetFilter(normalizeMapRegions(excludeNonAirlineEntities(snapshot)));
      const paperInGradient = filteredSnapshot.region_names.some((region) => {
        const race = regionalProviderRace(filteredSnapshot.country_segments.filter((cell) => cell.region === region), "eff");
        return region !== "Unmapped" && gradientProviders(race).some((provider) => provider.name === "Paper");
      });
      if (paperInGradient) {
        assert.match(await page.locator("#airlineMapLegend").textContent(), /Paper/);
        assert.ok(await page.locator('#airlineWorldMap linearGradient stop[stop-color="#6d7178"]').count() > 0);
      }
      assert.doesNotMatch(await page.locator("#airlineMapLegend").textContent(), /Blend:|Multi-way ties|Insufficient evidence/);
      for (const gradient of await page.locator("#airlineWorldMap linearGradient").all()) {
        assert.ok(await gradient.locator("stop").count() >= 4);
        const offsets = await gradient.locator("stop").evaluateAll((stops) => stops.map((stop) => parseFloat(stop.getAttribute("offset"))));
        assert.equal(offsets[0], 0);
        assert.equal(offsets.at(-1), 100);
        assert.ok(offsets.every((offset, index) => !index || offset >= offsets[index - 1]));
      }
      const northAfricaRace = regionalProviderRace(filteredSnapshot.country_segments.filter((cell) => cell.region === "Middle East & North Africa"), "eff");
      const northAfricaProviders = gradientProviders(northAfricaRace);
      if (northAfricaProviders.length >= 3 && northAfricaProviders.some((provider) => provider.name === "Paper")) {
        const fill = await page.locator('[data-country="Egypt"] path').first().getAttribute("fill");
        const gradientId = fill.match(/^url\(#(.+)\)$/)?.[1];
        assert.ok(gradientId);
        const stopColors = await page.locator(`#${gradientId} stop`).evaluateAll((stops) => stops.map((stop) => stop.getAttribute("stop-color")));
        const colors = providerColors(filteredSnapshot);
        for (const provider of northAfricaProviders) assert.ok(stopColors.includes(colors.get(provider.name)), `${provider.name} should appear in the North Africa gradient`);
      }
      await japan.focus();
      assert.match(await page.locator("#airlineMapTooltip").textContent(), /: \d+%/);
      assert.doesNotMatch(await page.locator("#airlineMapTooltip").textContent(), /fields recorded|Rest of Asia|Close race|Tied leaders|\d+\/\d+/);
      await japan.dispatchEvent("click");
      assert.equal(await page.locator("#airlineRegionRows tr").first().locator("[data-region-select]").getAttribute("data-region-select"), "Rest of Asia & Pacific");
      assert.equal(await globalRow.count(), 0);
      await page.locator("#airlineRegionReset").click();
      assert.equal(await globalRow.count(), 1);
      assert.equal(await page.locator("#airlineRegionRows tr").count(), 1);
      await page.locator('[data-airline-map-metric="planning"]').click();
      assert.match(await page.locator("#airlineMapSummary").textContent(), /Flight planning providers/);
      await page.locator(".airline-map-section").screenshot({ path: `/tmp/airline-provider-map-${width}.png` });
      await toggle.uncheck();
      assert.equal(await count.textContent(), airlines.length.toLocaleString("en-US"));
      await page.locator('[data-airline-map-metric="airlines"]').click();
      assert.equal(await page.locator("#airlineWorldMap linearGradient").count(), 0);
      assert.equal(await page.locator("#airlineWorldMap pattern").count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("global mix includes an unmapped airline with a recorded system", async () => {
  const fixture = structuredClone(snapshot);
  const profile = { airline: "Unmapped Fixture Air", country: "Fixtureland", region: "Unmapped", airline_type: "Airline", fleet_band: "Small · 1–50", fleet_size: 20, eff_systems: ["AvioBook"], planning_systems: [] };
  fixture.airline_profiles.push(profile);
  fixture.country_segments.push({ country: profile.country, map_name: null, region: profile.region, airline_type: profile.airline_type, fleet_band: profile.fleet_band, airlines: 1, fleet_values_recorded: 1, fleet_known: 1, fleet_sum: 20, fleet_outliers: 0, eff_known: 1, eff_no_vendor: 0, eff_systems: [{ name: "AvioBook", count: 1 }], planning_known: 0, planning_systems: [] });
  fixture.unique_airline_count += 1;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    const page = await browser.newPage();
    await page.route("**/data/airline-insights.json", (route) => route.fulfill({ json: fixture }));
    await page.goto(baseUrl);
    await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
    const eligible = fixture.airline_profiles.filter((item) => !["Embraer", "Exchange Income Corporation"].includes(item.airline) && (item.fleet_size === null || item.fleet_size >= 10));
    const expected = eligible.filter((item) => item.eff_systems.includes("AvioBook")).length;
    const button = page.locator('[data-global-system-mix] [data-system-mode="eff"][data-system-name="AvioBook"]');
    assert.equal(Number(await button.locator(".airline-mix-count").textContent()), expected);
    await button.click();
    assert.equal(await page.locator("#airlineQuickLookRows tr").count(), expected);
    assert.ok(await page.locator("#airlineQuickLookRows tr").filter({ hasText: profile.airline }).count());
  } finally {
    await browser.close();
  }
});

test("Mainland China global filter composes with the fleet filter and persists", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route("**/data/airline-insights-ai.json", (route) => route.fulfill({ json: {
        snapshot_generated_at: snapshot.generated_at,
        region_scheme: "mainland-china-rest-asia-v2",
        entity_exclusion_version: 1,
        model: "test-model",
        overall: { headline: "Previous population", observations: ["Previous analysis."], caveat: "Sample." },
        regions: [],
      } }));
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      const chinaToggle = page.locator("#airlineChinaFilter");
      const fleetToggle = page.locator("#airlineFleetFilter");
      const count = page.locator("#airlineCount");
      const normalized = normalizeMapRegions(excludeNonAirlineEntities(snapshot));
      const eligible = normalized.airline_profiles.filter((profile) => profile.fleet_size === null || profile.fleet_size >= 10);
      const eligibleChinaCount = eligible.filter((profile) => profile.region === "Mainland China").length;
      const allChinaCount = normalized.airline_profiles.filter((profile) => profile.region === "Mainland China").length;
      assert.equal(await chinaToggle.isChecked(), false);
      assert.equal(await count.textContent(), String(eligible.length));
      assert.doesNotMatch(await page.locator("#airlineCountNote").textContent(), /Unknown fleet sizes are included/);
      await chinaToggle.check();
      assert.equal(await count.textContent(), String(eligible.length - eligibleChinaCount));
      assert.match(await page.locator("#airlineCountNote").textContent(), /Mainland China excluded/);
      assert.equal(await page.locator('#airlineProviderRegions [data-footprint-name="Mainland China"]').count(), 0);
      assert.equal(await page.locator(".airline-ai-badge").textContent(), "Data summary");
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      assert.equal(await chinaToggle.isChecked(), true);
      assert.equal(await count.textContent(), String(eligible.length - eligibleChinaCount));
      await fleetToggle.uncheck();
      assert.equal(await count.textContent(), String(normalized.airline_profiles.length - allChinaCount));
      await chinaToggle.uncheck();
      assert.equal(await count.textContent(), String(normalized.airline_profiles.length));
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("conference history hides zero-attendee rows unless Show all is enabled", async () => {
  const fixture = structuredClone(snapshot);
  const eligible = fixture.airline_profiles.find((item) => item.fleet_size >= 10 && !["Embraer", "Exchange Income Corporation"].includes(item.airline));
  const small = fixture.airline_profiles.find((item) => item.fleet_size !== null && item.fleet_size < 10);
  assert.ok(eligible && small);
  fixture.conferences = [
    { name: "Linked conference", start_date: "2026-01-01", location: "Montreal", region: "North America", attending_airlines: [eligible.airline] },
    { name: "No attendees", start_date: "2026-01-02", location: "Montreal", region: "North America", attending_airlines: [] },
    { name: "Small fleet conference", start_date: "2026-01-03", location: "Montreal", region: "North America", attending_airlines: [small.airline] },
    { name: "Asia empty conference", start_date: "2026-01-04", location: "Bangkok", region: "East Asia & Pacific", attending_airlines: [] },
  ];
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route("**/data/airline-insights.json", (route) => route.fulfill({ json: fixture }));
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      const rows = page.locator("#conferenceRows tr");
      const showAll = page.locator("#conferenceShowAll");
      assert.equal(await showAll.isChecked(), false);
      assert.equal(await rows.count(), 1);
      assert.match(await rows.textContent(), /Linked conference/);
      assert.equal(await page.locator("#conferenceHistoryNote").count(), 0);
      await rows.locator('[data-conference-name="Linked conference"]').click();
      assert.match(await page.locator("#airlineQuickLookTitle").textContent(), /Linked conference/);
      assert.ok((await page.locator("#airlineQuickLookRows").textContent()).includes(eligible.airline));
      await page.locator("#airlineQuickLookClose").click();
      await showAll.check();
      assert.equal(await rows.count(), 4);
      assert.match(await rows.allTextContents().then((items) => items.join(" ")), /No attendees/);
      await page.locator('[data-country="Japan"]').dispatchEvent("click");
      assert.equal(await rows.count(), 1);
      assert.match(await rows.textContent(), /Asia empty conference/);
      await showAll.uncheck();
      assert.match(await rows.textContent(), /No conferences with recorded attendees/);
      await page.locator("#airlineRegionReset").click();
      assert.equal(await rows.count(), 1);
      await page.locator("#airlineFleetFilter").uncheck();
      assert.equal(await rows.count(), 2);
      assert.match(await rows.allTextContents().then((items) => items.join(" ")), /Small fleet conference/);
      await page.locator("#airlineFleetFilter").check();
      assert.equal(await rows.count(), 1);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("provider footprint respects region and fleet filters and opens matching airlines", async () => {
  const fixture = structuredClone(snapshot);
  const additions = [
    { airline: "Fixture North One", country: "Canada", region: "North America", airline_type: "Fixture carrier", fleet_band: "Medium · 51–150", fleet_size: 60, eff_systems: ["FixtureCo", "Other"], planning_systems: ["FixturePlanner"] },
    { airline: "Fixture North Two", country: "Canada", region: "North America", airline_type: "Fixture carrier", fleet_band: "Medium · 51–150", fleet_size: 65, eff_systems: ["FixtureCo"], planning_systems: [] },
    { airline: "Fixture Europe", country: "France", region: "Europe & Central Asia", airline_type: "Fixture carrier", fleet_band: "Small · 1–50", fleet_size: 20, eff_systems: ["FixtureCo"], planning_systems: [] },
    { airline: "Fixture Small", country: "Canada", region: "North America", airline_type: "Fixture carrier", fleet_band: "Small · 1–50", fleet_size: 9, eff_systems: ["FixtureCo"], planning_systems: [] },
    { airline: "Fixture Unknown", country: "Japan", region: "East Asia & Pacific", airline_type: "No-data carrier", fleet_band: "Small · 1–50", fleet_size: 20, eff_systems: [], planning_systems: [] },
  ];
  for (const profile of additions) {
    fixture.airline_profiles.push(profile);
    fixture.country_segments.push({ country: profile.country, map_name: profile.country, region: profile.region, airline_type: profile.airline_type, fleet_band: profile.fleet_band, airlines: 1, fleet_values_recorded: 1, fleet_known: 1, fleet_sum: profile.fleet_size, fleet_outliers: 0, eff_known: Number(profile.eff_systems.length > 0), eff_no_vendor: 0, eff_systems: profile.eff_systems.map((name) => ({ name, count: 1 })), planning_known: profile.planning_systems.length, planning_systems: profile.planning_systems.map((name) => ({ name, count: 1 })) });
  }
  fixture.unique_airline_count += additions.length;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 800, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route("**/data/airline-insights.json", (route) => route.fulfill({ json: fixture }));
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      assert.equal(await page.locator(".airline-provider-section").evaluate((element) => element.nextElementSibling.nextElementSibling.classList.contains("airline-conference-section")), true);
      await page.locator("#airlineProviderSelect").selectOption("FixtureCo");
      const systemBounds = await page.locator("[data-provider-mode]").first().evaluate((element) => element.closest(".airline-profile-control").getBoundingClientRect().toJSON());
      const providerBounds = await page.locator("#airlineProviderSelect").evaluate((element) => element.closest("label").getBoundingClientRect().toJSON());
      assert.ok(providerBounds.top >= systemBounds.bottom, "Provider selector should sit below the System control");
      assert.ok(Math.abs(providerBounds.left - systemBounds.left) < 2, "Provider selector should align with the System control");
      assert.match(await page.locator("#airlineProviderScope").textContent(), /Global · 3 selections/);
      assert.equal(await page.locator("#airlineProviderPairedHeading").textContent(), "Corresponding flight-planning systems");
      assert.match(await page.locator("#airlineProviderPairedNote").textContent(), /1 of 3 matched airlines have flight-planning recorded; 2 unknown/);
      assert.deepEqual(await page.locator("#airlineProviderPairedSystems [data-paired-system]").evaluateAll((buttons) => buttons.map((button) => [button.dataset.pairedSystem, button.querySelector(".airline-footprint-count").textContent])), [["FixturePlanner", "1/1 · 100%"]]);
      await page.locator('#airlineProviderPairedSystems [data-paired-system="FixturePlanner"]').click();
      assert.equal(await page.locator("#airlineQuickLookRows tr").count(), 1);
      assert.ok((await page.locator("#airlineQuickLookRows").textContent()).includes("Fixture North One"));
      assert.match(await page.locator("#airlineQuickLookNote").textContent(), /these recorded selections/);
      await page.locator("#airlineQuickLookClose").click();
      assert.equal(await page.locator(".airline-provider-section").evaluate((element) => element.scrollWidth > element.clientWidth), false);
      assert.equal(await page.locator(".airline-footprint-row").evaluateAll((rows) => rows.some((row) => {
        const name = row.querySelector(".airline-footprint-name").getBoundingClientRect();
        const track = row.querySelector(".airline-footprint-track").getBoundingClientRect();
        const count = row.querySelector(".airline-footprint-count").getBoundingClientRect();
        return name.right > track.left + 1 || track.right > count.left + 1;
      })), false);
      const noData = page.locator('#airlineProviderTypes [data-footprint-name="No-data carrier"]');
      assert.match(await noData.textContent(), /No data/);
      assert.equal(await noData.isDisabled(), true);
      assert.match(await noData.getAttribute("aria-label"), /no recorded fields/);
      const northAmerica = page.locator('#airlineProviderRegions [data-footprint-name="North America"]');
      const filtered = applyFleetFilter(normalizeMapRegions(excludeNonAirlineEntities(fixture)));
      const known = filtered.airline_profiles.filter((profile) => profile.region === "North America" && profile.eff_systems.length).length;
      assert.equal(await northAmerica.locator(".airline-footprint-count").textContent(), `2/${known} · ${Math.round(2 / known * 100)}%`);
      const carrier = page.locator('#airlineProviderTypes [data-footprint-name="Fixture carrier"]');
      assert.match(await carrier.textContent(), /n<5/);
      assert.match(await carrier.getAttribute("aria-label"), /small sample/);
      await northAmerica.click();
      assert.equal(await page.locator("#airlineQuickLookRows tr").count(), 2);
      assert.match(await page.locator("#airlineQuickLookRows").textContent(), /Fixture North One/);
      assert.doesNotMatch(await page.locator("#airlineQuickLookRows").textContent(), /Fixture Europe|Fixture Small/);
      await page.locator("#airlineQuickLookClose").click();
      await page.locator('[data-country="Canada"]').dispatchEvent("click");
      assert.equal(await page.locator("#airlineProviderSelect").inputValue(), "FixtureCo");
      assert.match(await page.locator("#airlineProviderScope").textContent(), /North America · 2 selections/);
      await page.locator("#airlineFleetFilter").uncheck();
      assert.match(await page.locator("#airlineProviderScope").textContent(), /North America · 3 selections/);
      await page.locator('[data-provider-mode="planning"]').click();
      assert.equal(await page.locator("#airlineProviderPairedHeading").textContent(), "Corresponding EFF systems");
      await page.locator("#airlineProviderSelect").selectOption("FixturePlanner");
      assert.match(await page.locator("#airlineProviderScope").textContent(), /North America · 1 selection ·/);
      await page.locator('[data-country="Japan"]').dispatchEvent("click");
      assert.equal(await page.locator("#airlineProviderSelect").inputValue(), "FixturePlanner");
      assert.match(await page.locator("#airlineProviderScope").textContent(), /Rest of Asia & Pacific · 0 selections/);
      assert.match(await page.locator("#airlineProviderInsight").textContent(), /No recorded selections/);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});