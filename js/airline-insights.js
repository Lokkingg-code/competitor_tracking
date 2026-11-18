import { applyFleetFilter, excludeMainlandChina, excludeNonAirlineEntities, ENTITY_EXCLUSION_VERSION, MAINLAND_CHINA_FILTER_VERSION } from "./airline-fleet-filter.js?v=3";
import { normalizeMapRegions, mapRegion, providerColors, regionalProviderRace, gradientProviders, providerGradientStops, REGION_SCHEME } from "./airline-provider-map.js?v=5";
import { providerFootprint } from "./airline-provider-footprint.js?v=1";

const dataUrl = "data/airline-insights.json";
const mapUrl = "assets/ne_110m_admin_0_countries.geojson";
const state = { region: "all", airlineType: "all", fleetBand: "all", mapMetric: "airlines", systemMode: "eff", profileDimension: "type", showAllConferences: false, providerMode: "eff", providerName: "" };
const elements = {
  snapshotDate: document.getElementById("airlineSnapshotDate"),
  fleetFilter: document.getElementById("airlineFleetFilter"),
  chinaFilter: document.getElementById("airlineChinaFilter"),
  airlineCount: document.getElementById("airlineCount"),
  airlineCountNote: document.getElementById("airlineCountNote"),
  effCoverage: document.getElementById("effCoverage"),
  effCoverageNote: document.getElementById("effCoverageNote"),
  effCoverageBar: document.getElementById("effCoverageBar"),
  planningCoverage: document.getElementById("planningCoverage"),
  planningCoverageNote: document.getElementById("planningCoverageNote"),
  planningCoverageBar: document.getElementById("planningCoverageBar"),
  map: document.getElementById("airlineWorldMap"),
  mapTooltip: document.getElementById("airlineMapTooltip"),
  mapSummary: document.getElementById("airlineMapSummary"),
  mapTotal: document.getElementById("airlineMapTotal"),
  mapLegend: document.getElementById("airlineMapLegend"),
  regionRows: document.getElementById("airlineRegionRows"),
  regionReset: document.getElementById("airlineRegionReset"),
  regionNote: document.getElementById("airlineRegionMixNote"),
  profileRows: document.getElementById("airlineProfileRows"),
  profileHead: document.getElementById("airlineProfileHead"),
  profileNote: document.getElementById("airlineProfileNote"),
  providerSelect: document.getElementById("airlineProviderSelect"),
  providerScope: document.getElementById("airlineProviderScope"),
  providerInsight: document.getElementById("airlineProviderInsight"),
  providerRegions: document.getElementById("airlineProviderRegions"),
  providerTypes: document.getElementById("airlineProviderTypes"),
  providerFleets: document.getElementById("airlineProviderFleets"),
  providerFleetNote: document.getElementById("airlineProviderFleetNote"),
  providerPairedHeading: document.getElementById("airlineProviderPairedHeading"),
  providerPairedNote: document.getElementById("airlineProviderPairedNote"),
  providerPairedSystems: document.getElementById("airlineProviderPairedSystems"),
  insightScope: document.getElementById("airlineInsightScope"),
  insightBadge: document.querySelector(".airline-ai-badge"),
  insightHeading: document.getElementById("airlineInsightHeading"),
  insightBody: document.getElementById("airlineInsightBody"),
  quickLook: document.getElementById("airlineQuickLook"),
  quickLookTitle: document.getElementById("airlineQuickLookTitle"),
  quickLookNote: document.getElementById("airlineQuickLookNote"),
  quickLookContent: document.getElementById("airlineQuickLookContent"),
  quickLookRows: document.getElementById("airlineQuickLookRows"),
  conferences: document.getElementById("conferenceRows"),
  showAllConferences: document.getElementById("conferenceShowAll"),
  themeToggle: document.getElementById("themeToggle"),
};
const numberFormat = new Intl.NumberFormat("en-US");
const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_COLORS = ["#dfe8e3", "#b3cbbf", "#7ca997", "#3e8178", "#006568"];
let snapshot;
let unfilteredSnapshot;
let countryFeatures;
let aiInsightSnapshot;
let mapProviderColors;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatInsightText(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong class="airline-insight-emphasis">$1</strong>');
}

function currentCells() {
  return snapshot.country_segments.filter((cell) =>
    (state.region === "all" || cell.region === state.region)
    && (state.airlineType === "all" || cell.airline_type === state.airlineType)
    && (state.fleetBand === "all" || cell.fleet_band === state.fleetBand)
  );
}

function profileCells() {
  return snapshot.country_segments.filter((cell) =>
    (state.region === "all" || cell.region === state.region)
    && (state.profileDimension === "type"
      ? state.fleetBand === "all" || cell.fleet_band === state.fleetBand
      : state.profileDimension === "fleet"
        ? state.airlineType === "all" || cell.airline_type === state.airlineType
        : (state.airlineType === "all" || cell.airline_type === state.airlineType)
          && (state.fleetBand === "all" || cell.fleet_band === state.fleetBand))
  );
}

function renderProfileControls() {
  const regionOption = document.querySelector('[data-profile-dimension="region"]');
  regionOption.hidden = state.region !== "all";
  if (state.region !== "all" && state.profileDimension === "region") state.profileDimension = "type";
  document.querySelectorAll("[data-profile-dimension]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.profileDimension === state.profileDimension));
  });
}

