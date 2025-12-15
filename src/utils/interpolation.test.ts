/**
 * Tests for polyline interpolation utilities
 *
 * TDD: These tests define the expected behavior for interpolating
 * positions along polylines (used for trains and vehicles).
 */
import { describe, it, expect } from 'vitest';
import {
  interpolatePolyline,
  getPolylineLength,
  Point3D,
} from './interpolation';

describe('getPolylineLength', () => {
  it('returns 0 for empty polyline', () => {
    expect(getPolylineLength([])).toBe(0);
  });

  it('returns 0 for single point', () => {
    const line: Point3D[] = [[0, 0, 0]];
    expect(getPolylineLength(line)).toBe(0);
  });

  it('returns correct length for horizontal line', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [100, 0, 0],
    ];
    expect(getPolylineLength(line)).toBe(100);
  });

  it('returns correct length for vertical line', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [0, 50, 0],
    ];
    expect(getPolylineLength(line)).toBe(50);
  });

  it('returns correct length for diagonal line', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [3, 4, 0], // 3-4-5 triangle
    ];
    expect(getPolylineLength(line)).toBe(5);
  });

  it('returns correct length for 3D diagonal', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [1, 2, 2], // sqrt(1 + 4 + 4) = 3
    ];
    expect(getPolylineLength(line)).toBe(3);
  });

  it('returns sum of segment lengths for multi-segment polyline', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [100, 0, 0], // segment 1: length 100
      [100, 0, 100], // segment 2: length 100
    ];
    expect(getPolylineLength(line)).toBe(200);
  });

  it('handles complex polylines', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [10, 0, 0], // 10
      [10, 20, 0], // 20
      [10, 20, 30], // 30
    ];
    expect(getPolylineLength(line)).toBe(60);
  });
});

