#!/usr/bin/env python3
"""
Fetch Train Schedules from MTA GTFS Static Data

Uses the official MTA GTFS static feed which has ALL stops for every trip,
not just timepoint stations like the Socrata API.

Data Source: http://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip

Usage:
    python scripts/fetch-train-schedules-gtfs.py              # Use GTFS data
    python scripts/fetch-train-schedules-gtfs.py --synthetic  # Use synthetic data

Output: src/assets/train_schedules.json
"""

import csv
import io
import json
import math
import os
import sys
import zipfile
from datetime import datetime, timedelta
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

    # Time window: 8:00am - 9:00am (as HH:MM:SS)
    "start_time": "08:00:00",
    "end_time": "09:00:00",

    # Lines we care about
    "lines_in_scope": ["1", "2", "3", "4", "5", "6", "A", "C", "E", "J", "Z", "M", "N", "Q", "R", "W", "B", "D", "F", "L", "7"],

    # Output path
    "output_path": os.path.join(SCRIPT_DIR, "..", "src", "assets", "train_schedules.json"),

    # Supporting data
    "subway_lines_path": os.path.join(SCRIPT_DIR, "..", "src", "assets", "subway_lines.json"),
    "stations_path": os.path.join(SCRIPT_DIR, "..", "src", "assets", "stations.json"),
    "stop_mapping_path": os.path.join(SCRIPT_DIR, "stop-id-mapping.json"),
}

# =============================================================================
# GTFS Data Loading
# =============================================================================

def download_gtfs():
    """Download GTFS data if not cached."""
    if os.path.exists(CONFIG["gtfs_cache"]):
        # Check if cache is recent (less than 1 day old)
        mtime = os.path.getmtime(CONFIG["gtfs_cache"])
        age_hours = (datetime.now().timestamp() - mtime) / 3600
        if age_hours < 24:
            print(f"  Using cached GTFS data ({age_hours:.1f} hours old)")
            return

    print(f"  Downloading GTFS data from {CONFIG['gtfs_url']}...")
    urllib.request.urlretrieve(CONFIG["gtfs_url"], CONFIG["gtfs_cache"])
    print(f"  Downloaded to {CONFIG['gtfs_cache']}")