function rollup(cells) {
  const summary = {
    airlines: 0,
    fleet_values_recorded: 0,
    fleet_known: 0,
    fleet_outliers: 0,
    eff_known: 0,
    eff_no_vendor: 0,
    eff_systems: new Map(),
    planning_known: 0,
    planning_systems: new Map(),
  };
  for (const cell of cells) {
    summary.airlines += Number(cell.airlines || 0);
    summary.fleet_values_recorded += Number(cell.fleet_values_recorded || 0);
    summary.fleet_known += Number(cell.fleet_known || 0);
    summary.fleet_outliers += Number(cell.fleet_outliers || 0);
    summary.eff_known += Number(cell.eff_known || 0);
    summary.eff_no_vendor += Number(cell.eff_no_vendor || 0);
    summary.planning_known += Number(cell.planning_known || 0);
    for (const item of cell.eff_systems || []) summary.eff_systems.set(item.name, (summary.eff_systems.get(item.name) || 0) + Number(item.count || 0));
    for (const item of cell.planning_systems || []) summary.planning_systems.set(item.name, (summary.planning_systems.get(item.name) || 0) + Number(item.count || 0));
  }
  return summary;
}

function systemsFor(summary, mode = state.systemMode) {
  const entries = mode === "eff" ? summary.eff_systems : summary.planning_systems;
  return [...entries].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function currentMetric(summary) {
  if (state.mapMetric === "eff") return summary.eff_known;
  if (state.mapMetric === "planning") return summary.planning_known;
  return summary.airlines;
}

function project([longitude, latitude]) {
  const width = 1000;
  const height = 500;
  return [((longitude + 180) / 360) * width, ((85 - Math.max(-60, Math.min(85, latitude))) / 145) * height];
}

function ringPath(ring) {
  let paths = [];
  let points = [];
  let priorLongitude = null;
  for (const coordinate of ring) {
    const [longitude] = coordinate;
    if (priorLongitude !== null && Math.abs(longitude - priorLongitude) > 180) {
      if (points.length > 2) paths.push(points);
      points = [];
    }
    points.push(project(coordinate));
    priorLongitude = longitude;
  }
  if (points.length > 2) paths.push(points);
  return paths.map((part) => `M${part.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`).join("");
}

function geometryPath(geometry) {
  if (!geometry) return "";
  if (geometry.type === "Polygon") return geometry.coordinates.map(ringPath).join("");
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.map(ringPath)).join("");
  return "";
}

function mapValues(cells) {
  const result = new Map();
  for (const cell of cells) {
    if (!cell.map_name) continue;
    result.set(cell.map_name, (result.get(cell.map_name) || 0) + currentMetric(cell));
  }
  return result;
}

function mapBin(value, thresholds) {
  if (value <= 0) return 0;
  const bin = thresholds.findIndex((threshold) => value <= threshold);
  return bin < 0 ? thresholds.length + 1 : bin + 1;
}

function drawMap(cells) {
  hideMapTooltip();
  if (state.mapMetric !== "airlines") {
    drawProviderMap(cells);
    return;
  }
  const values = mapValues(cells);
  const maximum = Math.max(0, ...values.values());
  const thresholds = [...new Set([0.25, 0.5, 0.75].map((fraction) => Math.ceil(maximum * fraction)))]
    .filter((threshold) => threshold > 0 && threshold < maximum)
    .sort((a, b) => a - b);
  elements.map.replaceChildren();
  for (const feature of countryFeatures.features || []) {
    const properties = feature.properties || {};
    const name = properties.ADMIN || properties.NAME || "Country";
    const value = values.get(name) || 0;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", geometryPath(feature.geometry));
    path.setAttribute("class", "airline-country-shape");
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("fill", value ? MAP_COLORS[mapBin(value, thresholds)] : "var(--map-empty)");
    path.setAttribute("aria-label", `${name}: ${numberFormat.format(value)} ${state.mapMetric === "airlines" ? "airlines" : "records"}`);
    path.setAttribute("tabindex", "0");
    const country = snapshot.countries.find((item) => item.map_name === name);
    if (state.region !== "all" && country?.region === state.region) path.classList.add("is-region-selected");
    path.dataset.country = name;
    path.addEventListener("pointerenter", (event) => showMapTooltip(event, name, value));
    path.addEventListener("pointermove", positionMapTooltip);
    path.addEventListener("pointerleave", hideMapTooltip);
    path.addEventListener("focus", (event) => showMapTooltip(event, name, value));
    path.addEventListener("blur", hideMapTooltip);
    path.addEventListener("click", () => {
      const country = snapshot.countries.find((item) => item.map_name === name);
      if (country && country.region !== "Unmapped") {
        state.region = state.region === country.region ? "all" : country.region;
        render();
      }
    });
    elements.map.append(path);
  }
  const metricLabel = state.mapMetric === "eff" ? "EFF status records" : state.mapMetric === "planning" ? "flight-planning records" : "airline records";
  elements.mapSummary.textContent = `${metricLabel} by headquarters country`;
  elements.mapTotal.textContent = `${numberFormat.format([...values.values()].reduce((sum, value) => sum + value, 0))} mapped`;
  const legendBins = thresholds.map((high, index) => ({ lower: index ? thresholds[index - 1] + 1 : 1, high }));
  if (maximum > (thresholds.at(-1) || 0)) legendBins.push({ lower: (thresholds.at(-1) || 0) + 1, high: null });
  elements.mapLegend.innerHTML = `<span><i style="--legend-color:var(--map-empty)"></i>None recorded</span>${legendBins.map((bin, index) => {
    const label = bin.high === null ? `${bin.lower}+` : bin.high > bin.lower ? `${bin.lower}–${bin.high}` : String(bin.lower);
    return `<span><i style="--legend-color:${MAP_COLORS[index + 1]}"></i>${label}</span>`;
  }).join("")}`;
  const mappedCount = snapshot.coverage.hq_mapped;
  const knownCount = snapshot.coverage.hq_known;
}

