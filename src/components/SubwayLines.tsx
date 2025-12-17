/**
 * SubwayLines Component
 *
 * Renders subway lines as TubeGeometry from polyline segments.
 * Static rendering - no animation per frame.
 *
 * Per CLAUDE.md §8.3: Component only renders; data from context.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useData } from '../hooks/useDataLoader';
import type { SubwayLine, SubwayLineSegment, Point3D } from '../data/types';

// =============================================================================
// Constants
// =============================================================================

/** Tube radius for subway lines (meters) */
export const TUBE_RADIUS = 3;

/** Number of segments along the tube length */
export const TUBE_SEGMENTS = 64;

/** Number of radial segments around the tube */
const RADIAL_SEGMENTS = 8;

/** Emissive intensity for the glow effect */
const EMISSIVE_INTENSITY = 0.4;

/** Ghost layer opacity (visible through buildings) */
const GHOST_OPACITY = 0.4;

/** Ghost layer emissive intensity (more intense for visibility) */
const GHOST_EMISSIVE_INTENSITY = 0.6;

/** Render order for ghost layer (renders after buildings) */
const GHOST_RENDER_ORDER = 10;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Converts a polyline of Point3D to a THREE.CatmullRomCurve3.
 */
function createCurveFromPoints(points: Point3D[]): THREE.CatmullRomCurve3 {
  const vectors = points.map(
    (p) => new THREE.Vector3(p[0], p[1], p[2])
  );
  return new THREE.CatmullRomCurve3(vectors);
}

/**
 * Creates TubeGeometry for a single segment.
 */
function createTubeGeometry(segment: SubwayLineSegment): THREE.TubeGeometry {
  const curve = createCurveFromPoints(segment.points);
  return new THREE.TubeGeometry(
    curve,
    TUBE_SEGMENTS,
    TUBE_RADIUS,
    RADIAL_SEGMENTS,
    false // not closed
  );
}

/**
 * Creates material for a subway line (solid layer).
 */
function createLineMaterial(
  color: string,
  glowColor: string
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color,
    emissive: glowColor,
    emissiveIntensity: EMISSIVE_INTENSITY,
    roughness: 0.4,
    metalness: 0.2,
  });
}

/**
 * Creates ghost material for a subway line (always visible through buildings).
 * Uses depthTest: false to render on top of occluding geometry.
 */
function createGhostMaterial(
  color: string,
  glowColor: string
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color,
    emissive: glowColor,
    emissiveIntensity: GHOST_EMISSIVE_INTENSITY,
    roughness: 0.4,
    metalness: 0.2,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthTest: false,
    depthWrite: false,
  });
}

// =============================================================================
// Sub-components
// =============================================================================

interface LineSegmentMeshProps {
  segment: SubwayLineSegment;
  solidMaterial: THREE.MeshStandardMaterial;
  ghostMaterial: THREE.MeshStandardMaterial;
}

/**
 * Renders a single line segment as a tube mesh with both solid and ghost layers.
 * - Solid layer: normal depth-tested rendering
 * - Ghost layer: always visible (depthTest: false) with transparency
 */
function LineSegmentMesh({ segment, solidMaterial, ghostMaterial }: LineSegmentMeshProps) {
  const geometry = useMemo(
    () => createTubeGeometry(segment),
    [segment]
  );

  return (
    <>
      {/* Solid layer - normal rendering with depth test */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <mesh geometry={geometry} material={solidMaterial} />
      {/* Ghost layer - always visible through buildings */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <mesh geometry={geometry} material={ghostMaterial} renderOrder={GHOST_RENDER_ORDER} />
    </>
  );
}

interface SubwayLineMeshesProps {
  line: SubwayLine;
}

/**
 * Renders all segments for a single subway line with solid and ghost layers.
 */
function SubwayLineMeshes({ line }: SubwayLineMeshesProps) {
  const solidMaterial = useMemo(
    () => createLineMaterial(line.color, line.glowColor),
    [line.color, line.glowColor]
  );

  const ghostMaterial = useMemo(
    () => createGhostMaterial(line.color, line.glowColor),
    [line.color, line.glowColor]
  );

  return (
    <group name={`line-${line.id}`}>
      {line.segments.map((segment, index) => (
        <LineSegmentMesh
          key={`${line.id}-seg-${index}`}
          segment={segment}
          solidMaterial={solidMaterial}
          ghostMaterial={ghostMaterial}
        />
      ))}
    </group>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * SubwayLines renders all subway lines as tube geometries.
 *
 * Features:
 * - TubeGeometry from polyline points
 * - Line color with emissive glow
 * - Static rendering (no per-frame updates)
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <SubwayLines />
 * </Scene>
 * ```
 */
export function SubwayLines() {
  // Get subway lines from data context
  const { data } = useData();

  // Don't render if no data
  if (!data?.subwayLines?.lines) {
    return null;
  }

  const { lines } = data.subwayLines;

  return (
    <group name="subway-lines">
      {lines.map((line) => (
        <SubwayLineMeshes key={line.id} line={line} />
      ))}
    </group>
  );
}
