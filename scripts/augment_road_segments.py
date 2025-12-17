#!/usr/bin/env python3
"""
Road Segment Augmentation Script

Transforms road_segments.json into road_segments_graph.json and road_nodes.json
by adding graph connectivity for the pseudo-trip traffic model.

Implements:
- Node snapping via endpoint clustering (§2.1)
- Adjacency building with angle check (§2.2)
- speedRatio normalization (§2.3)
- lengthMeters computation (§2.4)
- isMajor classification (§2.5)
- isEntry classification (§2.6)
- predecessors as inverse of successors

See docs/PSEUDO_TRIP_TRAFFIC_PLAN.md for algorithm details.

Usage:
    python scripts/augment_road_segments.py
"""

import json
import math
import hashlib
from pathlib import Path
from typing import TypedDict, List, Tuple, Dict, Set
from collections import defaultdict

# =============================================================================
# Constants
# =============================================================================

# Node snapping
SNAP_RADIUS = 10  # meters

# Adjacency building
ANGLE_THRESHOLD = 60  # degrees

# Classification thresholds
SPAWN_RATE_THRESHOLD = 0.30
SPEED_RATIO_THRESHOLD = 0.50
LENGTH_THRESHOLD = 150  # meters

# Boundary detection buffer (from edge of actual data extent)
BOUNDARY_BUFFER = 50  # meters from edge

# Will be computed from data
DATA_BOUNDS = {
    'xMin': None,
    'xMax': None,
    'zMin': None,
    'zMax': None,
}

# File paths
INPUT_PATH = Path(__file__).parent.parent / 'public' / 'assets' / 'road_segments.json'
OUTPUT_GRAPH_PATH = Path(__file__).parent.parent / 'public' / 'assets' / 'road_segments_graph.json'
OUTPUT_NODES_PATH = Path(__file__).parent.parent / 'public' / 'assets' / 'road_nodes.json'


# =============================================================================
# Type Definitions
# =============================================================================

Point3D = Tuple[float, float, float]


class Endpoint(TypedDict):
    x: float
    z: float
    segment_id: str
    is_start: bool


class RoadNode(TypedDict):
    id: str
    position: Tuple[float, float]  # [x, z]
    outgoing: List[str]
    incoming: List[str]
    isBoundary: bool


# =============================================================================
# Union-Find for Clustering
# =============================================================================

class UnionFind:
    def __init__(self):
        self.parent: Dict[str, str] = {}
        self.rank: Dict[str, int] = {}

    def make_set(self, x: str):
        if x not in self.parent:
            self.parent[x] = x
            self.rank[x] = 0

    def find(self, x: str) -> str:
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])  # Path compression
        return self.parent[x]

    def union(self, x: str, y: str):
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return
        # Union by rank
        if self.rank[rx] < self.rank[ry]:
            rx, ry = ry, rx
        self.parent[ry] = rx
        if self.rank[rx] == self.rank[ry]:
            self.rank[rx] += 1


# =============================================================================
# Helper Functions
# =============================================================================

def distance(p1: Endpoint, p2: Endpoint) -> float:
    """Euclidean distance between two endpoints."""
    dx = p1['x'] - p2['x']
    dz = p1['z'] - p2['z']
    return math.sqrt(dx * dx + dz * dz)


def compute_heading(from_pt: Point3D, to_pt: Point3D) -> float:
    """
    Compute heading in degrees [0, 360).
    0° = North, 90° = East, 180° = South, 270° = West.
    Note: -dz because Z negative is north in our coordinate system.
    """
    dx = to_pt[0] - from_pt[0]
    dz = to_pt[2] - from_pt[2]
    heading = math.atan2(dx, -dz) * 180 / math.pi
    return (heading + 360) % 360


def angle_difference(h1: float, h2: float) -> float:
    """Compute minimum angle difference between two headings."""
    diff = abs(h1 - h2)
    return min(diff, 360 - diff)


def compute_length(points: List[Point3D]) -> float:
    """Compute polyline length in meters."""
    total = 0.0
    for i in range(1, len(points)):
        dx = points[i][0] - points[i-1][0]
        dz = points[i][2] - points[i-1][2]
        total += math.sqrt(dx * dx + dz * dz)
    return total


def compute_data_bounds(segments: List[dict]) -> None:
    """Compute actual bounds from segment data."""
    xs = []
    zs = []
    for seg in segments:
        for pt in seg['points']:
            xs.append(pt[0])
            zs.append(pt[2])

    DATA_BOUNDS['xMin'] = min(xs)
    DATA_BOUNDS['xMax'] = max(xs)
    DATA_BOUNDS['zMin'] = min(zs)
    DATA_BOUNDS['zMax'] = max(zs)

    print(f"  Data bounds: X [{DATA_BOUNDS['xMin']:.0f}, {DATA_BOUNDS['xMax']:.0f}], Z [{DATA_BOUNDS['zMin']:.0f}, {DATA_BOUNDS['zMax']:.0f}]")


