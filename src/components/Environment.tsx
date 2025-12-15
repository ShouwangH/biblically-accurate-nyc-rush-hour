/**
 * Environment Component
 *
 * Sets up the scene environment:
 * - Background color (off-white for projector visibility)
 * - Fog (exponential, for depth perception)
 * - Lighting (ambient + directional)
 */
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';

// =============================================================================
// Constants (exported for testing)
// =============================================================================

/** Off-white background for projector visibility */
export const BACKGROUND_COLOR = '#F5F5F0';

/** Fog color matches background for seamless fade */
export const FOG_COLOR = BACKGROUND_COLOR;

/** Fog start distance (meters) */
export const FOG_NEAR = 500;

/** Fog end distance (meters) - city-scale visibility */
export const FOG_FAR = 5000;

// =============================================================================
// Component
// =============================================================================

/**
 * Environment sets up scene-level properties that can't be expressed
 * as regular React children (background, fog).
 *
 * Also renders lights which are part of the scene graph.
 */
export function Environment() {
  const { scene } = useThree();

  // Set up scene properties on mount
  useEffect(() => {
    // Background color
    scene.background = new THREE.Color(BACKGROUND_COLOR);

    // Linear fog for depth perception
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    // Cleanup on unmount
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene]);

  return (
    <>
      {/* Ambient light for base illumination - soft fill */}
      <ambientLight intensity={0.6} color="#ffffff" />

      {/* Main directional light - simulates sun from upper right */}
      <directionalLight
        position={[1000, 2000, 1000]}
        intensity={0.8}
        color="#ffffff"
        castShadow={false} // Shadows disabled for performance
      />

      {/* Secondary fill light from opposite side */}
      <directionalLight
        position={[-500, 1000, -500]}
        intensity={0.3}
        color="#f0f0ff" // Slight cool tint
      />
    </>
  );
}
