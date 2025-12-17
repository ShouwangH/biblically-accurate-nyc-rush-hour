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
import { TrainEngine, type ActiveTrain } from '../engine/TrainEngine';
import { TripEngine } from '../engine/TripEngine';
import { useSimulationTime } from '../hooks/useSimulationTime';
import { useData, USE_TRIP_ENGINE } from '../hooks/useDataLoader';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of train instances */
export const MAX_TRAINS = 300;

/** Train geometry dimensions (meters) - sphere for direction-independent display */
export const TRAIN_SIZE = {
  /** Train radius - larger for visibility */
  radius: 4,
  widthSegments: 12,
  heightSegments: 8,
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

/** Ghost train configuration - visible through buildings */
const GHOST_TRAIN = {
  /** Scale multiplier (2x normal size) */
  scale: 2.0,
  /** Opacity for ghost layer */
  opacity: 0.5,
  /** Emissive intensity for glow effect */
  emissiveIntensity: 0.8,
  /** Render order (after buildings) */
  renderOrder: 11,
};

// =============================================================================
// Pre-allocated objects (per CLAUDE.md §8.6 - no allocations in render loop)
// =============================================================================

const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3(1, 1, 1);
const tempGhostScale = new THREE.Vector3(GHOST_TRAIN.scale, GHOST_TRAIN.scale, GHOST_TRAIN.scale);

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
/** Engine interface - both TrainEngine and TripEngine have getActiveTrains */
type TrainEngineInterface = { getActiveTrains(t: number): ActiveTrain[] };

export function Trains({ maxTrains = MAX_TRAINS }: TrainsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const ghostMeshRef = useRef<THREE.InstancedMesh>(null);
  const engineRef = useRef<TrainEngineInterface | null>(null);

  // Get simulation time from context
  const { t } = useSimulationTime();

  // Get train schedules and subway lines from data context
  const { data } = useData();

  // Create geometry once - sphere for direction-independent display
  const geometry = useMemo(
    () =>
      new THREE.SphereGeometry(
        TRAIN_SIZE.radius,
        TRAIN_SIZE.widthSegments,
        TRAIN_SIZE.heightSegments
      ),
    []
  );

  // Create material once (solid layer)
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.5,
        metalness: 0.5,
      }),
    []
  );

  // Create ghost material (visible through buildings, luminous)
  // Using MeshBasicMaterial for uniform color without lighting (ghost effect)
  const ghostMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: GHOST_TRAIN.opacity,
        depthTest: false,
        depthWrite: false,
        // Additive blending for luminous glow effect
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  // Initialize engine when data is available
  useEffect(() => {
    if (USE_TRIP_ENGINE && data?.trips?.trips) {
      // Use trip-based engine with GTFS data
      engineRef.current = new TripEngine(data.trips.trips);
    } else if (data?.trainSchedules?.trains && data?.subwayLines?.lines) {
      // Fallback to segment-based engine
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
      ghostMaterial.dispose();
    };
  }, [geometry, material, ghostMaterial]);

  // Update mesh per frame
  useFrame(() => {
    const engine = engineRef.current;
    const mesh = meshRef.current;
    const ghostMesh = ghostMeshRef.current;

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

      // Compose transform matrix for solid trains
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(instanceIndex, tempMatrix);

      // Set color based on line color and crowding
      getTrainColor(train.color, train.crowding);
      mesh.setColorAt(instanceIndex, tempColor);

      // Update ghost mesh (2x scale, same position)
      if (ghostMesh) {
        tempMatrix.compose(tempPosition, tempQuaternion, tempGhostScale);
        ghostMesh.setMatrixAt(instanceIndex, tempMatrix);
        // Ghost uses line color directly (no crowding dimming) for max visibility
        tempColor.set(train.color);
        ghostMesh.setColorAt(instanceIndex, tempColor);
      }

      instanceIndex++;
    }

    // Update instance count and flag for GPU update
    mesh.count = instanceIndex;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    // Update ghost mesh
    if (ghostMesh) {
      ghostMesh.count = instanceIndex;
      ghostMesh.instanceMatrix.needsUpdate = true;
      if (ghostMesh.instanceColor) {
        ghostMesh.instanceColor.needsUpdate = true;
      }
    }
  });

  // Don't render if no data
  const hasRequiredData = USE_TRIP_ENGINE
    ? data?.trips?.trips
    : data?.trainSchedules?.trains && data?.subwayLines?.lines;

  if (!hasRequiredData) {
    return null;
  }

  return (
    <>
      {/* Solid trains - normal rendering */}
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, maxTrains]}
        frustumCulled={false}
      />
      {/* Ghost trains - visible through buildings, 2x size, luminous */}
      <instancedMesh
        ref={ghostMeshRef}
        args={[geometry, ghostMaterial, maxTrains]}
        frustumCulled={false}
        renderOrder={GHOST_TRAIN.renderOrder}
      />
    </>
  );
}
