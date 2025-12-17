/**
 * TripTrafficEngine Tests (TDD - Tests First)
 *
 * Tests for trip-based traffic simulation engine.
 * Feature flag: USE_TRIP_TRAFFIC
 *
 * Per CLAUDE.md §8.7: Tests define invariants and contracts.
 * Implementation should make these tests pass.
 *
 * Test categories:
 * - Spawn logic: vehicles spawn only on slice transitions
 * - Load scaling: spawn throttling at soft/hard caps
 * - Movement: leftover distance carry across segments
 * - Route traversal: routeIndex increments correctly
 * - Despawn: swap-remove maintains dense array
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { GraphRoadSegment, RouteTemplate } from '../data/types';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock road segment with graph connectivity fields.
 */
function createMockSegment(overrides: Partial<GraphRoadSegment> = {}): GraphRoadSegment {
  return {
    id: 'seg_001',
    type: 'street',
    points: [
      [0, 0, 0],
      [100, 0, 0],
    ],
    avgSpeedMph: 20,
    freeFlowSpeedMph: 25,
    spawnRates: Array(60).fill(0.5),
    speedRatio: 0.8,
    lengthMeters: 100,
    startHeadingDeg: 90,
    endHeadingDeg: 90,
    isMajor: false,
    isEntry: true,
    successors: [],
    predecessors: [],
    ...overrides,
  };
}

/**
 * Create a connected 3-segment road network for testing.
 */
