/**
 * CorridorFlowEngine - Hybrid mesoscopic/microscopic traffic simulation
 *
 * Implements the hybrid model from the architecture review:
 * - MESO: Corridor particles (1D flow along arterials)
 * - MICRO: Individual agents (at intersections, near camera)
 *
 * Conservation Rule: meso + micro = budget (no double-counting)
 *
 * Per CLAUDE.md §8.3: Engine owns state, components only render.
 */
import type { Point3D, RoadSegment } from '../data/types';
import { interpolatePolyline, getPolylineLength, getPolylineHeading } from '../utils/interpolation';

// =============================================================================
// Types
// =============================================================================

/**
 * A corridor is a chain of road segments treated as a single flow field.
 * Particles move in 1D along the corridor's total length.
 */
export interface Corridor {
  id: string;
  name: string;
  segmentIds: string[];
  totalLength: number;
  lanes: number;

  /** Cumulative lengths at each segment boundary: [0, len0, len0+len1, ...] */
  cumulativeLengths: number[];

  /** Polyline points for entire corridor (concatenated from segments) */
  points: Point3D[];

  /** Target density in vehicles per meter (can vary with time) */
  targetDensity: number;

  /** Current speed in m/s */
  speed: number;
}

/**
 * A meso particle - moves in 1D along a corridor.
 * Super cheap: just update s += speed * dt
 */
export interface MesoParticle {
  id: string;
  corridorId: string;
  s: number;           // position along corridor [0, totalLength]
  lane: number;        // lateral offset (0, 1, 2...) for visual variety
  active: boolean;
}

/**
 * A micro agent - full 2D/3D position and pathfinding.
 * Created when meso particle converts at intersection or near camera.
 */
export interface MicroAgent {
  id: string;
  position: Point3D;
  heading: number;
  speed: number;

  // Simple path: list of waypoints to follow
  waypoints: Point3D[];
  waypointIndex: number;

  // Track origin for debugging
  origin: 'meso_turn' | 'side_street' | 'boundary';
  active: boolean;
}

/**
 * Intersection region where meso→micro conversion can happen.
 */
export interface IntersectionRegion {
  id: string;
  center: Point3D;
  radius: number;

  /** s-values where this intersection occurs on each corridor */
  corridorCrossings: Map<string, number>;

  /** Turn probability (0 to 1) */
  turnProbability: number;
}

/**
 * Unified vehicle state for rendering (same interface as TrafficEngine).
 * Both meso particles and micro agents get converted to this for rendering.
 */
export interface VehicleState {
  id: string;
  position: Point3D;
  heading: number;
  speed: number;
  type: 'meso' | 'micro';
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum spacing between particles in meters */
const MIN_HEADWAY = 8;

/** Lateral offset per lane in meters */
const LANE_WIDTH = 3.5;

/** Default turn probability at intersections */
const DEFAULT_TURN_PROB = 0.15;

/** Maximum micro agents (performance cap) */
const MAX_MICRO_AGENTS = 500;

/** Speed for converted micro agents (m/s) */
const MICRO_SPEED = 5;

// =============================================================================
// Engine Class
// =============================================================================

export class CorridorFlowEngine {
  private corridors: Map<string, Corridor> = new Map();
  private mesoParticles: MesoParticle[] = [];
  private microAgents: MicroAgent[] = [];
  private intersections: IntersectionRegion[] = [];

  private nextParticleId = 0;
  private nextAgentId = 0;

  // Pre-computed segment lookup for corridor→world position
  private segmentsByCorridorId: Map<string, RoadSegment[]> = new Map();

  constructor() {
    // Engine starts empty, corridors added via addCorridor()
  }

  // ===========================================================================
  // Setup Methods
  // ===========================================================================