function drawProviderMap(cells) {
  elements.map.replaceChildren();
  const definitions = document.createElementNS(SVG_NS, "defs");
  elements.map.append(definitions);
  const regions = new Map(snapshot.region_names.map((region) => [region, regionalProviderRace(cells.filter((cell) => cell.region === region), state.mapMetric)]));
  const fills = new Map();
  const shownProviders = new Set();
  for (const [region, race] of regions) {
    let fill = "var(--map-empty)";
    if (race.status !== "insufficient") {
      const top = gradientProviders(race);
      top.forEach((item) => shownProviders.add(item.name));
      fill = mapProviderColors.get(top[0].name);
      if (top.length > 1) {
        const identifier = `provider-blend-${fills.size}`;
        const gradient = document.createElementNS(SVG_NS, "linearGradient");
        gradient.setAttribute("id", identifier);
        gradient.setAttribute("x1", "0%");
        gradient.setAttribute("x2", "100%");
        gradient.setAttribute("y1", "0%");
        gradient.setAttribute("y2", "0%");
        for (const { offset, name } of providerGradientStops(top)) {
          const stop = document.createElementNS(SVG_NS, "stop");
          stop.setAttribute("offset", `${offset}%`);
          stop.setAttribute("stop-color", mapProviderColors.get(name));
          gradient.append(stop);
        }
        definitions.append(gradient);
        fill = `url(#${identifier})`;
      }
    }
    fills.set(region, fill);
  }
  for (const feature of countryFeatures.features || []) {
    const properties = feature.properties || {};
    const name = properties.ADMIN || properties.NAME || "Country";
    const region = mapRegion(name, properties.REGION_WB || "Unmapped");
    const race = regions.get(region);
    const visible = state.region === "all" || region === state.region;
    const leaders = race?.providers.slice(0, Math.max(3, gradientProviders(race).length)).map((item) => `${item.name}: ${item.count}/${race.known} (${Math.round(item.share * 100)}%)`).join("; ");
    const description = !visible ? `${name} · ${region} · outside selected region` : `${name} · ${region} · ${!race || race.status === "insufficient" ? "Insufficient provider evidence" : race.status === "tie" ? "Tied leaders" : race.status === "close" ? "Close race" : "Leading recorded provider"}. ${race?.known || 0} fields recorded. ${leaders || "No provider recorded"}`;
    const country = document.createElementNS(SVG_NS, "g");
    const polygons = feature.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates : feature.geometry?.type === "Polygon" ? [feature.geometry.coordinates] : [];
    for (const polygon of polygons) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", polygon.map(ringPath).join(""));
      path.setAttribute("class", "airline-country-shape");
      path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("fill", visible ? fills.get(region) || "var(--map-empty)" : "var(--map-empty)");
      if (state.region === region) path.classList.add("is-region-selected");
      country.append(path);
    }
    country.setAttribute("aria-label", description);
    country.setAttribute("tabindex", "0");
    country.dataset.country = name;
    country.dataset.region = region;
    country.dataset.race = race?.status || "insufficient";
    const show = (event) => {
      const providers = visible && race ? race.providers.slice(0, Math.max(3, gradientProviders(race).length)) : [];
      if (!providers.length) {
        hideMapTooltip();
        return;
      }
      elements.mapTooltip.textContent = providers.map((item) => `${item.name}: ${Math.round(item.share * 100)}%`).join("; ");
      elements.mapTooltip.hidden = false;
      positionMapTooltip(event);
    };
    country.addEventListener("pointerenter", show);
    country.addEventListener("focus", show);
    country.addEventListener("pointermove", positionMapTooltip);
    country.addEventListener("pointerleave", hideMapTooltip);
    country.addEventListener("blur", hideMapTooltip);
    country.addEventListener("click", () => {
      if (!regions.has(region)) return;
      state.region = state.region === region ? "all" : region;
      hideMapTooltip();
      render();
    });
    elements.map.append(country);
  }
  elements.mapSummary.textContent = `${state.mapMetric === "eff" ? "EFF" : "Flight planning"} providers by region · Airtable sample, not market share`;
  elements.mapTotal.textContent = "";
  elements.mapLegend.innerHTML = [...shownProviders].sort().map((name) => `<span><i style="--legend-color:${mapProviderColors.get(name)}"></i>${escapeHtml(name)}</span>`).join("");
}

function showMapTooltip(event, country, value) {
  const unit = state.mapMetric === "airlines" ? "airlines" : "records";
  elements.mapTooltip.textContent = `${country} · ${numberFormat.format(value)} ${unit}`;
  elements.mapTooltip.hidden = false;
  positionMapTooltip(event);
}

function positionMapTooltip(event) {
  const bounds = elements.map.parentElement.getBoundingClientRect();
  const clientX = Number.isFinite(event.clientX) ? event.clientX : bounds.left + bounds.width / 2;
  const clientY = Number.isFinite(event.clientY) ? event.clientY : bounds.top + bounds.height / 2;
  elements.mapTooltip.style.left = `${Math.max(8, Math.min(bounds.width - elements.mapTooltip.offsetWidth - 8, clientX - bounds.left + 12))}px`;
  elements.mapTooltip.style.top = `${Math.max(8, Math.min(bounds.height - elements.mapTooltip.offsetHeight - 8, clientY - bounds.top + 12))}px`;
}

function hideMapTooltip() {
  elements.mapTooltip.hidden = true;
}

