import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mapRegion, regionalProviderRace, normalizeMapRegions, providerColors } from "../js/airline-provider-map.js";
import { applyFleetFilter } from "../js/airline-fleet-filter.js";
import { buildInsightInput } from "../scripts/build_airline_insights_ai.mjs";

test("regional totals and AI input preserve the population across the China split", async () => {
  const source = JSON.parse(await readFile(new URL("../data/airline-insights.json", import.meta.url), "utf8"));
  const snapshot = normalizeMapRegions(source);
  assert.equal(snapshot.regions.reduce((sum, item) => sum + item.airlines, 0), source.unique_airline_count);
  assert.equal(snapshot.regions.find((item) => item.name === "Mainland China").airlines, source.airline_profiles.filter((item) => item.country === "China").length);
  assert.ok(buildInsightInput(source).regions.some((item) => item.name === "Mainland China"));
  const expectedRest = source.airline_profiles.filter((item) => ["East Asia & Pacific", "South Asia"].includes(item.region) && item.country !== "China");
  assert.equal(snapshot.regions.find((item) => item.name === "Rest of Asia & Pacific").airlines, expectedRest.length);
  assert.equal(snapshot.region_names.includes("South Asia"), false);
  assert.equal(buildInsightInput(source).regions.find((item) => item.name === "Rest of Asia & Pacific").airlines, expectedRest.length);
  const filtered = applyFleetFilter(snapshot);
  assert.ok(filtered.airline_profiles.every((item) => item.country !== "China" || item.region === "Mainland China"));
  const colors = [...providerColors(snapshot).values()];
  assert.equal(colors.length, new Set(colors).size);
  assert.ok(!source.region_scheme);
});

test("splits Mainland China without changing neighboring headquarters", () => {
  assert.equal(mapRegion("China", "East Asia & Pacific"), "Mainland China");
  for (const country of ["Hong Kong", "Macau", "Taiwan", "Japan"]) assert.equal(mapRegion(country, "East Asia & Pacific"), "Rest of Asia & Pacific");
  assert.equal(mapRegion("India", "South Asia"), "Rest of Asia & Pacific");
  assert.equal(mapRegion("Japan", "Rest of East Asia & Pacific"), "Rest of Asia & Pacific");
});

test("in-house built participates in rankings and colours while Paper stays excluded", () => {
  const systems = [{ name: "In-house built", count: 6 }, { name: "Vendor", count: 3 }, { name: "Paper", count: 8 }];
  const cells = [{ eff_known: 10, planning_known: 10, eff_systems: systems, planning_systems: systems }];
  for (const metric of ["eff", "planning"]) {
    const race = regionalProviderRace(cells, metric);
    assert.equal(race.providers[0].name, "In-house built");
    assert.equal(race.providers[0].share, 0.6);
    assert.equal(race.providers.some((item) => item.name === "Paper"), false);
  }
  const colors = providerColors({ country_segments: cells });
  assert.ok(colors.has("In-house built"));
  assert.equal(colors.has("Paper"), false);
});

test("provider races distinguish sparse fields, ties, close races and clear leaders", () => {
  function race(known, first, second) {
    return regionalProviderRace([{ eff_known: known, eff_systems: [{ name: "Paper", count: known }, { name: "Alpha", count: first }, { name: "Beta", count: second }] }], "eff");
  }
  assert.equal(race(4, 3, 1).status, "insufficient");
  assert.equal(race(10, 4, 4).status, "tie");
  assert.equal(race(10, 5, 4).status, "close");
  assert.equal(race(10, 6, 4).status, "leader");
  assert.equal(race(10, 6, 4).providers[0].name, "Alpha");
});