#!/usr/bin/env python3
"""
Merge Tiny Subway Segments

Merges consecutive tiny segments in subway_lines.json to prevent
sub-frame train traversal (which causes jittering).

Usage:
    python scripts/merge-tiny-segments.py           # Preview
    python scripts/merge-tiny-segments.py --write   # Apply

After --write, re-run:
    python scripts/map-stations-to-segments.py --write
    python scripts/fetch-train-schedules-gtfs.py
"""

import json
import math
import os
import sys
from typing import List, Dict, Any, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SUBWAY_LINES_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "subway_lines.json")

# Min 25m ensures train visible for multiple frames at typical subway speed
MIN_SEGMENT_LENGTH = 25.0
MAX_SEGMENT_LENGTH = 500.0


def distance_3d(p1: List[float], p2: List[float]) -> float:
    dx, dy, dz = p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def polyline_length(points: List[List[float]]) -> float:
    if len(points) < 2:
        return 0.0
    return sum(distance_3d(points[i], points[i + 1]) for i in range(len(points) - 1))


def points_equal(p1: List[float], p2: List[float], epsilon: float = 0.1) -> bool:
    return distance_3d(p1, p2) < epsilon


def merge_segments(segments: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Merge consecutive tiny segments, preserving polyline shape."""
    if not segments:
        return [], {"original": 0, "merged": 0}

    stats = {"original": len(segments), "merged": 0, "tiny_before": 0}

    # Count tiny segments before
    for seg in segments:
        if polyline_length(seg.get("points", [])) < MIN_SEGMENT_LENGTH:
            stats["tiny_before"] += 1

    merged = []
    current_points = list(segments[0].get("points", []))
    current_length = polyline_length(current_points)

    for i in range(1, len(segments)):
        seg_points = segments[i].get("points", [])
        if len(seg_points) < 2:
            continue

        seg_length = polyline_length(seg_points)

        # Check continuity
        if current_points and not points_equal(current_points[-1], seg_points[0]):
            # Gap - save current and start new
            if len(current_points) >= 2:
                merged.append({"points": current_points})
            current_points = list(seg_points)
            current_length = seg_length
            continue

        # Merge if either is tiny and combined not too long
        combined_length = current_length + seg_length
        should_merge = (
            (current_length < MIN_SEGMENT_LENGTH or seg_length < MIN_SEGMENT_LENGTH)
            and combined_length <= MAX_SEGMENT_LENGTH
        )

        if should_merge:
            current_points.extend(seg_points[1:])  # Skip duplicate start point
            current_length = combined_length
        else:
            if len(current_points) >= 2:
                merged.append({"points": current_points})
            current_points = list(seg_points)
            current_length = seg_length

    # Don't forget last segment
    if len(current_points) >= 2:
        merged.append({"points": current_points})

    stats["merged"] = len(merged)
    return merged, stats


def main():
    write_mode = "--write" in sys.argv

    print("=" * 60)
    print("SUBWAY SEGMENT MERGER")
    print("=" * 60)
    print(f"Mode: {'WRITE' if write_mode else 'PREVIEW'}")
    print(f"Min segment: {MIN_SEGMENT_LENGTH}m | Max: {MAX_SEGMENT_LENGTH}m")

    with open(SUBWAY_LINES_PATH, "r") as f:
        data = json.load(f)

    lines = data.get("lines", [])
    total_orig, total_merged, total_tiny = 0, 0, 0

    print(f"\n{'Line':<6} {'Before':>8} {'After':>8} {'Removed':>8} {'Tiny':>8}")
    print("-" * 50)

    for line in lines:
        segments = line.get("segments", [])
        merged_segments, stats = merge_segments(segments)
        line["segments"] = merged_segments

        removed = stats["original"] - stats["merged"]
        print(f"{line['id']:<6} {stats['original']:>8} {stats['merged']:>8} {removed:>8} {stats['tiny_before']:>8}")

        total_orig += stats["original"]
        total_merged += stats["merged"]
        total_tiny += stats["tiny_before"]

    print("-" * 50)
    print(f"{'TOTAL':<6} {total_orig:>8} {total_merged:>8} {total_orig - total_merged:>8} {total_tiny:>8}")
    print(f"\nReduction: {(1 - total_merged/total_orig)*100:.1f}%")

    # Check remaining tiny
    remaining = []
    for line in lines:
        for i, seg in enumerate(line.get("segments", [])):
            length = polyline_length(seg.get("points", []))
            if length < MIN_SEGMENT_LENGTH:
                remaining.append(f"  Line {line['id']} seg[{i}]: {length:.1f}m")

    if remaining:
        print(f"\n⚠ {len(remaining)} tiny segments remain (at discontinuities):")
        for r in remaining[:5]:
            print(r)

    if write_mode:
        with open(SUBWAY_LINES_PATH, "w") as f:
            json.dump(data, f, indent=2)
        print(f"\n✓ Written to {SUBWAY_LINES_PATH}")
        print("\nNext steps:")
        print("  python scripts/map-stations-to-segments.py --write")
        print("  python scripts/fetch-train-schedules-gtfs.py")
    else:
        print("\nDry run. To apply: python scripts/merge-tiny-segments.py --write")

    return 0


if __name__ == "__main__":
    sys.exit(main())