function renderKpis(summary) {
  elements.airlineCount.textContent = numberFormat.format(summary.airlines);
  const filters = [
    snapshot.fleet_filter?.minimum === 10 ? "Fleet 10+" : "All fleets",
    snapshot.mainland_china_filter?.version === MAINLAND_CHINA_FILTER_VERSION ? "Mainland China excluded" : "Mainland China included",
  ];
  elements.airlineCountNote.textContent = `${numberFormat.format(snapshot.source_record_count)} Airtable source rows · ${filters.join(" · ")}`;
  const effCoverage = summary.airlines ? Math.round(summary.eff_known / summary.airlines * 100) : 0;
  const planningCoverage = summary.airlines ? Math.round(summary.planning_known / summary.airlines * 100) : 0;
  elements.effCoverage.textContent = `${effCoverage}%`;
  elements.effCoverageNote.textContent = `${numberFormat.format(summary.eff_known)} of ${numberFormat.format(summary.airlines)} connected airlines`;
  elements.effCoverageBar.style.width = `${effCoverage}%`;
  elements.planningCoverage.textContent = `${planningCoverage}%`;
  elements.planningCoverageNote.textContent = `${numberFormat.format(summary.planning_known)} of ${numberFormat.format(summary.airlines)} connected airlines`;
  elements.planningCoverageBar.style.width = `${planningCoverage}%`;
}

function renderMarketRead() {
  const isOverall = state.region === "all";
  const regionCells = snapshot.country_segments.filter((cell) => isOverall || cell.region === state.region);
  const summary = rollup(regionCells);
  const read = isOverall
    ? aiInsightSnapshot?.overall
    : aiInsightSnapshot?.regions?.find((item) => item.name === state.region);
  const isFresh = !snapshot.fleet_filter?.derived_from_saved_snapshot && !snapshot.mainland_china_filter?.derived_from_saved_snapshot && aiInsightSnapshot?.entity_exclusion_version === ENTITY_EXCLUSION_VERSION && aiInsightSnapshot?.region_scheme === REGION_SCHEME && aiInsightSnapshot?.snapshot_generated_at === snapshot.generated_at;
  elements.insightScope.textContent = isOverall ? "Overall" : state.region;
  elements.insightHeading.innerHTML = formatInsightText(read && isFresh ? read.headline : isOverall ? "Overall data read" : `${state.region} data read`);
  elements.insightBadge.textContent = read && isFresh ? `AI synthesis · ${aiInsightSnapshot.model}` : "Data summary";
  const observations = read && isFresh ? read.observations : [
    `${numberFormat.format(summary.eff_known)} of ${numberFormat.format(summary.airlines)} filtered airlines have an EFF status recorded; leading selections are ${systemsFor(summary, "eff").slice(0, 3).map((item) => `${item.name} (${item.count})`).join(", ") || "not recorded"}.`,
    `${numberFormat.format(summary.planning_known)} of ${numberFormat.format(summary.airlines)} filtered airlines have a flight-planning system recorded; leading selections are ${systemsFor(summary, "planning").slice(0, 3).map((item) => `${item.name} (${item.count})`).join(", ") || "not recorded"}.`,
  ];
  elements.insightBody.innerHTML = `<ul>${observations.map((observation) => `<li>${formatInsightText(observation)}</li>`).join("")}</ul>`;
}

function systemDistribution(items, mode, filters, limit = 3) {
  const slots = Array.from({ length: limit }, (_, index) => {
    const item = items[index];
    if (!item) return `<span class="airline-mix-empty-slot">${items.length ? "—" : index === 0 ? "Not recorded" : "—"}</span>`;
    const tint = index === 0 ? 42 : index === 1 ? 28 : 15 * (0.85 ** (index - 2));
    return `<button class="airline-mix-link" type="button" data-strength="${index + 1}" style="--rank-tint:${tint.toFixed(2)}%" title="${escapeHtml(item.name)} · ${numberFormat.format(item.count)} airlines" data-system-name="${escapeHtml(item.name)}" data-system-mode="${mode}" data-system-region="${escapeHtml(filters.region)}" data-system-type="${escapeHtml(filters.airlineType)}" data-system-fleet="${escapeHtml(filters.fleetBand)}"><span class="airline-mix-rank">${index + 1}</span><span class="airline-mix-name">${escapeHtml(item.name)}</span><strong class="airline-mix-count">${numberFormat.format(item.count)}</strong></button>`;
  });
  return `<div class="airline-mix-list">${slots.join("")}</div>`;
}

