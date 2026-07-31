#!/usr/bin/env bash
# Fetches MTB-related paths for Medicine Hat / Redcliff / Elkwater-Cypress from OSM
set -euo pipefail
OUT="assets/trails/region.geojson"
mkdir -p assets/trails

QUERY='[out:json][timeout:90];
(
  way["highway"~"path|cycleway|track|bridleway"](49.62,-110.85,50.12,-110.20);
  way["highway"="path"]["mtb"~"."](49.62,-110.85,50.12,-110.20);
  way["sport"="mtb"](49.62,-110.85,50.12,-110.20);
);
out body; >; out skel qt;'

curl -sS -X POST 'https://overpass-api.de/api/interpreter' \
  --data-urlencode "data=$QUERY" -o /tmp/osm_trails.json

python3 - <<'PY'
import json
from pathlib import Path

raw = json.load(open("/tmp/osm_trails.json"))
nodes = {el["id"]: el for el in raw.get("elements", []) if el["type"] == "node"}
features = []

def difficulty(tags):
    s = (tags.get("mtb:scale") or tags.get("mtb") or "").lower()
    if s in ("0", "1", "yes", "easy"): return "easy"
    if s in ("2", "3", "intermediate"): return "intermediate"
    if s in ("4", "5", "6", "advanced", "difficult", "severe"): return "advanced"
    return "intermediate"

def area_for(lon, lat):
    if lat >= 49.9:  # north block
        return "Redcliff" if lon <= -110.76 else "Medicine Hat"
    return "Cypress Hills / Elkwater"

for el in raw.get("elements", []):
    if el.get("type") != "way":
        continue
    tags = el.get("tags") or {}
    refs = el.get("nodes") or []
    coords = []
    for nid in refs:
        n = nodes.get(nid)
        if not n: continue
        coords.append([n["lon"], n["lat"]])
    if len(coords) < 2:
        continue
    # skip very short scraps
    if len(coords) < 3 and tags.get("highway") == "track":
        continue
    mid = coords[len(coords)//2]
    name = tags.get("name") or tags.get("ref") or f"Path {el['id']}"
    features.append({
        "type": "Feature",
        "properties": {
            "name": name,
            "difficulty": difficulty(tags),
            "area": area_for(mid[0], mid[1]),
            "osm_id": el["id"],
            "highway": tags.get("highway"),
        },
        "geometry": {"type": "LineString", "coordinates": coords},
    })

fc = {
    "type": "FeatureCollection",
    "features": features,
    "properties": {
        "source": "OpenStreetMap via Overpass",
        "license": "ODbL — https://www.openstreetmap.org/copyright",
        "bbox": [49.62, -110.85, 50.12, -110.20],
        "note": "Not Trailforks data. Enrich with club GPX where OSM is incomplete."
    }
}
Path("assets/trails/region.geojson").write_text(json.dumps(fc))
print(f"Wrote {len(features)} trails → assets/trails/region.geojson")
PY