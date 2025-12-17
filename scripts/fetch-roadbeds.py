#!/usr/bin/env python3
"""
Fetch NYC roadbed polygons from NYC Open Data and convert to local coordinates.

Output: public/assets/roadbeds.json
"""

import json
import math
import urllib.request
import urllib.parse
from typing import List, Tuple

# Origin (Battery Park) - must match src/utils/coordinates.ts
ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.017
METERS_PER_DEGREE_LAT = 111320
METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * math.cos(math.radians(ORIGIN_LAT))

# Bounding box for Lower Manhattan (lat/lng)
MIN_LAT = 40.700
MAX_LAT = 40.760
MIN_LNG = -74.020
MAX_LNG = -73.970

def to_local_coords(lng: float, lat: float) -> Tuple[float, float]:
    """Convert WGS84 to local meter coordinates."""
    x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG
    z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT
    return (round(x, 1), round(z, 1))

def fetch_roadbeds() -> List[dict]:
    """Fetch roadbed polygons from NYC Open Data API."""
    base_url = "https://data.cityofnewyork.us/resource/i36f-5ih7.json"

    # Query with bounding box
    params = {
        "$limit": "10000",
        "$where": f"within_box(the_geom, {MIN_LAT}, {MIN_LNG}, {MAX_LAT}, {MAX_LNG})"
    }

    print(f"Fetching roadbeds within bounds: {MIN_LAT},{MIN_LNG} to {MAX_LAT},{MAX_LNG}")

    query_string = urllib.parse.urlencode(params)
    url = f"{base_url}?{query_string}"

    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())

    print(f"Fetched {len(data)} roadbed features")

    return data

def convert_polygon(coords: List) -> List[Tuple[float, float]]:
    """Convert a polygon ring from [lng, lat] to local [x, z] coords."""
    return [to_local_coords(pt[0], pt[1]) for pt in coords]

def process_roadbeds(raw_data: List[dict]) -> List[dict]:
    """Convert roadbed features to local coordinates."""
    roadbeds = []

    for feature in raw_data:
        if "the_geom" not in feature:
            continue

        geom = feature["the_geom"]
        source_id = feature.get("source_id", "unknown")

        if geom["type"] == "MultiPolygon":
            # MultiPolygon: array of polygons, each polygon is array of rings
            for polygon in geom["coordinates"]:
                # First ring is exterior, rest are holes (ignore holes for simplicity)
                exterior = convert_polygon(polygon[0])
                if len(exterior) >= 3:
                    roadbeds.append({
                        "id": f"rb_{source_id}_{len(roadbeds)}",
                        "points": exterior
                    })
        elif geom["type"] == "Polygon":
            exterior = convert_polygon(geom["coordinates"][0])
            if len(exterior) >= 3:
                roadbeds.append({
                    "id": f"rb_{source_id}",
                    "points": exterior
                })

    print(f"Converted {len(roadbeds)} roadbed polygons")
    return roadbeds

def main():
    raw_data = fetch_roadbeds()
    roadbeds = process_roadbeds(raw_data)

    output = {
        "meta": {
            "source": "NYC Open Data - Roadbed",
            "url": "https://data.cityofnewyork.us/resource/i36f-5ih7.json",
            "count": len(roadbeds)
        },
        "roadbeds": roadbeds
    }

    output_path = "public/assets/roadbeds.json"
    with open(output_path, "w") as f:
        json.dump(output, f)

    print(f"Saved to {output_path}")

    # Print file size
    import os
    size_kb = os.path.getsize(output_path) / 1024
    print(f"File size: {size_kb:.1f} KB")

if __name__ == "__main__":
    main()
