import { WreckMap } from "./map.js";

const $ = id => document.getElementById(id);
const formatCount = value => value.toLocaleString("en-CA");
const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" });
const PAGE_SIZE = 10;
const ERAS = {
  before: [0, 1799], "1800s": [1800, 1849], "1850s": [1850, 1899],
  "1900s": [1900, 1949], "1950s": [1950, Infinity]
};
const exhibit = "https://archives.novascotia.ca/shipwrecks/";
const apiSource = "https://data.novascotia.ca/resource/rq3a-h5hk.json";

let rows = [];
let byId = new Map();
let meta;
let shown = [];
let page = 1;
let period = null;
let firstYear = 0;
let lastYear = 0;
let currentRecord = null;

function element(tag, content, css) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (css) node.className = css;
  return node;
}

function button(label, callback, css = "light-button") {
  const node = element("button", label, css);
  node.type = "button";
  node.addEventListener("click", callback);
  return node;
}

function link(label, href) {
  const node = element("a", label);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function plain(value) {
  return (value || "").normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function terms(query) {
  return [...query.matchAll(/"([^"]*)"?|“([^”]*)”?|([^\s"]+)/gu)]
    .map(match => plain(match[1] ?? match[2] ?? match[3])).filter(Boolean);
}

function displayDate(raw, fallback = "Date not recorded") {
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}/u.test(raw)) {
    const dt = new Date(raw.slice(0, 10) + "T12:00:00Z");
    if (!Number.isNaN(dt.valueOf())) return dateFormat.format(dt);
  }
  return raw;
}

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status} when loading ${path}`);
  return response.json();
}

function clearPointPicker() {
  $("selected-points").hidden = true;
  $("selected-points").replaceChildren();
}

const map = new WreckMap($("map"), () => {
  if (!meta) return;
  if ($("map-filter").checked) update(true);
  else updateMapCount();
}, section => {
  if (section.length === 1) {
    openRecord(section[0]);
    return;
  }
  const picker = $("selected-points");
  const heading = element("p", `${formatCount(section.length)} records in this cluster${section.length > 24 ? " · showing first 24" : ""}`);
  picker.replaceChildren(heading);
  for (const row of section.slice(0, 24)) {
    picker.append(button(`${row.name}${row.year ? ` · ${row.year}` : ""}`, () => openRecord(row), "light-button point-link"));
  }
  picker.hidden = false;
});

function updateMapCount() {
  const visible = shown.reduce((count, row) => count + Number(map.visible(row.point)), 0);
  const mapped = shown.reduce((count, row) => count + Number(Boolean(row.point)), 0);
  $("map-count").textContent = `${formatCount(visible)} in view · ${formatCount(mapped)} with map positions`;
}

function inEra(row, era) {
  if (!era) return true;
  if (era === "undated") return !row.year;
  return row.year && row.year >= ERAS[era][0] && row.year <= ERAS[era][1];
}

function update(resetPage = false) {
  if (!meta) return;
  if (resetPage) page = 1;
  clearPointPicker();
  const query = terms($("query").value);
  const event = $("event").value;
  const era = $("era").value;
  const inView = $("map-filter").checked;
  const candidates = rows.filter(row => (
    (!event || row.event === event) &&
    inEra(row, era) &&
    (!inView || map.visible(row.point)) &&
    query.every(term => row.search.includes(term))
  ));

  shown = period ? candidates.filter(row => row.year >= period && row.year < period + 25) : candidates;
  const sort = $("sort").value;
  const descending = (a, b) => (b.date || "").localeCompare(a.date || "") || a.name.localeCompare(b.name);
  if (sort === "old") {
    shown.sort((a, b) => !a.date ? (b.date ? 1 : a.name.localeCompare(b.name)) : !b.date ? -1 : -descending(a, b));
  } else if (sort === "name") {
    shown.sort((a, b) => a.name.localeCompare(b.name, "en-CA") || descending(a, b));
  } else if (sort === "relevance" && query.length) {
    const phrase = query.join(" ");
    const score = row => (row.nameKey === phrase ? 60 : row.nameKey.includes(phrase) ? 25 : 0) +
      query.reduce((sum, term) => sum + (row.nameKey.includes(term) ? 4 : 0), 0);
    shown.sort((a, b) => score(b) - score(a) || descending(a, b));
  } else {
    shown.sort(descending);
  }

  if (inView) {
    // Keep the same points available for panning even when the result list is clipped.
    const base = rows.filter(row => (!event || row.event === event) && inEra(row, era) &&
      (!period || (row.year >= period && row.year < period + 25)) && query.every(term => row.search.includes(term)));
    map.setRows(base);
  } else {
    map.setRows(shown);
  }
  updateMapCount();
  renderTimeline(candidates);
  renderRows();
}

function renderTimeline(candidates) {
  const bins = [];
  const counts = new Map();
  for (const row of candidates) {
    if (!row.year) continue;
    const start = row.year - row.year % 25;
    counts.set(start, (counts.get(start) || 0) + 1);
  }
  for (let year = firstYear; year <= lastYear; year += 25) bins.push([year, counts.get(year) || 0]);
  const max = Math.max(1, ...bins.map(([, n]) => n));
  const bars = element("div", null, "timeline-bars");
  for (const [year, n] of bins) {
    const caption = `${year}–${year + 24}: ${formatCount(n)} ${n === 1 ? "wreck" : "wrecks"}`;
    const bar = button("", () => {
      period = period === year ? null : year;
      update(true);
      const sameBar = $("timeline").querySelector(`[data-year="${year}"]`);
      if (sameBar && !sameBar.disabled) sameBar.focus({ preventScroll: true });
    });
    bar.style.height = `${Math.max(5, (n / max) * 100)}%`;
    bar.dataset.year = year;
    bar.title = caption;
    bar.setAttribute("aria-label", caption);
    bar.setAttribute("aria-pressed", String(period === year));
    bar.disabled = !n && period !== year;
    bars.append(bar);
  }
  const labels = element("div", null, "timeline-labels");
  labels.append(element("span", firstYear), element("span", Math.round((firstYear + lastYear) / 2 / 25) * 25), element("span", lastYear + 24));
  $("timeline").replaceChildren(bars, labels);
  $("timeline-clear").hidden = !period;
  const missing = candidates.filter(row => !row.year).length;
  const undated = missing ? ` ${formatCount(missing)} undated ${missing === 1 ? "record isn’t" : "records aren’t"} charted.` : "";
  $("timeline-note").textContent = period
    ? `Showing ${period}–${period + 24}.${undated}`
    : `Select a 25-year period to narrow your results.${undated}`;
}

function renderRows() {
  if (!meta) return;
  const fragment = document.createDocumentFragment();
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  page = Math.min(page, pageCount);
  $("status").textContent = `${formatCount(shown.length)} ${shown.length === 1 ? "record" : "records"}${period ? ` from ${period}–${period + 24}` : ""}`;
  if (!shown.length) {
    const empty = element("div", null, "empty");
    empty.append(element("h3", "No records match"), element("p", "Try a shorter vessel name, another spelling, or a wider period. Map filtering excludes wrecks without a plotted position."));
    empty.append(button("Clear filters", resetFilters));
    fragment.append(empty);
  }
  for (const row of shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
    const article = element("article", null, "wreck-row");
    const left = element("div");
    const heading = element("h3");
    heading.append(button(row.name, () => openRecord(row), "row-open"));
    const right = element("div");
    const time = element(row.date ? "time" : "span", displayDate(row.date, "Undated"), "row-date");
    if (row.date) time.dateTime = row.date;
    right.append(time);
    if (row.point) right.append(element("p", "On map", "mark"));
    left.append(heading, element("p", [row.event || "Event not recorded", row.place || "Location not recorded"].join(" · ")));
    article.append(left, right);
    fragment.append(article);
  }
  $("result-list").replaceChildren(fragment);
  $("pagination").hidden = pageCount <= 1;
  $("prev").disabled = page <= 1;
  $("next").disabled = page >= pageCount;
  $("page-info").textContent = `Page ${formatCount(page)} / ${formatCount(pageCount)}`;
}

function resetFilters() {
  $("filters").reset();
  $("map-filter").checked = false;
  period = null;
  update(true);
  $("query").focus();
}

function rawRecordURL(row) {
  const where = `vessel_name = '${row.sourceName.replaceAll("'", "''")}'`;
  return `${apiSource}?${new URLSearchParams({ "$where": where })}`;
}

