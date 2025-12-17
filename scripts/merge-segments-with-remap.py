#!/usr/bin/env python3
"""
Merge Tiny Subway Segments with Schedule Remapping

Merges consecutive tiny segments in subway_lines.json AND updates
train_schedules.json segment indices accordingly.

This PRESERVES existing train timing while combining tiny segments
to eliminate jittering caused by sub-frame traversals.

Usage:
    python scripts/merge-segments-with-remap.py           # Preview
    python scripts/merge-segments-with-remap.py --write   # Apply

After --write, run tests to verify no regression.
"""

import json
import math
import os
import sys
from typing import List, Dict, Any, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SUBWAY_LINES_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "subway_lines.json")
TRAIN_SCHEDULES_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "train_schedules.json")

# Segments shorter than this will be merged with neighbors
MIN_SEGMENT_LENGTH = 25.0
# Don't create segments longer than this
MAX_SEGMENT_LENGTH = 600.0


def distance_3d(p1: List[float], p2: List[float]) -> float:
    dx, dy, dz = p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def polyline_length(points: List[List[float]]) -> float:
    if len(points) < 2:
        return 0.0
    return sum(distance_3d(points[i], points[i + 1]) for i in range(len(points) - 1))


def points_equal(p1: List[float], p2: List[float], epsilon: float = 0.1) -> bool:
    return distance_3d(p1, p2) < epsilon


def merge_segments_with_mapping(
    segments: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[int, Tuple[int, float, float]]]:
    """
    Merge consecutive tiny segments, preserving polyline shape.

    Returns:
        (merged_segments, index_mapping)

        index_mapping: old_idx -> (new_idx, progress_start, progress_scale)

        progress_start: where this old segment starts within the new merged segment (0-1)
        progress_scale: how much of the new segment this old segment represents (0-1)
    """
    if not segments:
        return [], {}

    merged = []
    index_mapping = {}

    current_points = list(segments[0].get("points", []))
    current_length = polyline_length(current_points)
    current_start_idx = 0  # First old index in current group
    segments_in_current = [(0, current_length)]  # (old_idx, length)

    for i in range(1, len(segments)):
        seg_points = segments[i].get("points", [])
        if len(seg_points) < 2:
            # Empty segment - map it to current merged segment at end
            index_mapping[i] = (len(merged), 1.0, 0.0)
            continue

        seg_length = polyline_length(seg_points)

        # Check continuity
        if current_points and not points_equal(current_points[-1], seg_points[0]):
            # Gap - save current and start new
            _finalize_group(merged, index_mapping, current_points, segments_in_current)
            current_points = list(seg_points)
            current_length = seg_length
            current_start_idx = i
            segments_in_current = [(i, seg_length)]
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
            segments_in_current.append((i, seg_length))
        else:
            _finalize_group(merged, index_mapping, current_points, segments_in_current)
            current_points = list(seg_points)
            current_length = seg_length
            current_start_idx = i
            segments_in_current = [(i, seg_length)]

    # Don't forget last segment
    if len(current_points) >= 2:
        _finalize_group(merged, index_mapping, current_points, segments_in_current)

    return merged, index_mapping


def _finalize_group(
    merged: List[Dict[str, Any]],
    index_mapping: Dict[int, Tuple[int, float, float]],
    points: List[List[float]],
    segments_in_group: List[Tuple[int, float]]
):
    """Save a merged segment and update index mappings."""
    new_idx = len(merged)
    merged.append({"points": points})

    total_length = sum(length for _, length in segments_in_group)
    if total_length < 1e-6:
        total_length = 1.0

    cumulative = 0.0
    for old_idx, length in segments_in_group:
        progress_start = cumulative / total_length
        progress_scale = length / total_length
        index_mapping[old_idx] = (new_idx, progress_start, progress_scale)
        cumulative += length


