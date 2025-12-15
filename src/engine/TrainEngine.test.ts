/**
 * Tests for TrainEngine
 *
 * TDD: These tests define the expected behavior for active train computation.
 *
 * The TrainEngine is a pure TypeScript class that:
 * - Filters trains to only those active at a given simulation time
 * - Computes progress along the segment based on time
 * - Reverses progress for direction=-1 trains
 * - Computes 3D position using segment polyline
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TrainEngine, ActiveTrain } from './TrainEngine';
import type { TrainRun, SubwayLine, Point3D } from '../data/types';

// =============================================================================
// Test Data
// =============================================================================

/**
 * Mock subway line with a simple segment for testing.
 * Segment is a straight line from [0,0,0] to [100,0,0] (100m long).
 */
const mockLine: SubwayLine = {
  id: 'A',
  name: 'A Train',
  color: '#0039A6',
  glowColor: '#4A90D9',
  depth: -18,
  segments: [
    {
      points: [
        [0, -18, 0],
        [100, -18, 0],
      ] as Point3D[],
    },
  ],
};

/**
 * Mock subway line with multiple segments.
 */
const mockLineWithFork: SubwayLine = {
  id: 'B',
  name: 'B Train',
  color: '#FF6319',
  glowColor: '#FF9966',
  depth: -20,
  segments: [
    {
      // Segment 0: straight line 200m
      points: [
        [0, -20, 0],
        [200, -20, 0],
      ] as Point3D[],
    },
    {
      // Segment 1: L-shaped path 100m + 100m = 200m total
      points: [
        [0, -20, 0],
        [100, -20, 0],
        [100, -20, 100],
      ] as Point3D[],
    },
  ],
};

/**
 * Mock train runs for testing.
 */
const mockTrains: TrainRun[] = [
  // Train 1: Active from t=0 to t=0.5, direction +1 (forward)
  {
    id: 't1',
    lineId: 'A',
    segmentIndex: 0,
    direction: 1,
    tEnter: 0,
    tExit: 0.5,
    crowding: 0.8,
  },
  // Train 2: Active from t=0.3 to t=0.8, direction -1 (backward)
  {
    id: 't2',
    lineId: 'A',
    segmentIndex: 0,
    direction: -1,
    tEnter: 0.3,
    tExit: 0.8,
    crowding: 0.5,
  },
  // Train 3: Active from t=0.6 to t=0.9
  {
    id: 't3',
    lineId: 'A',
    segmentIndex: 0,
    direction: 1,
    tEnter: 0.6,
    tExit: 0.9,
    crowding: 0.3,
  },
  // Train 4: On a different line segment
  {
    id: 't4',
    lineId: 'B',
    segmentIndex: 1,
    direction: 1,
    tEnter: 0.2,
    tExit: 0.7,
    crowding: 0.6,
  },
];

const mockLines: SubwayLine[] = [mockLine, mockLineWithFork];

// =============================================================================
// Tests
// =============================================================================

