#!/usr/bin/env python3
"""
Fetch NYC Road Segments and TLC Pickup Data for Spawn Rates

Data Sources:
- Road network: NYC Open Data (inkn-q76z)
- Yellow taxi: https://data.cityofnewyork.us/resource/4b4i-vvec.json
- Green taxi: https://data.cityofnewyork.us/resource/peyi-gg4n.json
- Taxi zones: TLC taxi zone GeoJSON

Usage:
    python scripts/fetch-road-segments.py

Output: src/assets/road_segments.json
"""

import json
import math
import os
import sys
import random
from typing import List, Tuple, Dict, Any
import urllib.request
import urllib.parse

# =============================================================================
# Configuration
# =============================================================================

CONFIG = {
    # NYC Open Data GeoJSON export URL for roads
    "road_geojson_url": "https://data.cityofnewyork.us/api/geospatial/inkn-q76z?method=export&format=GeoJSON",

    # TLC Trip Data APIs (2024)
    "yellow_taxi_url": "https://data.cityofnewyork.us/resource/4b4i-vvec.json",
    "green_taxi_url": "https://data.cityofnewyork.us/resource/peyi-gg4n.json",

    # Taxi zone centroids (we'll build a simple lookup)
    "taxi_zones_url": "https://data.cityofnewyork.us/api/geospatial/d3c5-ddgc?method=export&format=GeoJSON",

    # Sample date and time (typical weekday, 8-9am)
    # Note: Dataset has 2023 data available; 2023-03-21 is a Tuesday
    "sample_date": "2023-03-21",  # Tuesday
    "start_hour": 8,
    "end_hour": 9,

    # Geographic bounds (Manhattan south of 34th St)
    "max_latitude": 40.755,
    "min_latitude": 40.700,
    "min_longitude": -74.02,
    "max_longitude": -73.97,

    # Manhattan zones in our extent (approximate)
    # These are TLC zone IDs for lower Manhattan
    "manhattan_zones": list(range(4, 265)),  # All Manhattan zones

    # Time model
    "time_slices": 60,

    # Output path
    "output_path": os.path.join(os.path.dirname(__file__), "..", "src", "assets", "road_segments.json"),

    # Cache paths
    "road_cache_path": os.path.join(os.path.dirname(__file__), "road_segments_raw.geojson"),
    "taxi_cache_path": os.path.join(os.path.dirname(__file__), "taxi_pickups_cache.json"),
}

# Manhattan lower zones (south of 34th St) - LocationIDs
LOWER_MANHATTAN_ZONES = [
    4, 12, 13, 45, 87, 88, 90, 100, 107, 113, 114, 125, 128, 137, 140, 141,
    143, 144, 148, 151, 152, 153, 158, 161, 162, 163, 164, 170, 186, 194,
    202, 209, 211, 224, 229, 230, 231, 232, 233, 234, 236, 237, 238, 239,
    243, 244, 246, 249, 261, 262, 263
]

# =============================================================================
# Coordinate Conversion
# =============================================================================

ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.0170
METERS_PER_DEGREE_LAT = 111320
METERS_PER_DEGREE_LNG = 111320 * math.cos(ORIGIN_LAT * math.pi / 180)

def to_local_coords(lat: float, lng: float, elevation: float = 0) -> Tuple[float, float, float]:
    x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG
    z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT
    y = elevation
    return (round(x), round(y), round(z))

def is_in_bounds(lat: float, lng: float) -> bool:
    return (
        CONFIG["min_latitude"] <= lat <= CONFIG["max_latitude"] and
        CONFIG["min_longitude"] <= lng <= CONFIG["max_longitude"]
    )

# =============================================================================
# TLC Data Fetching
# =============================================================================

