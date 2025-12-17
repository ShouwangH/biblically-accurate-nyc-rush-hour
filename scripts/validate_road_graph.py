#!/usr/bin/env python3
"""
Road Graph Validation Script

Validates the road graph quality by analyzing:
- Connected components (§3.1)
- Dead-end rate
- Reachability from entry points
- Outputs JSON validation report

Per PSEUDO_TRIP_TRAFFIC_PLAN.md §3:
- Largest component > 90%
- Interior dead ends < 5%
- Reachable from entries > 85%

Usage:
    python scripts/validate_road_graph.py

Exit codes:
    0 - All thresholds passed
    1 - One or more thresholds failed
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Set, TypedDict
from collections import deque

# =============================================================================
# Constants
# =============================================================================

# Validation thresholds (per §3.2)
LARGEST_COMPONENT_THRESHOLD = 0.90  # 90%
INTERIOR_DEAD_END_THRESHOLD = 0.05  # 5%
ENTRY_REACHABILITY_THRESHOLD = 0.85  # 85%

# File paths
GRAPH_PATH = Path(__file__).parent.parent / 'public' / 'assets' / 'road_segments_graph.json'
NODES_PATH = Path(__file__).parent.parent / 'public' / 'assets' / 'road_nodes.json'
REPORT_PATH = Path(__file__).parent.parent / 'public' / 'assets' / 'graph_validation_report.json'


# =============================================================================
# Type Definitions
# =============================================================================

class ValidationReport(TypedDict):
    totalSegments: int
    totalNodes: int
    componentCount: int
    largestComponentSize: int
    largestComponentPct: float
    reachableFromEntries: int
    reachableFromEntriesPct: float
    interiorDeadEnds: int
    interiorDeadEndPct: float
    boundaryDeadEnds: int
    entryPointCount: int
    majorSegmentCount: int
    avgSuccessors: float
    avgPredecessors: float
    passed: bool
    failures: List[str]


# =============================================================================
# Graph Analysis Functions
# =============================================================================

def find_connected_components(segments: Dict[str, dict]) -> List[Set[str]]:
    """
    Find all connected components using BFS.
    Treats graph as undirected (uses both successors and predecessors).
    """
    visited: Set[str] = set()
    components: List[Set[str]] = []

    for seg_id in segments:
        if seg_id in visited:
            continue

        # BFS from this segment
        component: Set[str] = set()
        queue = deque([seg_id])

        while queue:
            current_id = queue.popleft()
            if current_id in visited:
                continue

            visited.add(current_id)
            component.add(current_id)

            segment = segments[current_id]

            # Traverse both directions for connectivity analysis
            for succ_id in segment.get('successors', []):
                if succ_id not in visited and succ_id in segments:
                    queue.append(succ_id)

            for pred_id in segment.get('predecessors', []):
                if pred_id not in visited and pred_id in segments:
                    queue.append(pred_id)

        components.append(component)

    # Sort by size descending
    components.sort(key=len, reverse=True)
    return components


def find_reachable_from_entries(segments: Dict[str, dict]) -> Set[str]:
    """
    Find all segments reachable from entry points via forward traversal.
    """
    entry_segments = [seg_id for seg_id, seg in segments.items() if seg.get('isEntry', False)]

    reachable: Set[str] = set()
    queue = deque(entry_segments)

    while queue:
        current_id = queue.popleft()
        if current_id in reachable:
            continue

        reachable.add(current_id)

        segment = segments.get(current_id)
        if segment:
            for succ_id in segment.get('successors', []):
                if succ_id not in reachable and succ_id in segments:
                    queue.append(succ_id)

    return reachable


def count_dead_ends(segments: Dict[str, dict], nodes: Dict[str, dict]) -> tuple:
    """
    Count dead-end segments (no successors).
    Returns (interior_dead_ends, boundary_dead_ends).
    """
    interior_dead_ends = 0
    boundary_dead_ends = 0

    for seg_id, segment in segments.items():
        if len(segment.get('successors', [])) == 0:
            # Check if this is at a boundary node
            end_node_id = segment.get('endNodeId')
            end_node = nodes.get(end_node_id, {})

            if end_node.get('isBoundary', False):
                boundary_dead_ends += 1
            else:
                interior_dead_ends += 1

    return interior_dead_ends, boundary_dead_ends


def compute_statistics(segments: Dict[str, dict]) -> dict:
    """Compute basic graph statistics."""
    total_successors = sum(len(s.get('successors', [])) for s in segments.values())
    total_predecessors = sum(len(s.get('predecessors', [])) for s in segments.values())
    entry_count = sum(1 for s in segments.values() if s.get('isEntry', False))
    major_count = sum(1 for s in segments.values() if s.get('isMajor', False))

    return {
        'avgSuccessors': total_successors / len(segments) if segments else 0,
        'avgPredecessors': total_predecessors / len(segments) if segments else 0,
        'entryPointCount': entry_count,
        'majorSegmentCount': major_count,
    }


# =============================================================================
# Main Validation
# =============================================================================

def validate_graph() -> ValidationReport:
    """Run all validation checks and return report."""
    print(f"Loading {GRAPH_PATH}...")
    with open(GRAPH_PATH) as f:
        graph_data = json.load(f)

    print(f"Loading {NODES_PATH}...")
    with open(NODES_PATH) as f:
        nodes_data = json.load(f)

    segments = {s['id']: s for s in graph_data['segments']}
    nodes = {n['id']: n for n in nodes_data['nodes']}

    print(f"Loaded {len(segments)} segments, {len(nodes)} nodes")

    # 1. Connected components analysis
    print("\nAnalyzing connected components...")
    components = find_connected_components(segments)
    largest_size = len(components[0]) if components else 0
    largest_pct = largest_size / len(segments) if segments else 0

    print(f"  Found {len(components)} components")
    print(f"  Largest: {largest_size} segments ({largest_pct * 100:.1f}%)")

    # Show top 5 component sizes
    if len(components) > 1:
        print(f"  Component sizes: {[len(c) for c in components[:5]]}...")

    # 2. Reachability from entries
    print("\nAnalyzing reachability from entry points...")
    reachable = find_reachable_from_entries(segments)
    reachable_pct = len(reachable) / len(segments) if segments else 0

    print(f"  Reachable: {len(reachable)} segments ({reachable_pct * 100:.1f}%)")

    # 3. Dead-end analysis
    print("\nAnalyzing dead ends...")
    interior_dead, boundary_dead = count_dead_ends(segments, nodes)
    interior_dead_pct = interior_dead / len(segments) if segments else 0

    print(f"  Interior dead ends: {interior_dead} ({interior_dead_pct * 100:.1f}%)")
    print(f"  Boundary dead ends: {boundary_dead} (expected)")

    # 4. Additional statistics
    stats = compute_statistics(segments)
    print(f"\nStatistics:")
    print(f"  Entry points: {stats['entryPointCount']}")
    print(f"  Major segments: {stats['majorSegmentCount']}")
    print(f"  Avg successors: {stats['avgSuccessors']:.2f}")
    print(f"  Avg predecessors: {stats['avgPredecessors']:.2f}")

    # 5. Check thresholds
    failures: List[str] = []

    if largest_pct < LARGEST_COMPONENT_THRESHOLD:
        failures.append(
            f"Largest component {largest_pct * 100:.1f}% < {LARGEST_COMPONENT_THRESHOLD * 100}% threshold"
        )

    if interior_dead_pct > INTERIOR_DEAD_END_THRESHOLD:
        failures.append(
            f"Interior dead ends {interior_dead_pct * 100:.1f}% > {INTERIOR_DEAD_END_THRESHOLD * 100}% threshold"
        )

    if reachable_pct < ENTRY_REACHABILITY_THRESHOLD:
        failures.append(
            f"Entry reachability {reachable_pct * 100:.1f}% < {ENTRY_REACHABILITY_THRESHOLD * 100}% threshold"
        )

    passed = len(failures) == 0

    report: ValidationReport = {
        'totalSegments': len(segments),
        'totalNodes': len(nodes),
        'componentCount': len(components),
        'largestComponentSize': largest_size,
        'largestComponentPct': round(largest_pct * 100, 2),
        'reachableFromEntries': len(reachable),
        'reachableFromEntriesPct': round(reachable_pct * 100, 2),
        'interiorDeadEnds': interior_dead,
        'interiorDeadEndPct': round(interior_dead_pct * 100, 2),
        'boundaryDeadEnds': boundary_dead,
        'entryPointCount': stats['entryPointCount'],
        'majorSegmentCount': stats['majorSegmentCount'],
        'avgSuccessors': round(stats['avgSuccessors'], 2),
        'avgPredecessors': round(stats['avgPredecessors'], 2),
        'passed': passed,
        'failures': failures,
    }

    return report


def main():
    print("=" * 60)
    print("ROAD GRAPH VALIDATION")
    print("=" * 60)

    report = validate_graph()

    # Write report
    print(f"\nWriting report to {REPORT_PATH}...")
    with open(REPORT_PATH, 'w') as f:
        json.dump(report, f, indent=2)

    # Print summary
    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)
    print(f"Total segments:      {report['totalSegments']}")
    print(f"Total nodes:         {report['totalNodes']}")
    print(f"Components:          {report['componentCount']}")
    print(f"Largest component:   {report['largestComponentPct']}%", end="")
    print(f" {'✓' if report['largestComponentPct'] >= LARGEST_COMPONENT_THRESHOLD * 100 else '✗'}")
    print(f"Entry reachability:  {report['reachableFromEntriesPct']}%", end="")
    print(f" {'✓' if report['reachableFromEntriesPct'] >= ENTRY_REACHABILITY_THRESHOLD * 100 else '✗'}")
    print(f"Interior dead ends:  {report['interiorDeadEndPct']}%", end="")
    print(f" {'✓' if report['interiorDeadEndPct'] <= INTERIOR_DEAD_END_THRESHOLD * 100 else '✗'}")
    print("=" * 60)

    if report['passed']:
        print("\n✓ All validation thresholds PASSED")
        return 0
    else:
        print("\n✗ Validation FAILED:")
        for failure in report['failures']:
            print(f"  - {failure}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
