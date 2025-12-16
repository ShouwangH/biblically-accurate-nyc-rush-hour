/**
 * Trains Component
 *
 * Renders subway trains as instanced meshes using TrainEngine.
 * Trains move along subway line segments with color based on crowding.
 *
 * Per CLAUDE.md §8.3: Component only renders; TrainEngine owns state.
 * Per CLAUDE.md §8.6: Uses InstancedMesh with pre-allocated temp objects.
 */
import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TrainEngine } from '../engine/TrainEngine';
import { useSimulationTime } from '../hooks/useSimulationTime';
import { useData } from '../hooks/useDataLoader';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of train instances */
export const MAX_TRAINS = 300;

/** Train geometry dimensions (meters) */
export const TRAIN_SIZE = {
  width: 3,
  height: 3,
  length: 20,
};

/** Y offset for trains (should be at subway depth, but position from engine already includes it) */
const TRAIN_Y_OFFSET = 0;

/** Crowding affects brightness: low crowding = bright, high crowding = dim */
export const CROWDING_BRIGHTNESS = {
  /** Minimum brightness (full crowding) */
  min: 0.4,
  /** Maximum brightness (no crowding) */
  max: 1.0,
};

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
 * Maps crowding level and line color to final train color.
 * Higher crowding = darker color (less bright).
 *
 * @param lineColor - Base color hex string (e.g., "#0039A6")
 * @param crowding - Crowding level [0, 1] where 1 = most crowded
 */
function getTrainColor(lineColor: string, crowding: number): THREE.Color {
  // Clamp crowding to [0, 1]
  const clampedCrowding = Math.max(0, Math.min(1, crowding));

  // Calculate brightness: less crowded = brighter
  // crowding 0 -> brightness 1.0 (bright)
  // crowding 1 -> brightness 0.4 (dim)
  const brightness =
    CROWDING_BRIGHTNESS.max -
    clampedCrowding * (CROWDING_BRIGHTNESS.max - CROWDING_BRIGHTNESS.min);

  // Set base color and modulate by brightness
  tempColor.set(lineColor);
  tempColor.multiplyScalar(brightness);

  return tempColor;
}

// =============================================================================
// Component
// =============================================================================

interface TrainsProps {
  /** Maximum number of trains (default: MAX_TRAINS) */
  maxTrains?: number;
}

/**
 * Trains renders subway trains as instanced meshes.
 *
 * Features:
 * - Uses TrainEngine for active train computation
 * - InstancedMesh for efficient rendering of many trains
 * - Color based on line color modulated by crowding
 * - Updates per frame via useFrame hook
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <Trains />
 * </Scene>
 * ```
 */
export function Trains({ maxTrains = MAX_TRAINS }: TrainsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const engineRef = useRef<TrainEngine | null>(null);

  // Get simulation time from context
  const { t } = useSimulationTime();

  // Get train schedules and subway lines from data context
  const { data } = useData();

  // Create geometry once
  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        TRAIN_SIZE.width,
        TRAIN_SIZE.height,
        TRAIN_SIZE.length
      ),
    []
  );

  // Create material once
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.5,
        metalness: 0.5,
      }),
    []
  );

  // Initialize engine when data is available
  useEffect(() => {
    if (data?.trainSchedules?.trains && data?.subwayLines?.lines) {
      engineRef.current = new TrainEngine(
        data.trainSchedules.trains,
        data.subwayLines.lines
      );
    }
  }, [data]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Update mesh per frame
  useFrame(() => {
    const engine = engineRef.current;
    const mesh = meshRef.current;

    if (!engine || !mesh) return;

    // Get active trains at current simulation time
    const activeTrains = engine.getActiveTrains(t);

    // Update instanced mesh
    let instanceIndex = 0;
    for (const train of activeTrains) {
      if (instanceIndex >= maxTrains) break;

      // Set position (train position already includes depth from segment)
      tempPosition.set(
        train.position[0],
        train.position[1] + TRAIN_Y_OFFSET,
        train.position[2]
      );

      // Compose transform matrix
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(instanceIndex, tempMatrix);

      // Set color based on line color and crowding
      getTrainColor(train.color, train.crowding);
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
  if (!data?.trainSchedules?.trains || !data?.subwayLines?.lines) {
    return null;
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxTrains]}
      // Disable frustum culling to ensure all trains render
      // eslint-disable-next-line react/no-unknown-property
      frustumCulled={false}
    />
  );
}
