/**
 * Tests for Data Loading Infrastructure
 *
 * TDD: These tests define the expected behavior for DataProvider and useData hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

// Import after implementation exists
import { DataProvider, useData, DataError } from '../hooks/useDataLoader';

// Mock fetch for testing
const mockStations = {
  meta: {
    timeSlices: 60,
    timeRange: [0, 1],
    normalization: 'global',
    maxEntriesPerSlice: 2847,
    minIntensityFloor: 0.08,
  },
  stations: [
    {
      id: 'A32',
      name: 'Fulton St',
      lines: ['A', 'C'],
      position: [1250, -20, 890],
      surfacePosition: [1250, 0, 890],
      intensities: Array(60).fill(0.5),
    },
  ],
};

const mockSubwayLines = {
  lines: [
    {
      id: 'A',
      name: 'A Eighth Avenue Express',
      color: '#0039A6',
      glowColor: '#4169E1',
      segments: [{ points: [[0, -20, 0], [100, -20, 100]] }],
      depth: -20,
    },
  ],
};

const mockTrainSchedules = {
  meta: { interpolationMode: 'linear' },
  trains: [
    {
      id: 't1',
      lineId: 'A',
      segmentIndex: 0,
      direction: 1,
      tEnter: 0,
      tExit: 0.5,
      crowding: 0.8,
    },
  ],
};

const mockRoadSegments = {
  meta: { timeSlices: 60, vehicleTypes: ['taxi', 'fhv'] },
  segments: [
    {
      id: 's1',
      type: 'avenue',
      points: [[0, 0, 0], [100, 0, 0]],
      avgSpeedMph: 10,
      freeFlowSpeedMph: 25,
      congestionFactor: 0.4,
      spawnRates: Array(60).fill(2),
    },
  ],
};

// Helper to create wrapper
function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DataProvider>{children}</DataProvider>;
  };
}

describe('DataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch
    global.fetch = vi.fn((url: string) => {
      if (url.includes('stations')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStations),
        });
      }
      if (url.includes('subway_lines')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSubwayLines),
        });
      }
      if (url.includes('train_schedules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTrainSchedules),
        });
      }
      if (url.includes('road_segments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRoadSegments),
        });
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useData hook', () => {
    it('throws if useData called outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useData());
      }).toThrow('useData must be used within a DataProvider');

      consoleSpy.mockRestore();
    });

    it('provides null data initially while loading', () => {
      const { result } = renderHook(() => useData(), {
        wrapper: createWrapper(),
      });

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('provides data after loading completes', async () => {
      const { result } = renderHook(() => useData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).not.toBeNull();
      expect(result.current.data?.stations).toBeDefined();
      expect(result.current.data?.subwayLines).toBeDefined();
      expect(result.current.data?.trainSchedules).toBeDefined();
      expect(result.current.data?.roadSegments).toBeDefined();
    });

    it('loads all four data files', async () => {
      const { result } = renderHook(() => useData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      // Verify fetch was called 4 times (one for each data file)
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('stations'));
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('subway_lines'));
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('train_schedules'));
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('road_segments'));
    });

    it('provides correctly typed station data', async () => {
      const { result } = renderHook(() => useData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      const stations = result.current.data!.stations;
      expect(stations.meta.timeSlices).toBe(60);
      expect(stations.stations[0]!.id).toBe('A32');
      expect(stations.stations[0]!.intensities).toHaveLength(60);
    });

    it('provides correctly typed subway line data', async () => {
      const { result } = renderHook(() => useData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      const lines = result.current.data!.subwayLines;
      expect(lines.lines[0]!.id).toBe('A');
      expect(lines.lines[0]!.color).toMatch(/^#/);
      expect(lines.lines[0]!.segments).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('sets error state when fetch fails', async () => {
      // Override fetch to fail
      global.fetch = vi.fn(() =>
        Promise.reject(new Error('Network error'))
      ) as unknown as typeof fetch;

      const { result } = renderHook(() => useData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).not.toBeNull();
      expect(result.current.error?.message).toContain('Network error');
      expect(result.current.data).toBeNull();
    });

    it('sets error state when response is not ok', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
      ) as unknown as typeof fetch;

      const { result } = renderHook(() => useData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).not.toBeNull();
    });
  });
});

describe('DataError', () => {
  it('is an Error subclass with additional context', () => {
    const error = new DataError('Failed to load', 'stations.json');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Failed to load');
    expect(error.file).toBe('stations.json');
  });
});
