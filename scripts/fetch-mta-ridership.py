#!/usr/bin/env python3
"""
Fetch MTA Subway Hourly Ridership data and process for rush hour visualization.

Data source: https://data.ny.gov/Transportation/MTA-Subway-Hourly-Ridership-Beginning-February-202/wujg-7c2s

This script:
1. Fetches hourly ridership data from MTA Open Data API
2. Filters to Manhattan stations within our modeling extent
3. Aggregates to get typical weekday rush hour patterns
4. Outputs stations.json in the format needed by the app

Usage:
    python scripts/fetch-mta-ridership.py
"""

import json
import math
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Tuple
from pathlib import Path

# =============================================================================
# Configuration
# =============================================================================

# MTA Open Data API (Socrata)
# 2025 dataset: https://data.ny.gov/Transportation/MTA-Subway-Hourly-Ridership-Beginning-2025/5wq4-mkjj
DATASET_ID = "5wq4-mkjj"
BASE_URL = f"https://data.ny.gov/resource/{DATASET_ID}.json"

# Our modeling extent (lower Manhattan, south of ~40th St)
# Battery Park: 40.7033, -74.0170
# 40th St: ~40.755
LAT_MIN = 40.700
LAT_MAX = 40.760
LNG_MIN = -74.020
LNG_MAX = -73.970

# Rush hour definition
# Morning: 7-9 AM, Evening: 5-7 PM
RUSH_HOURS_AM = [7, 8]
RUSH_HOURS_PM = [17, 18]

# Date range for "typical weekday" (fetch recent weekdays)
# We'll fetch a few weeks of data and average
DAYS_TO_FETCH = 30

# Coordinate transformation
ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.0170
METERS_PER_DEGREE_LAT = 111320
METERS_PER_DEGREE_LNG = 111320 * math.cos(ORIGIN_LAT * math.pi / 180)

# Output
OUTPUT_PATH = Path(__file__).parent.parent / "src" / "assets" / "stations_real.json"


# =============================================================================
# Data Fetching
# =============================================================================

def fetch_ridership_data(date_start: str, date_end: str, borough: str = "Manhattan") -> List[dict]:
    """Fetch ridership data from MTA API for a date range."""

    # Build query
    # Filter: subway only, Manhattan, our lat/lng bounds
    where_clause = (
        f"transit_mode='subway' "
        f"AND borough='{borough}' "
        f"AND latitude >= {LAT_MIN} AND latitude <= {LAT_MAX} "
        f"AND longitude >= {LNG_MIN} AND longitude <= {LNG_MAX} "
        f"AND transit_timestamp >= '{date_start}' "
        f"AND transit_timestamp < '{date_end}'"
    )

    params = {
        "$where": where_clause,
        "$limit": 50000,  # Max per request
        "$order": "transit_timestamp ASC"
    }

    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    print(f"Fetching: {url[:100]}...")

    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())

    print(f"  Fetched {len(data)} records")
    return data


def fetch_all_data() -> List[dict]:
    """Fetch data for the past N days."""

    end_date = datetime.now()
    start_date = end_date - timedelta(days=DAYS_TO_FETCH)

    # Format for API
    date_start = start_date.strftime("%Y-%m-%dT00:00:00")
    date_end = end_date.strftime("%Y-%m-%dT23:59:59")

    print(f"Fetching ridership data from {date_start} to {date_end}")
    return fetch_ridership_data(date_start, date_end)


# =============================================================================
# Data Processing
# =============================================================================

def is_weekday(timestamp_str: str) -> bool:
    """Check if timestamp is a weekday."""
    dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00").split(".")[0])
    return dt.weekday() < 5  # Mon=0, Fri=4


def get_hour(timestamp_str: str) -> int:
    """Extract hour from timestamp."""
    dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00").split(".")[0])
    return dt.hour


def is_rush_hour(hour: int) -> bool:
    """Check if hour is during rush hour."""
    return hour in RUSH_HOURS_AM or hour in RUSH_HOURS_PM