function renderRegions() {
  const regions = new Map();
  for (const region of snapshot.region_names.filter((name) => name !== "Unmapped")) {
    regions.set(region, { airlines: 0, effSystems: new Map(), planningSystems: new Map() });
  }
  for (const cell of snapshot.country_segments.filter((item) =>
    item.region !== "Unmapped"
    && (state.airlineType === "all" || item.airline_type === state.airlineType)
    && (state.fleetBand === "all" || item.fleet_band === state.fleetBand)
  )) {
    const summary = regions.get(cell.region) || { airlines: 0, effSystems: new Map(), planningSystems: new Map() };
    summary.airlines += cell.airlines;
    for (const item of cell.eff_systems || []) summary.effSystems.set(item.name, (summary.effSystems.get(item.name) || 0) + Number(item.count || 0));
    for (const item of cell.planning_systems || []) summary.planningSystems.set(item.name, (summary.planningSystems.get(item.name) || 0) + Number(item.count || 0));
    regions.set(cell.region, summary);
  }
  const conferences = new Map();
  for (const event of snapshot.conferences) conferences.set(event.region, (conferences.get(event.region) || 0) + 1);
  const rows = [...regions].sort((a, b) => Number(b[0] === state.region) - Number(a[0] === state.region) || b[1].airlines - a[1].airlines || a[0].localeCompare(b[0]));
  const global = state.region === "all" ? rollup(currentCells()) : null;
  const globalFilters = { region: "all", airlineType: state.airlineType, fleetBand: state.fleetBand };
  const globalEff = global ? systemsFor(global, "eff") : [];
  const globalPlanning = global ? systemsFor(global, "planning") : [];
  const globalRow = global ? `<tr class="airline-global-row" data-global-system-mix><th scope="row"><span class="airline-region-name">Global</span><small class="airline-region-meta">${numberFormat.format(global.airlines)} airlines</small></th><td><small class="airline-global-coverage">${numberFormat.format(global.eff_known)} known</small>${systemDistribution(globalEff, "eff", globalFilters, Math.max(1, globalEff.length))}</td><td><small class="airline-global-coverage">${numberFormat.format(global.planning_known)} known</small>${systemDistribution(globalPlanning, "planning", globalFilters, Math.max(1, globalPlanning.length))}</td></tr>` : "";
  elements.regionReset.hidden = Boolean(global);
  elements.regionNote.textContent = global ? "Recorded selections by airline count" : "Top 3 by airline count · shade indicates rank";
  elements.regionRows.innerHTML = globalRow + (global ? "" : rows.map(([region, summary]) => {
    const filters = { region, airlineType: state.airlineType, fleetBand: state.fleetBand };
    const eff = systemsFor({ eff_systems: summary.effSystems, planning_systems: summary.planningSystems }, "eff");
    const planning = systemsFor({ eff_systems: summary.effSystems, planning_systems: summary.planningSystems }, "planning");
    return `<tr class="${state.region === region ? "is-selected" : ""}"><th scope="row"><button class="airline-region-link" type="button" data-region-select="${escapeHtml(region)}" aria-pressed="${state.region === region}" title="${escapeHtml(region)}"><span class="airline-region-name">${escapeHtml(region)}</span><small class="airline-region-meta">${numberFormat.format(summary.airlines)} airlines · ${numberFormat.format(conferences.get(region) || 0)} events</small></button></th><td>${systemDistribution(eff, "eff", filters)}</td><td>${systemDistribution(planning, "planning", filters)}</td></tr>`;
  }).join(""));
}

function renderProfiles() {
  const profiles = new Map();
  const dimension = { type: "airline_type", fleet: "fleet_band", region: "region" }[state.profileDimension];
  for (const cell of profileCells()) {
    if (state.profileDimension === "fleet" && ["Check value", "Unspecified"].includes(cell.fleet_band)) continue;
    const label = cell[dimension];
    const value = profiles.get(label) || { label, airlines: 0, effKnown: 0, planningKnown: 0, effSystems: new Map(), planningSystems: new Map() };
    value.airlines += cell.airlines;
    value.effKnown += Number(cell.eff_known || 0);
    value.planningKnown += Number(cell.planning_known || 0);
    for (const item of cell.eff_systems || []) value.effSystems.set(item.name, (value.effSystems.get(item.name) || 0) + Number(item.count || 0));
    for (const item of cell.planning_systems || []) value.planningSystems.set(item.name, (value.planningSystems.get(item.name) || 0) + Number(item.count || 0));
    profiles.set(label, value);
  }
  const typePriority = new Map([["Flag Carrier", 0], ["LCC", 1]]);
  const regionPriority = new Map(snapshot.regions.map((region, index) => [region.name, index]));
  const rows = [...profiles.values()].sort((a, b) => state.profileDimension === "type"
    ? (typePriority.get(a.label) ?? 3) - (typePriority.get(b.label) ?? 3) || a.label.localeCompare(b.label)
    : state.profileDimension === "fleet"
      ? snapshot.fleet_bands.indexOf(a.label) - snapshot.fleet_bands.indexOf(b.label)
      : (regionPriority.get(a.label) ?? Number.MAX_SAFE_INTEGER) - (regionPriority.get(b.label) ?? Number.MAX_SAFE_INTEGER));
  const systemField = state.systemMode === "eff" ? "effSystems" : "planningSystems";
  const knownField = state.systemMode === "eff" ? "effKnown" : "planningKnown";
  const systemLabel = state.systemMode === "eff" ? "EFF" : "Flight planning";
  const dimensionTitle = { type: "Carrier type", fleet: "Fleet size", region: "Region" }[state.profileDimension];
  const dimensionLabel = dimensionTitle.toLowerCase();
  const totalSystems = new Map();
  for (const row of rows) {
    for (const [name, count] of row[systemField]) totalSystems.set(name, (totalSystems.get(name) || 0) + count);
  }
  const allSystems = [...totalSystems].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const table = elements.profileHead.closest("table");
  table.style.minWidth = `max(100%, ${150 + allSystems.length * 67}px)`;
  table.style.setProperty("--system-columns", allSystems.length);
  elements.profileNote.textContent = `${state.profileDimension === "fleet" ? "Valid fleet sizes" : "All records"} · ${systemLabel} selections by ${dimensionLabel.toLowerCase()} · count and share of known records`;
  elements.profileHead.innerHTML = `<tr><th>${dimensionTitle} · coverage</th>${allSystems.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}</tr>`;
  elements.profileRows.innerHTML = rows.map((row) => {
    const filters = {
      region: state.profileDimension === "region" ? row.label : state.region,
      airlineType: state.profileDimension === "type" ? row.label : state.airlineType,
      fleetBand: state.profileDimension === "fleet" ? row.label : state.fleetBand,
    };
    const known = row[knownField];
    const selections = row[systemField];
    const coverage = row.airlines ? Math.round(known / row.airlines * 100) : 0;
    const cells = allSystems.map((name) => {
      const count = selections.get(name) || 0;
      if (!count || !known) return '<td><span class="airline-matrix-empty">—</span></td>';
      const share = Math.round(count / known * 100);
      const intensity = Math.min(82, 24 + Math.round(share * 1.65));
      return `<td><button class="airline-matrix-cell" type="button" style="--matrix-intensity:${intensity}%" data-system-name="${escapeHtml(name)}" data-system-mode="${state.systemMode}" data-system-region="${escapeHtml(filters.region)}" data-system-type="${escapeHtml(filters.airlineType)}" data-system-fleet="${escapeHtml(filters.fleetBand)}" aria-label="${numberFormat.format(count)} ${name} selections, ${share}% of ${known} known ${systemLabel} records for ${row.label}"><strong>${numberFormat.format(count)}</strong><small>${share}%</small></button></td>`;
    });
    const rowHeader = `<span class="airline-profile-row-label">${escapeHtml(row.label)}</span><span class="airline-profile-row-meta">${numberFormat.format(row.airlines)} airlines · ${coverage}% ${systemLabel} known</span><span class="airline-profile-coverage"><i style="width:${coverage}%"></i></span>`;
    return `<tr><th scope="row" class="airline-profile-row-header">${rowHeader}</th>${cells.join("")}</tr>`;
  }).join("");
}

