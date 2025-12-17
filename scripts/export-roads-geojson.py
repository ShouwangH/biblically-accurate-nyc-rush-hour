#!/usr/bin/env python3
"""
Export Road Segments to GeoJSON for QGIS

Converts road_segments.json (local coordinates) to GeoJSON (WGS84)
for use in the ground map QGIS project.

Usage:
    python scripts/export-roads-geojson.py

Output: gis/roads.geojson
"""

import json
import os
import math

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "road_segments.json")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "..", "gis", "roads.geojson")

# Coordinate conversion origin (Battery Park)
ORIGIN_LAT = 40.7033
ORIGIN_LON = -74.017

# Meters per degree at NYC latitude
METERS_PER_DEG_LAT = 111320
METERS_PER_DEG_LON = 111320 * math.cos(math.radians(ORIGIN_LAT))


# =============================================================================
# Coordinate Conversion
# =============================================================================

def local_to_wgs84(x: float, z: float) -> tuple:
    """
    Convert local coordinates to WGS84.

    Local coordinate system:
    - Origin at Battery Park (40.7033, -74.017)
    - X positive = East
    - Z negative = North (three.js convention)
    """
    # X maps to longitude (east-west)
    lon = ORIGIN_LON + (x / METERS_PER_DEG_LON)

    # Z maps to latitude (north-south), but Z is inverted in three.js
    # Negative Z = North = higher latitude
    lat = ORIGIN_LAT - (z / METERS_PER_DEG_LAT)

    return (lon, lat)


# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("ROAD SEGMENTS TO GEOJSON EXPORTER")
    print("=" * 60)

    # Load road segments
    print(f"\nLoading {INPUT_PATH}...")
    with open(INPUT_PATH, "r") as f:
        data = json.load(f)

    segments = data.get("segments", [])
    print(f"  Found {len(segments)} road segments")

    # Convert to GeoJSON features
    features = []

    for seg in segments:
        points = seg.get("points", [])
        if len(points) < 2:
            continue

        # Convert each point to WGS84
        coords = []
        for pt in points:
            x, y, z = pt[0], pt[1], pt[2]
            lon, lat = local_to_wgs84(x, z)
            coords.append([lon, lat])

        feature = {
            "type": "Feature",
            "properties": {
                "id": seg.get("id", ""),
                "type": seg.get("type", "street"),
                "avgSpeedMph": seg.get("avgSpeedMph", 0),
                "congestionFactor": seg.get("congestionFactor", 0),
            },
            "geometry": {
                "type": "LineString",
                "coordinates": coords
            }
        }
        features.append(feature)

    # Build GeoJSON
    geojson = {
        "type": "FeatureCollection",
        "name": "road_segments",
        "crs": {
            "type": "name",
            "properties": {
                "name": "urn:ogc:def:crs:OGC:1.3:CRS84"
            }
        },
        "features": features
    }

    # Write output
    print(f"\nWriting {OUTPUT_PATH}...")
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(geojson, f, indent=2)

    print(f"  Exported {len(features)} road segments")
    print("\nDone!")

    return 0


if __name__ == "__main__":
    exit(main())
