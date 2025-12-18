/**
 * Scene Component
 *
 * Main R3F Canvas wrapper for the NYC Rush Hour visualization.
 * Sets up:
 * - WebGL canvas with appropriate settings
 * - Camera configuration for city-scale viewing
 * - Environment (lights, fog, background)
 */
import { Canvas } from '@react-three/fiber';
import { Environment } from './Environment';

// =============================================================================
// Camera Configuration
// =============================================================================

/** Camera settings for city-scale visualization */
const CAMERA_CONFIG = {
  fov: 60, // Field of view in degrees
  near: 5, // Near clipping plane (meters) - raised for better z-buffer precision
  far: 15000, // Far clipping plane (meters) - reduced for better z-buffer precision
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
        logarithmicDepthBuffer: true, // Better z-buffer precision at all distances
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    >
      {/* Scene environment (lights, fog, background) */}
      <Environment />

      {/* Child components (buildings, trains, etc.) */}
      {children}
    </Canvas>
  );
}
