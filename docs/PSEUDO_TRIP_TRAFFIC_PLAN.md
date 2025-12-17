# Pseudo-Trip Traffic Model: Implementation Plan v2

## Overview

Transform per-segment traffic visualization into continuous pseudo-trips with improved road visibility and station beam normalization.

**Core problems addressed:**
1. Roads too subtle (dark lines on dark background)
2. Traffic lacks continuity (spawn → short segment → despawn)
3. Station beams have insufficient variance (0.8–1.0 range)

---

## 1. Revised Schema for `road_segments.json`

### Current Schema
```typescript
interface RoadSegment {
  id: string;
  type: 'avenue' | 'street' | 'highway';
  points: Point3D[];
  avgSpeedMph: number;
  freeFlowSpeedMph: number;
  congestionFactor: number;  // AMBIGUOUS - see §2.3
  spawnRates: number[];
}
```

### Proposed Schema v2
```typescript
interface RoadSegmentV2 {
  // === Existing fields ===
  id: string;
  type: 'avenue' | 'street' | 'highway';
  points: Point3D[];
  avgSpeedMph: number;
  freeFlowSpeedMph: number;
  spawnRates: number[];

  // === Renamed/clarified field ===
  /**
   * Speed ratio = avgSpeedMph / freeFlowSpeedMph.
   * Range: (0, 1]. Higher = faster = less congested.
   * Renamed from congestionFactor to remove ambiguity.
   */
  speedRatio: number;

  // === New fields ===

  /** Pre-computed polyline length in meters */
  lengthMeters: number;

  /** Node ID at START of segment (from snapped node set) */
  startNodeId: string;

  /** Node ID at END of segment (from snapped node set) */
  endNodeId: string;

  /** Heading in degrees [0, 360) at segment START */
  startHeadingDeg: number;

  /** Heading in degrees [0, 360) at segment END */
  endHeadingDeg: number;

  /** Major arterial (Broadway, avenues, FDR) vs local street */
  isMajor: boolean;

  /** Entry point where vehicles can spawn */
  isEntry: boolean;

  /** IDs of segments reachable from END of this segment */
  successors: string[];

  /** IDs of segments that lead INTO this segment (inverse of successors) */
  predecessors: string[];
}
```

### Node Table (new file: `road_nodes.json`)
```typescript
interface RoadNode {
  id: string;
  position: [number, number];  // [x, z] - y is always 0

  /** Segments that START at this node */
  outgoing: string[];

  /** Segments that END at this node */
  incoming: string[];

  /** True if this is a map boundary or major unmodeled intersection */
  isBoundary: boolean;
}

interface RoadNodesFile {
  meta: {
    nodeCount: number;
    snapRadius: number;  // ε used for clustering
  };
  nodes: RoadNode[];
}
```

---

## 2. Offline Preprocessing Algorithms

### 2.1 Node Snapping (Critical Fix)

**Problem:** Raw segment endpoints may not align at intersections. Segments can cross without shared endpoints or have small gaps.

**Solution:** Cluster endpoints within ε, replace with cluster centroids.

```
CONSTANTS:
  SNAP_RADIUS = 10  // meters - tune based on data quality

function buildNodeSet(segments: RoadSegment[]): Map<string, RoadNode>
  // Collect all endpoints
  endpoints = []
  for segment in segments:
    endpoints.push({ x: segment.points[0].x, z: segment.points[0].z,
                     segmentId: segment.id, isStart: true })
    endpoints.push({ x: segment.points[last].x, z: segment.points[last].z,
                     segmentId: segment.id, isStart: false })

  // Cluster endpoints using DBSCAN or union-find with distance threshold
  clusters = clusterPoints(endpoints, SNAP_RADIUS)

  nodes = Map<string, RoadNode>()
  nodeIdCounter = 0

  for cluster in clusters:
    // Compute centroid
    cx = mean(cluster.map(p => p.x))
    cz = mean(cluster.map(p => p.z))

    nodeId = "node_" + (nodeIdCounter++)

    node = {
      id: nodeId,
      position: [cx, cz],
      outgoing: [],  // segments starting here
      incoming: [],  // segments ending here
      isBoundary: isNearMapBoundary(cx, cz)
    }

    // Assign node to each segment endpoint in cluster
    for endpoint in cluster:
      if endpoint.isStart:
        segments[endpoint.segmentId].startNodeId = nodeId
        node.outgoing.push(endpoint.segmentId)
      else:
        segments[endpoint.segmentId].endNodeId = nodeId
        node.incoming.push(endpoint.segmentId)

    nodes.set(nodeId, node)

  return nodes

function clusterPoints(points, radius):
  // Union-find approach
  parent = {}
  for p in points:
    parent[p.id] = p.id

  // Merge points within radius (O(n²) acceptable for ~10K points)
  for i in 0..len(points):
    for j in i+1..len(points):
      if distance(points[i], points[j]) < radius:
        union(parent, points[i].id, points[j].id)

  // Group by root
  clusters = {}
  for p in points:
    root = find(parent, p.id)
    clusters[root] = clusters[root] or []
    clusters[root].push(p)

  return clusters.values()
```

### 2.2 Building Adjacency (Corrected)

**Key insight:** Adjacency is now node-based, not raw coordinate based.

