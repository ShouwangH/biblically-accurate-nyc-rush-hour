#!/usr/bin/env python3
"""
Generate Ground Map Texture

Creates ground_map.png programmatically using matplotlib and geopandas.
No QGIS required.

Usage:
    pip install geopandas matplotlib shapely
    python scripts/generate-ground-map.py

Output: public/assets/ground_map.png (4096x4096)

Data sources:
    - gis/roads.geojson (already generated)
    - gis/data/geo_export_*.shp (NYC Shoreline - download required)
    - gis/data/Parks_Properties.geojson (NYC Parks - download required)
"""

import json
import os
import sys
from pathlib import Path

# Check dependencies
try:
    import geopandas as gpd
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    from matplotlib.collections import LineCollection
    from shapely.geometry import box, Polygon, MultiPolygon
    from shapely.ops import unary_union
    import numpy as np
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("\nInstall with:")
    print("  pip install geopandas matplotlib shapely")
    sys.exit(1)

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
GIS_DIR = PROJECT_ROOT / "gis"
OUTPUT_PATH = PROJECT_ROOT / "public" / "assets" / "ground_map.png"

# Bounds (WGS84)
BOUNDS = {
    "west": -74.025,
    "east": -73.965,
    "south": 40.698,
    "north": 40.758,
}

# Output resolution
RESOLUTION = 4096

# Colors (RGB normalized 0-1)
COLORS = {
    "water": "#D8DDE0",
    "land": "#F0EDE8",
    "parks": "#E4E8E4",
    "roads": "#C8C8C8",
}

def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple (0-1 range)."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))

# =============================================================================
# Data Loading
# =============================================================================

def load_roads():
    """Load roads from gis/roads.geojson."""
    roads_path = GIS_DIR / "roads.geojson"
    if not roads_path.exists():
        print(f"Warning: {roads_path} not found. Run: python scripts/export-roads-geojson.py")
        return None
    return gpd.read_file(roads_path)

def load_shoreline():
    """Load NYC shoreline shapefile."""
    data_dir = GIS_DIR / "data"

    # Look for shapefile (downloaded as zip, extracts to geo_export_*.shp)
    shapefiles = list(data_dir.glob("geo_export_*.shp")) + list(data_dir.glob("*.shp"))

    if not shapefiles:
        print(f"Warning: No shoreline shapefile found in {data_dir}")
        print("Download from: https://data.cityofnewyork.us/api/geospatial/2qj2-cctx?method=export&format=Shapefile")
        return None

    return gpd.read_file(shapefiles[0])

def load_parks():
    """Load NYC parks GeoJSON."""
    parks_path = GIS_DIR / "data" / "Parks Properties.geojson"

    # Also try alternate names
    alt_paths = [
        GIS_DIR / "data" / "Parks_Properties.geojson",
        GIS_DIR / "data" / "parks.geojson",
    ]

    for path in [parks_path] + alt_paths:
        if path.exists():
            return gpd.read_file(path)

    print(f"Warning: No parks GeoJSON found in {GIS_DIR / 'data'}")
    print("Download from: https://data.cityofnewyork.us/api/geospatial/enfh-gkve?method=export&format=GeoJSON")
    return None

# =============================================================================
# Rendering
# =============================================================================

def create_ground_map():
    """Generate the ground map texture."""
    print("=" * 60)
    print("GROUND MAP GENERATOR")
    print("=" * 60)

    # Create figure with exact pixel dimensions
    dpi = 100
    fig_size = RESOLUTION / dpi
    fig, ax = plt.subplots(figsize=(fig_size, fig_size), dpi=dpi)

    # Set bounds
    ax.set_xlim(BOUNDS["west"], BOUNDS["east"])
    ax.set_ylim(BOUNDS["south"], BOUNDS["north"])
    ax.set_aspect('equal')

    # Remove axes
    ax.axis('off')
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)

    # 1. Fill background with land color
    print("\n1. Drawing land base...")
    land_color = hex_to_rgb(COLORS["land"])
    ax.set_facecolor(land_color)

    # Create bounding box for land
    bbox = box(BOUNDS["west"], BOUNDS["south"], BOUNDS["east"], BOUNDS["north"])

    # 2. Draw water (areas outside shoreline)
    print("2. Drawing water...")
    shoreline = load_shoreline()
    if shoreline is not None:
        # Clip shoreline to our bounds
        shoreline = shoreline.clip(bbox)

        if not shoreline.empty:
            # The shoreline is the land boundary - we want to fill water
            # Create a polygon for the full extent and subtract land
            water_color = hex_to_rgb(COLORS["water"])

            # Draw water as background first
            water_patch = mpatches.Rectangle(
                (BOUNDS["west"], BOUNDS["south"]),
                BOUNDS["east"] - BOUNDS["west"],
                BOUNDS["north"] - BOUNDS["south"],
                facecolor=water_color,
                edgecolor='none',
                zorder=0
            )
            ax.add_patch(water_patch)

            # Draw land on top
            for geom in shoreline.geometry:
                if geom is None:
                    continue
                if isinstance(geom, (Polygon, MultiPolygon)):
                    gpd.GeoSeries([geom]).plot(
                        ax=ax,
                        facecolor=land_color,
                        edgecolor='none',
                        zorder=1
                    )
    else:
        print("  Skipping water (no shoreline data)")

    # 3. Draw parks
    print("3. Drawing parks...")
    parks = load_parks()
    if parks is not None:
        # Clip parks to our bounds
        parks = parks.clip(bbox)

        if not parks.empty:
            park_color = hex_to_rgb(COLORS["parks"])
            parks.plot(
                ax=ax,
                facecolor=park_color,
                edgecolor='none',
                alpha=0.4,
                zorder=2
            )
    else:
        print("  Skipping parks (no data)")

    # 4. Draw roads
    print("4. Drawing roads...")
    roads = load_roads()
    if roads is not None:
        # Clip roads to our bounds
        roads = roads.clip(bbox)

        if not roads.empty:
            road_color = hex_to_rgb(COLORS["roads"])
            roads.plot(
                ax=ax,
                color=road_color,
                linewidth=0.3,
                alpha=0.6,
                zorder=3
            )
    else:
        print("  Skipping roads (no data)")

    # 5. Save output
    print(f"\n5. Saving to {OUTPUT_PATH}...")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    fig.savefig(
        OUTPUT_PATH,
        dpi=dpi,
        facecolor=land_color,
        edgecolor='none',
        bbox_inches='tight',
        pad_inches=0,
    )
    plt.close(fig)

    # Check file size
    file_size = OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"  File size: {file_size:.1f} MB")

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)

# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    create_ground_map()
