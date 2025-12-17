/**
 * StationBeams Component
 *
 * Renders station intensity beams as instanced meshes.
 * Beam height and brightness vary with station intensity over time.
 *
 * Per CLAUDE.md §8.3: Component only renders; data from context.
 * Per CLAUDE.md §8.6: Uses InstancedMesh with pre-allocated temp objects.
 */
import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationTime } from '../hooks/useSimulationTime';
import { useData } from '../hooks/useDataLoader';
import { getSliceIndex } from '../utils/sliceIndex';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of station beam instances */
export const MAX_STATIONS = 100;

/** Beam geometry dimensions */
export const BEAM_DIMENSIONS = {
  /** Base width/depth of beam (meters) */
  baseWidth: 8,
  /** Maximum height when intensity = 1.0 (meters) */
  maxHeight: 400,
  /** Minimum height when intensity = minIntensityFloor (meters) */
  minHeight: 50,
};

/** Beam colors for intensity gradient */
export const BEAM_COLORS = {
  /** Base color (low intensity) - soft blue */
  base: '#4488FF',
  /** Peak color (high intensity) - bright white-blue */
  peak: '#AADDFF',
};

// =============================================================================
// Pre-allocated objects (per CLAUDE.md §8.6 - no allocations in render loop)
// =============================================================================

const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maps intensity to beam height.
 * @param intensity - Intensity value [0, 1]
 * @returns Beam height in meters
 */
function getBeamHeight(intensity: number): number {
  const { minHeight, maxHeight } = BEAM_DIMENSIONS;
  return minHeight + intensity * (maxHeight - minHeight);
}

/**
 * Maps intensity to beam color.
 * @param intensity - Intensity value [0, 1]
 */
function getBeamColor(intensity: number): THREE.Color {
  // Interpolate between base and peak colors
  tempColor.set(BEAM_COLORS.base);
  const peakColor = new THREE.Color(BEAM_COLORS.peak);
  tempColor.lerp(peakColor, intensity);
  return tempColor;
}

// =============================================================================
// Component
// =============================================================================

interface StationBeamsProps {
  /** Maximum number of stations (default: MAX_STATIONS) */
  maxStations?: number;
}

/**
 * StationBeams renders station intensity as vertical light beams.
 *
 * Features:
 * - InstancedMesh for efficient rendering
 * - Height varies with station intensity over time
 * - Additive blending for glow effect
 * - Updates per frame via useFrame hook
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <StationBeams />
 * </Scene>
 * ```
 */
export function StationBeams({ maxStations = MAX_STATIONS }: StationBeamsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Get simulation time from context
  const { t } = useSimulationTime();

  // Get stations data from context
  const { data } = useData();

  // Create geometry once (unit box, scaled per instance)
  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        BEAM_DIMENSIONS.baseWidth,
        BEAM_DIMENSIONS.baseWidth, // Use baseWidth as unit height, scale in render
        BEAM_DIMENSIONS.baseWidth
      ),
    []
  );

  // Create material once with additive blending for glow
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BEAM_COLORS.base,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Update mesh per frame
  useFrame(() => {
    const mesh = meshRef.current;
    const stations = data?.stations?.stations;

    if (!mesh || !stations) return;

    // Get current time slice
    const sliceIndex = getSliceIndex(t);

    // Update instanced mesh
    let instanceIndex = 0;
    for (const station of stations) {
      if (instanceIndex >= maxStations) break;

      // Get intensity for current time slice
      const intensity = station.intensities[sliceIndex] ?? 0;

      // Calculate beam height
      const height = getBeamHeight(intensity);

      // Position beam at surface, extending upward
      // Beam center is at surfaceY + height/2
      const [x, surfaceY, z] = station.surfacePosition;
      tempPosition.set(x, surfaceY + height / 2, z);

      // Scale: width stays constant, height varies
      const scaleY = height / BEAM_DIMENSIONS.baseWidth;
      tempScale.set(1, scaleY, 1);

      // Compose transform matrix
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(instanceIndex, tempMatrix);

      // Set color based on intensity
      getBeamColor(intensity);
      mesh.setColorAt(instanceIndex, tempColor);

      instanceIndex++;
    }

    // Update instance count and flag for GPU update
    mesh.count = instanceIndex;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  // Don't render if no data
  if (!data?.stations?.stations) {
    return null;
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxStations]}
      // eslint-disable-next-line react/no-unknown-property
      frustumCulled={false}
    />
  );
}
