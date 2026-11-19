"""Prepare the checked-in Huron inset with GDAL's Python bindings (optional).

Pass saved Natural Earth v5.1.2 ne_10m_lakes.geojson and Ontario Hydro Network
Waterbody features requested with the parameters below to regenerate offline.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from osgeo import ogr

ROOT = Path(__file__).resolve().parents[1]
NATURAL_EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson"
SERVICE = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/25/query?"
DETAIL = (-81.89, 45.13, -81.43, 45.46)
QUERY = {"where": "1=1", "geometry": ",".join(str(n) for n in DETAIL), "geometryType": "esriGeometryEnvelope",
         "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"}


def box(west, south, east, north):
    return ogr.CreateGeometryFromWkt(f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))")


def load(url, cached):
    if cached:
        return json.loads(cached.read_text())
    with urlopen(url, timeout=90) as stream:
        return json.load(stream)


def dry_land(bounds, collection):
    result = bounds.Clone()
    for feature in collection["features"]:
        geometry = ogr.CreateGeometryFromJson(json.dumps(feature["geometry"]))
        if not geometry.Intersects(bounds):
            continue
        if not geometry.IsValid():
            geometry = geometry.MakeValid()
        result = result.Difference(geometry.Intersection(bounds))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lakes", type=Path)
    parser.add_argument("--hydro", type=Path)
    options = parser.parse_args()
    params = {**QUERY, "f": "geojson", "outSR": 4326, "outFields": "OBJECTID",
              "maxAllowableOffset": .00012, "geometryPrecision": 5}
    source = load(SERVICE + urlencode(params), options.hydro)
    if not options.hydro:
        ids = load(SERVICE + urlencode({**QUERY, "f": "json", "returnIdsOnly": "true"}), None)["objectIds"]
        if {f["properties"]["OBJECTID"] for f in source["features"]} != set(ids):
            raise ValueError("Incomplete Ontario Hydro Network download")
    context = dry_land(box(-84, 43, -79, 47), load(NATURAL_EARTH, options.lakes)).SimplifyPreserveTopology(.0005)
    window = box(*DETAIL)
    shore = context.Difference(window).Union(dry_land(window, source))
    geo = json.loads(shore.ExportToJson())
    shapes = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
    points = [[[[round(x, 5), round(y, 5)] for x, y in ring] for ring in poly] for poly in shapes]
    (ROOT / "web/huron-land.json").write_text(json.dumps(points, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    ogr.UseExceptions()
    main()
