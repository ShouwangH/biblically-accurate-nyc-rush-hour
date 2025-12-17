/**
 * WaterParks Component
 *
 * Renders water (blue) and parks (green) as colored overlays above the basemap.
 * Uses Shape geometry for parks polygons loaded from parks.json.
 * Uses simple rectangles for water bodies.
 *
 * Per CLAUDE.md §8.3: This is a pure rendering component.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import {
  GROUND_BOUNDS,
  GROUND_Y_POSITION,
} from '../constants/groundBounds';

// =============================================================================
// Constants
// =============================================================================

/** Water color - faint blue */
const WATER_COLOR = '#B8D4E8';

/** Water opacity */
const WATER_OPACITY = 0.8;

/** Parks color - faint green */
const PARKS_COLOR = '#C8E6C8';

/** Parks opacity */
const PARKS_OPACITY = 0.8;

/** Y offset above ground plane to prevent z-fighting */
const OVERLAY_Y_OFFSET = 0.1;

/** Render order for overlays (after ground, before buildings) */
const OVERLAY_RENDER_ORDER = 0;

// =============================================================================
// Parks Data (imported at build time)
// =============================================================================

import parksData from '../assets/parks.json';

interface ParkPolygon {
  points: number[][];
  area: number;
}

interface ParksJson {
  parks: ParkPolygon[];
  metadata: {
    count: number;
  };
}

// =============================================================================
// Water Polygons (hand-defined for NYC waterways)
// =============================================================================

/**
 * Water body definitions as rectangles in local coordinates.
 * These extend beyond the visible bounds to ensure full coverage.
 */
const WATER_BODIES = [
  // Hudson River (west side)
  {
    name: 'hudson',
    // Rectangle from far west to the western edge of Manhattan
    xMin: GROUND_BOUNDS.local.xMin - 500,
    xMax: -200, // Western Manhattan shore approximately
    zMin: GROUND_BOUNDS.local.zMin - 500,
    zMax: GROUND_BOUNDS.local.zMax + 500,
  },
  // East River (east side)
  {
    name: 'east-river',
    // Rectangle from eastern Manhattan to far east
    xMin: 3800, // Eastern Manhattan shore approximately
    xMax: GROUND_BOUNDS.local.xMax + 500,
    zMin: GROUND_BOUNDS.local.zMin - 500,
    zMax: -2000, // Ends around Midtown
  },
  // NY Harbor (south)
  {
    name: 'harbor',
    // Rectangle covering southern water
    xMin: GROUND_BOUNDS.local.xMin - 500,
    xMax: GROUND_BOUNDS.local.xMax + 500,
    zMin: 200, // Southern Manhattan shore
    zMax: GROUND_BOUNDS.local.zMax + 500,
  },
];

// =============================================================================
// Sub-components
// =============================================================================

/**
 * Renders a single park polygon as a Shape mesh.
 */
function ParkMesh({ points }: { points: number[][] }) {
  const geometry = useMemo(() => {
    if (points.length < 3) return null;

    // Create shape from points (XZ plane, will be rotated)
    const shape = new THREE.Shape();
    const firstPoint = points[0];
    if (!firstPoint || firstPoint.length < 2) return null;

    shape.moveTo(firstPoint[0] ?? 0, firstPoint[1] ?? 0);
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      if (point && point.length >= 2) {
        shape.lineTo(point[0] ?? 0, point[1] ?? 0);
      }
    }
    shape.closePath();

    return new THREE.ShapeGeometry(shape);
  }, [points]);

  if (!geometry) return null;

  return (
    <mesh
      geometry={geometry}
      position={[0, GROUND_Y_POSITION + OVERLAY_Y_OFFSET, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={OVERLAY_RENDER_ORDER}
    >
      <meshBasicMaterial
        color={PARKS_COLOR}
        transparent
        opacity={PARKS_OPACITY}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Renders a water body as a simple rectangle.
 */
function WaterMesh({ xMin, xMax, zMin, zMax }: {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}) {
  const width = xMax - xMin;
  const depth = zMax - zMin;
  const centerX = (xMin + xMax) / 2;
  const centerZ = (zMin + zMax) / 2;

  return (
    <mesh
      position={[centerX, GROUND_Y_POSITION + OVERLAY_Y_OFFSET, centerZ]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={OVERLAY_RENDER_ORDER}
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial
        color={WATER_COLOR}
        transparent
        opacity={WATER_OPACITY}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * WaterParks renders colored overlays for water bodies and parks.
 *
 * Features:
 * - Blue water polygons for Hudson River, East River, NY Harbor
 * - Green park polygons from NYC Parks data
 * - Positioned just above ground plane
 * - Transparent with low opacity for subtle effect
 */
export function WaterParks() {
  const parks = (parksData as ParksJson).parks;

  return (
    <group name="water-parks">
      {/* Water bodies */}
      {WATER_BODIES.map((water) => (
        <WaterMesh
          key={water.name}
          xMin={water.xMin}
          xMax={water.xMax}
          zMin={water.zMin}
          zMax={water.zMax}
        />
      ))}

      {/* Parks */}
      {parks.map((park, index) => (
        <ParkMesh key={`park-${index}`} points={park.points} />
      ))}
    </group>
  );
}