describe('TrainEngine', () => {
  let engine: TrainEngine;

  beforeEach(() => {
    engine = new TrainEngine(mockTrains, mockLines);
  });

  describe('constructor', () => {
    it('creates an engine with trains and lines', () => {
      expect(engine).toBeDefined();
    });

    it('handles empty trains array', () => {
      const emptyEngine = new TrainEngine([], mockLines);
      expect(emptyEngine.getActiveTrains(0.5)).toEqual([]);
    });

    it('handles empty lines array', () => {
      // Should not throw, just won't find line data
      const noLinesEngine = new TrainEngine(mockTrains, []);
      expect(noLinesEngine).toBeDefined();
    });
  });

  describe('getActiveTrains - time filtering', () => {
    it('returns only active trains for given time', () => {
      // At t=0.1, only t1 is active
      const active = engine.getActiveTrains(0.1);
      expect(active.map((t) => t.id)).toEqual(['t1']);
    });

    it('returns multiple active trains when time windows overlap', () => {
      // At t=0.4, t1 (0-0.5), t2 (0.3-0.8), and t4 (0.2-0.7) are active
      const active = engine.getActiveTrains(0.4);
      const ids = active.map((t) => t.id);
      expect(ids).toContain('t1');
      expect(ids).toContain('t2');
      expect(ids).toContain('t4');
      expect(ids).toHaveLength(3);
    });

    it('returns correct trains as time progresses', () => {
      // At t=0.6, t2 (0.3-0.8) and t3 (0.6-0.9) are active, t1 has exited
      const active = engine.getActiveTrains(0.6);
      const ids = active.map((t) => t.id);
      expect(ids).not.toContain('t1');
      expect(ids).toContain('t2');
      expect(ids).toContain('t3');
    });

    it('includes trains at exact entry time', () => {
      // At t=0, t1 should be active (tEnter=0)
      const active = engine.getActiveTrains(0);
      expect(active.map((t) => t.id)).toContain('t1');
    });

    it('excludes trains at exact exit time', () => {
      // At t=0.5, t1 should NOT be active (tExit=0.5, exclusive)
      const active = engine.getActiveTrains(0.5);
      expect(active.map((t) => t.id)).not.toContain('t1');
    });

    it('returns empty array when no trains active', () => {
      // At t=0.95, no trains active
      const active = engine.getActiveTrains(0.95);
      expect(active).toEqual([]);
    });
  });

  describe('progress computation', () => {
    it('computes correct progress for direction=+1', () => {
      // t1: tEnter=0, tExit=0.5, direction=1
      // At t=0.25, progress = (0.25 - 0) / (0.5 - 0) = 0.5
      const active = engine.getActiveTrains(0.25);
      const t1 = active.find((t) => t.id === 't1')!;
      expect(t1.progress).toBeCloseTo(0.5, 5);
    });

    it('computes progress=0 at entry time', () => {
      const active = engine.getActiveTrains(0);
      const t1 = active.find((t) => t.id === 't1')!;
      expect(t1.progress).toBeCloseTo(0, 5);
    });

    it('computes progress approaching 1 near exit time', () => {
      // Just before t=0.5 (exit time for t1)
      const active = engine.getActiveTrains(0.499);
      const t1 = active.find((t) => t.id === 't1')!;
      expect(t1.progress).toBeGreaterThan(0.99);
      expect(t1.progress).toBeLessThan(1);
    });

    it('reverses progress for direction=-1', () => {
      // t2: tEnter=0.3, tExit=0.8, direction=-1
      // At t=0.55, rawProgress = (0.55 - 0.3) / (0.8 - 0.3) = 0.5
      // Reversed: 1 - 0.5 = 0.5 (same in this case)
      const active = engine.getActiveTrains(0.55);
      const t2 = active.find((t) => t.id === 't2')!;

      // Raw progress would be 0.5, reversed is 1 - 0.5 = 0.5
      expect(t2.progress).toBeCloseTo(0.5, 5);
    });

    it('direction=-1 starts at progress=1 (end of segment)', () => {
      // t2 at tEnter=0.3: rawProgress = 0, reversed = 1
      const active = engine.getActiveTrains(0.3);
      const t2 = active.find((t) => t.id === 't2')!;
      expect(t2.progress).toBeCloseTo(1, 5);
    });

    it('direction=-1 ends at progress=0 (start of segment)', () => {
      // t2 approaching tExit=0.8: rawProgress ~= 1, reversed ~= 0
      const active = engine.getActiveTrains(0.799);
      const t2 = active.find((t) => t.id === 't2')!;
      expect(t2.progress).toBeLessThan(0.01);
    });
  });

  describe('position computation', () => {
    it('computes position at start of segment', () => {
      // t1 at t=0: progress=0, position should be first point of segment
      const active = engine.getActiveTrains(0);
      const t1 = active.find((t) => t.id === 't1')!;

      expect(t1.position[0]).toBeCloseTo(0, 1);
      expect(t1.position[1]).toBeCloseTo(-18, 1);
      expect(t1.position[2]).toBeCloseTo(0, 1);
    });

    it('computes position at midpoint of segment', () => {
      // t1 at t=0.25: progress=0.5, position should be midpoint [50, -18, 0]
      const active = engine.getActiveTrains(0.25);
      const t1 = active.find((t) => t.id === 't1')!;

      expect(t1.position[0]).toBeCloseTo(50, 1);
      expect(t1.position[1]).toBeCloseTo(-18, 1);
      expect(t1.position[2]).toBeCloseTo(0, 1);
    });

    it('computes position on L-shaped segment', () => {
      // t4 uses segment 1 of line B (L-shaped, 200m total)
      // t4: tEnter=0.2, tExit=0.7, at t=0.45 progress=0.5
      // Halfway along L-shaped path should be at corner [100, -20, 0]
      const active = engine.getActiveTrains(0.45);
      const t4 = active.find((t) => t.id === 't4')!;

      expect(t4.position[0]).toBeCloseTo(100, 1);
      expect(t4.position[1]).toBeCloseTo(-20, 1);
      expect(t4.position[2]).toBeCloseTo(0, 1);
    });
  });

  describe('ActiveTrain data', () => {
    it('includes train id', () => {
      const active = engine.getActiveTrains(0.1);
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe('t1');
    });

    it('includes line id', () => {
      const active = engine.getActiveTrains(0.1);
      expect(active).toHaveLength(1);
      expect(active[0]!.lineId).toBe('A');
    });

    it('includes line color', () => {
      const active = engine.getActiveTrains(0.1);
      expect(active).toHaveLength(1);
      expect(active[0]!.color).toBe('#0039A6');
    });

    it('includes crowding value', () => {
      const active = engine.getActiveTrains(0.1);
      expect(active).toHaveLength(1);
      expect(active[0]!.crowding).toBe(0.8);
    });

    it('includes direction', () => {
      const active = engine.getActiveTrains(0.1);
      expect(active).toHaveLength(1);
      expect(active[0]!.direction).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles trains with missing line data gracefully', () => {
      const trainsWithBadLine: TrainRun[] = [
        {
          id: 'bad1',
          lineId: 'NONEXISTENT',
          segmentIndex: 0,
          direction: 1,
          tEnter: 0,
          tExit: 0.5,
          crowding: 0.5,
        },
      ];

      const engine = new TrainEngine(trainsWithBadLine, mockLines);
      const active = engine.getActiveTrains(0.1);

      // Should either skip the train or return it with null/default position
      // We'll require it to be skipped for safety
      expect(active).toEqual([]);
    });

    it('handles trains with out-of-range segment index', () => {
      const trainsWithBadSegment: TrainRun[] = [
        {
          id: 'bad2',
          lineId: 'A',
          segmentIndex: 99, // Line A only has segment 0
          direction: 1,
          tEnter: 0,
          tExit: 0.5,
          crowding: 0.5,
        },
      ];

      const engine = new TrainEngine(trainsWithBadSegment, mockLines);
      const active = engine.getActiveTrains(0.1);

      // Should skip invalid trains
      expect(active).toEqual([]);
    });

    it('handles time wrapping across t=0 boundary', () => {
      // Train that wraps: enters at t=0.9, exits at t=0.1 (next cycle)
      // Note: Our current model doesn't support wrapping, so this tests
      // that such trains are handled (either split into two or use tExit > 1)
      const wrappingTrains: TrainRun[] = [
        {
          id: 'wrap1',
          lineId: 'A',
          segmentIndex: 0,
          direction: 1,
          tEnter: 0.9,
          tExit: 1.1, // Uses > 1 convention
          crowding: 0.5,
        },
      ];

      const engine = new TrainEngine(wrappingTrains, mockLines);

      // At t=0.95, should be active
      const active1 = engine.getActiveTrains(0.95);
      expect(active1.map((t) => t.id)).toContain('wrap1');

      // At t=0.05 (0.05 + 1 conceptually), may or may not be active
      // depending on implementation - we'll accept either behavior
    });
  });
});

describe('ActiveTrain type', () => {
  it('has required properties', () => {
    // TypeScript compile-time check - if this compiles, the type is correct
    const train: ActiveTrain = {
      id: 'test',
      lineId: 'A',
      position: [0, 0, 0],
      progress: 0.5,
      direction: 1,
      crowding: 0.5,
      color: '#FFFFFF',
    };
    expect(train).toBeDefined();
  });
});