  /**
   * Add a corridor from existing road segments.
   * Segments should be ordered and connected end-to-end.
   */
  addCorridor(
    id: string,
    name: string,
    segments: RoadSegment[],
    options: { lanes?: number; targetDensity?: number; speed?: number } = {}
  ): void {
    const { lanes = 2, targetDensity = 0.04, speed = 6 } = options;

    // Concatenate points from all segments
    const points: Point3D[] = [];
    const cumulativeLengths: number[] = [0];
    let totalLength = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const segLength = getPolylineLength(seg.points);

      // Add points (skip first point of subsequent segments to avoid duplicates)
      const startIdx = i === 0 ? 0 : 1;
      for (let j = startIdx; j < seg.points.length; j++) {
        points.push(seg.points[j]!);
      }

      totalLength += segLength;
      cumulativeLengths.push(totalLength);
    }

    const corridor: Corridor = {
      id,
      name,
      segmentIds: segments.map((s) => s.id),
      totalLength,
      lanes,
      cumulativeLengths,
      points,
      targetDensity,
      speed,
    };

    this.corridors.set(id, corridor);
    this.segmentsByCorridorId.set(id, segments);
  }

  /**
   * Add an intersection region where meso→micro conversion can occur.
   */
  addIntersection(
    id: string,
    center: Point3D,
    radius: number,
    turnProbability: number = DEFAULT_TURN_PROB
  ): void {
    const intersection: IntersectionRegion = {
      id,
      center,
      radius,
      corridorCrossings: new Map(),
      turnProbability,
    };

    // Find where each corridor crosses this intersection
    for (const [corridorId, corridor] of this.corridors) {
      const crossingS = this.findCorridorCrossing(corridor, center, radius);
      if (crossingS !== null) {
        intersection.corridorCrossings.set(corridorId, crossingS);
      }
    }

    this.intersections.push(intersection);
  }

  /**
   * Initialize particles for all corridors based on target density.
   */
  initialize(): void {
    this.mesoParticles = [];
    this.microAgents = [];

    for (const corridor of this.corridors.values()) {
      const targetCount = Math.floor(corridor.targetDensity * corridor.totalLength);

      for (let i = 0; i < targetCount; i++) {
        // Distribute evenly along corridor
        const s = (i / targetCount) * corridor.totalLength;
        const lane = i % corridor.lanes;

        this.mesoParticles.push({
          id: `meso_${this.nextParticleId++}`,
          corridorId: corridor.id,
          s,
          lane,
          active: true,
        });
      }
    }
  }

  // ===========================================================================
  // Update Loop
  // ===========================================================================

  /**
   * Update the simulation state.
   *
   * @param dt - Delta time in seconds
   * @param cameraPosition - Optional camera position for detail boost
   */
  update(dt: number, cameraPosition?: Point3D): void {
    // 1. Move meso particles
    this.updateMesoParticles(dt);

    // 2. Check for meso→micro conversions at intersections
    this.checkIntersectionConversions();

    // 3. Update micro agents
    this.updateMicroAgents(dt);

    // 4. Maintain target density (birth/death)
    this.balanceParticleCounts();

    // 5. Optional: Camera detail boost (promote nearby meso to micro)
    if (cameraPosition) {
      this.cameraDetailBoost(cameraPosition);
    }
  }

  /**
   * Get all vehicles (meso + micro) for rendering.
   */
  getVehicles(): VehicleState[] {
    const result: VehicleState[] = [];

    // Add meso particles
    for (const particle of this.mesoParticles) {
      if (!particle.active) continue;

      const corridor = this.corridors.get(particle.corridorId);
      if (!corridor) continue;

      // Convert s to world position
      const progress = particle.s / corridor.totalLength;
      const basePosition = interpolatePolyline(corridor.points, progress);
      const heading = getPolylineHeading(corridor.points, progress);

      // Apply lane offset (perpendicular to heading)
      const laneOffset = (particle.lane - (corridor.lanes - 1) / 2) * LANE_WIDTH;
      const position: Point3D = [
        basePosition[0] + Math.cos(heading + Math.PI / 2) * laneOffset,
        basePosition[1],
        basePosition[2] + Math.sin(heading + Math.PI / 2) * laneOffset,
      ];

      result.push({
        id: particle.id,
        position,
        heading,
        speed: corridor.speed,
        type: 'meso',
      });
    }

    // Add micro agents
    for (const agent of this.microAgents) {
      if (!agent.active) continue;

      result.push({
        id: agent.id,
        position: [...agent.position] as Point3D,
        heading: agent.heading,
        speed: agent.speed,
        type: 'micro',
      });
    }

    return result;
  }