def is_near_boundary(x: float, z: float) -> bool:
    """Check if point is near data boundary."""
    return (
        x < DATA_BOUNDS['xMin'] + BOUNDARY_BUFFER or
        x > DATA_BOUNDS['xMax'] - BOUNDARY_BUFFER or
        z < DATA_BOUNDS['zMin'] + BOUNDARY_BUFFER or
        z > DATA_BOUNDS['zMax'] - BOUNDARY_BUFFER
    )


def compute_graph_version(segments: List[dict]) -> str:
    """Compute hash of segment structure for cache invalidation."""
    # Hash based on segment IDs and their point counts
    data = '|'.join(f"{s['id']}:{len(s['points'])}" for s in sorted(segments, key=lambda x: x['id']))
    return hashlib.md5(data.encode()).hexdigest()[:12]


# =============================================================================
# Core Algorithm
# =============================================================================

def build_node_set(segments: List[dict]) -> Tuple[Dict[str, RoadNode], Dict[str, str], Dict[str, str]]:
    """
    Build nodes by clustering segment endpoints.
    Returns: (nodes dict, start_node_map, end_node_map)
    """
    print("Building node set...")

    # Collect all endpoints
    endpoints: List[Endpoint] = []
    for seg in segments:
        pts = seg['points']
        endpoints.append({
            'x': pts[0][0],
            'z': pts[0][2],
            'segment_id': seg['id'],
            'is_start': True
        })
        endpoints.append({
            'x': pts[-1][0],
            'z': pts[-1][2],
            'segment_id': seg['id'],
            'is_start': False
        })

    print(f"  Collected {len(endpoints)} endpoints from {len(segments)} segments")

    # Cluster endpoints using union-find
    uf = UnionFind()
    endpoint_ids = []
    for i, ep in enumerate(endpoints):
        ep_id = f"{i}"
        endpoint_ids.append(ep_id)
        uf.make_set(ep_id)

    # Merge points within radius (O(n²) but acceptable for ~10K points)
    merge_count = 0
    for i in range(len(endpoints)):
        for j in range(i + 1, len(endpoints)):
            if distance(endpoints[i], endpoints[j]) < SNAP_RADIUS:
                uf.union(endpoint_ids[i], endpoint_ids[j])
                merge_count += 1

    print(f"  Merged {merge_count} endpoint pairs")

    # Group by cluster root
    clusters: Dict[str, List[int]] = defaultdict(list)
    for i, ep_id in enumerate(endpoint_ids):
        root = uf.find(ep_id)
        clusters[root].append(i)

    print(f"  Created {len(clusters)} nodes from {len(endpoints)} endpoints")

    # Build node objects
    nodes: Dict[str, RoadNode] = {}
    start_node_map: Dict[str, str] = {}  # segment_id -> node_id
    end_node_map: Dict[str, str] = {}    # segment_id -> node_id

    for node_idx, (_, indices) in enumerate(clusters.items()):
        # Compute centroid
        cx = sum(endpoints[i]['x'] for i in indices) / len(indices)
        cz = sum(endpoints[i]['z'] for i in indices) / len(indices)

        node_id = f"node_{node_idx:04d}"

        node: RoadNode = {
            'id': node_id,
            'position': (round(cx, 2), round(cz, 2)),
            'outgoing': [],
            'incoming': [],
            'isBoundary': is_near_boundary(cx, cz)
        }

        # Assign node to segment endpoints
        for i in indices:
            ep = endpoints[i]
            if ep['is_start']:
                start_node_map[ep['segment_id']] = node_id
                node['outgoing'].append(ep['segment_id'])
            else:
                end_node_map[ep['segment_id']] = node_id
                node['incoming'].append(ep['segment_id'])

        nodes[node_id] = node

    boundary_count = sum(1 for n in nodes.values() if n['isBoundary'])
    print(f"  {boundary_count} boundary nodes")

    return nodes, start_node_map, end_node_map


def build_adjacency(segments: List[dict], nodes: Dict[str, RoadNode],
                    start_node_map: Dict[str, str], end_node_map: Dict[str, str]) -> None:
    """Build successor/predecessor relationships based on shared nodes and angle compatibility."""
    print("Building adjacency...")

    # Create segment lookup
    seg_map = {s['id']: s for s in segments}

    # First pass: compute headings
    for seg in segments:
        pts = seg['points']
        seg['startHeadingDeg'] = compute_heading(pts[0], pts[1])
        seg['endHeadingDeg'] = compute_heading(pts[-2], pts[-1])

    # Second pass: build successors
    total_successors = 0
    for seg in segments:
        end_node_id = end_node_map[seg['id']]
        end_node = nodes[end_node_id]

        seg['successors'] = []

        # Candidates are segments that START at the node where this segment ENDS
        for candidate_id in end_node['outgoing']:
            if candidate_id == seg['id']:
                continue  # Skip self-loops

            candidate = seg_map[candidate_id]

            # Check angle compatibility
            angle_diff = angle_difference(seg['endHeadingDeg'], candidate['startHeadingDeg'])

            if angle_diff <= ANGLE_THRESHOLD:
                seg['successors'].append(candidate_id)
                total_successors += 1

    print(f"  Created {total_successors} successor links")

    # Third pass: predecessors = exact inverse of successors
    for seg in segments:
        seg['predecessors'] = []

    for seg in segments:
        for succ_id in seg['successors']:
            seg_map[succ_id]['predecessors'].append(seg['id'])

    # Verify inverse relationship
    pred_count = sum(len(s['predecessors']) for s in segments)
    assert pred_count == total_successors, f"Predecessor count {pred_count} != successor count {total_successors}"
    print(f"  Verified {pred_count} predecessor links (inverse of successors)")