```
CONSTANTS:
  ANGLE_THRESHOLD = 60  // degrees - reduced from 120°

function buildAdjacency(segments: Map<string, RoadSegmentV2>,
                        nodes: Map<string, RoadNode>): void

  // First pass: compute headings for all segments
  for segment in segments.values():
    segment.startHeadingDeg = computeHeading(segment.points[0], segment.points[1])
    n = len(segment.points)
    segment.endHeadingDeg = computeHeading(segment.points[n-2], segment.points[n-1])

  // Second pass: build successors based on shared nodes + angle compatibility
  for segment in segments.values():
    endNode = nodes.get(segment.endNodeId)
    segment.successors = []

    // Candidates are segments that START at the node where this segment ENDS
    for candidateId in endNode.outgoing:
      if candidateId == segment.id:
        continue  // Skip self-loops

      candidate = segments.get(candidateId)

      // Check angle compatibility
      angleDiff = angleDifference(segment.endHeadingDeg, candidate.startHeadingDeg)

      if angleDiff <= ANGLE_THRESHOLD:
        segment.successors.push(candidateId)

  // Third pass: predecessors = exact inverse of successors
  // Clear any existing predecessors first
  for segment in segments.values():
    segment.predecessors = []

  for segment in segments.values():
    for successorId in segment.successors:
      successor = segments.get(successorId)
      successor.predecessors.push(segment.id)

function computeHeading(from: Point3D, to: Point3D): number
  dx = to.x - from.x
  dz = to.z - from.z
  // Note: -dz because Z negative is north in our coordinate system
  heading = atan2(dx, -dz) * 180 / PI
  return (heading + 360) mod 360

function angleDifference(h1: number, h2: number): number
  diff = abs(h1 - h2)
  return min(diff, 360 - diff)
```

### 2.3 Clarify `speedRatio` (formerly `congestionFactor`)

**Definition:** `speedRatio = avgSpeedMph / freeFlowSpeedMph`

| speedRatio | Meaning |
|------------|---------|
| 1.0 | Free flow, no congestion |
| 0.5 | Moving at half free-flow speed |
| 0.3 | Heavy congestion |

**Offline normalization:**
```
function normalizeSpeedRatio(segment: RoadSegment): void
  // Ensure it's computed correctly
  segment.speedRatio = segment.avgSpeedMph / segment.freeFlowSpeedMph

  // Clamp to valid range
  segment.speedRatio = clamp(segment.speedRatio, 0.01, 1.0)

  // Remove old ambiguous field
  delete segment.congestionFactor
```

### 2.4 Computing `lengthMeters`

```
function computeLength(points: Point3D[]): number
  total = 0
  for i in 1..len(points)-1:
    dx = points[i].x - points[i-1].x
    dz = points[i].z - points[i-1].z
    total += sqrt(dx*dx + dz*dz)
  return total
```

### 2.5 Classifying `isMajor`

```
CONSTANTS:
  SPAWN_RATE_THRESHOLD = 0.30
  SPEED_RATIO_THRESHOLD = 0.50  // Higher = less congested = likely arterial
  LENGTH_THRESHOLD = 150  // meters

function classifyMajor(segment: RoadSegmentV2): boolean
  maxSpawn = max(segment.spawnRates)

  // High TLC activity
  if maxSpawn > SPAWN_RATE_THRESHOLD:
    return true

  // Flows well relative to free flow
  if segment.speedRatio > SPEED_RATIO_THRESHOLD:
    return true

  // Long segment (arterials have longer blocks)
  if segment.lengthMeters > LENGTH_THRESHOLD:
    return true

  return false
```

### 2.6 Classifying `isEntry`

```
function classifyEntry(segment: RoadSegmentV2, nodes: Map<string, RoadNode>): boolean
  startNode = nodes.get(segment.startNodeId)

  // Node is at map boundary
  if startNode.isBoundary:
    return true

  // No predecessors = road enters from outside modeled area
  if len(segment.predecessors) == 0:
    return true

  return false
```

---

## 3. Graph Validation (Critical)

Before proceeding to runtime, validate the constructed graph.

### 3.1 Connected Components Analysis

```
function validateGraph(segments: Map<string, RoadSegmentV2>,
                       nodes: Map<string, RoadNode>): ValidationReport

  // Find connected components using BFS/DFS
  visited = Set()
  components = []

  for segment in segments.values():
    if segment.id in visited:
      continue

    component = bfs(segment.id, segments, visited)
    components.push(component)

  // Sort by size
  components.sort((a, b) => b.size - a.size)

  report = {
    totalSegments: segments.size,
    componentCount: len(components),
    largestComponentSize: components[0].size,
    largestComponentPct: components[0].size / segments.size * 100,

    // Segments reachable from any entry point
    reachableFromEntry: countReachableFromEntries(segments),

    // Dead-end rate (successors.length == 0 AND not at boundary)
    interiorDeadEnds: countInteriorDeadEnds(segments, nodes),
  }

  return report

function bfs(startId, segments, visited):
  queue = [startId]
  component = Set()

  while len(queue) > 0:
    current = queue.shift()
    if current in visited:
      continue

    visited.add(current)
    component.add(current)

    segment = segments.get(current)

    // Traverse both directions for connectivity
    for succId in segment.successors:
      if succId not in visited:
        queue.push(succId)

    for predId in segment.predecessors:
      if predId not in visited:
        queue.push(predId)

  return component
```

### 3.2 Validation Thresholds

| Metric | Expected | Action if Failed |
|--------|----------|------------------|
| Largest component % | > 90% | Check SNAP_RADIUS, may need intersection splitting |
| Interior dead ends | < 5% | Check ANGLE_THRESHOLD, may be too strict |
| Reachable from entries | > 85% | Check isEntry classification |

---

## 4. TrafficEngine V2: Pseudo-Trip Model

