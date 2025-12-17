# Plan: Authentic MTA Train Data

## Goal
Replace synthetic train generation with real MTA schedule data to show authentic train patterns, including natural bunching, variable headways, and realistic density.

## Current State
- MTA API provides station arrival times (train_id, line, direction, stop_name, arrival_time)
- We have segment geometry (subway_lines.json) but no station-to-segment mapping
- Synthetic generation creates evenly-spaced trains that look artificial

---

## Architectural Context (from codebase exploration)

### Engine/Component Separation (CLAUDE.md §8.3)

```
┌─────────────────────────────────────────────────────────────┐
│                     Data Layer                               │
│  train_schedules.json → TrainRun[] (pre-computed)           │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  TrainEngine (Stateless)                     │
│  - Pure TypeScript, no React/three.js                       │
│  - getActiveTrains(t) → filters by tEnter/tExit             │
│  - Computes progress: (t - tEnter) / duration               │
│  - Computes position via interpolatePolyline()              │
│  - NO runtime collision/bunching logic                       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 Trains.tsx (Rendering Only)                  │
│  - useFrame: calls engine.getActiveTrains(t)                │
│  - Updates InstancedMesh with pre-allocated objects         │
│  - Max 300 instances, sphere geometry (6m radius)           │
│  - Color from line + crowding brightness                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Invariants

1. **TrainEngine is stateless** - computes on-demand, no state between frames
2. **Multiple trains per segment supported** - each has independent TrainRun with own tEnter/tExit
3. **Spacing is data responsibility** - engine trusts JSON, no runtime adjustment
4. **Instanced mesh pattern** - pre-allocated tempMatrix/tempColor/tempPosition
5. **Time model** - t ∈ [0, 1), direction=-1 reverses progress

### Implication for Authentic Data

**No engine changes needed.** The current architecture handles multiple trains per segment correctly. Each train gets independent position based on its progress. Bunching/spacing is controlled entirely by the tEnter/tExit times in JSON.

**The overlap filter is the issue.** Current `filter_overlapping_runs()` artificially spaces trains. For authentic data, we should:
- Remove or disable the overlap filter
- Let real MTA timing create natural bunching
- Accept that trains may visually overlap (authentic)

## Architecture Overview

```
MTA API Data                    Our Segment Data
     │                                │
     ▼                                ▼
┌─────────────┐               ┌──────────────┐
│ Station     │               │ Subway Lines │
│ Arrivals    │               │ (segments)   │
└─────────────┘               └──────────────┘
     │                                │
     └────────────┬───────────────────┘
                  ▼
         ┌───────────────────┐
         │ Station-to-Segment│
         │ Mapping           │
         └───────────────────┘
                  │
                  ▼
         ┌───────────────────┐
         │ Trip → Segment    │
         │ Traversal Times   │
         └───────────────────┘
                  │
                  ▼
         ┌───────────────────┐
         │ train_schedules   │
         │ .json             │
         └───────────────────┘
