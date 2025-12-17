# Ground Layer & Building Shading: Implementation Plan

## Overview

This document describes the implementation plan for two visual enhancements:

1. **Ground Layer** — A stylized, screenprint-style raster texture on a ground plane providing visual context (water, neighborhoods, roads, parks)
2. **Building Shading** — Height-based vertex color banding for subtle depth variation

**Design goals:**
- Scene reads clearly as "lower Manhattan"
- Ground layer is visually subordinate to subway + station + traffic layers
- Cheap to render, easy to maintain
- Stylized aesthetic, NOT photorealistic

**What we are NOT doing:**
- Satellite/ortho imagery
- Per-building textures or detailed facades
- 3D trees, labels, POIs, or busy map symbology
- Complex multi-layer ground textures

---

## 1. Ground Layer

### 1.1 Visual Design

**Layer composition (bottom to top):**

| Layer | Color | Notes |
|-------|-------|-------|
| Water | `#D8DDE0` | Pale blue-grey |
| Land base | `#F0EDE8` | Off-white, slightly warmer than scene background |
| Neighborhoods | See below | 6 zones, very low saturation |
| Parks | `#E4E8E4` @ 40% | Subtle green-grey tint overlay |
| Major roads | `#C8C8C8` | 2-3px stroke at 4096 resolution |

**Neighborhood zones:**

| Zone | Approximate Area | Color |
|------|------------------|-------|
| Financial District | South of Fulton St | `#E8E8E4` (warm grey) |
| Battery Park / WTC | Southwest corner | `#E6E8E8` (cool grey) |
| Tribeca | West side, Canal to Chambers | `#E7E6E5` (neutral) |
| Chinatown / LES | East of Broadway, south of Houston | `#E9E7E4` (warm) |
| SoHo / NoHo | Canal to Houston, west of Bowery | `#E5E7E8` (cool) |
| East Village / Gramercy | North of Houston, east side | `#E6E7E6` (green-grey) |

**Color rationale:**
- All values in `#E5-E9` range (90-91% lightness, very low saturation)
- Subtle hue shifts: warm greys for southern/financial areas, cool greys for waterfront
- No hard edges between zones — colors differentiate but don't create visual boundaries

**Road selection:**
- Avenues only (Broadway, West St, FDR, etc.)
- Key cross-streets: Canal St, Houston St, 14th St, 23rd St, 34th St
- No minor streets or labels

**Parks included:**
- Battery Park
- City Hall Park
- Washington Square Park
- Union Square Park
- Madison Square Park

### 1.2 Data Sources

| Layer | Source | Format |
|-------|--------|--------|
| Coastline/Water | NYC Open Data: Shoreline | Shapefile |
| Major Roads | NYC Open Data: LION Street Centerlines | Shapefile |
| Parks | NYC Open Data: Parks Properties | GeoJSON |
| Neighborhoods | Manual polygons (6 hand-drawn zones) | GeoJSON |

**Filter for LION roads:**
```
RW_TYPE = 1 AND (
  StreetWidt >= 60 OR
  Street IN ('BROADWAY', 'CANAL ST', 'HOUSTON ST', ...)
)
```

### 1.3 Geographic Bounds

**WGS84 bounding box:**

| Edge | Value | Rationale |
|------|-------|-----------|
| West | -74.025 | Beyond westernmost road segment |
| East | -73.965 | Beyond easternmost station |
| South | 40.698 | South of Battery Park |
| North | 40.758 | Past 34th Street |

**Corresponding local coordinates:**

Using origin at Battery Park (40.7033, -74.017):

| Edge | WGS84 | Local (meters) |
|------|-------|----------------|
| West | -74.025 | X = -670 → round to -700 |
| East | -73.965 | X = 4358 → round to 4400 |
| South | 40.698 | Z = 590 → round to 600 |
| North | 40.758 | Z = -6095 → round to -6200 |

**Final bounds:**
- Local: `X: [-700, 4400], Z: [-6200, 600]`
- Dimensions: 5100m × 6800m

### 1.4 QGIS Workflow

**Step 1: Project setup**
```
Project CRS: EPSG:4326 (WGS84)
Canvas extent: -74.025, 40.698, -73.965, 40.758
```

**Step 2: Load and style layers**

1. **Water layer (shoreline)**
   - Load NYC Shoreline shapefile
   - Invert to create water polygon (everything outside shoreline)
   - Style: Fill `#D8DDE0`, no stroke

2. **Land layer**
   - Create rectangle covering full extent
   - Style: Fill `#F0EDE8`
   - Layer order: below water (water masks land)