### 4.1 Vehicle State

```typescript
interface VehicleStateV2 {
  id: string;

  // Current segment
  segmentId: string;
  progress: number;           // [0, 1] along current segment
  speedMps: number;

  // Trip tracking
  traveledMeters: number;
  targetMeters: number;

  // Rendering
  position: Point3D;
  heading: number;
  speedRatio: number;         // From current segment, for coloring
}
```

### 4.2 Engine State (with swap-remove optimization)

```typescript
class TrafficEngineV2 {
  // Indexed data
  private segments: Map<string, RoadSegmentV2>;
  private entrySegments: RoadSegmentV2[];

  // Dense vehicle array - NO inactive tombstones
  // activeCount === vehicles.length always
  private vehicles: VehicleStateV2[];

  private maxVehicles: number;
  private lastSliceIndex: number;
  private nextVehicleId: number;
}
```

### 4.3 Spawn Logic (with steady-state math)

**Steady-state calculation:**
```
Given:
  - spawnRates[slice] = expected vehicles per slice per entry segment
  - avgTripMeters = 800m
  - avgSpeedMps ≈ 4 m/s (9 mph typical)
  - avgLifetimeSeconds = avgTripMeters / avgSpeedMps = 200s
  - sliceDurationSeconds = 60s (1 minute per slice)
  - numEntrySegments ≈ 400
  - avgSpawnRatePerSlice ≈ 0.15

Expected spawns per slice:
  = avgSpawnRatePerSlice * numEntrySegments
  = 0.15 * 400 = 60 vehicles/slice

Steady state:
  = spawnsPerSecond * avgLifetimeSeconds
  = (60 / 60) * 200
  = 200 vehicles

So with these parameters, expect ~200 active vehicles at steady state.
To target ~1500 vehicles, need spawn multiplier of ~7.5.
```

**Spawn implementation:**
```
CONSTANTS:
  SPAWN_MULTIPLIER = 7.5      // Tune based on steady-state target
  LOAD_SOFT_CAP = 0.7
  LOAD_HARD_CAP = 0.95

function spawnVehiclesForSlice(sliceIndex: number): void
  loadRatio = this.vehicles.length / this.maxVehicles

  if loadRatio >= LOAD_HARD_CAP:
    return

  // Linear scaling between soft and hard cap
  spawnScale = 1.0
  if loadRatio > LOAD_SOFT_CAP:
    spawnScale = (LOAD_HARD_CAP - loadRatio) / (LOAD_HARD_CAP - LOAD_SOFT_CAP)

  for segment in this.entrySegments:
    rawRate = segment.spawnRates[sliceIndex] * SPAWN_MULTIPLIER
    scaledRate = rawRate * spawnScale

    spawnCount = poissonSample(scaledRate)

    for i in 0..spawnCount:
      if this.vehicles.length >= this.maxVehicles:
        return
      this.spawnVehicle(segment)
```

### 4.4 Trip Length Sampling

```
CONSTANTS:
  TRIP_LENGTH_MEAN = 800      // meters
  TRIP_LENGTH_MIN = 200
  TRIP_LENGTH_MAX = 2500

function sampleTripLength(): number
  // Log-normal gives realistic right-skewed distribution
  mu = ln(TRIP_LENGTH_MEAN) - 0.125  // Adjust for log-normal mean
  sigma = 0.5

  raw = exp(mu + sigma * randomGaussian())
  return clamp(raw, TRIP_LENGTH_MIN, TRIP_LENGTH_MAX)
```

### 4.5 Movement with Leftover Distance Carry (Critical Fix)

**Problem:** Naive implementation overcounts distance at segment boundaries.

**Solution:** Consume distance across segments in a loop.

```
CONSTANTS:
  MAX_TRANSITIONS_PER_FRAME = 5  // Prevent infinite loops

function moveVehicles(dt: number): void
  for vehicle in this.vehicles:
    remainingDistance = vehicle.speedMps * dt
    transitionsThisFrame = 0

    while remainingDistance > 0 AND transitionsThisFrame < MAX_TRANSITIONS_PER_FRAME:
      segment = this.segments.get(vehicle.segmentId)

      // Distance remaining on current segment
      metersToEnd = (1.0 - vehicle.progress) * segment.lengthMeters

      if remainingDistance < metersToEnd:
        // Normal case: stay on current segment
        progressDelta = remainingDistance / segment.lengthMeters
        vehicle.progress += progressDelta
        vehicle.traveledMeters += remainingDistance
        remainingDistance = 0
      else:
        // Reached segment end
        vehicle.traveledMeters += metersToEnd
        remainingDistance -= metersToEnd
        vehicle.progress = 1.0

        // Check if trip is complete
        if vehicle.traveledMeters >= vehicle.targetMeters:
          this.markForDespawn(vehicle)
          break

        // Try to transition
        nextSegmentId = this.chooseNextSegment(segment, vehicle)

        if nextSegmentId == null:
          // Dead end - despawn
          this.markForDespawn(vehicle)
          break

        // Transition to next segment
        this.transitionToSegment(vehicle, nextSegmentId)
        transitionsThisFrame++

    // Update position from final progress
    if not vehicle.markedForDespawn:
      segment = this.segments.get(vehicle.segmentId)
      vehicle.position = interpolate(segment.points, vehicle.progress)
      vehicle.heading = interpolateHeading(segment, vehicle.progress)

function transitionToSegment(vehicle: VehicleStateV2, segmentId: string): void
  segment = this.segments.get(segmentId)
  vehicle.segmentId = segmentId
  vehicle.progress = 0
  vehicle.speedMps = segment.avgSpeedMph * MPH_TO_MPS
  vehicle.speedRatio = segment.speedRatio
```

