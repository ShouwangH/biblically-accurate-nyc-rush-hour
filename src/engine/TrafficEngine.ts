/**
 * TrafficEngine - Pure TypeScript simulation logic for road traffic.
 *
 * Manages vehicle spawning, movement, and removal on road segments.
 * Vehicles spawn based on per-slice spawn rates and move along segments
 * at speeds determined by congestion data.
 *
 * Per CLAUDE.md §8.3: Engine owns state computation, components only render.
 *
 * IMPORTANT: getVehicles() returns DEFENSIVE COPIES of position arrays.
 * This prevents callers from accidentally mutating internal engine state.
 */
import type { RoadSegment, Point3D } from '../data/types';
import { interpolatePolyline, getPolylineLength } from '../utils/interpolation';
import { getSliceIndex } from '../utils/sliceIndex';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a vehicle's state at a given moment.
 * Returned by getVehicles() with DEFENSIVE COPIES of arrays.
 */
export interface VehicleState {
  /** Unique vehicle identifier */
  id: string;

  /** Road segment this vehicle is on */
  segmentId: string;

  /** Current 3D position (DEFENSIVE COPY - safe to mutate) */
  position: Point3D;

  /** Progress along segment [0, 1] */
  progress: number;

  /** Congestion factor from segment (avgSpeed/freeFlowSpeed) */
  congestion: number;
}

/**
 * Internal pooled vehicle representation.
 * Position array is owned by the engine and must not be exposed directly.
 */
interface PooledVehicle {
  /** Unique vehicle identifier */
  id: string;

  /** Reference to the road segment */
  segment: RoadSegment;

  /** Cached segment length for performance */
  segmentLength: number;

  /** Current progress along segment [0, 1] */
  progress: number;

  /** Speed in meters per second */
  speedMps: number;

  /** Current 3D position (INTERNAL - do not expose directly) */
  position: Point3D;

  /** Is this vehicle active? */
  active: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Conversion factor: miles per hour to meters per second */
const MPH_TO_MPS = 0.44704;

// =============================================================================
// Engine Class
// =============================================================================

/**
 * TrafficEngine manages road traffic simulation.
 *
 * Features:
 * - Spawns vehicles per time slice based on segment spawnRates
 * - Moves vehicles along segments using avgSpeed
 * - Removes vehicles when they complete their segment
 * - Object pooling for performance
 * - DEFENSIVE COPYING: getVehicles() returns copies, not references
 *
 * Usage:
 * ```ts
 * const engine = new TrafficEngine(segments, 2000);
 *
 * // In render loop:
 * engine.update(simulationTime, deltaSeconds);
 * const vehicles = engine.getVehicles(); // Safe to mutate
 * ```
 */
export class TrafficEngine {
  private segments: RoadSegment[];
  private segmentLengths: Map<string, number>;
  private maxVehicles: number;
  private vehicles: PooledVehicle[];
  private activeCount: number;
  private lastSliceIndex: number;
  private nextVehicleId: number;

  /**
   * Creates a new TrafficEngine.
   *
   * @param segments - Array of road segment definitions
   * @param maxVehicles - Maximum concurrent vehicles (for pooling)
   */
  constructor(segments: RoadSegment[], maxVehicles: number) {
    this.segments = segments;
    this.maxVehicles = maxVehicles;
    this.vehicles = [];
    this.activeCount = 0;
    this.lastSliceIndex = -1; // -1 means no slice processed yet
    this.nextVehicleId = 0;

    // Pre-compute segment lengths
    this.segmentLengths = new Map();
    for (const segment of segments) {
      this.segmentLengths.set(segment.id, getPolylineLength(segment.points));
    }
  }

  /**
   * Update the simulation state.
   *
   * Order of operations:
   * 1. Move existing vehicles (based on dt)
   * 2. Remove vehicles that completed their segment
   * 3. Spawn new vehicles (they start at segment beginning, move next frame)
   *
   * This order ensures newly spawned vehicles appear at segment start
   * and don't move until the next frame.
   *
   * @param t - Current simulation time [0, 1)
   * @param dt - Delta time in seconds since last frame
   */
  update(t: number, dt: number): void {
    // 1. Move existing vehicles first
    this.moveVehicles(dt);

    // 2. Remove vehicles that completed their segment
    this.removeCompletedVehicles();

    // 3. Spawn new vehicles on slice transition (they wait until next frame)
    const currentSlice = getSliceIndex(t);
    if (currentSlice !== this.lastSliceIndex) {
      this.spawnVehiclesForSlice(currentSlice);
      this.lastSliceIndex = currentSlice;
    }
  }

