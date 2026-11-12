import { applyFleetFilter } from "./airline-fleet-filter.js";

const dataUrl = "data/airline-insights.json";
const mapUrl = "assets/ne_110m_admin_0_countries.geojson";
const state = { region: "all", airlineType: "all", fleetBand: "all", mapMetric: "airlines", systemMode: "eff", profileDimension: "type" };
const elements = {
  snapshotDate: document.getElementById("airlineSnapshotDate"),
  fleetFilter: document.getElementById("airlineFleetFilter"),
  fleetFilterNote: document.getElementById("airlineFleetFilterNote"),
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
  profileRows: document.getElementById("airlineProfileRows"),
  profileHead: document.getElementById("airlineProfileHead"),
  profileNote: document.getElementById("airlineProfileNote"),
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
  conferenceNote: document.getElementById("conferenceHistoryNote"),
  themeToggle: document.getElementById("themeToggle"),
};
const numberFormat = new Intl.NumberFormat("en-US");
const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_COLORS = ["#dfe8e3", "#b3cbbf", "#7ca997", "#3e8178", "#006568"];
let snapshot;
let unfilteredSnapshot;
let filteredSnapshot;
let countryFeatures;
let aiInsightSnapshot;

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
  elements.mapTooltip.style.left = `${Math.max(8, Math.min(bounds.width - 210, clientX - bounds.left + 12))}px`;
  elements.mapTooltip.style.top = `${Math.max(8, Math.min(bounds.height - 44, clientY - bounds.top + 12))}px`;
}

function hideMapTooltip() {
  elements.mapTooltip.hidden = true;
}

function renderKpis(summary) {
  elements.airlineCount.textContent = numberFormat.format(summary.airlines);
  const fleetScope = snapshot.fleet_filter?.minimum === 10 && snapshot.fleet_filter?.unknown_included
    ? `Fleet 10+ or unknown · ${numberFormat.format(snapshot.fleet_filter.excluded_airlines)} excluded`
    : "All fleet sizes";
  elements.airlineCountNote.textContent = `${numberFormat.format(snapshot.source_record_count)} Airtable source rows · ${fleetScope}`;
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
  const isFresh = !snapshot.fleet_filter?.derived_from_saved_snapshot && aiInsightSnapshot?.snapshot_generated_at === snapshot.generated_at;
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
    return `<button class="airline-mix-link" type="button" data-strength="${index + 1}" title="${escapeHtml(item.name)} · ${numberFormat.format(item.count)} airlines" data-system-name="${escapeHtml(item.name)}" data-system-mode="${mode}" data-system-region="${escapeHtml(filters.region)}" data-system-type="${escapeHtml(filters.airlineType)}" data-system-fleet="${escapeHtml(filters.fleetBand)}"><span class="airline-mix-rank">${index + 1}</span><span class="airline-mix-name">${escapeHtml(item.name)}</span><strong class="airline-mix-count">${numberFormat.format(item.count)}</strong></button>`;
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
  const rows = [...regions].sort((a, b) => b[1].airlines - a[1].airlines || a[0].localeCompare(b[0]));
  elements.regionRows.innerHTML = rows.map(([region, summary]) => {
    const filters = { region, airlineType: state.airlineType, fleetBand: state.fleetBand };
    const eff = systemsFor({ eff_systems: summary.effSystems, planning_systems: summary.planningSystems }, "eff");
    const planning = systemsFor({ eff_systems: summary.effSystems, planning_systems: summary.planningSystems }, "planning");
    return `<tr class="${state.region === region ? "is-selected" : ""}"><th scope="row"><button class="airline-region-link" type="button" data-region-select="${escapeHtml(region)}" aria-pressed="${state.region === region}" title="${escapeHtml(region)}"><span class="airline-region-name">${escapeHtml(region)}</span><small class="airline-region-meta">${numberFormat.format(summary.airlines)} airlines · ${numberFormat.format(conferences.get(region) || 0)} events</small></button></th><td>${systemDistribution(eff, "eff", filters)}</td><td>${systemDistribution(planning, "planning", filters)}</td></tr>`;
  }).join("");
}