### 4.6 Routing: Separate Policy from Scoring (Critical Fix)

**Problem:** Original had `random()` inside score computation, making weights non-deterministic.

**Solution:** First choose candidate set, then score deterministically.

```
CONSTANTS:
  LOCAL_ROAD_PROBABILITY = 0.15  // 15% chance to consider local roads
  HEADING_BONUS = 1.5            // Bonus for straight-ahead
  SHARP_TURN_PENALTY = 0.3       // Penalty for >90° turn
  HEADING_PREFERENCE = 45        // degrees

function chooseNextSegment(current: RoadSegmentV2, vehicle: VehicleStateV2): string | null
  if len(current.successors) == 0:
    return null

  // Partition successors into major vs local
  majorSuccessors = []
  localSuccessors = []

  for succId in current.successors:
    succ = this.segments.get(succId)
    if succ.isMajor:
      majorSuccessors.push(succId)
    else:
      localSuccessors.push(succId)

  // Choose which set to draw from
  candidates = majorSuccessors
  if len(majorSuccessors) == 0:
    candidates = localSuccessors
  else if len(localSuccessors) > 0 AND random() < LOCAL_ROAD_PROBABILITY:
    candidates = localSuccessors

  if len(candidates) == 0:
    // Fallback to any successor
    candidates = current.successors

  // Score candidates deterministically
  scored = []
  for succId in candidates:
    succ = this.segments.get(succId)
    score = scoreSuccessorDeterministic(current, succ)
    scored.push({ id: succId, score: score })

  return weightedRandomSelect(scored)

function scoreSuccessorDeterministic(current: RoadSegmentV2,
                                      candidate: RoadSegmentV2): number
  score = 1.0

  // Heading preference (deterministic)
  headingDiff = angleDifference(current.endHeadingDeg, candidate.startHeadingDeg)

  if headingDiff < HEADING_PREFERENCE:
    score *= HEADING_BONUS
  else if headingDiff > 90:
    score *= SHARP_TURN_PENALTY

  // Prefer faster segments (better flow)
  score *= (0.5 + candidate.speedRatio)

  return score

function weightedRandomSelect(scored: {id: string, score: number}[]): string
  totalWeight = sum(scored.map(s => s.score))

  if totalWeight <= 0:
    return scored[floor(random() * len(scored))].id

  r = random() * totalWeight
  cumulative = 0

  for item in scored:
    cumulative += item.score
    if r < cumulative:
      return item.id

  return scored[last].id
```

### 4.7 Despawn with Swap-Remove (Performance Fix)

**Problem:** Marking vehicles inactive creates tombstones, degrades to O(total_spawned).

**Solution:** Swap with last and pop.

```
function despawnMarkedVehicles(): void
  i = 0
  while i < len(this.vehicles):
    if this.vehicles[i].markedForDespawn:
      // Swap with last
      lastIdx = len(this.vehicles) - 1
      if i < lastIdx:
        this.vehicles[i] = this.vehicles[lastIdx]
      this.vehicles.pop()
      // Don't increment i - check swapped element
    else:
      i++

// Alternative: collect indices and batch remove
function despawnMarkedVehiclesBatch(): void
  writeIdx = 0
  for readIdx in 0..len(this.vehicles):
    if not this.vehicles[readIdx].markedForDespawn:
      if writeIdx != readIdx:
        this.vehicles[writeIdx] = this.vehicles[readIdx]
      writeIdx++

  this.vehicles.length = writeIdx
```

### 4.8 Complete Update Cycle

```
function update(simulationTime: number, dt: number): void
  // 1. Move vehicles (with segment transitions)
  this.moveVehicles(dt)

  // 2. Despawn marked vehicles (swap-remove)
  this.despawnMarkedVehicles()

  // 3. Spawn new vehicles on slice transition
  currentSlice = getSliceIndex(simulationTime)
  if currentSlice != this.lastSliceIndex:
    this.spawnVehiclesForSlice(currentSlice)
    this.lastSliceIndex = currentSlice

function getVehicles(): VehicleStateV2[]
  // No filtering needed - array is always dense
  return this.vehicles.map(v => ({
    ...v,
    position: [...v.position]  // Defensive copy
  }))
```

---

## 4B. Route Caching (Performance Optimization)

### Motivation

Runtime routing is the most expensive per-frame operation:
- Each segment transition requires successor lookup, scoring, weighted selection
- With ~1500 vehicles averaging 3 transitions/minute, that's ~75 routing decisions/second
- Pre-computing routes eliminates this entirely

### 4B.1 Route Template Data Structure

```typescript
interface RouteTemplate {
  /** Entry segment where route begins */
  entrySegmentId: string;

  /** Ordered sequence of segment IDs to traverse */
  segmentSequence: string[];

  /** Total route length in meters */
  totalLengthMeters: number;

  /** Pre-computed cumulative distances at each segment boundary */
  cumulativeDistances: number[];  // [0, seg0.length, seg0+seg1, ...]
}

interface RouteCacheFile {
  meta: {
    generatedAt: string;
    routesPerEntry: number;
    totalRoutes: number;
    graphVersion: string;  // Hash of road_segments_v2.json for cache invalidation
  };

  /** Map from entrySegmentId to array of route templates */
  routes: Record<string, RouteTemplate[]>;
}
```

### 4B.2 Offline Route Generation

