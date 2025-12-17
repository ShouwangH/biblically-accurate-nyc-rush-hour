/**
 * GroundPlane Component
 *
 * Renders a flat ground plane beneath the 3D visualization.
 * Provides visual context with water, parks, and road hints.
 *
 * Per CLAUDE.md §8.3: This is a pure rendering component.
 * No simulation logic - just geometry and material.
 * Per CLAUDE.md §8.6: Material applied once on load, not per-frame.
 */
import { useEffect, useMemo } from 'react';
import { useTexture } from '@react-three/drei';
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

/** Default path to ground texture (exported from QGIS) */
const DEFAULT_TEXTURE_PATH = '/assets/ground_map.png';

/** Ground plane color - fallback when texture not provided */
export const GROUND_COLOR = '#E8E8E8';

/** Ground plane opacity - full opacity, water/parks rendered as overlays */
export const GROUND_OPACITY = 1.0;

// =============================================================================
// Component
// =============================================================================

interface GroundPlaneProps {
  /** Path to ground texture. If provided, loads texture; otherwise solid color. */
  textureUrl?: string;
}

/**
 * GroundPlane renders a flat plane at street level.
 *
 * Positioning:
 * - Centered at (GROUND_CENTER_X, GROUND_Y_POSITION, GROUND_CENTER_Z)
 * - Rotated -90° around X to lie flat in the XZ plane
 * - Sized to cover the full visualization extent
 *
 * Material:
 * - If textureUrl provided: loads texture with proper filtering
 * - Otherwise: solid color fallback
 * - MeshBasicMaterial (unlit) to stay visually subordinate
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <GroundPlane />  {/* solid color *\/}
 *   <GroundPlane textureUrl="/assets/ground_map.png" />  {/* textured *\/}
 * </Scene>
 * ```
 */
export function GroundPlane({ textureUrl }: GroundPlaneProps) {
  // Use textured or solid variant based on prop
  if (textureUrl) {
    return <TexturedGround textureUrl={textureUrl} />;
  }
  return <SolidGround />;
}

// =============================================================================
// Textured Ground (internal)
// =============================================================================

interface TexturedGroundProps {
  textureUrl: string;
}

/**
 * Ground plane with texture. Applies proper filtering for smooth appearance.
 */
function TexturedGround({ textureUrl }: TexturedGroundProps) {
  const texture = useTexture(textureUrl);

  // Configure texture once on load
  // Note: drei's useTexture already sets reasonable defaults
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
  }, [texture]);

  return (
    <mesh
      position={[GROUND_CENTER_X, GROUND_Y_POSITION, GROUND_CENTER_Z]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-1}
    >
      <planeGeometry args={[GROUND_WIDTH, GROUND_DEPTH]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={GROUND_OPACITY}
        side={THREE.FrontSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// =============================================================================
// Solid Ground (internal)
// =============================================================================

/**
 * Ground plane with solid color. Used when texture not provided.
 */
function SolidGround() {
  // Create material once (not per-frame)
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GROUND_COLOR,
        transparent: true,
        opacity: GROUND_OPACITY,
        side: THREE.FrontSide,
        depthWrite: false,
      }),
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <mesh
      position={[GROUND_CENTER_X, GROUND_Y_POSITION, GROUND_CENTER_Z]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-1}  // Render before other transparent objects
    >
      <planeGeometry args={[GROUND_WIDTH, GROUND_DEPTH]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Preload hint for useTexture
GroundPlane.preload = (textureUrl: string = DEFAULT_TEXTURE_PATH) => {
  useTexture.preload(textureUrl);
};