3. **Neighborhoods**
   - Create new polygon layer
   - Draw 6 polygons matching zones above
   - Style: Categorized by zone name, colors from table above
   - No stroke on polygons

4. **Parks**
   - Load NYC Parks Properties
   - Filter to extent
   - Style: Fill `#E4E8E4`, opacity 40%

5. **Roads**
   - Load LION centerlines
   - Filter to major roads (see filter above)
   - Style: Line `#C8C8C8`, width 0.0004 degrees (~3px at 4096)

**Step 3: Export**

```
Export method: Project > Import/Export > Export Map to Image

Settings:
  Extent: -74.025, 40.698, -73.965, 40.758
  Resolution: 4096 x 4096 pixels
  Format: PNG (24-bit RGB)
  ✓ Append georeference information (world file)
```

### 1.5 Output Artifacts

| File | Purpose | Location |
|------|---------|----------|
| `ground_map.png` | 4096×4096 RGB texture | `public/assets/` |
| `ground_map.pgw` | World file (georeferencing) | `public/assets/` |
| `ground_map.json` | Metadata for runtime | `public/assets/` |

**Metadata file structure:**
```json
{
  "wgs84Bounds": {
    "west": -74.025,
    "east": -73.965,
    "south": 40.698,
    "north": 40.758
  },
  "localBounds": {
    "xMin": -700,
    "xMax": 4400,
    "zMin": -6200,
    "zMax": 600
  },
  "resolution": [4096, 4096],
  "generatedAt": "2025-XX-XX"
}
```

---

## 2. 3D Integration

### 2.1 Coordinate Conversion

The ground texture maps 1:1 to a plane in local coordinates:

```typescript
// From ground_map.json
const bounds = {
  xMin: -700,
  xMax: 4400,
  zMin: -6200,  // North (more negative = further north)
  zMax: 600     // South
};

// Plane dimensions
const width = bounds.xMax - bounds.xMin;   // 5100m
const depth = bounds.zMax - bounds.zMin;   // 6800m

// Plane center
const centerX = (bounds.xMin + bounds.xMax) / 2;  // 1850m
const centerZ = (bounds.zMin + bounds.zMax) / 2;  // -2800m
```

### 2.2 GroundPlane Component

**File:** `src/components/GroundPlane.tsx`

**Props:**
```typescript
interface GroundPlaneProps {
  textureUrl?: string;  // default: '/assets/ground_map.png'
  bounds?: {            // default: from ground_map.json
    xMin: number;
    xMax: number;
    zMin: number;
    zMax: number;
  };
}
```

**Responsibilities:**
1. Load texture with `useTexture` (drei)
2. Apply correct texture filtering (see 4.2)
3. Create `PlaneGeometry` with computed dimensions
4. Position at `y = -0.5` (below roads, avoid z-fighting)
5. Rotate to lie flat (`rotation-x={-Math.PI / 2}`)
6. Use `MeshBasicMaterial` (no lighting on ground)

**UV mapping note:**
- PlaneGeometry default UVs: (0,0) at bottom-left, (1,1) at top-right
- PNG image: (0,0) at top-left
- Solution: Set `texture.flipY = false` before applying

### 2.3 Scene Integration

**Add to Scene.tsx:**
```tsx
<Scene>
  <CameraController />
  <GroundPlane />        {/* NEW - render first (behind everything) */}
  <Buildings />
  <SubwayLines />
  <RoadSegments />
  <Trains />
  <StationBeams />
  <Traffic />
  <PostProcessing />
</Scene>
```

---

## 3. Building Shading

### 3.1 Current State

**Material settings ([Buildings.tsx](../src/components/Buildings.tsx)):**
```typescript
const BUILDING_MATERIAL_PROPS = {
  color: '#D0D0D0',
  roughness: 0.8,
  metalness: 0.1,
  flatShading: false,
  side: THREE.DoubleSide,
};
```

These settings are correct and will be retained.

### 3.2 Height-Based Vertex Colors

**Goal:** Subtle greyscale gradient based on height to add visual depth.

**Gradient design:**
```
Height      Lightness    Hex        Effect
─────────────────────────────────────────
0m          0.745        #BEBEBE    Base slightly darker
50m         0.845        #D7D7D7    Mid-height lightest
200m+       0.785        #C8C8C8    Tall tops slightly darker
```

**Algorithm:** Parabolic curve — darker at extremes, lighter in middle:
```python
t = clamp(height / 200.0, 0, 1)
lightness = 0.745 + 0.10 * (1 - (2*t - 1)^2)
```