Generate routes by simulating the routing algorithm without rendering:

```
CONSTANTS:
  ROUTES_PER_ENTRY = 25        // Number of pre-computed routes per entry segment
  LENGTH_BUCKETS = [300, 600, 1000, 1500, 2200]  // Target lengths for variety

function generateRouteCache(
  segments: Map<string, RoadSegmentV2>,
  entrySegments: RoadSegmentV2[]
): RouteCacheFile

  routes = {}

  for entry in entrySegments:
    routes[entry.id] = []

    // Generate routes targeting different length buckets
    for targetLength in LENGTH_BUCKETS:
      for i in 0..(ROUTES_PER_ENTRY / len(LENGTH_BUCKETS)):
        route = simulateRoute(entry, segments, targetLength)

        if route != null AND route.totalLengthMeters >= 200:
          routes[entry.id].push(route)

  return {
    meta: {
      generatedAt: now(),
      routesPerEntry: ROUTES_PER_ENTRY,
      totalRoutes: sum(routes.values().map(r => len(r))),
      graphVersion: hash(segments)
    },
    routes: routes
  }

function simulateRoute(
  entry: RoadSegmentV2,
  segments: Map<string, RoadSegmentV2>,
  targetLength: number
): RouteTemplate | null

  sequence = [entry.id]
  cumulativeDistances = [0, entry.lengthMeters]
  totalLength = entry.lengthMeters
  currentSegment = entry

  maxSegments = 50  // Safety limit

  while totalLength < targetLength AND len(sequence) < maxSegments:
    // Use same routing logic as runtime
    nextId = chooseNextSegmentForCache(currentSegment, segments)

    if nextId == null:
      break  // Dead end

    nextSegment = segments.get(nextId)
    sequence.push(nextId)
    totalLength += nextSegment.lengthMeters
    cumulativeDistances.push(totalLength)
    currentSegment = nextSegment

  if len(sequence) < 2:
    return null  // Route too short

  return {
    entrySegmentId: entry.id,
    segmentSequence: sequence,
    totalLengthMeters: totalLength,
    cumulativeDistances: cumulativeDistances
  }

function chooseNextSegmentForCache(
  current: RoadSegmentV2,
  segments: Map<string, RoadSegmentV2>
): string | null

  // Same logic as runtime chooseNextSegment (§4.6)
  // but can be run offline without performance concerns

  if len(current.successors) == 0:
    return null

  majorSuccessors = current.successors.filter(id => segments.get(id).isMajor)
  localSuccessors = current.successors.filter(id => !segments.get(id).isMajor)

  candidates = majorSuccessors
  if len(majorSuccessors) == 0:
    candidates = localSuccessors
  else if len(localSuccessors) > 0 AND random() < LOCAL_ROAD_PROBABILITY:
    candidates = localSuccessors

  if len(candidates) == 0:
    candidates = current.successors

  scored = candidates.map(id => ({
    id: id,
    score: scoreSuccessorDeterministic(current, segments.get(id))
  }))

  return weightedRandomSelect(scored)
```

### 4B.3 Runtime Usage with Route Templates

**Modified Vehicle State:**
```typescript
interface VehicleStateV2 {
  id: string;

  // Route tracking (replaces dynamic routing)
  routeTemplate: RouteTemplate;
  routeIndex: number;           // Current position in segmentSequence
  progress: number;             // [0, 1] along current segment

  // Derived from route
  segmentId: string;            // = routeTemplate.segmentSequence[routeIndex]
  speedMps: number;

  // Trip tracking
  traveledMeters: number;
  targetMeters: number;

  // Rendering
  position: Point3D;
  heading: number;
  speedRatio: number;
}
```

**Modified Spawn:**
```
function spawnVehicle(entrySegment: RoadSegmentV2): void
  targetLength = sampleTripLength()

  // Find best matching route template
  templates = this.routeCache.get(entrySegment.id)
  route = selectBestRoute(templates, targetLength)

  if route == null:
    return  // No valid route from this entry (shouldn't happen)

  segment = this.segments.get(route.segmentSequence[0])

  vehicle = {
    id: generateId(),
    routeTemplate: route,
    routeIndex: 0,
    segmentId: route.segmentSequence[0],
    progress: 0,
    speedMps: segment.avgSpeedMph * MPH_TO_MPS,
    traveledMeters: 0,
    targetMeters: min(targetLength, route.totalLengthMeters),
    position: interpolate(segment.points, 0),
    heading: segment.startHeadingDeg,
    speedRatio: segment.speedRatio
  }

  this.vehicles.push(vehicle)

function selectBestRoute(templates: RouteTemplate[], targetLength: number): RouteTemplate
  // Filter to routes that are at least targetLength (or close)
  viable = templates.filter(t => t.totalLengthMeters >= targetLength * 0.8)

  if len(viable) == 0:
    // Fall back to longest available
    viable = templates.sort((a, b) => b.totalLengthMeters - a.totalLengthMeters)

  // Random selection among viable routes (for variety)
  return viable[floor(random() * min(len(viable), 5))]
```

**Modified Segment Transition (no routing!):**
```
function transitionToNextSegment(vehicle: VehicleStateV2): boolean
  route = vehicle.routeTemplate
  nextIndex = vehicle.routeIndex + 1

  if nextIndex >= len(route.segmentSequence):
    return false  // End of route

  nextSegmentId = route.segmentSequence[nextIndex]
  nextSegment = this.segments.get(nextSegmentId)

  vehicle.routeIndex = nextIndex
  vehicle.segmentId = nextSegmentId
  vehicle.progress = 0
  vehicle.speedMps = nextSegment.avgSpeedMph * MPH_TO_MPS
  vehicle.speedRatio = nextSegment.speedRatio

  return true
```