```

---

## Phase 1: Station-to-Segment Mapping

### 1.1 Enrich stations.json with segment references

**Input:**
- `stations.json` - has station names, lines, coordinates
- `subway_lines.json` - has segment polylines per line

**Output:**
- `stations.json` (enriched) - adds `segmentMapping` field:
  ```json
  {
    "name": "14 St-Union Sq",
    "lines": ["4", "5", "6", "L", "N", "Q", "R", "W"],
    "coordinates": [x, y, z],
    "segmentMapping": {
      "4": { "segmentIndex": 42, "progressAlongSegment": 0.35 },
      "5": { "segmentIndex": 42, "progressAlongSegment": 0.35 },
      "L": { "segmentIndex": 12, "progressAlongSegment": 0.80 },
      ...
    }
  }
  ```

**Algorithm:**
1. For each station, for each line it serves:
   - Find the segment whose polyline is closest to the station coordinates
   - Record segment index and progress (0-1) along that segment
2. Use spatial nearest-point-on-polyline calculation

**Script:** `scripts/map-stations-to-segments.py`

### 1.2 Create MTA stop_id → station name mapping

MTA data uses `stop_id` (e.g., "635N", "R20S"). We need to map these to our station names.

**Approach:**
- Fetch MTA stops reference data (GTFS stops.txt or API)
- Create lookup: stop_id → station_name → our station entry
- Handle variations in naming (e.g., "14 St-Union Sq" vs "14th Street")

---

## Phase 2: Trip Processing Pipeline

### 2.1 Group MTA records into trips

**Input:** Raw MTA schedule records
```json
{
  "train_id": "A20250318_067",
  "trip_id": "AFA25GEN-1037-Sunday-00_000600_1..N03R",
  "line": "1",
  "direction": "N",
  "stop_id": "137N",
  "stop_name": "Times Sq-42 St",
  "arrival_time": "2025-03-18T08:23:00",
  "stop_order": 15
}
```

**Output:** Grouped trips with station sequence
```python
{
  "trip_id": "...",
  "line": "1",
  "direction": "N",
  "stops": [
    {"stop_name": "South Ferry", "arrival": 0.12, "segment": 0, "progress": 0.0},
    {"stop_name": "Rector St", "arrival": 0.14, "segment": 2, "progress": 0.6},
    ...
  ]
}
```

### 2.2 Interpolate segment entry/exit times

For each trip, convert station arrivals to segment traversals:

```
Station A (seg 5, prog 0.3) @ t=0.10
    │
    ├── Segment 5: enter at t=0.10, exit at t=0.105 (interpolated)
    ├── Segment 6: enter at t=0.105, exit at t=0.115
    ├── Segment 7: enter at t=0.115, exit at t=0.12
    │
Station B (seg 7, prog 0.8) @ t=0.12
```

**Algorithm:**
1. For consecutive station pairs (A, B):
   - Identify all segments between A and B
   - Compute total distance across those segments
   - Distribute time proportionally based on segment lengths
2. Handle edge cases:
   - Stations on same segment
   - Gaps in segment connectivity
   - Trips starting/ending outside our bounds

### 2.3 Handle direction and segment order

- **Northbound (N):** Traverse segments in ascending order, direction=+1
- **Southbound (S):** Traverse segments in descending order, direction=-1

Map MTA direction to our traversal:
```python
if mta_direction == "N":
    segment_order = sorted(segments_between_stations)
    direction = 1
else:
    segment_order = sorted(segments_between_stations, reverse=True)
    direction = -1
```

---

## Phase 3: Data Pipeline Script

### 3.1 Main script: `scripts/fetch-train-schedules.py`

Refactored flow:
```python
def main():
    # 1. Load reference data
    stations = load_stations_with_segment_mapping()
    stop_id_map = load_stop_id_mapping()
    subway_lines = load_subway_lines()

    # 2. Fetch MTA schedule data
    records = fetch_mta_schedules(date, start_hour, end_hour)

    # 3. Group into trips
    trips = group_records_into_trips(records)

    # 4. For each trip, generate segment traversals
    train_runs = []
    for trip in trips:
        runs = trip_to_segment_runs(trip, stations, subway_lines)
        train_runs.extend(runs)

    # 5. Apply overlap filter (preserve existing logic)
    train_runs = filter_overlapping_runs(train_runs)

    # 6. Output
    write_train_schedules(train_runs)
```

### 3.2 Fallback to synthetic

Keep synthetic generation as fallback when:
- MTA API is unavailable
- Mapping data is incomplete
- User explicitly requests it (--synthetic flag)

---

## Phase 4: Validation & Testing

### 4.1 Validation checks
- Every train run has valid segment index for its line
- tEnter < tExit for all runs
- Consecutive segments in a trip have matching times (no gaps)
- Direction values match segment traversal order

### 4.2 Visual validation
- Compare train density with known rush hour patterns
- Verify trains appear at expected stations at expected times
- Check for obvious visual artifacts (jumping, wrong direction)

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/assets/stations.json` | Add `segmentMapping` field to each station |
| `scripts/map-stations-to-segments.py` | NEW - generates station-to-segment mapping |
| `scripts/fetch-train-schedules.py` | Refactor to use real trip data |
| `scripts/stop-id-mapping.json` | NEW - MTA stop_id → station name lookup |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| MTA API rate limits/downtime | Cache fetched data, fallback to synthetic |
| Station names don't match | Fuzzy matching, manual corrections |
| Some segments have no stations | Interpolate based on adjacent stations |
| Trips outside our bounds | Filter to only include relevant portions |

