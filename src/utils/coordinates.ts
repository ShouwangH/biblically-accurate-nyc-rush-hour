/**
 * Coordinate Conversion Utilities
 *
 * Converts between WGS84 (lat/lng) and local meter-based coordinates.
 *
 * Local coordinate system:
 * - Origin at Battery Park (40.7033, -74.017)
 * - X-axis: positive = east (meters)
 * - Y-axis: positive = up (elevation in meters)
 * - Z-axis: negative = north, positive = south (meters)
 *
 * This matches the coordinate system used in Three.js where:
 * - X is horizontal
 * - Y is vertical (up)
 * - Z is depth (negative = into screen = north on our map)
 */

/** Origin latitude (Battery Park, NYC) */
export const ORIGIN_LAT = 40.7033;

/** Origin longitude (Battery Park, NYC) */
export const ORIGIN_LNG = -74.017;

/** Meters per degree of latitude (approximately constant) */
const METERS_PER_DEGREE_LAT = 111320;

/** Meters per degree of longitude at our origin latitude */
const METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);

/**
 * Convert WGS84 coordinates to local meter-based coordinates.
 *
 * @param lat - Latitude in degrees
 * @param lng - Longitude in degrees
 * @param elevation - Elevation in meters (default 0)
 * @returns [x, y, z] in meters from origin
 *
 * @example
 * toLocalCoords(40.7033, -74.017, 0)  // [0, 0, 0] - origin
 * toLocalCoords(40.71, -74.017, 0)    // [0, 0, -768] - north of origin
 * toLocalCoords(40.7033, -74.00, 0)   // [1445, 0, 0] - east of origin
 */
export function toLocalCoords(
  lat: number,
  lng: number,
  elevation: number = 0
): [number, number, number] {
  const x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG;
  const z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT; // negative because north = negative z
  const y = elevation;

  return [x, y, z];
}

/**
 * Convert local meter-based coordinates back to WGS84.
 *
 * @param x - X position in meters (positive = east)
 * @param y - Y position in meters (elevation)
 * @param z - Z position in meters (negative = north)
 * @returns [lat, lng, elevation]
 *
 * @example
 * toWGS84(0, 0, 0)        // [40.7033, -74.017, 0] - origin
 * toWGS84(0, 0, -1000)    // [40.712, -74.017, 0] - north of origin
 * toWGS84(1000, 0, 0)     // [40.7033, -74.005, 0] - east of origin
 */
export function toWGS84(
  x: number,
  y: number,
  z: number
): [number, number, number] {
  const lng = x / METERS_PER_DEGREE_LNG + ORIGIN_LNG;
  const lat = -z / METERS_PER_DEGREE_LAT + ORIGIN_LAT;
  const elevation = y;

  return [lat, lng, elevation];
}
