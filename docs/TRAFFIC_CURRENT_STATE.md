# Traffic & Roads: Current State Analysis

## Data Overview

### Road Segments (`road_segments.json`)
- **Total segments:** 4,785
- **Coordinate system:** Y=0 is surface level (same as buildings)
- **Spawn rates:** 0.10 to 0.45 per segment per time slice (probabilistic, < 1)
- **Average speed:** ~6-20 mph depending on congestion
- **Segment structure:** Each has 2+ points forming a polyline

### Subway Lines (`subway_lines.json`)
- **Y coordinate:** -15 to -20 (underground)
- Trains interpolate along these segments

### Stations (`stations.json`)
- **surfacePosition:** Y=0 (surface level)
- **position:** Y=-20 (underground platform level)
- **Intensities:** Array of 60 values (one per time slice), ranging ~0.8 to 1.0

---

## Current Implementation

### RoadSegments Component
- **Location:** [RoadSegments.tsx](../src/components/RoadSegments.tsx)
- **Rendering:** `<lineSegments>` with BufferGeometry
- **Y offset:** +0.5m above data points
- **Style:**
  - Color: `#444444` (dark gray)
  - Opacity: `0.3`
- **Issue:** Too subtle - nearly invisible against dark background

### Traffic Component
- **Location:** [Traffic.tsx](../src/components/Traffic.tsx)
- **Rendering:** InstancedMesh with BoxGeometry (2x1.5x4m)
- **Engine:** TrafficEngine handles spawning/movement
- **Y offset:** `VEHICLE_Y_OFFSET = 0.75m` (half vehicle height)

### TrafficEngine
- **Location:** [TrafficEngine.ts](../src/engine/TrafficEngine.ts)
- **Spawning logic:**
  - Triggers on slice transitions (every 1/60th of simulation time)
  - Spawn rate < 1: treated as probability (e.g., 0.12 = 12% chance)
  - Spawn rate >= 1: spawn floor(rate) guaranteed + fractional probability
- **Movement:** `progress += (speed * dt) / segmentLength`
- **Removal:** When `progress >= 1` (completed segment)

---

## Current Problems

### 1. Roads Not Visible
- Opacity 0.3 + dark gray (#444444) = invisible on dark background
- Need higher opacity and brighter color

### 2. Vehicles Not Moving Visibly
Current spawning model:
- 4,785 segments × 0.16 avg spawn rate = ~765 spawns per slice (probabilistic)
- Each segment is SHORT (typically 50-200m)
- At 6 mph (~2.7 m/s), a 100m segment completes in ~37 seconds real time
- With 60fps and simulation playing at 1x, vehicles traverse segments quickly

The problem: **Vehicles appear, traverse a tiny segment, disappear.**
There's no continuity - no "trip" across multiple segments.

### 3. Station Beams Too Subtle
- Opacity 0.6 + additive blending
- Heights: 10-150m based on intensity
- Intensity range 0.8-1.0 means heights are 122-150m (barely varies)
- Need more opacity and the intensity data should have more variance

---

## Spawning Model Analysis

### Current Model: Per-Segment Probabilistic
```
For each segment:
  if random() < spawnRate[slice]:
    spawn vehicle at segment start
    vehicle moves along segment
    vehicle removed when progress >= 1
```

**Pros:** Simple, data-driven
**Cons:**
- No trip continuity (vehicle doesn't continue to next segment)
- Vehicles appear/disappear constantly
- No visual "flow" of traffic

### Alternative: Trip-Based Model
```
Define trips as sequences of connected segments
Spawn vehicle at trip start
Vehicle traverses all segments in trip
Vehicle removed at trip end
```

**Pros:**
- Visual continuity
- Realistic traffic flow
- Can show actual journeys

**Cons:**
- Requires trip data (origin/destination pairs)
- More complex engine

---

## Recommended Changes

### Quick Fixes (Visibility)
1. **Roads:** Increase opacity to 0.6, color to `#666666`
2. **Station beams:** Increase opacity to 0.85, increase max height to 300m

### Architecture Changes (Traffic Flow)
Options to consider:
1. **Grid mesh** - predefined network with intersection nodes
2. **Trip routing** - spawn with full trip path, traverse multiple segments
3. **Continuous flow** - when vehicle completes segment, find connected segment and continue

---

## Data Files Summary

| File | Location | Records | Key Fields |
|------|----------|---------|------------|
| road_segments.json | public/assets/ | 4,785 segments | points, spawnRates[60], avgSpeedMph |
| stations.json | public/assets/ | ~70 stations | surfacePosition, intensities[60] |
| subway_lines.json | public/assets/ | 20 lines | segments[].points |
| train_schedules.json | public/assets/ | 32,493 runs | lineId, segmentIndex, tEnter, tExit |
