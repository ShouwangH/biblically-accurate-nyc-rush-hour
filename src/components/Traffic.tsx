/**
 * Traffic Component
 *
 * Renders road traffic as instanced particles using TrafficEngine.
 * Vehicles flow along road segments.
 *
 * Per CLAUDE.md §8.3: Component only renders; TrafficEngine owns state.
 * Per CLAUDE.md §8.6: Uses InstancedMesh with pre-allocated temp objects.
 *
 * Note: Instance colors are disabled due to WebGL buffer sync issues
 * causing black screen. Using fixed material color instead.
 */
import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TrafficEngine } from '../engine/TrafficEngine';
import { useSimulationTime } from '../hooks/useSimulationTime';
import { useData } from '../hooks/useDataLoader';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of vehicle instances */
const MAX_VEHICLES = 2000;

/**
 * Vehicle geometry dimensions (meters)
 * Realistic NYC taxi/sedan proportions, scaled for visibility:
 * - Length: ~5m (typical sedan)
 * - Width: ~2m (typical sedan)
 * - Height: ~1.5m (typical sedan)
 */
const VEHICLE_SIZE = {
  width: 2,
  height: 1.5,
  length: 5,
};

/** Vehicle color - gold/yellow for visibility */
const VEHICLE_COLOR = '#FFD700';

/** Y offset to place vehicles slightly above ground */
const VEHICLE_Y_OFFSET = VEHICLE_SIZE.height / 2;

// =============================================================================
// Pre-allocated objects (per CLAUDE.md §8.6 - no allocations in render loop)
// =============================================================================

const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3(1, 1, 1);
const yAxis = new THREE.Vector3(0, 1, 0);

// =============================================================================
// Component
// =============================================================================

interface TrafficProps {
  /** Maximum number of vehicles (default: MAX_VEHICLES) */
  maxVehicles?: number;
}

/**
 * Traffic renders road vehicles as instanced meshes.
 *
 * Features:
 * - Uses TrafficEngine for state computation
 * - InstancedMesh for efficient rendering of many vehicles
 * - Updates per frame via useFrame hook
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <Traffic />
 * </Scene>
 * ```
 */
export function Traffic({ maxVehicles = MAX_VEHICLES }: TrafficProps) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const engineRef = useRef<TrafficEngine | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Callback ref to set initial count to 0 immediately when mesh is created
  const setMeshRef = (mesh: THREE.InstancedMesh | null) => {
    if (mesh) {
      mesh.count = 0; // Hide all instances initially
    }
    meshRef.current = mesh;
  };

  // Get simulation time from context
  const { t, speed, isPlaying } = useSimulationTime();

  // Get road segments from data context
  const { data } = useData();

  // Create geometry once
  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        VEHICLE_SIZE.width,
        VEHICLE_SIZE.height,
        VEHICLE_SIZE.length
      ),
    []
  );

  // Create material once (fixed color - instance colors disabled due to WebGL issues)
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: VEHICLE_COLOR,
        roughness: 0.6,
        metalness: 0.3,
      }),
    []
  );

  // Initialize engine when data is available
  useEffect(() => {
    if (data?.roadSegments?.segments) {
      engineRef.current = new TrafficEngine(
        data.roadSegments.segments,
        maxVehicles
      );
    }
  }, [data, maxVehicles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Update engine and mesh per frame
  useFrame((_, delta) => {
    const engine = engineRef.current;
    const mesh = meshRef.current;

    if (!engine || !mesh) return;

    // Detect time scrubbing (significant backwards jump or large forward jump)
    // Time wraps at 1.0 -> 0.0, so account for that
    const timeDiff = t - lastTimeRef.current;
    const isScrubbingBackward = timeDiff < -0.01 && timeDiff > -0.9; // Negative but not wrap
    const isLargeJump = Math.abs(timeDiff) > 0.1 && Math.abs(timeDiff) < 0.9;

    if (isScrubbingBackward || isLargeJump) {
      engine.reset();
    }

    lastTimeRef.current = t;

    // Scale delta by simulation speed (0 when paused)
    const scaledDelta = isPlaying ? delta * speed : 0;

    // Update engine with current simulation time and scaled delta
    engine.update(t, scaledDelta);

    // Get active vehicles
    const vehicles = engine.getVehicles();

    // Update instanced mesh
    let instanceIndex = 0;
    for (const vehicle of vehicles) {
      if (instanceIndex >= maxVehicles) break;

      // Set position (with Y offset to place on ground)
      tempPosition.set(
        vehicle.position[0],
        vehicle.position[1] + VEHICLE_Y_OFFSET,
        vehicle.position[2]
      );

      // Set rotation from heading (rotation around Y axis)
      tempQuaternion.setFromAxisAngle(yAxis, vehicle.heading);

      // Compose transform matrix
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(instanceIndex, tempMatrix);

      instanceIndex++;
    }

    // Update instance count and flag for GPU update
    mesh.count = instanceIndex;
    mesh.instanceMatrix.needsUpdate = true;
  });

  // Don't render if no data
  if (!data?.roadSegments?.segments) {
    return null;
  }

  return (
    <instancedMesh
      ref={setMeshRef}
      args={[geometry, material, maxVehicles]}
      frustumCulled={false}
    />
  );
}

// Export constants for testing
export { MAX_VEHICLES, VEHICLE_SIZE, VEHICLE_COLOR };
