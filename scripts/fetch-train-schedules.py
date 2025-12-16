#!/usr/bin/env python3
"""
Fetch MTA Subway Schedule Data and Convert to train_schedules.json

Data Source: MTA Subway Schedules 2025
https://data.ny.gov/Transportation/MTA-Subway-Schedules-2025/q9nv-uegs

Usage:
    python scripts/fetch-train-schedules.py

Output: src/assets/train_schedules.json
"""

import json
import math
import os
import sys
from datetime import datetime, time
from typing import List, Dict, Any, Tuple
import urllib.request
import urllib.parse

# =============================================================================
# Configuration
# =============================================================================

CONFIG = {
    # NY Open Data Socrata API endpoint
    "api_url": "https://data.ny.gov/resource/q9nv-uegs.json",

    # Sample a specific weekday (pick a recent Tuesday)
    "sample_date": "2025-03-18",

    # Time window: 8:00am - 9:00am
    "start_hour": 8,
    "end_hour": 9,

    # Geographic bounds for filtering stops (Manhattan south of 34th St)
    # We'll filter based on line + direction patterns in our extent
    "lines_in_scope": ["1", "2", "3", "4", "5", "6", "A", "C", "E", "J", "Z", "M", "N", "Q", "R", "W", "B", "D", "F", "L"],

    # Output path
    "output_path": os.path.join(os.path.dirname(__file__), "..", "src", "assets", "train_schedules.json"),

    # Subway lines JSON (to match segments)
    "subway_lines_path": os.path.join(os.path.dirname(__file__), "..", "src", "assets", "subway_lines.json"),

    # Stations JSON (to get crowding data)
    "stations_path": os.path.join(os.path.dirname(__file__), "..", "src", "assets", "stations.json"),
}

# =============================================================================
# Data Fetching
# =============================================================================

def fetch_schedule_data(date: str, start_hour: int, end_hour: int) -> List[Dict[str, Any]]:
    """Fetch schedule data for a specific date and time range."""
    all_records = []
    limit = 10000
    offset = 0

    # Format times for query
    start_time = f"{start_hour:02d}:00:00"
    end_time = f"{end_hour:02d}:00:00"

    print(f"Fetching MTA schedule data for {date}, {start_time}-{end_time}...")

    while True:
        # Build query with filters
        where_clause = (
            f"service_date='{date}' AND "
            f"arrival_time >= '{date}T{start_time}' AND "
            f"arrival_time < '{date}T{end_time}'"
        )

        params = {
            "$limit": str(limit),
            "$offset": str(offset),
            "$where": where_clause,
            "$order": "train_id,stop_order",
        }

        url = f"{CONFIG['api_url']}?{urllib.parse.urlencode(params)}"
        print(f"  Fetching offset {offset}...")

        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = json.loads(response.read().decode("utf-8"))

            if not data:
                break

            all_records.extend(data)
            print(f"    Got {len(data)} records (total: {len(all_records)})")

            if len(data) < limit:
                break

            offset += limit

        except Exception as e:
            print(f"  Error: {e}")
            break

    return all_records

# =============================================================================
# Time Conversion
# =============================================================================

def time_to_simulation_time(time_str: str, base_hour: int = 8) -> float:
    """
    Convert time string to simulation time [0, 1).

    Input: ISO timestamp like "2025-03-18T08:23:00.000"
    Output: float in [0, 1) where 0 = 8:00am, 1 = 9:00am
    """
    try:
        # Parse the timestamp
        if "T" in time_str:
            dt = datetime.fromisoformat(time_str.replace("Z", "+00:00").split(".")[0])
            hour = dt.hour
            minute = dt.minute
            second = dt.second
        else:
            # Just time string like "08:23:00"
            parts = time_str.split(":")
            hour = int(parts[0])
            minute = int(parts[1])
            second = int(parts[2]) if len(parts) > 2 else 0

        # Convert to simulation time
        total_seconds = (hour - base_hour) * 3600 + minute * 60 + second
        sim_time = total_seconds / 3600  # Normalize to [0, 1) for one hour

        return max(0, min(0.9999, sim_time))

    except Exception as e:
        print(f"    Warning: Could not parse time '{time_str}': {e}")
        return 0.5

# =============================================================================
# Train Run Generation
# =============================================================================

def load_subway_lines() -> Dict[str, Any]:
    """Load subway lines data to match segments."""
    with open(CONFIG["subway_lines_path"], "r") as f:
        return json.load(f)

def load_stations() -> Dict[str, float]:
    """Load stations and compute average crowding per line."""
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

    # Average per line
    return {
        line: sum(vals) / len(vals)
        for line, vals in line_intensities.items()
    }

