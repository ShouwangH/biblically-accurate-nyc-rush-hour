/**
 * Ground Plane Bounds Constants
 *
 * Defines the geographic and local coordinate bounds for the ground plane.
 * The ground plane covers lower Manhattan from Battery Park to ~34th Street.
 *
 * These bounds are used by:
 * - GroundPlane component for mesh sizing and positioning
 * - GIS export pipeline for raster bounds alignment
 *
 * Coordinate systems:
 * - WGS84: standard lat/lng for GIS tools
 * - Local: meters from Battery Park origin (40.7033, -74.017)
 *   - X-axis: positive = east
 *   - Z-axis: negative = north, positive = south
 */
import type { GroundBounds } from '../data/types';

/**
 * Ground bounds for lower Manhattan visualization.
 *
 * WGS84 bounds with small buffer beyond data extent:
 * - South: 40.698 (south of Battery Park)
 * - North: 40.758 (past 34th Street)
 * - West: -74.025 (beyond westernmost road)
 * - East: -73.965 (beyond easternmost station)
 *
 * Local bounds (rounded for clean geometry):
 * - Computed from WGS84 then rounded to provide ~25m buffer
 * - Total extent: ~5100m (E-W) × ~6700m (N-S)
 */
export const GROUND_BOUNDS: GroundBounds = {
  wgs84: {
    west: -74.025,
    east: -73.965,
    south: 40.698,
    north: 40.758,
  },
  local: {
    // Rounded from computed values: -675 → -700, 4388 → 4400
    xMin: -700,
    xMax: 4400,
    // Rounded from computed values: -6089 → -6100, 590 → 600
    zMin: -6100, // northern edge (more negative = further north)
    zMax: 600, // southern edge
  },
};

/**
 * Computed dimensions of the ground plane in meters.
 */
export const GROUND_WIDTH = GROUND_BOUNDS.local.xMax - GROUND_BOUNDS.local.xMin; // 5100m
export const GROUND_DEPTH = GROUND_BOUNDS.local.zMax - GROUND_BOUNDS.local.zMin; // 6700m

/**
 * Center point of the ground plane in local coordinates.
 */
export const GROUND_CENTER_X =
  (GROUND_BOUNDS.local.xMin + GROUND_BOUNDS.local.xMax) / 2; // 1850m
export const GROUND_CENTER_Z =
  (GROUND_BOUNDS.local.zMin + GROUND_BOUNDS.local.zMax) / 2; // -2750m

/**
 * Y position for the ground plane.
 * Slightly below y=0 to avoid z-fighting with roads at street level.
 */
export const GROUND_Y_POSITION = -0.5;
