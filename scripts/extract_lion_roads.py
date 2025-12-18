#!/usr/bin/env python3
"""
Extract road network from NYC LION geodatabase.

Transforms LION street centerline data into road_segments.json format
with proper graph topology (NodeIDFrom/NodeIDTo).

Usage:
    python scripts/extract_lion_roads.py

Output:
    public/assets/road_segments_lion.json
"""

import json
import subprocess
import math
from pathlib import Path
from typing import List, Dict, Tuple

# Import shared coordinate transformation (uses pyproj for accuracy)
from coordinates import wgs84_to_local, is_in_viewport

# =============================================================================
# Constants
# =============================================================================

# Input/Output paths
LION_GDB = Path(__file__).parent.parent / 'data' / 'lion' / 'lion' / 'lion.gdb'
OUTPUT_PATH = Path(__file__).parent.parent / 'public' / 'assets' / 'road_segments_lion.json'

# Viewport bounds (WGS84) - for filtering raw data before transformation
BOUNDS = {
    'west': -74.025,
    'east': -73.965,
    'south': 40.698,
    'north': 40.758,
}

# Traffic direction codes
# T = Two-way, W = With (From->To), A = Against (To->From), P = Pedestrian
VEHICULAR_TRAF_DIRS = {'T', 'W', 'A', ''}

# Road type classification based on RW_TYPE or street name
MAJOR_STREET_PATTERNS = [
    'AVENUE', 'AVE', 'BROADWAY', 'BOWERY', 'PARK AVE', 'LEXINGTON',
    'MADISON', 'FDR', 'WEST SIDE', 'EAST SIDE', 'HIGHWAY', 'BRIDGE',
    'TUNNEL', 'EXPRESSWAY', 'PARKWAY'
]

# Lane estimation based on road type and major classification
# This provides visual lane width for traffic rendering on roadbed
LANE_ESTIMATES = {
    ('highway', True): 4,   # FDR, expressways - 4 lanes
    ('highway', False): 3,  # Minor highways - 3 lanes
    ('avenue', True): 3,    # Broadway, major avenues - 3 lanes
    ('avenue', False): 2,   # Minor avenues - 2 lanes
    ('street', True): 2,    # Major cross-streets - 2 lanes
    ('street', False): 1,   # Local streets - 1 lane per direction
}


# =============================================================================
# Utility Functions
# =============================================================================

def compute_heading(from_pt: List[float], to_pt: List[float]) -> float:
    """
    Compute heading in degrees [0, 360).
    0° = North, 90° = East, 180° = South, 270° = West.
    Note: -dz because Z negative is north in our coordinate system.
    """
    dx = to_pt[0] - from_pt[0]
    dz = to_pt[2] - from_pt[2]
    heading = math.atan2(dx, -dz) * 180 / math.pi
    return round((heading + 360) % 360, 2)


# =============================================================================
# LION Data Extraction
# =============================================================================

