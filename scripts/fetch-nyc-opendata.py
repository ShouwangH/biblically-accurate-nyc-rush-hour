#!/usr/bin/env python3
"""
Fetch roadbed and shoreline data from NYC Open Data APIs.

Data sources:
- Roadbed: https://data.cityofnewyork.us/resource/i36f-5ih7.json
- Shoreline: https://data.cityofnewyork.us/resource/59xk-wagz.json

Outputs:
- public/assets/nyc3d/roadbed.glb (from NYC Open Data)
- public/assets/nyc3d/water.glb (from shoreline data)
- src/assets/roadbed.json (polygon data for direct rendering)

Usage:
    python scripts/fetch-nyc-opendata.py

Note: Uses pyproj for proper State Plane projection (EPSG:2263) to align
with NYC 3D Model buildings data. Install with: pip install pyproj
"""

import json
import os
import sys
from pathlib import Path
from typing import List, Tuple, Dict, Any
import urllib.request
import urllib.parse
import math

# =============================================================================
# Configuration
# =============================================================================

# NYC Open Data API endpoints
ROADBED_API = "https://data.cityofnewyork.us/resource/i36f-5ih7.json"
SHORELINE_API = "https://data.cityofnewyork.us/resource/59xk-wagz.json"
# Borough boundaries from NYC EHS GitHub (more reliable than Open Data API)
BOROUGH_GEOJSON_URL = "https://raw.githubusercontent.com/nycehs/NYC_geography/master/borough.geo.json"

# Output paths
PROJECT_ROOT = Path(__file__).parent.parent
ASSETS_DIR = PROJECT_ROOT / "public" / "assets" / "nyc3d"
SRC_ASSETS_DIR = PROJECT_ROOT / "src" / "assets"

# Coordinate system origin (Battery Park) - must match src/utils/coordinates.ts
ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.017

# State Plane NY Long Island (EPSG:2263) uses US Survey Feet
# We convert to meters and offset so Battery Park is at origin
FEET_TO_METERS = 0.3048006096012192  # US Survey feet

# Initialize pyproj transformer (WGS84 -> State Plane NY Long Island)
try:
    from pyproj import Transformer
    # EPSG:4326 = WGS84, EPSG:2263 = State Plane NY Long Island (US Survey Feet)
    _transformer = Transformer.from_crs("EPSG:4326", "EPSG:2263", always_xy=True)

    # Calculate State Plane coordinates of origin (Battery Park)
    _origin_sp_x, _origin_sp_y = _transformer.transform(ORIGIN_LNG, ORIGIN_LAT)
    ORIGIN_SP_X = _origin_sp_x * FEET_TO_METERS  # Convert to meters
    ORIGIN_SP_Y = _origin_sp_y * FEET_TO_METERS
    USE_STATE_PLANE = True
    print(f"Using State Plane projection (origin at {ORIGIN_SP_X:.1f}, {ORIGIN_SP_Y:.1f} meters)")
except ImportError:
    print("Warning: pyproj not installed, using linear approximation")
    print("Install with: pip install pyproj")
    USE_STATE_PLANE = False
    # Fallback to linear approximation
    METERS_PER_DEGREE_LAT = 111320
    METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * math.cos(math.radians(ORIGIN_LAT))

# Viewport bounds (local meters) - Manhattan south of ~34th St
VIEWPORT = {
    "minX": -1500,  # West
    "maxX": 5000,   # East
    "minZ": -7000,  # North
    "maxZ": 1500,   # South
}

# Y levels for flat surfaces
ROADBED_Y = -0.15  # Roads below sidewalk level
WATER_Y = -1.0     # Water below ground
LAND_Y = -0.4      # Land between water and roads (above -0.5 to avoid z-fighting)

# =============================================================================
# Coordinate Conversion
# =============================================================================

def wgs84_to_local(lng: float, lat: float) -> Tuple[float, float]:
    """Convert WGS84 coordinates to local meters.

    Uses State Plane projection (EPSG:2263) when pyproj is available,
    which matches the coordinate system used by NYC 3D Model buildings.
    Falls back to linear approximation if pyproj is not installed.
    """
    if USE_STATE_PLANE:
        # Project to State Plane NY Long Island (feet), convert to meters, offset to origin
        sp_x, sp_y = _transformer.transform(lng, lat)
        x = sp_x * FEET_TO_METERS - ORIGIN_SP_X
        # State Plane Y increases north, our Z increases south, so negate
        z = -(sp_y * FEET_TO_METERS - ORIGIN_SP_Y)
        return x, z
    else:
        # Fallback: linear approximation
        x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG
        z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT  # Negative because north = -Z
        return x, z


