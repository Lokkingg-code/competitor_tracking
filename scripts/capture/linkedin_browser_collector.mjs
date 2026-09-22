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
const maxScrolls = Number(process.env.LINKEDIN_MAX_SCROLLS || 8);
const lookbackDays = Number(process.env.LINKEDIN_LOOKBACK_DAYS || 14);

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
  const match = value?.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return null;
  const units = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() - Number(match[1]) * units[match[2].toLowerCase()]).toISOString().slice(0, 10);
}

async function readConfig() {
  return JSON.parse(await fs.readFile(configPath, "utf8"));
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
    login_required: false,
    selector_matches: 0,
    article_nodes: 0,
    posts_seen: 0,
    posts_captured: 0,
    status: "ok",
  };

  if (page.url().includes("/login") || page.url().includes("/checkpoint")) {
    check.login_required = true;
    check.status = "login_required";
    console.log("LinkedIn login or verification is required. Complete it in the browser, then press Enter here.");
    process.stdin.setEncoding("utf8");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    check.final_url = page.url();
    check.page_title = await page.title();
  }

  const records = new Map();
  for (let scroll = 0; scroll < maxScrolls; scroll += 1) {
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
      if (!url || !date || date < cutoffDate(lookbackDays) || records.has(url)) continue;
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
  console.log(`[linkedin-browser] check ${organization.vanity_name}: ${check.status}; articles=${check.article_nodes}; selector_matches=${check.selector_matches}; captured=${check.posts_captured}`);
  return { items: [...records.values()], check };
}

const config = await readConfig();
const browser = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const items = [];
const checks = [];
try {
  for (const organization of config.linkedin_organizations || []) {
    const result = await collectOrganization(page, organization);
    items.push(...result.items);
    checks.push(result.check);
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
await fs.writeFile(path.join(outputDir, "linkedin_latest.json"), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`[linkedin-browser] captured ${unique.length} posts`);
console.log(`[linkedin-browser] wrote ${path.relative(root, outputPath)}`);
if (checks.length > 0 && checks.every((check) => check.article_nodes === 0)) {
  console.error("[linkedin-browser] no article nodes found on any page; review checks before treating this run as successful");
  process.exitCode = 1;
}
