/**
 * CameraController Component
 *
 * Provides camera control with auto/manual modes and keyframe animation.
 * Camera time is independent from simulation time.
 *
 * Features:
 * - Auto mode: Camera follows predefined keyframes over cameraTime
 * - Manual mode: OrbitControls for free camera movement
 * - Independent cameraTime (scrubbing simulation doesn't move camera)
 * - Smooth interpolation between keyframes
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import type { ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';

// =============================================================================
// Types
// =============================================================================

/** Camera mode: auto follows keyframes, manual allows free orbit */
export type CameraMode = 'auto' | 'manual';

/** A single camera keyframe */
export interface CameraKeyframe {
  /** Time in [0, 1] when this keyframe should be reached */
  time: number;
  /** Camera position [x, y, z] */
  position: [number, number, number];
  /** Camera look-at target [x, y, z] */
  target: [number, number, number];
}

/** Interpolated camera state */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

// =============================================================================
// Constants
// =============================================================================

/** Duration of one full camera cycle in seconds */
const CAMERA_CYCLE_DURATION = 60;

/** Minimum camera speed multiplier */
const MIN_SPEED = 0.1;

/** Maximum camera speed multiplier */
const MAX_SPEED = 10;

/**
 * Default camera keyframes for NYC visualization.
 * Creates a smooth orbit around Lower Manhattan.
 * Data center is approximately (1800, 0, -2700).
 */
export const DEFAULT_KEYFRAMES: CameraKeyframe[] = [
  // Start: Overview from southeast
  { time: 0, position: [4500, 2000, 0], target: [1800, 0, -2700] },
  // Move to east view
  { time: 0.25, position: [5000, 1500, -2700], target: [1800, 0, -2700] },
  // Move to north view
  { time: 0.5, position: [1800, 1800, -6000], target: [1800, 0, -2700] },
  // Move to west view
  { time: 0.75, position: [-1500, 1500, -2700], target: [1800, 0, -2700] },
  // Return to start
  { time: 1, position: [4500, 2000, 0], target: [1800, 0, -2700] },
];

// =============================================================================
// Interpolation
// =============================================================================

/**
 * Interpolates between keyframes to get camera state at time t.
 *
 * @param keyframes - Array of camera keyframes sorted by time
 * @param t - Time value in [0, 1]
 * @returns Interpolated camera position and target
 */
export function interpolateKeyframes(
  keyframes: CameraKeyframe[],
  t: number
): CameraState {
  // Clamp t to [0, 1]
  const clampedT = Math.max(0, Math.min(1, t));

  // Handle edge cases
  if (keyframes.length === 0) {
    return { position: [0, 0, 0], target: [0, 0, 0] };
  }

  if (keyframes.length === 1) {
    return {
      position: [...keyframes[0]!.position],
      target: [...keyframes[0]!.target],
    };
  }

  // Find surrounding keyframes
  let beforeIndex = 0;
  let afterIndex = keyframes.length - 1;

  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i]!.time <= clampedT) {
      beforeIndex = i;
    }
    if (keyframes[i]!.time >= clampedT && afterIndex === keyframes.length - 1) {
      afterIndex = i;
      break;
    }
  }

  const before = keyframes[beforeIndex]!;
  const after = keyframes[afterIndex]!;

  // If same keyframe, return it directly
  if (beforeIndex === afterIndex || before.time === after.time) {
    return {
      position: [...before.position],
      target: [...before.target],
    };
  }

  // Calculate interpolation factor
  const segmentDuration = after.time - before.time;
  const segmentProgress = (clampedT - before.time) / segmentDuration;

  // Smooth interpolation using smoothstep
  const smoothProgress =
    segmentProgress * segmentProgress * (3 - 2 * segmentProgress);

  // Interpolate position
  const position: [number, number, number] = [
    before.position[0] + (after.position[0] - before.position[0]) * smoothProgress,
    before.position[1] + (after.position[1] - before.position[1]) * smoothProgress,
    before.position[2] + (after.position[2] - before.position[2]) * smoothProgress,
  ];

  // Interpolate target
  const target: [number, number, number] = [
    before.target[0] + (after.target[0] - before.target[0]) * smoothProgress,
    before.target[1] + (after.target[1] - before.target[1]) * smoothProgress,
    before.target[2] + (after.target[2] - before.target[2]) * smoothProgress,
  ];

  return { position, target };
}

// =============================================================================
// Context
// =============================================================================

interface CameraControllerContextValue {
  /** Current camera mode */
  mode: CameraMode;
  /** Set camera mode */
  setMode: (mode: CameraMode) => void;
  /** Toggle between auto and manual mode */
  toggleMode: () => void;

  /** Current camera time [0, 1) - independent from simulation time */
  cameraTime: number;
  /** Set camera time directly */
  setCameraTime: (t: number) => void;
  /** Advance camera time by delta */
  advanceCameraTime: (dt: number) => void;

  /** Current interpolated camera position */
  currentPosition: [number, number, number];
  /** Current interpolated camera target */
  currentTarget: [number, number, number];

  /** Whether camera animation is playing */
  isPlaying: boolean;
  /** Play camera animation */
  play: () => void;
  /** Pause camera animation */
  pause: () => void;

  /** Current playback speed multiplier */
  speed: number;
  /** Set playback speed */
  setSpeed: (speed: number) => void;
}

