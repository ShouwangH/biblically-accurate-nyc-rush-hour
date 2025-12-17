#!/usr/bin/env python3
"""
Map Stations to Subway Line Segments

This script enriches stations.json with segment mapping information.
For each station, for each line it serves, it finds:
  - The segment index on that line closest to the station
  - The progress (0-1) along that segment where the station is located

This mapping enables authentic MTA schedule data to be converted into
segment traversal times for visualization.

Usage:
    python scripts/map-stations-to-segments.py           # Preview (dry run)
    python scripts/map-stations-to-segments.py --write   # Write to stations.json

Output adds to each station:
    "segmentMapping": {
        "1": { "segmentIndex": 3, "progressAlongSegment": 0.45 },
        "4": { "segmentIndex": 12, "progressAlongSegment": 0.82 },
        ...
    }
"""

import json
import math
import os
import sys
from typing import List, Dict, Any, Tuple, Optional

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIONS_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "stations.json")
SUBWAY_LINES_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "subway_lines.json")

# Maximum distance (meters) to consider a valid match
MAX_MATCH_DISTANCE = 200

# =============================================================================
# Geometry Utilities
# =============================================================================

def distance_3d(p1: List[float], p2: List[float]) -> float:
    """Calculate 3D distance between two points."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    dz = p2[2] - p1[2]
    return math.sqrt(dx*dx + dy*dy + dz*dz)


def point_to_segment_distance(point: List[float], seg_start: List[float], seg_end: List[float]) -> Tuple[float, float]:
    """
    Calculate the distance from a point to a line segment and the progress along it.

    Returns:
        (distance, progress) where progress is in [0, 1]
    """
    # Vector from seg_start to seg_end
    dx = seg_end[0] - seg_start[0]
    dy = seg_end[1] - seg_start[1]
    dz = seg_end[2] - seg_start[2]

    # Segment length squared
    seg_len_sq = dx*dx + dy*dy + dz*dz

    if seg_len_sq < 1e-10:
        # Degenerate segment (zero length)
        return distance_3d(point, seg_start), 0.0

    # Vector from seg_start to point
    px = point[0] - seg_start[0]
    py = point[1] - seg_start[1]
    pz = point[2] - seg_start[2]

    # Project point onto line, clamped to segment
    t = (px*dx + py*dy + pz*dz) / seg_len_sq
    t = max(0.0, min(1.0, t))

    # Closest point on segment
    closest = [
        seg_start[0] + t * dx,
        seg_start[1] + t * dy,
        seg_start[2] + t * dz
    ]

    return distance_3d(point, closest), t


def point_to_polyline_distance(point: List[float], polyline: List[List[float]]) -> Tuple[float, float]:
    """
    Calculate the distance from a point to a polyline and the overall progress.

    Returns:
        (distance, progress) where progress is overall progress along entire polyline [0, 1]
    """
    if len(polyline) < 2:
        if len(polyline) == 1:
            return distance_3d(point, polyline[0]), 0.0
        return float('inf'), 0.0

    # Calculate cumulative lengths
    segment_lengths = []
    for i in range(len(polyline) - 1):
        segment_lengths.append(distance_3d(polyline[i], polyline[i+1]))

    total_length = sum(segment_lengths)
    if total_length < 1e-10:
        return distance_3d(point, polyline[0]), 0.0

    # Find closest point on polyline
    min_distance = float('inf')
    best_progress = 0.0
    cumulative_length = 0.0

    for i in range(len(polyline) - 1):
        dist, seg_progress = point_to_segment_distance(point, polyline[i], polyline[i+1])

        if dist < min_distance:
            min_distance = dist
            # Calculate overall progress
            progress_at_start = cumulative_length / total_length
            progress_in_segment = (seg_progress * segment_lengths[i]) / total_length
            best_progress = progress_at_start + progress_in_segment

        cumulative_length += segment_lengths[i]

    return min_distance, best_progress


# =============================================================================
# Main Logic
# =============================================================================

def find_segment_for_station_line(
    station_pos: List[float],
    line_segments: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Find the best segment match for a station on a specific line.

    Returns:
        {"segmentIndex": int, "progressAlongSegment": float, "distance": float}
        or None if no valid match found
    """
    best_match = None
    best_distance = float('inf')

    for seg_idx, segment in enumerate(line_segments):
        points = segment.get("points", [])
        if len(points) < 2:
            continue

        dist, progress = point_to_polyline_distance(station_pos, points)

        if dist < best_distance:
            best_distance = dist
            best_match = {
                "segmentIndex": seg_idx,
                "progressAlongSegment": round(progress, 4),
                "distance": round(dist, 1)  # For debugging/validation
            }

    if best_match and best_match["distance"] > MAX_MATCH_DISTANCE:
        return None

    return best_match