def fetch_taxi_pickups() -> Dict[int, List[int]]:
    """
    Fetch taxi pickup counts by zone and minute.
    Returns: {zone_id: [count_minute_0, count_minute_1, ..., count_minute_59]}
    """
    # Check cache
    if os.path.exists(CONFIG["taxi_cache_path"]):
        print(f"Using cached taxi data: {CONFIG['taxi_cache_path']}")
        with open(CONFIG["taxi_cache_path"], "r") as f:
            return {int(k): v for k, v in json.load(f).items()}

    zone_pickups: Dict[int, List[int]] = {}

    # Initialize zones
    for zone in LOWER_MANHATTAN_ZONES:
        zone_pickups[zone] = [0] * 60

    # Fetch yellow taxi data
    print("Fetching yellow taxi pickups...")
    yellow_pickups = fetch_taxi_data(
        CONFIG["yellow_taxi_url"],
        "tpep_pickup_datetime",
        "pulocationid"
    )
    for zone, minute, count in yellow_pickups:
        if zone in zone_pickups:
            zone_pickups[zone][minute] += count

    # Fetch green taxi data
    print("Fetching green taxi pickups...")
    green_pickups = fetch_taxi_data(
        CONFIG["green_taxi_url"],
        "lpep_pickup_datetime",
        "pulocationid"
    )
    for zone, minute, count in green_pickups:
        if zone in zone_pickups:
            zone_pickups[zone][minute] += count

    # Cache results
    with open(CONFIG["taxi_cache_path"], "w") as f:
        json.dump(zone_pickups, f)
    print(f"  Cached to: {CONFIG['taxi_cache_path']}")

    return zone_pickups

def fetch_taxi_data(base_url: str, datetime_field: str, location_field: str) -> List[Tuple[int, int, int]]:
    """
    Fetch taxi data and aggregate by zone and minute.
    Returns list of (zone_id, minute, count) tuples.

    Batches requests to handle all zones (Socrata API has query length limits).
    """
    results = []
    date = CONFIG["sample_date"]
    start_hour = CONFIG["start_hour"]
    end_hour = CONFIG["end_hour"]

    # Aggregate by zone and minute across all batches
    zone_minute_counts: Dict[Tuple[int, int], int] = {}

    # Batch zones to avoid query length limits (25 zones per batch)
    BATCH_SIZE = 25
    zone_batches = [
        LOWER_MANHATTAN_ZONES[i:i + BATCH_SIZE]
        for i in range(0, len(LOWER_MANHATTAN_ZONES), BATCH_SIZE)
    ]

    print(f"  Querying {len(LOWER_MANHATTAN_ZONES)} zones in {len(zone_batches)} batches...")

    for batch_idx, zone_batch in enumerate(zone_batches):
        # Build query for this batch of zones
        zones_filter = " OR ".join([f"{location_field}={z}" for z in zone_batch])

        where_clause = (
            f"{datetime_field} >= '{date}T{start_hour:02d}:00:00' AND "
            f"{datetime_field} < '{date}T{end_hour:02d}:00:00' AND "
            f"({zones_filter})"
        )

        params = {
            "$select": f"{location_field}, {datetime_field}, count(*) as cnt",
            "$where": where_clause,
            "$group": f"{location_field}, {datetime_field}",
            "$limit": "50000",
        }

        url = f"{base_url}?{urllib.parse.urlencode(params)}"

        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = json.loads(response.read().decode("utf-8"))

            print(f"    Batch {batch_idx + 1}/{len(zone_batches)}: {len(data)} records")

            for record in data:
                try:
                    zone = int(record.get(location_field, 0))
                    dt_str = record.get(datetime_field, "")
                    count = int(record.get("cnt", 1))

                    if not dt_str or zone == 0:
                        continue

                    # Extract minute from timestamp
                    # Format: "2024-03-19T08:23:00.000"
                    time_part = dt_str.split("T")[1] if "T" in dt_str else dt_str
                    minute = int(time_part.split(":")[1])

                    key = (zone, minute)
                    zone_minute_counts[key] = zone_minute_counts.get(key, 0) + count

                except (ValueError, IndexError):
                    continue

        except Exception as e:
            print(f"    Batch {batch_idx + 1} error: {e}")
            continue

    # Convert aggregated counts to results
    for (zone, minute), count in zone_minute_counts.items():
        results.append((zone, minute, count))

    # Fallback to synthetic data if no results
    if not results:
        print("    No data retrieved, using synthetic fallback")
        for zone in LOWER_MANHATTAN_ZONES:
            for minute in range(60):
                # Rush hour curve
                t = minute / 60
                base = 2 + 3 * math.exp(-((t - 0.5) ** 2) / 0.1)
                results.append((zone, minute, int(base)))

    return results