### 4B.4 Successor Score Cache (Secondary Optimization)

For any remaining dynamic routing needs (e.g., fallback, debugging), pre-compute scores:

```typescript
interface SuccessorScoreEntry {
  successorId: string;
  score: number;
  isMajor: boolean;
}

// Built once at load time
type SuccessorScoreCache = Map<string, SuccessorScoreEntry[]>;

function buildSuccessorScoreCache(
  segments: Map<string, RoadSegmentV2>
): SuccessorScoreCache {

  const cache = new Map();

  for (const segment of segments.values()) {
    const scores: SuccessorScoreEntry[] = [];

    for (const succId of segment.successors) {
      const succ = segments.get(succId)!;
      scores.push({
        successorId: succId,
        score: scoreSuccessorDeterministic(segment, succ),
        isMajor: succ.isMajor,
      });
    }

    // Pre-sort descending for efficient weighted selection
    scores.sort((a, b) => b.score - a.score);
    cache.set(segment.id, scores);
  }

  return cache;
}
```

### 4B.5 Memory Estimates

| Data | Size | Notes |
|------|------|-------|
| Route templates | ~2 MB | 400 entries × 25 routes × ~10 segments × 20 bytes/segment |
| Successor scores | ~500 KB | 4785 segments × ~3 successors × 32 bytes |
| Total cache | ~2.5 MB | Acceptable for browser |

### 4B.6 Cache Invalidation

Route cache must be regenerated when:
- `road_segments_v2.json` changes (graph structure)
- Routing parameters change (ANGLE_THRESHOLD, LOCAL_ROAD_PROBABILITY)

**Validation at load time:**
```typescript
function validateRouteCache(
  cache: RouteCacheFile,
  segments: Map<string, RoadSegmentV2>
): boolean {
  // Check graph version matches
  const currentHash = hashSegments(segments);
  if (cache.meta.graphVersion !== currentHash) {
    console.warn('Route cache stale - graph changed');
    return false;
  }

  // Spot check a few routes still valid
  const sampleRoutes = selectRandomRoutes(cache.routes, 10);
  for (const route of sampleRoutes) {
    if (!validateRouteConnectivity(route, segments)) {
      console.warn('Route cache invalid - connectivity broken');
      return false;
    }
  }

  return true;
}

function validateRouteConnectivity(
  route: RouteTemplate,
  segments: Map<string, RoadSegmentV2>
): boolean {
  for (let i = 0; i < route.segmentSequence.length - 1; i++) {
    const current = segments.get(route.segmentSequence[i]);
    const next = route.segmentSequence[i + 1];

    if (!current.successors.includes(next)) {
      return false;  // Route no longer valid
    }
  }
  return true;
}
```

### 4B.7 Benefits Summary

| Metric | Without Cache | With Cache |
|--------|---------------|------------|
| Routing ops/frame | ~75 | 0 |
| Memory per vehicle | ~100 bytes | ~120 bytes (+ route ref) |
| Spawn complexity | O(successors) | O(templates) ~constant |
| Transition complexity | O(successors × scoring) | O(1) array lookup |
| Route variety | Infinite | Limited to cache size |
| Deterministic replay | No | Yes (same template = same path) |

---

## 5. Road Visibility

### Decision: Bake roads into basemap texture

**Rationale:**
- Roads need to be stable visual reference, not dynamic
- 3D line rendering has aliasing, depth fighting issues
- Reduces draw calls

### Basemap Design

| Layer | Color | Notes |
|-------|-------|-------|
| Base land | `#F5F5F0` | Warm off-white |
| Water | `#B8D4E8` | Soft blue |
| Parks | `#C5E0C5` | Soft green |
| Major roads | `#D0D0C8` | 4-6px width |
| Minor roads | `#E0E0D8` | 2-3px width |

### Texture Resolution

| Zoom Level | Recommendation |
|------------|----------------|
| Overview (high altitude) | 4096² sufficient |
| Close zoom (street level) | 8192² or 2×2 tiled 4096 |

**Alternative:** Keep thin 3D "major roads only" overlay for legibility at low altitude.

---

## 6. Station Beam Normalization (Corrected)

### Problem

Station intensities cluster in 0.8–1.0 range. Linear mapping gives only 70m height variation.

### Solution: Percentile Normalization + Ease-Out Curve

#### Step 1: Percentile-based Normalization

```typescript
function normalizeIntensities(stations: StationData[]): void {
  // Collect ALL intensity values
  const allValues: number[] = [];
  for (const station of stations) {
    allValues.push(...station.intensities);
  }

  // Sort for percentile calculation
  allValues.sort((a, b) => a - b);

  // Use p5 and p95 to handle outliers
  const p5 = allValues[Math.floor(allValues.length * 0.05)];
  const p95 = allValues[Math.floor(allValues.length * 0.95)];
  const range = p95 - p5;

  if (range <= 0) return;

  // Renormalize to [0, 1] with clamping
  for (const station of stations) {
    station.intensities = station.intensities.map(v => {
      const normalized = (v - p5) / range;
      return Math.max(0, Math.min(1, normalized));
    });
  }
}
```

#### Step 2: Ease-Out Curve (Corrected)

**Wrong (original):** `f(x) = x^0.5` — this expands low/mid values, compresses high end.

