/**
 * Traffic Component
 *
 * Renders road traffic as instanced particles using TrafficEngine.
 * Vehicles flow along road segments with color based on congestion.
 *
 * Per CLAUDE.md §8.3: Component only renders; TrafficEngine owns state.
 * Per CLAUDE.md §8.6: Uses InstancedMesh with pre-allocated temp objects.
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

/** Vehicle geometry dimensions (meters) */
const VEHICLE_SIZE = {
  width: 2,
  height: 1.5,
  length: 4,
};

/** Color gradient for congestion: gold (uncongested) to red (congested) */
const CONGESTION_COLORS = {
  /** Low congestion (congestionFactor near 1) - gold/yellow */
  low: new THREE.Color('#FFD700'),
  /** High congestion (congestionFactor near 0) - red */
  high: new THREE.Color('#FF4444'),
};

/** Y offset to place vehicles slightly above ground */
const VEHICLE_Y_OFFSET = VEHICLE_SIZE.height / 2;

// =============================================================================
// Pre-allocated objects (per CLAUDE.md §8.6 - no allocations in render loop)
// =============================================================================

const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3(1, 1, 1);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maps congestion factor to color.
 * congestionFactor is avgSpeed/freeFlowSpeed, so:
 * - 1.0 = no congestion (gold)
 * - 0.0 = maximum congestion (red)
 */
function getCongestionColor(congestionFactor: number): THREE.Color {
  // Clamp to [0, 1]
  const t = Math.max(0, Math.min(1, congestionFactor));
  // Lerp from high (red) to low (gold) based on congestion
  // Higher congestionFactor = less congested = more gold
  return tempColor.copy(CONGESTION_COLORS.high).lerp(CONGESTION_COLORS.low, t);
}

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
 * - Color gradient based on congestion (gold = free flow, red = congested)
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
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const engineRef = useRef<TrafficEngine | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Get simulation time from context
  const { t } = useSimulationTime();

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

  // Create material once
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
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

    // Update engine with current simulation time and frame delta
    engine.update(t, delta);

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

      // Compose transform matrix
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(instanceIndex, tempMatrix);

      // Set color based on congestion
      getCongestionColor(vehicle.congestion);
      mesh.setColorAt(instanceIndex, tempColor);

      instanceIndex++;
    }

    // Update instance count and flag for GPU update
    mesh.count = instanceIndex;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    lastTimeRef.current = t;
  });

  // Don't render if no data
  if (!data?.roadSegments?.segments) {
    return null;
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxVehicles]}
      // Disable frustum culling to ensure all vehicles render
      // eslint-disable-next-line react/no-unknown-property
      frustumCulled={false}
    />
  );
}

// Export constants for testing
export { MAX_VEHICLES, VEHICLE_SIZE, CONGESTION_COLORS };