function openRecord(row, writeHash = true) {
  const dialog = $("record");
  $("record-name").textContent = row.name;
  const summary = element("p", [displayDate(row.date), row.event || "Event not recorded", row.place || "Location not recorded"].join(" · "));
  const fields = element("dl");
  for (const [label, value] of Object.entries(row.details)) {
    fields.append(element("dt", label), element("dd", value));
  }
  const list = element("div", null, "links");
  if (row.point) {
    list.append(button("Show on map", () => {
      dialog.close();
      // Retain filters for normal selected results. Clear them only if a linked record is not in the search.
      if (!shown.some(record => record.id === row.id)) {
        $("filters").reset();
        $("map-filter").checked = false;
        period = null;
        update(true);
      }
      map.focus(row.point);
      $("map").scrollIntoView({ block: "center" });
      $("map").focus({ preventScroll: true });
    }));
  }
  if (row.point) {
    const [lon, lat] = row.point;
    const search = new URLSearchParams({ nearLat: lat, nearLon: lon, nearKm: 25 });
    const nearby = link("Find nearby wrecks and historic places ↗", `../forgottenplaces/?${search}#nearby`);
    list.append(nearby);
  }
  if (row.mapId != null) {
    const mapHash = `#data_s=id%3AdataSource_3-19db53b0d64-layer-3%3A${row.mapId}`;
    list.append(link("Open official map record ↗", meta.map + mapHash));
  }
  list.append(link("View official CSV row as JSON ↗", rawRecordURL(row)));
  if (row.nameKey === "ss atlantic") list.append(link("Nova Scotia Archives exhibit ↗", exhibit));
  const share = element("p");
  share.setAttribute("role", "status");
  list.append(button("Copy record link", async () => {
    const url = new URL(window.location.href);
    url.hash = `wreck=${row.id}`;
    try {
      await navigator.clipboard.writeText(url.href);
      share.textContent = "Record link copied.";
    } catch {
      share.textContent = url.href;
    }
  }));
  const note = row.point ? "The position on the map is approximate." : "No position from the official layer is plotted for this record.";
  $("record-body").replaceChildren(summary, ...(fields.children.length ? [fields] : []), element("p", note), list, share);
  currentRecord = row.id;
  if (writeHash) history.replaceState(null, "", `#wreck=${row.id}`);
  if (!dialog.open) dialog.showModal();
}

