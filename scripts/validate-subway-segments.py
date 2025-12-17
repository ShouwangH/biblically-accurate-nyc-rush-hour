#!/usr/bin/env python3
"""
Validate and Fix Subway Line Segment Orientations

This script checks that subway line segments are consistently oriented so that:
1. Consecutive segments connect end-to-end (last point of seg N ≈ first point of seg N+1)
2. All segments flow in the same direction along the line

If segments are found to be reversed, it can optionally fix them.

Usage:
    python scripts/validate-subway-segments.py           # Validate only
    python scripts/validate-subway-segments.py --fix     # Validate and fix
"""

import json
import math
import os
import sys
from typing import List, Dict, Any, Tuple

# =============================================================================
# Configuration
# =============================================================================

CONFIG = {
    "subway_lines_path": os.path.join(os.path.dirname(__file__), "..", "src", "assets", "subway_lines.json"),
    # Maximum distance (meters) to consider two points as "connected"
    "connection_threshold": 50,
}

# =============================================================================
# Utility Functions
# =============================================================================

def distance_3d(p1: List[float], p2: List[float]) -> float:
    """Calculate 3D distance between two points."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    dz = p2[2] - p1[2]
    return math.sqrt(dx*dx + dy*dy + dz*dz)


def segment_length(points: List[List[float]]) -> float:
    """Calculate total length of a segment polyline."""
    total = 0
    for i in range(len(points) - 1):
        total += distance_3d(points[i], points[i+1])
    return total


def reverse_segment(segment: Dict[str, Any]) -> Dict[str, Any]:
    """Reverse the point order of a segment."""
    return {
        **segment,
        "points": list(reversed(segment["points"]))
    }

# =============================================================================
# Validation Logic
# =============================================================================

def get_segment_direction(points: List[List[float]]) -> str:
    """
    Determine geographic direction of a segment based on Z coordinates.
    In our coordinate system: more negative Z = further north.

    Returns: 'north', 'south', or 'mixed' if segment curves back on itself
    """
    if len(points) < 2:
        return "unknown"

    start_z = points[0][2]
    end_z = points[-1][2]
    delta_z = end_z - start_z

    # Threshold for considering direction significant
    if abs(delta_z) < 10:
        return "horizontal"
    elif delta_z < 0:
        return "north"  # Z decreasing = moving north
    else:
        return "south"  # Z increasing = moving south


def validate_line_segments(line: Dict[str, Any], normalize: bool = False) -> Dict[str, Any]:
    """
    Validate and potentially fix segment orientations for a single line.

    Args:
        line: The subway line data
        normalize: If True, flip segments so all flow in the dominant direction

    Returns a dict with:
    - issues: list of detected issues
    - fixed_segments: the corrected segments (if any changes made)
    - needs_fix: whether any segments were reversed
    """
    line_id = line["id"]
    segments = line.get("segments", [])

    if len(segments) < 2:
        return {"issues": [], "fixed_segments": segments, "needs_fix": False}

    issues = []
    reversals = 0
    direction_flips = 0

    # Check geographic direction consistency
    directions = []
    for i, seg in enumerate(segments):
        direction = get_segment_direction(seg["points"])
        directions.append(direction)

    # Count direction types
    north_count = directions.count("north")
    south_count = directions.count("south")
    dominant_direction = "north" if north_count >= south_count else "south"

    # Report segments that go against the dominant direction
    for i, direction in enumerate(directions):
        if direction != "horizontal" and direction != dominant_direction:
            issues.append({
                "type": "direction_mismatch",
                "segment_index": i,
                "message": f"Segment {i} goes {direction} while most segments go {dominant_direction} (length: {segment_length(segments[i]['points']):.0f}m)"
            })

    # Single pass: fix connectivity first, then normalize direction only where it doesn't break connectivity
    fixed_segments = [segments[0]]

    for i in range(1, len(segments)):
        prev_seg = fixed_segments[-1]
        curr_seg = segments[i]

        prev_end = prev_seg["points"][-1]
        curr_start = curr_seg["points"][0]
        curr_end = curr_seg["points"][-1]

        # Check which orientation connects better
        dist_normal = distance_3d(prev_end, curr_start)
        dist_reversed = distance_3d(prev_end, curr_end)

        if dist_normal <= CONFIG["connection_threshold"]:
            # Normal orientation connects fine
            fixed_segments.append(curr_seg)
        elif dist_reversed <= CONFIG["connection_threshold"]:
            # Need to reverse this segment for connectivity
            issues.append({
                "type": "reversed_segment",
                "segment_index": i,
                "message": f"Segment {i} is reversed (end-to-end distance: {dist_normal:.1f}m, reversed: {dist_reversed:.1f}m)"
            })
            fixed_segments.append(reverse_segment(curr_seg))
            reversals += 1
        else:
            # Neither orientation connects well - gap in the line
            # At a gap, we can safely normalize direction without breaking connectivity
            if normalize:
                curr_dir = directions[i]
                if curr_dir != "horizontal" and curr_dir != dominant_direction:
                    # Flip this segment to match dominant direction (safe because there's a gap)
                    fixed_segments.append(reverse_segment(curr_seg))
                    direction_flips += 1
                else:
                    fixed_segments.append(curr_seg)
            else:
                fixed_segments.append(curr_seg)

            issues.append({
                "type": "gap",
                "segment_index": i,
                "message": f"Gap between segments {i-1} and {i} (distances: normal={dist_normal:.1f}m, reversed={dist_reversed:.1f}m)"
            })

    return {
        "issues": issues,
        "fixed_segments": fixed_segments,
        "needs_fix": reversals > 0 or direction_flips > 0,
        "reversals": reversals,
        "direction_flips": direction_flips,
        "dominant_direction": dominant_direction,
        "direction_counts": {"north": north_count, "south": south_count}
    }


def validate_all_lines(data: Dict[str, Any], normalize: bool = False) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Validate all subway lines and return fixed data plus report.

    Args:
        data: The subway lines data
        normalize: If True, flip segments so all flow in the dominant direction

    Returns:
    - fixed_data: the data with corrected segment orientations
    - report: list of issues found per line
    """
    report = []
    fixed_lines = []

    for line in data.get("lines", []):
        result = validate_line_segments(line, normalize=normalize)

        line_report = {
            "line_id": line["id"],
            "line_name": line["name"],
            "segment_count": len(line.get("segments", [])),
            "issues": result["issues"],
            "reversals": result.get("reversals", 0),
            "direction_flips": result.get("direction_flips", 0),
            "dominant_direction": result.get("dominant_direction", "unknown"),
            "direction_counts": result.get("direction_counts", {})
        }
        report.append(line_report)

        # Create fixed line with corrected segments
        fixed_line = {
            **line,
            "segments": result["fixed_segments"]
        }
        fixed_lines.append(fixed_line)

    fixed_data = {
        **data,
        "lines": fixed_lines
    }

    return fixed_data, report


