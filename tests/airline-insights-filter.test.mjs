import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyFleetFilter } from "../js/airline-fleet-filter.js";

test("filters saved snapshot aggregates, profiles and attendees without mutating the source", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/airline-insights.json", import.meta.url), "utf8"));
  const result = applyFleetFilter(snapshot);
  const expected = snapshot.airline_profiles.filter((profile) => profile.fleet_size === null || profile.fleet_size >= 10);
  assert.equal(result.airline_profiles.length, expected.length);
  assert.equal(result.country_segments.reduce((sum, cell) => sum + cell.airlines, 0), expected.length);
  assert.equal(result.country_segments.reduce((sum, cell) => sum + cell.eff_known, 0), expected.filter((profile) => profile.eff_systems.length).length);
  assert.equal(result.country_segments.reduce((sum, cell) => sum + cell.planning_known, 0), expected.filter((profile) => profile.planning_systems.length).length);
  const names = new Set(expected.map((profile) => profile.airline));
  for (const event of result.conferences) assert.ok(event.attending_airlines.every((name) => names.has(name)));
  assert.equal(snapshot.airline_profiles.length, snapshot.unique_airline_count);
});

test("does not filter an already-filtered snapshot twice", () => {
  const snapshot = { fleet_filter: { minimum: 10, unknown_included: true } };
  assert.equal(applyFleetFilter(snapshot), snapshot);
});