---

## Phase 5: Rendering & Visual Concerns

### 5.1 Train Bunching

**Architecture supports bunching natively.** From codebase exploration:
- TrainEngine computes each train's position independently
- Multiple TrainRun entries with overlapping time windows → multiple trains rendered
- No collision detection in engine (by design)
- Spacing is controlled entirely by tEnter/tExit in JSON

**Current blocker:** `filter_overlapping_runs()` in fetch-train-schedules.py artificially spreads trains.

**Solution:**
```python
# In fetch-train-schedules.py main():
if use_authentic_data:
    # Skip overlap filter - let real timing show bunching
    train_runs = train_runs  # No filter
else:
    # Synthetic data needs spacing to look reasonable
    train_runs = filter_overlapping_runs(train_runs)
```

**Visual handling options if bunching looks bad:**

| Option | Implementation | Complexity |
|--------|----------------|------------|
| A. Allow overlap | Do nothing (trains clip) | None |
| B. Y-offset bunched | Add small Y per same-segment train | Low (data gen) |
| C. Perpendicular offset | Offset sideways from track | Medium (Trains.tsx) |

**Recommendation:** Start with Option A. Real subway has two tracks anyway - visual overlap at our scale is acceptable. If jarring, add Y-offset at data generation (Phase 2), NOT in rendering component.

### 5.2 Handling Delays in Data

MTA schedule data is the *planned* schedule. Real-time delays would require GTFS-RT feed.

For now:
- Use scheduled times as-is
- Trains move at interpolated speeds between stations
- Accept that this shows "ideal" rush hour, not real-time chaos

Future enhancement: GTFS-RT integration for live delays.

### 5.3 Speed Variation

Between stations, we interpolate linearly. But real trains:
- Accelerate from stations
- Cruise at constant speed
- Decelerate into stations

**Simple approach (recommended):**
- Linear interpolation is fine for visualization
- The "error" is small at our scale

**Advanced approach (optional):**
- Use ease-in-out interpolation near stations
- More realistic but more complex

---

## Phase 6: Data Quality & Edge Cases

### 6.1 Trip ID Changes / Fragmented Trips

MTA data sometimes has:
- Trip ID changes mid-route
- Same physical train with different trip IDs
- Fragmented sequences

**Handling:**
```python
def merge_fragmented_trips(trips):
    """
    Merge trips that appear to be the same physical train.

    Heuristics:
    - Same line, same direction
    - Last station of trip A is within 1-2 stops of first station of trip B
    - Time gap < 5 minutes
    """
    # Group by (line, direction)
    # Sort by first arrival time
    # Merge if endpoints are close and times align
```

### 6.2 Missing Station Arrivals

If a trip skips stations (express, or data gap):

```
Station A (seg 5) @ t=0.10
    │
    ??? (no data for stations B, C)
    │
Station D (seg 15) @ t=0.20
```

**Handling:**
- Identify all segments between A and D
- Distribute time proportionally by segment length
- This is an approximation but visually acceptable

### 6.3 Out-of-Order Arrivals

Sometimes data has arrivals out of sequence:

```python
def clean_trip_arrivals(arrivals):
    """
    Fix out-of-order arrivals.

    - Sort by stop_order (MTA provides this)
    - If times are out of order, interpolate
    """
    arrivals.sort(key=lambda x: x['stop_order'])

    # Fix any time inversions
    for i in range(1, len(arrivals)):
        if arrivals[i]['time'] <= arrivals[i-1]['time']:
            # Interpolate from previous and next valid times
            arrivals[i]['time'] = interpolate_time(arrivals, i)
```

### 6.4 Trips Outside Time Window

Trips that start before 8:00am or end after 9:00am:

```
         |-------- Our Window --------|
    [====|====]                        <- Trip starts before, enters window
              [====]                   <- Trip fully in window
                        [====|====]    <- Trip exits window, ends after
```

