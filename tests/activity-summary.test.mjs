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