/**
 * TrafficEngine - Pure TypeScript simulation logic for road traffic.
 *
 * Manages vehicle spawning, movement, and removal for the traffic visualization.
 *
 * Per CLAUDE.md §8.3: Engine owns state computation, components only render.
 * Per CLAUDE.md §8.5: Vehicle spawning happens on slice transitions, not per-frame.
 *
 * Key behaviors:
 * - Spawns vehicles only when entering a new time slice
 * - Moves vehicles along road segments based on avgSpeedMph
 * - Removes vehicles that complete their segment (progress >= 1)
 * - Enforces a maximum vehicle limit
 * - Uses object pooling to minimize GC pressure
 */
import type { RoadSegment, Point3D } from '../data/types';
import { getSliceIndex } from '../utils/sliceIndex';
import { interpolatePolyline, getPolylineLength } from '../utils/interpolation';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a vehicle's current state for rendering.
 */
export interface VehicleState {
  /** Unique vehicle identifier */
  id: string;

  /** Road segment this vehicle is on */
  segmentId: string;

  /** Current 3D position along the segment */
  position: Point3D;

  /** Progress along segment [0, 1] */
  progress: number;

  /** Congestion factor from segment (0-1, for color mapping) */
  congestion: number;

  /** Current speed in meters per second */
  speedMps: number;
}

/**
 * Internal vehicle object for pooling.
 * Includes additional fields not exposed in VehicleState.
 */
interface PooledVehicle extends VehicleState {
  /** Whether this vehicle slot is currently active */
  active: boolean;

  /** Length of the segment in meters (cached for speed calculation) */
  segmentLength: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Conversion factor: miles per hour to meters per second */
const MPH_TO_MPS = 1609.34 / 3600; // ≈ 0.44704

// =============================================================================
// Engine Class
// =============================================================================

/**
 * TrafficEngine manages vehicle state for traffic visualization.
 *
 * Usage:
 * ```ts
 * const engine = new TrafficEngine(roadSegments, 2000);
 *
 * // In render loop:
 * engine.update(simulationTime, deltaTime);
 * const vehicles = engine.getVehicles();
 * // Update InstancedMesh with vehicles
 * ```
 */
export class TrafficEngine {
  private segments: RoadSegment[];
  private segmentLengths: Map<string, number>;
  private maxVehicles: number;

  /** Object pool of vehicles */
  private pool: PooledVehicle[];

  /** Current count of active vehicles */
  private activeCount: number;

  /** Last slice index we spawned for */
  private lastSliceIndex: number;

  /** Counter for generating unique vehicle IDs */
  private nextVehicleId: number;

  /**
   * Creates a new TrafficEngine.
   *
   * @param segments - Array of road segment definitions
   * @param maxVehicles - Maximum number of simultaneous vehicles
   */
  constructor(segments: RoadSegment[], maxVehicles: number) {
    this.segments = segments;
    this.maxVehicles = maxVehicles;
    this.pool = [];
    this.activeCount = 0;
    this.lastSliceIndex = -1; // -1 means uninitialized
    this.nextVehicleId = 0;

    // Pre-calculate segment lengths
    this.segmentLengths = new Map();
    for (const segment of segments) {
      this.segmentLengths.set(segment.id, getPolylineLength(segment.points));
    }
  }

  /**
   * Update the traffic simulation.
   *
   * @param simulationTime - Current simulation time [0, 1)
   * @param dt - Delta time in seconds since last update
   */
  update(simulationTime: number, dt: number): void {
    const currentSlice = getSliceIndex(simulationTime);

    // Handle slice transitions - spawn new vehicles
    if (currentSlice !== this.lastSliceIndex) {
      this.spawnForSlice(currentSlice);
      this.lastSliceIndex = currentSlice;
    }

    // Move existing vehicles (only if dt > 0)
    if (dt > 0) {
      this.moveVehicles(dt);
    }

    // Remove completed vehicles
    this.removeCompletedVehicles();
  }

  /**
   * Get current active vehicles for rendering.
   *
   * @returns Array of active vehicle states
   */
  getVehicles(): VehicleState[] {
    const result: VehicleState[] = [];
    for (const vehicle of this.pool) {
      if (vehicle.active) {
        result.push({
          id: vehicle.id,
          segmentId: vehicle.segmentId,
          position: vehicle.position,
          progress: vehicle.progress,
          congestion: vehicle.congestion,
          speedMps: vehicle.speedMps,
        });
      }
    }
    return result;
  }

  /**
   * Get the current number of active vehicles.
   */
  getVehicleCount(): number {
    return this.activeCount;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Spawn vehicles for entering a new time slice.
   */
  private spawnForSlice(sliceIndex: number): void {
    for (const segment of this.segments) {
      // Get spawn count for this slice
      const spawnCount = segment.spawnRates[sliceIndex] ?? 0;

      for (let i = 0; i < spawnCount; i++) {
        // Check max limit
        if (this.activeCount >= this.maxVehicles) {
          return;
        }

        this.spawnVehicle(segment);
      }
    }
  }

  /**
   * Spawn a single vehicle on a segment.
   */
  private spawnVehicle(segment: RoadSegment): void {
    const segmentLength = this.segmentLengths.get(segment.id) ?? 0;
    const speedMps = segment.avgSpeedMph * MPH_TO_MPS;
    const startPosition = interpolatePolyline(segment.points, 0);

    // Try to reuse a pooled vehicle
    let vehicle = this.getPooledVehicle();

    if (vehicle) {
      // Reuse pooled vehicle
      vehicle.id = `v${this.nextVehicleId++}`;
      vehicle.segmentId = segment.id;
      vehicle.position = startPosition;
      vehicle.progress = 0;
      vehicle.congestion = segment.congestionFactor;
      vehicle.speedMps = speedMps;
      vehicle.active = true;
      vehicle.segmentLength = segmentLength;
    } else {
      // Create new vehicle
      vehicle = {
        id: `v${this.nextVehicleId++}`,
        segmentId: segment.id,
        position: startPosition,
        progress: 0,
        congestion: segment.congestionFactor,
        speedMps: speedMps,
        active: true,
        segmentLength: segmentLength,
      };
      this.pool.push(vehicle);
    }

    this.activeCount++;
  }

  /**
   * Find an inactive vehicle in the pool for reuse.
   */
  private getPooledVehicle(): PooledVehicle | null {
    for (const vehicle of this.pool) {
      if (!vehicle.active) {
        return vehicle;
      }
    }
    return null;
  }

  /**
   * Move all active vehicles based on their speed and delta time.
   */
  private moveVehicles(dt: number): void {
    for (const vehicle of this.pool) {
      if (!vehicle.active) continue;

      // Calculate progress delta
      // progress = distance / segmentLength
      // distance = speed * dt
      const segmentLength = vehicle.segmentLength;
      if (segmentLength <= 0) continue;

      const distanceTraveled = vehicle.speedMps * dt;
      const progressDelta = distanceTraveled / segmentLength;

      vehicle.progress += progressDelta;

      // Update position if still active
      if (vehicle.progress < 1) {
        const segment = this.segments.find((s) => s.id === vehicle.segmentId);
        if (segment) {
          vehicle.position = interpolatePolyline(segment.points, vehicle.progress);
        }
      }
    }
  }

  /**
   * Remove vehicles that have completed their segment.
   */
  private removeCompletedVehicles(): void {
    for (const vehicle of this.pool) {
      if (vehicle.active && vehicle.progress >= 1) {
        vehicle.active = false;
        this.activeCount--;
      }
    }
  }
}