**Handling:**
- Clip trips to window bounds
- A train entering mid-window appears at the boundary segment
- A train exiting mid-window disappears at the boundary segment

```python
def clip_trip_to_window(trip, t_start=0.0, t_end=1.0):
    """
    Keep only the portion of trip within simulation window.
    """
    clipped_runs = []
    for run in trip.runs:
        if run.tExit < t_start:
            continue  # Before window
        if run.tEnter > t_end:
            continue  # After window

        # Clip times
        run.tEnter = max(run.tEnter, t_start)
        run.tExit = min(run.tExit, t_end)
        clipped_runs.append(run)

    return clipped_runs
```

### 6.5 Stations Not in Our Data

Some MTA stations are outside our visualization bounds:

**Handling:**
- Skip arrivals at unmapped stations
- Interpolate between the nearest mapped stations
- Log warnings for review

### 6.6 Default Behavior Summary

| Situation | Default Behavior |
|-----------|------------------|
| Missing station arrivals | Interpolate by segment length |
| Out-of-order times | Fix using stop_order, interpolate times |
| Trip ID changes | Attempt to merge if endpoints align |
| Trip outside bounds | Clip to window, train appears/disappears at edge |
| Unknown station | Skip, interpolate between known stations |
| Bunched trains | Allow overlap (authentic) |
| API unavailable | Fall back to synthetic generation |

---

## Phase 7: Segment Geometry Overhaul (NEW - Dec 2025)

### 7.1 Problem Discovery

Investigation revealed critical issues with the current segment structure:

**Current state:**
- Segments represent **track geometry**, not station-to-station legs
- Curves are approximated as many tiny segments (4-10m each)
- Line 1: 115 segments for only 13 stations = ~9 segments per station gap
- 66% of Line 1 segments are <10m

**Resulting issues:**
- **Speed variance**: 0.1 m/s to 560 m/s on same line
- **Jittering**: Trains traverse tiny segments in sub-frame times
- **Pop-in/out**: Trains appear/disappear at segment boundaries

### 7.2 Root Cause Analysis

```
Station A ──────────────────────────────────── Station B
           ↑                              ↑
        seg0 (400m)                    seg10 (400m)

           └── seg1-9 are curve segments (4m each) ──┘
```

The GTFS timing says "A to B in 60 seconds". But the segment mapping puts:
- Station A at seg0, progress=0.0
- Station B at seg10, progress=0.0

So time gets distributed across 10 segments. But seg1-9 are tiny (4m each = 40m total) while seg0 and seg10 are large (400m each). This creates massive speed variance.

### 7.3 Proposed Solutions

#### Option A: Merge Segments (Data-Side Fix)

**Approach:**
1. Merge consecutive tiny segments into larger polyline segments
2. Remap train schedule segment indices
3. Preserve timing, just change which geometry is traversed

**Pros:** Simple, preserves existing architecture
**Cons:** Loses curve detail, still segment-based (no trip continuity)

**Implementation:**
```python
# Before: seg22-36 are 15 tiny curve segments
# After: seg5 is one merged segment with 15+ points in polyline
```

#### Option B: Station-to-Station Segments (Geometry Overhaul)

**Approach:**
1. Redefine segments as station-to-station legs
2. Each segment contains full polyline from station A to station B
3. Segment indices align with GTFS stop sequences

**Pros:** Perfect alignment with GTFS data, natural timing
**Cons:** Major data restructure, lose fine-grained control

**Example:**
```json
{
  "segments": [
    {
      "fromStation": "14 St",
      "toStation": "23 St",
      "points": [[x1,y1,z1], [x2,y2,z2], ...100+ points for curves...]
    }
  ]
}
```

#### Option C: Trip-Based Model (Architecture Change)

**Approach:**
1. Change data model from `TrainRun[]` to `Trip[]`
2. Each trip has stations with arrival times
3. Engine interpolates position along trip polyline based on time

**Data model:**
```typescript
interface Trip {
  id: string;
  lineId: string;
  direction: 1 | -1;
  stops: Array<{
    stationId: string;
    arrivalTime: number;  // [0, 1)
    position: Point3D;    // Pre-computed from station coords
  }>;
  polyline: Point3D[];    // Full route geometry
}
```

