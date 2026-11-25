import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:8766/";
const pages = ["index.html", "matrix.html", "references.html", "airline-insights.html"];

test("theme controls animate consistently across dashboard pages", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const path of pages) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("ct-theme", "light");
        const original = document.startViewTransition;
        window.themeTransitionCalls = 0;
        if (original) document.startViewTransition = function (callback) {
          window.themeTransitionCalls += 1;
          window.lastThemeTransition = original.call(document, callback);
          window.lastThemeTransition.ready.then(() => {
            const style = getComputedStyle(document.documentElement, "::view-transition-new(root)");
            window.themeAnimationName = style.animationName;
            window.themeAnimationClip = style.clipPath;
          }).catch(() => {});
          return window.lastThemeTransition;
        };
      });
      await page.goto(new URL(path, baseUrl).href);
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      const button = page.locator("#themeToggle");
      await button.click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      assert.equal(await button.getAttribute("aria-label"), "Switch to light mode");
      assert.equal(await page.evaluate(() => localStorage.getItem("ct-theme")), "dark");
      if (await page.evaluate(() => Boolean(document.startViewTransition))) {
        await page.evaluate(() => window.lastThemeTransition.finished);
        assert.equal(await page.evaluate(() => window.themeTransitionCalls), 1);
        assert.equal(await page.evaluate(() => window.themeAnimationName), "theme-reveal");
        assert.match(await page.evaluate(() => window.themeAnimationClip), /^circle\(/);
      }
      await button.click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      assert.equal(await button.getAttribute("aria-label"), "Switch to dark mode");
      assert.equal(await page.evaluate(() => localStorage.getItem("ct-theme")), "light");
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("rapid theme clicks restore the starting theme", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: "no-preference" });
    await page.addInitScript(() => localStorage.setItem("ct-theme", "light"));
    await page.goto(new URL("airline-insights.html", baseUrl).href);
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    const result = await page.evaluate(async () => {
      const original = document.startViewTransition;
      const transitions = [];
      if (original) document.startViewTransition = function (callback) {
        const transition = original.call(document, callback);
        transitions.push(transition.finished.catch(() => {}));
        return transition;
      };
      const button = document.querySelector("#themeToggle");
      button.click();
      button.click();
      await Promise.all(transitions);
      return { theme: document.documentElement.dataset.theme, saved: localStorage.getItem("ct-theme") };
    });
    assert.deepEqual(result, { theme: "light", saved: "light" });
  } finally {
    await browser.close();
  }
});

