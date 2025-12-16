/**
 * RoadSegments Component
 *
 * Renders road segments as thin lines for visual reference.
 * Roads are rendered with subtle styling so traffic stands out.
 *
 * Per CLAUDE.md §8.3: Component only renders; data from context.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useData } from '../hooks/useDataLoader';

// =============================================================================
// Constants
// =============================================================================

/** Road line styling */
const ROAD_STYLE = {
  /** Line color - subtle gray */
  color: '#444444',
  /** Line opacity */
  opacity: 0.3,
  /** Y offset to render slightly above ground */
  yOffset: 0.5,
};

// =============================================================================
// Component
// =============================================================================

/**
 * RoadSegments renders all road segments as thin lines.
 *
 * Features:
 * - Uses BufferGeometry for efficient line rendering
 * - Subtle styling so traffic vehicles stand out
 * - Static geometry (no per-frame updates needed)
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <RoadSegments />
 * </Scene>
 * ```
 */
export function RoadSegments() {
  const { data } = useData();

  // Build line geometry from all road segments
  const geometry = useMemo(() => {
    if (!data?.roadSegments?.segments) return null;

    const positions: number[] = [];

    for (const segment of data.roadSegments.segments) {
      const points = segment.points;

      // Add line segments between consecutive points
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i]!;
        const p2 = points[i + 1]!;

        // Start point
        positions.push(p1[0], p1[1] + ROAD_STYLE.yOffset, p1[2]);
        // End point
        positions.push(p2[0], p2[1] + ROAD_STYLE.yOffset, p2[2]);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );

    return geo;
  }, [data]);

  // Create material once
  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: ROAD_STYLE.color,
        transparent: true,
        opacity: ROAD_STYLE.opacity,
      }),
    []
  );

  // Don't render if no data
  if (!geometry) {
    return null;
  }

  return <lineSegments args={[geometry, material]} />;
}
