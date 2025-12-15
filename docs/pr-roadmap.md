# PR Roadmap: NYC Rush Hour Visualization

> Ordered sequence of pull requests to implement the visualization. Each PR is scoped for reviewability (<400 lines diff, ~30 min review). TDD approach: tests first, then implementation.

**Methodology:**
1. Write failing tests that define the invariants
2. Implement code to make tests pass
3. PR review verifies both tests and implementation
4. No PR merges with failing tests

---

## Phase 0: Foundation

### PR 0.1: Project Scaffold

**Branch:** `feat/project-scaffold`

**Scope:**
- Vite + React + TypeScript setup
- ESLint + Prettier config
- Vitest setup
- Empty directory structure per CLAUDE.md §8.2
- Basic `package.json` with all dependencies

**Files:**
```
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .eslintrc.cjs
├── .prettierrc
├── vitest.config.ts
├── src/
│   ├── main.tsx           # minimal entry
│   ├── App.tsx            # empty shell
│   └── vite-env.d.ts
```

**Tests:** None (scaffold only)

**Acceptance:**
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts Vite
- [ ] `npm run lint` passes
- [ ] `npm run test` runs (0 tests)

**Estimated diff:** ~150 lines

---

### PR 0.2: Data Types + Validation Tests

**Branch:** `feat/data-types`

**Scope:**
- TypeScript interfaces for all data contracts
- JSON schema validation tests (ensure sample data matches types)
- Stub/sample JSON files for testing

**Files:**
```
├── src/data/types.ts                    # all interfaces
├── src/__tests__/dataContracts.test.ts  # validation tests
├── src/assets/
│   ├── stations.sample.json             # minimal valid sample
│   ├── subway_lines.sample.json
│   ├── train_schedules.sample.json
│   └── road_segments.sample.json
```

**Tests (write first):**
```typescript
// src/__tests__/dataContracts.test.ts
import { StationsFile, SubwayLinesFile, ... } from '../data/types';

describe('Data Contract Validation', () => {
  it('stations.sample.json matches StationsFile interface', () => {
    const data = require('../assets/stations.sample.json');
    expect(data.meta.timeSlices).toBe(60);
    expect(data.meta.normalization).toBe('global');
    expect(data.stations[0]).toHaveProperty('id');
    expect(data.stations[0]).toHaveProperty('intensities');
    expect(data.stations[0].intensities.length).toBe(60);
  });

  it('intensities are in valid range [0, 1]', () => {
    const data = require('../assets/stations.sample.json');
    data.stations.forEach(station => {
      station.intensities.forEach(i => {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThanOrEqual(1);
      });
    });
  });

  // ... similar for other contracts
});
```

**Acceptance:**
- [ ] All interfaces exported from `types.ts`
- [ ] Sample JSON files pass validation tests
- [ ] `npm run test` passes

**Estimated diff:** ~300 lines

---

### PR 0.3: Core Utilities + Tests

**Branch:** `feat/core-utils`

**Scope:**
- `getSliceIndex()` utility
- Coordinate conversion utilities
- Polyline interpolation utilities
- Unit tests for each

**Files:**
```
├── src/utils/sliceIndex.ts
├── src/utils/sliceIndex.test.ts
├── src/utils/coordinates.ts
├── src/utils/coordinates.test.ts
├── src/utils/interpolation.ts
├── src/utils/interpolation.test.ts
```

