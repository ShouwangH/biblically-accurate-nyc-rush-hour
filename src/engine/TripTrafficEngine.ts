/**
 * TripTrafficEngine - Trip-based traffic simulation.
 *
 * Simulates vehicles following pre-computed route templates for realistic
 * multi-segment trips through the road network.
 *
 * Feature flag: USE_TRIP_TRAFFIC (when enabled, replaces TrafficEngine)
 *
 * Key features:
 * - Pre-computed routes for O(1) segment transitions
 * - Leftover distance carry for smooth cross-segment movement
 * - Swap-remove despawn for dense array (no tombstones)
 * - Load scaling to maintain target vehicle count
 *
 * Per CLAUDE.md §8.3: Engine owns state, components only render.
 */
import type { Point3D, GraphRoadSegment, RouteTemplate } from '../data/types';
import { getSliceIndex } from '../utils/sliceIndex';
import { interpolatePolyline } from '../utils/interpolation';

// =============================================================================
// Types
// =============================================================================

/**
 * Vehicle state for trip-based traffic.
 */
export interface TripVehicle {
  id: string;
  segmentId: string;
  position: Point3D;
  progress: number;
  speedRatio: number;
  speedMps: number;
  traveledMeters: number;
  targetMeters: number;
  heading: number;
}

/**
 * Internal vehicle representation.
 */
interface InternalVehicle {
  id: string;
  routeTemplate: RouteTemplate;
  routeIndex: number;
  segmentId: string;
  progress: number;
  speedMps: number;
  speedRatio: number;
  traveledMeters: number;
  targetMeters: number;
  position: Point3D;
  heading: number;
  markedForDespawn: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const MPH_TO_MPS = 0.44704;
const MAX_TRANSITIONS_PER_FRAME = 5;
const LOAD_SOFT_CAP = 0.7;
const LOAD_HARD_CAP = 0.95;
const TRIP_LENGTH_MEAN = 800;
const TRIP_LENGTH_MIN = 200;
const TRIP_LENGTH_MAX = 2500;
const TRIP_LENGTH_SIGMA = 0.5;
const SPAWN_MULTIPLIER = 7.5;

// =============================================================================
// Helpers
// =============================================================================

function sampleTripLength(): number {
  const mu = Math.log(TRIP_LENGTH_MEAN) - (TRIP_LENGTH_SIGMA * TRIP_LENGTH_SIGMA) / 2;
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = Math.exp(mu + TRIP_LENGTH_SIGMA * z);
  return Math.max(TRIP_LENGTH_MIN, Math.min(TRIP_LENGTH_MAX, raw));
}

function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

function interpolateHeading(startHeading: number, endHeading: number, progress: number): number {
  let diff = endHeading - startHeading;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  let heading = startHeading + diff * progress;
  if (heading < 0) heading += 360;
  if (heading >= 360) heading -= 360;
  return heading;
}

// =============================================================================
// Engine
// =============================================================================

export class TripTrafficEngine {
  private segments: Map<string, GraphRoadSegment>;
  private routesByEntry: Map<string, RouteTemplate[]>;
  private entrySegmentIds: string[];
  private maxVehicles: number;
  private vehicles: InternalVehicle[];
  private lastSliceIndex: number;
  private nextVehicleId: number;

  constructor(
    segments: GraphRoadSegment[],
    routesByEntry: Record<string, RouteTemplate[]>,
    maxVehicles: number
  ) {
    this.segments = new Map();
    for (const segment of segments) {
      this.segments.set(segment.id, segment);
    }

    this.routesByEntry = new Map();
    for (const [entryId, routes] of Object.entries(routesByEntry)) {
      this.routesByEntry.set(entryId, routes);
    }

    this.entrySegmentIds = Array.from(this.routesByEntry.keys());
    this.maxVehicles = maxVehicles;
    this.vehicles = [];
    this.lastSliceIndex = -1;
    this.nextVehicleId = 0;
  }

  update(t: number, dt: number): void {
    this.moveVehicles(dt);
    this.despawnMarkedVehicles();

    const currentSlice = getSliceIndex(t);
    if (currentSlice !== this.lastSliceIndex) {
      this.spawnVehiclesForSlice(currentSlice);
      this.lastSliceIndex = currentSlice;
    }
  }

  getVehicles(): TripVehicle[] {
    return this.vehicles.map((v) => ({
      id: v.id,
      segmentId: v.segmentId,
      position: [...v.position] as Point3D,
      progress: v.progress,
      speedRatio: v.speedRatio,
      speedMps: v.speedMps,
      traveledMeters: v.traveledMeters,
      targetMeters: v.targetMeters,
      heading: v.heading,
    }));
  }

  getVehicleCount(): number {
    return this.vehicles.length;
  }

  getEntrySegmentIds(): string[] {
    return [...this.entrySegmentIds];
  }

