#!/usr/bin/env python3
"""Build a static explorer from Nova Scotia's official CSV and map layer."""

import argparse
from collections import defaultdict
import csv
from datetime import date, datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import sys
import time
import unicodedata
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PORTAL = "https://data.novascotia.ca/Arts-Culture-and-History/Marine-Heritage-Shipwrecks-Database/rq3a-h5hk"
CSV_URL = "https://data.novascotia.ca/api/views/rq3a-h5hk/rows.csv?accessType=DOWNLOAD"
META_URL = "https://data.novascotia.ca/api/views/rq3a-h5hk.json"
ARCGIS = "https://services7.arcgis.com/guiEgv5T1fmjU8SW/arcgis/rest/services/CUL_NS_Shipwrecks_WM84_PROD/FeatureServer/0"
MAP_ITEM = "https://www.arcgis.com/home/item.html?id=b98081aed2db421eb35cc962068feb3a"
MAP_VIEW = "https://experience.arcgis.com/experience/eac46ae693a3468994ae0697a0c03f40"
LICENSE = "https://support.novascotia.ca/services/open-data-portal-licence"
PAGE_SIZE = 1800
CORE_FIELDS = ("Vessel Name", "Date of Wreck", "Event", "Location of wreck")
MAP_FIELDS = ("Vessel_Name", "Date_of_Wreck", "Location_of_wreck")
EXTRA_FIELDS = {
    "Tonage": "Tonnage", "Length_FT": "Length (FT)", "Breadth_FT": "Breadth (FT)",
    "Depth_FT": "depth (ft)", "Masts": "Masts", "Decks": "Decks", "Hull": "Hull",
    "Signal_Letters": "Signal letters", "Description": "Description", "Story": "Story",
    "Vessel_Type": "Vessel Type", "Type_of_Event": "Type of event", "Nature_of_Event": "Nature of Event",
    "Cause_of_Event": "Cause of Event", "Cargo": "Cargo", "Lives_Lost": "Lives Lost",
    "Voyage_from": "Voyage from", "Voyage_To": "Voyage To", "Remarks": "Remarks",
    "Built_At": "Built At", "Construction_Date": "Date Built", "Official_Number": "Official Number",
    "Registered_at": "Registered at", "Registry_Date": "Date Registered",
    "Propulsion": "Propulsion", "Rig": "Rig", "Details": "Details",
}