**Tests (write first):**
```typescript
// src/utils/sliceIndex.test.ts
import { getSliceIndex, NUM_SLICES } from './sliceIndex';

describe('getSliceIndex', () => {
  it('returns 0 for t=0', () => {
    expect(getSliceIndex(0)).toBe(0);
  });

  it('returns 59 for t approaching 1', () => {
    expect(getSliceIndex(0.999)).toBe(59);
  });

  it('never returns 60 even if t=1', () => {
    expect(getSliceIndex(1)).toBe(59);
    expect(getSliceIndex(1.5)).toBe(59);
  });

  it('returns correct slice for mid-values', () => {
    expect(getSliceIndex(0.5)).toBe(30);
    expect(getSliceIndex(0.016667)).toBe(1); // 1/60
  });
});

// src/utils/coordinates.test.ts
import { toLocalCoords, toWGS84 } from './coordinates';

describe('coordinate conversion', () => {
  it('origin maps to [0, 0, 0]', () => {
    const [x, y, z] = toLocalCoords(40.7033, -74.0170, 0);
    expect(x).toBeCloseTo(0, 1);
    expect(y).toBe(0);
    expect(z).toBeCloseTo(0, 1);
  });

  it('north of origin has negative z', () => {
    const [, , z] = toLocalCoords(40.71, -74.0170, 0);
    expect(z).toBeLessThan(0);
  });

  it('east of origin has positive x', () => {
    const [x] = toLocalCoords(40.7033, -74.01, 0);
    expect(x).toBeGreaterThan(0);
  });

  it('round-trips correctly', () => {
    const [x, y, z] = toLocalCoords(40.72, -74.00, 10);
    const [lat, lng, elev] = toWGS84(x, y, z);
    expect(lat).toBeCloseTo(40.72, 4);
    expect(lng).toBeCloseTo(-74.00, 4);
    expect(elev).toBe(10);
  });
});

// src/utils/interpolation.test.ts
import { interpolatePolyline, getPolylineLength } from './interpolation';

describe('polyline interpolation', () => {
  const line: [number, number, number][] = [
    [0, 0, 0],
    [100, 0, 0],
    [100, 0, 100],
  ];

  it('progress=0 returns first point', () => {
    const p = interpolatePolyline(line, 0);
    expect(p).toEqual([0, 0, 0]);
  });

  it('progress=1 returns last point', () => {
    const p = interpolatePolyline(line, 1);
    expect(p).toEqual([100, 0, 100]);
  });

  it('progress=0.5 returns midpoint of total length', () => {
    const p = interpolatePolyline(line, 0.5);
    expect(p[0]).toBe(100);
    expect(p[2]).toBe(0);
  });

  it('clamps progress outside [0, 1]', () => {
    expect(interpolatePolyline(line, -0.5)).toEqual([0, 0, 0]);
    expect(interpolatePolyline(line, 1.5)).toEqual([100, 0, 100]);
  });
});
```

**Acceptance:**
- [ ] All utility functions exported
- [ ] All tests pass
- [ ] No `any` types

**Estimated diff:** ~250 lines

---

## Phase 1: Static Scene

### PR 1.1: R3F Scene Shell + Environment

**Branch:** `feat/scene-shell`

**Scope:**
- Scene.tsx with Canvas setup
- Environment.tsx (lights, fog, background)
- App.tsx wiring

**Files:**
```
├── src/App.tsx
├── src/components/Scene.tsx
├── src/components/Environment.tsx
```

**Tests:**
```typescript
// src/components/__tests__/Scene.test.tsx
import { render } from '@testing-library/react';
import { Scene } from '../Scene';

describe('Scene', () => {
  it('renders without crashing', () => {
    // Note: R3F components need special test setup
    // This is a smoke test
    expect(() => render(<Scene />)).not.toThrow();
  });
});
```

