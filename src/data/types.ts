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
// Trips (trips.json) - Trip-based train model
// =============================================================================

/**
 * A stop along a trip with arrival time and position.
 * Used by TripEngine to interpolate train positions between stations.
 */
export interface TripStop {
  /** GTFS stop_id, e.g., "137N" */
  stopId: string;

  /** Human-readable station name */
  stationName: string;

  /** Simulation time [0, 1) when train arrives at this stop */
  arrivalTime: number;

  /** Pre-computed position in local coordinates */
  position: Point3D;

  /** Distance from trip start along the polyline (meters) */
  distanceAlongRoute: number;
}

/**
 * A complete train trip from GTFS data.
 * Unlike TrainRun (segment-based), Trip represents a full journey
 * with station stops and continuous polyline geometry.
 */
export interface Trip {
  /** GTFS trip_id */
  id: string;

  /** Line identifier, e.g., "1", "A" */
  lineId: string;

  /** Direction: +1 = northbound, -1 = southbound */
  direction: 1 | -1;

  /** Line color for rendering */
  color: string;

  /** Ordered stops with arrival times (clipped to viewport) */
  stops: TripStop[];

  /** Full route geometry from GTFS shapes (clipped to viewport) */
  polyline: Point3D[];

  /** Total length of polyline in meters */
  totalLength: number;

  /** Simulation time [0, 1) when trip enters viewport (first stop) */
  tEnter: number;

  /** Simulation time [0, 1) when trip exits viewport (last stop) */
  tExit: number;
}

/**
 * Metadata for trips file.
 */
export interface TripsMeta {
  /** Data source identifier */
  source: string;

  /** ISO timestamp when file was generated */
  generated: string;

  /** Time window as "HH:MM-HH:MM" */
  timeWindow: string;

  /** Viewport bounds used for clipping */
  viewport: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

/**
 * Root structure for trips.json
 */
export interface TripsFile {
  meta: TripsMeta;
  trips: Trip[];
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
// Road Graph (road_nodes.json, road_segments_graph.json)
// =============================================================================

/**
 * A node in the road network graph.
 * Nodes represent intersections or endpoints where segments connect.
 * Created by clustering nearby segment endpoints.
 */
export interface RoadNode {
  /** Unique node identifier */
  id: string;

  /** Position [x, z] in local coordinates (y is always 0) */
  position: [number, number];

  /** IDs of segments that START at this node */
  outgoing: string[];

  /** IDs of segments that END at this node */
  incoming: string[];

  /** True if node is at map boundary or major unmodeled intersection */
  isBoundary: boolean;
}

/**
 * Metadata for road nodes file.
 */
export interface RoadNodesMeta {
  /** Total number of nodes */
  nodeCount: number;

  /** Clustering radius used to snap endpoints (meters) */
  snapRadius: number;
}

/**
 * Root structure for road_nodes.json
 */
export interface RoadNodesFile {
  meta: RoadNodesMeta;
  nodes: RoadNode[];
}

/**
 * Road segment with graph connectivity and routing metadata.
 * Extends base RoadSegment with adjacency information for multi-segment trips.
 */
export interface GraphRoadSegment extends RoadSegment {
  /**
   * Speed ratio = avgSpeedMph / freeFlowSpeedMph.
   * Range: (0, 1]. Higher = faster = less congested.
   * Replaces ambiguous congestionFactor for clarity.
   */
  speedRatio: number;

  /** Pre-computed polyline length in meters */
  lengthMeters: number;

  /** Node ID at START of segment (from snapped node set) */
  startNodeId: string;

  /** Node ID at END of segment (from snapped node set) */
  endNodeId: string;

  /** Heading in degrees [0, 360) at segment START */
  startHeadingDeg: number;

  /** Heading in degrees [0, 360) at segment END */
  endHeadingDeg: number;

  /** Major arterial (Broadway, avenues, FDR) vs local street */
  isMajor: boolean;

  /** Entry point where vehicles can spawn (boundary or no predecessors) */
  isEntry: boolean;

  /** IDs of segments reachable from END of this segment (forward traversal) */
  successors: string[];