This creates:
- t=0 (ground): `0.745 + 0.10 * (1 - 1) = 0.745`
- t=0.5 (100m): `0.745 + 0.10 * (1 - 0) = 0.845`
- t=1 (200m+): `0.745 + 0.10 * (1 - 1) = 0.745`

### 3.3 Blender Processing Script

**File:** `scripts/apply_vertex_colors.py`

**Usage:**
```bash
blender --background --python scripts/apply_vertex_colors.py -- \
  --input assets/buildings_raw.glb \
  --output public/assets/buildings.glb
```

**Script logic:**
```python
import bpy
import math

def apply_height_gradient(obj):
    mesh = obj.data

    # Create vertex color layer if not exists
    if not mesh.vertex_colors:
        mesh.vertex_colors.new(name="Col")

    color_layer = mesh.vertex_colors["Col"]

    # Get bounding box for height normalization
    # Note: Blender uses Z-up, our export converts to Y-up
    max_height = 200.0  # Cap at 200m

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert_idx = mesh.loops[loop_idx].vertex_index
            vert = mesh.vertices[vert_idx]

            # Height is Z in Blender (before Y-up conversion)
            height = max(0, vert.co.z)
            t = min(height / max_height, 1.0)

            # Parabolic gradient
            lightness = 0.745 + 0.10 * (1 - (2*t - 1)**2)

            color_layer.data[loop_idx].color = (
                lightness, lightness, lightness, 1.0
            )

    mesh.update()

# Apply to all mesh objects
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        apply_height_gradient(obj)

# Export
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    export_colors=True
)
```

### 3.4 Runtime Material Update

**Change in Buildings.tsx:**
```typescript
const buildingMaterial = useMemo(
  () =>
    new THREE.MeshStandardMaterial({
      color: BUILDING_MATERIAL_PROPS.color,
      roughness: BUILDING_MATERIAL_PROPS.roughness,
      metalness: BUILDING_MATERIAL_PROPS.metalness,
      flatShading: BUILDING_MATERIAL_PROPS.flatShading,
      side: THREE.DoubleSide,
      vertexColors: true,  // NEW: enable vertex color blending
    }),
  []
);
```

---

## 4. Performance Considerations

### 4.1 Texture Memory

| Resolution | Memory (RGB) | Recommendation |
|------------|--------------|----------------|
| 2048×2048 | ~12 MB | Minimum viable |
| 4096×4096 | ~48 MB | **Selected** |
| 8192×8192 | ~192 MB | Overkill |

4096×4096 provides ~1.2m/pixel — sufficient for stylized aesthetic.

### 4.2 Texture Filtering

```typescript
// In GroundPlane.tsx
const texture = useTexture('/assets/ground_map.png');

useEffect(() => {
  texture.minFilter = THREE.LinearMipmapLinearFilter;  // Trilinear
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 16;  // Or gl.capabilities.getMaxAnisotropy()
  texture.generateMipmaps = true;
  texture.flipY = false;
  texture.needsUpdate = true;
}, [texture]);
```

**Rationale:**
- Trilinear filtering prevents aliasing at distance
- High anisotropy essential for ground plane at grazing angles
- Mipmaps auto-generated to prevent moiré

### 4.3 Avoiding Visual Artifacts

| Issue | Mitigation |
|-------|------------|
| Road lines shimmer | Make lines 2-3px wide (not 1px) |
| Z-fighting with roads | Ground at y=-0.5, roads at y=0+ |
| Moiré at distance | Trilinear + mipmaps + soft edges |
| Neighborhood flicker | No hard edges between zones |

### 4.4 Vertex Color Memory

- Additional memory: ~12 bytes/vertex (RGB float)
- Typical building mesh: ~500K vertices
- Impact: ~6 MB additional — acceptable

### 4.5 Draw Call Budget

| Component | Draw Calls | Notes |
|-----------|------------|-------|
| Ground plane | 1 | MeshBasicMaterial, no lighting |
| Buildings | 1-5 | Single shared material |

**Total impact:** <5% frame time increase. Well within 60fps budget.

---

## 5. PR Roadmap

Per CLAUDE.md §8.8: PRs should be < 400 lines, focused on ONE concern, reviewable in < 30 minutes.
Per CLAUDE.md §8.7: TDD required — tests before implementation.

---

### PR 1: Ground plane bounds + types

**Branch:** `feat/ground-plane-types`

**Scope:** Define data types and constants for ground plane bounds. No rendering yet.

**Tasks:**
1. Add `GroundBounds` interface to `src/data/types.ts`
2. Add ground bounds constants to a new `src/constants/groundBounds.ts`
3. Write unit tests verifying bounds conversion math