def load_gtfs_data() -> Dict[str, Any]:
    """Load relevant GTFS files from the zip."""
    download_gtfs()

    data = {
        "stops": {},        # stop_id -> stop info
        "trips": {},        # trip_id -> trip info
        "stop_times": [],   # list of stop_time records
        "routes": {},       # route_id -> route info
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

        # Load routes.txt
        with zf.open("routes.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            for row in reader:
                data["routes"][row["route_id"]] = {
                    "short_name": row.get("route_short_name", row["route_id"]),
                    "long_name": row.get("route_long_name", ""),
                    "color": row.get("route_color", ""),
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
                        "headsign": row.get("trip_headsign", ""),
                    }
        print(f"  Loaded {len(data['trips'])} trips (service={CONFIG['service_id']})")

        # Load stop_times.txt - filter by trips we care about
        trip_ids = set(data["trips"].keys())
        with zf.open("stop_times.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            for row in reader:
                if row["trip_id"] in trip_ids:
                    data["stop_times"].append({
                        "trip_id": row["trip_id"],
                        "stop_id": row["stop_id"],
                        "arrival_time": row.get("arrival_time", ""),
                        "departure_time": row.get("departure_time", ""),
                        "stop_sequence": int(row.get("stop_sequence", 0)),
                    })
        print(f"  Loaded {len(data['stop_times'])} stop times")

    return data


# =============================================================================
# Data Processing
# =============================================================================

def time_to_simulation_time(time_str: str) -> float:
    """
    Convert HH:MM:SS to simulation time [0, 1).

    GTFS times can be > 24:00:00 for trips past midnight.
    Our window is 08:00:00 - 09:00:00 (1 hour).
    """
    try:
        parts = time_str.split(":")
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2]) if len(parts) > 2 else 0

        # Total seconds from midnight
        total_seconds = hours * 3600 + minutes * 60 + seconds

        # Our window: 8:00 AM = 28800 seconds, 9:00 AM = 32400 seconds
        start_seconds = 8 * 3600  # 8:00 AM
        end_seconds = 9 * 3600    # 9:00 AM
        window_seconds = end_seconds - start_seconds  # 3600 seconds

        # Map to simulation time (can be outside [0, 1) for clipping later)
        t = (total_seconds - start_seconds) / window_seconds
        return t  # Don't clamp - let calling code clip to window
    except:
        return 0.5


def is_time_in_window(time_str: str) -> bool:
    """Check if time is within our window."""
    try:
        parts = time_str.split(":")
        hours = int(parts[0])
        minutes = int(parts[1])

        # Window: 8:00 - 9:00
        if hours == 8:
            return True
        if hours == 9 and minutes == 0:
            return True
        return False
    except:
        return False


def load_stations() -> Tuple[Dict[str, float], Dict[str, Dict[str, Any]]]:
    """Load stations with segment mapping."""
    with open(CONFIG["stations_path"], "r") as f:
        data = json.load(f)

    # Compute average intensity per line
    line_intensities = {}
    for station in data["stations"]:
        avg_intensity = sum(station["intensities"]) / len(station["intensities"])
        for line in station["lines"]:
            if line not in line_intensities:
                line_intensities[line] = []
            line_intensities[line].append(avg_intensity)

    line_crowding = {
        line: sum(vals) / len(vals)
        for line, vals in line_intensities.items()
    }

    # Build our_station_id -> station info
    our_stations = {}
    for station in data["stations"]:
        our_stations[station["id"]] = {
            "name": station["name"],
            "lines": station["lines"],
            "segmentMapping": station.get("segmentMapping", {}),
        }

    # Load GTFS stop mapping
    gtfs_mapping = {}
    if os.path.exists(CONFIG["stop_mapping_path"]):
        with open(CONFIG["stop_mapping_path"], "r") as f:
            gtfs_data = json.load(f)

        for gtfs_id, info in gtfs_data.get("mapping", {}).items():
            our_ids = info.get("our_station_ids", [])
            if our_ids and our_ids[0] in our_stations:
                gtfs_mapping[gtfs_id] = our_stations[our_ids[0]]
                # Also map base ID (without N/S suffix)
                if gtfs_id.endswith("N") or gtfs_id.endswith("S"):
                    base_id = gtfs_id[:-1]
                    if base_id not in gtfs_mapping:
                        gtfs_mapping[base_id] = our_stations[our_ids[0]]

        print(f"  Loaded {len(gtfs_mapping)} GTFS->station mappings")

    return line_crowding, gtfs_mapping


def load_subway_lines() -> Dict[str, Any]:
    """Load subway lines data."""
    with open(CONFIG["subway_lines_path"], "r") as f:
        return json.load(f)


def process_gtfs_to_runs(
    gtfs_data: Dict[str, Any],
    subway_lines: Dict[str, Any],
    line_crowding: Dict[str, float],
    stop_mapping: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Process GTFS data into train runs."""

    # Build line info
    line_info = {}
    for line in subway_lines.get("lines", []):
        line_id = line["id"]
        segments = line.get("segments", [])

        seg_lengths = []
        for seg in segments:
            points = seg.get("points", [])
            seg_len = 0
            for i in range(len(points) - 1):
                dx = points[i+1][0] - points[i][0]
                dy = points[i+1][1] - points[i][1]
                dz = points[i+1][2] - points[i][2]
                seg_len += math.sqrt(dx*dx + dy*dy + dz*dz)
            seg_lengths.append(max(seg_len, 1))

        line_info[line_id] = {
            "num_segments": len(segments),
            "seg_lengths": seg_lengths,
            "total_length": sum(seg_lengths) if seg_lengths else 1,
        }

    # Group stop_times by trip
    trips_stop_times = {}
    for st in gtfs_data["stop_times"]:
        trip_id = st["trip_id"]
        if trip_id not in trips_stop_times:
            trips_stop_times[trip_id] = []
        trips_stop_times[trip_id].append(st)

    # Sort each trip's stops by sequence
    for trip_id in trips_stop_times:
        trips_stop_times[trip_id].sort(key=lambda x: x["stop_sequence"])

    train_runs = []
    processed_trips = 0
    skipped_no_mapping = 0
    skipped_no_line = 0

    for trip_id, stops in trips_stop_times.items():
        trip_info = gtfs_data["trips"].get(trip_id)
        if not trip_info:
            continue

        route_id = trip_info["route_id"]
        line_id = route_id.upper()

        # Skip lines not in scope
        if line_id not in CONFIG["lines_in_scope"]:
            continue
        if line_id not in line_info:
            skipped_no_line += 1
            continue

        # GTFS direction_id: 0 or 1
        # We need to map this to our segment traversal direction
        # direction_id=0 typically means "outbound" (away from Manhattan)
        # direction_id=1 typically means "inbound" (toward Manhattan)
        # But this varies by line - we'll infer from segment order
        gtfs_direction = trip_info["direction_id"]

        info = line_info[line_id]
        num_segments = info["num_segments"]
        seg_lengths = info["seg_lengths"]
        crowding = line_crowding.get(line_id, 0.5)

        # Map ALL stops first (for trip continuity), filter by time later
        # This ensures trains don't disappear at unmapped stations
        all_mapped_stops = []
        has_stop_in_window = False

        for stop in stops:
            arr_time = stop.get("arrival_time", "") or stop.get("departure_time", "")
            if not arr_time:
                continue

            # Get GTFS stop_id and map to our station
            gtfs_stop_id = stop["stop_id"]
            # Remove direction suffix if present (e.g., "101N" -> "101")
            base_stop_id = gtfs_stop_id[:-1] if gtfs_stop_id[-1] in "NS" else gtfs_stop_id

            station = stop_mapping.get(gtfs_stop_id) or stop_mapping.get(base_stop_id)
            if not station:
                continue

            # Check if this stop is in our time window
            if is_time_in_window(arr_time):
                has_stop_in_window = True

            seg_mapping = station.get("segmentMapping", {}).get(line_id)
            if not seg_mapping:
                continue

            t = time_to_simulation_time(arr_time)
            all_mapped_stops.append({
                "station_name": station["name"],
                "gtfs_id": gtfs_stop_id,
                "segment_index": seg_mapping["segmentIndex"],
                "progress": seg_mapping["progressAlongSegment"],
                "arrival_t": t,
            })

        # Skip trips that don't pass through our area during our time window
        if not has_stop_in_window:
            continue

        if len(all_mapped_stops) < 2:
            skipped_no_mapping += 1
            continue

        # Sort by arrival time
        all_mapped_stops.sort(key=lambda x: x["arrival_t"])

        processed_trips += 1

        # Determine direction from segment indices
        # If segment indices increase, train is going south (direction=-1)
        # If segment indices decrease, train is going north (direction=+1)
        first_seg = all_mapped_stops[0]["segment_index"]
        last_seg = all_mapped_stops[-1]["segment_index"]

        # This determines which way the train is moving through segments
        if last_seg > first_seg:
            # Segments increasing = going south = direction -1
            seg_direction = -1
            train_going_south = True
        else:
            # Segments decreasing = going north = direction +1
            seg_direction = 1
            train_going_south = False

        # Generate segment runs for the FULL trip
        runs = generate_segment_runs(
            all_mapped_stops,
            line_id,
            f"{line_id}-{processed_trips:04d}",
            seg_direction,
            num_segments,
            seg_lengths,
            crowding,
            train_going_south
        )

        # Clip runs to simulation window [0, 1)
        # This preserves trip continuity while only showing runs in our window
        clipped_runs = []
        for run in runs:
            # Skip runs entirely outside window
            if run["tExit"] < 0 or run["tEnter"] >= 1:
                continue
            # Clip to window bounds
            run["tEnter"] = max(0, run["tEnter"])
            run["tExit"] = min(0.99999, run["tExit"])
            # Only keep if there's still duration
            if run["tExit"] > run["tEnter"]:
                clipped_runs.append(run)

        train_runs.extend(clipped_runs)

    print(f"  Processed {processed_trips} trips")
    print(f"  Skipped {skipped_no_mapping} trips (no mapped stations)")
    print(f"  Skipped {skipped_no_line} trips (line not in subway_lines)")

    return train_runs


def generate_segment_runs(
    mapped_stops: List[Dict[str, Any]],
    line_id: str,
    trip_id: str,
    seg_direction: int,
    num_segments: int,
    seg_lengths: List[float],
    crowding: float,
    train_going_south: bool
) -> List[Dict[str, Any]]:
    """Generate segment runs from mapped station arrivals."""
    runs = []

    for i in range(len(mapped_stops) - 1):
        stop_a = mapped_stops[i]
        stop_b = mapped_stops[i + 1]

        seg_a = stop_a["segment_index"]
        seg_b = stop_b["segment_index"]
        t_a = stop_a["arrival_t"]
        t_b = stop_b["arrival_t"]

        if t_b <= t_a:
            continue

        # Determine segments to traverse
        if train_going_south:
            # South: increasing segment indices
            if seg_b < seg_a:
                continue
            segments_to_traverse = list(range(seg_a, seg_b + 1))
        else:
            # North: decreasing segment indices
            if seg_b > seg_a:
                continue
            segments_to_traverse = list(range(seg_a, seg_b - 1, -1)) if seg_a >= seg_b else []

        if not segments_to_traverse:
            continue

        # Calculate total distance
        distance = 0
        for j, seg_idx in enumerate(segments_to_traverse):
            if seg_idx < 0 or seg_idx >= len(seg_lengths):
                continue
            seg_len = seg_lengths[seg_idx]

            if j == 0 and len(segments_to_traverse) == 1:
                distance += seg_len * abs(stop_b["progress"] - stop_a["progress"])
            elif j == 0:
                if train_going_south:
                    distance += seg_len * (1.0 - stop_a["progress"])
                else:
                    distance += seg_len * stop_a["progress"]
            elif j == len(segments_to_traverse) - 1:
                if train_going_south:
                    distance += seg_len * stop_b["progress"]
                else:
                    distance += seg_len * (1.0 - stop_b["progress"])
            else:
                distance += seg_len

        if distance < 1:
            distance = 1

        duration = t_b - t_a
        speed = distance / duration if duration > 0 else 54000

        # Generate runs
        current_t = t_a
        for j, seg_idx in enumerate(segments_to_traverse):
            if seg_idx < 0 or seg_idx >= len(seg_lengths):
                continue

            seg_len = seg_lengths[seg_idx]

            if j == 0 and len(segments_to_traverse) == 1:
                seg_distance = seg_len * abs(stop_b["progress"] - stop_a["progress"])
            elif j == 0:
                if train_going_south:
                    seg_distance = seg_len * (1.0 - stop_a["progress"])
                else:
                    seg_distance = seg_len * stop_a["progress"]
            elif j == len(segments_to_traverse) - 1:
                if train_going_south:
                    seg_distance = seg_len * stop_b["progress"]
                else:
                    seg_distance = seg_len * (1.0 - stop_b["progress"])
            else:
                seg_distance = seg_len

            seg_duration = seg_distance / speed if speed > 0 else 0.001
            seg_t_exit = current_t + seg_duration

            if current_t < 0.9999:
                runs.append({
                    "id": f"{trip_id}-seg{seg_idx}",
                    "lineId": line_id,
                    "segmentIndex": seg_idx,
                    "direction": seg_direction,
                    "tEnter": round(current_t, 5),
                    "tExit": round(min(0.99999, seg_t_exit), 5),
                    "crowding": round(crowding, 2),
                    "tripId": trip_id,
                })

            current_t = seg_t_exit

    return runs


# =============================================================================
# Main
# =============================================================================

def main():
    use_synthetic = "--synthetic" in sys.argv

    print("=" * 60)
    print("GTFS-BASED TRAIN SCHEDULE GENERATOR")
    print("=" * 60)

    # Load supporting data
    print("\nLoading subway lines and stations...")
    subway_lines = load_subway_lines()
    line_crowding, stop_mapping = load_stations()
    print(f"  Loaded {len(subway_lines.get('lines', []))} subway lines")
    print(f"  Computed crowding for {len(line_crowding)} lines")

    if use_synthetic:
        print("\n--synthetic flag: would use synthetic data")
        print("(Not implemented in this script - use fetch-train-schedules.py --synthetic)")
        return 1

    # Load GTFS data
    print("\nLoading GTFS data...")
    gtfs_data = load_gtfs_data()

    # Process into train runs
    print("\nProcessing GTFS into train runs...")
    train_runs = process_gtfs_to_runs(
        gtfs_data, subway_lines, line_crowding, stop_mapping
    )

    print(f"\nTotal train runs: {len(train_runs)}")

    # Count by direction
    dir_pos = sum(1 for r in train_runs if r["direction"] == 1)
    dir_neg = sum(1 for r in train_runs if r["direction"] == -1)
    print(f"  Direction +1 (north): {dir_pos}")
    print(f"  Direction -1 (south): {dir_neg}")

    # Build output
    output = {
        "meta": {
            "interpolationMode": "linear",
            "dataMode": "gtfs-static",
            "service": CONFIG["service_id"],
            "timeWindow": f"{CONFIG['start_time']}-{CONFIG['end_time']}",
        },
        "trains": train_runs,
    }

    # Write output
    os.makedirs(os.path.dirname(CONFIG["output_path"]), exist_ok=True)
    with open(CONFIG["output_path"], "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n✓ Wrote {len(train_runs)} trains to {CONFIG['output_path']}")

    # Print per-line counts
    print("\nTrains per line:")
    line_counts = {}
    for run in train_runs:
        line_id = run["lineId"]
        line_counts[line_id] = line_counts.get(line_id, 0) + 1

    for line_id in sorted(line_counts.keys()):
        print(f"  {line_id}: {line_counts[line_id]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
