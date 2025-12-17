/**
 * Parks Component
 *
 * Renders parks as green overlays above the basemap.
 * Uses Shape geometry for parks polygons loaded from parks.json.
 *
 * Per CLAUDE.md §8.3: This is a pure rendering component.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { GROUND_Y_POSITION } from '../constants/groundBounds';

// =============================================================================
// Constants
// =============================================================================

/** Parks color - faint green */
const PARKS_COLOR = '#90EE90';

/** Parks opacity */
const PARKS_OPACITY = 0.6;

/** Y offset above ground plane to prevent z-fighting */
const OVERLAY_Y_OFFSET = 0.15;

/** Render order for overlays (after ground, before buildings) */
const OVERLAY_RENDER_ORDER = 1;

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

    // Note: After rotation -90° around X, shapeY becomes -worldZ
    // So we negate Z to get correct world position
    shape.moveTo(firstPoint[0] ?? 0, -(firstPoint[1] ?? 0));
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      if (point && point.length >= 2) {
        shape.lineTo(point[0] ?? 0, -(point[1] ?? 0));
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

// =============================================================================
// Main Component
// =============================================================================

/**
 * Parks renders green overlays for NYC parks.
 *
 * Features:
 * - Green park polygons from NYC Parks data
 * - Positioned just above ground plane
 * - Transparent with moderate opacity for visibility
 */
export function Parks() {
  const parks = (parksData as ParksJson).parks;

  return (
    <group name="parks">
      {parks.map((park, index) => (
        <ParkMesh key={`park-${index}`} points={park.points} />
      ))}
    </group>
  );
}