  /**
   * Get counts for debugging/display.
   */
  getCounts(): { meso: number; micro: number; total: number } {
    const meso = this.mesoParticles.filter((p) => p.active).length;
    const micro = this.microAgents.filter((a) => a.active).length;
    return { meso, micro, total: meso + micro };
  }

  /**
   * Reset all state.
   */
  reset(): void {
    for (const p of this.mesoParticles) p.active = false;
    for (const a of this.microAgents) a.active = false;
    this.initialize();
  }

  // ===========================================================================
  // Private Methods - Meso Updates
  // ===========================================================================

  private updateMesoParticles(dt: number): void {
    for (const particle of this.mesoParticles) {
      if (!particle.active) continue;

      const corridor = this.corridors.get(particle.corridorId);
      if (!corridor) continue;

      // Simple 1D motion: s += speed * dt
      particle.s += corridor.speed * dt;

      // Wrap at corridor end (respawn at start)
      if (particle.s >= corridor.totalLength) {
        particle.s = particle.s % corridor.totalLength;
      }
    }

    // Optional: headway clamping (prevent bunching)
    this.clampHeadways();
  }

  private clampHeadways(): void {
    // Group particles by corridor
    const byCorr = new Map<string, MesoParticle[]>();
    for (const p of this.mesoParticles) {
      if (!p.active) continue;
      const list = byCorr.get(p.corridorId) || [];
      list.push(p);
      byCorr.set(p.corridorId, list);
    }

    // For each corridor, sort by s and enforce minimum headway
    for (const [, particles] of byCorr) {
      particles.sort((a, b) => a.s - b.s);

      for (let i = 1; i < particles.length; i++) {
        const prev = particles[i - 1]!;
        const curr = particles[i]!;

        if (curr.s - prev.s < MIN_HEADWAY) {
          curr.s = prev.s + MIN_HEADWAY;
        }
      }
    }
  }

  // ===========================================================================
  // Private Methods - Micro Updates
  // ===========================================================================