  /** IDs of segments that lead INTO this segment (inverse of successors) */
  predecessors: string[];
}

/**
 * Metadata for graph-augmented road segments file.
 */
export interface GraphRoadSegmentsMeta extends RoadSegmentsMeta {
  /** Total segments classified as major arterials */
  majorSegmentCount: number;

  /** Total entry points (spawn locations) */
  entryPointCount: number;

  /** Sum of all successor links (for validation) */
  totalSuccessorLinks: number;

  /** Hash of the graph structure for cache invalidation */
  graphVersion: string;
}

/**
 * Root structure for road_segments_graph.json (augmented with connectivity)
 */
export interface GraphRoadSegmentsFile {
  meta: GraphRoadSegmentsMeta;
  segments: GraphRoadSegment[];
}

// =============================================================================
// Route Cache (route_cache.json)
// =============================================================================

/**
 * A pre-computed route template for vehicle trips.
 * Vehicles follow these templates instead of computing routes at runtime.
 */
export interface RouteTemplate {
  /** Entry segment where route begins */
  entrySegmentId: string;

  /** Ordered sequence of segment IDs to traverse */
  segmentSequence: string[];

  /** Total route length in meters */
  totalLengthMeters: number;

  /** Cumulative distances at each segment boundary [0, seg0.len, seg0+seg1, ...] */
  cumulativeDistances: number[];
}

/**
 * Metadata for route cache file.
 */
export interface RouteCacheMeta {
  /** ISO timestamp when cache was generated */
  generatedAt: string;

  /** Number of routes generated per entry segment */
  routesPerEntry: number;

  /** Total routes in cache */
  totalRoutes: number;

  /** Hash of road_segments_graph.json for cache invalidation */
  graphVersion: string;
}

/**
 * Root structure for route_cache.json
 */
export interface RouteCacheFile {
  meta: RouteCacheMeta;

  /** Map from entry segment ID to array of route templates */
  routes: Record<string, RouteTemplate[]>;
}

// =============================================================================
// Ground Layer (ground plane bounds)
// =============================================================================

/**
 * Geographic bounds in WGS84 coordinates.
 */
export interface WGS84Bounds {
  /** Western edge longitude */
  west: number;
  /** Eastern edge longitude */
  east: number;
  /** Southern edge latitude */
  south: number;
  /** Northern edge latitude */
  north: number;
}

/**
 * Bounds in local coordinate system (meters from origin).
 * X-axis: positive = east
 * Z-axis: negative = north, positive = south
 */
export interface LocalBounds {
  /** Minimum X (western edge) */
  xMin: number;
  /** Maximum X (eastern edge) */
  xMax: number;
  /** Minimum Z (northern edge, more negative = further north) */
  zMin: number;
  /** Maximum Z (southern edge) */
  zMax: number;
}

/**
 * Complete ground bounds definition with both coordinate systems.
 * Used by GroundPlane component to position and size the ground mesh.
 */
export interface GroundBounds {
  /** Bounds in WGS84 (for reference/GIS alignment) */
  wgs84: WGS84Bounds;
  /** Bounds in local coordinates (for 3D rendering) */
  local: LocalBounds;
}

// =============================================================================
// Graph Road Segments (for trip-based traffic, feature flag: USE_TRIP_TRAFFIC)
// =============================================================================

/**
 * Road segment with graph connectivity for trip-based traffic routing.
 * Adds node references and adjacency lists for multi-segment vehicle trips.
 */
export interface GraphRoadSegment extends Omit<RoadSegment, 'congestionFactor'> {
  /** Node ID at START of segment */
  startNodeId?: string;

  /** Node ID at END of segment */
  endNodeId?: string;

  /** Speed ratio = avgSpeedMph / freeFlowSpeedMph (renamed from congestionFactor) */
  speedRatio: number;

  /** Pre-computed polyline length in meters */
  lengthMeters: number;

  /** Heading in degrees [0, 360) at segment START */
  startHeadingDeg: number;

  /** Heading in degrees [0, 360) at segment END */
  endHeadingDeg: number;