# =============================================================================
# Road Segment Processing
# =============================================================================

def fetch_road_geojson() -> Dict[str, Any]:
    """Fetch road network GeoJSON."""
    if os.path.exists(CONFIG["road_cache_path"]):
        print(f"Using cached road GeoJSON: {CONFIG['road_cache_path']}")
        with open(CONFIG["road_cache_path"], "r") as f:
            return json.load(f)

    print(f"Fetching road GeoJSON...")
    try:
        with urllib.request.urlopen(CONFIG["road_geojson_url"], timeout=120) as response:
            data = json.loads(response.read().decode("utf-8"))
        with open(CONFIG["road_cache_path"], "w") as f:
            json.dump(data, f)
        print(f"  Cached to: {CONFIG['road_cache_path']}")
        return data
    except Exception as e:
        print(f"  Error: {e}")
        raise

def classify_road_type(properties: Dict[str, Any]) -> str:
    name = ""
    for field in ["street", "st_name", "name", "STREET", "NAME", "featuretyp", "rw_type"]:
        if field in properties and properties[field]:
            name = str(properties[field]).lower()
            break

    if any(hw in name for hw in ["fdr", "west side", "highway", "expressway", "hwy"]):
        return "highway"
    elif any(ave in name for ave in ["avenue", "ave", "broadway", "bowery", "park ave"]):
        return "avenue"
    else:
        return "street"

def process_geometry(geometry: Dict[str, Any]) -> List[List[Tuple[float, float, float]]]:
    segments = []
    geom_type = geometry.get("type", "")
    coords = geometry.get("coordinates", [])

    if geom_type == "LineString":
        segment = []
        for coord in coords:
            lng, lat = coord[0], coord[1]
            if is_in_bounds(lat, lng):
                x, y, z = to_local_coords(lat, lng, 0)
                segment.append([x, y, z])
        if len(segment) >= 2:
            segments.append(segment)

    elif geom_type == "MultiLineString":
        for line_coords in coords:
            segment = []
            for coord in line_coords:
                lng, lat = coord[0], coord[1]
                if is_in_bounds(lat, lng):
                    x, y, z = to_local_coords(lat, lng, 0)
                    segment.append([x, y, z])
            if len(segment) >= 2:
                segments.append(segment)

    return segments

def calculate_segment_length(points: List[List[float]]) -> float:
    total = 0
    for i in range(len(points) - 1):
        p1, p2 = points[i], points[i + 1]
        dx = p2[0] - p1[0]
        dz = p2[2] - p1[2]
        total += math.sqrt(dx*dx + dz*dz)
    return total

