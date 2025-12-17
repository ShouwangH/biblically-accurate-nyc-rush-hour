# Pseudo-Trip Traffic: PR Breakdown

Per CLAUDE.md §8.8:
- Each PR focused on ONE concern
- < 400 lines of diff (excluding tests and generated assets)
- Reviewable in < 30 minutes

---

## PR Dependency Graph

```
PR1 (types) ──┬──> PR2 (augment script) ──> PR3 (validate script) ──> PR4 (route cache script)
              │
              └──> PR5 (engine core) ──> PR6 (data loader) ──> PR7 (Traffic component)
                                                │
                                                └──> PR8 (beam normalization)
```

---

## Phase 1: Offline Preprocessing

### PR 1: Road Graph V2 Types
**Scope:** TypeScript interfaces only, no runtime changes.

**Files:**
- `src/data/types.ts` — Add new interfaces

**Changes:**
```typescript
// New interfaces to add:
interface RoadSegmentV2 { ... }
interface RoadNode { ... }
interface RoadNodesFile { ... }
interface RouteTemplate { ... }
interface RouteCacheFile { ... }
```

**Acceptance:**
- [ ] Types compile without errors
- [ ] No runtime behavior changes
- [ ] Existing tests pass

**Estimated diff:** ~100 lines

---

### PR 2: Road Segment Augmentation Script
**Scope:** Python script to transform `road_segments.json` → `road_segments_v2.json` + `road_nodes.json`

**Files:**
- `scripts/augment_road_segments.py` — New file

**Implements:**
- Node snapping via endpoint clustering (§2.1)
- Adjacency building with angle check (§2.2)
- `speedRatio` normalization (§2.3)
- `lengthMeters` computation (§2.4)
- `isMajor` classification (§2.5)
- `isEntry` classification (§2.6)
- Predecessors as inverse of successors

**Acceptance:**
- [ ] Generates valid `road_segments_v2.json`
- [ ] Generates valid `road_nodes.json`
- [ ] All segments have `startNodeId`, `endNodeId`
- [ ] `predecessors` is exact inverse of `successors`

**Estimated diff:** ~300 lines

---

### PR 3: Road Graph Validation Script
**Scope:** Python script to validate graph quality.

**Files:**
- `scripts/validate_road_graph.py` — New file

**Implements:**
- Connected components analysis (§3.1)
- Dead-end rate calculation
- Reachability from entry set
- JSON validation report output

**Acceptance:**
- [ ] Reports largest component %
- [ ] Reports interior dead-end rate
- [ ] Reports entry reachability %
- [ ] Exits non-zero if thresholds not met

**Estimated diff:** ~200 lines

---

### PR 4: Route Cache Generation Script
**Scope:** Python script to generate pre-computed routes.

**Files:**
- `scripts/generate_route_cache.py` — New file

**Implements:**
- Route simulation with length buckets (§4B.2)
- Graph version hashing
- Connectivity validation per route
- JSON output with metadata

**Acceptance:**
- [ ] Generates `route_cache.json`
- [ ] All entry segments have ≥20 routes
- [ ] All routes pass connectivity check
- [ ] Includes graph version hash

**Estimated diff:** ~250 lines

---

## Phase 2: TrafficEngine V2

### PR 5: TrafficEngineV2 Core
**Scope:** New engine class with route-based movement. No component changes yet.

**Files:**
- `src/engine/TrafficEngineV2.ts` — New file
- `src/engine/TrafficEngineV2.test.ts` — New file

**Implements:**
- Vehicle state with `routeTemplate`, `routeIndex`
- Spawn logic with route template selection (§4B.3)
- Movement with leftover-distance carry (§4.5)
- O(1) segment transitions via route index
- Swap-remove despawn (§4.7)
- Load scaling (§4.3)

**Does NOT include:**
- Data loading (uses injected data)
- Component integration

**Acceptance:**
- [ ] Unit tests for spawn logic
- [ ] Unit tests for distance carry across segments
- [ ] Unit tests for swap-remove
- [ ] Unit tests for load scaling
- [ ] No React/three.js imports

**Estimated diff:** ~350 lines (+ ~200 lines tests)

---

### PR 6: Data Loader V2 Integration
**Scope:** Load new data files, validate route cache, provide to context.

**Files:**
- `src/hooks/useDataLoader.ts` — Modify
- `src/data/types.ts` — Add `SimulationDataV2` if needed

**Implements:**
- Load `road_segments_v2.json`
- Load `road_nodes.json`
- Load `route_cache.json`
- Validate route cache against graph version (§4B.6)
- Build segment map and entry segment list
- Fallback behavior if cache invalid

**Acceptance:**
- [ ] All three files load successfully
- [ ] Cache validation runs at load time
- [ ] Warning logged if cache stale
- [ ] Context provides new data shape

**Estimated diff:** ~150 lines

---

