#!/usr/bin/env python3
"""
Station Tiling Script

Assigns subway stations to tiles for LOD streaming visibility.

Per LOD_TILING_PLAN.md:
- 512m tile size
- Stations assigned to single tile based on surfacePosition

Usage:
    python scripts/tile_stations.py

Outputs:
    public/assets/tiles/stations_by_tile.json - Station IDs per tile
"""

import json
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict

# =============================================================================
# Constants (matching src/constants/lod.ts)
# =============================================================================

TILE_SIZE = 512  # meters per tile edge

# Input/output paths
INPUT_FILE = "public/assets/stations.json"
OUTPUT_FILE = "public/assets/tiles/stations_by_tile.json"


# =============================================================================
# Tile Utilities
# =============================================================================

def world_to_tile(x: float, z: float) -> Tuple[int, int]:
    """Convert world coordinates to tile coordinates."""
    tile_x = int(x // TILE_SIZE)
    tile_z = int(z // TILE_SIZE)
    return (tile_x, tile_z)


def tile_key(tile_x: int, tile_z: int) -> str:
    """Generate tile key string."""
    return f"{tile_x}_{tile_z}"


# =============================================================================
# Main Processing
# =============================================================================

def process_stations():
    """Process stations into per-tile assignments."""
    print(f"Loading stations from {INPUT_FILE}...")

    with open(INPUT_FILE, "r") as f:
        data = json.load(f)

    stations = data["stations"]
    print(f"Processing {len(stations)} stations...")

    # Group stations by tile
    tile_stations: Dict[str, List[str]] = defaultdict(list)

    for station in stations:
        station_id = station["id"]
        # Use surfacePosition for tile assignment (street level)
        surface_pos = station.get("surfacePosition", station["position"])
        x, _, z = surface_pos

        tile_x, tile_z = world_to_tile(x, z)
        key = tile_key(tile_x, tile_z)
        tile_stations[key].append(station_id)

    print(f"Found {len(tile_stations)} tiles with stations")

    # Build output
    output = {
        "version": 1,
        "tileSize": TILE_SIZE,
        "totalStations": len(stations),
        "tilesWithStations": len(tile_stations),
        "tiles": {}
    }

    for key, station_ids in tile_stations.items():
        tile_parts = key.split("_")
        tile_x, tile_z = int(tile_parts[0]), int(tile_parts[1])

        output["tiles"][key] = {
            "x": tile_x,
            "z": tile_z,
            "stationIds": station_ids,
            "stationCount": len(station_ids)
        }

    # Compute bounds
    if tile_stations:
        xs = [output["tiles"][k]["x"] for k in output["tiles"]]
        zs = [output["tiles"][k]["z"] for k in output["tiles"]]
        output["bounds"] = {
            "minTileX": min(xs),
            "maxTileX": max(xs),
            "minTileZ": min(zs),
            "maxTileZ": max(zs),
        }

    # Write output
    output_path = Path(OUTPUT_FILE)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote station assignments to {OUTPUT_FILE}")

    # Summary
    for key, data in output["tiles"].items():
        print(f"  Tile {key}: {data['stationCount']} stations")


if __name__ == "__main__":
    process_stations()
