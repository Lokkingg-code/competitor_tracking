#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const configPath = path.join(root, "scripts", "capture", "sources.json");
const outputDir = path.join(root, "data", "raw");
const profileDir = process.env.LINKEDIN_PROFILE_DIR || path.join(os.homedir(), ".cathay-competitor-linkedin");
const maxScrolls = Number(process.env.LINKEDIN_MAX_SCROLLS || 16);
const lookbackDays = Number(process.env.LINKEDIN_LOOKBACK_DAYS || 14);
const requestedOrganizations = (process.env.LINKEDIN_ORGANIZATIONS || "").split(",").map((name) => name.trim()).filter(Boolean);

function stableId(competitor, value) {
  return `browser-${crypto.createHash("sha1").update(`${competitor}|${value}`).digest("hex").slice(0, 12)}`;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function cutoffDate(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function relativeDate(value) {
  const match = value?.trim().match(/^(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago$|^(\d+)\s*(m|h|d|w|mo|y)$/i);
  if (!match) return null;
  const units = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    mo: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() - Number(match[1] || match[3]) * units[(match[2] || match[4]).toLowerCase()]).toISOString().slice(0, 10);
}

function postPreviewMatches(summary, description) {
  if (String(description || "").trim().length < 40) return false;
  const normalize = (value) => String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const summaryText = ` ${normalize(summary)} `;
  const words = normalize(description).split(/\s+/).filter((word) => word.length >= 3);
  for (let index = 0; index <= words.length - 3; index += 1) {
    const phrase = words.slice(index, index + 3).join(" ");
    if (phrase.split(" ").filter((word) => word.length >= 4).length >= 2 && summaryText.includes(` ${phrase} `)) return true;
  }
  return false;
}

async function readConfig() {
  return JSON.parse(await fs.readFile(configPath, "utf8"));
}

async function selectRecentPosts(page) {
  const sortButton = page.getByRole("button", { name: /^Sort by:/i });
  await sortButton.waitFor({ state: "visible", timeout: 10000 });
  if (/\brecent\b/i.test(await sortButton.innerText())) return "recent";

  await sortButton.click();
  const recentOption = page.getByRole("menuitem", { name: /^Recent$/i });
  await recentOption.waitFor({ state: "visible", timeout: 5000 });
  await recentOption.click();
  await page.getByRole("button", { name: /^Sort by:\s*Recent$/i }).waitFor({ state: "visible", timeout: 5000 });
  return "recent";
}

async function collectOrganization(page, organization) {
  const url = `https://www.linkedin.com/company/${organization.vanity_name}/posts/`;
  console.log(`[linkedin-browser] ${organization.competitor}: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const check = {
    competitor: organization.competitor,
    vanity_name: organization.vanity_name,
    requested_url: url,
    final_url: page.url(),
    page_title: await page.title(),
    lookback_cutoff: cutoffDate(lookbackDays),
    lookback_complete: false,
    scrolls: 0,
    oldest_observed_date: null,
    login_required: false,
    selector_matches: 0,
    article_nodes: 0,
    posts_seen: 0,
    posts_captured: 0,
    post_skips: {},
    feed_sort: "unknown",
    status: "ok",
  };

  if (page.url().includes("/login") || page.url().includes("/checkpoint")) {
    check.login_required = true;
    check.status = "login_required";
    if (!process.stdin.isTTY) {
      console.error(`[linkedin-browser] ${organization.vanity_name}: login or verification required; skipping non-interactive capture`);
      return { items: [], check };
    }
    console.log("LinkedIn login or verification is required. Complete it in the browser, then press Enter here.");
    process.stdin.setEncoding("utf8");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    check.final_url = page.url();
    check.page_title = await page.title();
  }

  try {
    check.feed_sort = await selectRecentPosts(page);
  } catch (error) {
    check.feed_sort = "recent_sort_unavailable";
    check.sort_error = error.message;
    console.warn(`[linkedin-browser] ${organization.vanity_name}: could not select Recent sort: ${error.message}`);
  }

  const records = new Map();
  const seenPosts = new Set();
  const cutoff = cutoffDate(lookbackDays);
  let reachedLookbackBoundary = false;
  const recordSkip = (reason) => {
    check.post_skips[reason] = (check.post_skips[reason] || 0) + 1;
  };
  for (let scroll = 0; scroll < maxScrolls; scroll += 1) {
    check.scrolls = scroll + 1;
    check.article_nodes = Math.max(check.article_nodes, await page.locator("[role='article']").count());
    const postLocator = page.locator("[role='article'][data-urn]");
    check.selector_matches = Math.max(check.selector_matches, await postLocator.count());
    const posts = await postLocator.evaluateAll((articles) => articles.map((article) => {
      const postUrl = `https://www.linkedin.com/feed/update/${article.dataset.urn}`;
      const time = article.querySelector("time");
      const relativeDate = article.innerText.match(/\b\d+\s*(?:minute|hour|day|week|month|year)s?\s+ago\b/i)?.[0] || null;
      const body = article.querySelector("[data-test-id='main-feed-activity-card__commentary'], .feed-shared-update-v2__description, .feed-shared-text") || article;
      const title = article.querySelector(".update-components-article__title, h2, h3")?.textContent?.trim() || "";
      return {
        url: postUrl,
        title: /^Feed post number \d+$/i.test(title) ? "" : title,
        summary: body.textContent?.replace(/\\s+/g, " ").trim() || "",
        published_at: time?.getAttribute("datetime") || time?.textContent?.trim() || relativeDate,
      };
    }));

    for (const post of posts) {
      check.posts_seen += 1;
      const url = post.url?.split("?")[0];
      const date = isoDate(post.published_at) || relativeDate(post.published_at);
      if (date && (!check.oldest_observed_date || date < check.oldest_observed_date)) {
        check.oldest_observed_date = date;
      }
      if (date && date < cutoff) {
        reachedLookbackBoundary = true;
        recordSkip("outside_lookback");
        continue;
      }
      if (!url) {
        recordSkip("missing_permalink");
        continue;
      }
      if (!date) {
        recordSkip("unparseable_date");
        continue;
      }
      if (records.has(url)) {
        recordSkip("duplicate_permalink_in_capture");
        continue;
      }
      records.set(url, {
        id: stableId(organization.competitor, url),
        competitor: organization.competitor,
        source_name: "LinkedIn browser collector",
        captured_via: "linkedin_browser",
        source_channel: "linkedin",
        title: post.title || post.summary.slice(0, 180),
        url,
        summary: post.summary.slice(0, 600),
        published_at: date,
      });
    }

    if (!posts.length) {
      const feedPosts = page.locator('[role="listitem"]:has(button[aria-label^="Open control menu for post"])');
      const count = await feedPosts.count();
      check.article_nodes = Math.max(check.article_nodes, count);
      check.selector_matches = Math.max(check.selector_matches, count);
      for (let index = 0; index < count; index += 1) {
        check.posts_seen += 1;
        const post = feedPosts.nth(index);
        const postHandle = await post.elementHandle();
        if (!postHandle) {
          recordSkip("post_detached_before_capture");
          continue;
        }
        const lines = (await post.innerText()).split("\n").map((line) => line.trim()).filter(Boolean);
        const dateIndex = lines.findIndex((line, position) => position > 0 && /^(?:\d+\s*(?:m|h|d|w|mo|y|minutes?|hours?|days?|weeks?|months?|years?)(?:\s+ago)?)$/i.test(line));
        if (dateIndex < 0) {
          recordSkip("unparseable_date");
          continue;
        }
        const content = lines.slice(dateIndex + 1);
        if (/^Follow(?:ing)?$/i.test(content[0])) content.shift();
        const summary = content.join(" ").slice(0, 600);
        const date = relativeDate(lines[dateIndex]);
        if (date && (!check.oldest_observed_date || date < check.oldest_observed_date)) {
          check.oldest_observed_date = date;
        }
        if (!summary) {
          recordSkip("empty_summary");
          continue;
        }
        if (!date) {
          recordSkip("unparseable_date");
          continue;
        }
        if (date < cutoff) {
          reachedLookbackBoundary = true;
          recordSkip("outside_lookback");
          continue;
        }
        const signature = `${date}|${summary}`;
        if (seenPosts.has(signature)) {
          recordSkip("duplicate_post_in_capture");
          continue;
        }
        seenPosts.add(signature);
        let url;
        let permalinkMethod = "card_link";
        const directAnchors = await postHandle.$$('a[href*="/feed/update/"], a[href*="linkedin.com/posts/"]');
        const directLinks = await Promise.all(directAnchors.map((anchor) => anchor.evaluate((element) => element.href)));
        url = directLinks.find((link) => /^https:\/\/www\.linkedin\.com\/(?:feed\/update\/|posts\/)/.test(link));
        try {
          if (!url) {
            permalinkMethod = "post_menu";
            const control = await postHandle.$('button[aria-label^="Open control menu for post"]');
            if (!control) throw new Error("Post menu button missing from selected card");
            await page.keyboard.press("Escape");
            await page.evaluate(() => navigator.clipboard.writeText(""));
            const clipboardBefore = await page.waitForFunction(async () => await navigator.clipboard.readText() === "", null, { timeout: 3000 });
            await clipboardBefore.dispose();
            await control.click();
            let menu = page.locator('[role="menu"]:visible').last();
            try {
              await menu.waitFor({ state: "visible", timeout: 5000 });
            } catch {
              await page.keyboard.press("Escape");
              await control.click();
              menu = page.locator('[role="menu"]:visible').last();
              await menu.waitFor({ state: "visible", timeout: 5000 });
            }
            const copyLink = menu.getByRole("menuitem", { name: /^Copy link to post$/i });
            await copyLink.waitFor({ state: "visible", timeout: 5000 });
            await copyLink.click();
            const copiedUrl = await page.waitForFunction(async () => {
              const value = await navigator.clipboard.readText();
              return value.startsWith("https://") ? value : false;
            }, null, { timeout: 5000 });
            url = await copiedUrl.jsonValue();
            await copiedUrl.dispose();
          }
        } catch (error) {
          check.post_errors = [...(check.post_errors || []), { title: content[0]?.slice(0, 180), error: error.message }];
          recordSkip(permalinkMethod === "post_menu" ? "permalink_menu_error" : "card_permalink_error");
          await page.keyboard.press("Escape");
          continue;
        }
        if (!/^https:\/\/(?:lnkd\.in\/p\/|www\.linkedin\.com\/(?:feed\/update\/|posts\/))/.test(url)) {
          recordSkip("invalid_permalink");
          continue;
        }
        if (records.has(url)) {
          recordSkip("duplicate_permalink_in_capture");
          continue;
        }
        if (permalinkMethod === "post_menu") {
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            const html = await response.text();
            const description = await page.evaluate((markup) => new DOMParser().parseFromString(markup, "text/html").querySelector('meta[property="og:description"]')?.content || "", html);
            if (!postPreviewMatches(summary, description)) {
              recordSkip("permalink_post_text_mismatch");
              check.post_errors = [...(check.post_errors || []), { title: content[0]?.slice(0, 180), url, error: "Copied permalink preview did not match visible post" }];
              continue;
            }
          } catch (error) {
            recordSkip("permalink_preview_unavailable");
            check.post_errors = [...(check.post_errors || []), { title: content[0]?.slice(0, 180), url, error: error.message }];
            continue;
          }
        }
        records.set(url, {
          id: stableId(organization.competitor, url),
          competitor: organization.competitor,
          source_name: "LinkedIn browser collector",
          captured_via: "linkedin_browser",
          source_channel: "linkedin",
          title: content[0]?.slice(0, 180) || summary.slice(0, 180),
          url,
          summary,
          published_at: date,
          permalink_method: permalinkMethod,
        });
      }
    }

    if (reachedLookbackBoundary) {
      check.lookback_complete = true;
      break;
    }
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1200);
  }
  check.posts_captured = records.size;
  if (check.login_required && !page.url().includes("/login") && !page.url().includes("/checkpoint")) {
    check.status = "ok_after_login";
  } else if (!check.login_required && check.article_nodes === 0) {
    check.status = "no_article_nodes";
  } else if (check.selector_matches === 0) {
    check.status = "selector_no_matches";
  }
  if (check.post_errors?.length) check.status = records.size ? "partial_capture" : "post_capture_errors";
  if (check.sort_error && check.status === "ok") check.status = "sort_unavailable";
  if (!check.lookback_complete && check.article_nodes > 0 && check.status === "ok") check.status = "lookback_incomplete";
  if (!check.posts_captured && check.article_nodes > 0 && check.status === "ok") check.status = "no_posts_captured";
  console.log(`[linkedin-browser] check ${organization.vanity_name}: ${check.status}; sort=${check.feed_sort}; lookback_complete=${check.lookback_complete}; oldest=${check.oldest_observed_date}; scrolls=${check.scrolls}/${maxScrolls}; articles=${check.article_nodes}; selector_matches=${check.selector_matches}; seen=${check.posts_seen}; captured=${check.posts_captured}; skipped=${JSON.stringify(check.post_skips)}`);
  return { items: [...records.values()], check };
}

