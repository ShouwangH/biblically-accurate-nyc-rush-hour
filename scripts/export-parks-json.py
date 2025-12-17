#!/usr/bin/env python3
"""
Export Parks GeoJSON to Local Coordinates JSON

Converts NYC Parks Properties GeoJSON (WGS84) to local meter-based coordinates
for rendering in Three.js.

Usage:
    python scripts/export-parks-json.py

Input: gis/data/Parks Properties.geojson
Output: src/assets/parks.json
"""

import json
import math
from pathlib import Path

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
INPUT_PATH = PROJECT_ROOT / "gis" / "data" / "Parks Properties.geojson"
OUTPUT_PATH = PROJECT_ROOT / "src" / "assets" / "parks.json"

# Coordinate conversion constants (match coordinates.ts)
ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.017
METERS_PER_DEGREE_LAT = 111320
METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * math.cos(math.radians(ORIGIN_LAT))

# Bounds for filtering (WGS84) - from groundBounds.ts
BOUNDS = {
    "west": -74.025,
    "east": -73.965,
    "south": 40.698,
    "north": 40.758,
}

# Minimum area in square meters to include (filter out tiny parks)
MIN_AREA_SQ_METERS = 1000  # ~32m x 32m

# =============================================================================
# Coordinate Conversion
# =============================================================================

def to_local_coords(lat: float, lng: float) -> tuple[float, float]:
    """Convert WGS84 to local XZ coordinates (Y=0 for ground level)."""
    x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG
    z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT  # negative because north = negative z
    return (x, z)

def point_in_bounds(lng: float, lat: float) -> bool:
    """Check if a point is within our visualization bounds."""
    return (BOUNDS["west"] <= lng <= BOUNDS["east"] and
            BOUNDS["south"] <= lat <= BOUNDS["north"])

def polygon_area(coords: list[tuple[float, float]]) -> float:
    """Calculate polygon area using shoelace formula (in local coords)."""
    n = len(coords)
    if n < 3:
        return 0
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += coords[i][0] * coords[j][1]
        area -= coords[j][0] * coords[i][1]
    return abs(area) / 2

# =============================================================================
# GeoJSON Processing
# =============================================================================

def extract_polygons(geometry: dict) -> list[list[tuple[float, float]]]:
    """Extract polygon rings from a GeoJSON geometry."""
    polygons = []

    if geometry["type"] == "Polygon":
        # Each ring is a list of [lng, lat] coordinates
        for ring in geometry["coordinates"]:
            polygons.append(ring)
    elif geometry["type"] == "MultiPolygon":
        # Each polygon has rings
        for polygon in geometry["coordinates"]:
            for ring in polygon:
                polygons.append(ring)

    return polygons

def process_parks(geojson: dict) -> list[dict]:
    """Process parks GeoJSON and convert to local coordinates."""
    parks = []

    for feature in geojson["features"]:
        geometry = feature.get("geometry")
        if not geometry:
            continue

        # Extract all polygon rings
        rings = extract_polygons(geometry)

        for ring in rings:
            # Check if any point is in bounds
            in_bounds = False
            for coord in ring:
                lng, lat = coord[0], coord[1]
                if point_in_bounds(lng, lat):
                    in_bounds = True
                    break

            if not in_bounds:
                continue

            # Convert to local coordinates
            local_coords = []
            for coord in ring:
                lng, lat = coord[0], coord[1]
                x, z = to_local_coords(lat, lng)
                local_coords.append([round(x, 1), round(z, 1)])

            # Calculate area and filter small parks
            area = polygon_area(local_coords)
            if area < MIN_AREA_SQ_METERS:
                continue

            parks.append({
                "points": local_coords,
                "area": round(area, 0)
            })

    return parks

# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("PARKS JSON EXPORTER")
    print("=" * 60)

    # Check input file
    if not INPUT_PATH.exists():
        print(f"\nError: Input file not found: {INPUT_PATH}")
        print("Download from: https://data.cityofnewyork.us/api/geospatial/enfh-gkve?method=export&format=GeoJSON")
        return 1

    print(f"\nInput: {INPUT_PATH}")
    print(f"Output: {OUTPUT_PATH}")

    # Load GeoJSON
    print("\nLoading parks GeoJSON...")
    with open(INPUT_PATH, 'r') as f:
        geojson = json.load(f)

    total_features = len(geojson["features"])
    print(f"  Total features: {total_features}")

    # Process parks
    print("\nProcessing parks...")
    parks = process_parks(geojson)
    print(f"  Parks in bounds: {len(parks)}")

    # Sort by area (largest first)
    parks.sort(key=lambda p: p["area"], reverse=True)

    # Create output
    output = {
        "parks": parks,
        "metadata": {
            "count": len(parks),
            "minArea": MIN_AREA_SQ_METERS,
            "bounds": BOUNDS,
            "origin": {"lat": ORIGIN_LAT, "lng": ORIGIN_LNG}
        }
    }

    # Save
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f)

    file_size = OUTPUT_PATH.stat().st_size / 1024
    print(f"\nSaved to: {OUTPUT_PATH}")
    print(f"File size: {file_size:.1f} KB")

    # Show some stats
    if parks:
        total_area = sum(p["area"] for p in parks)
        print(f"\nTotal park area: {total_area/1e6:.2f} km²")
        print(f"Largest park: {parks[0]['area']/1e6:.3f} km²")

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)

    return 0

if __name__ == "__main__":
    exit(main())
