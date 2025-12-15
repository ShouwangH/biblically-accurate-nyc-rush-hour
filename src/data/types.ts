/**
 * Data Contract Types for NYC Rush Hour Visualization
 *
 * These interfaces define the shape of all JSON data files.
 * See docs/nyc-rush-hour-implementation-plan.md for full documentation.
 */

// =============================================================================
// Common Types
// =============================================================================

/** 3D coordinate tuple [x, y, z] in local coordinate system (meters) */
export type Point3D = [number, number, number];

// =============================================================================
// Stations (stations.json)
// =============================================================================

/**
 * A single subway station with time-varying intensity data.
 */
export interface StationData {
  /** MTA complex ID, e.g., "A32" */
  id: string;

  /** Station name, e.g., "Fulton St" */
  name: string;

  /** Subway lines serving this station, e.g., ["A", "C", "J", "Z", "2", "3"] */
  lines: string[];

  /** Underground position [x, y, z] where y is negative (below street) */
  position: Point3D;

  /** Surface position [x, 0, z] where beam anchors (y=0 for street level) */
  surfacePosition: Point3D;

  /**
   * Normalized intensity values for each time slice.
   * Length must equal meta.timeSlices (60).
   * Values in [minIntensityFloor, 1.0].
   */
  intensities: number[];
}

/**
 * Metadata for stations file.
 */
export interface StationsMeta {
  /** Number of time slices (60 = one per simulated minute) */
  timeSlices: number;

  /** Time range as [start, end] where 0=8:00am, 1=9:00am */
  timeRange: [number, number];

  /** Normalization strategy (always "global" for v1) */
  normalization: 'global';

  /** Maximum entries observed in any station at any slice (for reference) */
  maxEntriesPerSlice: number;

  /** Minimum intensity floor (stations never go below this) */
  minIntensityFloor: number;
}

/**
 * Root structure for stations.json
 */
export interface StationsFile {
  meta: StationsMeta;
  stations: StationData[];
}

// =============================================================================
// Subway Lines (subway_lines.json)
// =============================================================================

/**
 * A segment of a subway line (lines may have multiple segments at forks).
 */
export interface SubwayLineSegment {
  /** Polyline vertices as [x, y, z] tuples (y is negative, underground) */
  points: Point3D[];
}

/**
 * A single subway line definition.
 */
export interface SubwayLine {
  /** Line identifier, e.g., "A", "1", "L" */
  id: string;

  /** Full line name, e.g., "A Eighth Avenue Express" */
  name: string;

  /** Base color as hex, e.g., "#0039A6" */
  color: string;

  /** Emissive/glow color as hex (brighter than base) */
  glowColor: string;

  /** Line segments (multiple if line forks within extent) */
  segments: SubwayLineSegment[];

  /** Y-offset below street level, e.g., -18 */
  depth: number;
}

/**
 * Root structure for subway_lines.json
 */
export interface SubwayLinesFile {
  lines: SubwayLine[];
}

// =============================================================================
// Train Schedules (train_schedules.json)
// =============================================================================

/**
 * A single train run within the simulation window.
 * Trains are defined per-segment; multi-segment journeys are multiple TrainRuns.
 */
export interface TrainRun {
  /** Unique identifier, e.g., "A-north-001-seg0" */
  id: string;

  /** References SubwayLine.id */
  lineId: string;

  /** Index into SubwayLine.segments[] */
  segmentIndex: number;

  /** Direction: +1 = increasing progress along segment, -1 = decreasing */
  direction: 1 | -1;

  /** simulationTime [0,1) when train enters this segment */
  tEnter: number;

  /** simulationTime [0,1] when train exits this segment */
  tExit: number;

  /** Average crowding level 0-1 (affects train brightness/color) */
  crowding: number;
}

/**
 * Metadata for train schedules file.
 */
export interface TrainSchedulesMeta {
  /** Interpolation mode for position along segment */
  interpolationMode: 'linear';
}

/**
 * Root structure for train_schedules.json
 */
export interface TrainSchedulesFile {
  meta: TrainSchedulesMeta;
  trains: TrainRun[];
}

// =============================================================================
// Road Segments (road_segments.json)
// =============================================================================

/**
 * Type of road segment.
 */
export type RoadType = 'avenue' | 'street' | 'highway';

/**
 * A single road segment with congestion and spawn data.
 */
export interface RoadSegment {
  /** Unique segment identifier, e.g., "broadway_001" */
  id: string;

  /** Road type classification */
  type: RoadType;

  /** Polyline vertices at street level [x, 0, z] */
  points: Point3D[];

  /** Average speed during 8-9am in mph */
  avgSpeedMph: number;

  /** Free-flow (uncongested) speed in mph */
  freeFlowSpeedMph: number;

  /** Congestion factor = avgSpeed / freeFlowSpeed, in (0, 1] */
  congestionFactor: number;

  /**
   * Vehicles to spawn when entering each time slice.
   * Length must equal meta.timeSlices (60).
   * See implementation plan "Spawn Rate Model" section.
   */
  spawnRates: number[];
}

/**
 * Vehicle types tracked in the simulation.
 */
export type VehicleType = 'taxi' | 'fhv';

/**
 * Metadata for road segments file.
 */
export interface RoadSegmentsMeta {
  /** Number of time slices (60) */
  timeSlices: number;

  /** Vehicle types included in spawn rates */
  vehicleTypes: VehicleType[];
}

/**
 * Root structure for road_segments.json
 */
export interface RoadSegmentsFile {
  meta: RoadSegmentsMeta;
  segments: RoadSegment[];
}

// =============================================================================
// Aggregated Data (for DataProvider context)
// =============================================================================

/**
 * All simulation data loaded by DataProvider.
 * Buildings are loaded separately via useGLTF.
 */
export interface SimulationData {
  stations: StationsFile;
  subwayLines: SubwayLinesFile;
  trainSchedules: TrainSchedulesFile;
  roadSegments: RoadSegmentsFile;
}