const config = await readConfig();
const organizations = (config.linkedin_organizations || []).filter((organization) =>
  !requestedOrganizations.length || requestedOrganizations.includes(organization.vanity_name)
);
if (!organizations.length) throw new Error("No configured LinkedIn organizations match the requested filter");
const browser = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await browser.newPage();
const items = [];
const checks = [];
try {
  for (const organization of organizations) {
    try {
      const result = await collectOrganization(page, organization);
      items.push(...result.items);
      checks.push(result.check);
    } catch (error) {
      checks.push({
        competitor: organization.competitor,
        vanity_name: organization.vanity_name,
        status: "collection_error",
        error: error.message,
        posts_captured: 0,
      });
      console.error(`[linkedin-browser] ${organization.vanity_name}: ${error.message}`);
    }
  }
} finally {
  await browser.close();
}

const unique = [...new Map(items.map((item) => [item.url, item])).values()];
const payload = {
  captured_at: new Date().toISOString(),
  lookback_days: lookbackDays,
  cutoff: cutoffDate(lookbackDays),
  count: unique.length,
  checks,
  items: unique,
};
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `linkedin_browser_${new Date().toISOString().replace(/[-:]/g, "").replace(/\\..+/, "").replace("T", "T")}Z.json`);
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
if (!requestedOrganizations.length) {
  await fs.writeFile(path.join(outputDir, "linkedin_latest.json"), `${JSON.stringify(payload, null, 2)}\n`);
}
console.log(`[linkedin-browser] captured ${unique.length} posts`);
console.log(`[linkedin-browser] wrote ${path.relative(root, outputPath)}`);
if (checks.length > 0 && checks.every((check) => check.article_nodes === 0)) {
  console.error("[linkedin-browser] no article nodes found on any page; review checks before treating this run as successful");
  process.exitCode = 1;
}