def latlon_to_local(lat: float, lng: float) -> Tuple[float, float, float]:
    """Convert lat/lng to local coordinate system (meters from origin)."""
    x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG
    z = -((lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT)  # Negative because north is -Z
    y = -20  # Underground depth for stations
    return (round(x), y, round(z))


def process_ridership(raw_data: List[dict]) -> Dict[str, dict]:
    """
    Process raw ridership data into station summaries.

    Returns dict keyed by station_complex_id with:
    - name, lines, lat, lng
    - hourly_totals: dict of hour -> total ridership
    - weekday_count: number of weekdays in data
    """

    stations = {}

    for record in raw_data:
        station_id = record.get("station_complex_id")
        timestamp = record.get("transit_timestamp", "")
        ridership = float(record.get("ridership", 0))

        if not station_id or not timestamp:
            continue

        # Filter to weekdays only
        if not is_weekday(timestamp):
            continue

        hour = get_hour(timestamp)

        # Initialize station if needed
        if station_id not in stations:
            # Parse lines from station name like "W 4 St-Wash Sq (A,C,E,B,D,F,M)"
            name = record.get("station_complex", "")
            lines = []
            if "(" in name and ")" in name:
                lines_str = name[name.rfind("(")+1:name.rfind(")")]
                lines = [l.strip() for l in lines_str.split(",")]
                name = name[:name.rfind("(")].strip()

            stations[station_id] = {
                "id": station_id,
                "name": name,
                "lines": lines,
                "lat": float(record.get("latitude", 0)),
                "lng": float(record.get("longitude", 0)),
                "hourly_totals": defaultdict(float),
                "hourly_counts": defaultdict(int),
                "dates_seen": set()
            }

        # Aggregate ridership by hour
        stations[station_id]["hourly_totals"][hour] += ridership
        stations[station_id]["hourly_counts"][hour] += 1
        stations[station_id]["dates_seen"].add(timestamp[:10])

    return stations


def compute_rush_hour_intensities(stations: Dict[str, dict]) -> List[dict]:
    """
    Compute normalized rush hour intensities for each station.

    Returns list of station objects ready for JSON output.
    """

    # First pass: compute average hourly ridership per station
    for station in stations.values():
        station["hourly_avg"] = {}
        for hour in range(24):
            count = station["hourly_counts"].get(hour, 0)
            total = station["hourly_totals"].get(hour, 0)
            station["hourly_avg"][hour] = total / count if count > 0 else 0

    # Find global max (for normalization)
    global_max = 0
    for station in stations.values():
        for hour in RUSH_HOURS_AM + RUSH_HOURS_PM:
            global_max = max(global_max, station["hourly_avg"].get(hour, 0))

    print(f"Global max ridership: {global_max:.0f}")

    # Build output
    MIN_INTENSITY_FLOOR = 0.08
    output_stations = []

    for station in stations.values():
        # Compute position
        position = latlon_to_local(station["lat"], station["lng"])
        surface_position = (position[0], 0, position[2])

        # Compute intensities for 60 time slices
        # We'll map rush hour (7-9 AM) to slices 0-59
        # Slice 0 = 7:00, Slice 30 = 8:00 (peak), Slice 59 = 8:59
        intensities = []

        # Get AM rush ridership
        am_7 = station["hourly_avg"].get(7, 0)
        am_8 = station["hourly_avg"].get(8, 0)
        am_9 = station["hourly_avg"].get(9, 0)

        for slice_idx in range(60):
            # Interpolate between hours
            # 0-29: 7:00-7:59 (interpolate 7->8)
            # 30-59: 8:00-8:59 (interpolate 8->9)
            if slice_idx < 30:
                t = slice_idx / 30
                ridership = am_7 * (1 - t) + am_8 * t
            else:
                t = (slice_idx - 30) / 30
                ridership = am_8 * (1 - t) + am_9 * t

            # Normalize
            intensity = ridership / global_max if global_max > 0 else 0
            intensity = max(MIN_INTENSITY_FLOOR, min(1.0, intensity))
            intensities.append(round(intensity, 3))

        output_stations.append({
            "id": station["id"],
            "name": station["name"],
            "lines": station["lines"],
            "position": list(position),
            "surfacePosition": list(surface_position),
            "intensities": intensities,
            "_debug": {
                "lat": station["lat"],
                "lng": station["lng"],
                "am_7_avg": round(am_7, 1),
                "am_8_avg": round(am_8, 1),
                "am_9_avg": round(am_9, 1),
                "days_in_data": len(station["dates_seen"])
            }
        })

    # Sort by peak intensity (descending)
    output_stations.sort(key=lambda s: max(s["intensities"]), reverse=True)

    return output_stations


# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("MTA Ridership Data Fetcher")
    print("=" * 60)
    print()

    # Fetch data
    raw_data = fetch_all_data()

    if not raw_data:
        print("No data fetched. Check API and filters.")
        return

    print()
    print(f"Processing {len(raw_data)} records...")

    # Process
    stations = process_ridership(raw_data)
    print(f"Found {len(stations)} stations in our extent")

    # Compute intensities
    output_stations = compute_rush_hour_intensities(stations)

    # Build output JSON
    output = {
        "meta": {
            "timeSlices": 60,
            "timeRange": [0, 1],
            "normalization": "global",
            "rushHour": "AM (7-9)",
            "dataSource": "MTA Subway Hourly Ridership",
            "fetchDate": datetime.now().isoformat(),
            "daysInSample": DAYS_TO_FETCH,
            "minIntensityFloor": 0.08
        },
        "stations": output_stations
    }

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f, indent=2)

    print()
    print(f"Wrote {len(output_stations)} stations to {OUTPUT_PATH}")
    print()
    print("Top 10 stations by peak intensity:")
    for s in output_stations[:10]:
        peak = max(s["intensities"])
        print(f"  {s['name']}: peak={peak:.3f}, lines={s['lines']}")


if __name__ == "__main__":
    main()
