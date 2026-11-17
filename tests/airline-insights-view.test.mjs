import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

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
      const filteredMapTotal = await page.locator("#airlineMapTotal").textContent();
      await toggle.uncheck();
      assert.equal(await count.textContent(), airlines.length.toLocaleString("en-US"));
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
      assert.doesNotMatch(await page.locator("#airlineMapLegend").textContent(), /Blend:|Multi-way ties/);
      for (const gradient of await page.locator("#airlineWorldMap linearGradient").all()) {
        assert.equal(await gradient.locator("stop").count(), 4);
        const offsets = await gradient.locator("stop").evaluateAll((stops) => stops.map((stop) => parseFloat(stop.getAttribute("offset"))));
        assert.equal(offsets[0], 0);
        assert.equal(offsets[3], 100);
        assert.ok(offsets[1] >= 46 && offsets[2] <= 100 && offsets[1] < offsets[2]);
      }
      await japan.focus();
      assert.match(await page.locator("#airlineMapTooltip").textContent(), /: \d+%/);
      assert.doesNotMatch(await page.locator("#airlineMapTooltip").textContent(), /fields recorded|Rest of Asia|Close race|Tied leaders|\d+\/\d+/);
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