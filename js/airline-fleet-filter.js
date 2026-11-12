export function applyFleetFilter(snapshot) {
  if (snapshot.fleet_filter?.minimum === 10 && snapshot.fleet_filter?.unknown_included) return snapshot;

  const filtered = structuredClone(snapshot);
  const excluded = filtered.airline_profiles.filter((profile) => profile.fleet_size !== null && profile.fleet_size < 10);
  const excludedNames = new Set(excluded.map((profile) => profile.airline));
  const cells = new Map(filtered.country_segments.map((cell) => [
    JSON.stringify([cell.country, cell.region, cell.airline_type, cell.fleet_band]), cell,
  ]));

  for (const profile of excluded) {
    const cell = cells.get(JSON.stringify([profile.country, profile.region, profile.airline_type, profile.fleet_band]));
    if (!cell) throw new Error("Cannot apply fleet filter: airline aggregate is missing.");
    cell.airlines -= 1;
    cell.fleet_values_recorded -= 1;
    cell.fleet_known -= 1;
    cell.fleet_sum -= profile.fleet_size;
    for (const [field, known] of [["eff_systems", "eff_known"], ["planning_systems", "planning_known"]]) {
      const systems = profile[field] || [];
      if (systems.length) cell[known] -= 1;
      for (const name of systems) {
        const item = cell[field].find((entry) => entry.name === name);
        if (!item) throw new Error("Cannot apply fleet filter: system aggregate is missing.");
        item.count -= 1;
      }
      cell[field] = cell[field].filter((item) => item.count > 0);
    }
    if ((profile.eff_systems || []).some((name) => ["paper", "in-house built", "in house built", "own solution"].includes(name.toLowerCase()))) {
      cell.eff_no_vendor -= 1;
    }
  }

  filtered.airline_profiles = filtered.airline_profiles.filter((profile) => !excludedNames.has(profile.airline));
  filtered.country_segments = filtered.country_segments.filter((cell) => cell.airlines > 0);
  for (const profile of filtered.airline_profiles) {
    if (profile.fleet_band === "Small · 1–50") profile.fleet_band = "Small · 10–50";
  }
  for (const cell of filtered.country_segments) {
    if (cell.fleet_band === "Small · 1–50") cell.fleet_band = "Small · 10–50";
  }
  filtered.fleet_bands = filtered.fleet_bands.map((band) => band === "Small · 1–50" ? "Small · 10–50" : band);
  filtered.conferences = filtered.conferences.map((event) => {
    const attending_airlines = (event.attending_airlines || []).filter((name) => !excludedNames.has(name));
    return { ...event, attending_airlines, linked_airline_count: attending_airlines.length };
  });
  filtered.fleet_filter = { minimum: 10, unknown_included: true, excluded_airlines: excluded.length, derived_from_saved_snapshot: true };
  return filtered;
}