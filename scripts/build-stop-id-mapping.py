#!/usr/bin/env python3
"""
Build GTFS Stop ID to Station Name Mapping

Downloads MTA GTFS data and extracts stop_id → stop_name mapping.
Then matches with our stations.json to create a complete mapping.

Usage:
    python scripts/build-stop-id-mapping.py

Output: scripts/stop-id-mapping.json
"""

import json
import os
import sys
import urllib.request
import zipfile
import io
import csv
from typing import Dict, Any, List

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GTFS_URL = "http://web.mta.info/developers/data/nyct/subway/google_transit.zip"
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "stop-id-mapping.json")
STATIONS_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "stations.json")

# =============================================================================
# Main
# =============================================================================

def normalize_name(name: str) -> str:
    """Normalize station name for matching."""
    # Remove common suffixes and normalize
    name = name.lower().strip()
    # Remove direction indicators
    for suffix in [" (northbound)", " (southbound)", " - northbound", " - southbound"]:
        name = name.replace(suffix, "")
    # Normalize common variations
    name = name.replace("street", "st")
    name = name.replace("avenue", "av")
    name = name.replace("square", "sq")
    name = name.replace("-", " ")
    name = name.replace("  ", " ")
    return name.strip()


def main():
    print("=" * 60)
    print("GTFS STOP ID MAPPING BUILDER")
    print("=" * 60)

    # 1. Download GTFS zip
    print(f"\nDownloading GTFS data from {GTFS_URL}...")
    try:
        with urllib.request.urlopen(GTFS_URL, timeout=60) as response:
            gtfs_zip = response.read()
        print(f"  Downloaded {len(gtfs_zip) / 1024 / 1024:.1f} MB")
    except Exception as e:
        print(f"Error downloading GTFS: {e}")
        sys.exit(1)

    # 2. Extract stops.txt
    print("\nExtracting stops.txt...")
    stops_data = []
    with zipfile.ZipFile(io.BytesIO(gtfs_zip)) as zf:
        with zf.open("stops.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
            for row in reader:
                stops_data.append(row)
    print(f"  Found {len(stops_data)} stops")

    # 3. Build gtfs_stop_id → info mapping
    gtfs_stops = {}
    for stop in stops_data:
        stop_id = stop.get("stop_id", "")
        stop_name = stop.get("stop_name", "")
        stop_lat = stop.get("stop_lat", "")
        stop_lon = stop.get("stop_lon", "")

        # Skip parent stations (we want the actual stops)
        # Parent stations have location_type=1
        if stop.get("location_type") == "1":
            continue

        # Remove direction suffix (N/S) for matching
        base_id = stop_id.rstrip("NS")

        gtfs_stops[stop_id] = {
            "stop_id": stop_id,
            "base_id": base_id,
            "name": stop_name,
            "lat": float(stop_lat) if stop_lat else None,
            "lon": float(stop_lon) if stop_lon else None,
        }

    print(f"  Processed {len(gtfs_stops)} stop entries")

    # 4. Load our stations
    print(f"\nLoading our stations from {STATIONS_PATH}...")
    with open(STATIONS_PATH) as f:
        stations_data = json.load(f)

    our_stations = {}
    for station in stations_data["stations"]:
        station_id = station["id"]
        station_name = station["name"]
        our_stations[station_id] = {
            "id": station_id,
            "name": station_name,
            "normalized": normalize_name(station_name),
            "lines": station["lines"],
        }
    print(f"  Loaded {len(our_stations)} stations")

    # 5. Match GTFS stops to our stations
    print("\nMatching GTFS stops to our stations...")

    # Build name → our_station_id lookup
    name_to_station = {}
    for sid, info in our_stations.items():
        norm = info["normalized"]
        if norm not in name_to_station:
            name_to_station[norm] = []
        name_to_station[norm].append(sid)

    # Also build by original name
    for sid, info in our_stations.items():
        name_to_station[info["name"].lower()] = [sid]

    # Match each GTFS stop
    mapping = {}
    matched = 0
    unmatched = []

    for gtfs_id, gtfs_info in gtfs_stops.items():
        gtfs_name = gtfs_info["name"]
        norm_name = normalize_name(gtfs_name)

        # Try exact normalized match
        if norm_name in name_to_station:
            mapping[gtfs_id] = {
                "gtfs_id": gtfs_id,
                "gtfs_name": gtfs_name,
                "our_station_ids": name_to_station[norm_name],
            }
            matched += 1
        else:
            # Try partial match
            found = False
            for our_norm, sids in name_to_station.items():
                if our_norm in norm_name or norm_name in our_norm:
                    mapping[gtfs_id] = {
                        "gtfs_id": gtfs_id,
                        "gtfs_name": gtfs_name,
                        "our_station_ids": sids,
                        "match_type": "partial",
                    }
                    matched += 1
                    found = True
                    break

            if not found:
                unmatched.append((gtfs_id, gtfs_name))

    print(f"  Matched: {matched}")
    print(f"  Unmatched: {len(unmatched)}")

    if unmatched and len(unmatched) < 20:
        print("\n  Unmatched samples:")
        for gid, gname in unmatched[:10]:
            print(f"    {gid}: {gname}")

    # 6. Write output
    print(f"\nWriting mapping to {OUTPUT_PATH}...")
    output = {
        "meta": {
            "source": GTFS_URL,
            "total_gtfs_stops": len(gtfs_stops),
            "matched": matched,
            "unmatched": len(unmatched),
        },
        "mapping": mapping,
        "gtfs_stops": gtfs_stops,  # Include full GTFS data for reference
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"✓ Done!")

    return 0


if __name__ == "__main__":
    sys.exit(main())
