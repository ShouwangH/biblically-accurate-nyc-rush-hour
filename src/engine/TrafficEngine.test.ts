/**
 * Tests for TrafficEngine
 *
 * TDD: These tests define the expected behavior for traffic simulation.
 *
 * The TrafficEngine is a pure TypeScript class that:
 * - Spawns vehicles only on slice transitions (not per-frame)
 * - Moves vehicles along road segments based on speed
 * - Removes vehicles that complete their segment
 * - Enforces a maximum vehicle limit
 * - Uses object pooling for performance
 *
 * Per CLAUDE.md §8.3: Engine owns state computation, components only render.
 */
import { describe, it, expect } from 'vitest';
import { TrafficEngine, VehicleState } from './TrafficEngine';
import type { RoadSegment, Point3D } from '../data/types';

// =============================================================================
// Test Data
// =============================================================================

/**
 * Mock road segment: 100m straight line at street level.
 * At 10 mph ≈ 4.47 m/s, a vehicle takes ~22.4 seconds to traverse.
 */
const mockSegment: RoadSegment = {
  id: 's1',
  type: 'avenue',
  points: [
    [0, 0, 0],
    [100, 0, 0],
  ] as Point3D[],
  avgSpeedMph: 10,
  freeFlowSpeedMph: 25,
  congestionFactor: 0.4,
  spawnRates: Array<number>(60).fill(2), // 2 vehicles per slice
};

/**
 * Mock segment with varying spawn rates.
 */
const mockSegmentVarying: RoadSegment = {
  id: 's2',
  type: 'street',
  points: [
    [0, 0, 100],
    [50, 0, 100],
  ] as Point3D[],
  avgSpeedMph: 15,
  freeFlowSpeedMph: 30,
  congestionFactor: 0.5,
  spawnRates: [5, 3, 1, 0, ...Array<number>(56).fill(2)], // Varying rates
};

/**
 * Mock L-shaped segment: 100m + 100m = 200m total.
 */
const mockLShapedSegment: RoadSegment = {
  id: 's3',
  type: 'highway',
  points: [
    [0, 0, 200],
    [100, 0, 200],
    [100, 0, 300],
  ] as Point3D[],
  avgSpeedMph: 20,
  freeFlowSpeedMph: 40,
  congestionFactor: 0.5,
  spawnRates: Array<number>(60).fill(1),
};

// =============================================================================
// Tests
// =============================================================================

