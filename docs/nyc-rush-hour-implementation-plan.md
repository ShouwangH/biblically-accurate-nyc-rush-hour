# Biblically Accurate Manhattan Rush Hour: Implementation Plan

> A 3D web visualization of NYC rush hour (8–9am weekday) focused on Manhattan south of 34th Street. The system renders subway lines/trains, station intensity beams, and surface traffic (taxis/FHVs) as a 60-second looping animation.

**Stack:** TypeScript, React, Vite, three.js via react-three-fiber + drei

**Last Updated:** 2025-12-15

---

## Table of Contents

1. [Overview & Scope](#overview--scope)
2. [Visual Style](#visual-style)
3. [Time Model](#time-model)
4. [Coordinate System](#coordinate-system)
5. [Data Contracts](#data-contracts)
6. [Rendering Architecture](#rendering-architecture)
7. [Animation & Controls](#animation--controls)
8. [Performance Budget](#performance-budget)
9. [Implementation Phases](#implementation-phases)
10. [Non-Goals & Guardrails](#non-goals--guardrails)
11. [Open Questions & Risks](#open-questions--risks)
12. [Dependencies](#dependencies)

---

## Overview & Scope

### Spatial Extent
- Manhattan south of 34th Street (downtown + midtown south core)
- 3D buildings only within this extent
- ~4km × 4km area

### Temporal Extent
- Single scenario: "typical weekday, 8–9am"
- Simulation loops over one hour, compressed into ~60 seconds of animation

### Modes to Visualize (v1)
| Layer | Included | Notes |
|-------|----------|-------|
| Subway tubes | ✓ | Underground glowing lines |
| Trains | ✓ | Instanced meshes moving along lines |
| Station beams | ✓ | Vertical light columns, height = intensity |
| Taxis/FHVs | ✓ | Surface traffic particles |
| Buses | ✗ | Deferred to v2 |
| Pedestrians | ✗ | Out of scope |
| Bikes/Citi Bike | ✗ | Out of scope |

### Data Strategy
- All data is **precomputed and baked** into static assets
- No live/realtime data access
- No runtime API calls

---

## Visual Style

Optimized for **projector presentation**, not just high-end monitors.

### Background & Environment
- Sky/clear color: off-white or very light desaturated grey (`#F5F5F0`)
- Fog: matches background, near=1000m, far=6000m
- No "space" or dark background

### Buildings
- Source: NYC 3D Building Model, decimated and clipped
- Geometry: **300–400k triangles** total (simple extruded massing)
- Material: untextured, light neutral grey (`#D0D0D0`)
- Slightly darker edges for silhouette readability
- No per-building textures in v1

### Subway
- Lines: glowing tubes/ribbons sitting below street level (y ≈ -15 to -30m)
- Each line has distinct hue from constrained MTA palette
- Trains: small instanced boxes; brightness/opacity encodes crowding
- Stations: vertical beams rising above street; height/brightness = intensity

### Surface Traffic
- Taxis/FHVs: small emissive boxes or points along street segments
- Color palette: warm oranges/reds for congested traffic
  - Low congestion: `#FFD700` (gold)
  - High congestion: `#FF4500` (orange-red)

### Post-Processing
- Bloom for glow effects on subway lines and station beams
- Optional vignette
- Keep base geometry and materials minimal

### Color Palette (Constrained)
| Element | Color | Hex |
|---------|-------|-----|
| Background/Fog | Warm off-white | `#F5F5F0` |
| Buildings | Light grey | `#D0D0D0` |
| Station beams | Soft blue | `#88CCFF` |
| Traffic (low) | Gold | `#FFD700` |
| Traffic (high) | Orange-red | `#FF4500` |
| Subway lines | Per MTA palette | Varies |

---

## Time Model

### Simulation Time Parameter

All layers share a single scalar:

```typescript
simulationTime ∈ [0, 1)
// 0 = 8:00am
// approaches but never equals 1 (9:00am)
// wraps: 0.9999... → 0
```

> **Contract:** `simulationTime` is a half-open interval `[0, 1)`. It never equals 1. The animation loop resets to 0 before reaching 1.

### Animation Loop
- Default: 60 real seconds = 1 simulated hour
- Clean loop: wraps from ~1 back to 0 (never hits exactly 1)
- Configurable speed multiplier (1x, 2x, 0.5x)

### Time Slices
- **N = 60 slices** (one per simulated minute, indexed 0–59)
- All station intensities, spawn rates indexed by slice
- Train positions computed parametrically from `simulationTime`

### Slice Index Computation

**Canonical formula (use everywhere):**
```typescript
const NUM_SLICES = 60;

function getSliceIndex(simulationTime: number): number {
  // Defensive clamp even though simulationTime should be [0, 1)
  return Math.min(
    Math.floor(simulationTime * NUM_SLICES),
    NUM_SLICES - 1
  );
}
```

> **Important:** This clamped formula MUST be used by all components. Do not implement slice indexing differently per layer.

### Clock Display
```typescript
const sliceIndex = getSliceIndex(simulationTime);
const clockTime = `8:${sliceIndex.toString().padStart(2, '0')}am`;
```

### Spawn Rate Model

Vehicle spawning uses a **slice-transition model**, not per-frame probability:

```typescript
// In traffic engine (called every frame)
let lastSliceIndex = -1;

function updateSpawns(simulationTime: number) {
  const currentSlice = getSliceIndex(simulationTime);

  if (currentSlice !== lastSliceIndex) {
    // Slice changed — spawn vehicles for this slice
    segments.forEach(segment => {
      const count = segment.spawnRates[currentSlice];
      for (let i = 0; i < Math.round(count); i++) {
        spawnVehicle(segment);
      }
    });
    lastSliceIndex = currentSlice;
  }
}
```

**Why not per-frame Poisson?**
- Per-frame spawning with `spawnProb = λ * dt` under-spawns by ~60x (dt ≈ 1/60)
- Slice-transition is simpler: spawn all vehicles for a slice when entering that slice
- Visually equivalent; vehicles appear in bursts at slice boundaries (imperceptible at 60fps)

**Data contract:**
- `spawnRates[i]` = expected vehicle count to spawn when entering slice `i`
- Preprocessing computes: `spawnRates[i] = pickups_in_minute_i` (no conversion needed)

---

## Coordinate System

All spatial data uses a **local Cartesian coordinate system**:

| Property | Value |
|----------|-------|
| Origin | Battery Park (40.7033° N, -74.0170° W) |
| Units | Meters |
| X axis | East (+) / West (-) |
| Y axis | Up (+) / Down (-) |
| Z axis | South (+) / North (-) |
| Extent | ~4km × ~4km |

### WGS84 Conversion

```typescript
const ORIGIN_LAT = 40.7033;
const ORIGIN_LNG = -74.0170;
const METERS_PER_DEGREE_LAT = 111320;
const METERS_PER_DEGREE_LNG = 111320 * Math.cos(ORIGIN_LAT * Math.PI / 180);

function toLocalCoords(lat: number, lng: number, elevation: number = 0): [number, number, number] {
  const x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG;
  const z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT;
  const y = elevation;
  return [x, y, z];
}
```

---

## Data Contracts

### 1. `stations.json`

Station locations and time-varying intensity data.

```typescript
interface StationData {
  id: string;                              // MTA complex ID, e.g., "A32"
  name: string;                            // e.g., "Fulton St"
  lines: string[];                         // e.g., ["A", "C", "J", "Z", "2", "3"]
  position: [number, number, number];      // [x, y, z] underground
  surfacePosition: [number, number, number]; // beam anchor at street level
  intensities: number[];                   // length N, normalized 0–1
}

interface StationsFile {
  meta: {
    timeSlices: number;                    // 60
    timeRange: [number, number];           // [0, 1]
    normalization: "global";               // ALWAYS global for v1
    maxEntriesPerSlice: number;            // e.g., 2847
    minIntensityFloor: number;             // e.g., 0.08
  };
  stations: StationData[];
}
```

**Example:**
```json
{
  "meta": {
    "timeSlices": 60,
    "timeRange": [0, 1],
    "normalization": "global",
    "maxEntriesPerSlice": 2847,
    "minIntensityFloor": 0.08
  },
  "stations": [
    {
      "id": "A32",
      "name": "Fulton St",
      "lines": ["A", "C", "J", "Z", "2", "3"],
      "position": [1250, -20, 890],
      "surfacePosition": [1250, 0, 890],
      "intensities": [0.45, 0.52, 0.61, 0.68, 0.74, 0.81]
    }
  ]
}
```

**Normalization Formula:**
```
globalMax = max(entries[s][t] for all stations s, all slices t)
intensity[s][t] = clamp(entries[s][t] / globalMax, minIntensityFloor, 1.0)
```

**Preprocessing:**
1. Source: MTA hourly ridership (turnstile counts) + GTFS `stops.txt`
2. Filter to stations within extent
3. Aggregate multiple days → "typical weekday" average
4. Interpolate hourly → 60 slices (linear)
5. Apply global normalization with floor clamp

**Expected count:** ~50–70 stations

---

### 2. `subway_lines.json`

Subway line geometry and colors.

```typescript
interface SubwayLineSegment {
  points: [number, number, number][];      // polyline vertices
}

interface SubwayLine {
  id: string;                              // e.g., "A", "1", "L"
  name: string;                            // e.g., "A Eighth Avenue Express"
  color: string;                           // hex, e.g., "#0039A6"
  glowColor: string;                       // brighter for emissive
  segments: SubwayLineSegment[];           // multiple if line forks
  depth: number;                           // y-offset, e.g., -18
}

interface SubwayLinesFile {
  lines: SubwayLine[];
}
```

**Example:**
```json
{
  "lines": [
    {
      "id": "A",
      "name": "A Eighth Avenue Express",
      "color": "#0039A6",
      "glowColor": "#1E5FD9",
      "segments": [
        {
          "points": [[1100, -18, 200], [1100, -18, 500], [1150, -18, 800]]
        }
      ],
      "depth": -18
    }
  ]
}
```

**Preprocessing:**
1. Source: MTA GTFS `shapes.txt`
2. Filter/clip to extent
3. Convert WGS84 → local coords
4. Simplify polylines (Douglas-Peucker, ~5m tolerance)
5. Assign depth per line

**Expected:** ~20 line definitions

---

### 3. `train_schedules.json`

Train runs within the simulation window.

```typescript
interface TrainRun {
  id: string;                    // unique, e.g., "A-north-001-seg0"
  lineId: string;                // references SubwayLine.id
  segmentIndex: number;          // which segment of SubwayLine.segments[]
  direction: 1 | -1;             // +1 = increasing progress, -1 = decreasing
  tEnter: number;                // simulationTime when train enters segment
  tExit: number;                 // simulationTime when train exits segment
  crowding: number;              // 0–1, average crowding
}

interface TrainSchedulesFile {
  meta: {
    interpolationMode: "linear";
  };
  trains: TrainRun[];
}
```

**Frontend Position Computation:**
```typescript
const segment = line.segments[train.segmentIndex];
const rawProgress = (simulationTime - train.tEnter) / (train.tExit - train.tEnter);
const progress = train.direction === 1 ? rawProgress : 1 - rawProgress;
const position = interpolatePolyline(segment.points, clamp(progress, 0, 1));
```

**Multi-Segment Handling:**
- Trains are defined **per-segment**
- For trains traversing multiple segments, emit multiple `TrainRun` entries
- At fork points, same physical train may appear as separate runs (acceptable for v1)

**Preprocessing:**
1. Source: GTFS `stop_times.txt` + `trips.txt`
2. Filter trips active during 8–9am in extent
3. Compute enter/exit times per segment
4. Normalize to [0,1] time range
5. Assign crowding from MTA load data or heuristic

**Expected:** ~100–200 train runs visible at any moment

---

### 4. `road_segments.json`

Street network with congestion and spawn data.

```typescript
interface RoadSegment {
  id: string;
  type: "avenue" | "street" | "highway";
  points: [number, number, number][];      // polyline at y=0
  avgSpeedMph: number;                     // 8–9am average
  freeFlowSpeedMph: number;                // uncongested baseline
  congestionFactor: number;                // avgSpeed / freeFlowSpeed
  spawnRates: number[];                    // vehicles per slice (NOT per minute)
}

interface RoadSegmentsFile {
  meta: {
    timeSlices: number;
    vehicleTypes: ["taxi", "fhv"];
  };
  segments: RoadSegment[];
}
```

**Example:**
```json
{
  "meta": {
    "timeSlices": 60,
    "vehicleTypes": ["taxi", "fhv"]
  },
  "segments": [
    {
      "id": "broadway_001",
      "type": "avenue",
      "points": [[1200, 0, 100], [1200, 0, 300], [1195, 0, 500]],
      "avgSpeedMph": 8.5,
      "freeFlowSpeedMph": 25,
      "congestionFactor": 0.34,
      "spawnRates": [2.1, 2.4, 2.8, 3.1, 3.5, 3.2]
    }
  ]
}
```

**Spawn Rate Units:**
- `spawnRates[i]` = expected vehicles to spawn when entering slice `i`
- See [Spawn Rate Model](#spawn-rate-model) for runtime behavior

**Preprocessing:**
1. Source: NYC street centerlines (LION or OSM)
2. Filter to major roads (avenues, numbered streets, FDR/West Side Hwy)
3. Clip to extent, simplify geometry
4. Source: TLC trip records (yellow + green taxi, FHV)

**Speed estimation (honest limitations):**
> TLC data provides pickup/dropoff points and trip duration, but NOT the route taken. We cannot compute true per-segment speeds without routing each trip through a road network (OSRM/Valhalla).

**Acceptable approximation for v1:**
- Define "segments" as major corridor stretches (e.g., "Broadway from Canal to Chambers")
- Map trips to corridors based on pickup/dropoff proximity
- Compute corridor-average speed: `avgSpeed = mean(trip_distance / trip_duration)` for trips with both endpoints near that corridor
- Assume uniform speed along corridor segments

**Spawn rate computation:**
- Count pickups per corridor per minute (TLC has precise pickup times)
- Distribute across segments within corridor proportionally by length
- Store as `spawnRates[i]` = vehicles entering this segment in slice `i`

**Expected:** ~100–200 corridor segments (not every street polyline)

> **Known limitation:** Speed and spawn rates are corridor-level approximations, not true per-block measurements. Visually acceptable for the "apocalyptic traffic" aesthetic.

---

### 5. `buildings.glb`

Single glTF binary with all building geometry.

**Specification:**
| Property | Value |
|----------|-------|
| Triangle count | 300–400k target, 500k max |
| Structure | Single merged mesh or 2–3 by height band |
| Textures | None |
| Materials | None (overridden at runtime) |
| Vertex colors | Optional subtle variation |
| Compression | Draco |
| File size | 3–6 MB compressed |

**Preprocessing:**
1. Source: NYC 3D Building Model (CityGML or Shapefile)
2. Clip to extent + 200m buffer
3. Decimate: Blender Decimate modifier, ratio ~0.1–0.2
4. Merge into single mesh
5. Export as Draco-compressed glTF

---

## Rendering Architecture

### Project Structure

```
src/
├── main.tsx                    # Vite entry
├── App.tsx                     # React root
├── components/
│   ├── Scene.tsx               # R3F Canvas wrapper
│   ├── Environment.tsx         # Lights, fog, sky
│   ├── Buildings.tsx           # Building mesh loader
│   ├── SubwayLines.tsx         # Tube geometries
│   ├── Trains.tsx              # Instanced train meshes
│   ├── StationBeams.tsx        # Instanced beam columns
│   ├── Traffic.tsx             # React wrapper for traffic InstancedMesh
│   ├── PostProcessing.tsx      # Bloom, vignette
│   └── UI/
│       ├── Overlay.tsx         # Clock, legend
│       └── Controls.tsx        # Play/pause, scrubber
├── engine/
│   ├── TrafficEngine.ts        # Pure TS: VehicleState[], spawn/update logic
│   └── TrainEngine.ts          # Pure TS: active train computation
├── hooks/
│   ├── useSimulationTime.ts    # Time state + animation
│   └── useDataLoader.ts        # Central data loader (see below)
├── data/
│   └── types.ts                # TypeScript interfaces
├── utils/
│   ├── coordinates.ts          # WGS84 ↔ local
│   ├── interpolation.ts        # Polyline helpers
│   └── sliceIndex.ts           # Canonical getSliceIndex()
└── assets/                     # JSON + glTF files
```

### Data Loading Strategy

**Decision:** Central loader that hydrates all data at once, then shares via context.

```typescript
// hooks/useDataLoader.ts
interface SimulationData {
  stations: StationsFile;
  subwayLines: SubwayLinesFile;
  trainSchedules: TrainSchedulesFile;
  roadSegments: RoadSegmentsFile;
  // buildings loaded separately via useGLTF
}

const DataContext = createContext<SimulationData | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SimulationData | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/assets/stations.json').then(r => r.json()),
      fetch('/assets/subway_lines.json').then(r => r.json()),
      fetch('/assets/train_schedules.json').then(r => r.json()),
      fetch('/assets/road_segments.json').then(r => r.json()),
    ]).then(([stations, subwayLines, trainSchedules, roadSegments]) => {
      setData({ stations, subwayLines, trainSchedules, roadSegments });
    });
  }, []);

  if (!data) return <LoadingScreen />;
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext)!;
```

**Why central, not per-layer?**
- Ensures all data loads before any rendering
- Single loading state to manage
- Avoids race conditions between layers
- Easier to add loading progress bar

### Engine / Component Separation

**Pattern:** Pure TypeScript "engines" for simulation logic; React components only handle rendering.

```typescript
// engine/TrafficEngine.ts
interface VehicleState {
  id: number;
  segmentId: string;
  progress: number;       // 0–1 along segment
  speed: number;          // meters per second
}

export class TrafficEngine {
  private vehicles: VehicleState[] = [];
  private pool: VehicleState[] = [];  // recycled instances
  private lastSliceIndex = -1;

  constructor(
    private segments: RoadSegment[],
    private maxVehicles: number
  ) {}

  update(simulationTime: number, dt: number): VehicleState[] {
    this.handleSpawns(simulationTime);
    this.moveVehicles(dt);
    this.removeCompletedVehicles();
    return this.vehicles;
  }

  // ... spawn/move/remove logic
}
```

```tsx
// components/Traffic.tsx
const Traffic: React.FC = () => {
  const { roadSegments } = useData();
  const engineRef = useRef<TrafficEngine>();
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    engineRef.current = new TrafficEngine(roadSegments.segments, MAX_VEHICLES);
  }, [roadSegments]);

  useFrame((_, delta) => {
    const vehicles = engineRef.current!.update(simulationTime, delta);
    updateInstancedMesh(meshRef.current!, vehicles);
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, MAX_VEHICLES]} />;
};
```

**Benefits:**
- Engine is unit-testable without React/three.js
- Clear separation: engine owns state, component owns rendering
- Easier to profile CPU (engine) vs GPU (component) separately

### Scene Component Structure

```tsx
<Canvas
  camera={{ position: [2000, 1500, 2000], fov: 45 }}
  gl={{ antialias: true, toneMapping: ACESFilmicToneMapping }}
>
  <SimulationTimeProvider>
    <Environment />
    <Buildings />
    <SubwayLines />
    <Trains />
    <StationBeams />
    <Traffic />
    <PostProcessing />
    <CameraController />
  </SimulationTimeProvider>
</Canvas>
```

### Buildings Component

Runtime material override ensures consistency regardless of glTF authoring:

```tsx
const Buildings: React.FC = () => {
  const gltf = useGLTF('/assets/buildings.glb');

  useEffect(() => {
    // Single shared material for ALL building meshes
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0xD0D0D0,
      roughness: 0.9,
      metalness: 0.0,
    });

    gltf.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).material = buildingMaterial;
      }
    });

    return () => buildingMaterial.dispose();
  }, [gltf]);

  return <primitive object={gltf.scene} />;
};
```

> **Implementation note:** All buildings share ONE material instance. This reduces GPU state changes and memory. However, mutating the material affects all buildings globally. If per-building variation is needed later (e.g., vertex colors), this pattern must change. The `useEffect` runs once on load, not per-frame.

### Instancing Strategy

| Layer | Geometry | Max Instances | Update Frequency |
|-------|----------|---------------|------------------|
| Trains | Box 20×4×4m | 300 | Every frame |
| Station beams | Cylinder | 70 | Every frame |
| Vehicles | Box 4×2×1.5m | 2000 | Every frame |

**Memory optimization:**
- Pre-allocate `Matrix4`, `Vector3`, `Color` outside render loop
- Reuse typed arrays
- Set `instancedMesh.count` to actual active count

### Subway Lines (Static)

```typescript
// Per line: TubeGeometry from CatmullRomCurve3
const curve = new THREE.CatmullRomCurve3(
  segment.points.map(p => new THREE.Vector3(...p))
);
const geometry = new THREE.TubeGeometry(curve, 64, 10, 8, false);
const material = new THREE.MeshBasicMaterial({
  color: line.glowColor,
  transparent: true,
  opacity: 0.7,
});
```

~20 draw calls for lines is acceptable; no instancing needed.

### Vehicle Spawning Logic

See [Spawn Rate Model](#spawn-rate-model) in Time Model section.

**Summary:** Use slice-transition spawning, not per-frame probability. Spawn all vehicles for a segment when entering a new time slice.

---

## Animation & Controls

### Default Behavior
- Auto-play 60-second loop on load
- Loop wraps seamlessly from 9:00am back to 8:00am

### UI Controls
- **Play/Pause button**
- **Time scrubber:** range input [0, 1]
- **Clock display:** "8:23am, typical weekday"
- **Legend:** station beams = ridership, traffic color = congestion

### Camera

**Default position:**
- Elevated oblique: `[2500, 1200, 2500]`
- Target: `[1500, 0, 1200]`
- FOV: 45°

**OrbitControls constraints:**
```typescript
{
  minDistance: 500,
  maxDistance: 5000,
  minPolarAngle: 0.2,
  maxPolarAngle: Math.PI / 2.2,  // prevent underground view
  enablePan: false,
}
```

### Camera Presets (Optional)

| Preset | Position | Target | Notes |
|--------|----------|--------|-------|
| Overview | [2500, 1500, 2500] | [1500, 0, 1200] | Default |
| Avenue dive | Animated path | Broadway | 15s transition |
| Underground | [1500, -50, 1500] | [1500, -20, 1200] | Show tubes |

### Camera vs Time Interaction

**Explicit rule:** Camera and simulation time are **independent** axes.

| Mode | Time | Camera |
|------|------|--------|
| Auto-play | Advances automatically | Follows choreography (if enabled) |
| Scrubbing | User-controlled | Stays at current position (no camera jump) |
| Manual orbit | Continues playing | User-controlled via OrbitControls |

**Implementation:**
- Camera choreography uses its own `cameraTime` that advances independently
- When user scrubs `simulationTime`, `cameraTime` does NOT jump
- User can toggle "Auto Camera" on/off; when off, OrbitControls are active
- When "Auto Camera" is on, OrbitControls are disabled

```typescript
interface CameraState {
  mode: "auto" | "manual";
  cameraTime: number;  // [0, 1), independent of simulationTime
}

// In animation loop:
if (cameraState.mode === "auto" && playing) {
  cameraState.cameraTime = (cameraState.cameraTime + dt / 60) % 1;
  applyCameraKeyframes(cameraState.cameraTime);
}
```

> **Why separate?** Scrubbing time while camera also jumps is nauseating. Users expect scrubbing to affect the simulation, not their viewpoint.

---

## Performance Budget

| Metric | Target | Hard Limit | Notes |
|--------|--------|------------|-------|
| Frame rate | 60fps | 30fps sustained | Brief dips OK |
| Frame time | < 14ms | < 33ms | |
| Draw calls | < 50 | < 100 | |
| Triangles | < 600k | < 1.2M | |
| GPU memory | < 250MB | < 500MB | |
| JS heap | < 100MB | < 200MB | |
| Initial load | < 5s | < 10s | 50Mbps |
| Bundle (JS) | < 2MB | < 3MB | |
| Assets | < 10MB | < 15MB | buildings.glb ~5MB + JSON ~3MB |

### Optimization Strategies

1. **Frustum culling:** Default in three.js; ensure correct bounding spheres
2. **Instance count management:** Only update active instances
3. **Typed array reuse:** Pre-allocate outside render loop
4. **LOD (if needed):** 2 levels for buildings based on camera distance
5. **Texture atlas:** Single atlas if any textures needed

### Qualitative Criteria
- [ ] No visible frame hitching during normal playback
- [ ] Memory stable over 10-minute continuous play
- [ ] Loads and runs on integrated GPU laptop

---

## Implementation Phases

### Phase 0: Data Contracts & Asset Preparation

**Goals:**
- Define all frontend-ready data shapes
- Establish coordinate system
- Create stub/sample data files
- Export building glTF

**Tasks:**
- [ ] Implement TypeScript interfaces for all contracts
- [ ] Create `getSliceIndex()` utility in `utils/sliceIndex.ts`
- [ ] Create coordinate conversion utility
- [ ] Generate sample JSON files (can be synthetic)
- [ ] Process and export buildings.glb
- [ ] Validate total asset size < 10MB

**Acceptance Criteria:**
- All JSON schemas documented and validated
- Sample data files load without errors
- Building glTF renders in test scene
- Coordinate converter produces correct values

**Estimated effort:** 3–5 days

---

### Phase 1: Static Scene & Environment

**Goals:**
- React + R3F scaffold
- Buildings rendering with material override
- Lighting, fog, background
- Basic camera controls

**Tasks:**
- [ ] Vite + React + R3F project setup
- [ ] Environment component (lights, fog, sky color)
- [ ] Buildings component with traverse + material override
- [ ] OrbitControls with constraints
- [ ] Verify 60fps with buildings only

**Acceptance Criteria:**
- Dev server runs, canvas renders
- Buildings render with uniform `#D0D0D0` material
- Fog creates intended atmosphere
- Camera orbits smoothly
- No console errors

**Estimated effort:** 2–3 days

---

### Phase 2: Animated Transit Layers

**Goals:**
- Simulation time system
- Subway lines as tubes
- Animated trains
- Station intensity beams
- Surface traffic particles

**Tasks:**
- [ ] SimulationTimeContext with play/pause/scrub ([0,1) range)
- [ ] `getSliceIndex()` used consistently across all layers
- [ ] Subway tube geometries (static)
- [ ] TrainEngine + Trains component with InstancedMesh
- [ ] Station beam InstancedMesh with intensity interpolation
- [ ] TrafficEngine with slice-transition spawning + vehicle pool
- [ ] Traffic component with InstancedMesh

**Acceptance Criteria:**
- Time loops [0, 1) over 60 seconds, wrapping cleanly
- Play/pause works correctly
- Subway lines glow below street level
- Trains appear/disappear at correct times
- Station beams pulse with varying height
- Vehicles spawn on slice transitions, flow along roads
- Stable 60fps with all layers
- No memory leaks over 10 minutes

**Estimated effort:** 5–7 days

---

### Phase 3: Polish & Post-Processing

**Goals:**
- Bloom for glow effects
- Camera presets/choreography
- UI overlay
- Performance profiling

**Tasks:**
- [ ] EffectComposer with Bloom
- [ ] Camera state: auto/manual mode, independent cameraTime
- [ ] Camera preset keyframes
- [ ] HTML overlay (clock, legend, controls)
- [ ] "Auto Camera" toggle in UI
- [ ] Profile and optimize hot paths
- [ ] Test on target hardware

**Acceptance Criteria:**
- Bloom visible on subway/beams
- At least 2 camera presets work
- Scrubbing time does NOT move camera
- Auto/manual camera toggle works
- UI displays correctly
- Meets performance budget
- Bundle size within limits

**Estimated effort:** 3–4 days

---

### Phase 4: Integration & Deployment

**Goals:**
- Real data integration
- Production build
- Deployment
- Projector testing

**Tasks:**
- [ ] Replace stub data with preprocessed real data
- [ ] Validate all data files
- [ ] Production Vite build
- [ ] Deploy to static hosting
- [ ] Test on projector, adjust colors if needed

**Acceptance Criteria:**
- No stub data remaining
- Build completes without errors
- Deployed and accessible
- Loads < 5 seconds
- Looks correct on projector

**Estimated effort:** 2–3 days

---

**Total estimated effort:** 15–22 days (implementation only, excluding data preprocessing)

---

## Non-Goals & Guardrails

Explicitly out of scope for v1:

| Non-Goal | Rationale |
|----------|-----------|
| Pedestrians | Complexity; minimal visual impact |
| Bikes/Citi Bike | Scope reduction |
| Buses | Deferred to v2; taxis cover surface traffic |
| Other boroughs | Would require new building data |
| Live/realtime data | All precomputed |
| Day/night modes | Single scenario only |
| Filter/explore UI | Cinematic loop, not dashboard |
| Per-building textures | Performance; minimal visual need |
| Mobile support | Not optimized, but not blocked |

---

## Open Questions & Risks

### Data Availability

| Assumption | Risk | Mitigation |
|------------|------|------------|
| MTA hourly ridership per station | Medium | Use turnstile data with interpolation |
| TLC trip data has precise coords | Low (confirmed) | None needed |
| GTFS shapes match tunnel paths | Medium | Visual approximation acceptable |
| NYC 3D building model available | Low (confirmed) | Host own copy |
| Building decimation achievable | Low | Manual cleanup if needed |

### Technical Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Too many vehicles → frame drops | Medium | Reduce MAX_VEHICLES; use Points |
| Bloom too expensive | Medium | Reduce resolution; make optional |
| Large JSON → slow load | Low | Split chunks; binary format |
| Memory leaks from instancing | Medium | Object pooling; profiling |
| Train "blink" at segment boundaries | Low | Speed masks it; could smooth in v2 with multi-segment paths |

### Visual Distortions (Documented)

| Distortion | Cause | Acceptability |
|------------|-------|---------------|
| Low-ridership stations over-represented | 0.08 floor clamp makes tiny stations visible | Acceptable; tradeoff for "no invisible beams" |
| Trains snap at forks | Per-segment runs don't stitch across boundaries | Acceptable at animation speed |
| Corridor-level speeds, not per-block | TLC data lacks routing | Acceptable; visually indistinguishable |

### UX Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Colors don't read on projector | High | Test early; high-contrast fallback |
| Animation too fast/slow | Medium | Configurable speed |
| Legend not visible at distance | Medium | Large fonts; high contrast |
| Underground hard to perceive | Medium | Increase tube brightness |

### Decisions Made

| Issue | Decision | Rationale |
|-------|----------|-----------|
| Station normalization | Global with 0.08 floor | Preserve relative scale |
| Train multi-segment | Per-segment runs | Simple; visual discontinuity acceptable |
| Spawn rate units | Vehicles per slice, spawn on slice transition | Avoids per-frame under-spawning |
| simulationTime range | [0, 1) half-open | Prevents OOB slice index |
| Road segment granularity | Corridor-level, not per-block | TLC data lacks routing info |
| Camera vs scrubbing | Independent axes | Prevent nauseating camera jumps |
| Data loading | Central loader, all at once | Single loading state, no races |
| Engine/component split | Pure TS engines + React renderers | Testability, profiling separation |
| Building triangles | 300–400k | Balance detail vs performance |
| Bundle size | 2MB target, 3MB max | Realistic with three.js |
| Assets budget | 10MB target | Room for buildings.glb + JSON |
| Bus layer | Cut from v1 | Scope reduction |

---

## Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "three": "^0.160.0",
    "@react-three/fiber": "^8.15.0",
    "@react-three/drei": "^9.90.0",
    "@react-three/postprocessing": "^2.15.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "@types/three": "^0.160.0"
  }
}
```

---

## Revision History

| Date | Changes |
|------|---------|
| 2025-12-15 | Initial plan |
| 2025-12-15 | Rev 1: global normalization, per-segment trains, spawn rate units, realistic perf targets, building tri budget, cut buses from v1 |
| 2025-12-15 | Rev 2: simulationTime as [0,1) half-open interval, slice-transition spawn model (not per-frame Poisson), honest TLC speed limitations (corridor-level only), camera/time independence, shared building material documented, engine/component separation, central data loading, visual distortions table, assets budget → 10MB |
