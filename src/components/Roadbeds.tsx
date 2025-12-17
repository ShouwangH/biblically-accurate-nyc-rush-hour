/**
 * Roadbeds Component
 *
 * Renders road surface polygons at ground level so vehicles
 * don't appear to be floating.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useData } from '../hooks/useDataLoader';

// =============================================================================
// Constants
// =============================================================================

/** Roadbed color (dark asphalt gray) */
const ROADBED_COLOR = '#2a2a2a';

/** Y position (slightly above ground plane to avoid z-fighting) */
const ROADBED_Y = 0.1;

// =============================================================================
// Component
// =============================================================================

/**
 * Roadbeds renders road surfaces as flat polygons.
 */
export function Roadbeds() {
  const { data } = useData();

  // Create merged geometry from all roadbed polygons
  const geometry = useMemo(() => {
    if (!data?.roadbeds?.roadbeds) return null;

    const roadbeds = data.roadbeds.roadbeds;
    const geometries: THREE.BufferGeometry[] = [];

    for (const roadbed of roadbeds) {
      if (!roadbed.points || roadbed.points.length < 3) continue;

      // Create shape from points (x, z coordinates)
      const shape = new THREE.Shape();
      const firstPt = roadbed.points[0]!;
      shape.moveTo(firstPt[0], -firstPt[1]); // Negate Z for Shape (uses Y as second coord)

      for (let i = 1; i < roadbed.points.length; i++) {
        const pt = roadbed.points[i]!;
        shape.lineTo(pt[0], -pt[1]);
      }
      shape.closePath();

      // Create geometry from shape
      const shapeGeom = new THREE.ShapeGeometry(shape);

      // Rotate to lie flat (ShapeGeometry is in XY plane, we need XZ)
      shapeGeom.rotateX(-Math.PI / 2);

      // Translate to correct Y position
      shapeGeom.translate(0, ROADBED_Y, 0);

      geometries.push(shapeGeom);
    }

    if (geometries.length === 0) return null;

    // Merge all geometries
    const merged = mergeBufferGeometries(geometries);

    // Dispose individual geometries
    geometries.forEach((g) => g.dispose());

    return merged;
  }, [data?.roadbeds]);

  // Create material
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: ROADBED_COLOR,
        roughness: 0.9,
        metalness: 0.1,
        side: THREE.DoubleSide,
      }),
    []
  );

  if (!geometry) {
    return null;
  }

  return <mesh geometry={geometry} material={material} />;
}

// =============================================================================
// Utility
// =============================================================================

/**
 * Merge multiple buffer geometries into one.
 * Simple implementation - doesn't handle indexed geometries.
 */
function mergeBufferGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const geom of geometries) {
    const posAttr = geom.getAttribute('position');
    const normAttr = geom.getAttribute('normal');

    if (posAttr) {
      for (let i = 0; i < posAttr.count; i++) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      }
    }

    if (normAttr) {
      for (let i = 0; i < normAttr.count; i++) {
        normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      }
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );

  if (normals.length > 0) {
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }

  return merged;
}

export { ROADBED_COLOR };