**Acceptance:**
- [ ] `npm run dev` shows empty 3D canvas
- [ ] Background is off-white (#F5F5F0)
- [ ] Fog visible at distance
- [ ] No console errors

**Estimated diff:** ~150 lines

---

### PR 1.2: Data Loading Infrastructure

**Branch:** `feat/data-loader`

**Scope:**
- DataProvider context
- useData hook
- LoadingScreen component
- Integration test for data loading

**Files:**
```
├── src/hooks/useDataLoader.ts
├── src/components/LoadingScreen.tsx
├── src/__tests__/dataLoading.test.ts
```

**Tests (write first):**
```typescript
// src/__tests__/dataLoading.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { DataProvider, useData } from '../hooks/useDataLoader';

describe('DataProvider', () => {
  it('provides data after loading', async () => {
    const wrapper = ({ children }) => (
      <DataProvider>{children}</DataProvider>
    );

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current.stations).toBeDefined();
    expect(result.current.subwayLines).toBeDefined();
  });

  it('throws if useData called outside provider', () => {
    expect(() => {
      renderHook(() => useData());
    }).toThrow();
  });
});
```

**Acceptance:**
- [ ] Loading screen shows while fetching
- [ ] Data available via useData() after load
- [ ] Error boundary if fetch fails
- [ ] Tests pass

**Estimated diff:** ~200 lines

---

### PR 1.3: Buildings Component

**Branch:** `feat/buildings`

**Scope:**
- Buildings.tsx with glTF loading
- Material override via traverse
- Test placeholder glTF

**Files:**
```
├── src/components/Buildings.tsx
├── src/assets/buildings.sample.glb  # tiny test model
```

**Tests:**
```typescript
// src/components/__tests__/Buildings.test.tsx
describe('Buildings', () => {
  it('applies uniform material to all meshes', () => {
    // Integration test: load glTF, verify material
    // May require custom test renderer
  });
});
```

**Acceptance:**
- [ ] Buildings render from glTF
- [ ] All meshes have #D0D0D0 material
- [ ] No per-frame material assignment
- [ ] 60fps with test model

**Estimated diff:** ~100 lines

---

## Phase 2: Simulation Infrastructure

### PR 2.1: Simulation Time System

**Branch:** `feat/simulation-time`

**Scope:**
- useSimulationTime hook
- SimulationTimeProvider context
- Time loop with [0, 1) wrapping
- Play/pause/scrub state

**Files:**
```
├── src/hooks/useSimulationTime.ts
├── src/__tests__/simulationTime.test.ts
```

**Tests (write first):**
```typescript
// src/__tests__/simulationTime.test.ts
import { renderHook, act } from '@testing-library/react';
import { useSimulationTime, SimulationTimeProvider } from '../hooks/useSimulationTime';

describe('useSimulationTime', () => {
  it('starts at t=0', () => {
    const { result } = renderHook(() => useSimulationTime(), {
      wrapper: SimulationTimeProvider,
    });
    expect(result.current.t).toBe(0);
  });

  it('t never reaches 1', () => {
    const { result } = renderHook(() => useSimulationTime(), {
      wrapper: SimulationTimeProvider,
    });

    // Simulate time advancing to end
    act(() => {
      result.current.setTime(0.9999);
    });
    expect(result.current.t).toBeLessThan(1);

    act(() => {
      result.current.setTime(1);
    });
    expect(result.current.t).toBe(0); // wraps
  });

  it('pause stops time advancement', () => {
    const { result } = renderHook(() => useSimulationTime(), {
      wrapper: SimulationTimeProvider,
    });

    act(() => {
      result.current.pause();
    });
    expect(result.current.playing).toBe(false);
  });
});
```

**Acceptance:**
- [ ] Time advances from 0 toward 1
- [ ] Wraps cleanly at ~1 back to 0
- [ ] Play/pause works
- [ ] Scrubbing updates time
- [ ] Tests pass

**Estimated diff:** ~200 lines

---

### PR 2.2: TrainEngine + Tests

**Branch:** `feat/train-engine`

**Scope:**
- TrainEngine class (pure TS)
- Computes active trains for given simulationTime
- Unit tests for all behaviors

**Files:**
```
├── src/engine/TrainEngine.ts
├── src/engine/TrainEngine.test.ts
```

**Tests (write first):**
```typescript
// src/engine/TrainEngine.test.ts
import { TrainEngine } from './TrainEngine';
import { TrainRun } from '../data/types';

const mockTrains: TrainRun[] = [
  { id: 't1', lineId: 'A', segmentIndex: 0, direction: 1, tEnter: 0, tExit: 0.5, crowding: 0.8 },
  { id: 't2', lineId: 'A', segmentIndex: 0, direction: -1, tEnter: 0.3, tExit: 0.8, crowding: 0.5 },
];

describe('TrainEngine', () => {
  it('returns only active trains for given time', () => {
    const engine = new TrainEngine(mockTrains, mockLines);

    const active = engine.getActiveTrains(0.1);
    expect(active.map(t => t.id)).toEqual(['t1']);

    const active2 = engine.getActiveTrains(0.4);
    expect(active2.map(t => t.id)).toContain('t1');
    expect(active2.map(t => t.id)).toContain('t2');

    const active3 = engine.getActiveTrains(0.6);
    expect(active3.map(t => t.id)).toEqual(['t2']);
  });

  it('computes correct position along segment', () => {
    const engine = new TrainEngine(mockTrains, mockLines);
    const active = engine.getActiveTrains(0.25);
    const t1 = active.find(t => t.id === 't1')!;

    // t1: tEnter=0, tExit=0.5, direction=1
    // at t=0.25, progress = 0.25/0.5 = 0.5
    expect(t1.progress).toBeCloseTo(0.5);
  });

  it('reverses progress for direction=-1', () => {
    const engine = new TrainEngine(mockTrains, mockLines);
    const active = engine.getActiveTrains(0.55);
    const t2 = active.find(t => t.id === 't2')!;

    // t2: tEnter=0.3, tExit=0.8, direction=-1
    // at t=0.55, rawProgress = 0.25/0.5 = 0.5
    // reversed: 1 - 0.5 = 0.5 (same in this case)
    expect(t2.progress).toBeCloseTo(0.5);
  });

  it('returns empty array when no trains active', () => {
    const engine = new TrainEngine(mockTrains, mockLines);
    const active = engine.getActiveTrains(0.9);
    expect(active).toEqual([]);
  });
});
```

**Acceptance:**
- [ ] Engine filters trains by time window
- [ ] Progress computed correctly for both directions
- [ ] Position derived from polyline + progress
- [ ] Tests pass

**Estimated diff:** ~250 lines

---

### PR 2.3: TrafficEngine + Tests

**Branch:** `feat/traffic-engine`

**Scope:**
- TrafficEngine class (pure TS)
- Slice-transition spawning
- Vehicle movement + removal
- Object pooling

**Files:**
```
├── src/engine/TrafficEngine.ts
├── src/engine/TrafficEngine.test.ts
```

**Tests (write first):**
```typescript
// src/engine/TrafficEngine.test.ts
import { TrafficEngine } from './TrafficEngine';

const mockSegments = [
  {
    id: 's1',
    points: [[0, 0, 0], [100, 0, 0]],
    avgSpeedMph: 10,
    spawnRates: Array(60).fill(2), // 2 vehicles per slice
  },
];

describe('TrafficEngine', () => {
  it('spawns vehicles only on slice transitions', () => {
    const engine = new TrafficEngine(mockSegments, 100);

    // First update: slice 0, spawns 2
    engine.update(0.005, 0.016);
    expect(engine.getVehicleCount()).toBe(2);

    // Same slice: no new spawns
    engine.update(0.01, 0.016);
    expect(engine.getVehicleCount()).toBe(2);

    // New slice (1): spawns 2 more
    engine.update(0.02, 0.016);
    expect(engine.getVehicleCount()).toBe(4);
  });

  it('moves vehicles along segments', () => {
    const engine = new TrafficEngine(mockSegments, 100);
    engine.update(0, 0.016);

    const before = engine.getVehicles()[0].progress;
    engine.update(0.001, 1); // 1 second dt
    const after = engine.getVehicles()[0].progress;

    expect(after).toBeGreaterThan(before);
  });

  it('removes vehicles that complete their segment', () => {
    const engine = new TrafficEngine(mockSegments, 100);
    engine.update(0, 0.016);

    // Force vehicle to end
    engine.getVehicles()[0].progress = 0.99;
    engine.update(0.001, 1); // should complete

    expect(engine.getVehicleCount()).toBeLessThan(2);
  });

  it('respects max vehicle limit', () => {
    const engine = new TrafficEngine(mockSegments, 3);

    // Multiple slice transitions
    for (let i = 0; i < 10; i++) {
      engine.update(i / 60, 0.016);
    }

    expect(engine.getVehicleCount()).toBeLessThanOrEqual(3);
  });

  it('reuses pooled vehicle objects', () => {
    const engine = new TrafficEngine(mockSegments, 100);
    engine.update(0, 0.016);

    const v1 = engine.getVehicles()[0];
    v1.progress = 1.1; // force removal
    engine.update(0.001, 0.016);

    engine.update(0.02, 0.016); // new slice, spawn
    const v2 = engine.getVehicles()[engine.getVehicleCount() - 1];

    // Should reuse object (implementation detail, may skip)
  });
});
```

**Acceptance:**
- [ ] Spawns only on slice transitions
- [ ] Vehicles move at correct speed
- [ ] Completed vehicles removed
- [ ] Max limit enforced
- [ ] Tests pass

**Estimated diff:** ~350 lines

---

## Phase 3: Rendering Layers

### PR 3.1: Subway Lines Component

**Branch:** `feat/subway-lines`

**Scope:**
- SubwayLines.tsx
- TubeGeometry from polylines
- Static rendering (no animation)

**Files:**
```
├── src/components/SubwayLines.tsx
```

**Tests:** Visual only (no unit tests for static geometry)

**Acceptance:**
- [ ] Lines render below street level
- [ ] Each line has correct color
- [ ] Tube geometry follows polyline
- [ ] 60fps maintained

**Estimated diff:** ~150 lines

---

### PR 3.2: Trains Component (InstancedMesh)

**Branch:** `feat/trains-component`

**Scope:**
- Trains.tsx wiring TrainEngine to InstancedMesh
- Per-frame updates
- Crowding → color mapping

**Files:**
```
├── src/components/Trains.tsx
```

**Tests:**
```typescript
// Integration: verify train count matches engine output
```

**Acceptance:**
- [ ] Trains move along lines
- [ ] Appear/disappear at correct times
- [ ] Color reflects crowding
- [ ] 60fps with 300 instances

**Estimated diff:** ~200 lines

---

### PR 3.3: Station Beams Component

**Branch:** `feat/station-beams`

**Scope:**
- StationBeams.tsx
- InstancedMesh for beams
- Height/brightness from intensity

**Files:**
```
├── src/components/StationBeams.tsx
```

**Tests:**
```typescript
// Verify beam height scales with intensity
```

**Acceptance:**
- [ ] Beams at station locations
- [ ] Height varies with intensity over time
- [ ] Additive blending for glow
- [ ] 60fps with 70 instances

**Estimated diff:** ~200 lines

---

### PR 3.4: Traffic Component

**Branch:** `feat/traffic-component`

**Scope:**
- Traffic.tsx wiring TrafficEngine to InstancedMesh
- Color based on congestion

**Files:**
```
├── src/components/Traffic.tsx
```

**Acceptance:**
- [ ] Vehicles flow along roads
- [ ] Color gradient from gold to red
- [ ] Spawn bursts not visible (imperceptible)
- [ ] 60fps with 2000 instances

**Estimated diff:** ~200 lines

---

## Phase 4: Polish

### PR 4.1: Post-Processing

**Branch:** `feat/post-processing`

**Scope:**
- PostProcessing.tsx
- Bloom effect
- Optional vignette

**Files:**
```
├── src/components/PostProcessing.tsx
```

**Acceptance:**
- [ ] Bloom on emissive surfaces
- [ ] Subway lines glow
- [ ] Station beams ethereal
- [ ] Performance within budget

**Estimated diff:** ~100 lines

---

### PR 4.2: Camera System

**Branch:** `feat/camera`

**Scope:**
- CameraController component
- Auto/manual mode
- Independent cameraTime
- Preset keyframes

**Files:**
```
├── src/components/CameraController.tsx
├── src/components/__tests__/CameraController.test.ts
```

**Tests:**
```typescript
describe('CameraController', () => {
  it('does not move camera when scrubbing simulationTime', () => {
    // Verify camera position unchanged when t scrubbed
  });

  it('follows keyframes in auto mode', () => {
    // Verify camera interpolates through presets
  });
});
```

**Acceptance:**
- [ ] Scrubbing doesn't move camera
- [ ] Auto mode follows choreography
- [ ] Manual mode enables OrbitControls
- [ ] Toggle works correctly

**Estimated diff:** ~250 lines

---

### PR 4.3: UI Overlay

**Branch:** `feat/ui-overlay`

**Scope:**
- Overlay.tsx (clock, legend)
- Controls.tsx (play/pause, scrubber)
- CSS styling

**Files:**
```
├── src/components/UI/Overlay.tsx
├── src/components/UI/Controls.tsx
├── src/components/UI/styles.css
```

**Acceptance:**
- [ ] Clock shows correct time
- [ ] Legend explains visual encoding
- [ ] Controls work correctly
- [ ] Readable at distance

**Estimated diff:** ~200 lines

---

## Phase 5: Integration & Deployment

### PR 5.1: Real Data Integration

**Branch:** `feat/real-data`

**Scope:**
- Replace sample assets with preprocessed real data
- Validate against contracts

**Files:**
```
├── src/assets/stations.json      # real data
├── src/assets/subway_lines.json
├── src/assets/train_schedules.json
├── src/assets/road_segments.json
├── src/assets/buildings.glb
```

**Acceptance:**
- [ ] All data contract tests pass
- [ ] Visual looks correct
- [ ] Total assets < 10MB
- [ ] Load time < 5s

**Estimated diff:** ~50 lines (mostly asset swaps)

---

### PR 5.2: Production Build & Deploy

**Branch:** `feat/deploy`

**Scope:**
- Vite production config
- Asset optimization
- Deployment config (Vercel/Netlify)

**Files:**
```
├── vite.config.ts (updates)
├── vercel.json or netlify.toml
```

**Acceptance:**
- [ ] `npm run build` succeeds
- [ ] Bundle < 3MB
- [ ] Deployed and accessible
- [ ] Works on target hardware

**Estimated diff:** ~50 lines

---

## Summary

| Phase | PRs | Total Estimated Lines |
|-------|-----|----------------------|
| 0: Foundation | 3 | ~700 |
| 1: Static Scene | 3 | ~450 |
| 2: Simulation | 3 | ~800 |
| 3: Rendering | 4 | ~750 |
| 4: Polish | 3 | ~550 |
| 5: Integration | 2 | ~100 |
| **Total** | **18** | **~3350** |

**Critical path:**
```
PR 0.1 → PR 0.2 → PR 0.3 → PR 1.1 → PR 1.2 → PR 2.1
                                              ↓
                         PR 2.2 ─────────────→ PR 3.2
                         PR 2.3 ─────────────→ PR 3.4
                                              ↓
                                           PR 4.1 → PR 4.2 → PR 4.3
                                              ↓
                                           PR 5.1 → PR 5.2
```

PRs 1.3, 3.1, 3.3 can be done in parallel with the simulation work.

---

## Revision History

| Date | Changes |
|------|---------|
| 2025-12-15 | Initial roadmap |