**Correct (ease-out):** `f(x) = 1 - (1-x)^p` with p > 1 — this expands differences near 1.

```typescript
const BEAM_PARAMS = {
  minHeight: 50,
  maxHeight: 350,
  minOpacity: 0.4,
  maxOpacity: 0.95,
  easeOutPower: 2.0,  // p > 1 expands high end
};

function easeOut(x: number, power: number): number {
  // f(0) = 0, f(1) = 1, derivative at 1 is higher
  return 1 - Math.pow(1 - x, power);
}

function getBeamHeight(normalizedIntensity: number): number {
  const curved = easeOut(normalizedIntensity, BEAM_PARAMS.easeOutPower);
  return BEAM_PARAMS.minHeight +
    curved * (BEAM_PARAMS.maxHeight - BEAM_PARAMS.minHeight);
}

function getBeamOpacity(normalizedIntensity: number): number {
  const curved = easeOut(normalizedIntensity, BEAM_PARAMS.easeOutPower);
  return BEAM_PARAMS.minOpacity +
    curved * (BEAM_PARAMS.maxOpacity - BEAM_PARAMS.minOpacity);
}
```

#### Effect of ease-out with p=2

| Input | Output | Effect |
|-------|--------|--------|
| 0.0 | 0.0 | — |
| 0.25 | 0.44 | Low values stretched |
| 0.5 | 0.75 | Mid values stretched |
| 0.75 | 0.94 | High values preserved |
| 1.0 | 1.0 | — |

Now values that were clustered at 0.75–1.0 (after percentile normalization) will spread across 0.94–1.0 in the curve, giving visible height differences.

#### Validation: Histogram Check

```typescript
function validateNormalization(before: number[], after: number[]): void {
  const beforeStdDev = stdDev(before);
  const afterStdDev = stdDev(after);

  console.log(`Before: mean=${mean(before).toFixed(3)}, stdDev=${beforeStdDev.toFixed(3)}`);
  console.log(`After: mean=${mean(after).toFixed(3)}, stdDev=${afterStdDev.toFixed(3)}`);

  // After should have higher variance
  if (afterStdDev <= beforeStdDev) {
    console.warn('WARNING: Normalization did not increase variance');
  }
}
```

---

## 7. Parameter Summary

### Traffic Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `MAX_VEHICLES` | 2000 | GPU budget at 60fps |
| `SPAWN_MULTIPLIER` | 7.5 | Targets ~1500 steady-state |
| `LOAD_SOFT_CAP` | 0.7 | Start throttling at 1400 |
| `LOAD_HARD_CAP` | 0.95 | Hard stop at 1900 |
| `TRIP_LENGTH_MEAN` | 800m | ~2-3 Manhattan blocks |
| `TRIP_LENGTH_MIN` | 200m | At least one segment |
| `TRIP_LENGTH_MAX` | 2500m | Reasonable upper bound |
| `SNAP_RADIUS` | 10m | Node clustering tolerance |
| `ANGLE_THRESHOLD` | 60° | Connectivity (reduced from 120°) |
| `HEADING_PREFERENCE` | 45° | Straight-ahead bonus threshold |
| `LOCAL_ROAD_PROB` | 0.15 | 15% chance for minor roads |
| `MAX_TRANSITIONS_PER_FRAME` | 5 | Loop safety |

### Route Cache Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `ROUTES_PER_ENTRY` | 25 | Balance variety vs memory |
| `LENGTH_BUCKETS` | [300, 600, 1000, 1500, 2200] | Cover trip length distribution |
| `MAX_ROUTE_SEGMENTS` | 50 | Safety limit per route |
| Estimated cache size | ~2 MB | 400 entries × 25 routes |

### Station Beam Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `minHeight` | 50m | Visible but subtle |
| `maxHeight` | 350m | Dramatic for peaks |
| `minOpacity` | 0.4 | Low activity still visible |
| `maxOpacity` | 0.95 | High activity near-solid |
| `easeOutPower` | 2.0 | Expand high-end differences |
| Percentile range | p5–p95 | Robust to outliers |

---

## 8. Phase Breakdown

### Phase 1: Schema + Preprocessing + Validation

**Tasks:**

1. Write `scripts/augment_road_segments.py`:
   - Build node set via endpoint clustering (SNAP_RADIUS=10m)
   - Assign `startNodeId` / `endNodeId` to segments
   - Compute `lengthMeters`, `startHeadingDeg`, `endHeadingDeg`
   - Build successors with angle check (ANGLE_THRESHOLD=60°)
   - Compute predecessors as inverse of successors
   - Classify `isMajor` and `isEntry`
   - Write `road_segments_v2.json` and `road_nodes.json`

2. Write `scripts/validate_road_graph.py`:
   - Connected components analysis
   - Dead-end rate (interior vs boundary)
   - Reachability from entry set
   - Output validation report

3. Write `scripts/generate_route_cache.py`:
   - Load validated `road_segments_v2.json`
   - Generate 25 route templates per entry segment
   - Target 5 length buckets (300, 600, 1000, 1500, 2200m)
   - Validate all routes have connectivity
   - Write `route_cache.json` with graph version hash

4. **Validation criteria:**
   - [ ] Largest connected component > 90%
   - [ ] Interior dead ends < 5%
   - [ ] Reachable from entries > 85%
   - [ ] Route cache covers all entry segments
   - [ ] Average route length > 500m

**Output:** Validated `road_segments_v2.json`, `road_nodes.json`, `route_cache.json`

**Effort:** 2 days

---

### Phase 2: TrafficEngine V2

**Tasks:**

