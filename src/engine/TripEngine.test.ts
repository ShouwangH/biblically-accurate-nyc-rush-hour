/**
 * Tests for TripEngine
 *
 * TDD: These tests define the expected behavior for trip-based train computation.
 *
 * The TripEngine uses GTFS trip data with station-to-station timing and
 * full route geometry for smooth, accurate train positioning.
 *
 * Key differences from TrainEngine:
 * - Uses Trip[] instead of TrainRun[]
 * - Interpolates between station stops, not segment boundaries
 * - Uses distanceAlongRoute for position interpolation
 */
import { describe, it, expect } from 'vitest';
import { TripEngine } from './TripEngine';
import type { Trip, Point3D } from '../data/types';

// =============================================================================
// Test Data
// =============================================================================

/**
 * Create a simple straight-line polyline from [0,0,0] to [1000,0,0].
 */
function makeSimplePolyline(): Point3D[] {
  return [
    [0, -15, 0],
    [250, -15, 0],
    [500, -15, 0],
    [750, -15, 0],
    [1000, -15, 0],
  ];
}

/**
 * Create a mock trip with 3 stops along a 1000m route.
 * Stops at 0m, 500m, and 1000m.
 * Times at t=0, t=0.5, t=1.0 (but we clip to [0, 1) so use 0.999).
 */
function makeMockTrip(id: string = 'trip-1'): Trip {
  return {
    id,
    lineId: '1',
    direction: 1,
    color: '#EE352E',
    stops: [
      {
        stopId: 'stop-1',
        stationName: 'Station A',
        arrivalTime: 0.0,
        position: [0, -15, 0] as Point3D,
        distanceAlongRoute: 0,
      },
      {
        stopId: 'stop-2',
        stationName: 'Station B',
        arrivalTime: 0.5,
        position: [500, -15, 0] as Point3D,
        distanceAlongRoute: 500,
      },
      {
        stopId: 'stop-3',
        stationName: 'Station C',
        arrivalTime: 0.999,
        position: [1000, -15, 0] as Point3D,
        distanceAlongRoute: 1000,
      },
    ],
    polyline: makeSimplePolyline(),
    totalLength: 1000,
    tEnter: 0.0,
    tExit: 0.999,
  };
}

/**
 * Create a trip that spans only part of the window.
 * Active from t=0.2 to t=0.6.
 */
function makePartialTrip(): Trip {
  return {
    id: 'trip-partial',
    lineId: 'A',
    direction: -1,
    color: '#0039A6',
    stops: [
      {
        stopId: 'stop-p1',
        stationName: 'Start',
        arrivalTime: 0.2,
        position: [100, -15, 0] as Point3D,
        distanceAlongRoute: 100,
      },
      {
        stopId: 'stop-p2',
        stationName: 'Mid',
        arrivalTime: 0.4,
        position: [300, -15, 0] as Point3D,
        distanceAlongRoute: 300,
      },
      {
        stopId: 'stop-p3',
        stationName: 'End',
        arrivalTime: 0.6,
        position: [500, -15, 0] as Point3D,
        distanceAlongRoute: 500,
      },
    ],
    polyline: [
      [0, -15, 0],
      [250, -15, 0],
      [500, -15, 0],
    ] as Point3D[],
    totalLength: 500,
    tEnter: 0.2,
    tExit: 0.6,
  };
}

// =============================================================================
// Trip Filtering Tests
// =============================================================================

