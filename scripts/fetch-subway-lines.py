#!/usr/bin/env python3
"""
Fetch NYC Subway Lines GeoJSON and Convert to subway_lines.json

Data Source: NYC Open Data - Subway Lines
https://data.cityofnewyork.us/Transportation/Subway-Lines/3qz8-muuu
Dataset ID: 3qz8-muuu (alternative: inkn-q76z)

Usage:
    python scripts/fetch-subway-lines.py

Output: src/assets/subway_lines.json
"""

import json
import math
import os
import sys
from typing import List, Tuple, Dict, Any
import urllib.request

# Import shared coordinate transformation (uses pyproj for accuracy)
from coordinates import wgs84_to_local as to_local_coords

# =============================================================================
# Configuration
# =============================================================================

CONFIG = {
    # MTA Subway Routes from ArcGIS FeatureServer
    "geojson_urls": [
        "https://services5.arcgis.com/OKgEWPlJhc3vFb8C/arcgis/rest/services/MTA_Subway_Routes_Stops/FeatureServer/1/query?where=1=1&outFields=*&f=geojson",
    ],

    # Geographic bounds (Manhattan south of 34th St)
    "max_latitude": 40.755,  # Approximately 34th St
    "min_latitude": 40.700,  # Battery Park area
    "min_longitude": -74.02,
    "max_longitude": -73.97,

    # Output path (public/assets is served directly by Vite)
    "output_path": os.path.join(os.path.dirname(__file__), "..", "public", "assets", "subway_lines.json"),

    # Cache path for downloaded GeoJSON
    "cache_path": os.path.join(os.path.dirname(__file__), "subway_lines_raw.geojson"),
}

# =============================================================================
# MTA Line Colors (Official)
# =============================================================================

MTA_COLORS = {
    # IND Eighth Avenue Line (Blue)
    "A": {"color": "#0039A6", "glow": "#1E5FD9"},
    "C": {"color": "#0039A6", "glow": "#1E5FD9"},
    "E": {"color": "#0039A6", "glow": "#1E5FD9"},

    # IND Sixth Avenue Line (Orange)
    "B": {"color": "#FF6319", "glow": "#FF8844"},
    "D": {"color": "#FF6319", "glow": "#FF8844"},
    "F": {"color": "#FF6319", "glow": "#FF8844"},
    "M": {"color": "#FF6319", "glow": "#FF8844"},

    # IND Crosstown Line (Light Green)
    "G": {"color": "#6CBE45", "glow": "#8ED066"},

    # BMT Canarsie Line (Gray)
    "L": {"color": "#A7A9AC", "glow": "#C0C2C5"},

    # BMT Nassau Street Line (Brown)
    "J": {"color": "#996633", "glow": "#CC8844"},
    "Z": {"color": "#996633", "glow": "#CC8844"},

    # BMT Broadway Line (Yellow)
    "N": {"color": "#FCCC0A", "glow": "#FFE040"},
    "Q": {"color": "#FCCC0A", "glow": "#FFE040"},
    "R": {"color": "#FCCC0A", "glow": "#FFE040"},
    "W": {"color": "#FCCC0A", "glow": "#FFE040"},

    # IRT Broadway-Seventh Avenue Line (Red)
    "1": {"color": "#EE352E", "glow": "#FF5A52"},
    "2": {"color": "#EE352E", "glow": "#FF5A52"},
    "3": {"color": "#EE352E", "glow": "#FF5A52"},

    # IRT Lexington Avenue Line (Green)
    "4": {"color": "#00933C", "glow": "#22B55E"},
    "5": {"color": "#00933C", "glow": "#22B55E"},
    "6": {"color": "#00933C", "glow": "#22B55E"},

    # IRT Flushing Line (Purple)
    "7": {"color": "#B933AD", "glow": "#D455CF"},

    # Shuttles (Dark Gray)
    "S": {"color": "#808183", "glow": "#A0A1A3"},

    # Default fallback
    "default": {"color": "#808080", "glow": "#A0A0A0"},
}

# =============================================================================
# Bounds Checking
# =============================================================================

def is_in_bounds(lat: float, lng: float) -> bool:
    """Check if coordinate is within Manhattan south of 34th."""
    return (
        CONFIG["min_latitude"] <= lat <= CONFIG["max_latitude"] and
        CONFIG["min_longitude"] <= lng <= CONFIG["max_longitude"]
    )

# =============================================================================
# GeoJSON Processing
# =============================================================================

def fetch_geojson() -> Dict[str, Any]:
    """Fetch GeoJSON from NYC Open Data or use cached file."""
    # Check cache first
    if os.path.exists(CONFIG["cache_path"]):
        print(f"Using cached GeoJSON: {CONFIG['cache_path']}")
        with open(CONFIG["cache_path"], "r") as f:
            return json.load(f)

    # Try each URL
    for url in CONFIG["geojson_urls"]:
        print(f"Fetching from: {url}")
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = json.loads(response.read().decode("utf-8"))
                # Cache for future use
                with open(CONFIG["cache_path"], "w") as f:
                    json.dump(data, f)
                print(f"  Cached to: {CONFIG['cache_path']}")
                return data
        except Exception as e:
            print(f"  Failed: {e}")
            continue

    raise RuntimeError("Could not fetch GeoJSON from any source")

def extract_line_id(properties: Dict[str, Any]) -> str:
    """Extract subway line ID from feature properties."""
    # Try common field names
    for field in ["name", "rt_symbol", "line", "route_id", "LINE"]:
        if field in properties and properties[field]:
            val = str(properties[field]).strip()
            # Extract first letter/number if it's a route designation
            if len(val) == 1:
                return val.upper()
            # Handle compound names like "A-C-E" or "A Express"
            if "-" in val:
                return val.split("-")[0].strip().upper()
            if " " in val:
                first = val.split()[0].strip()
                if len(first) == 1:
                    return first.upper()
            return val[0].upper()
    return "?"

