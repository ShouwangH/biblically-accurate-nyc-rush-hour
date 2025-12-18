/**
 * Tests for TileManager
 *
 * TDD: These tests define the expected behavior for tile-based LOD streaming.
 *
 * The TileManager is a pure TypeScript class that:
 * - Converts world coordinates to tile coordinates
 * - Tracks which tiles are loaded/loading
 * - Uses bytes-based LRU eviction (not tile count)
 * - Throttles concurrent tile loads
 * - Groups visible tiles by LOD level
 * - Uses precomputed disk offsets for O(~450) queries
 *
 * Per CLAUDE.md §8.3: Engine owns state computation, components only render.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TileManager,
  worldToTile,
  tileToBounds,
  tileKey,
  distanceToTileCenter,
} from './TileManager';
import { LOD_CONFIG } from '../constants/lod';
import type { TileCoord, TileManifest, LoadedTile } from '../data/types';

// =============================================================================
// Test Data
// =============================================================================

/**
 * Create a mock tile manifest.
 */
function createMockManifest(
  x: number,
  z: number,
  options: { totalBytes?: number } = {}
): TileManifest {
  const tileSize = LOD_CONFIG.TILE_SIZE;
  return {
    coord: { x, z },
    bounds: {
      minX: x * tileSize,
      maxX: (x + 1) * tileSize,
      minZ: z * tileSize,
      maxZ: (z + 1) * tileSize,
    },
    buildings: {
      lod0Url: `tiles/buildings/${x}_${z}.glb`,
      lod1: [
        { x: x * tileSize + 100, z: z * tileSize + 100, width: 20, depth: 20, height: 50 },
      ],
      lod0Triangles: 1000,
      lod0Bytes: 50000,
      lod1BoxCount: 1,
    },
    roads: {
      binUrl: `tiles/roads/${x}_${z}.bin`,
      segmentCount: 10,
      byteLength: 5000,
    },
    stationIds: [],
    totalBytes: options.totalBytes ?? 55000,
  };
}

/**
 * Create a mock loaded tile.
 */
function createMockLoadedTile(
  x: number,
  z: number,
  options: { totalBytes?: number } = {}
): LoadedTile {
  return {
    manifest: createMockManifest(x, z, options),
    roads: new Float32Array([0, 0, 0, 100, 0, 0]),
    lod0Scene: null,
  };
}

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('Tile Coordinate Utilities', () => {
  describe('worldToTile', () => {
    it('converts origin to tile (0, 0)', () => {
      const tile = worldToTile(0, 0);
      expect(tile.x).toBe(0);
      expect(tile.z).toBe(0);
    });

    it('converts positive coordinates to correct tile', () => {
      const tileSize = LOD_CONFIG.TILE_SIZE; // 512
      const tile = worldToTile(tileSize + 100, tileSize * 2 + 50);
      expect(tile.x).toBe(1);
      expect(tile.z).toBe(2);
    });

    it('converts negative coordinates to correct tile', () => {
      const tileSize = LOD_CONFIG.TILE_SIZE;
      const tile = worldToTile(-100, -tileSize - 100);
      expect(tile.x).toBe(-1);
      expect(tile.z).toBe(-2);
    });

    it('handles tile boundaries correctly', () => {
      const tileSize = LOD_CONFIG.TILE_SIZE;
      // Exactly on boundary belongs to next tile
      const tile = worldToTile(tileSize, tileSize);
      expect(tile.x).toBe(1);
      expect(tile.z).toBe(1);
    });
  });

  describe('tileToBounds', () => {
    it('returns correct bounds for origin tile', () => {
      const bounds = tileToBounds({ x: 0, z: 0 });
      const tileSize = LOD_CONFIG.TILE_SIZE;
      expect(bounds.minX).toBe(0);
      expect(bounds.maxX).toBe(tileSize);
      expect(bounds.minZ).toBe(0);
      expect(bounds.maxZ).toBe(tileSize);
    });

    it('returns correct bounds for positive tile', () => {
      const bounds = tileToBounds({ x: 2, z: 3 });
      const tileSize = LOD_CONFIG.TILE_SIZE;
      expect(bounds.minX).toBe(2 * tileSize);
      expect(bounds.maxX).toBe(3 * tileSize);
      expect(bounds.minZ).toBe(3 * tileSize);
      expect(bounds.maxZ).toBe(4 * tileSize);
    });

    it('returns correct bounds for negative tile', () => {
      const bounds = tileToBounds({ x: -1, z: -2 });
      const tileSize = LOD_CONFIG.TILE_SIZE;
      expect(bounds.minX).toBe(-tileSize);
      expect(bounds.maxX).toBe(0);
      expect(bounds.minZ).toBe(-2 * tileSize);
      expect(bounds.maxZ).toBe(-tileSize);
    });
  });

  describe('tileKey', () => {
    it('generates unique key for tile coordinate', () => {
      expect(tileKey({ x: 0, z: 0 })).toBe('0_0');
      expect(tileKey({ x: 1, z: -2 })).toBe('1_-2');
      expect(tileKey({ x: -3, z: 4 })).toBe('-3_4');
    });

    it('generates consistent keys', () => {
      const coord: TileCoord = { x: 5, z: -10 };
      expect(tileKey(coord)).toBe(tileKey({ x: 5, z: -10 }));
    });
  });

  describe('distanceToTileCenter', () => {
    it('returns 0 for point at tile center', () => {
      const tileSize = LOD_CONFIG.TILE_SIZE;
      const centerX = tileSize / 2;
      const centerZ = tileSize / 2;
      const dist = distanceToTileCenter({ x: 0, z: 0 }, centerX, centerZ);
      expect(dist).toBeCloseTo(0, 1);
    });

    it('returns correct distance to tile center', () => {
      const tileSize = LOD_CONFIG.TILE_SIZE;
      // Camera at origin, tile 1_0 center is at (tileSize + tileSize/2, tileSize/2)
      const dist = distanceToTileCenter({ x: 1, z: 0 }, 0, 0);
      const expectedCenterX = tileSize + tileSize / 2;
      const expectedCenterZ = tileSize / 2;
      const expected = Math.sqrt(expectedCenterX ** 2 + expectedCenterZ ** 2);
      expect(dist).toBeCloseTo(expected, 1);
    });
  });
});