def is_in_viewport(x: float, z: float) -> bool:
    """Check if point is within viewport bounds."""
    return (VIEWPORT["minX"] <= x <= VIEWPORT["maxX"] and
            VIEWPORT["minZ"] <= z <= VIEWPORT["maxZ"])


def polygon_in_viewport(coords: List[Tuple[float, float]]) -> bool:
    """Check if any point of polygon is in viewport."""
    for x, z in coords:
        if is_in_viewport(x, z):
            return True
    return False

# =============================================================================
# Data Fetching
# =============================================================================

def fetch_all_records(api_url: str, limit: int = 50000) -> List[Dict]:
    """Fetch all records from NYC Open Data API with pagination."""
    all_records = []
    offset = 0
    page_size = 10000  # Max allowed by Socrata API

    while offset < limit:
        params = {
            "$limit": min(page_size, limit - offset),
            "$offset": offset,
        }
        url = f"{api_url}?{urllib.parse.urlencode(params)}"

        print(f"  Fetching records {offset} to {offset + page_size}...")

        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = json.loads(response.read().decode())

            if not data:
                break

            all_records.extend(data)
            offset += len(data)

            if len(data) < page_size:
                break  # No more records

        except Exception as e:
            print(f"  Error fetching data: {e}")
            break

    return all_records

# =============================================================================
# Geometry Processing
# =============================================================================

def extract_polygons_from_multipolygon(geom: Dict) -> List[List[Tuple[float, float]]]:
    """Extract polygon coordinates from MultiPolygon geometry."""
    polygons = []

    if geom.get("type") == "MultiPolygon":
        for polygon in geom.get("coordinates", []):
            # Each polygon is a list of rings (outer + holes)
            # We only use the outer ring (first one)
            if polygon and len(polygon) > 0:
                ring = polygon[0]
                coords = [(wgs84_to_local(pt[0], pt[1])) for pt in ring]
                if len(coords) >= 3:
                    polygons.append(coords)

    elif geom.get("type") == "Polygon":
        rings = geom.get("coordinates", [])
        if rings and len(rings) > 0:
            ring = rings[0]
            coords = [(wgs84_to_local(pt[0], pt[1])) for pt in ring]
            if len(coords) >= 3:
                polygons.append(coords)

    return polygons


def extract_lines_from_multilinestring(geom: Dict) -> List[List[Tuple[float, float]]]:
    """Extract line coordinates from MultiLineString geometry."""
    lines = []

    if geom.get("type") == "MultiLineString":
        for line in geom.get("coordinates", []):
            coords = [(wgs84_to_local(pt[0], pt[1])) for pt in line]
            if len(coords) >= 2:
                lines.append(coords)

    elif geom.get("type") == "LineString":
        coords = [(wgs84_to_local(pt[0], pt[1])) for pt in geom.get("coordinates", [])]
        if len(coords) >= 2:
            lines.append(coords)

    return lines

# =============================================================================
# Triangulation
# =============================================================================

def triangulate_polygon(coords: List[Tuple[float, float]]) -> Tuple[List[List[float]], List[List[int]]]:
    """Triangulate a polygon using earcut."""
    try:
        import numpy as np
        import mapbox_earcut as earcut
        from shapely.geometry import Polygon as ShapelyPolygon, MultiPolygon
        from shapely.validation import make_valid

        # Validate polygon with shapely
        poly = ShapelyPolygon(coords)
        if not poly.is_valid:
            poly = make_valid(poly)
            if isinstance(poly, MultiPolygon):
                poly = max(poly.geoms, key=lambda g: g.area)

        if poly.is_empty or poly.area < 1.0:  # Skip tiny polygons
            return [], []

        # Get cleaned coordinates
        clean_coords = list(poly.exterior.coords)[:-1]  # Remove closing duplicate
        if len(clean_coords) < 3:
            return [], []

        # Triangulate
        coords_array = np.array(clean_coords, dtype=np.float64)
        ring_end = np.array([len(clean_coords)], dtype=np.uint32)
        indices = earcut.triangulate_float64(coords_array, ring_end)

        if len(indices) == 0:
            return [], []

        # Convert to faces
        faces = []
        for i in range(0, len(indices), 3):
            faces.append([int(indices[i]), int(indices[i+1]), int(indices[i+2])])

        return clean_coords, faces

    except Exception as e:
        return [], []

