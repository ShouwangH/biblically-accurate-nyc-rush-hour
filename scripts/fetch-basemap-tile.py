#!/usr/bin/env python3
"""
Fetch Basemap Tile for Ground Texture

Downloads a pre-styled basemap tile from a free tile service.
Uses Stadia Maps "Stamen Toner Lite" - a muted grey style perfect
for subordinate ground layers.

No GIS software needed - just downloads an image.

Usage:
    python scripts/fetch-basemap-tile.py

Output: public/assets/ground_map.png

Note: Stadia Maps free tier allows 200k tiles/month - plenty for dev.
"""

import os
import sys
import math
import urllib.request
from pathlib import Path

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_PATH = PROJECT_ROOT / "public" / "assets" / "ground_map.jpg"

# Bounds (WGS84)
BOUNDS = {
    "west": -74.025,
    "east": -73.965,
    "south": 40.698,
    "north": 40.758,
}

# Tile services (XYZ format unless noted)
TILE_SERVICES = {
    # NYC Official Basemap - TMS format (Y-axis flipped), has parks and water
    "nyc_basemap_tms": "https://maps.nyc.gov/tms/1.0.0/carto/basemap/{z}/{x}/{y}.jpg",

    # Stadia Maps - Stamen Toner Lite (muted grey fallback)
    "stadia_toner_lite": "https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png",

    # Carto Positron (very light grey, no color)
    "carto_positron": "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",

    # Carto Positron No Labels (clean grayscale, no text)
    "carto_positron_nolabels": "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",

    # Carto Voyager (subtle colors - blue water, green parks)
    "carto_voyager": "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",

    # Carto Voyager Labels Under (cleaner, labels under features)
    "carto_voyager_labels_under": "https://a.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}.png",
}

# Services that use TMS format (Y-axis flipped from XYZ)
TMS_SERVICES = {"nyc_basemap_tms"}

# Which service to use
# NYC basemap has proper parks and water styling
TILE_SERVICE = "nyc_basemap_tms"

# Zoom level (higher = more detail, more tiles)
# 15 = ~4.8m/pixel, good for city blocks
# 16 = ~2.4m/pixel, good for individual buildings
ZOOM_LEVEL = 15

# =============================================================================
# Tile Math
# =============================================================================

def lng_to_tile_x(lng: float, zoom: int) -> int:
    """Convert longitude to tile X coordinate."""
    return int((lng + 180.0) / 360.0 * (2 ** zoom))

def lat_to_tile_y(lat: float, zoom: int) -> int:
    """Convert latitude to tile Y coordinate."""
    lat_rad = math.radians(lat)
    n = 2 ** zoom
    return int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)

def tile_bounds(x: int, y: int, zoom: int) -> dict:
    """Get WGS84 bounds of a tile."""
    n = 2 ** zoom

    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0

    north_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    south_rad = math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))

    north = math.degrees(north_rad)
    south = math.degrees(south_rad)

    return {"west": west, "east": east, "south": south, "north": north}

# =============================================================================
# Image Handling (pure Python, no PIL)
# =============================================================================

def download_tile(url: str) -> bytes:
    """Download a single tile."""
    headers = {
        "User-Agent": "NYC-Rush-Hour-Viz/1.0 (https://github.com/ShouwangH/biblically-accurate-nyc-rush-hour)"
    }
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read()
    except Exception as e:
        print(f"  Failed to download {url}: {e}")
        return None

def create_composite_image_simple(tiles: list, grid_width: int, grid_height: int, tile_size: int = 256) -> bytes:
    """
    Create a simple composite by concatenating PNG tiles.

    This is a fallback that just saves one tile if we can't do proper compositing.
    For proper compositing, use PIL version below.
    """
    # Without PIL, we can't easily composite PNGs
    # Just save the center tile as a placeholder
    center_idx = (grid_height // 2) * grid_width + (grid_width // 2)
    if center_idx < len(tiles) and tiles[center_idx]:
        return tiles[center_idx]

    # Return first valid tile
    for tile in tiles:
        if tile:
            return tile

    return None

# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("BASEMAP TILE FETCHER")
    print("=" * 60)

    # Check for PIL (optional but better)
    try:
        from PIL import Image
        import io
        has_pil = True
        print("Using PIL for image compositing")
    except ImportError:
        has_pil = False
        print("PIL not found - will save single tile only")
        print("For full composite: pip install Pillow")

    zoom = ZOOM_LEVEL
    tile_url_template = TILE_SERVICES[TILE_SERVICE]

    print(f"\nService: {TILE_SERVICE}")
    print(f"Zoom level: {zoom}")
    print(f"Bounds: {BOUNDS}")

    # Calculate tile range
    x_min = lng_to_tile_x(BOUNDS["west"], zoom)
    x_max = lng_to_tile_x(BOUNDS["east"], zoom)
    y_min = lat_to_tile_y(BOUNDS["north"], zoom)  # Note: y is inverted
    y_max = lat_to_tile_y(BOUNDS["south"], zoom)

    grid_width = x_max - x_min + 1
    grid_height = y_max - y_min + 1
    total_tiles = grid_width * grid_height

    print(f"\nTile grid: {grid_width} x {grid_height} = {total_tiles} tiles")
    print(f"Tile range: X={x_min}-{x_max}, Y={y_min}-{y_max}")

    # Download tiles
    print("\nDownloading tiles...")
    tiles = []

    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            # TMS format uses flipped Y-axis: tms_y = (2^zoom - 1) - xyz_y
            if TILE_SERVICE in TMS_SERVICES:
                tile_y = (2 ** zoom - 1) - y
            else:
                tile_y = y
            url = tile_url_template.format(z=zoom, x=x, y=tile_y)
            print(f"  Fetching tile {x},{y}...", end=" ")
            tile_data = download_tile(url)
            if tile_data:
                print(f"OK ({len(tile_data)} bytes)")
                tiles.append(tile_data)
            else:
                print("FAILED")
                tiles.append(None)

    # Composite tiles
    print("\nCompositing...")

    if has_pil:
        # Use PIL for proper compositing
        tile_size = 256
        composite = Image.new('RGB', (grid_width * tile_size, grid_height * tile_size))

        for i, tile_data in enumerate(tiles):
            if tile_data:
                tile_img = Image.open(io.BytesIO(tile_data))
                x_pos = (i % grid_width) * tile_size
                y_pos = (i // grid_width) * tile_size
                composite.paste(tile_img, (x_pos, y_pos))

        # Resize to 4096x4096
        print(f"  Resizing from {composite.size} to 4096x4096...")
        composite = composite.resize((4096, 4096), Image.Resampling.LANCZOS)

        # Save as JPEG (smaller file size)
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        composite.save(OUTPUT_PATH, "JPEG", quality=85, optimize=True)

    else:
        # Fallback: just save one tile
        for tile_data in tiles:
            if tile_data:
                OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
                with open(OUTPUT_PATH, 'wb') as f:
                    f.write(tile_data)
                break

    # Report
    file_size = OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"\nSaved to: {OUTPUT_PATH}")
    print(f"File size: {file_size:.2f} MB")

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)

    return 0

if __name__ == "__main__":
    sys.exit(main())