function renderProfiles() {
  const profiles = new Map();
  const dimension = { type: "airline_type", fleet: "fleet_band", region: "region" }[state.profileDimension];
  for (const cell of profileCells()) {
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
  elements.profileNote.textContent = `All recorded ${systemLabel} selections by ${dimensionLabel.toLowerCase()} · count and share of known records`;
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

function showSystemDetail(mode, name, filters) {
  const systemField = mode === "eff" ? "eff_systems" : "planning_systems";
  const modeLabel = mode === "eff" ? "EFF" : "Flight planning";
  const matches = selectedProfiles(filters).filter((profile) => profile[systemField].includes(name));
  elements.quickLookTitle.textContent = `${modeLabel}: ${name}`;
  elements.quickLookNote.textContent = `${numberFormat.format(matches.length)} airlines with this recorded selection · ${filters.region === "all" ? "all regions" : filters.region}`;
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
  const events = snapshot.conferences.filter(event => state.region === "all" || event.region === state.region)
    .sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")));
  elements.conferenceNote.textContent = snapshot.coverage.upcoming_conferences_recorded
    ? `${snapshot.coverage.upcoming_conferences_recorded} future event records in the snapshot.`
    : "All recorded conferences are historical; this is coverage context, not event ROI.";
  elements.conferences.innerHTML = events.map(event => {
    const date = event.start_date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${event.start_date}T00:00:00Z`)) : "Date missing";
    const attendingCount = (event.attending_airlines || []).length;
    const attendance = attendingCount
      ? `<button class="airline-attendance-count" type="button" data-conference-name="${escapeHtml(event.name)}">${numberFormat.format(attendingCount)}</button>`
      : "0";
    return `<tr><th scope="row">${escapeHtml(event.name)}</th><td>${date}${event.date_conflict ? ' <span class="muted">Date conflict</span>' : ""}</td><td>${escapeHtml(event.location)}</td><td>${escapeHtml(event.region)}</td><td>${attendance}</td></tr>`;
  }).join("");
  if (!events.length) elements.conferences.innerHTML = '<tr><td colspan="5" class="muted">No conference records for this region.</td></tr>';
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
  renderConferences();
}

async function boot() {
  const [dataResponse, mapResponse, insightResponse] = await Promise.all([
    fetch("data/airline-insights.json", { cache: "no-store" }),
    fetch("assets/ne_110m_admin_0_countries.geojson", { cache: "force-cache" }),
    fetch("data/airline-insights-ai.json", { cache: "no-store" }).catch(() => null),
  ]);
  if (!dataResponse.ok || !mapResponse.ok) throw new Error("Could not load the Airtable snapshot or map boundaries.");
  unfilteredSnapshot = await dataResponse.json();
  const alreadyFiltered = unfilteredSnapshot.fleet_filter?.minimum === 10 && unfilteredSnapshot.fleet_filter?.unknown_included;
  filteredSnapshot = applyFleetFilter(unfilteredSnapshot);
  elements.fleetFilter.checked = alreadyFiltered || localStorage.getItem("ct-airline-fleet-filter") !== "off";
  elements.fleetFilter.disabled = alreadyFiltered;
  if (alreadyFiltered) elements.fleetFilterNote.textContent = "All fleet sizes will be available after the next Airtable refresh";
  snapshot = elements.fleetFilter.checked ? filteredSnapshot : unfilteredSnapshot;
  elements.fleetFilter.addEventListener("change", () => {
    localStorage.setItem("ct-airline-fleet-filter", elements.fleetFilter.checked ? "on" : "off");
    snapshot = elements.fleetFilter.checked ? filteredSnapshot : unfilteredSnapshot;
    if (elements.quickLook.open) elements.quickLook.close();
    render();
  });
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