function selectedProfiles(filters) {
  return snapshot.airline_profiles.filter((profile) =>
    (filters.region === "all" || profile.region === filters.region)
    && (filters.airlineType === "all" || profile.airline_type === filters.airlineType)
    && (filters.fleetBand === "all" || profile.fleet_band === filters.fleetBand)
  );
}

function renderProviderFootprint() {
  const filters = { region: state.region, airlineType: state.airlineType, fleetBand: state.fleetBand };
  const profiles = selectedProfiles(filters);
  const field = state.providerMode === "eff" ? "eff_systems" : "planning_systems";
  const counts = new Map();
  const available = new Set(snapshot.airline_profiles.flatMap((profile) => profile[field] || []));
  for (const profile of profiles) for (const name of profile[field] || []) counts.set(name, (counts.get(name) || 0) + 1);
  const providers = [...available].map((name) => [name, counts.get(name) || 0]).sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]));
  if (!available.has(state.providerName)) state.providerName = providers[0]?.[0] || "";
  elements.providerSelect.replaceChildren(...(providers.length ? providers.map(([name, count]) => new Option(`${name} (${count})`, name)) : [new Option("No recorded selections", "")]));
  elements.providerSelect.value = state.providerName;
  elements.providerSelect.disabled = !providers.length;
  document.querySelectorAll("[data-provider-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.providerMode === state.providerMode)));
  const result = providerFootprint(profiles, state.providerMode, state.providerName);
  elements.providerPairedHeading.textContent = state.providerMode === "planning" ? "Corresponding EFF systems" : "Corresponding flight-planning systems";
  const scope = state.region === "all" ? "Global" : state.region;
  const selectionLabel = result.matches === 1 ? "selection" : "selections";
  elements.providerScope.textContent = `${scope} · ${numberFormat.format(result.matches)} ${selectionLabel} · ${numberFormat.format(result.known)} known fields`;
  const leading = result.regions.filter((item) => item.count > 0 && item.count === result.regions[0].count);
  elements.providerInsight.textContent = leading.length
    ? `Most recorded selections: ${leading.map((item) => item.name).join(", ")} · ${leading[0].count}${leading.length > 1 ? " each" : ""} of ${result.matches} ${selectionLabel}`
    : "No recorded selections in this view.";

  function renderGroups(target, groups, dimension) {
    target.innerHTML = groups.map((group) => {
      const selected = { ...filters, [dimension]: group.name };
      const share = group.known ? Math.round(group.count / group.known * 100) : 0;
      const label = group.known ? `${group.name}: ${group.count} of ${group.known} known fields (${share}%)` : `${group.name}: no recorded fields`;
      const smallSample = group.known > 0 && group.known < 5;
      return `<button type="button" class="airline-footprint-row" data-footprint-dimension="${dimension}" data-footprint-name="${escapeHtml(group.name)}" data-system-name="${escapeHtml(state.providerName)}" data-system-mode="${state.providerMode}" data-system-region="${escapeHtml(selected.region)}" data-system-type="${escapeHtml(selected.airlineType)}" data-system-fleet="${escapeHtml(selected.fleetBand)}" aria-label="${escapeHtml(label)}${smallSample ? ", small sample" : ""}" title="${escapeHtml(label)}" ${group.count ? "" : "disabled"}><span class="airline-footprint-name">${escapeHtml(group.name)}${smallSample ? ' <small class="airline-footprint-small">n&lt;5</small>' : ""}</span><span class="airline-footprint-track"><i style="width:${share}%"></i></span><span class="airline-footprint-count">${group.known ? `${group.count}/${group.known} · ${share}%` : "No data"}</span></button>`;
    }).join("") || '<p class="airline-footprint-empty muted">No recorded fields</p>';
  }

  renderGroups(elements.providerRegions, result.regions, "region");
  renderGroups(elements.providerTypes, result.carrierTypes, "airlineType");
  renderGroups(elements.providerFleets, result.fleetBands, "fleetBand");
  elements.providerFleetNote.textContent = result.matchesWithoutValidFleet ? `${result.matchesWithoutValidFleet} ${result.matchesWithoutValidFleet === 1 ? "selection" : "selections"} without a valid fleet size` : "";
  elements.providerPairedNote.textContent = `${result.counterpartKnown} of ${result.matches} matched airlines have ${result.counterpartLabel} recorded; ${result.counterpartUnknown} unknown.`;
  elements.providerPairedSystems.innerHTML = result.counterpartSystems.map((item) => {
    const share = Math.round(item.share * 100);
    const label = `${item.name}: ${item.count} of ${item.known} matched airlines with ${result.counterpartLabel} recorded (${share}%)`;
    return `<button type="button" class="airline-footprint-row" data-paired-system="${escapeHtml(item.name)}" data-paired-mode="${state.providerMode === "planning" ? "eff" : "planning"}" data-system-name="${escapeHtml(state.providerName)}" data-system-mode="${state.providerMode}" data-system-region="${escapeHtml(state.region)}" data-system-type="${escapeHtml(state.airlineType)}" data-system-fleet="${escapeHtml(state.fleetBand)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span class="airline-footprint-name">${escapeHtml(item.name)}</span><span class="airline-footprint-track"><i style="width:${share}%"></i></span><span class="airline-footprint-count">${item.count}/${item.known} · ${share}%</span></button>`;
  }).join("") || '<p class="airline-footprint-empty muted">No counterpart systems recorded</p>';
}