def process_train_runs(records: List[Dict[str, Any]], subway_lines: Dict[str, Any], line_crowding: Dict[str, float]) -> List[Dict[str, Any]]:
    """
    Process schedule records into train runs.

    Each TrainRun represents a train traversing one segment of a line.
    """
    # Group records by train_id
    trains = {}
    for record in records:
        train_id = record.get("train_id", "")
        if not train_id:
            continue

        if train_id not in trains:
            trains[train_id] = []
        trains[train_id].append(record)

    print(f"Found {len(trains)} unique trains in time window")

    # Build line segment mapping
    line_segments = {}
    for line in subway_lines.get("lines", []):
        line_id = line["id"]
        line_segments[line_id] = len(line.get("segments", []))

    train_runs = []
    run_id = 0

    for train_id, stops in trains.items():
        if len(stops) < 2:
            continue

        # Sort by stop_order
        stops.sort(key=lambda x: int(x.get("stop_order", 0)))

        # Get line info
        line_id = stops[0].get("line", "").upper()
        if line_id not in CONFIG["lines_in_scope"]:
            continue

        direction_str = stops[0].get("direction", "N")
        direction = 1 if direction_str == "S" else -1  # S = increasing progress

        # Get segment count for this line
        num_segments = line_segments.get(line_id, 1)

        # Get first and last arrival times
        first_time = stops[0].get("arrival_time", "")
        last_time = stops[-1].get("arrival_time", "")

        if not first_time or not last_time:
            continue

        t_enter = time_to_simulation_time(first_time)
        t_exit = time_to_simulation_time(last_time)

        # Ensure t_exit > t_enter
        if t_exit <= t_enter:
            t_exit = min(0.9999, t_enter + 0.1)

        # Get crowding from line average
        crowding = line_crowding.get(line_id, 0.5)

        # Generate one run per segment (simplified: distribute time across segments)
        segment_duration = (t_exit - t_enter) / max(1, num_segments)

        for seg_idx in range(num_segments):
            run_id += 1
            seg_t_enter = t_enter + seg_idx * segment_duration
            seg_t_exit = seg_t_enter + segment_duration

            train_runs.append({
                "id": f"{line_id}-{direction_str}-{run_id:04d}-seg{seg_idx}",
                "lineId": line_id,
                "segmentIndex": seg_idx,
                "direction": direction,
                "tEnter": round(seg_t_enter, 4),
                "tExit": round(min(0.9999, seg_t_exit), 4),
                "crowding": round(crowding, 2),
            })

    return train_runs

# =============================================================================
# Main
# =============================================================================

def main():
    try:
        # 1. Load supporting data
        print("=" * 60)
        print("Loading subway lines and stations...")
        print("=" * 60)
        subway_lines = load_subway_lines()
        line_crowding = load_stations()
        print(f"  Loaded {len(subway_lines.get('lines', []))} subway lines")
        print(f"  Computed crowding for {len(line_crowding)} lines")

        # 2. Fetch schedule data
        print("\n" + "=" * 60)
        print("Fetching MTA schedule data...")
        print("=" * 60)
        records = fetch_schedule_data(
            CONFIG["sample_date"],
            CONFIG["start_hour"],
            CONFIG["end_hour"]
        )
        print(f"Total records fetched: {len(records)}")

        if not records:
            print("No records found. Generating synthetic data...")
            # Fallback: generate synthetic train runs
            train_runs = generate_synthetic_runs(subway_lines, line_crowding)
        else:
            # 3. Process into train runs
            print("\n" + "=" * 60)
            print("Processing train runs...")
            print("=" * 60)
            train_runs = process_train_runs(records, subway_lines, line_crowding)

        print(f"Generated {len(train_runs)} train runs")

        # 4. Build output
        output = {
            "meta": {
                "interpolationMode": "linear",
            },
            "trains": train_runs,
        }

        # 5. Write output
        os.makedirs(os.path.dirname(CONFIG["output_path"]), exist_ok=True)
        with open(CONFIG["output_path"], "w") as f:
            json.dump(output, f, indent=2)

        print(f"\n✓ Wrote {len(train_runs)} trains to {CONFIG['output_path']}")

        # Summary by line
        by_line = {}
        for run in train_runs:
            line = run["lineId"]
            by_line[line] = by_line.get(line, 0) + 1

        print("\nTrains per line:")
        for line, count in sorted(by_line.items()):
            print(f"  {line}: {count}")

    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

def generate_synthetic_runs(subway_lines: Dict[str, Any], line_crowding: Dict[str, float]) -> List[Dict[str, Any]]:
    """
    Generate synthetic train runs based on typical rush hour headways.
    Fallback if API data is unavailable.
    """
    train_runs = []
    run_id = 0

    # Typical headways during rush hour (minutes)
    headways = {
        "1": 3, "2": 4, "3": 4,
        "4": 3, "5": 4, "6": 3,
        "7": 3,
        "A": 4, "C": 6, "E": 4,
        "B": 6, "D": 5, "F": 4, "M": 6,
        "G": 8,
        "J": 5, "Z": 10,
        "L": 3,
        "N": 4, "Q": 5, "R": 5, "W": 6,
        "S": 5,
    }

    for line in subway_lines.get("lines", []):
        line_id = line["id"]
        segments = line.get("segments", [])
        if not segments:
            continue

        headway = headways.get(line_id, 5)
        crowding = line_crowding.get(line_id, 0.5)

        # Generate trains for both directions
        for direction in [1, -1]:
            direction_str = "S" if direction == 1 else "N"

            # Start times throughout the hour
            t = 0.02  # Start slightly after 8:00
            while t < 0.95:
                # Time to traverse all segments (~15-20 min for typical line)
                traverse_time = 0.25 + 0.1 * len(segments) / 10

                for seg_idx in range(len(segments)):
                    run_id += 1
                    seg_duration = traverse_time / len(segments)
                    seg_t_enter = t + seg_idx * seg_duration
                    seg_t_exit = seg_t_enter + seg_duration

                    if seg_t_exit > 0.99:
                        break

                    train_runs.append({
                        "id": f"{line_id}-{direction_str}-{run_id:04d}-seg{seg_idx}",
                        "lineId": line_id,
                        "segmentIndex": seg_idx,
                        "direction": direction,
                        "tEnter": round(seg_t_enter, 4),
                        "tExit": round(min(0.9999, seg_t_exit), 4),
                        "crowding": round(crowding, 2),
                    })

                t += headway / 60  # Convert minutes to simulation time

    return train_runs

if __name__ == "__main__":
    main()
