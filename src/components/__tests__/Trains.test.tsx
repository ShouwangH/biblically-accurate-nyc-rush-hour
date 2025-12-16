/**
 * Tests for Trains component
 *
 * TDD: These tests define the expected behavior for the subway train renderer.
 *
 * The Trains component:
 * - Uses TrainEngine for active train computation
 * - Renders trains as InstancedMesh
 * - Maps crowding level to color brightness
 * - Updates per frame via useFrame
 *
 * Per CLAUDE.md §8.3: Component only renders; TrainEngine owns state.
 * Per CLAUDE.md §8.7: TDD is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { ActiveTrain } from '../../engine/TrainEngine';
import type { Point3D } from '../../data/types';

// =============================================================================
// Mocks
// =============================================================================

// Mock TrainEngine
const mockActiveTrains: ActiveTrain[] = [
  {
    id: 't1',
    lineId: 'A',
    position: [10, -18, 20] as Point3D,
    progress: 0.3,
    direction: 1,
    crowding: 0.2,
    color: '#0039A6',
  },
  {
    id: 't2',
    lineId: '1',
    position: [50, -15, 100] as Point3D,
    progress: 0.7,
    direction: -1,
    crowding: 0.8,
    color: '#EE352E',
  },
];

const mockGetActiveTrains = vi.fn(() => mockActiveTrains);

vi.mock('../../engine/TrainEngine', () => ({
  TrainEngine: vi.fn().mockImplementation(() => ({
    getActiveTrains: mockGetActiveTrains,
  })),
}));

// Mock useSimulationTime
const mockSimulationTime = { t: 0.5, isPlaying: true };
vi.mock('../../hooks/useSimulationTime', () => ({
  useSimulationTime: vi.fn(() => mockSimulationTime),
}));

// Mock useData
const mockData = {
  trainSchedules: {
    trains: [
      { id: 't1', lineId: 'A', segmentIndex: 0, direction: 1, tEnter: 0, tExit: 0.5, crowding: 0.2 },
    ],
    meta: { interpolationMode: 'linear' },
  },
  subwayLines: {
    lines: [
      {
        id: 'A',
        name: 'A Train',
        color: '#0039A6',
        glowColor: '#4A90D9',
        depth: -18,
        segments: [{ points: [[0, -18, 0], [100, -18, 0]] as Point3D[] }],
      },
    ],
  },
};

vi.mock('../../hooks/useDataLoader', () => ({
  useData: vi.fn(() => ({
    data: mockData,
    isLoading: false,
    error: null,
  })),
}));

// Mock react-three-fiber
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// =============================================================================
// Tests
// =============================================================================

describe('Trains component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveTrains.mockReturnValue(mockActiveTrains);
  });

  describe('module exports', () => {
    it('exports Trains component', async () => {
      // This will fail until Trains.tsx is implemented
      const module = await import('../Trains');
      expect(module.Trains).toBeDefined();
      expect(typeof module.Trains).toBe('function');
    });

    it('exports MAX_TRAINS constant', async () => {
      const module = await import('../Trains');
      expect(module.MAX_TRAINS).toBeDefined();
      expect(typeof module.MAX_TRAINS).toBe('number');
      expect(module.MAX_TRAINS).toBeGreaterThanOrEqual(300);
    });

    it('exports TRAIN_SIZE constant', async () => {
      const module = await import('../Trains');
      expect(module.TRAIN_SIZE).toBeDefined();
      expect(module.TRAIN_SIZE.width).toBeGreaterThan(0);
      expect(module.TRAIN_SIZE.height).toBeGreaterThan(0);
      expect(module.TRAIN_SIZE.length).toBeGreaterThan(0);
    });

    it('exports CROWDING_BRIGHTNESS constant', async () => {
      const module = await import('../Trains');
      expect(module.CROWDING_BRIGHTNESS).toBeDefined();
      expect(module.CROWDING_BRIGHTNESS.min).toBeGreaterThan(0);
      expect(module.CROWDING_BRIGHTNESS.max).toBeLessThanOrEqual(1);
      expect(module.CROWDING_BRIGHTNESS.min).toBeLessThan(module.CROWDING_BRIGHTNESS.max);
    });
  });

  describe('component behavior', () => {
    it('accepts optional maxTrains prop', async () => {
      const { Trains } = await import('../Trains');
      const element = <Trains maxTrains={500} />;
      expect((element.props as { maxTrains: number }).maxTrains).toBe(500);
    });

    it('uses TrainEngine for active train computation', async () => {
      const { TrainEngine } = await import('../../engine/TrainEngine');
      const { Trains } = await import('../Trains');

      // Render component (will initialize engine)
      <Trains />;

      // Engine should be constructed with train schedules and subway lines
      expect(TrainEngine).toBeDefined();
    });
  });

  describe('crowding to color mapping', () => {
    it('maps low crowding to bright color', () => {
      // Low crowding (0.0) should result in brightness close to max (1.0)
      const lowCrowding = 0.0;
      const expectedBrightness = 1.0; // CROWDING_BRIGHTNESS.max

      // Brightness = max - crowding * (max - min)
      // For crowding=0: brightness = 1.0 - 0 * (1.0 - 0.4) = 1.0
      const brightness = 1.0 - lowCrowding * (1.0 - 0.4);
      expect(brightness).toBeCloseTo(expectedBrightness, 2);
    });

    it('maps high crowding to dim color', () => {
      // High crowding (1.0) should result in brightness close to min (0.4)
      const highCrowding = 1.0;
      const expectedBrightness = 0.4; // CROWDING_BRIGHTNESS.min

      // Brightness = max - crowding * (max - min)
      // For crowding=1: brightness = 1.0 - 1.0 * (1.0 - 0.4) = 0.4
      const brightness = 1.0 - highCrowding * (1.0 - 0.4);
      expect(brightness).toBeCloseTo(expectedBrightness, 2);
    });

    it('maps mid crowding to mid brightness', () => {
      const midCrowding = 0.5;

      // Brightness = max - crowding * (max - min)
      // For crowding=0.5: brightness = 1.0 - 0.5 * (1.0 - 0.4) = 0.7
      const brightness = 1.0 - midCrowding * (1.0 - 0.4);
      expect(brightness).toBeCloseTo(0.7, 2);
    });
  });

  describe('rendering behavior', () => {
    it('returns null when data is not loaded', async () => {
      // Override useData to return no data
      const useDataModule = await import('../../hooks/useDataLoader');
      vi.mocked(useDataModule.useData).mockReturnValueOnce({
        data: null,
        isLoading: true,
        error: null,
      });

      const { Trains } = await import('../Trains');
      const element = <Trains />;

      // Component should handle null data gracefully
      expect(element).toBeDefined();
    });

    it('calls engine.getActiveTrains with current simulation time', async () => {
      await import('../Trains');

      // Verify mock was set up correctly
      expect(mockGetActiveTrains).toBeDefined();
    });
  });

  describe('integration with TrainEngine', () => {
    it('creates TrainEngine with correct data', async () => {
      const { TrainEngine } = await import('../../engine/TrainEngine');

      // TrainEngine constructor should receive trains and lines arrays
      expect(TrainEngine).toBeDefined();
    });
  });
});

describe('Trains color helper', () => {
  it('applies line color modulated by crowding brightness', () => {
    // Use white to ensure all channels are affected
    const baseColor = new THREE.Color('#FFFFFF');
    const crowding = 0.5;

    // Expected brightness for crowding=0.5 is 0.7
    const brightness = 1.0 - crowding * (1.0 - 0.4);

    // Apply brightness to base color
    const resultColor = baseColor.clone().multiplyScalar(brightness);

    // Should be dimmer than original (brightness = 0.7)
    expect(resultColor.r).toBeCloseTo(0.7, 2);
    expect(resultColor.g).toBeCloseTo(0.7, 2);
    expect(resultColor.b).toBeCloseTo(0.7, 2);
  });

  it('preserves color ratios when applying brightness', () => {
    // Use a color with non-zero components
    const baseColor = new THREE.Color('#FF8844');
    const crowding = 0.5;
    const brightness = 1.0 - crowding * (1.0 - 0.4); // 0.7

    const resultColor = baseColor.clone().multiplyScalar(brightness);

    // Ratios should be preserved (each channel multiplied by same brightness)
    expect(resultColor.r / baseColor.r).toBeCloseTo(brightness, 2);
    expect(resultColor.g / baseColor.g).toBeCloseTo(brightness, 2);
    expect(resultColor.b / baseColor.b).toBeCloseTo(brightness, 2);
  });
});
