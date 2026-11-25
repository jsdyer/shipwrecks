# Shipwreck Explorer

Explore Nova Scotia’s Marine Heritage Shipwrecks Database and Ontario’s Tobermory-area wreck sites through vessel names, wreck dates, recorded events, coastal locations, an interactive map and a filterable timeline.

<!-- coolcode:guide -->
Choose Ontario · Tobermory to map 18 Parks Canada sites. Open Arabia to see its recorded loss and the original site guide, or return to the Nova Scotia archive to compare wrecks around Sable Island.
<!-- /coolcode:guide -->

- The search matches vessel names, places, events, dates and available vessel details. Use quotes for a phrase.
- Choose a 25-year interval in the timeline or filter by era and event. Zoom or pan the map and select **Search this map view** to limit results to the visible positions.
- Open a vessel record to see its available details, copy a direct explorer link, and follow the government’s own map or data row.

## Data and coverage

The application uses the [official dataset](https://data.novascotia.ca/Arts-Culture-and-History/Marine-Heritage-Shipwrecks-Database/rq3a-h5hk), its [full public SODA3 CSV export](https://data.novascotia.ca/api/v3/views/rq3a-h5hk/export.csv), and [Socrata metadata](https://data.novascotia.ca/api/views/rq3a-h5hk.json). The export needs no API key and replaces the retired `rows.csv` download. The portal links to the [official map](https://experience.arcgis.com/experience/eac46ae693a3468994ae0697a0c03f40), which uses a separate [licensed map layer](https://www.arcgis.com/home/item.html?id=b98081aed2db421eb35cc962068feb3a). The builder joins unambiguous vessel name, event date and location matches across those sources after normalizing spelling punctuation, but does not guess at conflicts or missing coordinates. It retains every CSV row. The map uses approximate published locations within its Atlantic Canada extent. Additional vessel fields are shown only when available.

The Nova Scotia snapshot contains 4,939 records dated 1583–2001, with 4,019 records plotted. It has 54 records dated August 24, 1873. It covers a portion of known shipwrecks. Dates and events are recorded as published, including records where the vessel was later refloated or repaired. See the [Nova Scotia Archives exhibit](https://archives.novascotia.ca/shipwrecks/) for historical context and images.

Contains information licensed under the [Open Government Licence – Nova Scotia](https://support.novascotia.ca/services/open-data-portal-licence). Base coastline is a cropped, simplified version of Natural Earth 1:10m land [v5.1.2](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2), [public domain](https://www.naturalearthdata.com/about/terms-of-use/).

## Build and refresh

The build uses Python 3’s standard library. GitHub Pages serves the generated files, and search, map and timeline interactions run in the browser.

```sh
python3 -m unittest discover -s tests -v
python3 scripts/build.py
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080/`. Use `--output` for an alternate build directory. Build inputs are downloaded from the official CSV, metadata and map endpoints. For reproducible checks with saved official responses, `--inputs <directory>` accepts `wrecks.csv`, `source.json`, `map-count.json`, and a `map-{offset}.json` file for each 1,800-feature page. The output includes a normalized searchable field for each record, the CSV checksum, and separate dataset-update and snapshot-check dates.

The GitHub Actions workflow checks for source updates daily and can also be run manually from **Actions**. It builds and uploads `dist/` as a GitHub Pages artifact. A failed download, unexpected schema or partial map download fails the build before upload, so the previous successful deployment stays available. The source dates in the footer distinguish the province’s last data update from the most recent successful download. GitHub Pages uses GitHub Actions as the publishing source, with the custom domain inherited from the existing CoolCode.ca site.

**Nearby heritage** opens a radius search that combines plotted wrecks and matched Canadian Register of Historic Places entries in [Forgotten Places](https://coolcode.ca/forgottenplaces/#nearby). Plotted vessel records can start that search at the wreck's published approximate coordinates. The build publishes `data/nearby.json` as a compact index for the shared view.


## Ontario collection

Choose **Ontario · Tobermory** or the Tobermory shortcut to see 18 wreck sites in and near Fathom Five. The result list, map-view search, timeline, vessel details and nearby index include this collection. Month-only, year-only and missing dates retain their original precision. Deliberate sinkings and relocated wrecks are identified separately.

The maintained site edition in `scripts/fathom-five.csv` pairs factual vessel details in Parks Canada’s [Fathom Five guide](https://parks.canada.ca/amnc-nmca/on/fathomfive/activ/plong-dive) and [harbour guide](https://parks.canada.ca/amnc-nmca/on/fathomfive/activ/plong-dive/activ2a) with numbered site locations in its [2024 Dive and Snorkel brochure](https://parks.canada.ca/-/media/pn-np/on/bruce/wet4/pdf/dive-guide-ffnmp.pdf). Positions are historical site references. For the Minch this edition uses the inner site. The Caroline Rose record flags a discrepancy between the brochure position and the provincial shoreline. The map uses a regional clipping of Natural Earth v5.1.2 [1:10m lakes](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_lakes.geojson). The Nova Scotia input refresh runs daily and the Ontario edition is reviewed against new guides.

The local Tobermory inset uses the [Ontario Hydro Network Waterbody layer](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/25) under the [Open Government Licence – Ontario](https://www.ontario.ca/page/open-government-licence-ontario). It retains harbour and island boundaries at the wreck-site zoom level. To regenerate the two-scale bundled geometry, use Python with GDAL bindings and run `python3 scripts/build_huron_shoreline.py`. The daily wreck refresh uses the checked-in geometry.

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
