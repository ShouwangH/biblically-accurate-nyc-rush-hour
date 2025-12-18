/**
 * Shared Materials Pool
 *
 * HARD CAP: 5-15 materials for entire scene.
 * All geometry shares from this pool.
 *
 * Per LOD_TILING_PLAN.md:
 * - Material discipline prevents shader switching overhead
 * - Shader switches hurt more than draw calls
 * - Per-instance color variation via setColorAt (still one material!)
 *
 * Usage:
 * - Import MATERIALS and apply with <primitive object={MATERIALS.X} attach="material" />
 * - Never create new materials per-component
 */

import * as THREE from 'three';

/**
 * Shared materials for the entire scene.
 * These are THREE.js materials, not React components.
 */
export const MATERIALS = {
  // ---------------------------------------------------------------------------
  // Buildings
  // ---------------------------------------------------------------------------

  /**
   * LOD0 buildings (full detail meshes).
   * MeshStandardMaterial for realistic lighting on detailed geometry.
   */
  BUILDING_LOD0: new THREE.MeshStandardMaterial({
    color: '#445566',
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true,
  }),

  /**
   * LOD1 buildings (instanced boxes at medium distance).
   * MeshLambertMaterial is cheaper than Standard, good for flat boxes.
   */
  BUILDING_LOD1: new THREE.MeshLambertMaterial({
    color: '#334455',
  }),

  // ---------------------------------------------------------------------------
  // Ground & Infrastructure
  // ---------------------------------------------------------------------------

  /**
   * Ground plane material.
   * MeshBasicMaterial (no lighting) for consistent dark surface.
   */
  GROUND: new THREE.MeshBasicMaterial({
    color: '#1a1a2e',
  }),

  /**
   * Road lines material.
   * LineBasicMaterial for road network visualization.
   */
  ROAD: new THREE.LineBasicMaterial({
    color: '#333344',
  }),

  /**
   * Subway line material (for line-based rendering).
   * Replaces expensive TubeGeometry with cheap lines.
   */
  SUBWAY_LINE: new THREE.LineBasicMaterial({
    color: '#ffffff',
    // Note: linewidth only works in WebGL1 and some browsers
    // For thick lines, use Line2 from three/examples
  }),

  // ---------------------------------------------------------------------------
  // Station Pillars
  // ---------------------------------------------------------------------------

  /**
   * Station pillar/beam material.
   * MeshBasicMaterial with additive blending for glow effect.
   */
  PILLAR: new THREE.MeshBasicMaterial({
    color: '#4488FF',
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),

  // ---------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------

  /**
   * Brooklyn district outline material.
   */
  DISTRICT_OUTLINE: new THREE.LineBasicMaterial({
    color: '#ff6b35',
  }),

  /**
   * Brooklyn district fill material.
   * Semi-transparent for overlay effect.
   */
  DISTRICT_FILL: new THREE.MeshBasicMaterial({
    color: '#ff6b35',
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
} as const;

// Freeze to prevent accidental modification
Object.freeze(MATERIALS);

/**
 * Building color palette for LOD1 instanced variation.
 * Per-instance color via setColorAt() keeps single material.
 */
export const BUILDING_PALETTE = [
  new THREE.Color('#334455'),
  new THREE.Color('#3a4a5a'),
  new THREE.Color('#2e3e4e'),
  new THREE.Color('#404858'),
  new THREE.Color('#363f4f'),
] as const;

/**
 * Hash a string to a color palette index.
 * Provides deterministic, stable color assignment.
 */
export function hashToColorIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash) % BUILDING_PALETTE.length;
}

/**
 * Subway line colors by line ID.
 * Standard MTA colors for NYC subway.
 */
export const SUBWAY_COLORS: Record<string, string> = {
  // IRT lines (numbered)
  '1': '#EE352E',
  '2': '#EE352E',
  '3': '#EE352E',
  '4': '#00933C',
  '5': '#00933C',
  '6': '#00933C',
  '7': '#B933AD',

  // IND lines (letters A-G)
  A: '#0039A6',
  C: '#0039A6',
  E: '#0039A6',
  B: '#FF6319',
  D: '#FF6319',
  F: '#FF6319',
  M: '#FF6319',
  G: '#6CBE45',

  // BMT lines (letters J-Z)
  J: '#996633',
  Z: '#996633',
  L: '#A7A9AC',
  N: '#FCCC0A',
  Q: '#FCCC0A',
  R: '#FCCC0A',
  W: '#FCCC0A',
  S: '#808183',
};

/**
 * Get subway line color, falling back to white for unknown lines.
 */
export function getSubwayColor(lineId: string): string {
  return SUBWAY_COLORS[lineId] ?? '#ffffff';
}
