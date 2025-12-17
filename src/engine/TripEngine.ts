/**
 * TripEngine - Pure TypeScript simulation logic for trip-based subway trains.
 *
 * Uses GTFS trip data with station-to-station timing and full route geometry
 * for smooth, accurate train positioning.
 *
 * Key differences from TrainEngine:
 * - Uses Trip[] instead of TrainRun[] (station-based, not segment-based)
 * - Interpolates position between stops using distanceAlongRoute
 * - Polyline interpolation via O(log n) binary search on cached cumulative distances
 *
 * Per CLAUDE.md §8.3: Engine owns state computation, components only render.
 */
import type { Trip, TripStop, Point3D } from '../data/types';

// =============================================================================
// Cached Polyline (O(log n) interpolation via binary search)
// =============================================================================

interface CachedPolyline {
  points: Point3D[];
  cumulative: number[]; // cum[i] = distance from start to point i
  total: number;
}

function distance(p1: Point3D, p2: Point3D): number {
  const dx = p2[0] - p1[0],
    dy = p2[1] - p1[1],
    dz = p2[2] - p1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function lerp(p1: Point3D, p2: Point3D, t: number): Point3D {
  return [
    p1[0] + (p2[0] - p1[0]) * t,
    p1[1] + (p2[1] - p1[1]) * t,
    p1[2] + (p2[2] - p1[2]) * t,
  ];
}

function buildCachedPolyline(points: Point3D[]): CachedPolyline {
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1]! + distance(points[i - 1]!, points[i]!);
  }
  return { points, cumulative, total: cumulative[cumulative.length - 1] ?? 0 };
}

/**
 * Interpolate position at a given distance along a cached polyline.
 * Uses binary search for O(log n) performance.
 *
 * @param cached - Pre-computed polyline with cumulative distances
 * @param dist - Distance from start of polyline in meters
 * @returns Interpolated 3D position
 */
function interpolateByDistance(cached: CachedPolyline, dist: number): Point3D {
  const { points, cumulative, total } = cached;
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1 || total <= 0) return [...points[0]!] as Point3D;

  // Clamp distance to [0, total]
  const d = Math.max(0, Math.min(total, dist));
  if (d === 0) return [...points[0]!] as Point3D;
  if (d >= total) return [...points[points.length - 1]!] as Point3D;

  // Binary search for segment containing target distance
  let lo = 1,
    hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! < d) lo = mid + 1;
    else hi = mid;
  }

  const segLen = cumulative[lo]! - cumulative[lo - 1]!;
  if (segLen <= 0) return [...points[lo]!] as Point3D;

  const segProgress = (d - cumulative[lo - 1]!) / segLen;
  return lerp(points[lo - 1]!, points[lo]!, segProgress);
}

// =============================================================================
// Types
// =============================================================================

/**
 * Represents an active train at a given simulation time.
 * Same interface as TrainEngine for compatibility with Trains.tsx.
 */
export interface ActiveTrain {
  /** Unique train identifier (trip_id) */
  id: string;

  /** Line identifier (e.g., "A", "1") */
  lineId: string;

  /** Current 3D position along the route */
  position: Point3D;

  /** Progress along entire route [0, 1] */
  progress: number;

  /** Direction: +1 = northbound, -1 = southbound */
  direction: 1 | -1;

  /** Crowding level [0, 1] (default 0.5 for now) */
  crowding: number;

  /** Line color for rendering */
  color: string;
}

// =============================================================================
// Engine Class
// =============================================================================

/**
 * TripEngine computes active trains for a given simulation time.
 *
 * Features:
 * - Filters trips to only those active within [tEnter, tExit)
 * - Finds the current stop pair based on time
 * - Interpolates position along polyline between stops
 * - Uses O(log n) binary search for polyline interpolation
 *
 * Usage:
 * ```ts
 * const engine = new TripEngine(trips);
 * const activeTrains = engine.getActiveTrains(simulationTime);
 * // Render activeTrains with InstancedMesh
 * ```
 */