def process_geometry(geometry: Dict[str, Any], depth: float) -> List[List[Tuple[float, float, float]]]:
    """
    Process GeoJSON geometry to polyline segments.
    Returns list of segments, each segment is list of [x, y, z] points.
    """
    segments = []

    geom_type = geometry.get("type", "")
    coords = geometry.get("coordinates", [])

    if geom_type == "LineString":
        # Single line
        segment = []
        for coord in coords:
            lng, lat = coord[0], coord[1]
            if is_in_bounds(lat, lng):
                x, y, z = to_local_coords(lat, lng, depth)
                segment.append([x, y, z])
        if len(segment) >= 2:
            segments.append(segment)

    elif geom_type == "MultiLineString":
        # Multiple line segments
        for line_coords in coords:
            segment = []
            for coord in line_coords:
                lng, lat = coord[0], coord[1]
                if is_in_bounds(lat, lng):
                    x, y, z = to_local_coords(lat, lng, depth)
                    segment.append([x, y, z])
            if len(segment) >= 2:
                segments.append(segment)

    return segments

def simplify_polyline(points: List[List[float]], tolerance: float = 5.0) -> List[List[float]]:
    """
    Douglas-Peucker polyline simplification.
    Reduces point count while preserving shape.
    """
    if len(points) <= 2:
        return points

    # Find point with max distance from line between first and last
    max_dist = 0
    max_idx = 0

    p1 = points[0]
    p2 = points[-1]

    for i in range(1, len(points) - 1):
        p = points[i]
        # Distance from point to line segment
        dist = point_line_distance(p, p1, p2)
        if dist > max_dist:
            max_dist = dist
            max_idx = i

    # If max distance exceeds tolerance, recursively simplify
    if max_dist > tolerance:
        left = simplify_polyline(points[:max_idx + 1], tolerance)
        right = simplify_polyline(points[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [points[0], points[-1]]

def point_line_distance(p: List[float], p1: List[float], p2: List[float]) -> float:
    """Calculate perpendicular distance from point to line segment."""
    dx = p2[0] - p1[0]
    dz = p2[2] - p1[2]

    if dx == 0 and dz == 0:
        return math.sqrt((p[0] - p1[0])**2 + (p[2] - p1[2])**2)

    t = max(0, min(1, ((p[0] - p1[0]) * dx + (p[2] - p1[2]) * dz) / (dx*dx + dz*dz)))

    proj_x = p1[0] + t * dx
    proj_z = p1[2] + t * dz

    return math.sqrt((p[0] - proj_x)**2 + (p[2] - proj_z)**2)

# =============================================================================
# Main Processing
# =============================================================================

def process_subway_lines(geojson: Dict[str, Any]) -> Dict[str, Any]:
    """Process GeoJSON into our subway_lines.json format."""
    # Group features by line ID
    lines_by_id: Dict[str, Dict[str, Any]] = {}

    features = geojson.get("features", [])
    print(f"Processing {len(features)} features...")

    # Assign depths per line to avoid overlap
    depth_by_id: Dict[str, float] = {}
    base_depth = -15

    for feature in features:
        properties = feature.get("properties", {})
        geometry = feature.get("geometry", {})

        if not geometry:
            continue

        line_id = extract_line_id(properties)

        # Assign depth if not yet assigned
        if line_id not in depth_by_id:
            depth_by_id[line_id] = base_depth - len(depth_by_id) * 3

        depth = depth_by_id[line_id]
        segments = process_geometry(geometry, depth)

        if not segments:
            continue

        # Initialize line entry
        if line_id not in lines_by_id:
            colors = MTA_COLORS.get(line_id, MTA_COLORS["default"])
            lines_by_id[line_id] = {
                "id": line_id,
                "name": f"{line_id} Line",
                "color": colors["color"],
                "glowColor": colors["glow"],
                "segments": [],
                "depth": depth,
            }

        # Add segments (simplified)
        for seg in segments:
            simplified = simplify_polyline(seg, tolerance=10.0)
            if len(simplified) >= 2:
                lines_by_id[line_id]["segments"].append({"points": simplified})

    # Build output
    lines = sorted(lines_by_id.values(), key=lambda x: x["id"])

    print(f"\nExtracted {len(lines)} subway lines:")
    for line in lines:
        seg_count = len(line["segments"])
        point_count = sum(len(s["points"]) for s in line["segments"])
        print(f"  {line['id']}: {seg_count} segments, {point_count} points")

    return {"lines": lines}

# =============================================================================
# Main
# =============================================================================

def main():
    try:
        # 1. Fetch GeoJSON
        print("=" * 60)
        print("Fetching NYC Subway Lines GeoJSON...")
        print("=" * 60)
        geojson = fetch_geojson()

        # 2. Process into our format
        print("\n" + "=" * 60)
        print("Processing subway lines...")
        print("=" * 60)
        output = process_subway_lines(geojson)

        # 3. Write output
        os.makedirs(os.path.dirname(CONFIG["output_path"]), exist_ok=True)
        with open(CONFIG["output_path"], "w") as f:
            json.dump(output, f, indent=2)

        print(f"\n✓ Wrote {len(output['lines'])} lines to {CONFIG['output_path']}")

        # 4. Summary
        total_segments = sum(len(l["segments"]) for l in output["lines"])
        total_points = sum(
            sum(len(s["points"]) for s in l["segments"])
            for l in output["lines"]
        )
        print(f"  Total segments: {total_segments}")
        print(f"  Total points: {total_points}")

    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