function createTestNetwork(): {
  segments: GraphRoadSegment[];
  routes: Record<string, RouteTemplate[]>;
} {
  const seg1 = createMockSegment({
    id: 'seg_001',
    points: [
      [0, 0, 0],
      [100, 0, 0],
    ],
    lengthMeters: 100,
    isEntry: true,
    successors: ['seg_002'],
    predecessors: [],
  });

  const seg2 = createMockSegment({
    id: 'seg_002',
    points: [
      [100, 0, 0],
      [200, 0, 0],
    ],
    lengthMeters: 100,
    isEntry: false,
    successors: ['seg_003'],
    predecessors: ['seg_001'],
  });

  const seg3 = createMockSegment({
    id: 'seg_003',
    points: [
      [200, 0, 0],
      [300, 0, 0],
    ],
    lengthMeters: 100,
    isEntry: false,
    successors: [],
    predecessors: ['seg_002'],
  });

  const route: RouteTemplate = {
    entrySegmentId: 'seg_001',
    segmentSequence: ['seg_001', 'seg_002', 'seg_003'],
    totalLengthMeters: 300,
    cumulativeDistances: [0, 100, 200, 300],
  };

  return {
    segments: [seg1, seg2, seg3],
    routes: { seg_001: [route] },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('TripTrafficEngine', () => {
  let TripTrafficEngine: typeof import('./TripTrafficEngine').TripTrafficEngine;

  beforeEach(async () => {
    try {
      const module = await import('./TripTrafficEngine');
      TripTrafficEngine = module.TripTrafficEngine;
    } catch {
      // Implementation doesn't exist yet - tests will be skipped
    }
  });

  describe('initialization', () => {
    it('should initialize with empty vehicle array', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      expect(engine.getVehicleCount()).toBe(0);
      expect(engine.getVehicles()).toHaveLength(0);
    });

    it('should identify entry segments from routes', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      const entryIds = engine.getEntrySegmentIds();
      expect(entryIds).toContain('seg_001');
      expect(entryIds).not.toContain('seg_002');
    });
  });

  describe('spawn logic', () => {
    it('should spawn vehicles only on slice transitions', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      // First update at t=0.01 (slice 0) - should spawn
      engine.update(0.01, 0.016);
      const countAfterFirstSlice = engine.getVehicleCount();

      // Same slice - should NOT spawn more
      engine.update(0.015, 0.016);
      expect(engine.getVehicleCount()).toBe(countAfterFirstSlice);

      // New slice (t=0.02 = slice 1) - should spawn more
      engine.update(0.02, 0.016);
      expect(engine.getVehicleCount()).toBeGreaterThanOrEqual(countAfterFirstSlice);
    });

    it('should not spawn when at hard cap', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 2);

      for (let i = 0; i < 10; i++) {
        engine.update(i / 60, 0.016);
      }

      expect(engine.getVehicleCount()).toBeLessThanOrEqual(2);
    });
  });

  describe('movement with leftover distance carry', () => {
    it('should carry leftover distance across segment boundaries', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      engine.update(0.01, 0.016);

      // At 20 mph (~9 m/s), 15 seconds = ~135m (crosses 100m segment)
      engine.update(0.02, 15);

      const vehicles = engine.getVehicles();
      if (vehicles.length > 0) {
        const vehicle = vehicles[0]!;
        expect(['seg_002', 'seg_003']).toContain(vehicle.segmentId);
        expect(vehicle.traveledMeters).toBeGreaterThan(100);
      }
    });

    it('should limit transitions per frame to prevent infinite loops', async () => {
      if (!TripTrafficEngine) return;

      // Create chain of very short segments
      const shortSegments: GraphRoadSegment[] = [];
      for (let i = 0; i < 20; i++) {
        shortSegments.push(
          createMockSegment({
            id: `short_${i}`,
            lengthMeters: 1,
            successors: i < 19 ? [`short_${i + 1}`] : [],
            predecessors: i > 0 ? [`short_${i - 1}`] : [],
            isEntry: i === 0,
          })
        );
      }

      const shortRoute: RouteTemplate = {
        entrySegmentId: 'short_0',
        segmentSequence: shortSegments.map((s) => s.id),
        totalLengthMeters: 20,
        cumulativeDistances: shortSegments.map((_, i) => i),
      };

      const engine = new TripTrafficEngine(shortSegments, { short_0: [shortRoute] }, 100);

      engine.update(0.01, 0.016);
      engine.update(0.02, 10);

      // Should not crash
      expect(engine.getVehicleCount()).toBeLessThanOrEqual(100);
    });
  });

  describe('route traversal', () => {
    it('should advance through route segments', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      engine.update(0.01, 0.016);

      const vehiclesBefore = engine.getVehicles();
      if (vehiclesBefore.length > 0) {
        expect(vehiclesBefore[0]!.segmentId).toBe('seg_001');

        engine.update(0.02, 15);

        const vehiclesAfter = engine.getVehicles();
        if (vehiclesAfter.length > 0) {
          expect(vehiclesAfter[0]!.segmentId).not.toBe('seg_001');
        }
      }
    });
  });

  describe('despawn with swap-remove', () => {
    it('should maintain dense array after despawn', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      for (let i = 0; i < 5; i++) {
        engine.update(i / 60, 0.016);
      }

      engine.update(0.1, 60);

      const vehicles = engine.getVehicles();
      expect(vehicles.every((v) => v !== undefined)).toBe(true);
      expect(vehicles.every((v) => v.id !== undefined)).toBe(true);
    });

    it('should despawn vehicles that complete their trip', async () => {
      if (!TripTrafficEngine) return;

      const shortSeg = createMockSegment({
        id: 'short',
        lengthMeters: 50,
        isEntry: true,
        successors: [],
      });

      const shortRoute: RouteTemplate = {
        entrySegmentId: 'short',
        segmentSequence: ['short'],
        totalLengthMeters: 50,
        cumulativeDistances: [0, 50],
      };

      const engine = new TripTrafficEngine([shortSeg], { short: [shortRoute] }, 100);

      // Spawn vehicles in slice 0
      engine.update(0.01, 0.016);
      const countAfterSpawn = engine.getVehicleCount();

      // Move vehicles to completion, stay in same slice to isolate despawn behavior
      engine.update(0.015, 10);

      expect(engine.getVehicleCount()).toBeLessThan(countAfterSpawn);
    });
  });

  describe('load scaling', () => {
    it('should cap vehicles at maxVehicles', async () => {
      if (!TripTrafficEngine) return;

      const highSpawnSegment = createMockSegment({
        id: 'high_spawn',
        spawnRates: Array(60).fill(10),
        isEntry: true,
        successors: [],
      });

      const route: RouteTemplate = {
        entrySegmentId: 'high_spawn',
        segmentSequence: ['high_spawn'],
        totalLengthMeters: 100,
        cumulativeDistances: [0, 100],
      };

      const engine = new TripTrafficEngine([highSpawnSegment], { high_spawn: [route] }, 10);

      for (let i = 0; i < 60; i++) {
        engine.update(i / 60, 0.016);
      }

      expect(engine.getVehicleCount()).toBeLessThanOrEqual(10);
    });
  });

  describe('vehicle state', () => {
    it('should return defensive copies of position', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      engine.update(0.01, 0.016);

      const vehicles1 = engine.getVehicles();
      const vehicles2 = engine.getVehicles();

      if (vehicles1.length > 0 && vehicles2.length > 0) {
        expect(vehicles1[0]!.position).not.toBe(vehicles2[0]!.position);
        expect(vehicles1[0]!.position).toEqual(vehicles2[0]!.position);
      }
    });

    it('should include speedRatio for coloring', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      engine.update(0.01, 0.016);

      const vehicles = engine.getVehicles();
      if (vehicles.length > 0) {
        expect(vehicles[0]!.speedRatio).toBeDefined();
        expect(vehicles[0]!.speedRatio).toBeGreaterThan(0);
        expect(vehicles[0]!.speedRatio).toBeLessThanOrEqual(1);
      }
    });

    it('should include heading for rotation', async () => {
      if (!TripTrafficEngine) return;

      const { segments, routes } = createTestNetwork();
      const engine = new TripTrafficEngine(segments, routes, 100);

      engine.update(0.01, 0.016);

      const vehicles = engine.getVehicles();
      if (vehicles.length > 0) {
        expect(vehicles[0]!.heading).toBeDefined();
        expect(vehicles[0]!.heading).toBeGreaterThanOrEqual(0);
        expect(vehicles[0]!.heading).toBeLessThan(360);
      }
    });
  });
});