export class TripEngine {
  private trips: Trip[];
  /** Cached polylines for O(log n) interpolation */
  private polylineCache: Map<string, CachedPolyline>;

  /**
   * Creates a new TripEngine.
   *
   * @param trips - Array of trip definitions
   */
  constructor(trips: Trip[]) {
    this.trips = trips;

    // Pre-build cached polylines for all trips (one-time cost)
    this.polylineCache = new Map();
    for (const trip of trips) {
      if (trip.polyline.length >= 2) {
        this.polylineCache.set(trip.id, buildCachedPolyline(trip.polyline));
      }
    }
  }

  /**
   * Get all active trains at a given simulation time.
   *
   * @param t - Simulation time in [0, 1)
   * @returns Array of ActiveTrain objects for rendering
   */
  getActiveTrains(t: number): ActiveTrain[] {
    const activeTrains: ActiveTrain[] = [];

    for (const trip of this.trips) {
      // Check if trip is active at this time
      // Active when: tEnter <= t < tExit
      if (!this.isTripActive(trip, t)) {
        continue;
      }

      // Need at least 2 stops to interpolate
      if (trip.stops.length < 2) {
        continue;
      }

      // Find which stop pair we're between
      const stopPair = this.findStopPair(trip, t);
      if (!stopPair) {
        continue;
      }

      const { prevStop, nextStop, progress: stopProgress } = stopPair;

      // Interpolate distance along route between stops
      const distStart = prevStop.distanceAlongRoute;
      const distEnd = nextStop.distanceAlongRoute;
      const currentDist = distStart + (distEnd - distStart) * stopProgress;

      // Get position via cached polyline interpolation
      const cached = this.polylineCache.get(trip.id);
      if (!cached) {
        continue;
      }

      const position = interpolateByDistance(cached, currentDist);

      // Compute overall progress along route
      const overallProgress =
        trip.totalLength > 0 ? currentDist / trip.totalLength : 0;

      activeTrains.push({
        id: trip.id,
        lineId: trip.lineId,
        position,
        progress: overallProgress,
        direction: trip.direction,
        crowding: 0.5, // Default crowding (TODO: could be from ridership data)
        color: trip.color,
      });
    }

    return activeTrains;
  }

  /**
   * Check if a trip is active at the given time.
   *
   * Trip is active when: tEnter <= t < tExit
   * (inclusive entry, exclusive exit)
   */
  private isTripActive(trip: Trip, t: number): boolean {
    return t >= trip.tEnter && t < trip.tExit;
  }

  /**
   * Find the stop pair that the train is between at time t.
   *
   * @returns Object with prevStop, nextStop, and progress between them, or null if not found
   */
  private findStopPair(
    trip: Trip,
    t: number
  ): { prevStop: TripStop; nextStop: TripStop; progress: number } | null {
    const { stops } = trip;

    // Handle time before first stop
    if (t < stops[0]!.arrivalTime) {
      // Use first two stops, extrapolate backward
      const duration = stops[1]!.arrivalTime - stops[0]!.arrivalTime;
      const progress =
        duration > 0 ? (t - stops[0]!.arrivalTime) / duration : 0;
      return {
        prevStop: stops[0]!,
        nextStop: stops[1]!,
        progress: Math.max(0, progress), // Clamp to 0 if before first stop
      };
    }

    // Find the stop pair containing time t
    for (let i = 0; i < stops.length - 1; i++) {
      const curr = stops[i]!;
      const next = stops[i + 1]!;

      if (t >= curr.arrivalTime && t < next.arrivalTime) {
        const duration = next.arrivalTime - curr.arrivalTime;
        const progress = duration > 0 ? (t - curr.arrivalTime) / duration : 0;
        return {
          prevStop: curr,
          nextStop: next,
          progress: Math.min(1, Math.max(0, progress)),
        };
      }
    }

    // Handle time at or after last stop (shouldn't happen if tExit is correct)
    // Use last two stops
    const lastIdx = stops.length - 1;
    return {
      prevStop: stops[lastIdx - 1]!,
      nextStop: stops[lastIdx]!,
      progress: 1,
    };
  }
}