function showSystemDetail(mode, name, filters) {
  const systemField = mode === "eff" ? "eff_systems" : "planning_systems";
  const modeLabel = mode === "eff" ? "EFF" : "Flight planning";
  const matches = selectedProfiles(filters).filter((profile) => profile[systemField].includes(name)
    && (!filters.effSystem || profile.eff_systems.includes(filters.effSystem))
    && (!filters.planningSystem || profile.planning_systems.includes(filters.planningSystem)));
  elements.quickLookTitle.textContent = `${modeLabel}: ${name}`;
  elements.quickLookNote.textContent = filters.effSystem || filters.planningSystem
    ? `${numberFormat.format(matches.length)} airlines with these recorded selections · ${filters.region === "all" ? "all regions" : filters.region}`
    : `${numberFormat.format(matches.length)} airlines with this recorded selection · ${filters.region === "all" ? "all regions" : filters.region}`;
  elements.quickLookContent.replaceChildren();
  elements.quickLookRows.innerHTML = matches.map((profile) => `<tr><th scope="row">${escapeHtml(profile.airline)}</th><td>${escapeHtml(profile.country)}</td><td>${escapeHtml(profile.region)}</td><td>${escapeHtml(profile.airline_type)}</td><td>${profile.fleet_size === null ? "Not recorded" : numberFormat.format(profile.fleet_size)}</td><td>${escapeHtml(profile.eff_systems.join(", ") || "Not recorded")}</td><td>${escapeHtml(profile.planning_systems.join(", ") || "Not recorded")}</td></tr>`).join("");
  if (!matches.length) elements.quickLookRows.innerHTML = '<tr><td colspan="7" class="muted">No matching airlines for the selected filters.</td></tr>';
  if (!elements.quickLook.open) elements.quickLook.showModal();
}

function showConferenceAttendees(event) {
  const attendees = event.attending_airlines || [];
  const attendeeNames = new Set(attendees);
  const profiles = snapshot.airline_profiles.filter((profile) => attendeeNames.has(profile.airline));
  elements.quickLookTitle.textContent = `Attendees: ${event.name}`;
  elements.quickLookNote.textContent = `${numberFormat.format(attendees.length)} airlines listed in Conferences Attended${event.date_conflict ? " · event dates conflict" : ""}`;
  elements.quickLookContent.replaceChildren();
  elements.quickLookRows.innerHTML = profiles.map((profile) => `<tr><th scope="row">${escapeHtml(profile.airline)}</th><td>${escapeHtml(profile.country)}</td><td>${escapeHtml(profile.region)}</td><td>${escapeHtml(profile.airline_type)}</td><td>${profile.fleet_size === null ? "Not recorded" : numberFormat.format(profile.fleet_size)}</td><td>${escapeHtml(profile.eff_systems.join(", ") || "Not recorded")}</td><td>${escapeHtml(profile.planning_systems.join(", ") || "Not recorded")}</td></tr>`).join("");
  if (!profiles.length) elements.quickLookRows.innerHTML = '<tr><td colspan="7" class="muted">No airline attendance links are recorded for this event.</td></tr>';
  if (!elements.quickLook.open) elements.quickLook.showModal();
}

