/**
 * Polyline Interpolation Utilities
 *
 * Provides functions for:
 * - Calculating total polyline length
 * - Interpolating positions along polylines given progress [0, 1]
 *
 * Used by TrainEngine and TrafficEngine to compute positions along routes.
 */

/** 3D point as [x, y, z] tuple */
export type Point3D = [number, number, number];

/**
 * Calculate the total length of a polyline.
 *
 * @param points - Array of 3D points defining the polyline
 * @returns Total length in the same units as the input coordinates
 *
 * @example
 * getPolylineLength([[0, 0, 0], [100, 0, 0]])  // 100
 * getPolylineLength([[0, 0, 0], [3, 4, 0]])   // 5 (3-4-5 triangle)
 */
export function getPolylineLength(points: Point3D[]): number {
  if (points.length < 2) {
    return 0;
  }

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1, z1] = points[i - 1]!;
    const [x2, y2, z2] = points[i]!;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;

    length += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  return length;
}

/**
 * Calculate the distance between two 3D points.
 */
function distance(p1: Point3D, p2: Point3D): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Linearly interpolate between two points.
 */
function lerp(p1: Point3D, p2: Point3D, t: number): Point3D {
  return [
    p1[0] + (p2[0] - p1[0]) * t,
    p1[1] + (p2[1] - p1[1]) * t,
    p1[2] + (p2[2] - p1[2]) * t,
  ];
}

/**
 * Interpolate a position along a polyline given a progress value.
 *
 * @param points - Array of 3D points defining the polyline
 * @param progress - Value in [0, 1] representing position along the polyline
 *                   (0 = start, 1 = end, 0.5 = halfway along total length)
 * @returns The interpolated 3D position
 *
 * Progress is clamped to [0, 1] - values outside this range return the
 * first or last point respectively.
 *
 * @example
 * const line = [[0, 0, 0], [100, 0, 0], [100, 0, 100]];
 * interpolatePolyline(line, 0)    // [0, 0, 0]
 * interpolatePolyline(line, 0.5)  // [100, 0, 0] (corner - halfway along 200m)
 * interpolatePolyline(line, 1)    // [100, 0, 100]
 */
export function interpolatePolyline(points: Point3D[], progress: number): Point3D {
  // Handle edge cases
  if (points.length === 0) {
    return [0, 0, 0];
  }

  if (points.length === 1) {
    return [...points[0]!] as Point3D;
  }

  // Clamp progress to [0, 1]
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Handle exact boundaries
  if (clampedProgress === 0) {
    return [...points[0]!] as Point3D;
  }

  if (clampedProgress === 1) {
    return [...points[points.length - 1]!] as Point3D;
  }

  // Calculate total length and target distance
  const totalLength = getPolylineLength(points);

  // Handle zero-length polyline (all points coincident)
  if (totalLength === 0) {
    return [...points[0]!] as Point3D;
  }

  const targetDistance = clampedProgress * totalLength;

  // Walk along the polyline to find the segment containing the target
  let accumulatedLength = 0;

  for (let i = 1; i < points.length; i++) {
    const segmentLength = distance(points[i - 1]!, points[i]!);

    if (accumulatedLength + segmentLength >= targetDistance) {
      // Target is within this segment
      const remainingDistance = targetDistance - accumulatedLength;

      // Handle zero-length segments (duplicate points)
      if (segmentLength === 0) {
        return [...points[i]!] as Point3D;
      }

      const segmentProgress = remainingDistance / segmentLength;
      return lerp(points[i - 1]!, points[i]!, segmentProgress);
    }

    accumulatedLength += segmentLength;
  }

  // Should not reach here, but return last point as fallback
  return [...points[points.length - 1]!] as Point3D;
}

/**
 * Get the heading angle (rotation around Y axis) at a point along a polyline.
 *
 * @param points - Array of 3D points defining the polyline
 * @param progress - Value in [0, 1] representing position along the polyline
 * @returns Heading angle in radians (0 = +Z direction, positive = clockwise when viewed from above)
 *
 * The heading is calculated from the direction vector of the segment
 * containing the given progress point.
 *
 * @example
 * const line = [[0, 0, 0], [100, 0, 0]]; // Points along +X axis
 * getPolylineHeading(line, 0.5) // Returns -π/2 (facing +X = -90° from +Z)
 */
export function getPolylineHeading(points: Point3D[], progress: number): number {
  // Handle edge cases
  if (points.length < 2) {
    return 0;
  }

  // Clamp progress to [0, 1]
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // For progress at boundaries, use the first/last segment direction
  if (clampedProgress === 0 || clampedProgress === 1) {
    // Use first segment for start, last segment for end
    const segmentIndex = clampedProgress === 0 ? 0 : points.length - 2;
    const p1 = points[segmentIndex]!;
    const p2 = points[segmentIndex + 1]!;

    const dx = p2[0] - p1[0];
    const dz = p2[2] - p1[2];

    // atan2(dx, dz) gives heading where 0 = +Z direction
    return Math.atan2(dx, dz);
  }

  // Calculate total length and target distance
  const totalLength = getPolylineLength(points);

  // Handle zero-length polyline
  if (totalLength === 0) {
    return 0;
  }

  const targetDistance = clampedProgress * totalLength;

  // Walk along the polyline to find the segment containing the target
  let accumulatedLength = 0;

  for (let i = 1; i < points.length; i++) {
    const segmentLength = distance(points[i - 1]!, points[i]!);

    if (accumulatedLength + segmentLength >= targetDistance) {
      // Target is within this segment - compute heading from segment direction
      const p1 = points[i - 1]!;
      const p2 = points[i]!;

      const dx = p2[0] - p1[0];
      const dz = p2[2] - p1[2];

      return Math.atan2(dx, dz);
    }

    accumulatedLength += segmentLength;
  }

  // Fallback: use last segment direction
  const p1 = points[points.length - 2]!;
  const p2 = points[points.length - 1]!;

  const dx = p2[0] - p1[0];
  const dz = p2[2] - p1[2];

  return Math.atan2(dx, dz);
}