**Engine change:**
```typescript
getActiveTrains(t: number): ActiveTrain[] {
  for (const trip of this.trips) {
    // Find which station pair the train is between
    const currentStop = findCurrentStop(trip, t);
    const nextStop = trip.stops[currentStop.index + 1];

    // Interpolate along polyline segment between stations
    const progress = (t - currentStop.time) / (nextStop.time - currentStop.time);
    const position = interpolateStationToStation(trip.polyline, currentStop, nextStop, progress);

    // ...
  }
}
```

**Pros:** Natural trip continuity, easy to model delays, supports bunching
**Cons:** Requires engine rewrite, different data format

### 7.4 Recommendation

**Recommended:** Option C - Trip-based architecture (directly use GTFS trips)

The trip-based model enables:
1. **Delays:** Shift a trip's timing, all subsequent positions adjust
2. **Bunching:** When trains on same line have close arrival times at stations
3. **Continuity:** No pop-in/out, train smoothly enters and exits viewport
4. **Express trains:** Naturally skip stations in the stop list

### 7.5 Implementation Plan (Option C)

#### Data Sources Available

GTFS static feed (`http://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip`):
- `trips.txt` - 462 Line 1 weekday trips, each with shape_id
- `stop_times.txt` - 38 stops per trip with exact arrival times
- `shapes.txt` - Full route polylines (266+ points per shape)
- `stops.txt` - Stop lat/lon coordinates

#### New Data Model

```typescript
// src/data/types.ts - ADD
interface TripStop {
  stopId: string;           // GTFS stop_id (e.g., "137N")
  stationName: string;      // Human-readable name
  arrivalTime: number;      // Simulation time [0, 1)
  position: Point3D;        // Pre-computed local coords
  distanceAlongRoute: number; // Meters from trip start
}

interface Trip {
  id: string;               // GTFS trip_id
  lineId: string;           // "1", "A", etc.
  direction: 1 | -1;        // +1 = northbound, -1 = southbound
  color: string;            // Line color
  stops: TripStop[];        // Ordered stops with arrival times
  polyline: Point3D[];      // Full route geometry (from shapes.txt)
  totalLength: number;      // Total polyline length in meters

  // Viewport bounds (for efficient filtering)
  tEnter: number;           // When trip enters viewport [0, 1)
  tExit: number;            // When trip exits viewport [0, 1)
}
```

#### New Output File

`src/assets/trips.json`:
```json
{
  "meta": {
    "source": "GTFS static",
    "generated": "2025-12-17T...",
    "timeWindow": "08:00-09:00",
    "viewport": { "minX": 158, "maxX": 3766, "minZ": -5720, "maxZ": 351 }
  },
  "trips": [
    {
      "id": "AFA25GEN-1093-Weekday-00_048050_1..N03R",
      "lineId": "1",
      "direction": 1,
      "color": "#EE352E",
      "stops": [
        { "stopId": "137N", "stationName": "Times Sq-42 St", "arrivalTime": 0.075, "position": [2463, -15, -5167], "distanceAlongRoute": 1200 },
        { "stopId": "138N", "stationName": "50 St", "arrivalTime": 0.092, "position": [2463, -15, -5500], "distanceAlongRoute": 1533 }
      ],
      "polyline": [[x1,y1,z1], [x2,y2,z2], ...],
      "totalLength": 2500,
      "tEnter": 0.075,
      "tExit": 0.15
    }
  ]
}
```

#### New Script: `scripts/generate-trips.py`

