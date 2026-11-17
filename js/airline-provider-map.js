export const REGION_SCHEME = "mainland-china-rest-asia-v2";
const PROVIDER_COLORS = ["#007f87", "#c44449", "#3565ad", "#b47a08", "#8055a3", "#328252", "#c45b26", "#a8407c", "#527b95", "#868328", "#564f9d", "#aa654f", "#296c56", "#93628e", "#4975c2", "#be8e46"];
const NON_PROVIDERS = new Set(["own solution"]);

export function mapRegion(country, region) {
  if (["china", "mainland china", "people's republic of china"].includes(String(country).toLowerCase())) return "Mainland China";
  return ["East Asia & Pacific", "Rest of East Asia & Pacific", "South Asia"].includes(region) ? "Rest of Asia & Pacific" : region;
}

export function normalizeMapRegions(snapshot) {
  if (snapshot.region_scheme === REGION_SCHEME) return snapshot;
  const result = structuredClone(snapshot);
  for (const field of ["country_segments", "countries", "airline_profiles"]) {
    result[field] = result[field].map((item) => ({ ...item, region: mapRegion(item.country, item.region) }));
  }
  result.conferences = result.conferences.map((event) => ({ ...event, region: mapRegion("", event.region) }));
  const groups = new Map();
  const segments = new Map();
  function accumulate(mapping, groupKey, cell) {
    if (!mapping.has(groupKey)) mapping.set(groupKey, { name: cell.region, region: cell.region, airline_type: cell.airline_type, fleet_band: cell.fleet_band, airlines: 0, eff_known: 0, planning_known: 0, eff_systems: [], planning_systems: [] });
    const target = mapping.get(groupKey);
    for (const field of ["airlines", "eff_known", "planning_known"]) target[field] += cell[field] || 0;
    for (const field of ["eff_systems", "planning_systems"]) {
      for (const item of cell[field] || []) {
        const existing = target[field].find((entry) => entry.name === item.name);
        if (existing) existing.count += item.count;
        else target[field].push({ ...item });
      }
      target[field].sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
    }
  }
  for (const cell of result.country_segments) {
    accumulate(groups, cell.region, cell);
    accumulate(segments, JSON.stringify([cell.region, cell.airline_type, cell.fleet_band]), cell);
  }
  result.regions = [...groups.values()].sort((first, second) => second.airlines - first.airlines);
  result.segments = [...segments.values()];
  result.region_names = [...groups.keys()].sort();
  result.region_scheme = REGION_SCHEME;
  return result;
}

export function providerColors(snapshot) {
  const names = [...new Set(snapshot.country_segments.flatMap((cell) => [...cell.eff_systems, ...cell.planning_systems].map((item) => item.name)))].sort();
  const colors = new Map(names.filter((name) => !NON_PROVIDERS.has(name.toLowerCase()) && name.toLowerCase() !== "paper").map((name, index) => [name, PROVIDER_COLORS[index] || `hsl(${Math.round(index * 137.508) % 360} 55% 43%)`]));
  for (const name of names) if (name.toLowerCase() === "paper") colors.set(name, "#6d7178");
  return colors;
}

export function regionalProviderRace(cells, metric) {
  const knownField = metric === "eff" ? "eff_known" : "planning_known";
  const systemsField = metric === "eff" ? "eff_systems" : "planning_systems";
  const known = cells.reduce((sum, cell) => sum + (cell[knownField] || 0), 0);
  const counts = new Map();
  for (const cell of cells) for (const item of cell[systemsField] || []) {
    if (!NON_PROVIDERS.has(item.name.toLowerCase())) counts.set(item.name, (counts.get(item.name) || 0) + item.count);
  }
  const providers = [...counts].map(([name, count]) => ({ name, count, share: known ? count / known : 0 })).sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
  const leader = providers[0];
  const contenders = known >= 5 && leader ? providers.filter((item) => (leader.count - item.count) * 10 <= known) : [];
  return { known, providers, contenders, status: known < 5 || !leader ? "insufficient" : contenders.length > 1 ? leader.count === providers[1].count ? "tie" : "close" : "leader" };
}

export function gradientProviders(race) {
  if (race.status === "insufficient") return [];
  const cutoff = race.providers[Math.min(1, race.providers.length - 1)]?.count;
  return race.providers.filter((provider) => provider.count >= cutoff);
}

export function providerGradientStops(providers) {
  if (providers.length < 2) return [];
  const total = providers.reduce((sum, provider) => sum + provider.count, 0);
  const stops = [{ offset: 0, name: providers[0].name }];
  let cumulative = 0;
  for (let index = 0; index < providers.length - 1; index += 1) {
    cumulative += providers[index].count;
    const boundary = 100 * cumulative / total;
    const transition = Math.min(4, 50 * providers[index].count / total, 50 * providers[index + 1].count / total);
    stops.push({ offset: boundary - transition, name: providers[index].name });
    stops.push({ offset: boundary + transition, name: providers[index + 1].name });
  }
  stops.push({ offset: 100, name: providers.at(-1).name });
  return stops;
}