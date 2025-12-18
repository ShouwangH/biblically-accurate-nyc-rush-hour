#!/usr/bin/env python3
"""
Road Segment Tiling Script

Groups road segments by 512m tiles for LOD streaming.
Outputs binary position files and tile manifests.

Per LOD_TILING_PLAN.md:
- 512m tile size
- Binary output for efficient loading
- Assigns each segment to all tiles it touches

Usage:
    python scripts/tile_roads.py

Outputs:
    public/assets/tiles/roads/{x}_{z}.bin - Binary road positions per tile
    public/assets/tiles/roads_index.json - Tile index
"""

import json
import struct
import os
from pathlib import Path
from typing import Dict, List, Set, Tuple
from collections import defaultdict

# =============================================================================
# Constants (matching src/constants/lod.ts)
# =============================================================================

TILE_SIZE = 512  # meters per tile edge

# Input/output paths
INPUT_FILE = "public/assets/road_segments.json"
OUTPUT_DIR = "public/assets/tiles/roads"
INDEX_FILE = "public/assets/tiles/roads_index.json"


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


def get_segment_tiles(points: List[List[float]]) -> Set[Tuple[int, int]]:
    """
    Get all tiles a segment touches.
    A segment may span multiple tiles.
    """
    tiles = set()
    for point in points:
        x, _, z = point  # [x, y, z]
        tiles.add(world_to_tile(x, z))
    return tiles


# =============================================================================
# Main Processing
# =============================================================================

def process_roads():
    """Process road segments into per-tile binary files."""
    print(f"Loading road segments from {INPUT_FILE}...")

    with open(INPUT_FILE, "r") as f:
        data = json.load(f)

    segments = data["segments"]
    print(f"Processing {len(segments)} segments...")

    # Group segments by tile
    # Each tile gets a list of (segment_id, points) tuples
    tile_segments: Dict[str, List[Tuple[str, List[List[float]]]]] = defaultdict(list)

    for segment in segments:
        seg_id = segment["id"]
        points = segment["points"]

        # Assign segment to all tiles it touches
        tiles = get_segment_tiles(points)
        for tile_x, tile_z in tiles:
            key = tile_key(tile_x, tile_z)
            tile_segments[key].append((seg_id, points))

    print(f"Found {len(tile_segments)} tiles with road segments")

    # Create output directory
    output_path = Path(OUTPUT_DIR)
    output_path.mkdir(parents=True, exist_ok=True)

    # Write binary files per tile
    tile_index = {
        "version": 1,
        "tileSize": TILE_SIZE,
        "tiles": {}
    }

    for key, segs in tile_segments.items():
        # Convert to binary format:
        # For each segment: [num_points (uint16), then points as float32 x,y,z triplets]
        # This allows efficient parsing in JavaScript

        # Alternative simpler format: flat array of line positions
        # Just pairs of points for line segments: [x1,y1,z1, x2,y2,z2, ...]
        line_positions = []

        for seg_id, points in segs:
            # Convert polyline to line segments
            for i in range(len(points) - 1):
                p1 = points[i]
                p2 = points[i + 1]
                line_positions.extend([p1[0], p1[1], p1[2]])  # x, y, z
                line_positions.extend([p2[0], p2[1], p2[2]])  # x, y, z

        # Write as binary float32 array
        bin_file = output_path / f"{key}.bin"
        with open(bin_file, "wb") as f:
            # Write as packed float32 array
            for val in line_positions:
                f.write(struct.pack("<f", val))  # Little-endian float32

        # Track in index
        tile_parts = key.split("_")
        tile_x, tile_z = int(tile_parts[0]), int(tile_parts[1])

        tile_index["tiles"][key] = {
            "x": tile_x,
            "z": tile_z,
            "segmentCount": len(segs),
            "lineCount": len(line_positions) // 6,  # 6 floats per line segment
            "byteLength": len(line_positions) * 4,  # 4 bytes per float
            "binUrl": f"tiles/roads/{key}.bin"
        }

    # Compute bounds
    all_keys = list(tile_index["tiles"].keys())
    if all_keys:
        xs = [tile_index["tiles"][k]["x"] for k in all_keys]
        zs = [tile_index["tiles"][k]["z"] for k in all_keys]
        tile_index["bounds"] = {
            "minTileX": min(xs),
            "maxTileX": max(xs),
            "minTileZ": min(zs),
            "maxTileZ": max(zs),
        }

    # Write index
    index_path = Path(INDEX_FILE)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    with open(index_path, "w") as f:
        json.dump(tile_index, f, indent=2)

    print(f"Wrote {len(tile_index['tiles'])} tile files to {OUTPUT_DIR}")
    print(f"Wrote index to {INDEX_FILE}")

    # Summary stats
    total_bytes = sum(t["byteLength"] for t in tile_index["tiles"].values())
    print(f"Total binary size: {total_bytes / 1024:.1f} KB")
    print(f"Bounds: X [{tile_index.get('bounds', {}).get('minTileX', 'N/A')} - {tile_index.get('bounds', {}).get('maxTileX', 'N/A')}], "
          f"Z [{tile_index.get('bounds', {}).get('minTileZ', 'N/A')} - {tile_index.get('bounds', {}).get('maxTileZ', 'N/A')}]")


if __name__ == "__main__":
    process_roads()