def map_stations_to_segments(
    stations_data: Dict[str, Any],
    subway_lines_data: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Add segment mapping to all stations.

    Returns:
        (enriched_stations_data, stats)
    """
    # Build line lookup
    lines_by_id = {}
    for line in subway_lines_data.get("lines", []):
        lines_by_id[line["id"]] = line

    stats = {
        "total_stations": 0,
        "total_mappings": 0,
        "failed_mappings": 0,
        "missing_lines": [],
        "far_matches": []
    }

    for station in stations_data.get("stations", []):
        stats["total_stations"] += 1
        station_pos = station.get("position", [0, 0, 0])
        station_lines = station.get("lines", [])
        station_name = station.get("name", "Unknown")

        segment_mapping = {}

        for line_id in station_lines:
            if line_id not in lines_by_id:
                stats["missing_lines"].append({
                    "station": station_name,
                    "line": line_id
                })
                continue

            line = lines_by_id[line_id]
            segments = line.get("segments", [])

            match = find_segment_for_station_line(station_pos, segments)

            if match:
                stats["total_mappings"] += 1
                # Store without distance (for clean output)
                segment_mapping[line_id] = {
                    "segmentIndex": match["segmentIndex"],
                    "progressAlongSegment": match["progressAlongSegment"]
                }

                # Track far but valid matches
                if match["distance"] > 50:
                    stats["far_matches"].append({
                        "station": station_name,
                        "line": line_id,
                        "distance": match["distance"]
                    })
            else:
                stats["failed_mappings"] += 1
                stats["missing_lines"].append({
                    "station": station_name,
                    "line": line_id,
                    "reason": "no_match_within_threshold"
                })

        station["segmentMapping"] = segment_mapping

    return stations_data, stats


def print_stats(stats: Dict[str, Any]):
    """Print mapping statistics."""
    print("\n" + "=" * 60)
    print("STATION-TO-SEGMENT MAPPING RESULTS")
    print("=" * 60)

    print(f"\nStations processed: {stats['total_stations']}")
    print(f"Successful mappings: {stats['total_mappings']}")
    print(f"Failed mappings: {stats['failed_mappings']}")

    if stats["missing_lines"]:
        print(f"\n⚠️  Missing/failed line mappings ({len(stats['missing_lines'])}):")
        for item in stats["missing_lines"][:10]:
            reason = item.get("reason", "line_not_in_subway_lines.json")
            print(f"   - {item['station']} → {item['line']}: {reason}")
        if len(stats["missing_lines"]) > 10:
            print(f"   ... and {len(stats['missing_lines']) - 10} more")

    if stats["far_matches"]:
        print(f"\n⚠️  Far matches (>50m) ({len(stats['far_matches'])}):")
        for item in stats["far_matches"][:10]:
            print(f"   - {item['station']} → {item['line']}: {item['distance']}m")
        if len(stats["far_matches"]) > 10:
            print(f"   ... and {len(stats['far_matches']) - 10} more")

    success_rate = (stats['total_mappings'] /
                    (stats['total_mappings'] + stats['failed_mappings']) * 100
                    if (stats['total_mappings'] + stats['failed_mappings']) > 0 else 0)
    print(f"\nSuccess rate: {success_rate:.1f}%")
    print("=" * 60)


def preview_sample(stations_data: Dict[str, Any], n: int = 3):
    """Print a sample of mapped stations for preview."""
    print("\n" + "=" * 60)
    print("SAMPLE MAPPED STATIONS")
    print("=" * 60)

    for i, station in enumerate(stations_data.get("stations", [])[:n]):
        print(f"\n[{station.get('name', 'Unknown')}]")
        print(f"  Lines: {station.get('lines', [])}")
        print(f"  Position: {station.get('position', [])}")
        mapping = station.get("segmentMapping", {})
        if mapping:
            print("  Segment Mapping:")
            for line_id, info in mapping.items():
                print(f"    {line_id}: segment {info['segmentIndex']}, progress {info['progressAlongSegment']}")
        else:
            print("  Segment Mapping: (none)")


# =============================================================================
# Main
# =============================================================================

def main():
    write_mode = "--write" in sys.argv

    print("=" * 60)
    print("STATION-TO-SEGMENT MAPPER")
    print("=" * 60)
    print(f"Mode: {'WRITE' if write_mode else 'PREVIEW (dry run)'}")
    print(f"Stations: {STATIONS_PATH}")
    print(f"Subway Lines: {SUBWAY_LINES_PATH}")

    # Load data
    print("\nLoading data...")
    with open(STATIONS_PATH, "r") as f:
        stations_data = json.load(f)

    with open(SUBWAY_LINES_PATH, "r") as f:
        subway_lines_data = json.load(f)

    print(f"  Loaded {len(stations_data.get('stations', []))} stations")
    print(f"  Loaded {len(subway_lines_data.get('lines', []))} subway lines")

    # Map stations to segments
    print("\nMapping stations to segments...")
    enriched_data, stats = map_stations_to_segments(stations_data, subway_lines_data)

    # Print results
    print_stats(stats)
    preview_sample(enriched_data)

    # Write if requested
    if write_mode:
        print("\n" + "=" * 60)
        print("WRITING OUTPUT")
        print("=" * 60)

        with open(STATIONS_PATH, "w") as f:
            json.dump(enriched_data, f, indent=2)

        print(f"✓ Written to {STATIONS_PATH}")
    else:
        print("\n" + "-" * 60)
        print("Dry run complete. To write changes:")
        print("  python scripts/map-stations-to-segments.py --write")

    return 0


if __name__ == "__main__":
    sys.exit(main())
