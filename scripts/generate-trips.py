#!/usr/bin/env python3
"""
Generate Trip Data from MTA GTFS Static Feed

Creates trips.json with full route geometry and station-to-station timing
for the trip-based train model.

Data Source: http://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip

Usage:
    python scripts/generate-trips.py              # Generate trips.json
    python scripts/generate-trips.py --validate   # Validate output only

Output: src/assets/trips.json
"""

import csv
import io
import json
import math
import os
import sys
import zipfile
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
import urllib.request

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

CONFIG = {
    # GTFS static feed URL
    "gtfs_url": "http://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip",

    # Local cache for GTFS data
    "gtfs_cache": os.path.join(SCRIPT_DIR, "gtfs_subway.zip"),

    # Service type to use (Weekday for rush hour)
    "service_id": "Weekday",

    # Time window: 8:00am - 9:00am
    "start_hour": 8,
    "end_hour": 9,

    # Lines we care about
    "lines_in_scope": [
        "1", "2", "3", "4", "5", "6", "7",
        "A", "C", "E", "B", "D", "F", "M",
        "J", "Z", "L", "N", "Q", "R", "W"
    ],

    # Output path (public/assets is served directly by Vite)
    "output_path": os.path.join(SCRIPT_DIR, "..", "public", "assets", "trips.json"),

    # Line colors from subway_lines.json
    "subway_lines_path": os.path.join(SCRIPT_DIR, "..", "src", "assets", "subway_lines.json"),

    # Depth for train rendering (negative = underground)
    "train_depth": -15,
}

# Viewport bounds (from subway_lines.json analysis)
VIEWPORT = {
    "minX": 158,
    "maxX": 3766,
    "minZ": -5720,
    "maxZ": 351,
}

# Coordinate conversion constants (matching src/utils/coordinates.ts)
ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.017
METERS_PER_DEGREE_LAT = 111320
METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * math.cos(ORIGIN_LAT * math.pi / 180)

# Offset correction to align WGS84 data with NYC 3D Model (State Plane)
# The NYC 3D Model uses State Plane coordinates which don't perfectly align
# with simple WGS84 conversion. These offsets correct for the difference.
# Positive X = shift east, Positive Z = shift south
OFFSET_X = -150  # meters (shift west to align)
OFFSET_Z = 150   # meters (shift south to align)


# =============================================================================
# Coordinate Conversion
# =============================================================================

def to_local_coords(lat: float, lon: float, elevation: float = 0) -> List[float]:
    """
    Convert WGS84 coordinates to local meter-based coordinates.
    Matches src/utils/coordinates.ts toLocalCoords() with offset correction.
    """
    x = (lon - ORIGIN_LNG) * METERS_PER_DEGREE_LNG + OFFSET_X
    z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT + OFFSET_Z
    y = elevation
    return [round(x, 1), round(y, 1), round(z, 1)]


def is_in_viewport(pos: List[float]) -> bool:
    """Check if position is within viewport bounds."""
    x, y, z = pos
    return (VIEWPORT["minX"] <= x <= VIEWPORT["maxX"] and
            VIEWPORT["minZ"] <= z <= VIEWPORT["maxZ"])


# =============================================================================
# GTFS Data Loading
# =============================================================================

def download_gtfs() -> None:
    """Download GTFS data if not cached or stale."""
    if os.path.exists(CONFIG["gtfs_cache"]):
        mtime = os.path.getmtime(CONFIG["gtfs_cache"])
        age_hours = (datetime.now().timestamp() - mtime) / 3600
        if age_hours < 24:
            print(f"  Using cached GTFS data ({age_hours:.1f} hours old)")
            return

    print(f"  Downloading GTFS data from {CONFIG['gtfs_url']}...")
    urllib.request.urlretrieve(CONFIG["gtfs_url"], CONFIG["gtfs_cache"])
    print(f"  Downloaded to {CONFIG['gtfs_cache']}")


