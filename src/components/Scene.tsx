/**
 * Scene Component
 *
 * Main R3F Canvas wrapper for the NYC Rush Hour visualization.
 * Sets up:
 * - WebGL canvas with appropriate settings
 * - Camera configuration for city-scale viewing
 * - Orbit controls for interactive exploration
 * - Environment (lights, fog, background)
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Environment } from './Environment';

// =============================================================================
// Camera Configuration
// =============================================================================

/** Camera settings for city-scale visualization */
const CAMERA_CONFIG = {
  fov: 60, // Field of view in degrees
  near: 1, // Near clipping plane (meters)
  far: 20000, // Far clipping plane (meters) - needs to see whole city
  position: [2000, 1500, 2000] as [number, number, number], // Initial position (x, y, z)
};

// =============================================================================
// Component
// =============================================================================

interface SceneProps {
  /** Optional children to render inside the Canvas */
  children?: React.ReactNode;
}

/**
 * Scene provides the R3F Canvas and basic scene setup.
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <Buildings />
 *   <SubwayLines />
 *   <Trains />
 * </Scene>
 * ```
 */
export function Scene({ children }: SceneProps) {
  return (
    <Canvas
      camera={CAMERA_CONFIG}
      gl={{
        antialias: true,
        alpha: false, // No transparency needed - solid background
        powerPreference: 'high-performance',
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    >
      {/* Scene environment (lights, fog, background) */}
      <Environment />

      {/* Camera controls for interactive exploration */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={100}
        maxDistance={10000}
        maxPolarAngle={Math.PI / 2.1} // Prevent going below ground
        target={[1500, 0, 800]} // Look at approximate center of Manhattan south of 34th
      />

      {/* Child components (buildings, trains, etc.) */}
      {children}
    </Canvas>
  );
}