def remap_train_schedules(
    trains: List[Dict[str, Any]],
    line_mappings: Dict[str, Dict[int, Tuple[int, float, float]]]
) -> List[Dict[str, Any]]:
    """
    Remap train schedules to use new segment indices.

    For trains spanning multiple old segments that merged into one,
    we keep a single run with combined timing.
    """
    # Group runs by trip prefix (e.g., "1-N-0098")
    trips = {}
    for train in trains:
        # Extract trip prefix (everything before "-seg")
        train_id = train["id"]
        if "-seg" in train_id:
            trip_prefix = train_id.rsplit("-seg", 1)[0]
        else:
            trip_prefix = train_id

        if trip_prefix not in trips:
            trips[trip_prefix] = []
        trips[trip_prefix].append(train)

    remapped = []
    merged_count = 0

    for trip_prefix, trip_runs in trips.items():
        # Sort by tEnter to process in order
        trip_runs.sort(key=lambda r: r["tEnter"])

        line_id = trip_runs[0]["lineId"]
        mapping = line_mappings.get(line_id, {})

        if not mapping:
            # No mapping for this line - keep as-is
            remapped.extend(trip_runs)
            continue

        # Merge consecutive runs that now map to the same segment
        current_run = None

        for run in trip_runs:
            old_idx = run["segmentIndex"]
            if old_idx not in mapping:
                # Segment doesn't exist in mapping (out of range?)
                if current_run:
                    remapped.append(current_run)
                    current_run = None
                remapped.append(run)
                continue

            new_idx, prog_start, prog_scale = mapping[old_idx]

            if current_run is None:
                # Start new run
                current_run = {
                    "id": f"{trip_prefix}-seg{new_idx}",
                    "lineId": line_id,
                    "segmentIndex": new_idx,
                    "direction": run["direction"],
                    "tEnter": run["tEnter"],
                    "tExit": run["tExit"],
                    "crowding": run["crowding"],
                }
            elif current_run["segmentIndex"] == new_idx:
                # Same merged segment - extend timing
                current_run["tExit"] = run["tExit"]
                merged_count += 1
            else:
                # Different segment - save current and start new
                remapped.append(current_run)
                current_run = {
                    "id": f"{trip_prefix}-seg{new_idx}",
                    "lineId": line_id,
                    "segmentIndex": new_idx,
                    "direction": run["direction"],
                    "tEnter": run["tEnter"],
                    "tExit": run["tExit"],
                    "crowding": run["crowding"],
                }

        if current_run:
            remapped.append(current_run)

    print(f"  Merged {merged_count} runs into combined segments")
    return remapped


def main():
    write_mode = "--write" in sys.argv

    print("=" * 60)
    print("SUBWAY SEGMENT MERGER WITH SCHEDULE REMAPPING")
    print("=" * 60)
    print(f"Mode: {'WRITE' if write_mode else 'PREVIEW'}")
    print(f"Min segment: {MIN_SEGMENT_LENGTH}m | Max: {MAX_SEGMENT_LENGTH}m")

    # Load data
    with open(SUBWAY_LINES_PATH, "r") as f:
        lines_data = json.load(f)

    with open(TRAIN_SCHEDULES_PATH, "r") as f:
        schedules_data = json.load(f)

    lines = lines_data.get("lines", [])
    trains = schedules_data.get("trains", [])

    print(f"\nLoaded {len(lines)} lines, {len(trains)} train runs")

    # Process each line
    line_mappings = {}
    total_orig, total_merged = 0, 0

    print(f"\n{'Line':<6} {'Before':>8} {'After':>8} {'Merged':>8}")
    print("-" * 40)

    for line in lines:
        line_id = line["id"]
        segments = line.get("segments", [])
        orig_count = len(segments)

        merged_segments, mapping = merge_segments_with_mapping(segments)
        line["segments"] = merged_segments
        line_mappings[line_id] = mapping

        new_count = len(merged_segments)
        print(f"{line_id:<6} {orig_count:>8} {new_count:>8} {orig_count - new_count:>8}")

        total_orig += orig_count
        total_merged += new_count

    print("-" * 40)
    print(f"{'TOTAL':<6} {total_orig:>8} {total_merged:>8} {total_orig - total_merged:>8}")
    print(f"\nSegment reduction: {(1 - total_merged/total_orig)*100:.1f}%")

    # Remap train schedules
    print("\nRemapping train schedules...")
    remapped_trains = remap_train_schedules(trains, line_mappings)
    schedules_data["trains"] = remapped_trains

    print(f"Train runs: {len(trains)} -> {len(remapped_trains)}")

    # Validate
    print("\nValidation:")
    invalid_refs = 0
    for run in remapped_trains:
        line = next((l for l in lines if l["id"] == run["lineId"]), None)
        if line and run["segmentIndex"] >= len(line["segments"]):
            invalid_refs += 1

    if invalid_refs:
        print(f"  ERROR: {invalid_refs} runs reference invalid segment indices!")
    else:
        print(f"  All segment references valid")

    if write_mode:
        with open(SUBWAY_LINES_PATH, "w") as f:
            json.dump(lines_data, f, indent=2)
        print(f"\n Written: {SUBWAY_LINES_PATH}")

        with open(TRAIN_SCHEDULES_PATH, "w") as f:
            json.dump(schedules_data, f, indent=2)
        print(f" Written: {TRAIN_SCHEDULES_PATH}")
    else:
        print("\nDry run. To apply: python scripts/merge-segments-with-remap.py --write")

    return 0


if __name__ == "__main__":
    sys.exit(main())