  /**
   * Get all active vehicles with DEFENSIVE COPIES of position arrays.
   *
   * IMPORTANT: Each call returns NEW position array instances.
   * Callers can safely mutate the returned arrays without affecting
   * the engine's internal state.
   *
   * @returns Array of VehicleState objects
   */
  getVehicles(): VehicleState[] {
    const result: VehicleState[] = [];

    for (const vehicle of this.vehicles) {
      if (!vehicle.active) continue;

      result.push({
        id: vehicle.id,
        segmentId: vehicle.segment.id,
        // DEFENSIVE COPY: Create new array to prevent external mutation
        position: [...vehicle.position] as Point3D,
        progress: vehicle.progress,
        congestion: vehicle.segment.congestionFactor,
      });
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
   * Spawn vehicles for all segments based on the current slice's spawn rates.
   */
  private spawnVehiclesForSlice(sliceIndex: number): void {
    for (const segment of this.segments) {
      const spawnCount = segment.spawnRates[sliceIndex] ?? 0;
      const segmentLength = this.segmentLengths.get(segment.id) ?? 0;

      for (let i = 0; i < spawnCount; i++) {
        if (this.activeCount >= this.maxVehicles) {
          return; // Hit capacity
        }

        this.spawnVehicle(segment, segmentLength);
      }
    }
  }

  /**
   * Spawn a single vehicle on a segment.
   */
  private spawnVehicle(segment: RoadSegment, segmentLength: number): void {
    // Calculate speed in meters per second
    const speedMps = segment.avgSpeedMph * MPH_TO_MPS;

    // Get starting position
    const startPosition = interpolatePolyline(segment.points, 0);

    // Try to reuse an inactive pooled vehicle
    let vehicle = this.findInactiveVehicle();

    if (vehicle) {
      // Reuse pooled vehicle
      vehicle.id = `v${this.nextVehicleId++}`;
      vehicle.segment = segment;
      vehicle.segmentLength = segmentLength;
      vehicle.progress = 0;
      vehicle.speedMps = speedMps;
      vehicle.position[0] = startPosition[0];
      vehicle.position[1] = startPosition[1];
      vehicle.position[2] = startPosition[2];
      vehicle.active = true;
    } else {
      // Create new pooled vehicle
      vehicle = {
        id: `v${this.nextVehicleId++}`,
        segment,
        segmentLength,
        progress: 0,
        speedMps,
        position: startPosition, // interpolatePolyline returns a new array
        active: true,
      };
      this.vehicles.push(vehicle);
    }

    this.activeCount++;
  }

  /**
   * Find an inactive vehicle in the pool for reuse.
   */
  private findInactiveVehicle(): PooledVehicle | undefined {
    return this.vehicles.find((v) => !v.active);
  }

  /**
   * Move all active vehicles based on their speed and delta time.
   */
  private moveVehicles(dt: number): void {
    for (const vehicle of this.vehicles) {
      if (!vehicle.active) continue;

      // Skip if segment has no length (avoid division by zero)
      if (vehicle.segmentLength <= 0) {
        vehicle.progress = 1; // Mark as complete
        continue;
      }

      // Calculate distance traveled this frame
      const distanceTraveled = vehicle.speedMps * dt;

      // Convert to progress delta
      const progressDelta = distanceTraveled / vehicle.segmentLength;

      // Update progress
      vehicle.progress = Math.min(1, vehicle.progress + progressDelta);

      // Update position via interpolation
      const newPosition = interpolatePolyline(
        vehicle.segment.points,
        vehicle.progress
      );

      // Update internal position array (no allocation in hot path)
      vehicle.position[0] = newPosition[0];
      vehicle.position[1] = newPosition[1];
      vehicle.position[2] = newPosition[2];
    }
  }

  /**
   * Remove vehicles that have completed their segment (progress >= 1).
   */
  private removeCompletedVehicles(): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.active && vehicle.progress >= 1) {
        vehicle.active = false;
        this.activeCount--;
      }
    }
  }
}
