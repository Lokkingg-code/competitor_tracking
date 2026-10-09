import test from "node:test";
import assert from "node:assert/strict";
import { summarizeActivity } from "../js/activity-summary.js";

test("summaries group competitors and retain evidence without calling captures wins", () => {
  const signals = [
    { id: "first", competitor: "Navblue", date: "2026-09-25", headline: "TransNusa adopts Skywise Core X2", summary: "Connect flight and technical operations" },
    { id: "repeat", competitor: "Navblue", date: "2026-09-24", headline: "TransNusa adopts Skywise Core X2" },
    { id: "hiring", competitor: "Aviobook", date: "2026-09-25", headline: "We're hiring", summary: "Open roles" },
  ];
  const rows = summarizeActivity(signals);
  assert.equal(rows[0].capturedCount, 2);
  assert.deepEqual(rows[0].themes, ["Airline adoption", "Connected operations"]);
  assert.deepEqual(rows[0].evidence.map((signal) => signal.id), ["first"]);
  assert.equal(rows[1].evidence.length, 0);
  assert.match(rows[1].summary, /No substantive movement/);
  assert.equal(signals.length, 3);
});

test("empty and filtered inputs determine the summary scope", () => {
  assert.deepEqual(summarizeActivity([]), []);
  const rows = summarizeActivity([{ id: "crew", competitor: "Lufthansa Systems", date: "2026-09-21", headline: "Eurowings crew pairing automation", summary: "Customer statement" }]);
  assert.deepEqual(rows[0].themes, ["Planning & automation", "Customer experience"]);
});

test("main movement uses the newest saved AI insight with a headline fallback", () => {
  const signals = [
    { id: "newest", competitor: "IFS", date: "2026-10-08", headline: "LCC signs with IFS", ai_enrichment: { competitive_insight: "IFS signed an LCC agreement for its EFBOne platform." } },
    { id: "older", competitor: "IFS", date: "2026-10-01", headline: "IFS releases update", ai_enrichment: { competitive_insight: "IFS expanded EFBOne capabilities." } },
    { id: "fallback", competitor: "Aviobook", date: "2026-10-07", headline: "AvioBook launches Connect" },
  ];
  const rows = summarizeActivity(signals);
  assert.equal(rows.find((row) => row.competitor === "IFS").mainMovement, "IFS signed an LCC agreement for its EFBOne platform.");
  assert.equal(rows.find((row) => row.competitor === "Aviobook").mainMovement, "Latest: AvioBook launches Connect");
});

test("LCC movement counts distinct named customers only with high-confidence evidence", () => {
  const signals = [
    { id: "one", competitor: "IFS", date: "2026-10-08", headline: "IFS signs AirAsia", ai_enrichment: { customer_airline: "AirAsia", customer_relationship: "signed", customer_segment: "lcc", customer_confidence: 0.92, customer_segment_confidence: 0.95, competitive_insight: "IFS signed an AirAsia agreement." } },
    { id: "two", competitor: "IFS", date: "2026-10-07", headline: "IFS partners with Jetstar", ai_enrichment: { customer_airline: "Jetstar", customer_relationship: "partnered", customer_segment: "lcc", customer_confidence: 0.9, customer_segment_confidence: 0.9, competitive_insight: "IFS partnered with Jetstar." } },
    { id: "mention", competitor: "IFS", date: "2026-10-06", headline: "IFS mentions Wizz", ai_enrichment: { customer_airline: "Wizz Air", customer_relationship: "mentioned", customer_segment: "lcc", customer_confidence: 0.95, customer_segment_confidence: 0.95 } },
    { id: "low-confidence", competitor: "IFS", date: "2026-10-05", headline: "IFS mentions possible customer", ai_enrichment: { customer_airline: "Possibly LCC", customer_relationship: "signed", customer_segment: "lcc", customer_confidence: 0.95, customer_segment_confidence: 0.6 } },
  ];
  const row = summarizeActivity(signals)[0];
  assert.equal(row.lccAirlineCount, 2);
  assert.equal(row.lccSignalCount, 2);
  assert.match(row.mainMovement, /2 named LCCs \(2 signals\): AirAsia, Jetstar/);
});