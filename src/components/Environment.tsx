/**
 * Environment Component
 *
 * Sets up the scene environment:
 * - Sky (procedural morning sky for 8-9 AM rush hour)
 * - Fog (exponential, for depth perception)
 * - Lighting (ambient + directional, matches sun position)
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';

// =============================================================================
// Constants (exported for testing)
// =============================================================================

/** Light blue for clear morning sky fog blend */
export const FOG_COLOR = '#a8c8e8';

/** Fog start distance (meters) - pushed far for clear visibility */
export const FOG_NEAR = 8000;

/** Fog end distance (meters) - very distant for realism */
export const FOG_FAR = 20000;

// =============================================================================
// Sun Position for 8-9 AM NYC (40.7°N, early morning)
// =============================================================================

/**
 * Calculate sun position for morning rush hour.
 * At 8:30 AM in NYC, sun is roughly:
 * - Azimuth: ~110° (ESE)
 * - Elevation: ~25°
 */
function getSunPosition(): [number, number, number] {
  const azimuth = 110 * (Math.PI / 180); // 110° from north (ESE)
  const elevation = 25 * (Math.PI / 180); // 25° above horizon
  const distance = 1000;

  // Convert spherical to cartesian (Y-up coordinate system)
  const x = distance * Math.cos(elevation) * Math.sin(azimuth);
  const y = distance * Math.sin(elevation);
  const z = -distance * Math.cos(elevation) * Math.cos(azimuth);

  return [x, y, z];
}

// =============================================================================
// Component
// =============================================================================

/**
 * Environment sets up scene-level properties that can't be expressed
 * as regular React children (background, fog).
 *
 * Also renders the procedural sky and lights.
 */
export function Environment() {
  const { scene } = useThree();

  // Calculate sun position once (static for 8-9 AM)
  const sunPosition = useMemo(() => getSunPosition(), []);

  // Set up fog on mount (sky handles background)
  useEffect(() => {
    // Linear fog for depth perception, blends with sky horizon
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    // Cleanup on unmount
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  return (
    <>
      {/* Procedural sky - clear morning for 8-9 AM */}
      <Sky
        distance={450000}
        sunPosition={sunPosition}
        turbidity={2} // Clear morning sky
        rayleigh={1.0} // Natural blue sky scattering
        mieCoefficient={0.003}
        mieDirectionalG={0.7}
      />

      {/* Ambient light - neutral daylight */}
      <ambientLight intensity={0.6} color="#ffffff" />

      {/* Main directional light - matches sun position */}
      <directionalLight
        position={sunPosition}
        intensity={1.2}
        color="#fffaf0" // Natural daylight
        castShadow={false}
      />

      {/* Fill light from opposite side */}
      <directionalLight
        position={[-500, 600, 500]}
        intensity={0.15}
        color="#e8f4ff" // Subtle sky fill
      />
    </>
  );
}