def extract_lion_geojson() -> dict:
    """Extract LION data as GeoJSON using ogr2ogr."""
    print("Extracting LION data...")

    # Extract Manhattan data, filter spatially in Python
    cmd = [
        'ogr2ogr',
        '-f', 'GeoJSON',
        '/vsistdout/',
        str(LION_GDB),
        'lion',
        # Reproject from EPSG:2263 to WGS84
        '-t_srs', 'EPSG:4326',
        # Filter to Manhattan vehicular streets only
        '-where', "LBoro = 1 AND TrafDir IN ('T', 'W', 'A') AND FeatureTyp = '0'",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        raise RuntimeError("ogr2ogr failed")

    geojson = json.loads(result.stdout)

    # Filter to viewport bounds in Python
    filtered_features = []
    for feature in geojson['features']:
        geom = feature['geometry']
        if geom['type'] != 'MultiLineString':
            continue

        # Check if any point is within bounds
        in_bounds = False
        for linestring in geom['coordinates']:
            for coord in linestring:
                lng, lat = coord[0], coord[1]
                if (BOUNDS['west'] <= lng <= BOUNDS['east'] and
                    BOUNDS['south'] <= lat <= BOUNDS['north']):
                    in_bounds = True
                    break
            if in_bounds:
                break

        if in_bounds:
            filtered_features.append(feature)

    print(f"  Filtered {len(geojson['features'])} -> {len(filtered_features)} features in viewport")
    geojson['features'] = filtered_features

    return geojson


def classify_road_type(street_name: str) -> str:
    """Classify road as avenue, street, or highway."""
    name_upper = street_name.upper()

    for pattern in MAJOR_STREET_PATTERNS:
        if pattern in name_upper:
            if 'HIGHWAY' in name_upper or 'FDR' in name_upper or 'EXPRESSWAY' in name_upper:
                return 'highway'
            return 'avenue'

    return 'street'


def estimate_lanes(road_type: str, is_major: bool) -> int:
    """
    Estimate number of lanes based on road classification.

    Uses LANE_ESTIMATES lookup table. Returns lanes per direction,
    matching the CorridorFlowEngine lane offset calculation.
    """
    return LANE_ESTIMATES.get((road_type, is_major), 1)


def process_features(geojson: dict) -> Tuple[List[dict], Dict[str, dict]]:
    """
    Process GeoJSON features into road segments and nodes.

    Returns: (segments, nodes_dict)
    """
    print(f"Processing {len(geojson['features'])} features...")

    # Use dict to deduplicate by segment ID
    segments_dict: Dict[str, dict] = {}
    nodes: Dict[str, dict] = {}

    for feature in geojson['features']:
        props = feature['properties']
        geom = feature['geometry']

        if geom['type'] != 'MultiLineString':
            continue

        # Get node IDs
        node_from = props.get('NodeIDFrom', '').strip()
        node_to = props.get('NodeIDTo', '').strip()
        traf_dir = props.get('TrafDir', '').strip()
        segment_id = props.get('SegmentID', '').strip()
        street_name = props.get('Street', '').strip()

        if not node_from or not node_to or not segment_id:
            continue

        # Skip if we already processed this segment
        seg_id = f"lion_{segment_id}"
        if seg_id in segments_dict:
            continue

        # Convert geometry to local coordinates
        # MultiLineString has array of line strings
        all_points = []
        for linestring in geom['coordinates']:
            for coord in linestring:
                lng, lat = coord[0], coord[1]
                x, y, z = wgs84_to_local(lat, lng)  # Note: lat, lon order
                all_points.append([x, 0, z])  # Y=0 for ground level (ignore elevation)

        if len(all_points) < 2:
            continue

        # Compute segment length
        length_meters = 0
        for i in range(1, len(all_points)):
            dx = all_points[i][0] - all_points[i-1][0]
            dz = all_points[i][2] - all_points[i-1][2]
            length_meters += math.sqrt(dx*dx + dz*dz)

        # Classify road type
        road_type = classify_road_type(street_name)

        # Determine directionality
        # W = one-way From->To, A = one-way To->From, T = two-way
        is_reversed = traf_dir == 'A'

        # Compute speed ratio
        avg_speed = 12.0  # Default ~12 mph for Manhattan
        free_flow = 25.0
        speed_ratio = round(avg_speed / free_flow, 3)

        # Compute headings
        points_ordered = all_points if not is_reversed else list(reversed(all_points))
        start_heading = compute_heading(points_ordered[0], points_ordered[1])
        end_heading = compute_heading(points_ordered[-2], points_ordered[-1])

        # Create base segment
        segment = {
            'id': seg_id,
            'type': road_type,
            'points': points_ordered,
            'nodeIdFrom': node_from if not is_reversed else node_to,
            'nodeIdTo': node_to if not is_reversed else node_from,
            'streetName': street_name,
            'trafDir': traf_dir,
            'lengthMeters': round(length_meters, 2),
            # Placeholder values for speed/spawn (will be filled from TLC data or defaults)
            'avgSpeedMph': avg_speed,
            'freeFlowSpeedMph': free_flow,
            'speedRatio': speed_ratio,
            'startHeadingDeg': start_heading,
            'endHeadingDeg': end_heading,
            'spawnRates': [0.1] * 60,  # Placeholder
        }

        segments_dict[seg_id] = segment

        # For two-way streets, create reverse segment
        if traf_dir == 'T':
            rev_id = f"{seg_id}_rev"
            rev_points = list(reversed(all_points))
            rev_start_heading = compute_heading(rev_points[0], rev_points[1])
            rev_end_heading = compute_heading(rev_points[-2], rev_points[-1])

            rev_segment = {
                'id': rev_id,
                'type': road_type,
                'points': rev_points,
                'nodeIdFrom': node_to,
                'nodeIdTo': node_from,
                'streetName': street_name,
                'trafDir': 'T',
                'lengthMeters': round(length_meters, 2),
                'avgSpeedMph': avg_speed,
                'freeFlowSpeedMph': free_flow,
                'speedRatio': speed_ratio,
                'startHeadingDeg': rev_start_heading,
                'endHeadingDeg': rev_end_heading,
                'spawnRates': [0.1] * 60,
            }
            segments_dict[rev_id] = rev_segment

        # Track nodes
        for node_id in [node_from, node_to]:
            if node_id not in nodes:
                nodes[node_id] = {
                    'id': node_id,
                    'outgoing': [],
                    'incoming': [],
                }

    segments = list(segments_dict.values())
    print(f"  Created {len(segments)} segments from {len(geojson['features'])} features (deduplicated)")
    print(f"  {len(nodes)} unique nodes")

    return segments, nodes


def build_adjacency(segments: List[dict], nodes: Dict[str, dict]) -> None:
    """Build successor/predecessor relationships based on shared nodes."""
    print("Building adjacency...")

    # Index segments by their from/to nodes
    from_node_idx: Dict[str, List[str]] = {}  # node_id -> list of segment_ids starting here
    to_node_idx: Dict[str, List[str]] = {}    # node_id -> list of segment_ids ending here
    seg_map: Dict[str, dict] = {}

    for seg in segments:
        seg_id = seg['id']
        seg_map[seg_id] = seg

        from_node = seg['nodeIdFrom']
        to_node = seg['nodeIdTo']

        if from_node not in from_node_idx:
            from_node_idx[from_node] = []
        from_node_idx[from_node].append(seg_id)

        if to_node not in to_node_idx:
            to_node_idx[to_node] = []
        to_node_idx[to_node].append(seg_id)

    # Build successors: segments that start where this segment ends
    total_successors = 0
    for seg in segments:
        seg['successors'] = []
        seg['predecessors'] = []

        end_node = seg['nodeIdTo']

        # Successors are segments that START at our END node
        for succ_id in from_node_idx.get(end_node, []):
            if succ_id != seg['id']:  # No self-loops
                seg['successors'].append(succ_id)
                total_successors += 1

    # Build predecessors as inverse
    for seg in segments:
        for succ_id in seg['successors']:
            seg_map[succ_id]['predecessors'].append(seg['id'])

    avg_successors = total_successors / len(segments) if segments else 0
    print(f"  {total_successors} successor links ({avg_successors:.2f} avg)")


def compute_node_positions(segments: List[dict], nodes: Dict[str, dict]) -> None:
    """Compute node positions from segment endpoints."""
    print("Computing node positions...")

    # Collect positions from segment endpoints
    node_positions: Dict[str, List[Tuple[float, float]]] = {}

    for seg in segments:
        from_node = seg['nodeIdFrom']
        to_node = seg['nodeIdTo']
        points = seg['points']

        if from_node not in node_positions:
            node_positions[from_node] = []
        node_positions[from_node].append((points[0][0], points[0][2]))

        if to_node not in node_positions:
            node_positions[to_node] = []
        node_positions[to_node].append((points[-1][0], points[-1][2]))

    # Average positions for each node
    for node_id, positions in node_positions.items():
        if node_id in nodes:
            avg_x = sum(p[0] for p in positions) / len(positions)
            avg_z = sum(p[1] for p in positions) / len(positions)
            nodes[node_id]['position'] = [round(avg_x, 2), round(avg_z, 2)]


def main():
    print("=" * 60)
    print("LION ROAD EXTRACTION")
    print("=" * 60)

    # Check input exists
    if not LION_GDB.exists():
        print(f"Error: LION geodatabase not found at {LION_GDB}")
        print("Please extract nyclion.zip to the project root")
        return 1

    # Extract and convert
    geojson = extract_lion_geojson()
    segments, nodes = process_features(geojson)

    # Build graph
    build_adjacency(segments, nodes)
    compute_node_positions(segments, nodes)

    # Classify entry/major and estimate lanes
    for seg in segments:
        # Entry points: no predecessors
        seg['isEntry'] = len(seg['predecessors']) == 0
        # Major: avenues and highways
        seg['isMajor'] = seg['type'] in ('avenue', 'highway')
        # Estimate lanes based on type and major classification
        seg['lanes'] = estimate_lanes(seg['type'], seg['isMajor'])

    entry_count = sum(1 for s in segments if s['isEntry'])
    major_count = sum(1 for s in segments if s['isMajor'])

    # Lane statistics
    lane_counts = {}
    for seg in segments:
        lanes = seg['lanes']
        lane_counts[lanes] = lane_counts.get(lanes, 0) + 1

    # Build output
    output = {
        'meta': {
            'source': 'NYC LION',
            'timeSlices': 60,
            'vehicleTypes': ['taxi', 'fhv'],
            'segmentCount': len(segments),
            'nodeCount': len(nodes),
        },
        'segments': segments,
    }

    # Also save nodes
    nodes_output = {
        'meta': {
            'nodeCount': len(nodes),
        },
        'nodes': list(nodes.values()),
    }

    # Write outputs
    print(f"\nWriting {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f)

    nodes_path = OUTPUT_PATH.parent / 'road_nodes_lion.json'
    print(f"Writing {nodes_path}...")
    with open(nodes_path, 'w') as f:
        json.dump(nodes_output, f)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Segments:      {len(segments)}")
    print(f"Nodes:         {len(nodes)}")
    print(f"Entry points:  {entry_count}")
    print(f"Major roads:   {major_count}")
    print(f"Lane distribution: {lane_counts}")

    # Validation
    total_succ = sum(len(s['successors']) for s in segments)
    avg_succ = total_succ / len(segments) if segments else 0
    print(f"Avg successors: {avg_succ:.2f}")

    orphans = sum(1 for s in segments if not s['successors'] and not s['predecessors'])
    print(f"Orphan segments: {orphans}")

    print("=" * 60)
    print("Done!")

    return 0


if __name__ == '__main__':
    exit(main())