```python
def main():
    # 1. Load GTFS data
    gtfs = load_gtfs()  # trips.txt, stop_times.txt, shapes.txt, stops.txt

    # 2. Define viewport bounds (our visible area)
    viewport = get_viewport_bounds()  # From subway_lines.json

    # 3. Process each trip
    trips = []
    for gtfs_trip in gtfs.trips:
        # a. Get shape polyline, convert to local coords
        shape = gtfs.shapes[gtfs_trip.shape_id]
        polyline = [toLocalCoords(pt.lat, pt.lon, -15) for pt in shape]

        # b. Get stops with times, convert positions
        stops = []
        for stop_time in gtfs.stop_times[gtfs_trip.trip_id]:
            stop = gtfs.stops[stop_time.stop_id]
            pos = toLocalCoords(stop.lat, stop.lon, -15)
            t = time_to_simulation(stop_time.arrival_time)

            # c. Find distance along polyline for this stop
            dist = find_distance_along_polyline(polyline, pos)

            stops.append({
                "stopId": stop_time.stop_id,
                "stationName": stop.name,
                "arrivalTime": t,
                "position": pos,
                "distanceAlongRoute": dist
            })

        # d. Clip to viewport - only keep stops in our area
        visible_stops = [s for s in stops if is_in_viewport(s.position, viewport)]
        if len(visible_stops) < 2:
            continue  # Trip doesn't pass through our area

        # e. Clip polyline to viewport bounds
        clipped_polyline = clip_polyline_to_viewport(polyline, viewport)

        trips.append({
            "id": gtfs_trip.trip_id,
            "lineId": gtfs_trip.route_id,
            "direction": 1 if "N" in gtfs_trip.direction else -1,
            "color": get_line_color(gtfs_trip.route_id),
            "stops": visible_stops,
            "polyline": clipped_polyline,
            "totalLength": polyline_length(clipped_polyline),
            "tEnter": visible_stops[0]["arrivalTime"],
            "tExit": visible_stops[-1]["arrivalTime"]
        })

    # 4. Output
    write_trips_json(trips)
```

#### New Engine: `src/engine/TripEngine.ts`

```typescript
export class TripEngine {
  private trips: Trip[];
  private tripCache: Map<string, CachedPolyline>;

  constructor(trips: Trip[]) {
    this.trips = trips;
    // Pre-compute polyline caches for O(log n) interpolation
    this.tripCache = new Map();
    for (const trip of trips) {
      this.tripCache.set(trip.id, buildCachedPolyline(trip.polyline));
    }
  }

  getActiveTrains(t: number): ActiveTrain[] {
    const active: ActiveTrain[] = [];

    for (const trip of this.trips) {
      // Quick bounds check
      if (t < trip.tEnter || t >= trip.tExit) continue;

      // Find which stop pair we're between
      const { prevStop, nextStop } = this.findStopPair(trip, t);
      if (!prevStop || !nextStop) continue;

      // Compute progress between stops
      const stopDuration = nextStop.arrivalTime - prevStop.arrivalTime;
      const elapsed = t - prevStop.arrivalTime;
      const progress = stopDuration > 0 ? elapsed / stopDuration : 0;

      // Interpolate position along polyline between stops
      const distStart = prevStop.distanceAlongRoute;
      const distEnd = nextStop.distanceAlongRoute;
      const currentDist = distStart + (distEnd - distStart) * progress;

      const cached = this.tripCache.get(trip.id)!;
      const position = interpolateByDistance(cached, currentDist);

      active.push({
        id: trip.id,
        lineId: trip.lineId,
        position,
        progress: currentDist / trip.totalLength,
        direction: trip.direction,
        crowding: 0.5, // TODO: from ridership data
        color: trip.color,
      });
    }

    return active;
  }

  private findStopPair(trip: Trip, t: number): { prevStop?: TripStop; nextStop?: TripStop } {
    for (let i = 0; i < trip.stops.length - 1; i++) {
      if (t >= trip.stops[i].arrivalTime && t < trip.stops[i + 1].arrivalTime) {
        return { prevStop: trip.stops[i], nextStop: trip.stops[i + 1] };
      }
    }
    return {};
  }
}
```

#### Key Architecture Changes

**Geometry Source Change:**
- **Before:** `subway_lines.json` segments (2,589 segments, many tiny 4m curves)
- **After:** GTFS `shapes.txt` polylines (266+ points per route, high-res curves)

This eliminates the segment geometry problem entirely - we use MTA's official route geometry.

**Timing Model Change:**
- **Before:** `TrainRun.tEnter/tExit` per segment, timing distributed across segments
- **After:** `Trip.stops[].arrivalTime` per station, interpolate between stations

The trip model uses station-to-station timing directly from GTFS, so there's no segment timing to remap - we're using the source data directly.