describe('TripEngine', () => {
  describe('trip filtering', () => {
    it('returns empty array when no trips', () => {
      const engine = new TripEngine([]);
      expect(engine.getActiveTrains(0.5)).toEqual([]);
    });

    it('returns empty array when time is before trip window', () => {
      const trip = makePartialTrip(); // tEnter=0.2, tExit=0.6
      const engine = new TripEngine([trip]);

      expect(engine.getActiveTrains(0.1)).toEqual([]);
      expect(engine.getActiveTrains(0.19)).toEqual([]);
    });

    it('returns empty array when time is at or after trip exit', () => {
      const trip = makePartialTrip(); // tEnter=0.2, tExit=0.6
      const engine = new TripEngine([trip]);

      expect(engine.getActiveTrains(0.6)).toEqual([]);
      expect(engine.getActiveTrains(0.7)).toEqual([]);
    });

    it('returns train when time is exactly at trip entry', () => {
      const trip = makePartialTrip();
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.2);
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe('trip-partial');
    });

    it('returns train when time is within trip window', () => {
      const trip = makePartialTrip();
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.4);
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe('trip-partial');
    });

    it('returns multiple active trains when windows overlap', () => {
      const trip1 = makeMockTrip('trip-1'); // tEnter=0, tExit=0.999
      const trip2 = makePartialTrip();      // tEnter=0.2, tExit=0.6

      const engine = new TripEngine([trip1, trip2]);

      // At t=0.3, both should be active
      const active = engine.getActiveTrains(0.3);
      expect(active).toHaveLength(2);
      expect(active.map(t => t.id).sort()).toEqual(['trip-1', 'trip-partial']);
    });
  });

  // =============================================================================
  // Position Interpolation Tests
  // =============================================================================

  describe('position interpolation', () => {
    it('returns first stop position at trip entry time', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.0);
      expect(active).toHaveLength(1);

      const pos = active[0]!.position;
      expect(pos[0]).toBeCloseTo(0, 0);   // x
      expect(pos[1]).toBeCloseTo(-15, 0); // y
      expect(pos[2]).toBeCloseTo(0, 0);   // z
    });

    it('returns interpolated position between first two stops', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      // At t=0.25, should be halfway between stop 1 (t=0) and stop 2 (t=0.5)
      // Stop 1 is at x=0, stop 2 is at x=500
      // Halfway should be x=250
      const active = engine.getActiveTrains(0.25);
      expect(active).toHaveLength(1);

      const pos = active[0]!.position;
      expect(pos[0]).toBeCloseTo(250, 0);
      expect(pos[1]).toBeCloseTo(-15, 0);
      expect(pos[2]).toBeCloseTo(0, 0);
    });

    it('returns position at second stop when time matches', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      // At t=0.5, should be at stop 2 (x=500)
      const active = engine.getActiveTrains(0.5);
      expect(active).toHaveLength(1);

      const pos = active[0]!.position;
      expect(pos[0]).toBeCloseTo(500, 0);
    });

    it('returns interpolated position between second and third stops', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      // At t=0.75, should be halfway between stop 2 (t=0.5, x=500) and stop 3 (t=0.999, x=1000)
      // Progress = (0.75 - 0.5) / (0.999 - 0.5) = 0.25 / 0.499 ≈ 0.501
      // Position = 500 + 0.501 * 500 ≈ 750.5
      const active = engine.getActiveTrains(0.75);
      expect(active).toHaveLength(1);

      const pos = active[0]!.position;
      expect(pos[0]).toBeCloseTo(750.5, 0); // Allow tolerance of 1 decimal place
    });

    it('uses distanceAlongRoute for accurate polyline interpolation', () => {
      // Create a trip with an L-shaped polyline
      const trip: Trip = {
        id: 'trip-L',
        lineId: '1',
        direction: 1,
        color: '#EE352E',
        stops: [
          {
            stopId: 's1',
            stationName: 'A',
            arrivalTime: 0.0,
            position: [0, -15, 0],
            distanceAlongRoute: 0,
          },
          {
            stopId: 's2',
            stationName: 'B',
            arrivalTime: 1.0,
            position: [100, -15, 100],
            distanceAlongRoute: 200, // 100m right + 100m down
          },
        ],
        polyline: [
          [0, -15, 0],     // Start
          [100, -15, 0],   // Corner (100m from start)
          [100, -15, 100], // End (200m from start)
        ],
        totalLength: 200,
        tEnter: 0.0,
        tExit: 1.0,
      };

      const engine = new TripEngine([trip]);

      // At t=0.5, should be at the corner (100m along the 200m route)
      const active = engine.getActiveTrains(0.5);
      expect(active).toHaveLength(1);

      const pos = active[0]!.position;
      expect(pos[0]).toBeCloseTo(100, 1);  // x at corner
      expect(pos[1]).toBeCloseTo(-15, 1);  // y unchanged
      expect(pos[2]).toBeCloseTo(0, 1);    // z at corner (before turning)
    });
  });

  // =============================================================================
  // Progress Calculation Tests
  // =============================================================================

  describe('progress calculation', () => {
    it('returns 0 progress at trip start', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.0);
      expect(active[0]!.progress).toBeCloseTo(0, 2);
    });

    it('returns progress based on distance traveled', () => {
      const trip = makeMockTrip(); // 1000m total
      const engine = new TripEngine([trip]);

      // At t=0.25, between stop 1 (0m) and stop 2 (500m)
      // Progress through stops = 0.5
      // Distance = 0.5 * 500 = 250m
      // Overall progress = 250 / 1000 = 0.25
      const active = engine.getActiveTrains(0.25);
      expect(active[0]!.progress).toBeCloseTo(0.25, 1);
    });

    it('returns 0.5 progress at midpoint of route', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      // At t=0.5, at stop 2 which is 500m of 1000m = 0.5 progress
      const active = engine.getActiveTrains(0.5);
      expect(active[0]!.progress).toBeCloseTo(0.5, 1);
    });
  });

  // =============================================================================
  // ActiveTrain Output Tests
  // =============================================================================

  describe('ActiveTrain output', () => {
    it('includes all required fields', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.25);
      expect(active).toHaveLength(1);

      const train = active[0]!;
      expect(train).toHaveProperty('id', 'trip-1');
      expect(train).toHaveProperty('lineId', '1');
      expect(train).toHaveProperty('position');
      expect(train).toHaveProperty('progress');
      expect(train).toHaveProperty('direction', 1);
      expect(train).toHaveProperty('crowding');
      expect(train).toHaveProperty('color', '#EE352E');
    });

    it('preserves direction from trip', () => {
      const trip = makePartialTrip(); // direction: -1
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.3);
      expect(active[0]!.direction).toBe(-1);
    });

    it('preserves color from trip', () => {
      const trip = makePartialTrip(); // color: '#0039A6'
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.3);
      expect(active[0]!.color).toBe('#0039A6');
    });

    it('provides default crowding value', () => {
      const trip = makeMockTrip();
      const engine = new TripEngine([trip]);

      const active = engine.getActiveTrains(0.25);
      expect(active[0]!.crowding).toBeGreaterThanOrEqual(0);
      expect(active[0]!.crowding).toBeLessThanOrEqual(1);
    });
  });

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    it('handles trip with only 2 stops', () => {
      const trip: Trip = {
        id: 'trip-2-stops',
        lineId: '1',
        direction: 1,
        color: '#EE352E',
        stops: [
          {
            stopId: 's1',
            stationName: 'Start',
            arrivalTime: 0.0,
            position: [0, -15, 0],
            distanceAlongRoute: 0,
          },
          {
            stopId: 's2',
            stationName: 'End',
            arrivalTime: 1.0,
            position: [500, -15, 0],
            distanceAlongRoute: 500,
          },
        ],
        polyline: [[0, -15, 0], [500, -15, 0]],
        totalLength: 500,
        tEnter: 0.0,
        tExit: 1.0,
      };

      const engine = new TripEngine([trip]);

      // At t=0.5, should be at 250
      const active = engine.getActiveTrains(0.5);
      expect(active).toHaveLength(1);
      expect(active[0]!.position[0]).toBeCloseTo(250, 0);
    });

    it('handles trip that starts before simulation window', () => {
      const trip: Trip = {
        id: 'trip-early',
        lineId: '1',
        direction: 1,
        color: '#EE352E',
        stops: [
          {
            stopId: 's1',
            stationName: 'Before',
            arrivalTime: -0.2,
            position: [0, -15, 0],
            distanceAlongRoute: 0,
          },
          {
            stopId: 's2',
            stationName: 'During',
            arrivalTime: 0.5,
            position: [500, -15, 0],
            distanceAlongRoute: 500,
          },
        ],
        polyline: [[0, -15, 0], [500, -15, 0]],
        totalLength: 500,
        tEnter: -0.2,
        tExit: 0.5,
      };

      const engine = new TripEngine([trip]);

      // At t=0, trip should be active (between tEnter and tExit)
      const active = engine.getActiveTrains(0.0);
      expect(active).toHaveLength(1);

      // Position should be interpolated correctly
      // Progress in stops: (0 - (-0.2)) / (0.5 - (-0.2)) = 0.2 / 0.7 ≈ 0.286
      // Position: 0.286 * 500 ≈ 143
      expect(active[0]!.position[0]).toBeCloseTo(143, -1);
    });

    it('handles very short trip duration', () => {
      const trip: Trip = {
        id: 'trip-short',
        lineId: '1',
        direction: 1,
        color: '#EE352E',
        stops: [
          {
            stopId: 's1',
            stationName: 'A',
            arrivalTime: 0.5,
            position: [0, -15, 0],
            distanceAlongRoute: 0,
          },
          {
            stopId: 's2',
            stationName: 'B',
            arrivalTime: 0.501,
            position: [100, -15, 0],
            distanceAlongRoute: 100,
          },
        ],
        polyline: [[0, -15, 0], [100, -15, 0]],
        totalLength: 100,
        tEnter: 0.5,
        tExit: 0.501,
      };

      const engine = new TripEngine([trip]);

      // Should still work at t=0.5
      const active = engine.getActiveTrains(0.5);
      expect(active).toHaveLength(1);
      expect(active[0]!.position[0]).toBeCloseTo(0, 0);
    });

    it('handles empty stops array gracefully', () => {
      const trip: Trip = {
        id: 'trip-empty',
        lineId: '1',
        direction: 1,
        color: '#EE352E',
        stops: [],
        polyline: [[0, -15, 0]],
        totalLength: 0,
        tEnter: 0.0,
        tExit: 1.0,
      };

      const engine = new TripEngine([trip]);

      // Should return empty (no valid stops to interpolate)
      const active = engine.getActiveTrains(0.5);
      expect(active).toHaveLength(0);
    });

    it('handles single stop gracefully', () => {
      const trip: Trip = {
        id: 'trip-single',
        lineId: '1',
        direction: 1,
        color: '#EE352E',
        stops: [
          {
            stopId: 's1',
            stationName: 'Only',
            arrivalTime: 0.5,
            position: [250, -15, 0],
            distanceAlongRoute: 250,
          },
        ],
        polyline: [[250, -15, 0]],
        totalLength: 0,
        tEnter: 0.5,
        tExit: 0.5,
      };

      const engine = new TripEngine([trip]);

      // With tEnter = tExit = 0.5, train won't be active at t=0.5 (t < tExit required)
      const active = engine.getActiveTrains(0.5);
      expect(active).toHaveLength(0);
    });
  });

  // =============================================================================
  // Performance Tests
  // =============================================================================

  describe('performance', () => {
    it('handles 1000 trips efficiently', () => {
      const trips: Trip[] = [];
      for (let i = 0; i < 1000; i++) {
        trips.push({
          id: `trip-${i}`,
          lineId: '1',
          direction: 1,
          color: '#EE352E',
          stops: [
            { stopId: 's1', stationName: 'A', arrivalTime: 0.0, position: [0, -15, 0], distanceAlongRoute: 0 },
            { stopId: 's2', stationName: 'B', arrivalTime: 1.0, position: [100, -15, 0], distanceAlongRoute: 100 },
          ],
          polyline: [[0, -15, 0], [50, -15, 0], [100, -15, 0]],
          totalLength: 100,
          tEnter: 0.0,
          tExit: 1.0,
        });
      }

      const engine = new TripEngine(trips);

      const start = performance.now();
      for (let i = 0; i < 60; i++) {
        engine.getActiveTrains(i / 60);
      }
      const elapsed = performance.now() - start;

      // Should complete in under 100ms for 60 frames
      expect(elapsed).toBeLessThan(100);
    });
  });
});