def print_report(report: List[Dict[str, Any]]) -> int:
    """Print validation report and return total issue count."""
    total_issues = 0
    total_reversals = 0
    direction_mismatches = 0

    print("\n" + "=" * 70)
    print("SUBWAY SEGMENT VALIDATION REPORT")
    print("=" * 70)

    for line_report in report:
        line_id = line_report["line_id"]
        issues = line_report["issues"]
        reversals = line_report["reversals"]
        dir_counts = line_report.get("direction_counts", {})
        dominant = line_report.get("dominant_direction", "unknown")

        # Count direction mismatches
        mismatch_count = sum(1 for i in issues if i.get("type") == "direction_mismatch")

        if issues:
            print(f"\n[{line_id}] {line_report['line_name']} ({line_report['segment_count']} segments)")
            print(f"    Direction: dominant={dominant}, north={dir_counts.get('north', 0)}, south={dir_counts.get('south', 0)}")
            print("-" * 50)
            for issue in issues:
                issue_type = issue.get("type", "unknown")
                if issue_type == "direction_mismatch":
                    print(f"  🔄 {issue['message']}")
                    direction_mismatches += 1
                else:
                    print(f"  ⚠️  {issue['message']}")
                total_issues += 1
            total_reversals += reversals
        else:
            dir_info = f"(dominant={dominant}, N={dir_counts.get('north', 0)}/S={dir_counts.get('south', 0)})"
            print(f"  ✓ [{line_id}] {line_report['line_name']} - OK {dir_info}")

    print("\n" + "=" * 70)
    print(f"SUMMARY: {total_issues} issues found")
    print(f"  - {total_reversals} segments need reversal (connectivity)")
    print(f"  - {direction_mismatches} segments with direction mismatch (may cause visual issues)")
    print("=" * 70)

    return total_issues

# =============================================================================
# Main
# =============================================================================

def main():
    fix_mode = "--fix" in sys.argv
    normalize_mode = "--normalize" in sys.argv

    print("=" * 70)
    print("SUBWAY SEGMENT VALIDATOR")
    print("=" * 70)
    print(f"  --fix       : Fix connectivity issues (reversed segments)")
    print(f"  --normalize : Also normalize geographic direction")
    print(f"")
    print(f"  Current mode: fix={fix_mode}, normalize={normalize_mode}")
    print("=" * 70)

    # Load subway lines
    print(f"\nLoading subway lines from {CONFIG['subway_lines_path']}...")
    with open(CONFIG["subway_lines_path"], "r") as f:
        data = json.load(f)

    print(f"Loaded {len(data.get('lines', []))} subway lines")

    # Validate (with normalize if requested for fixing)
    fixed_data, report = validate_all_lines(data, normalize=(fix_mode and normalize_mode))
    total_issues = print_report(report)

    # Count direction flips
    total_flips = sum(r.get("direction_flips", 0) for r in report)

    # Fix if requested
    if fix_mode and total_issues > 0:
        print(f"\n{'=' * 70}")
        print("APPLYING FIXES...")
        print("=" * 70)

        with open(CONFIG["subway_lines_path"], "w") as f:
            json.dump(fixed_data, f, indent=2)

        print(f"✓ Fixed segments written to {CONFIG['subway_lines_path']}")
        if total_flips > 0:
            print(f"  - {total_flips} segments had their point order reversed for direction consistency")
        print("\nNOTE: You should regenerate train_schedules.json after this fix:")
        print("  python scripts/fetch-train-schedules.py")
    elif total_issues > 0 and not fix_mode:
        print("\nTo fix connectivity issues only:")
        print("  python scripts/validate-subway-segments.py --fix")
        print("\nTo also normalize geographic direction (recommended):")
        print("  python scripts/validate-subway-segments.py --fix --normalize")
    else:
        print("\n✓ All segments are correctly oriented!")

    return 0 if total_issues == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