// =============================================================================
// TileManager Tests
// =============================================================================

describe('TileManager', () => {
  let manager: TileManager;

  beforeEach(() => {
    // Create fresh manager for each test
    manager = new TileManager();
  });

  describe('constructor', () => {
    it('creates a manager with zero loaded tiles', () => {
      expect(manager.getLoadedTileCount()).toBe(0);
    });

    it('starts with zero loaded bytes', () => {
      expect(manager.getLoadedBytes()).toBe(0);
    });
  });

  describe('tile loading', () => {
    it('registers a tile as loaded', () => {
      const tile = createMockLoadedTile(0, 0);
      manager.registerTile(tile);

      expect(manager.getLoadedTileCount()).toBe(1);
      expect(manager.isLoaded('0_0')).toBe(true);
    });

    it('tracks loaded bytes correctly', () => {
      const tile = createMockLoadedTile(0, 0, { totalBytes: 100000 });
      manager.registerTile(tile);

      expect(manager.getLoadedBytes()).toBe(100000);
    });

    it('accumulates bytes from multiple tiles', () => {
      manager.registerTile(createMockLoadedTile(0, 0, { totalBytes: 50000 }));
      manager.registerTile(createMockLoadedTile(1, 0, { totalBytes: 75000 }));

      expect(manager.getLoadedBytes()).toBe(125000);
    });

    it('does not double-count same tile', () => {
      const tile = createMockLoadedTile(0, 0, { totalBytes: 50000 });
      manager.registerTile(tile);
      manager.registerTile(tile);

      expect(manager.getLoadedTileCount()).toBe(1);
      expect(manager.getLoadedBytes()).toBe(50000);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest tile when over byte budget', () => {
      // Set a small byte budget for testing
      const smallBudgetManager = new TileManager({ maxBytesLoaded: 100000 });

      // Load tiles that exceed budget
      smallBudgetManager.registerTile(createMockLoadedTile(0, 0, { totalBytes: 60000 }));
      smallBudgetManager.registerTile(createMockLoadedTile(1, 0, { totalBytes: 60000 }));

      // Trigger eviction
      smallBudgetManager.evictIfOverBudget();

      // First tile should be evicted
      expect(smallBudgetManager.isLoaded('0_0')).toBe(false);
      expect(smallBudgetManager.isLoaded('1_0')).toBe(true);
      expect(smallBudgetManager.getLoadedBytes()).toBe(60000);
    });

    it('evicts multiple tiles if needed', () => {
      const smallBudgetManager = new TileManager({ maxBytesLoaded: 50000 });

      smallBudgetManager.registerTile(createMockLoadedTile(0, 0, { totalBytes: 30000 }));
      smallBudgetManager.registerTile(createMockLoadedTile(1, 0, { totalBytes: 30000 }));
      smallBudgetManager.registerTile(createMockLoadedTile(2, 0, { totalBytes: 30000 }));

      smallBudgetManager.evictIfOverBudget();

      // Should keep only one tile (most recent)
      expect(smallBudgetManager.getLoadedTileCount()).toBe(1);
      expect(smallBudgetManager.isLoaded('2_0')).toBe(true);
    });

    it('updates LRU order when tile is touched', () => {
      const smallBudgetManager = new TileManager({ maxBytesLoaded: 100000 });

      smallBudgetManager.registerTile(createMockLoadedTile(0, 0, { totalBytes: 40000 }));
      smallBudgetManager.registerTile(createMockLoadedTile(1, 0, { totalBytes: 40000 }));

      // Touch first tile (move to end of LRU)
      smallBudgetManager.touchTile('0_0');

      // Add third tile to trigger eviction
      smallBudgetManager.registerTile(createMockLoadedTile(2, 0, { totalBytes: 40000 }));
      smallBudgetManager.evictIfOverBudget();

      // Tile 1 (oldest untouched) should be evicted, not tile 0
      expect(smallBudgetManager.isLoaded('0_0')).toBe(true);
      expect(smallBudgetManager.isLoaded('1_0')).toBe(false);
      expect(smallBudgetManager.isLoaded('2_0')).toBe(true);
    });
  });

  describe('visible tiles update', () => {
    it('groups tiles by LOD based on distance', () => {
      // Load tiles at various distances
      const tileSize = LOD_CONFIG.TILE_SIZE;

      // Tile at origin (very close)
      manager.registerTile(createMockLoadedTile(0, 0));

      // Tile at medium distance (~2km away, in LOD1 range)
      const mediumTileX = Math.floor(2000 / tileSize);
      manager.registerTile(createMockLoadedTile(mediumTileX, 0));

      // Tile at far distance (~5km away, in LOD2 range)
      const farTileX = Math.floor(5000 / tileSize);
      manager.registerTile(createMockLoadedTile(farTileX, 0));

      // Camera at tile center
      const cameraX = tileSize / 2;
      const cameraZ = tileSize / 2;

      const visible = manager.getVisibleTiles(cameraX, cameraZ);

      // Origin tile should be LOD0 (within 1.5km)
      expect(visible.lod0.some((t) => t.manifest.coord.x === 0)).toBe(true);

      // Medium tile should be LOD1 (1.5-3.5km)
      expect(visible.lod1.some((t) => t.manifest.coord.x === mediumTileX)).toBe(true);

      // Far tile should be LOD2 (3.5-6km)
      expect(visible.lod2.some((t) => t.manifest.coord.x === farTileX)).toBe(true);
    });

    it('excludes tiles beyond cull radius', () => {
      const tileSize = LOD_CONFIG.TILE_SIZE;

      // Tile way beyond cull distance
      const veryFarTileX = Math.floor(10000 / tileSize); // 10km away
      manager.registerTile(createMockLoadedTile(veryFarTileX, 0));

      const visible = manager.getVisibleTiles(0, 0);

      // Should not appear in any LOD group
      expect(visible.lod0.length).toBe(0);
      expect(visible.lod1.length).toBe(0);
      expect(visible.lod2.length).toBe(0);
    });

    it('sorts tiles by distance within each LOD', () => {
      const tileSize = LOD_CONFIG.TILE_SIZE;

      // Add multiple tiles at varying distances within LOD0
      manager.registerTile(createMockLoadedTile(0, 0)); // closest
      manager.registerTile(createMockLoadedTile(1, 0)); // medium
      manager.registerTile(createMockLoadedTile(2, 0)); // farthest in LOD0

      const visible = manager.getVisibleTiles(tileSize / 2, tileSize / 2);

      // Tiles should be sorted by distance (closest first)
      if (visible.lod0.length >= 2) {
        const distances = visible.lod0.map((t) => t.distance ?? 0);
        for (let i = 1; i < distances.length; i++) {
          expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
        }
      }
    });

    it('touches tiles during visibility check (updates LRU)', () => {
      // Verify that visible tiles get touched (moved to end of LRU)
      // We use a tile that is visible and one that is FAR outside visible range
      // Budget of 120k allows 2 tiles (50k each) with room for a third
      const smallBudgetManager = new TileManager({ maxBytesLoaded: 120000 });

      // Tile at origin (visible from camera at 256, 256)
      smallBudgetManager.registerTile(createMockLoadedTile(0, 0, { totalBytes: 50000 }));
      // Tile FAR outside visible range (20 tiles = 10km away, well beyond 6km cull)
      smallBudgetManager.registerTile(createMockLoadedTile(20, 0, { totalBytes: 50000 }));

      // LRU order is now: ['0_0', '20_0']
      // Get visible tiles - only 0_0 is visible, so only it gets touched
      // After touch, LRU order becomes: ['20_0', '0_0']
      smallBudgetManager.getVisibleTiles(256, 256);

      // Add a third tile to trigger eviction (now 150k, over 120k budget)
      smallBudgetManager.registerTile(createMockLoadedTile(1, 0, { totalBytes: 50000 }));
      // LRU order is now: ['20_0', '0_0', '1_0']
      smallBudgetManager.evictIfOverBudget();

      // Tile 20_0 was not touched (not visible), so it's oldest and should be evicted
      // Tiles 0_0 and 1_0 should remain (now 100k, under 120k budget)
      expect(smallBudgetManager.isLoaded('0_0')).toBe(true);
      expect(smallBudgetManager.isLoaded('1_0')).toBe(true);
      expect(smallBudgetManager.isLoaded('20_0')).toBe(false);
    });
  });

  describe('loading queue', () => {
    it('marks tiles as loading', () => {
      manager.markLoading('0_0');
      expect(manager.isLoading('0_0')).toBe(true);
    });

    it('clears loading status when registered', () => {
      manager.markLoading('0_0');
      manager.registerTile(createMockLoadedTile(0, 0));
      expect(manager.isLoading('0_0')).toBe(false);
    });

    it('respects max concurrent loads', () => {
      const maxLoads = LOD_CONFIG.MAX_CONCURRENT_LOADS;

      // Mark max number of tiles as loading
      for (let i = 0; i < maxLoads; i++) {
        expect(manager.canStartLoad()).toBe(true);
        manager.markLoading(`${i}_0`);
      }

      // Should not allow more loads
      expect(manager.canStartLoad()).toBe(false);
    });

    it('allows new loads after completing previous', () => {
      const maxLoads = LOD_CONFIG.MAX_CONCURRENT_LOADS;

      // Fill up loading queue
      for (let i = 0; i < maxLoads; i++) {
        manager.markLoading(`${i}_0`);
      }

      expect(manager.canStartLoad()).toBe(false);

      // Complete one load
      manager.registerTile(createMockLoadedTile(0, 0));

      // Should allow a new load
      expect(manager.canStartLoad()).toBe(true);
    });

    it('clears loading on failure', () => {
      manager.markLoading('0_0');
      manager.clearLoading('0_0');
      expect(manager.isLoading('0_0')).toBe(false);
      expect(manager.canStartLoad()).toBe(true);
    });
  });

  describe('tile queries', () => {
    it('getTilesInRadius returns tiles within radius', () => {
      // Load a grid of tiles
      for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
          manager.registerTile(createMockLoadedTile(x, z));
        }
      }

      // Query tiles within small radius from center
      const tiles = manager.getTilesInRadius(256, 256, 1000);

      // Should include nearby tiles but not all
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length).toBeLessThan(25); // Not all 25 tiles
    });

    it('getTile returns loaded tile by key', () => {
      manager.registerTile(createMockLoadedTile(5, -3));
      const tile = manager.getTile('5_-3');
      expect(tile).toBeDefined();
      expect(tile?.manifest.coord.x).toBe(5);
      expect(tile?.manifest.coord.z).toBe(-3);
    });

    it('getTile returns undefined for unloaded tile', () => {
      const tile = manager.getTile('999_999');
      expect(tile).toBeUndefined();
    });
  });

  describe('disposal', () => {
    it('unloads a specific tile', () => {
      manager.registerTile(createMockLoadedTile(0, 0, { totalBytes: 50000 }));
      expect(manager.isLoaded('0_0')).toBe(true);

      manager.unloadTile('0_0');

      expect(manager.isLoaded('0_0')).toBe(false);
      expect(manager.getLoadedBytes()).toBe(0);
    });

    it('clears all tiles', () => {
      manager.registerTile(createMockLoadedTile(0, 0));
      manager.registerTile(createMockLoadedTile(1, 0));
      manager.registerTile(createMockLoadedTile(2, 0));

      manager.clear();

      expect(manager.getLoadedTileCount()).toBe(0);
      expect(manager.getLoadedBytes()).toBe(0);
    });
  });
});

describe('TileManager integration', () => {
  it('handles typical camera movement workflow', () => {
    const manager = new TileManager();
    const tileSize = LOD_CONFIG.TILE_SIZE;

    // Simulate loading tiles around camera position
    const cameraX = 1000;
    const cameraZ = 1000;
    const cameraTile = worldToTile(cameraX, cameraZ);

    // Load tiles in a small radius around camera
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        manager.registerTile(
          createMockLoadedTile(cameraTile.x + dx, cameraTile.z + dz)
        );
      }
    }

    // Get visible tiles
    const visible = manager.getVisibleTiles(cameraX, cameraZ);

    // Should have some tiles in LOD0 (camera is near center)
    expect(visible.lod0.length).toBeGreaterThan(0);

    // All visible tiles should be within cull radius
    const allVisible = [...visible.lod0, ...visible.lod1, ...visible.lod2];
    for (const tile of allVisible) {
      expect(tile.distance).toBeLessThanOrEqual(LOD_CONFIG.RADIUS_CULL + tileSize);
    }
  });
});