function renderConferences() {
  const events = snapshot.conferences.filter(event => (state.region === "all" || event.region === state.region)
      && (state.showAllConferences || (event.attending_airlines || []).length > 0))
    .sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")));
  elements.conferences.innerHTML = events.map(event => {
    const date = event.start_date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${event.start_date}T00:00:00Z`)) : "Date missing";
    const attendingCount = (event.attending_airlines || []).length;
    const attendance = attendingCount
      ? `<button class="airline-attendance-count" type="button" data-conference-name="${escapeHtml(event.name)}">${numberFormat.format(attendingCount)}</button>`
      : "0";
    return `<tr><th scope="row">${escapeHtml(event.name)}</th><td>${date}${event.date_conflict ? ' <span class="muted">Date conflict</span>' : ""}</td><td>${escapeHtml(event.location)}</td><td>${escapeHtml(event.region)}</td><td>${attendance}</td></tr>`;
  }).join("");
  if (!events.length) elements.conferences.innerHTML = `<tr><td colspan="5" class="muted">${state.showAllConferences ? "No conference records for this region." : "No conferences with recorded attendees for this region."}</td></tr>`;
}

function render() {
  renderProfileControls();
  const cells = currentCells();
  const summary = rollup(cells);
  renderKpis(summary);
  renderMarketRead();
  drawMap(cells);
  renderRegions();
  renderProfiles();
  renderProviderFootprint();
  renderConferences();
}

async function boot() {
  const [dataResponse, mapResponse, insightResponse] = await Promise.all([
    fetch("data/airline-insights.json", { cache: "no-store" }),
    fetch("assets/ne_110m_admin_0_countries.geojson", { cache: "force-cache" }),
    fetch("data/airline-insights-ai.json", { cache: "no-store" }).catch(() => null),
  ]);
  if (!dataResponse.ok || !mapResponse.ok) throw new Error("Could not load the Airtable snapshot or map boundaries.");
  unfilteredSnapshot = normalizeMapRegions(excludeNonAirlineEntities(await dataResponse.json()));
  elements.regionReset.addEventListener("click", () => {
    state.region = "all";
    render();
  });
  elements.showAllConferences.addEventListener("change", () => {
    state.showAllConferences = elements.showAllConferences.checked;
    renderConferences();
  });
  mapProviderColors = providerColors(unfilteredSnapshot);
  const alreadyFiltered = unfilteredSnapshot.fleet_filter?.minimum === 10 && unfilteredSnapshot.fleet_filter?.unknown_included;
  elements.fleetFilter.checked = alreadyFiltered || localStorage.getItem("ct-airline-fleet-filter") !== "off";
  const alreadyExcludesChina = unfilteredSnapshot.mainland_china_filter?.version === MAINLAND_CHINA_FILTER_VERSION;
  elements.chinaFilter.checked = alreadyExcludesChina || localStorage.getItem("ct-airline-exclude-mainland-china") === "on";
  elements.fleetFilter.disabled = alreadyFiltered;
  elements.chinaFilter.disabled = alreadyExcludesChina;
  const updateSnapshotFilters = () => {
    localStorage.setItem("ct-airline-fleet-filter", elements.fleetFilter.checked ? "on" : "off");
    localStorage.setItem("ct-airline-exclude-mainland-china", elements.chinaFilter.checked ? "on" : "off");
    snapshot = unfilteredSnapshot;
    if (elements.chinaFilter.checked) snapshot = excludeMainlandChina(snapshot);
    if (elements.fleetFilter.checked) snapshot = applyFleetFilter(snapshot);
    if (state.region !== "all" && !snapshot.region_names.includes(state.region)) state.region = "all";
    if (elements.quickLook.open) elements.quickLook.close();
    render();
  };
  snapshot = unfilteredSnapshot;
  if (elements.chinaFilter.checked) snapshot = excludeMainlandChina(snapshot);
  if (elements.fleetFilter.checked) snapshot = applyFleetFilter(snapshot);
  elements.fleetFilter.addEventListener("change", updateSnapshotFilters);
  elements.chinaFilter.addEventListener("change", updateSnapshotFilters);
  countryFeatures = await mapResponse.json();
  if (insightResponse?.ok) aiInsightSnapshot = await insightResponse.json();
  elements.snapshotDate.textContent = `Snapshot ${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(snapshot.generated_at))}`;
  document.querySelectorAll("[data-airline-map-metric]").forEach(button => button.addEventListener("click", () => {
    state.mapMetric = button.dataset.airlineMapMetric;
    document.querySelectorAll("[data-airline-map-metric]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    render();
  }));
  document.querySelectorAll("[data-airline-system]").forEach(button => button.addEventListener("click", () => {
    state.systemMode = button.dataset.airlineSystem;
    document.querySelectorAll("[data-airline-system]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    render();
  }));
  document.querySelectorAll("[data-profile-dimension]").forEach((button) => button.addEventListener("click", () => {
    state.profileDimension = button.dataset.profileDimension;
    render();
  }));
  document.querySelectorAll("[data-provider-mode]").forEach((button) => button.addEventListener("click", () => {
    state.providerMode = button.dataset.providerMode;
    renderProviderFootprint();
  }));
  elements.providerSelect.addEventListener("change", () => {
    state.providerName = elements.providerSelect.value;
    renderProviderFootprint();
  });
  document.getElementById("airlineQuickLookClose").addEventListener("click", () => elements.quickLook.close());
  document.addEventListener("click", (event) => {
    const conferenceButton = event.target.closest("[data-conference-name]");
    const systemButton = event.target.closest("[data-system-name]");
    const regionButton = event.target.closest("[data-region-select]");
    if (conferenceButton) {
      const conference = snapshot.conferences.find((item) => item.name === conferenceButton.dataset.conferenceName);
      if (conference) showConferenceAttendees(conference);
      return;
    } else if (systemButton) {
      const filters = {
        region: systemButton.dataset.systemRegion || "all",
        airlineType: systemButton.dataset.systemType || "all",
        fleetBand: systemButton.dataset.systemFleet || "all",
      };
      if (systemButton.hasAttribute("data-paired-system")) {
        filters[systemButton.dataset.pairedMode === "eff" ? "effSystem" : "planningSystem"] = systemButton.dataset.pairedSystem;
      }
      showSystemDetail(systemButton.dataset.systemMode, systemButton.dataset.systemName, filters);
      return;
    } else if (regionButton) {
      state.region = state.region === regionButton.dataset.regionSelect ? "all" : regionButton.dataset.regionSelect;
    } else {
      return;
    }
    document.querySelectorAll("[data-airline-system]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.airlineSystem === state.systemMode)));
    render();
  });
  const setTheme = (theme) => {
    const light = theme === "light";
    document.documentElement.dataset.theme = theme;
    elements.themeToggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
    elements.themeToggle.querySelector(".theme-icon").textContent = light ? "◐" : "☼";
    elements.themeToggle.querySelector(".theme-label").textContent = light ? "Dark mode" : "Light mode";
    localStorage.setItem("ct-theme", theme);
  };
  setTheme(localStorage.getItem("ct-theme") === "dark" ? "dark" : "light");
  elements.themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
  render();
}

boot().catch(error => {
  document.querySelector("main").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
