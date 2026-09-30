import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:8766/index.html";
const payload = JSON.parse(await readFile(new URL("../data/signals.json", import.meta.url), "utf8"));

test("overview and activity quick look remain independent of feed filters", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({ time: new Date("2026-09-29T12:00:00Z") });
      await page.route("**/data/signals.json", (route) => route.fulfill({ json: payload }));
      await page.addInitScript(() => {
        sessionStorage.setItem("ct-matrix-signal-ids", '["cap-bab00bf9c288"]');
        sessionStorage.setItem("ct-matrix-competitor", "Bytron Skybook");
        localStorage.setItem("ct-theme", "light");
      });
      await page.goto(baseUrl);
      await page.waitForSelector(".activity-group");
      assert.equal(await page.locator("#activityWindow").inputValue(), "30");
      assert.deepEqual(await page.locator("#activityWindow option").allTextContents(), await page.locator("#windowFilter option").allTextContents());
      assert.ok(await page.locator(".activity-group").count() > 1);
      assert.ok(await page.locator(".activity-overview").evaluate((element) => element.previousElementSibling.classList.contains("heat-panel")));
      const original = await page.locator("#activitySummary").innerHTML();
      for (const [selector, value] of [["#competitorFilter", "IFS"], ["#windowFilter", "7"], ["#typeFilter", "customer_win"], ["#focusFilter", "eff"]]) {
        await page.locator(selector).selectOption(value);
        assert.equal(await page.locator("#activitySummary").innerHTML(), original);
      }
      await page.locator("#searchInput").fill("no-match-validation");
      assert.equal(await page.locator("#activitySummary").innerHTML(), original);
      for (const days of [7, 14, 30, 90, 180, 365]) {
        await page.locator("#activityWindow").selectOption(String(days));
        const cutoff = new Date("2026-09-29T00:00:00Z");
        cutoff.setUTCDate(cutoff.getUTCDate() - days);
        const count = payload.signals.filter((signal) => new Date(signal.date) >= cutoff && new Date(signal.date) <= new Date("2026-09-29T12:00:00Z")).length;
        assert.ok((await page.locator("#activityPeriod").textContent()).includes(`${count} captured signals`));
      }
      await page.locator("#activityWindow").selectOption("30");
      const group = page.locator(".activity-group").first();
      await group.locator("summary").click();
      const evidence = group.locator(".compact-signals");
      const groupBox = await group.boundingBox();
      const evidenceBox = await evidence.boundingBox();
      assert.ok(evidenceBox.width >= groupBox.width - 2);
      await evidence.locator("button").first().click();
      assert.equal(await page.locator("#quickLookBriefing").isVisible(), true);
      await page.locator("#quickLookBack").click();
      assert.equal(await page.locator("#quickLookList").isVisible(), true);
      await page.locator("#quickLookClose").click();
      assert.equal(await group.getAttribute("open"), "");
      await page.locator(".activity-overview").screenshot({ path: `/tmp/activity-overview-${width}.png` });
      const cell = page.locator('.heat-cell[data-competitor="Bytron Skybook"][data-month="2025-10"]');
      await cell.scrollIntoViewIfNeeded();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await cell.click();
      const expected = payload.signals.filter((signal) => signal.competitor === "Bytron Skybook" && signal.date.startsWith("2025-10"));
      assert.equal(await page.locator("#quickLookList .signal-row").count(), expected.length);
      await page.locator("#quickLookList .signal-row").first().click();
      await page.locator("#quickLook").screenshot({ path: `/tmp/activity-quick-look-${width}.png` });
      assert.ok(await page.locator("#quickLook").evaluate((element) => element.scrollWidth <= element.clientWidth));
      await page.locator("#quickLookBack").click();
      assert.equal(await page.locator("#quickLookList .signal-row").first().evaluate((element) => element === document.activeElement), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#quickLook").isVisible(), false);
      assert.equal(await cell.evaluate((element) => element === document.activeElement), true);
      assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore) < 3);
      assert.equal(await page.locator("#searchInput").inputValue(), "no-match-validation");
      assert.equal(await page.locator("#competitorFilter").inputValue(), "IFS");
      assert.equal(await page.locator("#windowFilter").inputValue(), "7");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});