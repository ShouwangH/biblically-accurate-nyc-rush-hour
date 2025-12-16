/**
 * GroundPlane Component
 *
 * Renders a flat ground plane beneath the 3D visualization.
 * Provides visual context with neighborhoods, water, and road hints.
 *
 * Currently renders a solid color; will be updated to use a
 * stylized raster texture in a future PR.
 *
 * Per CLAUDE.md §8.3: This is a pure rendering component.
 * No simulation logic - just geometry and material.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import {
  GROUND_WIDTH,
  GROUND_DEPTH,
  GROUND_CENTER_X,
  GROUND_CENTER_Z,
  GROUND_Y_POSITION,
} from '../constants/groundBounds';

// =============================================================================
// Constants
// =============================================================================

/** Ground plane color - neutral grey, subordinate to data layers */
export const GROUND_COLOR = '#E8E8E8';

/** Ground plane opacity - semi-transparent to allow subway lines to show through */
export const GROUND_OPACITY = 0.85;

// =============================================================================
// Component
// =============================================================================

/**
 * GroundPlane renders a flat plane at street level.
 *
 * Positioning:
 * - Centered at (GROUND_CENTER_X, GROUND_Y_POSITION, GROUND_CENTER_Z)
 * - Rotated -90° around X to lie flat in the XZ plane
 * - Sized to cover the full visualization extent
 *
 * Material:
 * - MeshBasicMaterial (unlit) to stay visually subordinate
 * - Will be replaced with textured material in future PR
 */
export function GroundPlane() {
  // Create material once (not per frame)
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GROUND_COLOR,
        transparent: true,
        opacity: GROUND_OPACITY,
        side: THREE.FrontSide, // Only render top face
        depthWrite: false, // Prevent z-fighting with subway lines below
      }),
    []
  );

  return (
    <mesh
      position={[GROUND_CENTER_X, GROUND_Y_POSITION, GROUND_CENTER_Z]}
      rotation={[-Math.PI / 2, 0, 0]} // Rotate to lie flat in XZ plane
    >
      {/* PlaneGeometry(width, height) creates plane in XY, rotation maps to XZ */}
      <planeGeometry args={[GROUND_WIDTH, GROUND_DEPTH]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