def load_gtfs_data() -> Dict[str, Any]:
    """Load all relevant GTFS files from the zip."""
    download_gtfs()

    data = {
        "stops": {},        # stop_id -> {name, lat, lon}
        "trips": {},        # trip_id -> {route_id, direction_id, shape_id}
        "stop_times": {},   # trip_id -> [stop_time records]
        "shapes": {},       # shape_id -> [shape points]
        "routes": {},       # route_id -> {color}
    }

    with zipfile.ZipFile(CONFIG["gtfs_cache"], 'r') as zf:
        # Load stops.txt
        with zf.open("stops.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            for row in reader:
                data["stops"][row["stop_id"]] = {
                    "name": row.get("stop_name", ""),
                    "lat": float(row.get("stop_lat", 0)),
                    "lon": float(row.get("stop_lon", 0)),
                }
        print(f"  Loaded {len(data['stops'])} stops")

        # Load routes.txt for colors
        with zf.open("routes.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            for row in reader:
                color = row.get("route_color", "")
                data["routes"][row["route_id"]] = {
                    "color": f"#{color}" if color and not color.startswith("#") else color,
                }
        print(f"  Loaded {len(data['routes'])} routes")

        # Load trips.txt - filter by service_id
        with zf.open("trips.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            for row in reader:
                if row.get("service_id") == CONFIG["service_id"]:
                    data["trips"][row["trip_id"]] = {
                        "route_id": row.get("route_id", ""),
                        "direction_id": int(row.get("direction_id", 0)),
                        "shape_id": row.get("shape_id", ""),
                    }
        print(f"  Loaded {len(data['trips'])} trips (service={CONFIG['service_id']})")

        # Load stop_times.txt - filter by trips we care about
        trip_ids = set(data["trips"].keys())
        with zf.open("stop_times.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            for row in reader:
                trip_id = row["trip_id"]
                if trip_id in trip_ids:
                    if trip_id not in data["stop_times"]:
                        data["stop_times"][trip_id] = []
                    data["stop_times"][trip_id].append({
                        "stop_id": row["stop_id"],
                        "arrival_time": row.get("arrival_time", ""),
                        "stop_sequence": int(row.get("stop_sequence", 0)),
                    })
        print(f"  Loaded stop times for {len(data['stop_times'])} trips")

        # Load shapes.txt
        with zf.open("shapes.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            for row in reader:
                shape_id = row["shape_id"]
                if shape_id not in data["shapes"]:
                    data["shapes"][shape_id] = []
                data["shapes"][shape_id].append({
                    "lat": float(row.get("shape_pt_lat", 0)),
                    "lon": float(row.get("shape_pt_lon", 0)),
                    "sequence": int(row.get("shape_pt_sequence", 0)),
                })
        print(f"  Loaded {len(data['shapes'])} shapes")

        # Sort shape points by sequence
        for shape_id in data["shapes"]:
            data["shapes"][shape_id].sort(key=lambda x: x["sequence"])

    return data


def load_line_info() -> Tuple[Dict[str, str], Dict[str, float]]:
    """
    Load line colors and depths from subway_lines.json.

    Returns:
        Tuple of (colors dict, depths dict) mapping line_id to color/depth.
    """
    colors = {}
    depths = {}
    try:
        with open(CONFIG["subway_lines_path"], "r") as f:
            data = json.load(f)
        for line in data.get("lines", []):
            line_id = line["id"]
            colors[line_id] = line.get("color", "#808080")
            # Extract depth from first segment's first point Y coordinate
            if line.get("segments") and line["segments"][0].get("points"):
                depths[line_id] = line["segments"][0]["points"][0][1]
            else:
                depths[line_id] = CONFIG["train_depth"]  # fallback
    except Exception as e:
        print(f"  Warning: Could not load line info: {e}")
    return colors, depths


# =============================================================================
# Polyline Utilities
# =============================================================================

def polyline_length(points: List[List[float]]) -> float:
    """Calculate total length of a polyline."""
    if len(points) < 2:
        return 0
    total = 0
    for i in range(len(points) - 1):
        dx = points[i + 1][0] - points[i][0]
        dy = points[i + 1][1] - points[i][1]
        dz = points[i + 1][2] - points[i][2]
        total += math.sqrt(dx * dx + dy * dy + dz * dz)
    return total


def distance_along_polyline(polyline: List[List[float]], target: List[float]) -> float:
    """
    Find the distance along a polyline to the closest point to target.
    Returns distance in meters from start of polyline.
    """
    if len(polyline) < 2:
        return 0

    best_dist = float('inf')
    best_along = 0
    cumulative = 0

    for i in range(len(polyline) - 1):
        p1 = polyline[i]
        p2 = polyline[i + 1]

        # Project target onto line segment p1-p2
        seg_len = math.sqrt(
            (p2[0] - p1[0]) ** 2 +
            (p2[1] - p1[1]) ** 2 +
            (p2[2] - p1[2]) ** 2
        )

        if seg_len < 0.01:
            cumulative += seg_len
            continue

        # t = projection parameter [0, 1]
        t = max(0, min(1, (
            (target[0] - p1[0]) * (p2[0] - p1[0]) +
            (target[1] - p1[1]) * (p2[1] - p1[1]) +
            (target[2] - p1[2]) * (p2[2] - p1[2])
        ) / (seg_len * seg_len)))

        # Closest point on segment
        closest = [
            p1[0] + t * (p2[0] - p1[0]),
            p1[1] + t * (p2[1] - p1[1]),
            p1[2] + t * (p2[2] - p1[2]),
        ]

        # Distance from target to closest point
        dist = math.sqrt(
            (target[0] - closest[0]) ** 2 +
            (target[1] - closest[1]) ** 2 +
            (target[2] - closest[2]) ** 2
        )

        if dist < best_dist:
            best_dist = dist
            best_along = cumulative + t * seg_len

        cumulative += seg_len

    return best_along


def clip_polyline_to_viewport(
    polyline: List[List[float]],
    viewport: Dict[str, float]
) -> Tuple[List[List[float]], float, float]:
    """
    Clip polyline to viewport bounds.
    Returns (clipped_polyline, start_distance, end_distance).
    """
    if len(polyline) < 2:
        return polyline, 0, 0

    # Find first and last points inside viewport
    first_in = -1
    last_in = -1
    cumulative = 0
    distances = [0]

    for i in range(len(polyline)):
        if i > 0:
            dx = polyline[i][0] - polyline[i - 1][0]
            dy = polyline[i][1] - polyline[i - 1][1]
            dz = polyline[i][2] - polyline[i - 1][2]
            cumulative += math.sqrt(dx * dx + dy * dy + dz * dz)
        distances.append(cumulative)

        if is_in_viewport(polyline[i]):
            if first_in < 0:
                first_in = i
            last_in = i

    if first_in < 0:
        # No points in viewport
        return [], 0, 0

    # Extend by one point on each side for smooth entry/exit
    clip_start = max(0, first_in - 1)
    clip_end = min(len(polyline) - 1, last_in + 1)

    clipped = polyline[clip_start:clip_end + 1]
    start_dist = distances[clip_start]
    end_dist = distances[clip_end]

    return clipped, start_dist, end_dist


# =============================================================================
# Time Conversion
# =============================================================================

def time_to_simulation(time_str: str) -> Optional[float]:
    """
    Convert HH:MM:SS to simulation time [0, 1).
    Returns None if outside our window.
    """
    try:
        parts = time_str.split(":")
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2]) if len(parts) > 2 else 0

        # GTFS times can be > 24:00:00 for trips past midnight
        total_seconds = hours * 3600 + minutes * 60 + seconds

        # Our window
        start_seconds = CONFIG["start_hour"] * 3600
        end_seconds = CONFIG["end_hour"] * 3600
        window_seconds = end_seconds - start_seconds

        t = (total_seconds - start_seconds) / window_seconds
        return t
    except:
        return None


def is_time_in_window(time_str: str) -> bool:
    """Check if time falls within our simulation window."""
    t = time_to_simulation(time_str)
    return t is not None and 0 <= t < 1


# =============================================================================
# Trip Processing
# =============================================================================

def process_trips(
    gtfs_data: Dict[str, Any],
    line_colors: Dict[str, str],
    line_depths: Dict[str, float]
) -> List[Dict[str, Any]]:
    """Process GTFS data into trip objects."""
    trips = []
    stats = {
        "total_gtfs_trips": 0,
        "skipped_no_shape": 0,
        "skipped_no_stop_times": 0,
        "skipped_out_of_window": 0,
        "skipped_no_visible_stops": 0,
        "processed": 0,
    }

    for trip_id, trip_info in gtfs_data["trips"].items():
        stats["total_gtfs_trips"] += 1

        route_id = trip_info["route_id"]
        line_id = route_id.upper()

        # Skip lines not in scope
        if line_id not in CONFIG["lines_in_scope"]:
            continue

        # Get shape
        shape_id = trip_info.get("shape_id")
        if not shape_id or shape_id not in gtfs_data["shapes"]:
            stats["skipped_no_shape"] += 1
            continue

        # Get stop times
        if trip_id not in gtfs_data["stop_times"]:
            stats["skipped_no_stop_times"] += 1
            continue

        stop_times = gtfs_data["stop_times"][trip_id]
        stop_times.sort(key=lambda x: x["stop_sequence"])

        # Check if any stops are in our time window
        has_stop_in_window = any(is_time_in_window(st["arrival_time"]) for st in stop_times)
        if not has_stop_in_window:
            stats["skipped_out_of_window"] += 1
            continue

        # Get line-specific depth (use fallback if not found)
        train_depth = line_depths.get(line_id, CONFIG["train_depth"])

        # Convert shape to local coordinates with correct depth
        shape_points = gtfs_data["shapes"][shape_id]
        polyline = [
            to_local_coords(pt["lat"], pt["lon"], train_depth)
            for pt in shape_points
        ]

        # Clip polyline to viewport
        clipped_polyline, clip_start_dist, clip_end_dist = clip_polyline_to_viewport(polyline, VIEWPORT)
        if len(clipped_polyline) < 2:
            stats["skipped_no_visible_stops"] += 1
            continue

        total_length = polyline_length(clipped_polyline)

        # Process stops
        stops = []
        for st in stop_times:
            stop_id = st["stop_id"]
            stop_info = gtfs_data["stops"].get(stop_id)
            if not stop_info:
                continue

            t = time_to_simulation(st["arrival_time"])
            if t is None:
                continue

            # Convert stop position to local coords (using line-specific depth)
            pos = to_local_coords(stop_info["lat"], stop_info["lon"], train_depth)

            # Find distance along original polyline
            dist = distance_along_polyline(polyline, pos)

            # Adjust for clipping
            adjusted_dist = dist - clip_start_dist
            if adjusted_dist < 0:
                adjusted_dist = 0
            if adjusted_dist > total_length:
                adjusted_dist = total_length

            # Only include stops in viewport
            if not is_in_viewport(pos):
                continue

            stops.append({
                "stopId": stop_id,
                "stationName": stop_info["name"],
                "arrivalTime": round(t, 5),
                "position": pos,
                "distanceAlongRoute": round(adjusted_dist, 1),
            })

        if len(stops) < 2:
            stats["skipped_no_visible_stops"] += 1
            continue

        # Sort stops by arrival time
        stops.sort(key=lambda s: s["arrivalTime"])

        # Determine direction from GTFS direction_id
        # 0 = typically outbound, 1 = typically inbound
        # We map this to our direction convention: +1 = northbound, -1 = southbound
        # This is an approximation - actual direction depends on line
        direction = 1 if trip_info["direction_id"] == 0 else -1

        # Get line color
        color = line_colors.get(line_id) or gtfs_data["routes"].get(route_id, {}).get("color") or "#808080"

        trips.append({
            "id": trip_id,
            "lineId": line_id,
            "direction": direction,
            "color": color,
            "stops": stops,
            "polyline": clipped_polyline,
            "totalLength": round(total_length, 1),
            "tEnter": stops[0]["arrivalTime"],
            "tExit": stops[-1]["arrivalTime"],
        })

        stats["processed"] += 1

    # Print stats
    print(f"\n  GTFS trips considered: {stats['total_gtfs_trips']}")
    print(f"  Skipped (no shape): {stats['skipped_no_shape']}")
    print(f"  Skipped (no stop times): {stats['skipped_no_stop_times']}")
    print(f"  Skipped (outside time window): {stats['skipped_out_of_window']}")
    print(f"  Skipped (no visible stops): {stats['skipped_no_visible_stops']}")
    print(f"  Processed: {stats['processed']}")

    return trips


def validate_trips(trips: List[Dict[str, Any]]) -> bool:
    """Validate trip data conforms to expected format."""
    errors = []

    for trip in trips:
        trip_id = trip.get("id", "unknown")

        # Required fields
        for field in ["id", "lineId", "direction", "color", "stops", "polyline", "totalLength", "tEnter", "tExit"]:
            if field not in trip:
                errors.append(f"{trip_id}: missing field '{field}'")

        # Direction must be 1 or -1
        if trip.get("direction") not in [1, -1]:
            errors.append(f"{trip_id}: invalid direction {trip.get('direction')}")

        # tEnter < tExit
        if trip.get("tEnter", 0) >= trip.get("tExit", 0):
            errors.append(f"{trip_id}: tEnter >= tExit")

        # At least 2 stops
        stops = trip.get("stops", [])
        if len(stops) < 2:
            errors.append(f"{trip_id}: less than 2 stops")

        # Stops must have required fields
        for i, stop in enumerate(stops):
            for field in ["stopId", "stationName", "arrivalTime", "position", "distanceAlongRoute"]:
                if field not in stop:
                    errors.append(f"{trip_id}: stop {i} missing field '{field}'")

        # Polyline must have at least 2 points
        if len(trip.get("polyline", [])) < 2:
            errors.append(f"{trip_id}: polyline has less than 2 points")

        # totalLength must be positive
        if trip.get("totalLength", 0) <= 0:
            errors.append(f"{trip_id}: invalid totalLength")

    if errors:
        print("\nValidation errors:")
        for error in errors[:20]:  # Limit output
            print(f"  {error}")
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more errors")
        return False

    print("\n  Validation passed")
    return True


# =============================================================================
# Main
# =============================================================================

def main() -> int:
    validate_only = "--validate" in sys.argv

    print("=" * 60)
    print("TRIP GENERATOR (GTFS → trips.json)")
    print("=" * 60)
    print(f"Time window: {CONFIG['start_hour']}:00 - {CONFIG['end_hour']}:00")
    print(f"Viewport: X=[{VIEWPORT['minX']}, {VIEWPORT['maxX']}], Z=[{VIEWPORT['minZ']}, {VIEWPORT['maxZ']}]")

    # Load line colors and depths
    print("\nLoading line info...")
    line_colors, line_depths = load_line_info()
    print(f"  Loaded colors for {len(line_colors)} lines")
    print(f"  Loaded depths for {len(line_depths)} lines")

    # Load GTFS data
    print("\nLoading GTFS data...")
    gtfs_data = load_gtfs_data()

    # Process trips
    print("\nProcessing trips...")
    trips = process_trips(gtfs_data, line_colors, line_depths)

    print(f"\nTotal trips generated: {len(trips)}")

    # Per-line breakdown
    line_counts = {}
    for trip in trips:
        line_id = trip["lineId"]
        line_counts[line_id] = line_counts.get(line_id, 0) + 1

    print("\nTrips per line:")
    for line_id in sorted(line_counts.keys()):
        print(f"  {line_id}: {line_counts[line_id]}")

    # Validate
    print("\nValidating...")
    if not validate_trips(trips):
        return 1

    if validate_only:
        print("\n--validate mode: not writing output")
        return 0

    # Build output
    output = {
        "meta": {
            "source": "GTFS static",
            "generated": datetime.now().isoformat(),
            "timeWindow": f"{CONFIG['start_hour']:02d}:00-{CONFIG['end_hour']:02d}:00",
            "viewport": VIEWPORT,
        },
        "trips": trips,
    }

    # Write output
    os.makedirs(os.path.dirname(CONFIG["output_path"]), exist_ok=True)
    with open(CONFIG["output_path"], "w") as f:
        json.dump(output, f)  # No indent to reduce file size

    # Get file size
    file_size = os.path.getsize(CONFIG["output_path"])
    print(f"\n✓ Wrote {len(trips)} trips to {CONFIG['output_path']}")
    print(f"  File size: {file_size / 1024 / 1024:.1f} MB")

    return 0


if __name__ == "__main__":
    sys.exit(main())
