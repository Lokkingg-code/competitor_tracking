export function providerFootprint(profiles, mode, provider) {
  const field = mode === "planning" ? "planning_systems" : "eff_systems";
  const known = profiles.filter((profile) => (profile[field] || []).length > 0);
  const matches = known.filter((profile) => profile[field].includes(provider));
  const counterpartField = mode === "planning" ? "eff_systems" : "planning_systems";
  const counterpartLabel = mode === "planning" ? "EFF" : "flight-planning";
  const counterpartKnownProfiles = matches.filter((profile) => (profile[counterpartField] || []).length > 0);
  const counterpartCounts = new Map();
  for (const profile of counterpartKnownProfiles) {
    for (const name of profile[counterpartField]) counterpartCounts.set(name, (counterpartCounts.get(name) || 0) + 1);
  }
  const counterpartSystems = [...counterpartCounts].map(([name, count]) => ({ name, count, known: counterpartKnownProfiles.length, share: counterpartKnownProfiles.length ? count / counterpartKnownProfiles.length : 0 })).sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));

  function groups(dimension) {
    const result = new Map();
    for (const profile of profiles) {
      const label = profile[dimension];
      if (!label || (dimension === "fleet_band" && ["Check value", "Unspecified"].includes(label))) continue;
      const entry = result.get(label) || { name: label, count: 0, known: 0 };
      if ((profile[field] || []).length) entry.known += 1;
      if ((profile[field] || []).includes(provider)) entry.count += 1;
      result.set(label, entry);
    }
    return [...result.values()].sort((first, second) => second.count - first.count || second.known - first.known || first.name.localeCompare(second.name));
  }

  return {
    total: profiles.length,
    known: known.length,
    matches: matches.length,
    counterpartLabel,
    counterpartKnown: counterpartKnownProfiles.length,
    counterpartUnknown: matches.length - counterpartKnownProfiles.length,
    counterpartSystems,
    regions: groups("region"),
    carrierTypes: groups("airline_type"),
    fleetBands: groups("fleet_band"),
    matchesWithoutValidFleet: matches.filter((profile) => !profile.fleet_band || ["Check value", "Unspecified"].includes(profile.fleet_band)).length,
  };
}