  private updateMicroAgents(dt: number): void {
    for (const agent of this.microAgents) {
      if (!agent.active) continue;

      // Move toward current waypoint
      if (agent.waypointIndex < agent.waypoints.length) {
        const target = agent.waypoints[agent.waypointIndex]!;
        const dx = target[0] - agent.position[0];
        const dz = target[2] - agent.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < agent.speed * dt) {
          // Reached waypoint
          agent.position[0] = target[0];
          agent.position[2] = target[2];
          agent.waypointIndex++;
        } else {
          // Move toward waypoint
          const moveX = (dx / dist) * agent.speed * dt;
          const moveZ = (dz / dist) * agent.speed * dt;
          agent.position[0] += moveX;
          agent.position[2] += moveZ;
          agent.heading = Math.atan2(dx, dz);
        }
      } else {
        // Finished path - deactivate (will be absorbed by meso density)
        agent.active = false;
      }
    }
  }

  // ===========================================================================
  // Private Methods - Meso↔Micro Conversion
  // ===========================================================================

  private checkIntersectionConversions(): void {
    for (const intersection of this.intersections) {
      for (const particle of this.mesoParticles) {
        if (!particle.active) continue;

        const crossingS = intersection.corridorCrossings.get(particle.corridorId);
        if (crossingS === undefined) continue;

        // Check if particle is near the crossing point
        const distToIntersection = Math.abs(particle.s - crossingS);
        if (distToIntersection < intersection.radius && Math.random() < intersection.turnProbability * 0.01) {
          // Convert to micro agent!
          this.convertToMicro(particle, intersection);
        }
      }
    }
  }

  private convertToMicro(particle: MesoParticle, _intersection: IntersectionRegion): void {
    if (this.microAgents.filter((a) => a.active).length >= MAX_MICRO_AGENTS) {
      return; // Cap reached
    }

    const corridor = this.corridors.get(particle.corridorId);
    if (!corridor) return;

    // Get current position
    const progress = particle.s / corridor.totalLength;
    const position = interpolatePolyline(corridor.points, progress);
    const heading = getPolylineHeading(corridor.points, progress);

    // Create simple turn path (perpendicular to corridor, 50m)
    const turnDistance = 50;
    const turnHeading = heading + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const endPoint: Point3D = [
      position[0] + Math.sin(turnHeading) * turnDistance,
      0,
      position[2] + Math.cos(turnHeading) * turnDistance,
    ];

    const agent: MicroAgent = {
      id: `micro_${this.nextAgentId++}`,
      position: [...position] as Point3D,
      heading,
      speed: MICRO_SPEED,
      waypoints: [endPoint],
      waypointIndex: 0,
      origin: 'meso_turn',
      active: true,
    };

    this.microAgents.push(agent);

    // Deactivate the meso particle (conservation: we removed one from meso budget)
    particle.active = false;
  }

  // ===========================================================================
  // Private Methods - Density Balance
  // ===========================================================================

  private balanceParticleCounts(): void {
    for (const corridor of this.corridors.values()) {
      const activeCount = this.mesoParticles.filter(
        (p) => p.active && p.corridorId === corridor.id
      ).length;
      const targetCount = Math.floor(corridor.targetDensity * corridor.totalLength);

      if (activeCount < targetCount) {
        // Spawn at corridor start
        this.spawnMesoParticle(corridor);
      }
      // Note: we don't forcibly remove particles - they naturally exit or convert
    }
  }

  private spawnMesoParticle(corridor: Corridor): void {
    // Find inactive particle to reuse
    let particle = this.mesoParticles.find(
      (p) => !p.active && p.corridorId === corridor.id
    );

    if (!particle) {
      particle = {
        id: `meso_${this.nextParticleId++}`,
        corridorId: corridor.id,
        s: 0,
        lane: Math.floor(Math.random() * corridor.lanes),
        active: true,
      };
      this.mesoParticles.push(particle);
    } else {
      particle.s = 0;
      particle.lane = Math.floor(Math.random() * corridor.lanes);
      particle.active = true;
    }
  }

  // ===========================================================================
  // Private Methods - Camera Detail Boost
  // ===========================================================================

  private cameraDetailBoost(_cameraPosition: Point3D): void {
    // Optional: convert some meso particles near camera to micro
    // This adds visual detail without affecting conservation much
    // (For now, skip - can add later)
  }

  // ===========================================================================
  // Private Methods - Utility
  // ===========================================================================

  private findCorridorCrossing(
    corridor: Corridor,
    center: Point3D,
    radius: number
  ): number | null {
    // Sample along corridor to find closest point to intersection center
    const samples = Math.ceil(corridor.totalLength / 10);
    let closestS = 0;
    let closestDist = Infinity;

    for (let i = 0; i <= samples; i++) {
      const s = (i / samples) * corridor.totalLength;
      const progress = s / corridor.totalLength;
      const pos = interpolatePolyline(corridor.points, progress);

      const dx = pos[0] - center[0];
      const dz = pos[2] - center[2];
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < closestDist) {
        closestDist = dist;
        closestS = s;
      }
    }

    return closestDist < radius * 2 ? closestS : null;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Extended segment type with graph connectivity (from LION data).
 */
interface GraphSegment extends RoadSegment {
  successors?: string[];
  predecessors?: string[];
  isMajor?: boolean;
  streetName?: string;
}

/**
 * Build chains of connected major segments by following successors.
 */
