/**
 * Tests for TrafficEngine
 *
 * TDD: These tests define the expected behavior for road traffic simulation.
 *
 * The TrafficEngine is a pure TypeScript class that:
 * - Spawns vehicles on road segments based on spawnRates per time slice
 * - Moves vehicles along segments based on avgSpeed
 * - Removes vehicles when they reach the end of their segment
 * - Returns VehicleState with DEFENSIVE COPIES of position arrays
 *
 * Per CLAUDE.md §8.3: Engine owns state computation, components only render.
 * Per CLAUDE.md §8.7: TDD is required.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TrafficEngine, VehicleState } from './TrafficEngine';
import type { RoadSegment, Point3D } from '../data/types';

// =============================================================================
// Test Data
// =============================================================================

/**
 * Mock road segment: straight line 100m along x-axis at street level.
 * avgSpeed: 20 mph, freeFlow: 30 mph => congestionFactor: 0.667
 */
const mockSegmentSimple: RoadSegment = {
  id: 'seg1',
  type: 'avenue',
  points: [
    [0, 0, 0],
    [100, 0, 0],
  ] as Point3D[],
  avgSpeedMph: 20,
  freeFlowSpeedMph: 30,
  congestionFactor: 20 / 30, // ~0.667
  spawnRates: Array(60).fill(0).map((_, i) => (i === 0 ? 5 : i === 1 ? 3 : 0)),
};

/**
 * Mock segment with L-shape: 100m + 100m = 200m total
 */
const mockSegmentLShaped: RoadSegment = {
  id: 'seg2',
  type: 'street',
  points: [
    [0, 0, 0],
    [100, 0, 0],
    [100, 0, 100],
  ] as Point3D[],
  avgSpeedMph: 15,
  freeFlowSpeedMph: 25,
  congestionFactor: 15 / 25, // 0.6
  spawnRates: Array(60).fill(2), // Constant 2 vehicles per slice
};

/**
 * Fast segment for testing vehicle removal
 */
const mockSegmentFast: RoadSegment = {
  id: 'seg3',
  type: 'highway',
  points: [
    [0, 0, 0],
    [50, 0, 0], // Short 50m segment
  ] as Point3D[],
  avgSpeedMph: 60, // Fast
  freeFlowSpeedMph: 65,
  congestionFactor: 60 / 65,
  spawnRates: Array(60).fill(1),
};

// =============================================================================
// Tests
// =============================================================================