def augment_segments(segments: List[dict], nodes: Dict[str, RoadNode],
                     start_node_map: Dict[str, str], end_node_map: Dict[str, str]) -> None:
    """Add computed fields to segments."""
    print("Augmenting segments...")

    major_count = 0
    entry_count = 0

    for seg in segments:
        # Add node IDs
        seg['startNodeId'] = start_node_map[seg['id']]
        seg['endNodeId'] = end_node_map[seg['id']]

        # Compute speedRatio (replaces congestionFactor)
        speed_ratio = seg['avgSpeedMph'] / seg['freeFlowSpeedMph']
        seg['speedRatio'] = max(0.01, min(1.0, round(speed_ratio, 3)))

        # Compute lengthMeters
        seg['lengthMeters'] = round(compute_length(seg['points']), 2)

        # Classify isMajor
        max_spawn = max(seg['spawnRates'])
        is_major = (
            max_spawn > SPAWN_RATE_THRESHOLD or
            seg['speedRatio'] > SPEED_RATIO_THRESHOLD or
            seg['lengthMeters'] > LENGTH_THRESHOLD
        )
        seg['isMajor'] = is_major
        if is_major:
            major_count += 1

        # Classify isEntry
        start_node = nodes[seg['startNodeId']]
        is_entry = start_node['isBoundary'] or len(seg['predecessors']) == 0
        seg['isEntry'] = is_entry
        if is_entry:
            entry_count += 1

    print(f"  {major_count} major segments ({major_count / len(segments) * 100:.1f}%)")
    print(f"  {entry_count} entry points ({entry_count / len(segments) * 100:.1f}%)")


def main():
    print(f"Reading {INPUT_PATH}...")
    with open(INPUT_PATH) as f:
        data = json.load(f)

    segments = data['segments']
    meta = data['meta']

    print(f"Loaded {len(segments)} segments")

    # Compute data bounds for boundary detection
    print("Computing data bounds...")
    compute_data_bounds(segments)

    # Build node set
    nodes, start_node_map, end_node_map = build_node_set(segments)

    # Build adjacency
    build_adjacency(segments, nodes, start_node_map, end_node_map)

    # Augment segments with computed fields
    augment_segments(segments, nodes, start_node_map, end_node_map)

    # Compute statistics
    total_successor_links = sum(len(s['successors']) for s in segments)
    graph_version = compute_graph_version(segments)

    # Build output
    graph_meta = {
        **meta,
        'majorSegmentCount': sum(1 for s in segments if s['isMajor']),
        'entryPointCount': sum(1 for s in segments if s['isEntry']),
        'totalSuccessorLinks': total_successor_links,
        'graphVersion': graph_version,
    }

    nodes_meta = {
        'nodeCount': len(nodes),
        'snapRadius': SNAP_RADIUS,
    }

    # Write outputs
    print(f"\nWriting {OUTPUT_GRAPH_PATH}...")
    with open(OUTPUT_GRAPH_PATH, 'w') as f:
        json.dump({'meta': graph_meta, 'segments': segments}, f)

    print(f"Writing {OUTPUT_NODES_PATH}...")
    with open(OUTPUT_NODES_PATH, 'w') as f:
        json.dump({'meta': nodes_meta, 'nodes': list(nodes.values())}, f)

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Segments:          {len(segments)}")
    print(f"Nodes:             {len(nodes)}")
    print(f"Successor links:   {total_successor_links}")
    print(f"Avg successors:    {total_successor_links / len(segments):.2f}")
    print(f"Major segments:    {graph_meta['majorSegmentCount']} ({graph_meta['majorSegmentCount'] / len(segments) * 100:.1f}%)")
    print(f"Entry points:      {graph_meta['entryPointCount']} ({graph_meta['entryPointCount'] / len(segments) * 100:.1f}%)")
    print(f"Graph version:     {graph_version}")
    print("=" * 60)

    # Warn if potential issues
    avg_succ = total_successor_links / len(segments)
    if avg_succ < 1.0:
        print("\n⚠️  WARNING: Low average successors - many dead ends")

    orphan_segments = sum(1 for s in segments if len(s['successors']) == 0 and len(s['predecessors']) == 0)
    if orphan_segments > len(segments) * 0.1:
        print(f"\n⚠️  WARNING: {orphan_segments} orphan segments (no connections)")

    print("\nDone!")


if __name__ == '__main__':
    main()