function buildCorridorChains(
  segments: GraphSegment[],
  maxChains: number = 5,
  minLength: number = 500
): GraphSegment[][] {
  const majorSegments = segments.filter((s) => s.isMajor);
  const majorIds = new Set(majorSegments.map((s) => s.id));
  const segmentMap = new Map(segments.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const chains: { segments: GraphSegment[]; length: number }[] = [];

  for (const startSeg of majorSegments) {
    if (visited.has(startSeg.id)) continue;

    const chain: GraphSegment[] = [startSeg];
    visited.add(startSeg.id);
    let totalLength = getPolylineLength(startSeg.points);
    let current = startSeg;

    // Follow successors (only major roads)
    while (current.successors && current.successors.length > 0) {
      const nextIds = current.successors.filter(
        (sid) => majorIds.has(sid) && !visited.has(sid)
      );
      if (nextIds.length === 0) break;

      const nextId = nextIds[0]!;
      const nextSeg = segmentMap.get(nextId) as GraphSegment | undefined;
      if (!nextSeg) break;

      visited.add(nextSeg.id);
      chain.push(nextSeg);
      totalLength += getPolylineLength(nextSeg.points);
      current = nextSeg;

      if (totalLength > 3000) break; // Cap at 3km
    }

    if (totalLength >= minLength) {
      chains.push({ segments: chain, length: totalLength });
    }
  }

  // Sort by length and return top chains
  chains.sort((a, b) => b.length - a.length);
  return chains.slice(0, maxChains).map((c) => c.segments);
}

export function createTestCorridorEngine(segments: RoadSegment[]): CorridorFlowEngine {
  const engine = new CorridorFlowEngine();
  let corridorsAdded = 0;

  console.log('[CorridorFlowEngine] Creating engine with', segments.length, 'segments');

  // Cast to GraphSegment to access extended properties
  const graphSegments = segments as GraphSegment[];

  // Check if this is LION data (has isMajor field)
  const hasGraphData = graphSegments.some((s) => 'isMajor' in s);
  console.log('[CorridorFlowEngine] Has graph data (isMajor):', hasGraphData);

  if (hasGraphData) {
    // Build corridors from connected major segment chains
    const chains = buildCorridorChains(graphSegments, 5, 500);
    console.log(`[CorridorFlowEngine] Built ${chains.length} corridor chains from major segments`);

    chains.forEach((chain, i) => {
      const totalLength = chain.reduce((sum, s) => sum + getPolylineLength(s.points), 0);
      const streetName = chain[0]?.streetName || `Corridor ${i}`;
      console.log(
        `[CorridorFlowEngine] Corridor ${i}: ${streetName} (${chain.length} segments, ${totalLength.toFixed(0)}m)`
      );

      engine.addCorridor(`corridor_${i}`, streetName, chain, {
        lanes: 2,
        targetDensity: 0.12, // 1 vehicle per ~8m = ~3m gap (rush hour dense)
        speed: 8, // ~18 mph
      });
      corridorsAdded++;
    });
  } else {
    // Legacy: Look for specific segment IDs (old road_* format)
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const testIds = ['road_3020', 'road_3339', 'road_4459'];
    for (const id of testIds) {
      const seg = segmentMap.get(id);
      if (seg) {
        const len = getPolylineLength(seg.points);
        console.log(`[CorridorFlowEngine] Found ${id}: ${len.toFixed(0)}m`);
        engine.addCorridor(id, id, [seg], {
          lanes: 3,
          targetDensity: 0.05,
          speed: 8,
        });
        corridorsAdded++;
      }
    }
  }

  // Fallback: If no corridors were added, use longest segments
  if (corridorsAdded === 0 && segments.length > 0) {
    console.log('[CorridorFlowEngine] Fallback: using longest individual segments');

    const sorted = [...segments].sort(
      (a, b) => getPolylineLength(b.points) - getPolylineLength(a.points)
    );

    sorted.slice(0, 3).forEach((seg, i) => {
      const len = getPolylineLength(seg.points);
      console.log(`[CorridorFlowEngine] Fallback ${i}: ${seg.id} (${len.toFixed(0)}m)`);
      engine.addCorridor(`fallback_${i}`, `Fallback ${i}`, [seg], {
        lanes: 2,
        targetDensity: 0.03,
        speed: 6,
      });
    });
  }

  // Add intersection (approximate Canal St)
  engine.addIntersection('canal_crossing', [500, 0, -2500], 80, 0.15);

  engine.initialize();

  const counts = engine.getCounts();
  console.log('[CorridorFlowEngine] Final counts:', counts);

  return engine;
}