**What We Keep:**
- `subway_lines.json` - still used for rendering the track tubes (SubwayLines.tsx)
- `stations.json` - still used for station beams (StationBeams.tsx)
- Coordinate system - same origin at Battery Park
- `ActiveTrain` interface - same output format for Trains.tsx

**What We Replace:**
- `train_schedules.json` → `trips.json`
- `TrainEngine.ts` → `TripEngine.ts`

---

#### PR Breakdown

**PR 1: Trip Data Types** (< 50 lines)
- Add `Trip`, `TripStop` interfaces to `src/data/types.ts`
- No runtime changes, just types

**PR 2: Trip Generation Script** (~ 300 lines)
- Create `scripts/generate-trips.py`
- Reads GTFS data, outputs `trips.json`
- Can run independently, no app changes yet
- Include viewport clipping logic
- Include coordinate conversion (lat/lon → local)

**PR 3: TripEngine Implementation** (~ 150 lines)
- Create `src/engine/TripEngine.ts`
- Create `src/engine/TripEngine.test.ts` (TDD)
- Reuse `CachedPolyline` pattern from TrainEngine
- Tests verify interpolation correctness

**PR 4: Data Loader Integration** (~ 50 lines)
- Update `useDataLoader.ts` to load `trips.json`
- Add feature flag: `USE_TRIP_ENGINE`
- No visual changes yet

**PR 5: Trains Component Switch** (~ 30 lines)
- Update `Trains.tsx` to use TripEngine when flag enabled
- Side-by-side comparison possible
- Visual validation

**PR 6: Cleanup** (removal)
- Remove `train_schedules.json` (after validation)
- Remove `TrainEngine.ts` (after validation)
- Remove feature flag, make TripEngine default

---

#### Migration Path

```
PR1 → PR2 → PR3 → PR4 → PR5 → PR6
types   data   engine  loader  render  cleanup
         ↓
    trips.json generated
    (can validate offline)
```

Each PR is independently reviewable and testable. PRs 1-3 have no runtime impact. PR 4-5 are behind feature flag. PR 6 is cleanup after validation.

---

## Phase 8: Delays & Bunching Model (Future)

### 8.1 Delay Simulation

**Goal:** Show realistic rush-hour delays, not just scheduled times.

**Approach:**
1. Load GTFS scheduled times as baseline
2. Apply stochastic delay model based on historical patterns
3. Delays propagate: train late at station A → late at all subsequent stations

**Delay model:**
```typescript
interface DelayModel {
  // Per-station delay probability
  stationDelays: Map<stationId, {
    probability: number;     // 0-1 chance of delay
    meanDelay: number;       // seconds
    stdDev: number;          // variation
  }>;

  // System-wide events (signal problems, etc.)
  systemEvents: Array<{
    startTime: number;
    endTime: number;
    affectedLines: string[];
    delayMultiplier: number; // 1.5 = 50% slower
  }>;
}
```

### 8.2 Bunching Visualization

**Natural bunching:** When a train is delayed, the following train catches up.

**With trip-based model:**
1. Trip A departs on time
2. Trip B departs on time
3. Trip A gets delayed at station
4. Trip B catches up, both arrive at next station close together
5. Visual: Two trains visible close together

**Current model limitation:** Each TrainRun is independent, so bunching must be pre-computed in data. With trip model, bunching emerges naturally from delay propagation.

### 8.3 Data Sources for Realistic Timing

| Source | Data | Use |
|--------|------|-----|
| GTFS Static | Scheduled times | Baseline |
| GTFS-RT | Real-time delays | Live mode |
| Historical GTFS-RT | Archived delays | Realistic simulation |
| TurnstileData | Ridership | Crowding levels |

---

## Success Criteria

1. **Density**: At least 2-3x more trains visible than synthetic approach
2. **Authenticity**: Trains naturally bunch up (realistic), not evenly spaced
3. **Correctness**: Trains flow smoothly through segments without jitter
4. **Reliability**: Graceful fallback when MTA data unavailable
5. **Robustness**: Handles messy real-world data without crashing
6. **Smooth motion**: No speed variance >10x within same line (NEW)
7. **Trip continuity**: Trains don't pop in/out at segment boundaries (NEW)