# =============================================================================
# GLB Export
# =============================================================================

def export_polygons_to_glb(
    polygons: List[List[Tuple[float, float]]],
    output_path: Path,
    y_level: float,
    category: str
):
    """Export polygons as a GLB mesh."""
    try:
        import numpy as np
        import trimesh
    except ImportError:
        print("  Error: trimesh not installed. Run: pip install trimesh")
        return

    all_vertices = []
    all_faces = []
    vertex_offset = 0

    for coords in polygons:
        clean_coords, faces = triangulate_polygon(coords)
        if not clean_coords or not faces:
            continue

        # Add vertices (convert 2D to 3D)
        for x, z in clean_coords:
            all_vertices.append([x, y_level, z])

        # Add faces with offset
        for face in faces:
            all_faces.append([f + vertex_offset for f in face])

        vertex_offset += len(clean_coords)

    if not all_vertices or not all_faces:
        print(f"  No valid geometry for {category}")
        return

    # Create mesh
    vertices = np.array(all_vertices, dtype=np.float64)
    faces = np.array(all_faces, dtype=np.int32)

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)

    # Fix normals (ensure facing up)
    face_normals = mesh.face_normals
    down_facing = face_normals[:, 1] < 0
    if np.any(down_facing):
        mesh.faces[down_facing] = mesh.faces[down_facing][:, ::-1]
        mesh._cache.clear()

    # Export
    mesh.visual = None  # Remove vertex colors
    mesh.export(str(output_path), file_type='glb')

    file_size = output_path.stat().st_size / (1024 * 1024)
    print(f"  Exported {category}: {len(all_faces):,} faces, {file_size:.2f} MB")


def export_polygons_to_json(
    polygons: List[List[Tuple[float, float]]],
    output_path: Path,
    category: str
):
    """Export polygons as JSON for direct rendering."""
    data = {
        category: [
            {
                "points": [[round(x, 1), round(z, 1)] for x, z in coords],
                "area": abs(sum(
                    (coords[i][0] - coords[i-1][0]) * (coords[i][1] + coords[i-1][1])
                    for i in range(len(coords))
                ) / 2)
            }
            for coords in polygons
        ],
        "metadata": {
            "count": len(polygons),
            "source": "NYC Open Data"
        }
    }

    with open(output_path, 'w') as f:
        json.dump(data, f)

    file_size = output_path.stat().st_size / 1024
    print(f"  Exported {category}.json: {len(polygons):,} polygons, {file_size:.1f} KB")

# =============================================================================
# Main
# =============================================================================

def process_roadbed():
    """Fetch and process roadbed data."""
    print("\n=== Processing Roadbed ===")

    records = fetch_all_records(ROADBED_API)
    print(f"  Fetched {len(records):,} roadbed records")

    polygons = []
    for record in records:
        geom = record.get("the_geom")
        if not geom:
            continue

        polys = extract_polygons_from_multipolygon(geom)
        for coords in polys:
            if polygon_in_viewport(coords):
                polygons.append(coords)

    print(f"  Extracted {len(polygons):,} polygons in viewport")

    # Export GLB
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    export_polygons_to_glb(polygons, ASSETS_DIR / "roadbed.glb", ROADBED_Y, "roadbed")

    # Export JSON
    SRC_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    export_polygons_to_json(polygons, SRC_ASSETS_DIR / "roadbed.json", "roadbed")


