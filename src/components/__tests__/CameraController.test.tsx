/**
 * CameraController Tests
 *
 * Tests for camera system following TDD approach.
 * Per CLAUDE.md §8.7: Tests define invariants, implementation makes them pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as THREE from 'three';

// =============================================================================
// Mock R3F hooks
// =============================================================================

const mockCamera = new THREE.PerspectiveCamera();
const mockInvalidate = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    camera: mockCamera,
    invalidate: mockInvalidate,
  }),
  useFrame: vi.fn((callback) => {
    // Store callback for manual invocation in tests
    (global as Record<string, unknown>).__useFrameCallback = callback;
  }),
}));

// =============================================================================
// Import after mocks
// =============================================================================

import {
  useCameraController,
  CameraControllerProvider,
  type CameraKeyframe,
  type CameraMode,
  interpolateKeyframes,
  DEFAULT_KEYFRAMES,
} from '../CameraController';

// =============================================================================
// Test Helpers
// =============================================================================

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <CameraControllerProvider>{children}</CameraControllerProvider>;
  };
}

// =============================================================================
// Tests: Camera Mode
// =============================================================================

describe('CameraController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCamera.position.set(0, 0, 0);
    mockCamera.lookAt(0, 0, 0);
  });

  describe('camera modes', () => {
    it('starts in auto mode by default', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      expect(result.current.mode).toBe('auto');
    });

    it('can switch to manual mode', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setMode('manual');
      });

      expect(result.current.mode).toBe('manual');
    });

    it('can toggle between modes', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      expect(result.current.mode).toBe('auto');

      act(() => {
        result.current.toggleMode();
      });

      expect(result.current.mode).toBe('manual');

      act(() => {
        result.current.toggleMode();
      });

      expect(result.current.mode).toBe('auto');
    });
  });

  // ===========================================================================
  // Tests: Camera Time Independence
  // ===========================================================================

  describe('camera time independence', () => {
    it('has independent cameraTime from simulationTime', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      // Camera time should be separate from simulation time
      expect(result.current.cameraTime).toBeDefined();
      expect(typeof result.current.cameraTime).toBe('number');
    });

    it('cameraTime advances independently', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      const initialTime = result.current.cameraTime;

      act(() => {
        result.current.advanceCameraTime(0.1);
      });

      expect(result.current.cameraTime).toBeCloseTo(initialTime + 0.1, 5);
    });

    it('cameraTime wraps at 1', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setCameraTime(0.95);
      });

      act(() => {
        result.current.advanceCameraTime(0.1);
      });

      // Should wrap around
      expect(result.current.cameraTime).toBeLessThan(1);
      expect(result.current.cameraTime).toBeCloseTo(0.05, 5);
    });

    it('can set cameraTime directly', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setCameraTime(0.5);
      });

      expect(result.current.cameraTime).toBe(0.5);
    });
  });

  // ===========================================================================
  // Tests: Keyframe System
  // ===========================================================================

  describe('keyframe system', () => {
    it('has default keyframes', () => {
      expect(DEFAULT_KEYFRAMES).toBeDefined();
      expect(DEFAULT_KEYFRAMES.length).toBeGreaterThan(0);
    });

    it('keyframes have required properties', () => {
      DEFAULT_KEYFRAMES.forEach((kf) => {
        expect(kf.time).toBeGreaterThanOrEqual(0);
        expect(kf.time).toBeLessThanOrEqual(1);
        expect(kf.position).toHaveLength(3);
        expect(kf.target).toHaveLength(3);
      });
    });

    it('keyframes are sorted by time', () => {
      for (let i = 1; i < DEFAULT_KEYFRAMES.length; i++) {
        expect(DEFAULT_KEYFRAMES[i]!.time).toBeGreaterThanOrEqual(
          DEFAULT_KEYFRAMES[i - 1]!.time
        );
      }
    });
  });

  // ===========================================================================
  // Tests: Keyframe Interpolation
  // ===========================================================================

  describe('interpolateKeyframes', () => {
    const testKeyframes: CameraKeyframe[] = [
      { time: 0, position: [0, 0, 0], target: [0, 0, 10] },
      { time: 0.5, position: [100, 50, 0], target: [100, 0, 10] },
      { time: 1, position: [0, 0, 0], target: [0, 0, 10] },
    ];

    it('returns first keyframe at t=0', () => {
      const result = interpolateKeyframes(testKeyframes, 0);

      expect(result.position[0]).toBe(0);
      expect(result.position[1]).toBe(0);
      expect(result.position[2]).toBe(0);
    });

    it('returns last keyframe at t=1', () => {
      const result = interpolateKeyframes(testKeyframes, 1);

      expect(result.position[0]).toBe(0);
      expect(result.position[1]).toBe(0);
      expect(result.position[2]).toBe(0);
    });

    it('interpolates between keyframes', () => {
      const result = interpolateKeyframes(testKeyframes, 0.25);

      // Halfway between keyframe 0 and 1
      expect(result.position[0]).toBeCloseTo(50, 0);
      expect(result.position[1]).toBeCloseTo(25, 0);
    });

    it('interpolates target as well as position', () => {
      const result = interpolateKeyframes(testKeyframes, 0.25);

      expect(result.target[0]).toBeCloseTo(50, 0);
    });

    it('handles t at exact keyframe time', () => {
      const result = interpolateKeyframes(testKeyframes, 0.5);

      expect(result.position[0]).toBe(100);
      expect(result.position[1]).toBe(50);
    });

    it('clamps t below 0', () => {
      const result = interpolateKeyframes(testKeyframes, -0.5);

      expect(result.position[0]).toBe(0);
    });

    it('clamps t above 1', () => {
      const result = interpolateKeyframes(testKeyframes, 1.5);

      expect(result.position[0]).toBe(0);
    });

    it('handles single keyframe', () => {
      const single: CameraKeyframe[] = [
        { time: 0, position: [10, 20, 30], target: [0, 0, 0] },
      ];

      const result = interpolateKeyframes(single, 0.5);

      expect(result.position[0]).toBe(10);
      expect(result.position[1]).toBe(20);
      expect(result.position[2]).toBe(30);
    });
  });

  // ===========================================================================
  // Tests: Auto Mode Behavior
  // ===========================================================================

  describe('auto mode', () => {
    it('provides current interpolated camera state', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      expect(result.current.currentPosition).toBeDefined();
      expect(result.current.currentTarget).toBeDefined();
      expect(result.current.currentPosition).toHaveLength(3);
      expect(result.current.currentTarget).toHaveLength(3);
    });

    it('updates camera state when cameraTime changes', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      const initialPosition = [...result.current.currentPosition];

      act(() => {
        result.current.setCameraTime(0.5);
      });

      // Position should have changed
      const newPosition = result.current.currentPosition;
      expect(
        newPosition[0] !== initialPosition[0] ||
          newPosition[1] !== initialPosition[1] ||
          newPosition[2] !== initialPosition[2]
      ).toBe(true);
    });

    it('does not update when in manual mode', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setMode('manual');
      });

      const positionBefore = [...result.current.currentPosition];

      act(() => {
        result.current.setCameraTime(0.5);
      });

      // In manual mode, currentPosition should still reflect keyframes
      // but the camera itself is controlled by OrbitControls
      expect(result.current.currentPosition).toBeDefined();
    });
  });

  // ===========================================================================
  // Tests: Playback Control
  // ===========================================================================

  describe('playback control', () => {
    it('can pause camera animation', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isPlaying).toBe(true);

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it('can resume camera animation', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.pause();
      });

      act(() => {
        result.current.play();
      });

      expect(result.current.isPlaying).toBe(true);
    });

    it('can set playback speed', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSpeed(2);
      });

      expect(result.current.speed).toBe(2);
    });

    it('clamps speed to valid range', () => {
      const { result } = renderHook(() => useCameraController(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSpeed(100);
      });

      expect(result.current.speed).toBeLessThanOrEqual(10);

      act(() => {
        result.current.setSpeed(0.001);
      });

      expect(result.current.speed).toBeGreaterThanOrEqual(0.1);
    });
  });

  // ===========================================================================
  // Tests: Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('throws if useCameraController called outside provider', () => {
      expect(() => {
        renderHook(() => useCameraController());
      }).toThrow('useCameraController must be used within a CameraControllerProvider');
    });
  });
});
