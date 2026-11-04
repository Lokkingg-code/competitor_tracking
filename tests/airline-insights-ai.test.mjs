import test from "node:test";
import assert from "node:assert/strict";
import { buildInsightInput, generateInsights, normalizeInsights } from "../scripts/build_airline_insights_ai.mjs";

function sampleSnapshot() {
  return {
    generated_at: "2026-11-03T10:00:00+00:00",
    unique_airline_count: 2,
    overall: {
      eff_known: 1,
      eff_systems: [{ name: "AvioBook", count: 1 }],
      planning_known: 1,
      planning_systems: [{ name: "Lido", count: 1 }],
    },
    regions: [{
      name: "North America",
      airlines: 2,
      eff_known: 1,
      eff_systems: [{ name: "AvioBook", count: 1 }],
      planning_known: 1,
      planning_systems: [{ name: "Lido", count: 1 }],
      conference_count: 1,
    }],
    segments: [{
      name: "North America",
      airline_type: "LCC",
      fleet_band: "Small · 1–50",
      airlines: 1,
      eff_known: 1,
      eff_systems: [{ name: "AvioBook", count: 1 }],
      planning_known: 1,
      planning_systems: [{ name: "Lido", count: 1 }],
    }],
    conferences: [{ name: "Private Event Name", region: "North America", linked_airline_count: 3 }],
    coverage: { upcoming_conferences_recorded: 0 },
    airline_profiles: [{ airline: "Private Airline", contacts: "Private Contact", notes: "Private Notes" }],
  };
}

function generatedText(snapshot) {
  return JSON.stringify({
    overall: { headline: "Overall read", observations: ["Observed pattern."], caveat: "Small sample." },
    regions: snapshot.regions.map(({ name }) => ({
      name,
      headline: `${name} read`,
      observations: ["Regional pattern."],
      caveat: "Coverage is limited.",
    })),
  });
}

test("insight prompt input contains aggregates only, never airline profiles", () => {
  const snapshot = sampleSnapshot();
  const input = buildInsightInput(snapshot);
  const serialized = JSON.stringify(input);
  assert.match(serialized, /AvioBook/);
  assert.equal(Object.hasOwn(input.regions[0], "conference_records"), false);
  assert.equal(Object.hasOwn(input.overall, "airline_event_links"), false);
  assert.doesNotMatch(serialized, /Private Event Name/);
  assert.equal(input.overall.eff_selections.length, 1);
  assert.equal(input.overall.planning_selections.length, 1);
  assert.doesNotMatch(serialized, /Private Airline|Private Contact|Private Notes|airline_profiles|contacts|notes/);
});

test("normalizes one validated insight per snapshot region", () => {
  const snapshot = sampleSnapshot();
  const insights = normalizeInsights(JSON.parse(generatedText(snapshot)), snapshot, "test-model");
  assert.equal(insights.snapshot_generated_at, snapshot.generated_at);
  assert.equal(insights.model, "test-model");
  assert.equal(insights.regions[0].name, "North America");
  assert.throws(() => normalizeInsights({ ...JSON.parse(generatedText(snapshot)), regions: [] }, snapshot), /every region/);
});

test("Gemini generation sends the aggregate-only payload and returns validated JSON", async () => {
  const snapshot = sampleSnapshot();
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: generatedText(snapshot) }] } }] });
  };
  const insights = await generateInsights(snapshot, { apiKey: "test-key", model: "test-model", fetchImpl });
  assert.equal(insights.regions.length, 1);
  assert.doesNotMatch(requestBody.contents[0].parts[0].text, /Private Airline|Private Contact|Private Notes/);
  assert.match(requestBody.contents[0].parts[0].text, /carrier-type contrasts/);
  assert.match(requestBody.contents[0].parts[0].text, /0 of 5 planning-recorded small LCCs/);
  assert.match(requestBody.contents[0].parts[0].text, /Markdown bold/);
  assert.match(requestBody.contents[0].parts[0].text, /based only on current regional system-adoption patterns/);
  assert.match(requestBody.contents[0].parts[0].text, /Do not use past conference counts or attendance records/);
  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
});

test("airline insights default to the signal summary Gemini model", async () => {
  const snapshot = sampleSnapshot();
  let requestedUrl;
  await generateInsights(snapshot, {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return Response.json({ candidates: [{ content: { parts: [{ text: generatedText(snapshot) }] } }] });
    },
  });
  assert.match(requestedUrl, /models\/gemini-3\.5-flash-lite:generateContent$/);
});
