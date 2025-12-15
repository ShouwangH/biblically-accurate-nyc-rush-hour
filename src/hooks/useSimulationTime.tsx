/**
 * Simulation Time System
 *
 * Provides a simulation time context for the visualization.
 * Time t is a value in [0, 1) representing the progress through a 24-hour cycle.
 *
 * Key features:
 * - Time advances automatically when playing
 * - Wraps from ~1 back to 0 (never equals 1)
 * - Play/pause/scrub controls
 * - Speed multiplier for faster/slower playback
 * - Derived values: sliceIndex (0-59), displayTime (HH:MM)
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { getSliceIndex } from '../utils/sliceIndex';

// =============================================================================
// Constants
// =============================================================================

/** Number of seconds for one full simulation cycle (24 hours) */
export const DEFAULT_CYCLE_DURATION_SECONDS = 120;

/** Minimum speed multiplier */
const MIN_SPEED = 0.1;

/** Maximum speed multiplier */
const MAX_SPEED = 10;

// =============================================================================
// Types
// =============================================================================

interface SimulationTimeContextValue {
  /** Current simulation time [0, 1) */
  t: number;

  /** Whether the simulation is playing */
  isPlaying: boolean;

  /** Current speed multiplier */
  speed: number;

  /** Current slice index (0-59) derived from t */
  sliceIndex: number;

  /** Human-readable time display (HH:MM) */
  displayTime: string;

  /** Start/resume time advancement */
  play: () => void;

  /** Pause time advancement */
  pause: () => void;

  /** Toggle between play and pause */
  toggle: () => void;

  /** Set time directly (for scrubbing) */
  setTime: (t: number) => void;

  /** Set speed multiplier */
  setSpeed: (speed: number) => void;
}

// =============================================================================
// Context
// =============================================================================

const SimulationTimeContext = createContext<SimulationTimeContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SimulationTimeProviderProps {
  children: ReactNode;
  /** Initial time [0, 1), defaults to 0 */
  initialTime?: number;
  /** Initial playing state, defaults to true */
  initialPlaying?: boolean;
  /** Cycle duration in seconds, defaults to DEFAULT_CYCLE_DURATION_SECONDS */
  cycleDuration?: number;
}

/**
 * Wraps time value to [0, 1) range
 */
function wrapTime(t: number): number {
  // Handle negative values
  let wrapped = t % 1;
  if (wrapped < 0) {
    wrapped += 1;
  }
  // Ensure we never hit exactly 1
  return wrapped >= 1 ? 0 : wrapped;
}

/**
 * Converts t [0, 1) to display time string (HH:MM)
 */
function formatDisplayTime(t: number): string {
  const totalMinutes = t * 24 * 60; // t * 1440 minutes
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * SimulationTimeProvider manages the simulation clock for the visualization.
 *
 * Usage:
 * ```tsx
 * <SimulationTimeProvider>
 *   <App />
 * </SimulationTimeProvider>
 * ```
 */
export function SimulationTimeProvider({
  children,
  initialTime = 0,
  initialPlaying = true,
  cycleDuration = DEFAULT_CYCLE_DURATION_SECONDS,
}: SimulationTimeProviderProps) {
  const [t, setT] = useState(() => wrapTime(initialTime));
  const [isPlaying, setIsPlaying] = useState(initialPlaying);
  const [speed, setSpeedState] = useState(1);

  // Track last update time for animation frame
  const lastUpdateRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Clamp speed to valid range
  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(Math.max(MIN_SPEED, Math.min(MAX_SPEED, newSpeed)));
  }, []);

  // Play/pause controls
  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
    lastUpdateRef.current = null;
  }, []);

  const toggle = useCallback(() => {
    setIsPlaying((prev) => {
      if (prev) {
        lastUpdateRef.current = null;
      }
      return !prev;
    });
  }, []);

  // Set time directly (wraps to valid range)
  const setTime = useCallback((newT: number) => {
    setT(wrapTime(newT));
  }, []);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const tick = (timestamp: number) => {
      if (lastUpdateRef.current === null) {
        lastUpdateRef.current = timestamp;
      }

      const deltaMs = timestamp - lastUpdateRef.current;
      lastUpdateRef.current = timestamp;

      // Calculate time advancement
      // t advances by (deltaMs / 1000) / cycleDuration * speed
      const deltaT = (deltaMs / 1000 / cycleDuration) * speed;

      setT((prevT) => wrapTime(prevT + deltaT));

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, speed, cycleDuration]);

  // Derived values
  const sliceIndex = useMemo(() => getSliceIndex(t), [t]);
  const displayTime = useMemo(() => formatDisplayTime(t), [t]);

  // Context value
  const value = useMemo<SimulationTimeContextValue>(
    () => ({
      t,
      isPlaying,
      speed,
      sliceIndex,
      displayTime,
      play,
      pause,
      toggle,
      setTime,
      setSpeed,
    }),
    [t, isPlaying, speed, sliceIndex, displayTime, play, pause, toggle, setTime, setSpeed]
  );

  return <SimulationTimeContext.Provider value={value}>{children}</SimulationTimeContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access simulation time context.
 *
 * Must be used within a SimulationTimeProvider.
 *
 * @returns SimulationTimeContextValue
 * @throws Error if used outside provider
 */
export function useSimulationTime(): SimulationTimeContextValue {
  const context = useContext(SimulationTimeContext);
  if (context === null) {
    throw new Error('useSimulationTime must be used within a SimulationTimeProvider');
  }
  return context;
}
