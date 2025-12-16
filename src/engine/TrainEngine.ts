/**
 * TrainEngine - Pure TypeScript simulation logic for subway trains.
 *
 * Computes which trains are active at a given simulation time and their
 * positions along the subway line segments.
 *
 * Per CLAUDE.md §8.3: Engine owns state computation, components only render.
 */
import type { TrainRun, SubwayLine, Point3D } from '../data/types';
import { interpolatePolyline } from '../utils/interpolation';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents an active train at a given simulation time.
 * Contains all data needed for rendering.
 */
export interface ActiveTrain {
  /** Unique train identifier */
  id: string;

  /** Line identifier (e.g., "A", "1") */
  lineId: string;

  /** Current 3D position along the segment */
  position: Point3D;

  /** Progress along segment [0, 1] */
  progress: number;

  /** Direction: +1 or -1 */
  direction: 1 | -1;

  /** Crowding level [0, 1] */
  crowding: number;

  /** Line color for rendering */
  color: string;
}

// =============================================================================
// Engine Class
// =============================================================================

/**
 * TrainEngine computes active trains for a given simulation time.
 *
 * Features:
 * - Filters trains to only those active within [tEnter, tExit)
 * - Computes progress based on time elapsed
 * - Reverses progress for direction=-1 trains
 * - Computes 3D position using polyline interpolation
 *
 * Usage:
 * ```ts
 * const engine = new TrainEngine(trainRuns, subwayLines);
 * const activeTrains = engine.getActiveTrains(simulationTime);
 * // Render activeTrains with InstancedMesh
 * ```
 */
export class TrainEngine {
  private trains: TrainRun[];
  private linesMap: Map<string, SubwayLine>;

  /**
   * Creates a new TrainEngine.
   *
   * @param trains - Array of train run definitions
   * @param lines - Array of subway line definitions
   */
  constructor(trains: TrainRun[], lines: SubwayLine[]) {
    this.trains = trains;
    this.linesMap = new Map(lines.map((line) => [line.id, line]));
  }

  /**
   * Get all active trains at a given simulation time.
   *
   * @param t - Simulation time in [0, 1)
   * @returns Array of ActiveTrain objects for rendering
   */
  getActiveTrains(t: number): ActiveTrain[] {
    const activeTrains: ActiveTrain[] = [];

    for (const train of this.trains) {
      // Check if train is active at this time
      // Active when t >= tEnter AND t < tExit
      if (!this.isTrainActive(train, t)) {
        continue;
      }

      // Get line and segment data
      const line = this.linesMap.get(train.lineId);
      if (!line) {
        // Skip trains with missing line data
        continue;
      }

      const segment = line.segments[train.segmentIndex];
      if (!segment) {
        // Skip trains with invalid segment index
        continue;
      }

      // Compute progress along segment
      const progress = this.computeProgress(train, t);

      // Compute 3D position
      const position = interpolatePolyline(segment.points, progress);

      activeTrains.push({
        id: train.id,
        lineId: train.lineId,
        position,
        progress,
        direction: train.direction,
        crowding: train.crowding,
        color: line.color,
      });
    }

    return activeTrains;
  }

  /**
   * Check if a train is active at the given time.
   *
   * Train is active when: tEnter <= t < tExit
   * (inclusive entry, exclusive exit)
   */
  private isTrainActive(train: TrainRun, t: number): boolean {
    return t >= train.tEnter && t < train.tExit;
  }

  /**
   * Compute progress along segment for a train at given time.
   *
   * For direction=+1: progress = (t - tEnter) / (tExit - tEnter)
   * For direction=-1: progress = 1 - rawProgress (moves backward)
   *
   * @returns Progress value in [0, 1]
   */
  private computeProgress(train: TrainRun, t: number): number {
    const duration = train.tExit - train.tEnter;

    // Avoid division by zero
    if (duration <= 0) {
      return 0;
    }

    // Raw progress based on elapsed time
    const rawProgress = (t - train.tEnter) / duration;

    // Clamp to [0, 1] for safety
    const clampedProgress = Math.max(0, Math.min(1, rawProgress));

    // Reverse for backward direction
    if (train.direction === -1) {
      return 1 - clampedProgress;
    }

    return clampedProgress;
  }
}
