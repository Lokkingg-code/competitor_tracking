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
  assert.match(requestBody.contents[0].parts[0].text, /carrier-type and fleet-band differences/);
  assert.match(requestBody.contents[0].parts[0].text, /Cathay Technologies/);
  assert.match(requestBody.contents[0].parts[0].text, /field-complete sample is under 5/);
  assert.match(requestBody.contents[0].parts[0].text, /A 2\/2 result is not a preference/);
  assert.match(requestBody.contents[0].parts[0].text, /Markdown bold/);
  assert.match(requestBody.contents[0].parts[0].text, /Do not discuss conferences/);
  assert.match(requestBody.contents[0].parts[0].text, /Do not call these figures market share, adoption rates, demand, or installed base/);
  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
});

test("Gemini generation retries temporary 503 errors and honors Retry-After", async () => {
  const snapshot = sampleSnapshot();
  let requests = 0;
  const delays = [];
  const insights = await generateInsights(snapshot, {
    apiKey: "test-key",
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return Response.json({ error: { message: "Temporary overload" } }, {
          status: 503,
          headers: { "Retry-After": "2" },
        });
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: generatedText(snapshot) }] } }] });
    },
    sleepImpl: async (delay) => delays.push(delay),
  });

  assert.equal(requests, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(insights.regions[0].name, "North America");
});

test("Gemini generation does not retry permanent client errors", async () => {
  let requests = 0;
  await assert.rejects(() => generateInsights(sampleSnapshot(), {
    apiKey: "test-key",
    fetchImpl: async () => {
      requests += 1;
      return Response.json({ error: { message: "Invalid request" } }, { status: 400 });
    },
    sleepImpl: async () => assert.fail("permanent errors should not be retried"),
  }), /Gemini returned 400: Invalid request/);
  assert.equal(requests, 1);
});

test("Gemini generation backs off for sustained temporary overload", async () => {
  const snapshot = sampleSnapshot();
  let requests = 0;
  const delays = [];
  await generateInsights(snapshot, {
    apiKey: "test-key",
    fetchImpl: async () => {
      requests += 1;
      return requests < 5
        ? Response.json({ error: { message: "Temporary overload" } }, { status: 503 })
        : Response.json({ candidates: [{ content: { parts: [{ text: generatedText(snapshot) }] } }] });
    },
    sleepImpl: async (delay) => delays.push(delay),
  });

  assert.equal(requests, 5);
  assert.deepEqual(delays, [5000, 10000, 20000, 30000]);
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