describe('TrafficEngine', () => {
  describe('constructor', () => {
    it('creates an engine with segments and max vehicles', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      expect(engine).toBeDefined();
    });

    it('starts with zero vehicles', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      expect(engine.getVehicleCount()).toBe(0);
    });

    it('handles empty segments array', () => {
      const engine = new TrafficEngine([], 100);
      expect(engine.getVehicleCount()).toBe(0);
      engine.update(0.01, 0.016);
      expect(engine.getVehicleCount()).toBe(0);
    });
  });

  describe('spawning - slice transitions', () => {
    it('spawns vehicles on first update (slice 0 entry)', () => {
      const engine = new TrafficEngine([mockSegment], 100);

      engine.update(0.005, 0.016); // t=0.005 is in slice 0
      expect(engine.getVehicleCount()).toBe(2); // spawnRates[0] = 2
    });

    it('does not spawn on same slice', () => {
      const engine = new TrafficEngine([mockSegment], 100);

      engine.update(0.005, 0.016); // slice 0, spawns 2
      const countAfterFirst = engine.getVehicleCount();

      engine.update(0.01, 0.016); // still slice 0
      expect(engine.getVehicleCount()).toBe(countAfterFirst);

      engine.update(0.015, 0.016); // still slice 0
      expect(engine.getVehicleCount()).toBe(countAfterFirst);
    });

    it('spawns on slice transition', () => {
      const engine = new TrafficEngine([mockSegment], 100);

      engine.update(0.005, 0.016); // slice 0, spawns 2
      expect(engine.getVehicleCount()).toBe(2);

      // t = 1/60 ≈ 0.01667 is slice 1
      engine.update(0.02, 0.016); // slice 1, spawns 2 more
      expect(engine.getVehicleCount()).toBe(4);
    });

    it('spawns correct count per slice based on spawnRates', () => {
      const engine = new TrafficEngine([mockSegmentVarying], 100);

      // Slice 0: spawnRates[0] = 5
      engine.update(0.005, 0.016);
      expect(engine.getVehicleCount()).toBe(5);

      // Slice 1: spawnRates[1] = 3
      engine.update(0.02, 0.016);
      expect(engine.getVehicleCount()).toBe(8);

      // Slice 2: spawnRates[2] = 1
      engine.update(0.04, 0.016);
      expect(engine.getVehicleCount()).toBe(9);

      // Slice 3: spawnRates[3] = 0
      engine.update(0.06, 0.016);
      expect(engine.getVehicleCount()).toBe(9); // No new spawns
    });

    it('spawns from all segments', () => {
      const engine = new TrafficEngine([mockSegment, mockSegmentVarying], 100);

      // Slice 0: s1 spawns 2, s2 spawns 5
      engine.update(0.005, 0.016);
      expect(engine.getVehicleCount()).toBe(7);
    });

    it('handles jumping multiple slices in one update', () => {
      const engine = new TrafficEngine([mockSegment], 100);

      // Jump from uninitialized to slice 3 (skip 0, 1, 2)
      // Should only spawn for the current slice (3), not catch up
      engine.update(0.06, 0.016); // slice 3
      expect(engine.getVehicleCount()).toBe(2); // Just current slice
    });
  });

  describe('vehicle movement', () => {
    it('moves vehicles forward on update', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const vehiclesBefore = engine.getVehicles();
      const progressBefore = vehiclesBefore[0]!.progress;

      // Update with 1 second dt
      engine.update(0.006, 1.0);
      const vehiclesAfter = engine.getVehicles();
      const progressAfter = vehiclesAfter[0]!.progress;

      expect(progressAfter).toBeGreaterThan(progressBefore);
    });

    it('moves vehicles at correct speed', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      // mockSegment: 100m at 10 mph = 4.47 m/s
      // After 1 second, should move 4.47m out of 100m = 0.0447 progress
      const dt = 1.0;
      engine.update(0.006, dt);

      const vehicle = engine.getVehicles()[0]!;

      // 10 mph = 10 * 1609.34 / 3600 ≈ 4.47 m/s
      // Progress = 4.47 / 100 = 0.0447
      expect(vehicle.progress).toBeCloseTo(0.0447, 2);
    });

    it('updates position along polyline', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      // Spawn with zero dt to avoid initial movement
      engine.update(0.005, 0);

      // Move to progress ≈ 0.5
      // Need dt such that progress = 0.5
      // 10 mph = 4.47 m/s, 50m / 4.47 ≈ 11.2 seconds
      engine.update(0.006, 11.2);

      const vehicle = engine.getVehicles()[0]!;
      expect(vehicle.position[0]).toBeCloseTo(50, 0); // Within 0.5m
      expect(vehicle.position[1]).toBe(0);
      expect(vehicle.position[2]).toBe(0);
    });
  });

  describe('vehicle removal', () => {
    it('removes vehicles that complete their segment', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);
      expect(engine.getVehicleCount()).toBe(2);

      // Move vehicles to completion
      // 100m at 4.47 m/s = 22.4 seconds
      engine.update(0.006, 23);

      expect(engine.getVehicleCount()).toBe(0);
    });

    it('removes only completed vehicles', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      // Spawn with zero dt
      engine.update(0.005, 0);
      expect(engine.getVehicleCount()).toBe(2);

      // Move to about 50% progress: 11.2 seconds for 50m at 4.47 m/s
      engine.update(0.006, 11.2);

      // Both vehicles should still be active (around 50% progress)
      expect(engine.getVehicleCount()).toBe(2);

      // Move one more half of the segment - first spawned vehicles complete
      engine.update(0.007, 11.5);

      // All vehicles spawned at the same time, so both should complete together
      expect(engine.getVehicleCount()).toBe(0);
    });
  });

  describe('max vehicle limit', () => {
    it('respects max vehicle limit', () => {
      const engine = new TrafficEngine([mockSegment], 3);

      // Multiple slice transitions - would spawn 2 per slice
      engine.update(0.005, 0.016); // slice 0: spawn 2
      engine.update(0.02, 0.016); // slice 1: would spawn 2 more, but capped at 3

      expect(engine.getVehicleCount()).toBeLessThanOrEqual(3);
    });

    it('spawns up to max limit even across segments', () => {
      const engine = new TrafficEngine([mockSegment, mockSegmentVarying], 5);

      // Would want to spawn 2 + 5 = 7, but capped at 5
      engine.update(0.005, 0.016);
      expect(engine.getVehicleCount()).toBe(5);
    });

    it('allows new spawns after vehicles complete', () => {
      const engine = new TrafficEngine([mockSegment], 2);

      engine.update(0.005, 0.016);
      expect(engine.getVehicleCount()).toBe(2);

      // Complete all vehicles
      engine.update(0.006, 25);
      expect(engine.getVehicleCount()).toBe(0);

      // New slice should spawn again
      engine.update(0.02, 0.016);
      expect(engine.getVehicleCount()).toBe(2);
    });
  });

  describe('VehicleState data', () => {
    it('includes unique id', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const vehicles = engine.getVehicles();
      expect(vehicles[0]!.id).toBeDefined();
      expect(vehicles[0]!.id).not.toBe(vehicles[1]!.id);
    });

    it('includes segment id', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const vehicle = engine.getVehicles()[0]!;
      expect(vehicle.segmentId).toBe('s1');
    });

    it('includes position', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const vehicle = engine.getVehicles()[0]!;
      expect(vehicle.position).toBeDefined();
      expect(vehicle.position).toHaveLength(3);
    });

    it('includes progress in [0, 1]', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const vehicle = engine.getVehicles()[0]!;
      expect(vehicle.progress).toBeGreaterThanOrEqual(0);
      expect(vehicle.progress).toBeLessThanOrEqual(1);
    });

    it('includes congestion factor for color', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const vehicle = engine.getVehicles()[0]!;
      expect(vehicle.congestion).toBe(mockSegment.congestionFactor);
    });

    it('includes speed in m/s', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const vehicle = engine.getVehicles()[0]!;
      // 10 mph ≈ 4.47 m/s
      expect(vehicle.speedMps).toBeCloseTo(4.47, 1);
    });
  });

  describe('L-shaped segment handling', () => {
    it('correctly positions vehicles on L-shaped segments', () => {
      const engine = new TrafficEngine([mockLShapedSegment], 100);
      // Spawn with zero dt
      engine.update(0.005, 0);

      // 20 mph ≈ 8.94 m/s on 200m segment
      // To reach corner (100m, progress=0.5): 100/8.94 ≈ 11.2s
      engine.update(0.006, 11.2);

      const vehicle = engine.getVehicles()[0]!;
      expect(vehicle.position[0]).toBeCloseTo(100, 0); // Within 0.5m
      expect(vehicle.position[2]).toBeCloseTo(200, 0); // Within 0.5m
    });
  });

  describe('object pooling', () => {
    it('reuses vehicle objects when possible', () => {
      const engine = new TrafficEngine([mockSegment], 100);

      // Spawn vehicles with zero dt
      engine.update(0.005, 0);
      expect(engine.getVehicleCount()).toBe(2);

      // Complete all vehicles
      engine.update(0.006, 25);
      expect(engine.getVehicleCount()).toBe(0);

      // Spawn new vehicles with zero dt
      engine.update(0.02, 0);

      // Pool reuse is an implementation detail - we just verify
      // that new vehicles are created with valid state
      const newVehicles = engine.getVehicles();
      expect(newVehicles).toHaveLength(2);
      expect(newVehicles[0]!.progress).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles zero dt gracefully', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      const progressBefore = engine.getVehicles()[0]!.progress;
      engine.update(0.006, 0);
      const progressAfter = engine.getVehicles()[0]!.progress;

      expect(progressAfter).toBe(progressBefore);
    });

    it('handles negative dt gracefully', () => {
      const engine = new TrafficEngine([mockSegment], 100);
      engine.update(0.005, 0.016);

      // Should not crash and should not move backwards
      engine.update(0.006, -1);
      const vehicle = engine.getVehicles()[0]!;
      expect(vehicle.progress).toBeGreaterThanOrEqual(0);
    });

    it('handles segment with zero spawn rate', () => {
      const zeroSpawnSegment: RoadSegment = {
        ...mockSegment,
        id: 'zero',
        spawnRates: Array<number>(60).fill(0),
      };

      const engine = new TrafficEngine([zeroSpawnSegment], 100);
      engine.update(0.005, 0.016);
      expect(engine.getVehicleCount()).toBe(0);
    });

    it('handles very high spawn rate', () => {
      const highSpawnSegment: RoadSegment = {
        ...mockSegment,
        id: 'high',
        spawnRates: Array<number>(60).fill(1000),
      };

      const engine = new TrafficEngine([highSpawnSegment], 50);
      engine.update(0.005, 0.016);
      expect(engine.getVehicleCount()).toBe(50); // Capped at max
    });
  });

  describe('simulation time wrapping', () => {
    it('handles simulation time going backwards (wrap from 0.99 to 0.01)', () => {
      const engine = new TrafficEngine([mockSegment], 100);

      // Advance to near end
      engine.update(0.98, 0.016); // slice 58
      const countBefore = engine.getVehicleCount();

      // Wrap to beginning
      engine.update(0.01, 0.016); // slice 0 (wrapped)

      // Should spawn for new slice
      expect(engine.getVehicleCount()).toBeGreaterThanOrEqual(countBefore);
    });
  });
});

describe('VehicleState type', () => {
  it('has required properties', () => {
    // TypeScript compile-time check
    const vehicle: VehicleState = {
      id: 'v1',
      segmentId: 's1',
      position: [0, 0, 0],
      progress: 0.5,
      congestion: 0.5,
      speedMps: 4.47,
      heading: 0,
    };
    expect(vehicle).toBeDefined();
  });
});