def simplify_polyline(points: List[List[float]], tolerance: float = 5.0) -> List[List[float]]:
    if len(points) <= 2:
        return points
    max_dist = 0
    max_idx = 0
    p1, p2 = points[0], points[-1]
    for i in range(1, len(points) - 1):
        p = points[i]
        dist = point_line_distance(p, p1, p2)
        if dist > max_dist:
            max_dist = dist
            max_idx = i
    if max_dist > tolerance:
        left = simplify_polyline(points[:max_idx + 1], tolerance)
        right = simplify_polyline(points[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [points[0], points[-1]]

def point_line_distance(p, p1, p2):
    dx = p2[0] - p1[0]
    dz = p2[2] - p1[2]
    if dx == 0 and dz == 0:
        return math.sqrt((p[0] - p1[0])**2 + (p[2] - p1[2])**2)
    t = max(0, min(1, ((p[0] - p1[0]) * dx + (p[2] - p1[2]) * dz) / (dx*dx + dz*dz)))
    proj_x = p1[0] + t * dx
    proj_z = p1[2] + t * dz
    return math.sqrt((p[0] - proj_x)**2 + (p[2] - proj_z)**2)

def estimate_speeds(road_type: str) -> Tuple[float, float, float]:
    speed_data = {
        "highway": (22, 45, 0.49),
        "avenue": (9, 25, 0.36),
        "street": (6, 20, 0.30),
    }
    base = speed_data.get(road_type, (8, 25, 0.32))
    variation = 0.9 + 0.2 * random.random()
    avg = round(base[0] * variation, 1)
    free_flow = base[1]
    congestion = round(avg / free_flow, 2)
    return (avg, free_flow, congestion)

def compute_spawn_rates(zone_pickups: Dict[int, List[int]], segment_idx: int, road_type: str, length: float) -> List[float]:
    """
    Compute spawn rates for a segment based on TLC pickup data.
    Creates realistic time-varying spawn rates based on actual TLC patterns.
    """
    # Get total pickups per minute across all zones
    total_pickups_by_minute = [0.0] * 60
    for zone, pickups in zone_pickups.items():
        for minute, count in enumerate(pickups):
            total_pickups_by_minute[minute] += count

    # Find max for normalization
    max_pickups = max(total_pickups_by_minute) if total_pickups_by_minute else 1
    if max_pickups == 0:
        max_pickups = 1

    # Road type scaling (busier roads get more traffic)
    type_scale = {"highway": 0.8, "avenue": 0.5, "street": 0.3}
    base_rate = type_scale.get(road_type, 0.3)

    # Length factor - longer segments get proportionally more spawns
    length_factor = min(length / 150, 1.5)  # Cap at 1.5x for very long segments

    rates = []
    for minute_pickups in total_pickups_by_minute:
        # Normalize to [0, 1] based on max pickups
        normalized = minute_pickups / max_pickups
        # Apply base rate and length factor, then scale up
        rate = base_rate * (0.3 + 0.7 * normalized) * length_factor
        # Clamp to [0.1, 1.0]
        rates.append(round(max(0.1, min(1.0, rate)), 2))

    return rates

# =============================================================================
# Main
# =============================================================================

def main():
    try:
        random.seed(42)

        # 1. Fetch TLC pickup data
        print("=" * 60)
        print("Fetching TLC taxi pickup data...")
        print("=" * 60)
        zone_pickups = fetch_taxi_pickups()

        total_pickups = sum(sum(v) for v in zone_pickups.values())
        print(f"Total pickups in data: {total_pickups}")

        # 2. Fetch road network
        print("\n" + "=" * 60)
        print("Fetching road network...")
        print("=" * 60)
        road_geojson = fetch_road_geojson()

        # 3. Process road segments
        print("\n" + "=" * 60)
        print("Processing road segments...")
        print("=" * 60)

        segments_out = []
        segment_id = 0
        features = road_geojson.get("features", [])
        print(f"Processing {len(features)} features...")

        for feature in features:
            properties = feature.get("properties", {})
            geometry = feature.get("geometry", {})

            if not geometry:
                continue

            road_type = classify_road_type(properties)
            polylines = process_geometry(geometry)

            for points in polylines:
                simplified = simplify_polyline(points, tolerance=10.0)
                if len(simplified) < 2:
                    continue

                length = calculate_segment_length(simplified)
                if length < 20:
                    continue

                avg_speed, free_flow, congestion = estimate_speeds(road_type)
                spawn_rates = compute_spawn_rates(zone_pickups, segment_id, road_type, length)

                segment_id += 1
                segments_out.append({
                    "id": f"road_{segment_id:04d}",
                    "type": road_type,
                    "points": simplified,
                    "avgSpeedMph": avg_speed,
                    "freeFlowSpeedMph": free_flow,
                    "congestionFactor": congestion,
                    "spawnRates": spawn_rates,
                })

        # Sort by type
        type_order = {"highway": 0, "avenue": 1, "street": 2}
        segments_out.sort(key=lambda s: (type_order.get(s["type"], 3), s["id"]))

        print(f"\nExtracted {len(segments_out)} road segments:")
        by_type = {}
        for seg in segments_out:
            t = seg["type"]
            by_type[t] = by_type.get(t, 0) + 1
        for t, count in sorted(by_type.items()):
            print(f"  {t}: {count}")

        # 4. Build output
        output = {
            "meta": {
                "timeSlices": CONFIG["time_slices"],
                "vehicleTypes": ["taxi", "fhv"],
            },
            "segments": segments_out,
        }

        # 5. Write output
        os.makedirs(os.path.dirname(CONFIG["output_path"]), exist_ok=True)
        with open(CONFIG["output_path"], "w") as f:
            json.dump(output, f, indent=2)

        print(f"\n✓ Wrote {len(segments_out)} segments to {CONFIG['output_path']}")

    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