test("theme changes immediately with reduced motion or without view-transition support", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const mode of ["reduced", "unsupported"]) {
      const page = await browser.newPage({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
      await page.addInitScript((disableTransitions) => {
        localStorage.setItem("ct-theme", "light");
        window.themeTransitionCalls = 0;
        if (disableTransitions) document.startViewTransition = undefined;
        else document.startViewTransition = () => { window.themeTransitionCalls += 1; throw new Error("Unexpected animation"); };
      }, mode === "unsupported");
      await page.goto(new URL("airline-insights.html", baseUrl).href);
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.locator("#themeToggle").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      assert.equal(await page.evaluate(() => window.themeTransitionCalls), 0);
      assert.equal(await page.locator("#themeToggle").getAttribute("aria-label"), "Switch to light mode");
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("KPI counters and targeting accents respect motion preferences without shifting layout", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 800, 390]) {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
        await page.addInitScript(() => {
          localStorage.setItem("ct-theme", "light");
          localStorage.setItem("ct-airline-fleet-filter", "on");
          localStorage.removeItem("ct-airline-exclude-mainland-china");
        });
        await page.goto(new URL("airline-insights.html", baseUrl).href);
        await page.waitForFunction(() => document.querySelector("#airlineCount").textContent !== "—");
        await page.waitForFunction(() => !document.querySelector("#airlineCount").classList.contains("is-counting"));
        const firstValue = await page.locator("#airlineCount").textContent();
        const result = await page.evaluate(() => {
          const value = document.querySelector("#airlineCount");
          const previousBounds = value.getBoundingClientRect();
          document.querySelector("#airlineFleetFilter").click();
          const currentBounds = value.getBoundingClientRect();
          return {
            text: value.textContent,
            visual: value.getAttribute("data-motion-value"),
            rolling: value.classList.contains("is-counting"),
            pseudoContent: getComputedStyle(value, "::after").content,
            widthBefore: previousBounds.width,
            widthAfter: currentBounds.width,
            heightBefore: previousBounds.height,
            heightAfter: currentBounds.height,
          };
        });
        assert.notEqual(result.text, firstValue);
        assert.equal(result.widthBefore, result.widthAfter);
        assert.equal(result.heightBefore, result.heightAfter);
        if (reducedMotion === "reduce") {
          assert.equal(result.rolling, false);
          assert.equal(result.visual, null);
        } else {
          assert.equal(result.rolling, true);
          assert.equal(result.visual, firstValue);
          assert.ok(result.pseudoContent.includes(firstValue));
          await page.waitForFunction(() => !document.querySelector("#airlineCount").classList.contains("is-counting"));
        }
        assert.equal(await page.locator("#airlineCount").textContent(), result.text);
        const target = page.locator("[data-global-system-mix] .airline-mix-link").first();
        await target.focus();
        await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.activeElement, "::before").opacity) > 0.9);
        assert.match(await target.evaluate((item) => getComputedStyle(item, "::before").backgroundImage), /linear-gradient/);
        assert.match(await target.evaluate((item) => getComputedStyle(item, "::after").backgroundImage), /linear-gradient/);
        const sweep = await page.locator(".topbar").evaluate((item) => getComputedStyle(item, "::after").animationName);
        assert.equal(sweep, reducedMotion === "reduce" ? "none" : "instrument-sweep");
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test("regional mix highlights stay readable in dark mode and atlas targeting honors motion settings", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const [width, reducedMotion] of [[1440, "no-preference"], [390, "reduce"]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
      await page.addInitScript(() => localStorage.setItem("ct-theme", "dark"));
      await page.goto(new URL("airline-insights.html", baseUrl).href, { waitUntil: "domcontentloaded" });
      const provider = page.locator(".airline-region-mix-table .airline-mix-link").first();
      await provider.waitFor();
      const mapBounds = await page.locator(".airline-map-section").boundingBox();
      const mixBounds = await page.locator(".airline-region-section").boundingBox();
      if (width === 1440) assert.ok(mixBounds.x >= mapBounds.x + mapBounds.width);
      else assert.ok(mixBounds.y >= mapBounds.y + mapBounds.height);
      assert.equal(await page.locator("#airlineAtlasRegions").count(), 0);
      if (width === 1440) await provider.hover();
      else await provider.focus();
      await page.waitForFunction(() => {
        const button = document.querySelector(".airline-mix-link:is(:hover, :focus-visible)");
        return button && getComputedStyle(button, "::before").top === "3px";
      });
      assert.deepEqual(await provider.evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor,
        text: [...button.children].map((item) => getComputedStyle(item).color),
        countBackground: getComputedStyle(button.querySelector(".airline-mix-count")).backgroundColor,
      })), { background: "rgb(232, 244, 239)", text: Array(3).fill("rgb(20, 38, 34)"), countBackground: "rgb(204, 228, 218)" });
      const metricRows = await page.locator("[data-airline-map-metric]").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
      assert.equal(new Set(metricRows).size, 1);
      const metric = page.locator('[data-airline-map-metric="eff"]');
      if (width === 1440) await metric.hover();
      else await metric.focus();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-airline-map-metric="eff"]'), "::before").opacity === "1");
      assert.equal(await metric.getAttribute("aria-pressed"), "false");
      const metricBounds = await metric.boundingBox();
      const scanCount = await page.evaluate(() => {
        document.querySelector('[data-airline-map-metric="eff"]').click();
        return document.querySelector(".airline-atlas-scan").getAnimations().length;
      });
      assert.equal(scanCount, reducedMotion === "reduce" ? 0 : 1);
      assert.equal(await metric.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-airline-map-metric="airlines"]').getAttribute("aria-pressed"), "false");
      assert.equal(await metric.evaluate((button) => getComputedStyle(button).backgroundColor), "rgb(243, 252, 248)");
      assert.equal(await metric.evaluate((button) => getComputedStyle(button).color), "rgb(20, 38, 34)");
      assert.deepEqual(await metric.boundingBox(), metricBounds);
      const chinaFilter = page.locator("#airlineChinaFilter");
      await chinaFilter.check();
      assert.equal(await chinaFilter.evaluate((input) => getComputedStyle(input.labels[0]).backgroundColor), "rgb(243, 252, 248)");
      await chinaFilter.uncheck();
      await page.mouse.move(0, 0);
      const japan = page.locator('[data-country="Japan"]');
      await japan.focus();
      await page.locator(".airline-map-reticle").waitFor({ state: "visible" });
      assert.match(await page.locator("#airlineMapTooltip").textContent(), /:\s*\d+%/);
      await japan.press("Enter");
      assert.equal(await japan.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#airlineAtlasScope").textContent(), "Rest of Asia & Pacific");
      assert.equal(await japan.evaluate((item) => item === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});