  /** Major arterial (Broadway, avenues, FDR) vs local street */
  isMajor: boolean;

  /** Entry point where vehicles can spawn */
  isEntry: boolean;

  /** IDs of segments reachable from END of this segment */
  successors: string[];

  /** IDs of segments that lead INTO this segment (inverse of successors) */
  predecessors: string[];

  /** Original node IDs from LION data */
  nodeIdFrom?: string;
  nodeIdTo?: string;
}

/**
 * Road network node at intersection.
 */
export interface RoadNode {
  /** Unique node identifier */
  id: string;

  /** Position as [x, z] (y is always 0) */
  position: [number, number];

  /** Segments that START at this node */
  outgoing: string[];

  /** Segments that END at this node */
  incoming: string[];

  /** True if this is a map boundary or major unmodeled intersection */
  isBoundary?: boolean;
}

/**
 * Metadata for road nodes file.
 */
export interface RoadNodesMeta {
  /** Total number of nodes */
  nodeCount: number;

  /** Snap radius used for clustering (if applicable) */
  snapRadius?: number;
}

/**
 * Root structure for road_nodes.json
 */
export interface RoadNodesFile {
  meta: RoadNodesMeta;
  nodes: RoadNode[];
}

// =============================================================================
// Route Cache (Pre-computed Routes for Pseudo-Trip Model)
// =============================================================================

/**
 * A pre-computed route template for pseudo-trip traffic.
 */
export interface RouteTemplate {
  /** Entry segment where route begins */
  entrySegmentId: string;

  /** Ordered sequence of segment IDs to traverse */
  segmentSequence: string[];

  /** Total route length in meters */
  totalLengthMeters: number;

  /** Pre-computed cumulative distances at each segment boundary */
  cumulativeDistances: number[];
}

/**
 * Metadata for route cache file.
 */
export interface RouteCacheMeta {
  /** ISO timestamp when cache was generated */
  generatedAt: string;

  /** Target routes per entry segment */
  routesPerEntry: number;

  /** Total routes in cache */
  totalRoutes: number;

  /** Hash of road graph for cache invalidation */
  graphVersion: string;

  /** Number of entry segments */
  entryCount: number;

  /** Entries that have routes */
  entriesWithRoutes: number;

  /** Average route length in meters */
  avgRouteLength: number;

  /** Average segments per route */
  avgSegmentsPerRoute: number;

  /** Length buckets used for generation */
  lengthBuckets: number[];
}

/**
 * Root structure for route_cache.json
 */
export interface RouteCacheFile {
  meta: RouteCacheMeta;

  /** Map from entrySegmentId to array of route templates */
  routes: Record<string, RouteTemplate[]>;
}

// =============================================================================
// Aggregated Data (for DataProvider context)
// =============================================================================

/**
 * All simulation data loaded by DataProvider.
 * Buildings are loaded separately via useGLTF.
 */
// =============================================================================
// Roadbeds (roadbeds.json)
// =============================================================================

/** A roadbed polygon */
export interface Roadbed {
  /** Unique identifier */
  id: string;
  /** Polygon points as [x, z] tuples (local coordinates) */
  points: [number, number][];
}

/** Metadata for roadbeds file */
export interface RoadbedsMeta {
  source: string;
  url: string;
  count: number;
}

/** Root structure for roadbeds.json */
export interface RoadbedsFile {
  meta: RoadbedsMeta;
  roadbeds: Roadbed[];
}

// =============================================================================
// Simulation Data (combined)
// =============================================================================

export interface SimulationData {
  stations: StationsFile;
  subwayLines: SubwayLinesFile;
  trainSchedules: TrainSchedulesFile;
  roadSegments: RoadSegmentsFile;
  /** Trip data for trip-based train engine (optional, loaded when USE_TRIP_ENGINE is true) */
  trips?: TripsFile;
  /** Route cache for pseudo-trip traffic (optional) */
  routeCache?: RouteCacheFile;
  /** Roadbed polygons (optional) */
  roadbeds?: RoadbedsFile;
}
