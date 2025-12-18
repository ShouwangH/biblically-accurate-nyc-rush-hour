/**
 * Tests for Simulation Time System
 *
 * TDD: These tests define the expected behavior for useSimulationTime hook.
 *
 * Key behaviors:
 * - Time advances from 0 toward 1 representing a full 24-hour cycle
 * - t wraps from ~1 back to 0 (never equals 1)
 * - Play/pause controls time advancement
 * - setTime allows scrubbing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// Will be implemented
import {
  SimulationTimeProvider,
  useSimulationTime,
  DEFAULT_CYCLE_DURATION_SECONDS,
} from '../hooks/useSimulationTime';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Creates a wrapper component for testing hooks that need SimulationTimeProvider
 */
function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(SimulationTimeProvider, null, children);
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useSimulationTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('context requirement', () => {
    it('throws if useSimulationTime called outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useSimulationTime());
      }).toThrow('useSimulationTime must be used within a SimulationTimeProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('initial state', () => {
    it('starts at t=0', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      expect(result.current.t).toBe(0);
    });

    it('starts in playing state', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isPlaying).toBe(true);
    });

    it('has default speed multiplier of 1', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      expect(result.current.speed).toBe(1);
    });
  });

  describe('time boundaries', () => {
    it('t never reaches or exceeds 1', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // Set time to just below 1
      act(() => {
        result.current.setTime(0.9999);
      });
      expect(result.current.t).toBeLessThan(1);

      // Set time to exactly 1 - should wrap to 0
      act(() => {
        result.current.setTime(1);
      });
      expect(result.current.t).toBe(0);

      // Set time beyond 1 - should wrap
      act(() => {
        result.current.setTime(1.5);
      });
      expect(result.current.t).toBeCloseTo(0.5, 5);
    });

    it('t never goes negative', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // Set negative time - should wrap to valid range
      act(() => {
        result.current.setTime(-0.1);
      });
      expect(result.current.t).toBeGreaterThanOrEqual(0);
      expect(result.current.t).toBeCloseTo(0.9, 5);
    });
  });

  describe('play/pause', () => {
    it('pause stops time advancement', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPlaying).toBe(false);

      const timeBeforePause = result.current.t;

      // Advance timers
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Time should not have changed
      expect(result.current.t).toBe(timeBeforePause);
    });

    it('play resumes time advancement', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // Pause, then play
      act(() => {
        result.current.pause();
      });

      act(() => {
        result.current.play();
      });

      expect(result.current.isPlaying).toBe(true);
    });

    it('toggle switches between play and pause', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isPlaying).toBe(true);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isPlaying).toBe(false);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isPlaying).toBe(true);
    });
  });

  describe('setTime (scrubbing)', () => {
    it('setTime updates t immediately', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTime(0.5);
      });

      expect(result.current.t).toBe(0.5);
    });

    it('setTime works while paused', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.pause();
        result.current.setTime(0.75);
      });

      expect(result.current.t).toBe(0.75);
      expect(result.current.isPlaying).toBe(false);
    });
  });

  describe('speed control', () => {
    it('setSpeed updates speed multiplier', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSpeed(2);
      });

      expect(result.current.speed).toBe(2);
    });

    it('setSpeed clamps to valid range (0.1 to 10)', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSpeed(0.01);
      });
      expect(result.current.speed).toBeGreaterThanOrEqual(0.1);

      act(() => {
        result.current.setSpeed(100);
      });
      expect(result.current.speed).toBeLessThanOrEqual(10);
    });
  });

  describe('time advancement', () => {
    it('advances time when playing', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      const initialT = result.current.t;

      // Advance by 1 second at default speed
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.t).toBeGreaterThan(initialT);
    });

    it('wraps from ~1 back to 0', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // Set time very close to 1
      act(() => {
        result.current.setTime(0.999);
      });

      // Advance enough to wrap
      act(() => {
        // Advance by enough time to ensure wrap
        vi.advanceTimersByTime(DEFAULT_CYCLE_DURATION_SECONDS * 10);
      });

      // Should have wrapped
      expect(result.current.t).toBeGreaterThanOrEqual(0);
      expect(result.current.t).toBeLessThan(1);
    });
  });

  describe('slice index', () => {
    it('provides current slice index (0-59)', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // At t=0, slice should be 0
      expect(result.current.sliceIndex).toBe(0);

      // At t=0.5, slice should be 30
      act(() => {
        result.current.setTime(0.5);
      });
      expect(result.current.sliceIndex).toBe(30);

      // At t=0.999, slice should be 59
      act(() => {
        result.current.setTime(0.999);
      });
      expect(result.current.sliceIndex).toBe(59);
    });

    it('slice index never reaches 60', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTime(0.9999);
      });

      expect(result.current.sliceIndex).toBeLessThanOrEqual(59);
    });
  });

  describe('display time', () => {
    it('provides displayTime as HH:MM format', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // t=0 should be 00:00
      expect(result.current.displayTime).toBe('00:00');

      // t=0.5 should be 12:00
      act(() => {
        result.current.setTime(0.5);
      });
      expect(result.current.displayTime).toBe('12:00');

      // t=0.75 should be 18:00
      act(() => {
        result.current.setTime(0.75);
      });
      expect(result.current.displayTime).toBe('18:00');
    });
  });
});