def fetch(url, filename, inputs=None):
    if inputs is not None:
        return (inputs / filename).read_bytes()
    request = Request(url, headers={"User-Agent": "CoolCode-ShipwreckExplorer/1.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                body = response.read(30 * 1024 * 1024 + 1)
            if not body or len(body) > 30 * 1024 * 1024:
                raise ValueError(f"Empty or oversized download: {url}")
            return body
        except (OSError, URLError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def fetch_json(url, filename, inputs):
    data = json.loads(fetch(url, filename, inputs))
    if not isinstance(data, dict) or "error" in data:
        raise ValueError(f"Unexpected JSON from {url}: {str(data)[:240]}")
    return data


def arcgis_query(**kwargs):
    return ARCGIS + "/query?" + urlencode({"f": "json", "where": "1=1", **kwargs})


def load_map(inputs):
    count = fetch_json(arcgis_query(returnCountOnly="true"), "map-count.json", inputs)["count"]
    if not isinstance(count, int) or not 1000 <= count <= 50000:
        raise ValueError(f"Unexpected map record count: {count!r}")
    by_key = defaultdict(list)
    ids = set()
    for offset in range(0, count, PAGE_SIZE):
        url = arcgis_query(outFields="*", orderByFields="OBJECTID", resultOffset=offset,
                           resultRecordCount=PAGE_SIZE, outSR=4326)
        features = fetch_json(url, f"map-{offset}.json", inputs)["features"]
        for feature in features:
            attributes = feature["attributes"]
            record_id = attributes["OBJECTID"]
            if record_id in ids:
                raise ValueError(f"Duplicate map record ID: {record_id}")
            ids.add(record_id)
            by_key[join_key(attributes.get(k) for k in MAP_FIELDS)].append(feature)
    if len(ids) != count:
        raise ValueError(f"Incomplete map download: expected {count}; received {len(ids)}")
    return by_key


def clean(value):
    return " ".join(str(value if value is not None else "").split())


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKC", clean(value)).casefold() if c.isalnum())


def join_key(values):
    return tuple(normalize(v) for v in values)


def index_text(parts):
    text = unicodedata.normalize("NFKD", " ".join(parts).lower())
    plain = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(re.findall(r"[^\W_]+", plain, re.UNICODE))


def year_of(raw):
    try:
        value = date.fromisoformat(raw[:10])
        return value.year, value.isoformat()
    except ValueError:
        # Keep a year when it was the only date detail recorded.
        return (int(raw), raw) if re.fullmatch(r"[1-2]\d{3}", raw) else (None, raw)


def point_of(feature):
    geometry = feature.get("geometry") or {}
    x, y = geometry.get("x"), geometry.get("y")
    # Limit the interactive atlas to Atlantic Canada and nearby waters.
    if isinstance(x, (int, float)) and isinstance(y, (int, float)) and -83 <= x <= -42 and 36 <= y <= 58:
        return [round(x, 4), round(y, 4)]
    return None


def import_records(raw, by_key):
    rows = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    if not rows.fieldnames or not set(CORE_FIELDS).issubset(rows.fieldnames):
        raise ValueError("Shipwreck CSV schema changed or its download is invalid.")
    records = []
    ids = defaultdict(int)
    for row in rows:
        if None in row or any(row.get(field) is None for field in CORE_FIELDS):
            raise ValueError(f"Incomplete shipwreck record at CSV line {rows.line_num}.")
        raw_name, raw_date, event, place = [clean(row[field]) for field in CORE_FIELDS]
        if not raw_name:
            raise ValueError(f"Missing vessel name at CSV line {rows.line_num}.")
        name = re.sub(r"\s*[-–]\s*(?:\d{4})?\s*$", "", raw_name) or raw_name
        year, wreck_date = year_of(raw_date)
        key = join_key((raw_name, raw_date, place))
        matches = by_key.get(key, [])
        feature = matches[0] if len(matches) == 1 else {}
        details = {field: clean(value) for field, value in row.items() if field not in CORE_FIELDS and clean(value)}
        attrs = feature.get("attributes", {})
        for field, label in EXTRA_FIELDS.items():
            value = clean(attrs.get(field))
            if label not in details and value and (value != "0" or field == "Lives_Lost"):
                details[label] = value
        key_string = "\n".join((raw_name.casefold(), raw_date, place.casefold(), event.casefold()))
        slug = hashlib.sha256(key_string.encode()).hexdigest()[:16]
        ids[slug] += 1
        if ids[slug] > 1:
            slug += f"-{ids[slug]}"
        records.append({
            "id": slug, "name": name, "sourceName": row["Vessel Name"], "date": wreck_date, "year": year,
            "event": event, "place": place, "details": details, "mapId": attrs.get("OBJECTID"),
            "point": point_of(feature), "search": index_text([raw_name, wreck_date, event, place, *details.values()]),
        })
    if len(records) < 1000:
        raise ValueError(f"Shipwreck export appears incomplete: {len(records)} records.")
    return records


PARK_GUIDE = "https://parks.canada.ca/amnc-nmca/on/fathomfive/activ/plong-dive"
SITE_TABLE = "https://parkscanadahistory.com/publications/fathomfive/brochures/dive-snorkel-guide-e-2024.pdf"


def degrees(value):
    deg, mins, secs = map(int, value.split())
    if not (0 <= mins < 60 and 0 <= secs < 60):
        raise ValueError("Invalid coordinate in Parks Canada site table")
    return round(deg + mins/60 + secs/3600, 5)


def ontario_records():
    rows = []
    with (ROOT / "scripts/fathom-five.csv").open(encoding="utf-8", newline="") as file:
        for site in csv.DictReader(file):
            number = int(site["site"])
            when = site["date"]
            details = {"Collection": "Fathom Five and Tobermory, Ontario", "Parks Canada site": str(number)}
            if number == 20:
                details["Location note"] = ("The 2024 brochure’s site coordinate plots slightly inland on the Ontario "
                                            "Hydro Network shoreline. The marker preserves the printed reference.")
            if site["type"]:
                details["Vessel type"] = site["type"]
            point = [-degrees(site["longitude_dms"]), degrees(site["latitude_dms"])]
            if not (-82 < point[0] < -81 and 45 < point[1] < 46):
                raise ValueError("Position outside the Tobermory guide area")
            place = site["place"] + ", Lake Huron, Ontario"
            rows.append({"id": f"on-fathom-{number}", "name": site["name"], "date": when,
                         "year": int(when[:4]) if when else None, "event": site["event"], "place": place,
                         "point": point, "details": details, "mapId": None, "region": "ON",
                         "source": PARK_GUIDE + ("/activ2a" if number in (1, 2) else ""),
                         "search": index_text([site["name"], when, site["event"], place, *details.values()])})
    if len(rows) != len({r["id"] for r in rows}) or len(rows) < 18:
        raise ValueError("Incomplete Fathom Five site edition")
    return rows


def timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if isinstance(value, (int, float)) and value > 0 else None


def build(out, inputs):
    if out == ROOT or out in ROOT.parents or out == ROOT / "web" or ROOT / "web" in out.parents:
        raise ValueError("Choose a dedicated build output directory.")
    raw = fetch(CSV_URL, "wrecks.csv", inputs)
    metadata = fetch_json(META_URL, "source.json", inputs)
    if metadata.get("id") != "rq3a-h5hk" or metadata.get("licenseId") != "OGL_NOVA_SCOTIA":
        raise ValueError("Shipwreck dataset ID or licence differs from the expected source.")
    rows = import_records(raw, load_map(inputs))
    mapped = sum(row["point"] is not None for row in rows)
    if mapped < len(rows) // 2:
        raise ValueError(f"Only {mapped} rows join to in-range map coordinates; source compatibility changed.")
    for row in rows:
        row["region"] = "NS"
    ontario = ontario_records()
    rows.extend(ontario)
    mapped += len(ontario)
    snapshot = {
        "meta": {
            "source": PORTAL, "csv": CSV_URL, "map": MAP_VIEW, "mapItem": MAP_ITEM,
            "mapService": ARCGIS, "licence": LICENSE,
            "sourceUpdated": timestamp(metadata.get("rowsUpdatedAt")),
            "metadataUpdated": timestamp(metadata.get("viewLastModified")),
            "checked": datetime.now(timezone.utc).isoformat(),
            "csvSha256": hashlib.sha256(raw).hexdigest(),
            "count": len(rows), "mapped": mapped, "ontarioGuide": SITE_TABLE, "ontarioCount": len(ontario),
        },
        "rows": rows,
    }
    # Prepare all downloads and check counts before touching the prior build.
    out.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / "web", out, dirs_exist_ok=True)
    (out / "data").mkdir(exist_ok=True)
    payload = out / "data" / "wrecks.json"
    staging = payload.with_suffix(".tmp")
    staging.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    staging.replace(payload)
    nearby = {
        "meta": snapshot["meta"],
        "rows": [{field: row[field] for field in ("id", "name", "date", "place", "point", "mapId")}
                 for row in rows if row["point"] is not None],
    }
    staging.write_text(json.dumps(nearby, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    staging.replace(out / "data" / "nearby.json")
    print(f"Built {len(rows):,} records; {mapped:,} plotted. Data file: {payload.stat().st_size:,} bytes.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--inputs", type=Path, help="Use saved official CSV, metadata and ArcGIS response files.")
    args = parser.parse_args()
    try:
        build(args.output.resolve(), args.inputs)
    except (ValueError, OSError, KeyError, TypeError, csv.Error) as exc:
        print(f"Build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
