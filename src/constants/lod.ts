/**
 * LOD (Level of Detail) Configuration Constants
 *
 * Defines distance bands for progressive detail rendering:
 * - LOD0: Full detail meshes (closest to camera)
 * - LOD1: Instanced box approximations (medium distance)
 * - LOD2: Flat footprints or nothing (far distance)
 * - CULL: No geometry beyond this radius
 *
 * Per LOD_TILING_PLAN.md:
 * - Tile the world in 512m chunks
 * - Distance cull at 6km max render radius
 * - Material discipline: 5-15 materials max
 * - Fog = cull: Don't render what fog hides
 */

/**
 * LOD radius configuration in meters.
 * Camera-centric distance bands.
 */
export const LOD_CONFIG = {
  // Camera-centric radius bands (meters)
  /** Full detail: actual building meshes */
  RADIUS_LOD0: 1500,
  /** Medium: extruded boxes from footprints */
  RADIUS_LOD1: 3500,
  /** Far: flat footprints or nothing */
  RADIUS_LOD2: 6000,
  /** Hard cull: no geometry beyond this */
  RADIUS_CULL: 6000,

  // Tile configuration
  /** Meters per tile edge */
  TILE_SIZE: 512,

  // Memory budget
  /** Maximum bytes of tile data to keep loaded */
  MAX_BYTES_LOADED: 128 * 1024 * 1024, // 128MB
  /** Maximum concurrent tile load requests */
  MAX_CONCURRENT_LOADS: 6,
  /** LRU cache size (legacy, prefer bytes-based eviction) */
  MAX_TILES_LOADED: 64,

  // Rendering caps
  /** Maximum triangles to render */
  MAX_TRIANGLES: 500_000,
  /** Target draw calls */
  MAX_DRAW_CALLS: 50,
  /** Maximum LOD1 building instances */
  MAX_LOD1_INSTANCES: 5000,
} as const;

/**
 * Fog configuration matching LOD cull distance.
 * Per LOD_TILING_PLAN.md: camera.far should be close to fog.far
 */
export const FOG_CONFIG = {
  /** Distance where fog starts fading */
  NEAR: 4000,
  /** Distance where fog is fully opaque = RADIUS_CULL */
  FAR: 6000,
} as const;

/**
 * Camera configuration aligned with fog/LOD.
 * Wide depth range wrecks z-buffer precision.
 */
export const CAMERA_CONFIG = {
  FOV: 60,
  /** Raised for z-precision */
  NEAR: 5,
  /** FOG_FAR + small margin */
  FAR: 7000,
} as const;

/**
 * Tile radius in tiles for the cull distance.
 * ceil(6000 / 512) = 12 tiles
 */
export const CULL_RADIUS_TILES = Math.ceil(
  LOD_CONFIG.RADIUS_CULL / LOD_CONFIG.TILE_SIZE
);

/**
 * Precomputed disk offsets for tile selection.
 * Sorted by distance for priority loading (nearest first).
 *
 * Grid scan: (2×12+1)² = 625 tiles
 * Disk: ~450 tiles (28% fewer checks)
 */
export interface DiskOffset {
  dx: number;
  dz: number;
  dist: number;
}

function precomputeDiskOffsets(tileRadius: number): DiskOffset[] {
  const offsets: DiskOffset[] = [];

  for (let dx = -tileRadius; dx <= tileRadius; dx++) {
    for (let dz = -tileRadius; dz <= tileRadius; dz++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= tileRadius) {
        offsets.push({ dx, dz, dist });
      }
    }
  }

  // Sort by distance: load near tiles first
  offsets.sort((a, b) => a.dist - b.dist);

  return offsets;
}

/**
 * Precomputed disk offsets for tile queries.
 * Computed once at module load.
 */
export const DISK_OFFSETS = precomputeDiskOffsets(CULL_RADIUS_TILES);
