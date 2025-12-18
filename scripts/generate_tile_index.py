#!/usr/bin/env python3
"""
Tile Index Generator

Combines road and station tile data into unified tile manifests.
Creates per-tile JSON manifests and a master index.

Per LOD_TILING_PLAN.md:
- Outputs public/assets/tiles/index.json - Master tile registry
- Outputs public/assets/tiles/tile_{x}_{z}.json - Per-tile manifests

Usage:
    python scripts/generate_tile_index.py

Prerequisites:
    Run tile_roads.py and tile_stations.py first
"""

import json
from pathlib import Path
from typing import Dict, Set, Optional
from collections import defaultdict

# =============================================================================
# Constants (matching src/constants/lod.ts)
# =============================================================================

TILE_SIZE = 512  # meters per tile edge

# Input files
ROADS_INDEX = "public/assets/tiles/roads_index.json"
STATIONS_INDEX = "public/assets/tiles/stations_by_tile.json"

# Output files
OUTPUT_DIR = "public/assets/tiles"
MASTER_INDEX = "public/assets/tiles/index.json"


# =============================================================================
# Main Processing
# =============================================================================

def load_roads_index() -> Dict:
    """Load roads tile index."""
    try:
        with open(ROADS_INDEX, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: {ROADS_INDEX} not found. Run tile_roads.py first.")
        return {"tiles": {}}


def load_stations_index() -> Dict:
    """Load stations tile index."""
    try:
        with open(STATIONS_INDEX, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: {STATIONS_INDEX} not found. Run tile_stations.py first.")
        return {"tiles": {}}


def generate_index():
    """Generate unified tile index and per-tile manifests."""
    print("Loading tile indices...")

    roads_data = load_roads_index()
    stations_data = load_stations_index()

    roads_tiles = roads_data.get("tiles", {})
    stations_tiles = stations_data.get("tiles", {})

    # Collect all unique tile keys
    all_tile_keys: Set[str] = set()
    all_tile_keys.update(roads_tiles.keys())
    all_tile_keys.update(stations_tiles.keys())

    print(f"Found {len(all_tile_keys)} unique tiles")
    print(f"  Roads tiles: {len(roads_tiles)}")
    print(f"  Stations tiles: {len(stations_tiles)}")

    # Create output directory
    output_path = Path(OUTPUT_DIR)
    output_path.mkdir(parents=True, exist_ok=True)

    # Build master index and per-tile manifests
    master_index = {
        "version": 1,
        "tileSize": TILE_SIZE,
        "bounds": None,
        "tiles": {}
    }

    for key in sorted(all_tile_keys):
        parts = key.split("_")
        tile_x, tile_z = int(parts[0]), int(parts[1])

        # Get road data for this tile
        roads_info = roads_tiles.get(key, {})
        has_roads = bool(roads_info)

        # Get station data for this tile
        stations_info = stations_tiles.get(key, {})
        station_ids = stations_info.get("stationIds", [])

        # Calculate tile bounds in world coordinates
        min_x = tile_x * TILE_SIZE
        max_x = (tile_x + 1) * TILE_SIZE
        min_z = tile_z * TILE_SIZE
        max_z = (tile_z + 1) * TILE_SIZE

        # Build per-tile manifest
        tile_manifest = {
            "coord": {"x": tile_x, "z": tile_z},
            "bounds": {
                "minX": min_x,
                "maxX": max_x,
                "minZ": min_z,
                "maxZ": max_z
            },
            "buildings": {
                "lod0Url": None,  # Will be populated when building tiling is done
                "lod1": [],
                "lod0Triangles": 0,
                "lod0Bytes": 0,
                "lod1BoxCount": 0
            },
            "roads": {
                "binUrl": roads_info.get("binUrl", ""),
                "segmentCount": roads_info.get("segmentCount", 0),
                "byteLength": roads_info.get("byteLength", 0)
            },
            "stationIds": station_ids,
            "totalBytes": roads_info.get("byteLength", 0)  # Will add building bytes later
        }

        # Write per-tile manifest
        tile_file = output_path / f"tile_{key}.json"
        with open(tile_file, "w") as f:
            json.dump(tile_manifest, f, indent=2)

        # Add to master index (summary only)
        master_index["tiles"][key] = {
            "hasBuildings": False,  # Will be updated when building tiling is done
            "hasRoads": has_roads,
            "stationCount": len(station_ids),
            "lod0Triangles": 0,
            "lod1Triangles": 0,
            "totalBytes": tile_manifest["totalBytes"]
        }

    # Compute bounds
    if all_tile_keys:
        xs = [int(k.split("_")[0]) for k in all_tile_keys]
        zs = [int(k.split("_")[1]) for k in all_tile_keys]
        master_index["bounds"] = {
            "minTileX": min(xs),
            "maxTileX": max(xs),
            "minTileZ": min(zs),
            "maxTileZ": max(zs)
        }

    # Write master index
    with open(MASTER_INDEX, "w") as f:
        json.dump(master_index, f, indent=2)

    print(f"Wrote master index to {MASTER_INDEX}")
    print(f"Wrote {len(all_tile_keys)} tile manifests to {OUTPUT_DIR}/tile_*.json")

    # Summary
    total_bytes = sum(t["totalBytes"] for t in master_index["tiles"].values())
    tiles_with_roads = sum(1 for t in master_index["tiles"].values() if t["hasRoads"])
    tiles_with_stations = sum(1 for t in master_index["tiles"].values() if t["stationCount"] > 0)

    print(f"\nSummary:")
    print(f"  Total tiles: {len(master_index['tiles'])}")
    print(f"  Tiles with roads: {tiles_with_roads}")
    print(f"  Tiles with stations: {tiles_with_stations}")
    print(f"  Total data size: {total_bytes / 1024:.1f} KB")
    if master_index["bounds"]:
        b = master_index["bounds"]
        print(f"  Bounds: X [{b['minTileX']} - {b['maxTileX']}], Z [{b['minTileZ']} - {b['maxTileZ']}]")


if __name__ == "__main__":
    generate_index()
