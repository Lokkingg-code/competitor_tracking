#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ROOT = resolve(import.meta.dirname, "..");
const SNAPSHOT_PATH = resolve(ROOT, "data/airline-insights.json");
const OUTPUT_PATH = resolve(ROOT, "data/airline-insights-ai.json");
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_GENERATION_ATTEMPTS = 5;
const SEGMENT_TYPES = new Set(["Flag Carrier", "LCC"]);

function retryDelay(response, attempt) {
  const retryAfterHeader = response.headers?.get("retry-after");
  if (retryAfterHeader !== null && retryAfterHeader !== undefined && retryAfterHeader.trim()) {
    const retryAfter = Number(retryAfterHeader);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) {
      return Math.min(retryAfter * 1000, 60_000);
    }
  }
  return Math.min(5_000 * (2 ** attempt), 30_000);
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function topSystems(systems, limit = 5) {
  return (systems || []).slice(0, limit).map(({ name, count }) => ({ name, count }));
}

function allSystems(systems) {
  return (systems || []).map(({ name, count }) => ({ name, count }));
}

function segmentSummary(segment) {
  return {
    carrier_type: segment.airline_type,
    fleet_band: segment.fleet_band,
    airlines: segment.airlines,
    eff_recorded: segment.eff_known,
    eff_selections: allSystems(segment.eff_systems),
    planning_recorded: segment.planning_known,
    planning_selections: allSystems(segment.planning_systems),
  };
}

export function buildInsightInput(snapshot) {
  const regions = snapshot.regions.map((region) => ({
    name: region.name,
    airlines: region.airlines,
    eff_recorded: region.eff_known,
    eff_selections: allSystems(region.eff_systems),
    planning_recorded: region.planning_known,
    planning_selections: allSystems(region.planning_systems),
    carrier_segments: snapshot.segments
      .filter((segment) => segment.name === region.name && SEGMENT_TYPES.has(segment.airline_type))
      .map(segmentSummary),
  }));
  return {
    snapshot_generated_at: snapshot.generated_at,
    overall: {
      airlines: snapshot.unique_airline_count,
      eff_recorded: snapshot.overall.eff_known,
      eff_selections: allSystems(snapshot.overall.eff_systems),
      planning_recorded: snapshot.overall.planning_known,
      planning_selections: allSystems(snapshot.overall.planning_systems),
      carrier_segments: snapshot.segments
        .filter((segment) => SEGMENT_TYPES.has(segment.airline_type))
        .map(segmentSummary),
    },
    regions,
  };
}

function shortText(value, field, limit) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing insight ${field}.`);
  return value.trim().slice(0, limit);
}

function normalizeSection(section, label) {
  if (!section || !Array.isArray(section.observations) || !section.observations.length) {
    throw new Error(`Missing insight observations for ${label}.`);
  }
  return {
    headline: shortText(section.headline, `${label} headline`, 120),
    observations: section.observations.slice(0, 3).map((text) => shortText(text, `${label} observation`, 300)),
    caveat: shortText(section.caveat, `${label} caveat`, 300),
  };
}

export function normalizeInsights(value, snapshot, model = DEFAULT_MODEL) {
  const expectedRegions = new Set(snapshot.regions.map((region) => region.name));
  if (!value || !Array.isArray(value.regions)) throw new Error("AI response must include a regions array.");
  const regions = new Map();
  for (const item of value.regions) {
    if (!expectedRegions.has(item.name) || regions.has(item.name)) continue;
    regions.set(item.name, { name: item.name, ...normalizeSection(item, item.name) });
  }
  if (regions.size !== expectedRegions.size) throw new Error("AI response must include one insight for every region in the snapshot.");
  return {
    schema_version: 1,
    snapshot_generated_at: snapshot.generated_at,
    generated_at: new Date().toISOString(),
    model,
    overall: normalizeSection(value.overall, "overall"),
    regions: snapshot.regions.map((region) => regions.get(region.name)),
  };
}

export async function generateInsights(snapshot, {
  apiKey,
  model = DEFAULT_MODEL,
  fetchImpl = fetch,
  sleepImpl = wait,
}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is required to generate AI insights.");
  const input = buildInsightInput(snapshot);
  const prompt = [
    "Act as a cautious airline technology market analyst advising Cathay Technologies on target research for Cathay Flight Folder. Use only the aggregate Airtable counts provided below; do not add outside market claims.",
    "Return strict JSON with shape: {\"overall\":{\"headline\":string,\"observations\":string[],\"caveat\":string},\"regions\":[{\"name\":string,\"headline\":string,\"observations\":string[],\"caveat\":string}] }.",
    "Create one overall and one regional read for every supplied region. Keep each headline concise and each observation under 35 words. The overall read should identify which recorded airline segments or regions are worth validating first for Cathay Flight Folder, and where coverage is too weak to prioritize.",
    "Prioritize meaningful carrier-type and fleet-band differences (LCC vs Flag Carrier) over lists of common vendors. Treat this Airtable list as a prospect sample, not the whole market. Compare a segment with the overall recorded rate only when the comparison is useful and both denominators are shown.",
    "Compute each system rate as recorded selections divided by airlines with that field recorded; state both numerator and denominator and say 'recorded selections'. If the field-complete sample is under 5, do not name a leading system or make a directional targeting recommendation; explicitly say evidence is insufficient. A 2/2 result is not a preference.",
    "Wrap vendor names and key counts/rates in Markdown bold (**...**) to make evidence scannable. Do not emit HTML or bold entire sentences.",
    "Do not say airlines prefer, favor, rely on, or are driven by a vendor based on these records. Do not call these figures market share, adoption rates, demand, or installed base. Multiple selections can be recorded for one airline; blanks mean unknown, not non-adoption.",
    "Every regional headline should identify a sufficiently supported difference useful for target research or state that the sample is insufficient. Do not produce a generic action recommendation just to fill a regional section.",
    "Do not discuss conferences: this dataset has no event audience, opportunity, or ROI evidence. Do not infer named airline relationships, causal benefits, or product capabilities absent from the aggregate input.",
    "Aggregate-only input:",
    JSON.stringify(input),
  ].join("\n\n");
  let response;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    response = await fetchImpl(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 7000, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_GENERATION_ATTEMPTS - 1) {
      break;
    }
    await sleepImpl(retryDelay(response, attempt));
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini returned ${response.status}: ${result.error?.message || "request failed"}`);
  const text = (result.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought)
    .map((part) => part.text || "")
    .join("")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("Gemini returned invalid JSON for airline insights.");
  }
  return normalizeInsights(parsed, snapshot, model);
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Set GEMINI_API_KEY in the build environment; no key is sent to the browser.");
  const model = process.env.GEMINI_INSIGHTS_MODEL?.trim() || DEFAULT_MODEL;
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  const insights = await generateInsights(snapshot, { apiKey, model });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(insights, null, 2)}\n`, "utf8");
  console.log(`Wrote overall and ${insights.regions.length} regional insights using ${model}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Could not generate airline insights.");
    process.exitCode = 1;
  });
}