  private spawnVehiclesForSlice(sliceIndex: number): void {
    const loadRatio = this.vehicles.length / this.maxVehicles;
    if (loadRatio >= LOAD_HARD_CAP) return;

    let spawnScale = 1.0;
    if (loadRatio > LOAD_SOFT_CAP) {
      spawnScale = (LOAD_HARD_CAP - loadRatio) / (LOAD_HARD_CAP - LOAD_SOFT_CAP);
    }

    for (const entryId of this.entrySegmentIds) {
      const segment = this.segments.get(entryId);
      if (!segment) continue;

      const routes = this.routesByEntry.get(entryId);
      if (!routes || routes.length === 0) continue;

      const rawRate = (segment.spawnRates[sliceIndex] ?? 0) * SPAWN_MULTIPLIER;
      const scaledRate = rawRate * spawnScale;
      const spawnCount = poissonSample(scaledRate);

      for (let i = 0; i < spawnCount; i++) {
        if (this.vehicles.length >= this.maxVehicles) return;
        this.spawnVehicle(segment, routes);
      }
    }
  }

  private spawnVehicle(_entrySegment: GraphRoadSegment, routes: RouteTemplate[]): void {
    const targetLength = sampleTripLength();
    const route = this.selectBestRoute(routes, targetLength);
    if (!route) return;

    const segment = this.segments.get(route.segmentSequence[0]!);
    if (!segment) return;

    const startPosition = interpolatePolyline(segment.points, 0);

    const vehicle: InternalVehicle = {
      id: `trip_${this.nextVehicleId++}`,
      routeTemplate: route,
      routeIndex: 0,
      segmentId: route.segmentSequence[0]!,
      progress: 0,
      speedMps: segment.avgSpeedMph * MPH_TO_MPS,
      speedRatio: segment.speedRatio,
      traveledMeters: 0,
      targetMeters: Math.min(targetLength, route.totalLengthMeters),
      position: startPosition,
      heading: segment.startHeadingDeg,
      markedForDespawn: false,
    };

    this.vehicles.push(vehicle);
  }

  private selectBestRoute(routes: RouteTemplate[], targetLength: number): RouteTemplate | null {
    if (routes.length === 0) return null;

    const viable = routes.filter((r) => r.totalLengthMeters >= targetLength * 0.8);

    if (viable.length === 0) {
      const sorted = [...routes].sort((a, b) => b.totalLengthMeters - a.totalLengthMeters);
      return sorted[0] ?? null;
    }

    const candidateCount = Math.min(viable.length, 5);
    return viable[Math.floor(Math.random() * candidateCount)] ?? null;
  }

  private moveVehicles(dt: number): void {
    const safeDt = Math.max(0, dt);

    for (const vehicle of this.vehicles) {
      if (vehicle.markedForDespawn) continue;

      let remainingDistance = vehicle.speedMps * safeDt;
      let transitionsThisFrame = 0;

      while (remainingDistance > 0 && transitionsThisFrame < MAX_TRANSITIONS_PER_FRAME) {
        const segment = this.segments.get(vehicle.segmentId);
        if (!segment) {
          vehicle.markedForDespawn = true;
          break;
        }

        const segmentLength = segment.lengthMeters || 100;
        const metersToEnd = (1.0 - vehicle.progress) * segmentLength;

        if (remainingDistance < metersToEnd) {
          const progressDelta = remainingDistance / segmentLength;
          vehicle.progress += progressDelta;
          vehicle.traveledMeters += remainingDistance;
          remainingDistance = 0;
        } else {
          vehicle.traveledMeters += metersToEnd;
          remainingDistance -= metersToEnd;
          vehicle.progress = 1.0;

          if (vehicle.traveledMeters >= vehicle.targetMeters) {
            vehicle.markedForDespawn = true;
            break;
          }

          if (!this.transitionToNextSegment(vehicle)) {
            vehicle.markedForDespawn = true;
            break;
          }

          transitionsThisFrame++;
        }
      }

      if (!vehicle.markedForDespawn) {
        const segment = this.segments.get(vehicle.segmentId);
        if (segment) {
          vehicle.position = interpolatePolyline(segment.points, vehicle.progress);
          vehicle.heading = interpolateHeading(
            segment.startHeadingDeg,
            segment.endHeadingDeg,
            vehicle.progress
          );
        }
      }
    }
  }

  private transitionToNextSegment(vehicle: InternalVehicle): boolean {
    const route = vehicle.routeTemplate;
    const nextIndex = vehicle.routeIndex + 1;

    if (nextIndex >= route.segmentSequence.length) return false;

    const nextSegmentId = route.segmentSequence[nextIndex];
    if (!nextSegmentId) return false;

    const nextSegment = this.segments.get(nextSegmentId);
    if (!nextSegment) return false;

    vehicle.routeIndex = nextIndex;
    vehicle.segmentId = nextSegmentId;
    vehicle.progress = 0;
    vehicle.speedMps = nextSegment.avgSpeedMph * MPH_TO_MPS;
    vehicle.speedRatio = nextSegment.speedRatio;

    return true;
  }

  private despawnMarkedVehicles(): void {
    let i = 0;
    while (i < this.vehicles.length) {
      if (this.vehicles[i]!.markedForDespawn) {
        const lastIdx = this.vehicles.length - 1;
        if (i < lastIdx) {
          this.vehicles[i] = this.vehicles[lastIdx]!;
        }
        this.vehicles.pop();
      } else {
        i++;
      }
    }
  }
}