describe('interpolatePolyline', () => {
  describe('simple two-point line', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [100, 0, 0],
    ];

    it('progress=0 returns first point', () => {
      const p = interpolatePolyline(line, 0);
      expect(p).toEqual([0, 0, 0]);
    });

    it('progress=1 returns last point', () => {
      const p = interpolatePolyline(line, 1);
      expect(p).toEqual([100, 0, 0]);
    });

    it('progress=0.5 returns midpoint', () => {
      const p = interpolatePolyline(line, 0.5);
      expect(p).toEqual([50, 0, 0]);
    });

    it('progress=0.25 returns quarter point', () => {
      const p = interpolatePolyline(line, 0.25);
      expect(p).toEqual([25, 0, 0]);
    });
  });

  describe('L-shaped polyline (two equal segments)', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [100, 0, 0], // segment 1: 100m east
      [100, 0, 100], // segment 2: 100m south (z positive)
    ];
    // Total length: 200m

    it('progress=0 returns first point', () => {
      const p = interpolatePolyline(line, 0);
      expect(p).toEqual([0, 0, 0]);
    });

    it('progress=1 returns last point', () => {
      const p = interpolatePolyline(line, 1);
      expect(p).toEqual([100, 0, 100]);
    });

    it('progress=0.5 returns corner point (midpoint of total length)', () => {
      const p = interpolatePolyline(line, 0.5);
      expect(p[0]).toBe(100);
      expect(p[1]).toBe(0);
      expect(p[2]).toBeCloseTo(0, 5);
    });

    it('progress=0.25 returns midpoint of first segment', () => {
      const p = interpolatePolyline(line, 0.25);
      expect(p).toEqual([50, 0, 0]);
    });

    it('progress=0.75 returns midpoint of second segment', () => {
      const p = interpolatePolyline(line, 0.75);
      expect(p[0]).toBe(100);
      expect(p[1]).toBe(0);
      expect(p[2]).toBeCloseTo(50, 5);
    });
  });

  describe('unequal segment lengths', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [100, 0, 0], // segment 1: 100m
      [100, 0, 200], // segment 2: 200m
    ];
    // Total length: 300m

    it('progress=1/3 is at corner (100m along 300m total)', () => {
      const p = interpolatePolyline(line, 1 / 3);
      expect(p[0]).toBeCloseTo(100, 5);
      expect(p[2]).toBeCloseTo(0, 5);
    });

    it('progress=2/3 is 100m into second segment', () => {
      const p = interpolatePolyline(line, 2 / 3);
      expect(p[0]).toBe(100);
      expect(p[2]).toBeCloseTo(100, 5);
    });
  });

  describe('clamping behavior', () => {
    const line: Point3D[] = [
      [0, 0, 0],
      [100, 0, 0],
    ];

    it('clamps progress < 0 to first point', () => {
      expect(interpolatePolyline(line, -0.5)).toEqual([0, 0, 0]);
      expect(interpolatePolyline(line, -100)).toEqual([0, 0, 0]);
    });

    it('clamps progress > 1 to last point', () => {
      expect(interpolatePolyline(line, 1.5)).toEqual([100, 0, 0]);
      expect(interpolatePolyline(line, 100)).toEqual([100, 0, 0]);
    });
  });

  describe('edge cases', () => {
    it('handles single-point polyline', () => {
      const line: Point3D[] = [[50, 10, 20]];
      expect(interpolatePolyline(line, 0)).toEqual([50, 10, 20]);
      expect(interpolatePolyline(line, 0.5)).toEqual([50, 10, 20]);
      expect(interpolatePolyline(line, 1)).toEqual([50, 10, 20]);
    });

    it('handles empty polyline gracefully', () => {
      // Should return origin or handle gracefully
      const p = interpolatePolyline([], 0.5);
      expect(p).toEqual([0, 0, 0]);
    });

    it('handles polyline with duplicate points', () => {
      const line: Point3D[] = [
        [0, 0, 0],
        [0, 0, 0], // duplicate
        [100, 0, 0],
      ];
      // Total length is 100 (second segment only)
      const p = interpolatePolyline(line, 0.5);
      expect(p[0]).toBeCloseTo(50, 5);
    });
  });

  describe('3D interpolation', () => {
    it('interpolates all three dimensions', () => {
      const line: Point3D[] = [
        [0, 0, 0],
        [100, 50, 200],
      ];

      const mid = interpolatePolyline(line, 0.5);
      expect(mid[0]).toBeCloseTo(50, 5);
      expect(mid[1]).toBeCloseTo(25, 5);
      expect(mid[2]).toBeCloseTo(100, 5);
    });

    it('handles negative coordinates', () => {
      const line: Point3D[] = [
        [-100, -50, -200],
        [100, 50, 200],
      ];

      const mid = interpolatePolyline(line, 0.5);
      expect(mid[0]).toBeCloseTo(0, 5);
      expect(mid[1]).toBeCloseTo(0, 5);
      expect(mid[2]).toBeCloseTo(0, 5);
    });
  });

  describe('real-world subway line scenario', () => {
    // Simulates a subway line with multiple stations
    const subwayLine: Point3D[] = [
      [1100, -18, 200], // Station A
      [1100, -18, 500], // Station B
      [1150, -18, 800], // Station C
      [1200, -18, 1100], // Station D
      [1250, -18, 1400], // Station E
    ];

    it('train at progress=0 is at first station', () => {
      const pos = interpolatePolyline(subwayLine, 0);
      expect(pos).toEqual([1100, -18, 200]);
    });

    it('train at progress=1 is at last station', () => {
      const pos = interpolatePolyline(subwayLine, 1);
      expect(pos).toEqual([1250, -18, 1400]);
    });

    it('train maintains y-coordinate (depth) throughout', () => {
      for (let p = 0; p <= 1; p += 0.1) {
        const pos = interpolatePolyline(subwayLine, p);
        expect(pos[1]).toBe(-18);
      }
    });
  });
});
