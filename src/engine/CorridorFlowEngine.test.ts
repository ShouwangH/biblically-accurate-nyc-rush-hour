/**
 * Tests for CorridorFlowEngine
 *
 * Per CLAUDE.md §8.7: Tests define invariants, implementation makes them pass.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CorridorFlowEngine, createTestCorridorEngine } from './CorridorFlowEngine';
import type { RoadSegment, Point3D } from '../data/types';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockSegment(
  id: string,
  points: Point3D[],
  avgSpeedMph = 20
): RoadSegment {
  return {
    id,
    type: 'street',
    points,
    avgSpeedMph,
    freeFlowSpeedMph: 25,
    congestionFactor: avgSpeedMph / 25,
    spawnRates: Array(60).fill(0.1),
  };
}

// Simple straight corridor: 1000m along Z axis
const straightCorridor = createMockSegment('seg_straight', [
  [0, 0, 0],
  [0, 0, -1000],
]);

// L-shaped corridor: 500m east, then 500m north
const lShapedSegment1 = createMockSegment('seg_l1', [
  [0, 0, 0],
  [500, 0, 0],
]);
const lShapedSegment2 = createMockSegment('seg_l2', [
  [500, 0, 0],
  [500, 0, -500],
]);

// =============================================================================
// Tests
// =============================================================================

describe('CorridorFlowEngine', () => {
  let engine: CorridorFlowEngine;

  beforeEach(() => {
    engine = new CorridorFlowEngine();
  });

  describe('addCorridor', () => {
    it('creates a corridor from a single segment', () => {
      engine.addCorridor('test', 'Test Corridor', [straightCorridor], {
        lanes: 2,
        targetDensity: 0.05,
        speed: 10,
      });

      engine.initialize();
      const counts = engine.getCounts();

      // 1000m * 0.05 = 50 particles expected
      expect(counts.meso).toBe(50);
      expect(counts.micro).toBe(0);
    });

    it('creates a corridor from multiple segments', () => {
      engine.addCorridor('test', 'L-Shaped', [lShapedSegment1, lShapedSegment2], {
        lanes: 1,
        targetDensity: 0.02,
        speed: 10,
      });

      engine.initialize();
      const counts = engine.getCounts();

      // Total length = 500 + 500 = 1000m, 1000 * 0.02 = 20 particles
      expect(counts.meso).toBe(20);
    });
  });

  describe('update', () => {
    it('moves particles along corridor', () => {
      engine.addCorridor('test', 'Test', [straightCorridor], {
        lanes: 1,
        targetDensity: 0.01, // 10 particles
        speed: 100, // 100 m/s for easy math
      });

      engine.initialize();

      // Get initial positions
      const before = engine.getVehicles();
      const initialZ = before[0]!.position[2];

      // Update for 1 second
      engine.update(1.0);

      // Get new positions
      const after = engine.getVehicles();
      const finalZ = after[0]!.position[2];

      // Should have moved ~100m (wrapping if needed)
      const moved = Math.abs(finalZ - initialZ);
      expect(moved).toBeGreaterThan(50); // At least moved significantly
    });

    it('wraps particles at corridor end', () => {
      engine.addCorridor('test', 'Test', [straightCorridor], {
        lanes: 1,
        targetDensity: 0.001, // 1 particle
        speed: 1000, // Fast to ensure wrap
      });

      engine.initialize();

      // Update for 2 seconds (should traverse 2000m, wrap on 1000m corridor)
      engine.update(2.0);

      const vehicles = engine.getVehicles();
      expect(vehicles.length).toBe(1);

      // Position should be somewhere in the corridor (wrapped)
      const pos = vehicles[0]!.position;
      expect(pos[2]).toBeGreaterThanOrEqual(-1000);
      expect(pos[2]).toBeLessThanOrEqual(0);
    });
  });

  describe('intersections', () => {
    it('converts meso to micro at intersection with probability', () => {
      engine.addCorridor('test', 'Test', [straightCorridor], {
        lanes: 1,
        targetDensity: 0.1, // 100 particles
        speed: 10,
      });

      // Add intersection at middle of corridor
      engine.addIntersection('mid', [0, 0, -500], 30, 1.0); // 100% turn prob

      engine.initialize();

      // Run many updates to trigger conversions
      for (let i = 0; i < 100; i++) {
        engine.update(0.1);
      }

      const counts = engine.getCounts();

      // Should have some micro agents from conversions
      expect(counts.micro).toBeGreaterThan(0);
    });
  });

  describe('getVehicles', () => {
    it('returns vehicles with correct properties', () => {
      engine.addCorridor('test', 'Test', [straightCorridor], {
        lanes: 2,
        targetDensity: 0.01,
        speed: 10,
      });

      engine.initialize();
      const vehicles = engine.getVehicles();

      expect(vehicles.length).toBeGreaterThan(0);

      const vehicle = vehicles[0]!;
      expect(vehicle).toHaveProperty('id');
      expect(vehicle).toHaveProperty('position');
      expect(vehicle).toHaveProperty('heading');
      expect(vehicle).toHaveProperty('speed');
      expect(vehicle).toHaveProperty('type');
      expect(vehicle.type).toBe('meso');

      // Position should be a 3-element array
      expect(vehicle.position).toHaveLength(3);
    });
  });

  describe('reset', () => {
    it('reinitializes all particles', () => {
      engine.addCorridor('test', 'Test', [straightCorridor], {
        lanes: 1,
        targetDensity: 0.01,
        speed: 100,
      });

      engine.initialize();

      // Run some updates
      engine.update(5.0);

      // Reset
      engine.reset();

      const counts = engine.getCounts();
      // Should have same count as initial
      expect(counts.meso).toBe(10);
      expect(counts.micro).toBe(0);
    });
  });

  describe('conservation', () => {
    it('maintains total vehicle count approximately', () => {
      engine.addCorridor('test', 'Test', [straightCorridor], {
        lanes: 2,
        targetDensity: 0.05, // 50 particles
        speed: 10,
      });

      engine.addIntersection('mid', [0, 0, -500], 30, 0.3);

      engine.initialize();
      const initialCounts = engine.getCounts();

      // Run updates
      for (let i = 0; i < 50; i++) {
        engine.update(0.1);
      }

      const finalCounts = engine.getCounts();

      // Total should stay approximately the same (some variance from spawning/exit)
      const diff = Math.abs(finalCounts.total - initialCounts.total);
      expect(diff).toBeLessThan(initialCounts.total * 0.5); // Within 50%
    });
  });
});

describe('createTestCorridorEngine', () => {
  it('creates engine with corridors when segments exist', () => {
    // Mock the specific segments we expect
    const mockSegments: RoadSegment[] = [
      createMockSegment('road_3020', [
        [-181, 0, -1849],
        [458, 0, -5666],
      ]),
      createMockSegment('road_3339', [
        [192, 0, -5357],
        [-218, 0, -3233],
      ]),
      createMockSegment('road_4459', [
        [3174, 0, -864],
        [3411, 0, -1242],
      ]),
      createMockSegment('road_4503', [
        [3699, 0, -2332],
        [3827, 0, -2766],
      ]),
    ];

    const engine = createTestCorridorEngine(mockSegments);
    const counts = engine.getCounts();

    // Should have particles from at least the corridors that were found
    expect(counts.meso).toBeGreaterThan(0);
  });
});
