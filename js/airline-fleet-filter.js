const EXCLUDED_ENTITIES = new Set(["embraer", "exchange income corporation"]);
export const ENTITY_EXCLUSION_VERSION = 1;

function removeProfiles(snapshot, shouldExclude) {
  const filtered = structuredClone(snapshot);
  const excluded = filtered.airline_profiles.filter(shouldExclude);
  const excludedNames = new Set(excluded.map((profile) => profile.airline));
  const cells = new Map(filtered.country_segments.map((cell) => [
    JSON.stringify([cell.country, cell.region, cell.airline_type, cell.fleet_band]), cell,
  ]));

  for (const profile of excluded) {
    const cell = cells.get(JSON.stringify([profile.country, profile.region, profile.airline_type, profile.fleet_band]));
    if (!cell) throw new Error("Cannot apply fleet filter: airline aggregate is missing.");
    const buckets = [cell, filtered.overall,
      filtered.countries?.find((item) => item.country === profile.country),
      filtered.regions?.find((item) => item.name === profile.region),
      filtered.segments?.find((item) => item.region === profile.region && item.airline_type === profile.airline_type && item.fleet_band === profile.fleet_band),
    ].filter(Boolean);
    for (const bucket of buckets) {
      bucket.airlines -= 1;
      if (profile.fleet_size !== null) {
        if (typeof bucket.fleet_values_recorded === "number") bucket.fleet_values_recorded -= 1;
        if (profile.fleet_size > 1500) {
          if (typeof bucket.fleet_outliers === "number") bucket.fleet_outliers -= 1;
        } else {
          if (typeof bucket.fleet_known === "number") bucket.fleet_known -= 1;
          if (typeof bucket.fleet_sum === "number") bucket.fleet_sum -= profile.fleet_size;
        }
      }
      for (const [field, known] of [["eff_systems", "eff_known"], ["planning_systems", "planning_known"]]) {
        const systems = profile[field] || [];
        if (systems.length && typeof bucket[known] === "number") bucket[known] -= 1;
        for (const name of systems) {
          const item = bucket[field]?.find((entry) => entry.name === name);
          if (item) item.count -= 1;
        }
        if (bucket[field]) bucket[field] = bucket[field].filter((item) => item.count > 0);
      }
      if (typeof bucket.eff_no_vendor === "number" && (profile.eff_systems || []).some((name) => ["paper", "in-house built", "in house built", "own solution"].includes(name.toLowerCase()))) bucket.eff_no_vendor -= 1;
      for (const [field, value] of [["airline_types", profile.airline_type], ["fleet_bands", profile.fleet_band]]) {
        const item = bucket[field]?.find((entry) => entry.name === value);
        if (item) item.count -= 1;
        if (bucket[field]) bucket[field] = bucket[field].filter((entry) => entry.count > 0);
      }
    }
    const coverage = filtered.coverage || {};
    const quality = coverage.quality_flags || {};
    const decrement = (target, field, condition) => {
      if (condition && typeof target[field] === "number") target[field] -= 1;
    };
    const hasHq = profile.country !== "Unspecified";
    const hasFleet = profile.fleet_size !== null;
    const validFleet = hasFleet && profile.fleet_size <= 1500;
    const hasType = profile.airline_type !== "Unclassified";
    const hasEff = (profile.eff_systems || []).length > 0;
    const hasPlanning = (profile.planning_systems || []).length > 0;
    decrement(coverage, "hq_known", hasHq);
    decrement(coverage, "hq_region_assigned", profile.region !== "Unmapped");
    decrement(coverage, "hq_mapped", Boolean(cell.map_name));
    decrement(coverage, "fleet_values_recorded", hasFleet);
    decrement(coverage, "fleet_known", validFleet);
    decrement(coverage, "fleet_size_outliers", hasFleet && !validFleet);
    decrement(coverage, "airline_type_known", hasType);
    decrement(coverage, "eff_status_known", hasEff);
    decrement(coverage, "flight_planning_known", hasPlanning);
    decrement(quality, "missing_hq", !hasHq);
    decrement(quality, "hq_region_unassigned", profile.region === "Unmapped");
    decrement(quality, "hq_not_mapped", hasHq && !cell.map_name);
    decrement(quality, "missing_fleet_size", !hasFleet);
    decrement(quality, "fleet_size_outliers", hasFleet && !validFleet);
    decrement(quality, "missing_airline_type", !hasType);
    decrement(quality, "missing_eff_status", !hasEff);
    decrement(quality, "missing_flight_planning", !hasPlanning);
  }

  filtered.airline_profiles = filtered.airline_profiles.filter((profile) => !excludedNames.has(profile.airline));
  filtered.unique_airline_count -= excluded.length;
  filtered.country_segments = filtered.country_segments.filter((cell) => cell.airlines > 0);
  for (const field of ["countries", "regions", "segments"]) {
    if (filtered[field]) filtered[field] = filtered[field].filter((item) => item.airlines > 0);
  }
  filtered.conferences = filtered.conferences.map((event) => {
    const attending_airlines = (event.attending_airlines || []).filter((name) => !excludedNames.has(name));
    return { ...event, attending_airlines, linked_airline_count: attending_airlines.length };
  });
  return { filtered, excluded };
}

export function excludeNonAirlineEntities(snapshot) {
  if (snapshot.entity_exclusion_version === ENTITY_EXCLUSION_VERSION) return snapshot;
  const { filtered, excluded } = removeProfiles(snapshot, (profile) => EXCLUDED_ENTITIES.has(profile.airline.trim().toLowerCase()));
  filtered.entity_exclusion_version = ENTITY_EXCLUSION_VERSION;
  filtered.excluded_entity_count = excluded.length;
  return filtered;
}

export const MAINLAND_CHINA_FILTER_VERSION = 1;

export function excludeMainlandChina(snapshot) {
  if (snapshot.mainland_china_filter?.version === MAINLAND_CHINA_FILTER_VERSION) return snapshot;
  const { filtered, excluded } = removeProfiles(snapshot, (profile) => profile.region === "Mainland China");
  filtered.mainland_china_filter = {
    version: MAINLAND_CHINA_FILTER_VERSION,
    excluded_airlines: excluded.length,
    derived_from_saved_snapshot: true,
  };
  return filtered;
}

export function applyFleetFilter(snapshot) {
  if (snapshot.fleet_filter?.minimum === 10 && snapshot.fleet_filter?.unknown_included) return snapshot;

  const { filtered, excluded } = removeProfiles(snapshot, (profile) => profile.fleet_size !== null && profile.fleet_size < 10);
  for (const profile of filtered.airline_profiles) {
    if (profile.fleet_band === "Small · 1–50") profile.fleet_band = "Small · 10–50";
  }
  for (const cell of filtered.country_segments) {
    if (cell.fleet_band === "Small · 1–50") cell.fleet_band = "Small · 10–50";
  }
  filtered.fleet_bands = filtered.fleet_bands.map((band) => band === "Small · 1–50" ? "Small · 10–50" : band);
  filtered.fleet_filter = { minimum: 10, unknown_included: true, excluded_airlines: excluded.length, derived_from_saved_snapshot: true };
  return filtered;
}