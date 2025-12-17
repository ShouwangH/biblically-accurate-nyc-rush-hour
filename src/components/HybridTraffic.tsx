/**
 * HybridTraffic Component
 *
 * Renders road traffic using the hybrid mesoscopic/microscopic model.
 * Uses CorridorFlowEngine for meso particles + micro agents.
 *
 * Per CLAUDE.md §8.3: Component only renders; CorridorFlowEngine owns state.
 * Per CLAUDE.md §8.6: Uses InstancedMesh with pre-allocated temp objects.
 */
import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CorridorFlowEngine,
  createTestCorridorEngine,
} from '../engine/CorridorFlowEngine';
import { useSimulationTime } from '../hooks/useSimulationTime';
import { useData } from '../hooks/useDataLoader';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of vehicle instances */
const MAX_VEHICLES = 5000;

/** Vehicle dimensions (meters) - realistic NYC vehicle */
const VEHICLE_SIZE = {
  width: 2,
  height: 1.5,
  length: 5,
};

/** Meso particle color (black) */
const MESO_COLOR = '#111111';

/** Micro agent color (orange - to distinguish) */
const MICRO_COLOR = '#FF8C00';

/** Y offset to place vehicles above ground */
const VEHICLE_Y_OFFSET = VEHICLE_SIZE.height / 2;

// =============================================================================
// Pre-allocated objects (per CLAUDE.md §8.6)
// =============================================================================

const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3(1, 1, 1);
const yAxis = new THREE.Vector3(0, 1, 0);
// Note: Instance colors disabled due to WebGL buffer sync issues (see Traffic.tsx)

// =============================================================================
// Component
// =============================================================================

interface HybridTrafficProps {
  /** Maximum vehicles to render */
  maxVehicles?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * HybridTraffic renders vehicles using the corridor flow model.
 *
 * Features:
 * - Meso particles along major corridors (yellow)
 * - Micro agents at intersections (orange)
 * - Smooth flow with headway clamping
 */
export function HybridTraffic({
  maxVehicles = MAX_VEHICLES,
  debug = false,
}: HybridTrafficProps) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const engineRef = useRef<CorridorFlowEngine | null>(null);
  const lastLogTime = useRef(0);

  // Get camera for detail boost
  const { camera } = useThree();

  // Callback ref to set initial count to 0
  const setMeshRef = (mesh: THREE.InstancedMesh | null) => {
    if (mesh) {
      mesh.count = 0;
    }
    meshRef.current = mesh;
  };

  // Get simulation time
  const { isPlaying, speed } = useSimulationTime();

  // Get road segments from data context
  const { data } = useData();

  // Create geometry
  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        VEHICLE_SIZE.width,
        VEHICLE_SIZE.height,
        VEHICLE_SIZE.length
      ),
    []
  );

  // Create material (fixed color - instance colors disabled due to WebGL issues)
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: MESO_COLOR,
        roughness: 0.7,
        metalness: 0.4,
      }),
    []
  );

  // Initialize engine when data is available
  useEffect(() => {
    console.log('[HybridTraffic] Data check:', {
      hasData: !!data,
      hasRoadSegments: !!data?.roadSegments,
      segmentCount: data?.roadSegments?.segments?.length ?? 0,
    });
    if (data?.roadSegments?.segments) {
      engineRef.current = createTestCorridorEngine(data.roadSegments.segments);

      if (debug) {
        const counts = engineRef.current.getCounts();
        console.log('[HybridTraffic] Engine initialized:', counts);
      }
    }
  }, [data, debug]);

  // Cleanup
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Update per frame
  useFrame((_, delta) => {
    const engine = engineRef.current;
    const mesh = meshRef.current;

    if (!engine || !mesh) return;

    // Scale delta by simulation speed
    const scaledDelta = isPlaying ? delta * speed : 0;

    // Get camera position for detail boost
    const cameraPos: [number, number, number] = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
    ];

    // Update engine
    engine.update(scaledDelta, cameraPos);

    // Get vehicles
    const vehicles = engine.getVehicles();

    // Debug logging (throttled)
    if (debug) {
      const now = Date.now();
      if (now - lastLogTime.current > 2000) {
        const counts = engine.getCounts();
        console.log('[HybridTraffic] Counts:', counts, 'Vehicles:', vehicles.length);
        if (vehicles.length > 0) {
          const v = vehicles[0]!;
          console.log('[HybridTraffic] First vehicle pos:', v.position, 'heading:', v.heading);
          // Also log mesh state
          console.log('[HybridTraffic] Mesh count:', mesh.count, 'visible:', mesh.visible);
        }
        lastLogTime.current = now;
      }
    }

    // Update instanced mesh
    let instanceIndex = 0;
    for (const vehicle of vehicles) {
      if (instanceIndex >= maxVehicles) break;

      // Set position
      tempPosition.set(
        vehicle.position[0],
        vehicle.position[1] + VEHICLE_Y_OFFSET,
        vehicle.position[2]
      );

      // Set rotation
      tempQuaternion.setFromAxisAngle(yAxis, vehicle.heading);

      // Compose matrix
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(instanceIndex, tempMatrix);

      // Note: Instance colors disabled due to WebGL issues
      // All vehicles render as MESO_COLOR for now

      instanceIndex++;
    }

    // Update instance count
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

// Export for testing
export { MAX_VEHICLES, VEHICLE_SIZE, MESO_COLOR, MICRO_COLOR };