const CameraControllerContext =
  createContext<CameraControllerContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface CameraControllerProviderProps {
  children: ReactNode;
  /** Initial camera mode */
  initialMode?: CameraMode;
  /** Custom keyframes (defaults to DEFAULT_KEYFRAMES) */
  keyframes?: CameraKeyframe[];
}

/**
 * Wraps time value to [0, 1) range.
 */
function wrapTime(t: number): number {
  let wrapped = t % 1;
  if (wrapped < 0) {
    wrapped += 1;
  }
  return wrapped >= 1 ? 0 : wrapped;
}

/**
 * CameraControllerProvider manages camera state and animation.
 */
export function CameraControllerProvider({
  children,
  initialMode = 'auto',
  keyframes = DEFAULT_KEYFRAMES,
}: CameraControllerProviderProps) {
  const [mode, setModeState] = useState<CameraMode>(initialMode);
  const [cameraTime, setCameraTimeState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeedState] = useState(1);

  // Set mode
  const setMode = useCallback((newMode: CameraMode) => {
    setModeState(newMode);
  }, []);

  // Toggle mode
  const toggleMode = useCallback(() => {
    setModeState((prev) => (prev === 'auto' ? 'manual' : 'auto'));
  }, []);

  // Set camera time (wrapped)
  const setCameraTime = useCallback((t: number) => {
    setCameraTimeState(wrapTime(t));
  }, []);

  // Advance camera time
  const advanceCameraTime = useCallback((dt: number) => {
    setCameraTimeState((prev) => wrapTime(prev + dt));
  }, []);

  // Playback controls
  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);

  // Set speed (clamped)
  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(Math.max(MIN_SPEED, Math.min(MAX_SPEED, newSpeed)));
  }, []);

  // Compute current camera state from keyframes
  const { currentPosition, currentTarget } = useMemo(() => {
    const state = interpolateKeyframes(keyframes, cameraTime);
    return {
      currentPosition: state.position,
      currentTarget: state.target,
    };
  }, [keyframes, cameraTime]);

  // Context value
  const value = useMemo<CameraControllerContextValue>(
    () => ({
      mode,
      setMode,
      toggleMode,
      cameraTime,
      setCameraTime,
      advanceCameraTime,
      currentPosition,
      currentTarget,
      isPlaying,
      play,
      pause,
      speed,
      setSpeed,
    }),
    [
      mode,
      setMode,
      toggleMode,
      cameraTime,
      setCameraTime,
      advanceCameraTime,
      currentPosition,
      currentTarget,
      isPlaying,
      play,
      pause,
      speed,
      setSpeed,
    ]
  );

  return (
    <CameraControllerContext.Provider value={value}>
      {children}
    </CameraControllerContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access camera controller context.
 *
 * @throws Error if used outside CameraControllerProvider
 */
export function useCameraController(): CameraControllerContextValue {
  const context = useContext(CameraControllerContext);
  if (context === null) {
    throw new Error(
      'useCameraController must be used within a CameraControllerProvider'
    );
  }
  return context;
}

// =============================================================================
// Camera Controller Component (for use inside Canvas)
// =============================================================================

interface CameraControllerProps {
  /** Duration of one camera cycle in seconds */
  cycleDuration?: number;
}

/**
 * CameraController component to be used inside R3F Canvas.
 *
 * In auto mode: Animates camera along keyframes.
 * In manual mode: Enables OrbitControls for user interaction.
 *
 * Usage:
 * ```tsx
 * <Canvas>
 *   <CameraController />
 * </Canvas>
 * ```
 */
export function CameraController({
  cycleDuration = CAMERA_CYCLE_DURATION,
}: CameraControllerProps) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const {
    mode,
    cameraTime,
    advanceCameraTime,
    currentPosition,
    currentTarget,
    isPlaying,
    speed,
  } = useCameraController();

  // Temp vectors for camera updates (avoid allocations in render loop)
  const tempPosition = useRef(new THREE.Vector3());
  const tempTarget = useRef(new THREE.Vector3());

  // Update camera in auto mode
  useFrame((_, delta) => {
    // Advance camera time if playing
    if (isPlaying && mode === 'auto') {
      const deltaT = (delta / cycleDuration) * speed;
      advanceCameraTime(deltaT);
    }

    // In auto mode, update camera position
    if (mode === 'auto') {
      tempPosition.current.set(
        currentPosition[0],
        currentPosition[1],
        currentPosition[2]
      );
      tempTarget.current.set(
        currentTarget[0],
        currentTarget[1],
        currentTarget[2]
      );

      // Smoothly interpolate camera position
      camera.position.lerp(tempPosition.current, 0.05);
      camera.lookAt(tempTarget.current);

      // Update OrbitControls target if present
      if (controlsRef.current) {
        controlsRef.current.target.copy(tempTarget.current);
      }
    }
  });

  // Sync OrbitControls with camera when switching to manual mode
  useEffect(() => {
    if (mode === 'manual' && controlsRef.current) {
      controlsRef.current.target.set(
        currentTarget[0],
        currentTarget[1],
        currentTarget[2]
      );
    }
  }, [mode, currentTarget]);

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={mode === 'manual'}
      enableDamping
      dampingFactor={0.05}
      minDistance={100}
      maxDistance={10000}
      maxPolarAngle={Math.PI / 2.1}
      // screenSpacePanning=false makes pan move in horizontal (XZ) plane
      // This feels more like moving across a map rather than screen-space shifting
      screenSpacePanning={false}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
}