function openFromHash() {
  if (!location.hash.startsWith("#wreck=")) return;
  const row = byId.get(location.hash.slice(7));
  if (row) openRecord(row, false);
  else $("status").textContent = "That record link is unavailable in this snapshot. Try searching the vessel name.";
}

$("record").addEventListener("close", () => {
  if (location.hash === `#wreck=${currentRecord}`) history.replaceState(null, "", location.pathname + location.search);
  currentRecord = null;
});
window.addEventListener("hashchange", () => { if (meta) openFromHash(); });
$("filters").addEventListener("submit", event => event.preventDefault());
$("query").addEventListener("input", () => update(true));
for (const id of ["event", "era", "sort", "map-filter"]) $(id).addEventListener("change", () => {
  if (id === "era") period = null;
  update(true);
});
$("clear").addEventListener("click", resetFilters);
$("timeline-clear").addEventListener("click", () => {
  period = null;
  update(true);
  $("timeline").querySelector("button:enabled")?.focus({ preventScroll: true });
});
$("map-home").addEventListener("click", () => map.reset());
$("zoom-in").addEventListener("click", () => map.magnify(1.5));
$("zoom-out").addEventListener("click", () => map.magnify(1 / 1.5));
$("prev").addEventListener("click", () => { page--; renderRows(); $("results-heading").focus(); });
$("next").addEventListener("click", () => { page++; renderRows(); $("results-heading").focus(); });
for (const seed of document.querySelectorAll("[data-search]")) {
  seed.addEventListener("click", () => {
    resetFilters();
    $("query").value = seed.dataset.search;
    $("query").scrollIntoView({ block: "center" });
    update(true);
  });
}

async function start() {
  try {
    const snapshot = await getJson("./data/wrecks.json");
    if (!snapshot?.meta || !Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length !== snapshot.meta.count) {
      throw new Error("The archive data is missing or incomplete.");
    }
    meta = snapshot.meta;
    rows = snapshot.rows.map(row => ({ ...row, nameKey: plain(row.name) }));
    byId = new Map(rows.map(row => [row.id, row]));
    const years = rows.map(row => row.year).filter(Boolean);
    const earliest = years.length ? Math.min(...years) : 1500;
    const latest = years.length ? Math.max(...years) : 2000;
    firstYear = earliest - earliest % 25;
    lastYear = latest - latest % 25;
    const rawEvents = new Set(rows.map(row => row.event).filter(Boolean));
    for (const event of [...rawEvents].sort((a, b) => a.localeCompare(b, "en-CA"))) {
      const option = element("option", event);
      option.value = event;
      $("event").append(option);
    }
    $("coverage").textContent = `${formatCount(rows.length)} records · ${earliest}–${latest}`;
    const age = (Date.now() - Date.parse(meta.checked)) / 86400000;
    $("source-dates").textContent = [
      `Source data updated ${displayDate(meta.sourceUpdated, "on an unreported date")}.`,
      `Snapshot checked ${displayDate(meta.checked, "on an unreported date")}.`,
      ...(age > 4 ? ["The snapshot check is more than four days old. Use the official dataset for the latest publication."] : [])
    ].join(" ");
    update(true);
    openFromHash();
  } catch (error) {
    console.error(error);
    $("status").textContent = "The archive could not load.";
    $("coverage").textContent = "Archive unavailable";
    $("map-count").textContent = "No map points loaded";
    const empty = element("div", null, "empty");
    empty.append(element("h3", "Try again or browse the source"), element("p", "The latest published snapshot may be temporarily unavailable."));
    empty.append(button("Reload page", () => location.reload()));
    $("result-list").replaceChildren(empty);
  }
}

getJson("./shoreline.json").then(polygons => map.landShape(polygons)).catch(() => {
  $("map").insertAdjacentElement("afterend", element("p", "Coastline unavailable. Wreck positions can still appear on the grid.", "map-note"));
});
start();