**Tests (write first):**
```typescript
// src/utils/coordinates.test.ts (additions)
describe('ground bounds alignment', () => {
  it('converts WGS84 bounds to expected local coordinates', () => {
    const [xWest, , zSouth] = toLocalCoords(40.698, -74.025, 0);
    const [xEast, , zNorth] = toLocalCoords(40.758, -73.965, 0);

    expect(xWest).toBeCloseTo(-670, 0);
    expect(xEast).toBeCloseTo(4358, 0);
    expect(zSouth).toBeCloseTo(590, 0);
    expect(zNorth).toBeCloseTo(-6095, 0);
  });
});
```

**Files changed:**
- `src/data/types.ts` (~10 lines)
- `src/constants/groundBounds.ts` (~25 lines, new)
- `src/utils/coordinates.test.ts` (~20 lines)

**Estimated diff:** ~55 lines

---

### PR 2: GroundPlane component (solid color)

**Branch:** `feat/ground-plane-component`

**Scope:** Create GroundPlane component with solid color. Hide RoadSegments (redundant with ground texture roads).

**Tasks:**
1. Create `src/components/GroundPlane.tsx`
2. Use bounds from `groundBounds.ts` constants
3. Render PlaneGeometry with solid `#E8E8E8` color
4. Position at y=-0.5, rotate flat
5. Add to Scene.tsx (render before Buildings)
6. Hide RoadSegments by default (add `DEBUG_SHOW_ROAD_SEGMENTS` toggle)

**Tests (write first):**
```typescript
// src/components/__tests__/GroundPlane.test.tsx
describe('GroundPlane', () => {
  it('renders a plane at y=-0.5', () => { ... });
  it('has correct dimensions from bounds', () => { ... });
});
```

**Manual validation:**
- [ ] Ground visible from all camera angles
- [ ] No z-fighting with roads
- [ ] Extends to edges of building extent
- [ ] Four corners align with building extent
- [ ] RoadSegments not visible (verify Traffic still works)

**Files changed:**
- `src/components/GroundPlane.tsx` (~60 lines, new)
- `src/components/Scene.tsx` (~3 lines)
- `src/components/RoadSegments.tsx` (~5 lines, add debug toggle)
- `src/components/__tests__/GroundPlane.test.tsx` (~40 lines, new)

**Estimated diff:** ~110 lines

---

### PR 3: GIS export pipeline (offline tooling)

**Branch:** `feat/ground-map-gis`

**Scope:** QGIS project + export script for ground texture. No TypeScript changes.

**Tasks:**
1. Create `gis/ground_map.qgz` project file
2. Document layer sources and styling in `gis/README.md`
3. Draw 6 neighborhood polygons in `gis/neighborhoods.geojson`
4. Export `public/assets/ground_map.png` (4096×4096)
5. Export `public/assets/ground_map.json` (metadata)

**Files added:**
- `gis/ground_map.qgz` (QGIS project)
- `gis/neighborhoods.geojson` (~50 lines)
- `gis/README.md` (~80 lines)
- `public/assets/ground_map.png` (binary, ~2-4MB)
- `public/assets/ground_map.json` (~15 lines)

**Estimated diff:** ~145 lines (excluding binary asset)

**Note:** This PR can be worked in parallel with PR 2.

---

### PR 4: GroundPlane texture integration

**Branch:** `feat/ground-plane-texture`

**Scope:** Load and display the ground texture with correct filtering.

**Tasks:**
1. Update GroundPlane to load texture via `useTexture`
2. Apply texture filtering (trilinear, anisotropic)
3. Handle UV mapping (flipY)
4. Remove solid color fallback

**Tests:**
```typescript
// src/components/__tests__/GroundPlane.test.tsx (additions)
it('applies correct texture filtering settings', () => { ... });
```

**Manual validation:**
- [ ] Water/land boundary matches building footprints
- [ ] Neighborhoods subtly visible but not distracting
- [ ] Road hints align with RoadSegments layer
- [ ] Parks visible as subtle tint
- [ ] No moiré at any camera distance

**Files changed:**
- `src/components/GroundPlane.tsx` (~30 lines modified)
- `src/components/__tests__/GroundPlane.test.tsx` (~15 lines)

**Estimated diff:** ~45 lines

**Depends on:** PR 2, PR 3

---

### PR 5: Building vertex color script

**Branch:** `feat/building-vertex-colors-script`

**Scope:** Blender Python script for height-based vertex colors. No TypeScript changes.