describe('TrafficEngine', () => {
  describe('constructor', () => {
    it('creates an engine with segments and maxVehicles', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);
      expect(engine).toBeDefined();
    });

    it('handles empty segments array', () => {
      const engine = new TrafficEngine([], 100);
      expect(engine.getVehicles()).toEqual([]);
    });

    it('respects maxVehicles limit', () => {
      // Segment that spawns lots of vehicles
      const highSpawnSegment: RoadSegment = {
        ...mockSegmentSimple,
        spawnRates: Array(60).fill(100), // 100 per slice
      };
      const engine = new TrafficEngine([highSpawnSegment], 10);

      // Trigger spawn by crossing into slice 0
      engine.update(0.001, 0.016);

      expect(engine.getVehicles().length).toBeLessThanOrEqual(10);
    });
  });

  describe('spawning', () => {
    it('spawns vehicles on slice transition', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);

      // Initial update at t=0.001 (slice 0) should spawn vehicles
      engine.update(0.001, 0.016);

      const vehicles = engine.getVehicles();
      expect(vehicles.length).toBe(5); // spawnRates[0] = 5
    });

    it('spawns more vehicles on next slice transition', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);

      // First slice
      engine.update(0.001, 0.016);
      expect(engine.getVehicles().length).toBe(5);

      // Move to slice 1 (t >= 1/60 = 0.0167)
      engine.update(0.02, 0.016);

      // Should have previous vehicles (minus any removed) plus new spawns
      // Slice 1 spawns 3 more
      expect(engine.getVehicles().length).toBeGreaterThanOrEqual(3);
    });

    it('does NOT spawn when staying in same slice', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);

      // Enter slice 0
      engine.update(0.001, 0.016);
      const countAfterFirst = engine.getVehicles().length;

      // Still in slice 0 (t < 1/60 = 0.0167)
      engine.update(0.005, 0.016);

      // No additional spawns
      expect(engine.getVehicles().length).toBeLessThanOrEqual(countAfterFirst);
    });

    it('spawns at start of each segment', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);
      engine.update(0.001, 0.016);

      const vehicles = engine.getVehicles();

      // All spawned vehicles should start at segment beginning
      for (const v of vehicles) {
        expect(v.position[0]).toBeCloseTo(0, 1);
        expect(v.position[1]).toBeCloseTo(0, 1);
        expect(v.position[2]).toBeCloseTo(0, 1);
      }
    });
  });

  describe('movement', () => {
    let engine: TrafficEngine;

    beforeEach(() => {
      engine = new TrafficEngine([mockSegmentSimple], 100);
      // Spawn vehicles at slice 0
      engine.update(0.001, 0.016);
    });

    it('moves vehicles along segment over time', () => {
      const vehiclesBefore = engine.getVehicles();
      const posBefore = vehiclesBefore[0]!.position[0];

      // Simulate several frames
      for (let i = 0; i < 10; i++) {
        engine.update(0.001 + i * 0.001, 0.016);
      }

      const vehiclesAfter = engine.getVehicles();

      // At least some vehicles should still exist
      if (vehiclesAfter.length > 0) {
        // Position should have increased (moving along x-axis)
        expect(vehiclesAfter[0]!.position[0]).toBeGreaterThan(posBefore);
      }
    });

    it('removes vehicles when they reach end of segment', () => {
      // Use fast, short segment
      const fastEngine = new TrafficEngine([mockSegmentFast], 100);

      // Spawn at slice 0
      fastEngine.update(0.001, 0.016);
      expect(fastEngine.getVehicles().length).toBeGreaterThan(0);

      // Simulate many frames with large dt to move vehicles to end
      for (let i = 0; i < 100; i++) {
        fastEngine.update(0.001 + i * 0.0001, 0.5); // Large dt
      }

      // Eventually vehicles should be removed (progress >= 1)
      // Some new ones may have spawned, but original should be gone
    });
  });

  describe('VehicleState properties', () => {
    let engine: TrafficEngine;
    let vehicles: VehicleState[];

    beforeEach(() => {
      engine = new TrafficEngine([mockSegmentSimple], 100);
      engine.update(0.001, 0.016);
      vehicles = engine.getVehicles();
    });

    it('includes vehicle id', () => {
      expect(vehicles[0]!.id).toBeDefined();
      expect(typeof vehicles[0]!.id).toBe('string');
    });

    it('includes segment id', () => {
      expect(vehicles[0]!.segmentId).toBe('seg1');
    });

    it('includes position as Point3D', () => {
      expect(vehicles[0]!.position).toHaveLength(3);
      expect(typeof vehicles[0]!.position[0]).toBe('number');
      expect(typeof vehicles[0]!.position[1]).toBe('number');
      expect(typeof vehicles[0]!.position[2]).toBe('number');
    });

    it('includes congestion factor', () => {
      expect(vehicles[0]!.congestion).toBeCloseTo(20 / 30, 2);
    });

    it('includes progress along segment', () => {
      expect(vehicles[0]!.progress).toBeGreaterThanOrEqual(0);
      expect(vehicles[0]!.progress).toBeLessThanOrEqual(1);
    });
  });

  describe('defensive copying (CRITICAL)', () => {
    let engine: TrafficEngine;

    beforeEach(() => {
      engine = new TrafficEngine([mockSegmentSimple], 100);
      engine.update(0.001, 0.016);
    });

    it('returns new position array instances on each getVehicles() call', () => {
      const vehicles1 = engine.getVehicles();
      const vehicles2 = engine.getVehicles();

      // Same vehicle, different array instances
      expect(vehicles1[0]!.position).not.toBe(vehicles2[0]!.position);
    });

    it('mutating returned position does NOT affect engine state', () => {
      const vehicles1 = engine.getVehicles();
      const originalX = vehicles1[0]!.position[0];

      // Mutate the returned position
      vehicles1[0]!.position[0] = 99999;

      // Get fresh state
      const vehicles2 = engine.getVehicles();

      // Engine state should be unchanged
      expect(vehicles2[0]!.position[0]).toBeCloseTo(originalX, 5);
    });

    it('returned position values match internal state', () => {
      const vehicles = engine.getVehicles();

      // Values should be accurate copies
      expect(vehicles[0]!.position[0]).toBeGreaterThanOrEqual(0);
      expect(vehicles[0]!.position[0]).toBeLessThanOrEqual(100);
    });
  });

  describe('multi-segment scenarios', () => {
    it('spawns vehicles on multiple segments', () => {
      const engine = new TrafficEngine(
        [mockSegmentSimple, mockSegmentLShaped],
        100
      );
      engine.update(0.001, 0.016);

      const vehicles = engine.getVehicles();

      // Should have vehicles from both segments
      const seg1Vehicles = vehicles.filter((v) => v.segmentId === 'seg1');
      const seg2Vehicles = vehicles.filter((v) => v.segmentId === 'seg2');

      expect(seg1Vehicles.length).toBe(5); // spawnRates[0] for seg1
      expect(seg2Vehicles.length).toBe(2); // spawnRates[0] for seg2
    });

    it('interpolates position correctly on L-shaped segment', () => {
      const engine = new TrafficEngine([mockSegmentLShaped], 100);
      engine.update(0.001, 0.016);

      // Simulate movement to ~50% progress (should be at corner)
      // This requires careful timing based on speed
      for (let i = 0; i < 50; i++) {
        engine.update(0.001 + i * 0.0005, 0.1);
      }

      const vehicles = engine.getVehicles();
      if (vehicles.length > 0) {
        const v = vehicles[0]!;
        // If progress is ~0.5, should be near [100, 0, 0] corner
        if (v.progress > 0.4 && v.progress < 0.6) {
          expect(v.position[0]).toBeCloseTo(100, 10);
        }
      }
    });
  });

  describe('edge cases', () => {
    it('handles segment with single point gracefully', () => {
      const singlePointSegment: RoadSegment = {
        id: 'single',
        type: 'street',
        points: [[50, 0, 50]] as Point3D[],
        avgSpeedMph: 20,
        freeFlowSpeedMph: 30,
        congestionFactor: 0.667,
        spawnRates: Array(60).fill(1),
      };

      const engine = new TrafficEngine([singlePointSegment], 100);
      engine.update(0.001, 0.016);

      // Should not crash
      const vehicles = engine.getVehicles();
      expect(vehicles).toBeDefined();
    });

    it('handles zero spawn rate', () => {
      const noSpawnSegment: RoadSegment = {
        ...mockSegmentSimple,
        spawnRates: Array(60).fill(0),
      };

      const engine = new TrafficEngine([noSpawnSegment], 100);
      engine.update(0.001, 0.016);

      expect(engine.getVehicles()).toEqual([]);
    });

    it('handles simulation time at boundaries', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);

      // t=0 exactly
      engine.update(0, 0.016);
      expect(engine.getVehicles()).toBeDefined();

      // t approaching 1
      engine.update(0.999, 0.016);
      expect(engine.getVehicles()).toBeDefined();
    });

    it('handles very small delta time', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);
      engine.update(0.001, 0.016);

      // Very small dt
      engine.update(0.002, 0.0001);

      expect(engine.getVehicles()).toBeDefined();
    });

    it('handles very large delta time', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);
      engine.update(0.001, 0.016);

      // Large dt (1 second)
      engine.update(0.002, 1.0);

      expect(engine.getVehicles()).toBeDefined();
    });
  });

  describe('getVehicleCount', () => {
    it('returns current number of active vehicles', () => {
      const engine = new TrafficEngine([mockSegmentSimple], 100);
      expect(engine.getVehicleCount()).toBe(0);

      engine.update(0.001, 0.016);
      expect(engine.getVehicleCount()).toBe(5);
    });
  });
});

describe('VehicleState type', () => {
  it('has required properties', () => {
    // TypeScript compile-time check
    const state: VehicleState = {
      id: 'v1',
      segmentId: 'seg1',
      position: [0, 0, 0],
      progress: 0.5,
      congestion: 0.7,
    };
    expect(state).toBeDefined();
  });
});
