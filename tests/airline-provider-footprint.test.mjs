import test from "node:test";
import assert from "node:assert/strict";
import { providerFootprint } from "../js/airline-provider-footprint.js";

test("counts provider selections against known fields in each dimension", () => {
  const profiles = [
    { region: "Asia", airline_type: "LCC", fleet_band: "Small", eff_systems: ["Alpha", "Beta"], planning_systems: ["Planner"] },
    { region: "Asia", airline_type: "LCC", fleet_band: "Small", eff_systems: ["Beta"], planning_systems: [] },
    { region: "Europe", airline_type: "Flag Carrier", fleet_band: "Medium", eff_systems: ["Alpha"], planning_systems: ["Other"] },
    { region: "Europe", airline_type: "Flag Carrier", fleet_band: "Unspecified", eff_systems: ["Alpha"], planning_systems: [] },
    { region: "Europe", airline_type: "LCC", fleet_band: "Small", eff_systems: [], planning_systems: [] },
  ];
  const result = providerFootprint(profiles, "eff", "Alpha");
  assert.equal(result.total, 5);
  assert.equal(result.known, 4);
  assert.equal(result.matches, 3);
  assert.equal(result.counterpartLabel, "flight-planning");
  assert.equal(result.counterpartKnown, 2);
  assert.equal(result.counterpartUnknown, 1);
  assert.deepEqual(result.counterpartSystems, [
    { name: "Other", count: 1, known: 2, share: 0.5 },
    { name: "Planner", count: 1, known: 2, share: 0.5 },
  ]);
  assert.deepEqual(result.regions, [{ name: "Europe", count: 2, known: 2 }, { name: "Asia", count: 1, known: 2 }]);
  assert.deepEqual(result.carrierTypes, [{ name: "Flag Carrier", count: 2, known: 2 }, { name: "LCC", count: 1, known: 2 }]);
  assert.deepEqual(result.fleetBands, [{ name: "Small", count: 1, known: 2 }, { name: "Medium", count: 1, known: 1 }]);
  assert.equal(result.matchesWithoutValidFleet, 1);
  const planning = providerFootprint(profiles, "planning", "Planner");
  assert.equal(planning.known, 2);
  assert.equal(planning.matches, 1);
  assert.equal(planning.counterpartLabel, "EFF");
  assert.deepEqual(planning.counterpartSystems.map((item) => item.name), ["Alpha", "Beta"]);
  assert.deepEqual(planning.regions, [{ name: "Asia", count: 1, known: 1 }, { name: "Europe", count: 0, known: 1 }]);
});

test("handles empty and unmatched populations without division assumptions", () => {
  const result = providerFootprint([], "eff", "Unknown");
  assert.equal(result.known, 0);
  assert.equal(result.matches, 0);
  assert.deepEqual(result.regions, []);
  assert.deepEqual(result.fleetBands, []);
});

test("shows groups with no known fields without treating them as zero adoption", () => {
  const result = providerFootprint([{ region: "Africa", airline_type: "Cargo", fleet_band: "Small", eff_systems: [], planning_systems: [] }], "eff", "Alpha");
  assert.deepEqual(result.regions, [{ name: "Africa", count: 0, known: 0 }]);
  assert.deepEqual(result.carrierTypes, [{ name: "Cargo", count: 0, known: 0 }]);
  assert.deepEqual(result.fleetBands, [{ name: "Small", count: 0, known: 0 }]);
});