def process_shoreline():
    """Fetch and process shoreline data to create water polygons."""
    print("\n=== Processing Shoreline ===")

    records = fetch_all_records(SHORELINE_API)
    print(f"  Fetched {len(records):,} shoreline records")

    # Shoreline is LineString - we need to create water polygons
    # For now, we'll buffer the lines to create water areas
    try:
        from shapely.geometry import LineString, MultiLineString
        from shapely.ops import unary_union
    except ImportError:
        print("  Error: shapely not installed. Run: pip install shapely")
        return

    lines = []
    for record in records:
        geom = record.get("the_geom")
        if not geom:
            continue

        extracted = extract_lines_from_multilinestring(geom)
        for coords in extracted:
            # Check if any point is near viewport
            if any(is_in_viewport(x, z) or
                   (VIEWPORT["minX"] - 1000 <= x <= VIEWPORT["maxX"] + 1000 and
                    VIEWPORT["minZ"] - 1000 <= z <= VIEWPORT["maxZ"] + 1000)
                   for x, z in coords):
                lines.append(coords)

    print(f"  Extracted {len(lines):,} lines near viewport")

    if not lines:
        print("  No shoreline data in viewport")
        return

    # Create water polygons by buffering shorelines
    # This creates a water area along the coast
    buffered_polys = []
    for coords in lines:
        try:
            line = LineString(coords)
            # Buffer by 50m on the water side (negative buffer won't work, use positive)
            buffered = line.buffer(30, cap_style=2, join_style=2)  # Flat caps, mitered joins
            if not buffered.is_empty:
                if buffered.geom_type == 'Polygon':
                    buffered_polys.append(list(buffered.exterior.coords))
                elif buffered.geom_type == 'MultiPolygon':
                    for poly in buffered.geoms:
                        buffered_polys.append(list(poly.exterior.coords))
        except Exception as e:
            continue

    print(f"  Created {len(buffered_polys):,} water polygons from shoreline")

    if buffered_polys:
        # Export GLB
        export_polygons_to_glb(buffered_polys, ASSETS_DIR / "water.glb", WATER_Y, "water")

        # Export JSON
        export_polygons_to_json(buffered_polys, SRC_ASSETS_DIR / "water.json", "water")


def process_land():
    """Fetch borough boundaries to create land polygon for Manhattan."""
    print("\n=== Processing Land (Borough Boundaries) ===")

    try:
        from shapely.geometry import Polygon as ShapelyPolygon, MultiPolygon, box
        from shapely.validation import make_valid
    except ImportError:
        print("  Error: shapely not installed. Run: pip install shapely")
        return

    # Fetch GeoJSON from GitHub
    print(f"  Fetching borough boundaries GeoJSON...")
    try:
        with urllib.request.urlopen(BOROUGH_GEOJSON_URL, timeout=60) as response:
            geojson = json.loads(response.read().decode())
    except Exception as e:
        print(f"  Error fetching borough boundaries: {e}")
        return

    features = geojson.get("features", [])
    print(f"  Fetched {len(features)} borough features")

    # Create viewport clipping box
    viewport_box = box(VIEWPORT["minX"], VIEWPORT["minZ"], VIEWPORT["maxX"], VIEWPORT["maxZ"])

    polygons = []
    for feature in features:
        props = feature.get("properties", {})
        # Only process Manhattan (BoroCode = 1 or BoroName = "Manhattan")
        boro_name = props.get("BoroName", "")
        boro_code = props.get("BoroCode", "")

        if boro_name != "Manhattan" and str(boro_code) != "1":
            continue

        print(f"  Found Manhattan boundary: {boro_name}")

        geom = feature.get("geometry")
        if not geom:
            continue

        polys = extract_polygons_from_multipolygon(geom)
        for coords in polys:
            # Create shapely polygon and clip to viewport
            try:
                poly = ShapelyPolygon(coords)
                if not poly.is_valid:
                    poly = make_valid(poly)

                # Clip to viewport
                clipped = poly.intersection(viewport_box)

                if clipped.is_empty:
                    continue

                # Extract polygon(s) from result
                if clipped.geom_type == 'Polygon':
                    polygons.append(list(clipped.exterior.coords))
                elif clipped.geom_type == 'MultiPolygon':
                    for p in clipped.geoms:
                        if p.area > 100:  # Skip tiny fragments
                            polygons.append(list(p.exterior.coords))

            except Exception as e:
                print(f"    Warning: Failed to clip polygon: {e}")
                continue

    print(f"  Extracted {len(polygons):,} land polygons in viewport")

    if polygons:
        # Export GLB
        ASSETS_DIR.mkdir(parents=True, exist_ok=True)
        export_polygons_to_glb(polygons, ASSETS_DIR / "land.glb", LAND_Y, "land")


def main():
    print("NYC Open Data Fetch")
    print("=" * 50)

    process_roadbed()
    process_shoreline()
    process_land()

    print("\n✓ Done!")


if __name__ == "__main__":
    main()