### PR 7: Traffic Component V2
**Scope:** Switch Traffic.tsx to use TrafficEngineV2.

**Files:**
- `src/components/Traffic.tsx` — Modify
- `src/components/__tests__/Traffic.test.tsx` — Update if exists

**Implements:**
- Initialize TrafficEngineV2 with route cache
- Pass new data shape from context
- Vehicle heading for rotation (optional)

**Acceptance:**
- [ ] Vehicles render using new engine
- [ ] Vehicles traverse multiple segments visually
- [ ] No performance regression
- [ ] Existing behavior preserved for other components

**Estimated diff:** ~100 lines

---

## Phase 3: Visual Tuning

### PR 8: Station Beam Normalization
**Scope:** Percentile normalization + ease-out curve for beams.

**Files:**
- `src/hooks/useDataLoader.ts` OR `src/utils/normalization.ts` — Add normalization
- `src/components/StationBeams.tsx` — Update height/opacity mapping

**Implements:**
- Percentile-based normalization (p5–p95) (§6 Step 1)
- Ease-out curve `f(x) = 1 - (1-x)^p` (§6 Step 2)
- Updated height/opacity mapping

**Acceptance:**
- [ ] Console logs before/after stdDev
- [ ] stdDev increases after normalization
- [ ] Visual: Grand Central beam noticeably taller than low-activity stations
- [ ] Height range now 50m–350m (vs previous ~330m–400m)

**Estimated diff:** ~80 lines

---

### PR 9: Basemap Road Styling (Optional)
**Scope:** Update QGIS export to include styled roads in texture.

**Files:**
- `scripts/generate-ground-map.py` — Modify (if exists)
- `public/assets/ground_map.png` — Regenerate

**Implements:**
- Major roads: darker, wider (4-6px)
- Minor roads: subtle (2-3px)
- Color palette per §5

**Acceptance:**
- [ ] Roads visible in basemap
- [ ] 3D road overlay can be disabled
- [ ] No visual regression on other layers

**Estimated diff:** ~50 lines (script) + asset

---

## PR Summary Table

| PR | Title | Dependencies | Est. Lines | Priority |
|----|-------|--------------|------------|----------|
| 1 | Road Graph V2 Types | None | ~100 | P0 |
| 2 | Augment Script | PR1 | ~300 | P0 |
| 3 | Validate Script | PR2 | ~200 | P0 |
| 4 | Route Cache Script | PR3 | ~250 | P0 |
| 5 | TrafficEngineV2 Core | PR1 | ~350 | P0 |
| 6 | Data Loader V2 | PR4, PR5 | ~150 | P0 |
| 7 | Traffic Component V2 | PR6 | ~100 | P0 |
| 8 | Beam Normalization | PR6 | ~80 | P1 |
| 9 | Basemap Roads | None | ~50 | P2 |

**Critical path:** PR1 → PR2 → PR3 → PR4 → PR6 → PR7

**Parallel track:** PR1 → PR5 (can develop engine while scripts run)

---

## Suggested Merge Order

### Week 1: Foundation
1. **PR1** — Types (quick merge, unblocks everything)
2. **PR2** — Augment script (run, validate output)
3. **PR5** — Engine core (can develop in parallel with PR2)

### Week 2: Pipeline
4. **PR3** — Validate script (run on PR2 output)
5. **PR4** — Route cache script (run after PR3 passes)
6. **PR6** — Data loader (integrate new files)

### Week 3: Integration
7. **PR7** — Traffic component (visual validation)
8. **PR8** — Beam normalization (visual polish)
9. **PR9** — Basemap roads (if needed)

---

## Review Checklist Template

For each PR, reviewer should check:

```markdown
## Code Quality
- [ ] Follows existing patterns (CLAUDE.md §1)
- [ ] No drive-by refactors
- [ ] Types are explicit, no `any`

## Correctness
- [ ] Implements spec from PSEUDO_TRIP_TRAFFIC_PLAN.md
- [ ] Edge cases handled (dead ends, empty arrays, etc.)
- [ ] No off-by-one errors in indices

## Performance
- [ ] No allocations in hot paths (render loops)
- [ ] O(1) or O(n) complexity where expected

## Testing
- [ ] Unit tests cover happy path
- [ ] Unit tests cover at least one edge case
- [ ] Manual validation described

## Documentation
- [ ] JSDoc on public interfaces
- [ ] Assumptions documented
```

---

## Data File Checklist

Before merging PR6, ensure these files exist in `public/assets/`:

- [ ] `road_segments_v2.json` — From PR2
- [ ] `road_nodes.json` — From PR2
- [ ] `route_cache.json` — From PR4

Validation reports should show:
- [ ] Largest component > 90%
- [ ] Interior dead ends < 5%
- [ ] Entry reachability > 85%
- [ ] Route cache covers all entries
- [ ] Average route length > 500m
