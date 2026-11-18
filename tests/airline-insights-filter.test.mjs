import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyFleetFilter, excludeMainlandChina, excludeNonAirlineEntities } from "../js/airline-fleet-filter.js";
import { normalizeMapRegions } from "../js/airline-provider-map.js";
import { buildInsightInput } from "../scripts/build_airline_insights_ai.mjs";

test("excludes only the two named non-airline entities from saved aggregates", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/airline-insights.json", import.meta.url), "utf8"));
  const result = excludeNonAirlineEntities(snapshot);
  const excluded = snapshot.airline_profiles.filter((profile) => ["Embraer", "Exchange Income Corporation"].includes(profile.airline));
  assert.equal(result.unique_airline_count, snapshot.unique_airline_count - excluded.length);
  assert.equal(result.overall.airlines, result.unique_airline_count);
  assert.equal(result.country_segments.reduce((sum, cell) => sum + cell.airlines, 0), result.unique_airline_count);
  assert.ok(result.airline_profiles.every((profile) => !excluded.some((item) => item.airline === profile.airline)));
  assert.equal(result.source_record_count, snapshot.source_record_count);
  assert.equal(result.coverage.eff_status_known, result.airline_profiles.filter((profile) => profile.eff_systems.length).length);
  assert.equal(result.coverage.flight_planning_known, result.airline_profiles.filter((profile) => profile.planning_systems.length).length);
  assert.equal(result.coverage.fleet_known, result.airline_profiles.filter((profile) => profile.fleet_size !== null && profile.fleet_size <= 1500).length);
  assert.equal(result.coverage.quality_flags.missing_airline_type, result.airline_profiles.filter((profile) => profile.airline_type === "Unclassified").length);
  const ai = buildInsightInput(snapshot);
  assert.equal(ai.overall.airlines, result.unique_airline_count);
  assert.equal(ai.regions.reduce((sum, region) => sum + region.airlines, 0), result.unique_airline_count);
  assert.equal(excludeNonAirlineEntities(result), result);
  assert.equal(snapshot.airline_profiles.length, snapshot.unique_airline_count);
});

test("entity exclusions preserve other unclassified airlines and adjust selections and event links", () => {
  const profiles = [
    { airline: "Embraer", country: "France", region: "Europe", airline_type: "Unclassified", fleet_band: "Small", fleet_size: 16, eff_systems: ["Vendor"], planning_systems: [] },
    { airline: "Exchange Income Corporation", country: "France", region: "Europe", airline_type: "Unclassified", fleet_band: "Small", fleet_size: 20, eff_systems: [], planning_systems: ["Planner"] },
    { airline: "Embraer Air", country: "France", region: "Europe", airline_type: "Unclassified", fleet_band: "Small", fleet_size: 30, eff_systems: ["Vendor"], planning_systems: [] },
  ];
  const bucket = { airlines: 3, fleet_known: 3, fleet_values_recorded: 3, fleet_sum: 66, eff_known: 2, eff_no_vendor: 0, eff_systems: [{ name: "Vendor", count: 2 }], planning_known: 1, planning_systems: [{ name: "Planner", count: 1 }] };
  const snapshot = {
    source_record_count: 3, unique_airline_count: 3, airline_profiles: profiles,
    country_segments: [{ ...structuredClone(bucket), country: "France", map_name: "France", region: "Europe", airline_type: "Unclassified", fleet_band: "Small" }],
    countries: [{ ...structuredClone(bucket), country: "France" }], regions: [{ ...structuredClone(bucket), name: "Europe" }],
    segments: [{ ...structuredClone(bucket), region: "Europe", airline_type: "Unclassified", fleet_band: "Small" }],
    overall: bucket, conferences: [{ attending_airlines: profiles.map((profile) => profile.airline), linked_airline_count: 3 }],
    coverage: { hq_known: 3, hq_region_assigned: 3, hq_mapped: 3, fleet_known: 3, fleet_values_recorded: 3, airline_type_known: 0, eff_status_known: 2, flight_planning_known: 1, quality_flags: { missing_airline_type: 3, missing_eff_status: 1, missing_flight_planning: 2 } },
  };
  const result = excludeNonAirlineEntities(snapshot);
  assert.deepEqual(result.airline_profiles.map((profile) => profile.airline), ["Embraer Air"]);
  assert.equal(result.unique_airline_count, 1);
  assert.equal(result.overall.eff_known, 1);
  assert.deepEqual(result.overall.eff_systems, [{ name: "Vendor", count: 1 }]);
  assert.equal(result.overall.planning_known, 0);
  assert.deepEqual(result.overall.planning_systems, []);
  assert.equal(result.coverage.quality_flags.missing_airline_type, 1);
  assert.deepEqual(result.conferences[0].attending_airlines, ["Embraer Air"]);
  assert.equal(result.conferences[0].linked_airline_count, 1);
  assert.equal(snapshot.unique_airline_count, 3);
});

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

test("Mainland China exclusion updates all aggregates and composes with the fleet filter", async () => {
  const raw = JSON.parse(await readFile(new URL("../data/airline-insights.json", import.meta.url), "utf8"));
  const snapshot = normalizeMapRegions(excludeNonAirlineEntities(raw));
  const chinaCount = snapshot.airline_profiles.filter((profile) => profile.region === "Mainland China").length;
  const expectedRemaining = snapshot.airline_profiles.filter((profile) => profile.region !== "Mainland China");
  const result = excludeMainlandChina(snapshot);
  assert.equal(result.unique_airline_count, snapshot.unique_airline_count - chinaCount);
  assert.equal(result.airline_profiles.length, expectedRemaining.length);
  assert.ok(result.airline_profiles.every((profile) => profile.region !== "Mainland China"));
  assert.equal(result.overall.eff_known, expectedRemaining.filter((profile) => profile.eff_systems.length).length);
  assert.equal(result.overall.planning_known, expectedRemaining.filter((profile) => profile.planning_systems.length).length);
  assert.equal(result.source_record_count, snapshot.source_record_count);
  assert.equal(excludeMainlandChina(result), result);

  const fleetFirst = applyFleetFilter(snapshot);
  const chinaAfterFleet = excludeMainlandChina(fleetFirst);
  const chinaFirst = excludeMainlandChina(snapshot);
  const fleetAfterChina = applyFleetFilter(chinaFirst);
  assert.equal(chinaAfterFleet.unique_airline_count, fleetAfterChina.unique_airline_count);
  assert.equal(chinaAfterFleet.country_segments.reduce((sum, cell) => sum + cell.airlines, 0), fleetAfterChina.country_segments.reduce((sum, cell) => sum + cell.airlines, 0));
});

test("does not filter an already-filtered snapshot twice", () => {
  const snapshot = { fleet_filter: { minimum: 10, unknown_included: true } };
  assert.equal(applyFleetFilter(snapshot), snapshot);
});