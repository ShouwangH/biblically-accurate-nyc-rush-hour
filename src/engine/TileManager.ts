/**
 * TileManager - Spatial tile management for LOD streaming
 *
 * This engine handles:
 * - Tile coordinate conversions (world ↔ tile grid)
 * - LRU cache with bytes-based eviction
 * - Concurrent load throttling
 * - Visibility queries grouped by LOD level
 * - Distance-based tile sorting for deterministic rendering
 *
 * Per LOD_TILING_PLAN.md:
 * - 512m × 512m tiles
 * - Bytes-based LRU eviction (not tile count)
 * - Max 6 concurrent loads
 * - Precomputed disk offsets for O(~450) queries
 *
 * Per CLAUDE.md §8.3: Engine owns state, components only render.
 */

import { LOD_CONFIG, DISK_OFFSETS } from '../constants/lod';
import type {
  TileCoord,
  TileBounds,
  LoadedTile,
  VisibleTiles,
} from '../data/types';

// =============================================================================
// Tile Coordinate Utilities
// =============================================================================

/**
 * Convert world coordinates to tile coordinates.
 */
export function worldToTile(worldX: number, worldZ: number): TileCoord {
  return {
    x: Math.floor(worldX / LOD_CONFIG.TILE_SIZE),
    z: Math.floor(worldZ / LOD_CONFIG.TILE_SIZE),
  };
}

/**
 * Get world-space bounds for a tile.
 */
export function tileToBounds(tile: TileCoord): TileBounds {
  const size = LOD_CONFIG.TILE_SIZE;
  return {
    minX: tile.x * size,
    maxX: (tile.x + 1) * size,
    minZ: tile.z * size,
    maxZ: (tile.z + 1) * size,
  };
}

/**
 * Generate unique string key for tile coordinate.
 */
export function tileKey(tile: TileCoord): string {
  return `${tile.x}_${tile.z}`;
}

/**
 * Parse tile key back to coordinates.
 */
export function parseTileKey(key: string): TileCoord {
  const [x, z] = key.split('_').map(Number);
  return { x: x!, z: z! };
}

/**
 * Calculate distance from a point to tile center.
 */
export function distanceToTileCenter(
  tile: TileCoord,
  worldX: number,
  worldZ: number
): number {
  const size = LOD_CONFIG.TILE_SIZE;
  const centerX = tile.x * size + size / 2;
  const centerZ = tile.z * size + size / 2;
  const dx = worldX - centerX;
  const dz = worldZ - centerZ;
  return Math.sqrt(dx * dx + dz * dz);
}

// =============================================================================
// TileManager Options
// =============================================================================

export interface TileManagerOptions {
  /** Maximum bytes to keep loaded. Default: LOD_CONFIG.MAX_BYTES_LOADED */
  maxBytesLoaded?: number;
  /** Maximum concurrent tile loads. Default: LOD_CONFIG.MAX_CONCURRENT_LOADS */
  maxConcurrentLoads?: number;
}

// =============================================================================
// TileManager Class
// =============================================================================

/**
 * Manages tile loading, caching, and visibility.
 */
export class TileManager {
  private loaded = new Map<string, LoadedTile>();
  private loading = new Set<string>();
  private lruOrder: string[] = [];
  private loadedBytes = 0;

  private readonly maxBytesLoaded: number;
  private readonly maxConcurrentLoads: number;

  constructor(options: TileManagerOptions = {}) {
    this.maxBytesLoaded = options.maxBytesLoaded ?? LOD_CONFIG.MAX_BYTES_LOADED;
    this.maxConcurrentLoads =
      options.maxConcurrentLoads ?? LOD_CONFIG.MAX_CONCURRENT_LOADS;
  }

  // ---------------------------------------------------------------------------
  // State Queries
  // ---------------------------------------------------------------------------

  /**
   * Get number of loaded tiles.
   */
  getLoadedTileCount(): number {
    return this.loaded.size;
  }

  /**
   * Get total loaded bytes.
   */
  getLoadedBytes(): number {
    return this.loadedBytes;
  }

  /**
   * Check if a tile is loaded.
   */
  isLoaded(key: string): boolean {
    return this.loaded.has(key);
  }

  /**
   * Check if a tile is currently loading.
   */
  isLoading(key: string): boolean {
    return this.loading.has(key);
  }

  /**
   * Check if we can start a new tile load.
   */
  canStartLoad(): boolean {
    return this.loading.size < this.maxConcurrentLoads;
  }

  /**
   * Get a loaded tile by key.
   */
  getTile(key: string): LoadedTile | undefined {
    return this.loaded.get(key);
  }

  // ---------------------------------------------------------------------------
  // Loading State Management
  // ---------------------------------------------------------------------------

  /**
   * Mark a tile as loading.
   */
  markLoading(key: string): void {
    this.loading.add(key);
  }

  /**
   * Clear loading status (on failure).
   */
  clearLoading(key: string): void {
    this.loading.delete(key);
  }