**Tasks:**
1. Create `scripts/apply_vertex_colors.py`
2. Implement height gradient algorithm
3. Add CLI argument handling (input/output paths)
4. Document usage in script header
5. Re-export `public/assets/buildings.glb`

**Files changed:**
- `scripts/apply_vertex_colors.py` (~80 lines, new)
- `public/assets/buildings.glb` (binary, re-export)

**Estimated diff:** ~80 lines (excluding binary)

**Note:** This PR can be worked in parallel with PR 2-4.

---

### PR 6: Enable building vertex colors

**Branch:** `feat/building-vertex-colors-enable`

**Scope:** Enable vertex colors in Buildings component.

**Tasks:**
1. Update Buildings.tsx to set `vertexColors: true`
2. Add constant for vertex color toggle (for easy disable if needed)

**Tests:**
```typescript
// Visual regression only - verify buildings still render correctly
```

**Manual validation:**
- [ ] Building bases slightly darker
- [ ] Mid-height slightly lighter
- [ ] Tall building tops slightly darker
- [ ] Overall effect subtle
- [ ] No performance regression

**Files changed:**
- `src/components/Buildings.tsx` (~5 lines)

**Estimated diff:** ~5 lines

**Depends on:** PR 5

---

## 6. PR Dependency Graph

```
PR 1 (types/bounds)
    │
    ▼
PR 2 (solid color plane) ◄──────┐
    │                           │
    ▼                           │
PR 4 (texture integration) ◄── PR 3 (GIS export)

PR 5 (vertex color script)
    │
    ▼
PR 6 (enable vertex colors)
```

**Parallelization opportunities:**
- PR 3 and PR 5 can be done in parallel (offline tooling, no code deps)
- PR 3 can start immediately after PR 1 merges
- PR 5 can start anytime (no TypeScript dependencies)

---

## 7. File Summary

| File | Type | PR |
|------|------|-----|
| `src/data/types.ts` | Modify | 1 |
| `src/constants/groundBounds.ts` | New | 1 |
| `src/utils/coordinates.test.ts` | Modify | 1 |
| `src/components/GroundPlane.tsx` | New | 2, 4 |
| `src/components/Scene.tsx` | Modify | 2 |
| `src/components/RoadSegments.tsx` | Modify | 2 |
| `src/components/__tests__/GroundPlane.test.tsx` | New | 2, 4 |
| `gis/ground_map.qgz` | New (QGIS) | 3 |
| `gis/neighborhoods.geojson` | New | 3 |
| `gis/README.md` | New | 3 |
| `public/assets/ground_map.png` | New asset | 3 |
| `public/assets/ground_map.json` | New | 3 |
| `scripts/apply_vertex_colors.py` | New | 5 |
| `public/assets/buildings.glb` | Re-export | 5 |
| `src/components/Buildings.tsx` | Modify | 6 |

---

## 8. Risk Summary

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| 4096 vs 8192 texture | Slightly lower detail | 48MB vs 192MB; stylized look doesn't need more |
| Manual neighborhood polygons | Not authoritative boundaries | Official NTAs too complex; we need simple visual zones |
| Vertex colors vs texture atlas | Requires GLB re-export | Simpler runtime, no UV complexity |
| MeshBasicMaterial for ground | No dynamic lighting | Ground should be flat/neutral; saves GPU |
| Greyscale-only vertex colors | No color variation | Keeps buildings unified; color reserved for data layers |
| No custom shader (Level 1) | Less visual refinement | Per CLAUDE.md §1.9: no speculative features |

---

## 9. Appendix: Color Reference

### Ground Layer Palette

```
Water:          #D8DDE0  rgb(216, 221, 224)
Land:           #F0EDE8  rgb(240, 237, 232)
Roads:          #C8C8C8  rgb(200, 200, 200)
Parks:          #E4E8E4  rgb(228, 232, 228) @ 40% opacity

Neighborhoods:
  FiDi:         #E8E8E4  rgb(232, 232, 228)
  Battery/WTC:  #E6E8E8  rgb(230, 232, 232)
  Tribeca:      #E7E6E5  rgb(231, 230, 229)
  Chinatown:    #E9E7E4  rgb(233, 231, 228)
  SoHo:         #E5E7E8  rgb(229, 231, 232)
  East Village: #E6E7E6  rgb(230, 231, 230)
```

### Building Vertex Color Gradient

```
Height    Lightness   Hex
0m        0.745       #BEBEBE
50m       0.820       #D1D1D1
100m      0.845       #D7D7D7
150m      0.820       #D1D1D1
200m+     0.745       #BEBEBE
```
