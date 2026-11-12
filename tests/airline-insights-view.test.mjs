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
        model: "test-model",
        overall: { headline: "Unfiltered AI", observations: ["Unfiltered analysis."], caveat: "Sample." },
        regions: [],
      } }));
      await page.goto(baseUrl);
      const toggle = page.locator("#airlineFleetFilter");
      const count = page.locator("#airlineCount");
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      const filteredCount = snapshot.airline_profiles.filter((profile) => profile.fleet_size === null || profile.fleet_size >= 10).length;
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await count.textContent(), filteredCount.toLocaleString("en-US"));
      assert.equal(await page.locator(".airline-ai-badge").textContent(), "Data summary");
      const filteredMapTotal = await page.locator("#airlineMapTotal").textContent();
      await toggle.uncheck();
      assert.equal(await count.textContent(), snapshot.unique_airline_count.toLocaleString("en-US"));
      assert.match(await page.locator(".airline-ai-badge").textContent(), /AI synthesis/);
      assert.notEqual(await page.locator("#airlineMapTotal").textContent(), filteredMapTotal);
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await count.textContent(), snapshot.unique_airline_count.toLocaleString("en-US"));
      await page.locator("[data-profile-dimension=fleet]").click();
      assert.match(await page.locator("#airlineProfileRows").textContent(), /Small · 1–50/);
      await toggle.check();
      assert.equal(await count.textContent(), filteredCount.toLocaleString("en-US"));
      assert.match(await page.locator("#airlineProfileRows").textContent(), /Small · 10–50/);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});