  /**
   * Register a loaded tile.
   * Adds to cache, updates bytes, clears loading status.
   */
  registerTile(tile: LoadedTile): void {
    const key = tileKey(tile.manifest.coord);

    // Don't double-count
    if (this.loaded.has(key)) {
      return;
    }

    this.loaded.set(key, tile);
    this.loadedBytes += tile.manifest.totalBytes;
    this.lruOrder.push(key);
    this.loading.delete(key);
  }

  /**
   * Touch a tile to move it to end of LRU (most recently used).
   */
  touchTile(key: string): void {
    const idx = this.lruOrder.indexOf(key);
    if (idx !== -1) {
      this.lruOrder.splice(idx, 1);
      this.lruOrder.push(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------

  /**
   * Evict tiles until under byte budget.
   * Uses LRU order (oldest first).
   */
  evictIfOverBudget(): void {
    while (this.loadedBytes > this.maxBytesLoaded && this.lruOrder.length > 0) {
      const oldest = this.lruOrder.shift();
      if (oldest) {
        this.unloadTileInternal(oldest);
      }
    }
  }

  /**
   * Unload a specific tile.
   */
  unloadTile(key: string): void {
    this.unloadTileInternal(key);
    // Also remove from LRU order
    const idx = this.lruOrder.indexOf(key);
    if (idx !== -1) {
      this.lruOrder.splice(idx, 1);
    }
  }

  private unloadTileInternal(key: string): void {
    const tile = this.loaded.get(key);
    if (tile) {
      this.loadedBytes -= tile.manifest.totalBytes;
      this.loaded.delete(key);
      // TODO: Dispose geometry (lod0Scene, roads buffer)
    }
  }

  /**
   * Clear all tiles.
   */
  clear(): void {
    this.loaded.clear();
    this.loading.clear();
    this.lruOrder = [];
    this.loadedBytes = 0;
  }

  // ---------------------------------------------------------------------------
  // Visibility Queries
  // ---------------------------------------------------------------------------

  /**
   * Get visible tiles grouped by LOD level.
   * Updates distance on each tile and touches for LRU.
   */
  getVisibleTiles(cameraX: number, cameraZ: number): VisibleTiles {
    const result: VisibleTiles = {
      lod0: [],
      lod1: [],
      lod2: [],
    };

    const cameraTile = worldToTile(cameraX, cameraZ);

    // Use precomputed disk offsets for efficient query
    for (const { dx, dz } of DISK_OFFSETS) {
      const tileCoord: TileCoord = {
        x: cameraTile.x + dx,
        z: cameraTile.z + dz,
      };
      const key = tileKey(tileCoord);
      const tile = this.loaded.get(key);

      if (!tile) {
        continue;
      }

      // Calculate distance to tile center
      const dist = distanceToTileCenter(tileCoord, cameraX, cameraZ);
      tile.distance = dist;

      // Touch for LRU
      this.touchTile(key);

      // Classify by LOD based on distance
      if (dist < LOD_CONFIG.RADIUS_LOD0) {
        result.lod0.push(tile);
      } else if (dist < LOD_CONFIG.RADIUS_LOD1) {
        result.lod1.push(tile);
      } else if (dist < LOD_CONFIG.RADIUS_CULL) {
        result.lod2.push(tile);
      }
      // Beyond RADIUS_CULL: not added = culled
    }

    // Sort each LOD group by distance (closest first)
    result.lod0.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    result.lod1.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    result.lod2.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

    return result;
  }

  /**
   * Get all loaded tiles within a radius.
   */
  getTilesInRadius(
    cameraX: number,
    cameraZ: number,
    radius: number
  ): LoadedTile[] {
    const result: LoadedTile[] = [];
    const cameraTile = worldToTile(cameraX, cameraZ);
    const tileRadius = Math.ceil(radius / LOD_CONFIG.TILE_SIZE);

    for (let dx = -tileRadius; dx <= tileRadius; dx++) {
      for (let dz = -tileRadius; dz <= tileRadius; dz++) {
        const tileCoord: TileCoord = {
          x: cameraTile.x + dx,
          z: cameraTile.z + dz,
        };
        const key = tileKey(tileCoord);
        const tile = this.loaded.get(key);

        if (tile) {
          const dist = distanceToTileCenter(tileCoord, cameraX, cameraZ);
          if (dist <= radius) {
            tile.distance = dist;
            result.push(tile);
          }
        }
      }
    }

    return result.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  }

  /**
   * Get tiles that should be loaded based on camera position.
   * Returns tile keys sorted by priority (nearest first).
   */
  getTilesToLoad(cameraX: number, cameraZ: number): string[] {
    const result: string[] = [];
    const cameraTile = worldToTile(cameraX, cameraZ);

    // Use precomputed disk offsets (already sorted by distance)
    for (const { dx, dz } of DISK_OFFSETS) {
      const tileCoord: TileCoord = {
        x: cameraTile.x + dx,
        z: cameraTile.z + dz,
      };
      const key = tileKey(tileCoord);

      // Skip if already loaded or loading
      if (this.loaded.has(key) || this.loading.has(key)) {
        continue;
      }

      result.push(key);
    }

    return result;
  }
}