1. Update `data/types.ts`:
   - Add `RoadSegmentV2`, `RoadNode` interfaces
   - Add `VehicleStateV2` interface (with `routeTemplate`, `routeIndex`)
   - Add `RouteTemplate`, `RouteCacheFile` interfaces

2. Create `engine/TrafficEngineV2.ts`:
   - Load and validate route cache at construction
   - Implement spawn logic with route template selection
   - Implement movement with leftover-distance carry
   - Implement O(1) segment transitions via route index
   - Implement swap-remove despawn
   - Fallback to dynamic routing if cache invalid (optional)

3. Update `hooks/useDataLoader.ts`:
   - Load `road_segments_v2.json`, `road_nodes.json`, `route_cache.json`
   - Validate route cache against graph version
   - Build segment map and entry segment list

4. Update `Traffic.tsx`:
   - Use `TrafficEngineV2`
   - Add vehicle heading for rotation (optional)

5. Write `engine/TrafficEngineV2.test.ts`:
   - Test spawn only on slice transitions
   - Test load scaling at soft/hard caps
   - Test leftover distance carry across segments
   - Test route template traversal (routeIndex increments correctly)
   - Test swap-remove maintains dense array
   - Test cache validation rejects stale cache

**Validation criteria:**
- [ ] Vehicles traverse 3+ segments on average before despawn
- [ ] Active count stays below MAX_VEHICLES always
- [ ] No infinite loops in movement (MAX_TRANSITIONS honored)
- [ ] Route cache loaded and validated successfully
- [ ] All tests pass

**Effort:** 2-3 days

---

### Phase 3: Visual Tuning

**Tasks:**

1. **Basemap:**
   - Update QGIS export to include styled roads
   - Major roads: darker, wider
   - Minor roads: subtle
   - Export at 4096² (or 8192² if needed)

2. **Station beams:**
   - Implement percentile normalization in data loader
   - Update `StationBeams.tsx` with ease-out curve
   - Validate with histogram before/after

3. **Road component:**
   - Keep as debug-only (`DEBUG_SHOW_ROAD_SEGMENTS = false`)

**Validation criteria:**
- [ ] Roads visible in basemap without 3D overlay
- [ ] Beam height variance increased (stdDev check)
- [ ] Grand Central visually taller than low-activity stations

**Effort:** 1-2 days

---

### Phase 4: Performance + Calibration

**Tasks:**

1. **Profiling:**
   - Measure frame time with 2000 vehicles
   - Check for memory leaks over 10-minute run
   - Profile routing hotspots

2. **Optimizations (if needed):**
   - Pre-compute successor scores at load time
   - Use typed arrays for vehicle positions

3. **Parameter tuning:**
   - Adjust `SPAWN_MULTIPLIER` for target density
   - Adjust `TRIP_LENGTH_MEAN` for visual flow
   - Adjust `LOCAL_ROAD_PROB` for route variety

**Validation criteria:**
- [ ] Stable 60fps with 2000 vehicles
- [ ] No memory growth over 10 minutes
- [ ] Traffic flow "looks believable"

**Effort:** 1-2 days

---

## 9. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Node snapping creates bad clusters | Fragmented graph | Tune SNAP_RADIUS, visualize in QGIS |
| Too many dead ends | Vehicles despawn early | Relax ANGLE_THRESHOLD, add U-turn escape |
| Leftover distance causes teleporting | Visual glitch | Cap MAX_TRANSITIONS_PER_FRAME |
| Steady-state math wrong | Too few/many vehicles | Instrument actual steady-state, tune SPAWN_MULTIPLIER |
| Routing hotspots | All traffic on Broadway | Add per-segment congestion penalty |
| Basemap blurry at zoom | Poor readability | Use tiled approach or 8192² |

---

## 10. Validation Checklist

### Graph Quality
- [ ] Run `validate_road_graph.py`
- [ ] Largest component > 90%
- [ ] Interior dead ends < 5%
- [ ] Entry reachability > 85%
- [ ] Spot check 20 segments in QGIS

### Route Cache Quality
- [ ] All entry segments have >= 20 routes
- [ ] Average route length > 500m
- [ ] All routes pass connectivity validation
- [ ] Cache size < 3 MB
- [ ] Graph version hash matches current `road_segments_v2.json`

### Traffic Behavior
- [ ] Average segments per trip > 3
- [ ] Vehicles visually flow through corridors
- [ ] No sudden teleports at segment boundaries
- [ ] Active count stabilizes below MAX_VEHICLES

### Station Beams
- [ ] Print histogram before/after normalization
- [ ] stdDev increased after normalization
- [ ] Visual check: Grand Central >> low-activity stations

### Performance
- [ ] 60fps with MAX_VEHICLES active
- [ ] Memory stable over 10 minutes
- [ ] No GC spikes visible in profiler

---

## Appendix: Key Formulas

### Steady-State Vehicle Count
```
N_steady = (spawns_per_second) × (avg_lifetime_seconds)
         = (spawns_per_slice × slices_per_second) × (avg_trip_meters / avg_speed_mps)
```

### Ease-Out Curve
```
f(x) = 1 - (1 - x)^p    where p > 1
```

### Angle Difference (with wrap handling)
```
diff = |h1 - h2|
result = min(diff, 360 - diff)
```

### Log-Normal Trip Length
```
X ~ LogNormal(μ, σ)
E[X] = exp(μ + σ²/2)

To get mean=800:
  μ = ln(800) - σ²/2 ≈ 6.68 - 0.125 = 6.56  (for σ=0.5)
```