describe('DEFAULT_CYCLE_DURATION_SECONDS', () => {
  it('is exported and has a reasonable value', () => {
    // Default cycle is the time for one full day simulation
    // Typically 60-300 seconds for a visualization
    expect(DEFAULT_CYCLE_DURATION_SECONDS).toBeGreaterThan(0);
    expect(DEFAULT_CYCLE_DURATION_SECONDS).toBeLessThanOrEqual(600);
  });
});

// =============================================================================
// 24-Hour Time Model Tests (PR 4)
// =============================================================================

describe('24-Hour Time Model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('hourFloat', () => {
    it('provides hour as float [0, 24)', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // t=0 should be hour 0
      expect(result.current.hourFloat).toBe(0);

      // t=0.5 should be hour 12
      act(() => {
        result.current.setTime(0.5);
      });
      expect(result.current.hourFloat).toBe(12);

      // t=0.75 should be hour 18
      act(() => {
        result.current.setTime(0.75);
      });
      expect(result.current.hourFloat).toBe(18);

      // t=0.25 should be hour 6
      act(() => {
        result.current.setTime(0.25);
      });
      expect(result.current.hourFloat).toBe(6);
    });

    it('includes fractional hours', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // t = 0.5 + 0.5/24 = 12:30 = 12.5 hours
      act(() => {
        result.current.setTime(0.5 + 0.5 / 24);
      });
      expect(result.current.hourFloat).toBeCloseTo(12.5, 2);
    });
  });

  describe('bucketIndex (15-minute buckets)', () => {
    it('provides bucket index [0, 95] for 15-minute intervals', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // t=0 should be bucket 0 (00:00-00:15)
      expect(result.current.bucketIndex).toBe(0);

      // t=0.5 should be bucket 48 (12:00-12:15)
      act(() => {
        result.current.setTime(0.5);
      });
      expect(result.current.bucketIndex).toBe(48);

      // t=0.75 should be bucket 72 (18:00-18:15)
      act(() => {
        result.current.setTime(0.75);
      });
      expect(result.current.bucketIndex).toBe(72);
    });

    it('bucket index never exceeds 95', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTime(0.9999);
      });
      expect(result.current.bucketIndex).toBeLessThanOrEqual(95);
    });

    it('covers 96 buckets for full day', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // 96 buckets × 15 minutes = 1440 minutes = 24 hours
      // Test boundaries
      const bucketsPerHour = 4;

      // Start of each hour
      for (let hour = 0; hour < 24; hour++) {
        const t = hour / 24;
        act(() => {
          result.current.setTime(t);
        });
        expect(result.current.bucketIndex).toBe(hour * bucketsPerHour);
      }
    });
  });

  describe('bucketAlpha (lerp between buckets)', () => {
    it('provides alpha [0, 1) for smooth interpolation', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // At bucket boundary, alpha should be 0
      act(() => {
        result.current.setTime(0); // Start of bucket 0
      });
      expect(result.current.bucketAlpha).toBe(0);

      // Halfway through bucket, alpha should be ~0.5
      act(() => {
        // 7.5 minutes into 15-minute bucket
        // 7.5 / 1440 = 0.00521 (7.5 minutes of 1440 total)
        result.current.setTime(7.5 / 1440);
      });
      expect(result.current.bucketAlpha).toBeCloseTo(0.5, 1);
    });

    it('alpha never reaches 1', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // Just before bucket boundary
      act(() => {
        result.current.setTime(14.9 / 1440); // 14.9 minutes, just before 15
      });
      expect(result.current.bucketAlpha).toBeLessThan(1);
    });

    it('resets to 0 at each bucket boundary', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // At bucket 1 boundary (15 minutes)
      act(() => {
        result.current.setTime(15 / 1440);
      });
      expect(result.current.bucketIndex).toBe(1);
      expect(result.current.bucketAlpha).toBeCloseTo(0, 2);
    });
  });

  describe('tDay (seconds since midnight)', () => {
    it('provides seconds since midnight [0, 86400)', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      // t=0 should be 0 seconds
      expect(result.current.tDay).toBe(0);

      // t=0.5 should be 43200 seconds (12 hours)
      act(() => {
        result.current.setTime(0.5);
      });
      expect(result.current.tDay).toBe(43200);

      // t=1/24 should be 3600 seconds (1 hour)
      act(() => {
        result.current.setTime(1 / 24);
      });
      expect(result.current.tDay).toBe(3600);
    });

    it('tDay never reaches 86400', () => {
      const { result } = renderHook(() => useSimulationTime(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTime(0.9999);
      });
      expect(result.current.tDay).toBeLessThan(86400);
    });
  });
});
