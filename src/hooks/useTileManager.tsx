/**
 * useTileManager - React hook for tile-based LOD streaming
 *
 * Wraps TileManager for React integration:
 * - Provides TileManager instance via context
 * - Handles tile loading/unloading lifecycle
 * - Updates visible tiles based on camera position
 *
 * Per CLAUDE.md §8.3: Engine owns state, components only render.
 * This hook bridges the TileManager engine with React components.
 */

import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import { useFrame } from '@react-three/fiber';
import { TileManager, worldToTile, tileKey } from '../engine/TileManager';
import type { VisibleTiles, LoadedTile } from '../data/types';
import { LOD_CONFIG } from '../constants/lod';

// =============================================================================
// Context
// =============================================================================

export interface TileManagerContextValue {
  /** The TileManager instance */
  manager: TileManager;

  /** Current visible tiles grouped by LOD */
  visibleTiles: VisibleTiles;

  /** Number of loaded tiles */
  loadedTileCount: number;

  /** Total loaded bytes */
  loadedBytes: number;

  /** Number of tiles currently loading */
  loadingCount: number;

  /** Manually trigger a tile load */
  loadTile: (key: string) => Promise<void>;

  /** Force refresh visibility */
  refreshVisibility: () => void;
}

const TileManagerContext = createContext<TileManagerContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface TileManagerProviderProps {
  children: ReactNode;

  /** Base URL for tile assets. Default: 'assets/tiles/' */
  baseUrl?: string;

  /** Tile index (preloaded). If not provided, tiles won't load automatically. */
  tileIndex?: Record<string, boolean>;

  /** Enable automatic tile loading based on camera. Default: true */
  autoLoad?: boolean;
}

/**
 * Provides TileManager context to the component tree.
 *
 * Note: For now, this is a simplified version that doesn't do actual
 * network loading. Tile data must be pre-registered. Full async loading
 * will be added when preprocessing pipeline (PR 0.5) is complete.
 */
export function TileManagerProvider({
  children,
  baseUrl = 'assets/tiles/',
  tileIndex,
  autoLoad = true,
}: TileManagerProviderProps) {
  const managerRef = useRef<TileManager>();
  if (!managerRef.current) {
    managerRef.current = new TileManager();
  }
  const manager = managerRef.current;

  // State for React re-renders
  const [visibleTiles, setVisibleTiles] = useState<VisibleTiles>({
    lod0: [],
    lod1: [],
    lod2: [],
  });
  const [loadedTileCount, setLoadedTileCount] = useState(0);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);

  // Track last camera tile to avoid unnecessary updates
  const lastCameraTileRef = useRef<string>('');

  // Tile loading function (stub for now - will be implemented with preprocessing)
  const loadTile = useCallback(
    async (key: string): Promise<void> => {
      if (manager.isLoaded(key) || manager.isLoading(key)) {
        return;
      }

      if (!manager.canStartLoad()) {
        return;
      }

      manager.markLoading(key);
      setLoadingCount(manager['loading'].size);

      try {
        // TODO: Implement actual loading when preprocessing pipeline is ready
        // For now, this is a placeholder that logs the attempt
        console.debug(`[TileManager] Would load tile: ${key} from ${baseUrl}${key}.json`);

        // Simulate load delay for testing
        // await new Promise((resolve) => setTimeout(resolve, 100));

        // In the real implementation:
        // 1. Fetch tile manifest from `${baseUrl}${key}.json`
        // 2. Fetch road binary from manifest.roads.binUrl
        // 3. Register the tile
      } catch (error) {
        console.error(`[TileManager] Failed to load tile ${key}:`, error);
        manager.clearLoading(key);
      } finally {
        setLoadingCount(manager['loading'].size);
      }
    },
    [manager, baseUrl]
  );

  // Refresh visibility based on camera
  const refreshVisibility = useCallback(() => {
    // This will be called from useFrame with actual camera position
    // For now, just update counts
    setLoadedTileCount(manager.getLoadedTileCount());
    setLoadedBytes(manager.getLoadedBytes());
  }, [manager]);

  // Update visible tiles in animation loop
  useFrame(({ camera }) => {
    const cameraX = camera.position.x;
    const cameraZ = camera.position.z;

    // Check if camera moved to a new tile
    const cameraTile = worldToTile(cameraX, cameraZ);
    const cameraTileKey = tileKey(cameraTile);

    // Only update if camera tile changed (performance optimization)
    const shouldUpdate = cameraTileKey !== lastCameraTileRef.current;

    if (shouldUpdate) {
      lastCameraTileRef.current = cameraTileKey;

      // Get visible tiles
      const visible = manager.getVisibleTiles(cameraX, cameraZ);
      setVisibleTiles(visible);

      // Evict if over budget
      manager.evictIfOverBudget();

      // Update counts
      setLoadedTileCount(manager.getLoadedTileCount());
      setLoadedBytes(manager.getLoadedBytes());

      // Auto-load tiles if enabled
      if (autoLoad && tileIndex) {
        const tilesToLoad = manager.getTilesToLoad(cameraX, cameraZ);
        // Load first few tiles that exist in index
        let loaded = 0;
        for (const key of tilesToLoad) {
          if (loaded >= LOD_CONFIG.MAX_CONCURRENT_LOADS) break;
          if (tileIndex[key]) {
            loadTile(key);
            loaded++;
          }
        }
      }
    }
  });

  const contextValue = useMemo<TileManagerContextValue>(
    () => ({
      manager,
      visibleTiles,
      loadedTileCount,
      loadedBytes,
      loadingCount,
      loadTile,
      refreshVisibility,
    }),
    [
      manager,
      visibleTiles,
      loadedTileCount,
      loadedBytes,
      loadingCount,
      loadTile,
      refreshVisibility,
    ]
  );

  return (
    <TileManagerContext.Provider value={contextValue}>
      {children}
    </TileManagerContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Access TileManager context.
 * Must be used within a TileManagerProvider.
 */
export function useTileManager(): TileManagerContextValue {
  const context = useContext(TileManagerContext);
  if (!context) {
    throw new Error('useTileManager must be used within a TileManagerProvider');
  }
  return context;
}

/**
 * Access just the visible tiles (convenience hook).
 */
export function useVisibleTiles(): VisibleTiles {
  return useTileManager().visibleTiles;
}

/**
 * Get all LOD0 tiles (closest, full detail).
 */
export function useLOD0Tiles(): LoadedTile[] {
  return useTileManager().visibleTiles.lod0;
}

/**
 * Get all LOD1 tiles (medium distance, boxes).
 */
export function useLOD1Tiles(): LoadedTile[] {
  return useTileManager().visibleTiles.lod1;
}

/**
 * Get station IDs from visible tiles.
 */
export function useVisibleStationIds(): Set<string> {
  const { visibleTiles } = useTileManager();

  return useMemo(() => {
    const ids = new Set<string>();
    const allTiles = [
      ...visibleTiles.lod0,
      ...visibleTiles.lod1,
      ...visibleTiles.lod2,
    ];
    for (const tile of allTiles) {
      for (const id of tile.manifest.stationIds) {
        ids.add(id);
      }
    }
    return ids;
  }, [visibleTiles]);
}
