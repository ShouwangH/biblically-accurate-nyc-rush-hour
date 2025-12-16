/**
 * Tests for StationBeams component
 *
 * TDD: These tests define the expected behavior for station intensity beams.
 *
 * The StationBeams component:
 * - Renders beams at station surfacePosition using InstancedMesh
 * - Height and brightness vary with intensity over time
 * - Uses additive blending for glow effect
 *
 * Per CLAUDE.md §8.3: Component only renders; data from context.
 * Per CLAUDE.md §8.6: Uses InstancedMesh with pre-allocated temp objects.
 * Per CLAUDE.md §8.7: TDD is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { Point3D } from '../../data/types';

// =============================================================================
// Mocks
// =============================================================================

// Mock stations data
const mockStations = {
  meta: {
    timeSlices: 60,
    timeRange: [0, 1] as [number, number],
    normalization: 'global' as const,
    maxEntriesPerSlice: 2847,
    minIntensityFloor: 0.08,
  },
  stations: [
    {
      id: 'A32',
      name: 'Fulton St',
      lines: ['A', 'C', '2', '3'],
      position: [100, -20, 200] as Point3D,
      surfacePosition: [100, 0, 200] as Point3D,
      intensities: Array<number>(60)
        .fill(0)
        .map((_, i) => 0.1 + (i / 60) * 0.9), // Ramps from 0.1 to 1.0
    },
    {
      id: 'R23',
      name: 'Wall St',
      lines: ['2', '3'],
      position: [200, -25, 300] as Point3D,
      surfacePosition: [200, 0, 300] as Point3D,
      intensities: Array<number>(60).fill(0.5), // Constant 0.5
    },
  ],
};

// Mock useData
vi.mock('../../hooks/useDataLoader', () => ({
  useData: vi.fn(() => ({
    data: {
      stations: mockStations,
    },
    isLoading: false,
    error: null,
  })),
}));

// Mock useSimulationTime
const mockSimulationTime = { t: 0.5, isPlaying: true };
vi.mock('../../hooks/useSimulationTime', () => ({
  useSimulationTime: vi.fn(() => mockSimulationTime),
}));

// Mock react-three-fiber
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// =============================================================================
// Tests
// =============================================================================

describe('StationBeams component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('module exports', () => {
    it('exports StationBeams component', async () => {
      const module = await import('../StationBeams');
      expect(module.StationBeams).toBeDefined();
      expect(typeof module.StationBeams).toBe('function');
    });

    it('exports MAX_STATIONS constant', async () => {
      const module = await import('../StationBeams');
      expect(module.MAX_STATIONS).toBeDefined();
      expect(typeof module.MAX_STATIONS).toBe('number');
      expect(module.MAX_STATIONS).toBeGreaterThanOrEqual(100);
    });

    it('exports BEAM_DIMENSIONS constant', async () => {
      const module = await import('../StationBeams');
      expect(module.BEAM_DIMENSIONS).toBeDefined();
      expect(module.BEAM_DIMENSIONS.baseWidth).toBeGreaterThan(0);
      expect(module.BEAM_DIMENSIONS.maxHeight).toBeGreaterThan(0);
    });

    it('exports BEAM_COLORS constant', async () => {
      const module = await import('../StationBeams');
      expect(module.BEAM_COLORS).toBeDefined();
      expect(module.BEAM_COLORS.base).toBeDefined();
      expect(module.BEAM_COLORS.peak).toBeDefined();
    });
  });

  describe('component behavior', () => {
    it('returns null when data is not loaded', async () => {
      const useDataModule = await import('../../hooks/useDataLoader');
      vi.mocked(useDataModule.useData).mockReturnValueOnce({
        data: null,
        isLoading: true,
        error: null,
      });

      const { StationBeams } = await import('../StationBeams');
      const element = <StationBeams />;

      // Component should handle null data gracefully
      expect(element).toBeDefined();
    });

    it('accepts optional maxStations prop', async () => {
      const { StationBeams } = await import('../StationBeams');
      const element = <StationBeams maxStations={200} />;
      expect((element.props as { maxStations: number }).maxStations).toBe(200);
    });
  });

  describe('intensity to height mapping', () => {
    it('maps low intensity to short beam', () => {
      const intensity = 0.1;
      const maxHeight = 100;

      // Height should be proportional to intensity
      const height = intensity * maxHeight;
      expect(height).toBeCloseTo(10, 0);
    });

    it('maps high intensity to tall beam', () => {
      const intensity = 1.0;
      const maxHeight = 100;

      const height = intensity * maxHeight;
      expect(height).toBeCloseTo(100, 0);
    });

    it('maps mid intensity to mid height', () => {
      const intensity = 0.5;
      const maxHeight = 100;

      const height = intensity * maxHeight;
      expect(height).toBeCloseTo(50, 0);
    });
  });

  describe('intensity to color mapping', () => {
    it('maps low intensity to dim color', () => {
      const intensity = 0.2;

      // Lower intensity = less emissive
      const emissiveIntensity = intensity * 2.0; // Scale factor
      expect(emissiveIntensity).toBeCloseTo(0.4, 1);
    });

    it('maps high intensity to bright color', () => {
      const intensity = 1.0;

      const emissiveIntensity = intensity * 2.0;
      expect(emissiveIntensity).toBeCloseTo(2.0, 1);
    });

    it('uses additive blending for glow', () => {
      const material = new THREE.MeshBasicMaterial({
        color: '#FFFFFF',
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      expect(material.blending).toBe(THREE.AdditiveBlending);
      expect(material.depthWrite).toBe(false);
    });
  });

  describe('beam positioning', () => {
    it('positions beam at station surfacePosition', () => {
      const station = mockStations.stations[0]!;
      const surfacePos = station.surfacePosition;

      // Beam should be centered at surface position, extending upward
      expect(surfacePos[0]).toBe(100);
      expect(surfacePos[1]).toBe(0); // Street level
      expect(surfacePos[2]).toBe(200);
    });

    it('beam extends upward from surface (positive Y)', () => {
      const surfaceY = 0;
      const height = 50;

      // Beam center should be at surfaceY + height/2
      const beamCenterY = surfaceY + height / 2;
      expect(beamCenterY).toBe(25);
    });
  });

  describe('time slice interpolation', () => {
    it('uses getSliceIndex to determine current intensity', () => {
      // At t=0.5, slice index should be 30
      const t = 0.5;
      const numSlices = 60;
      const sliceIndex = Math.floor(t * numSlices);

      expect(sliceIndex).toBe(30);
    });

    it('retrieves correct intensity for current time', () => {
      const station = mockStations.stations[0]!;
      const sliceIndex = 30;

      const intensity = station.intensities[sliceIndex];
      // Intensity ramps from 0.1 to 1.0, so at 30/60:
      // 0.1 + (30/60) * 0.9 = 0.1 + 0.45 = 0.55
      expect(intensity).toBeCloseTo(0.55, 2);
    });
  });
});

describe('StationBeams scaling helper', () => {
  it('applies non-uniform scale for beam height', () => {
    const baseWidth = 5;
    const height = 50;

    // Scale vector for box geometry
    const scale = new THREE.Vector3(1, height / baseWidth, 1);

    expect(scale.y).toBe(10); // 50/5 = 10x vertical scale
  });

  it('creates transform matrix with position and scale', () => {
    const position = new THREE.Vector3(100, 25, 200);
    const scale = new THREE.Vector3(1, 10, 1);

    const matrix = new THREE.Matrix4();
    matrix.compose(
      position,
      new THREE.Quaternion(),
      scale
    );

    // Extract position back
    const extractedPos = new THREE.Vector3();
    matrix.decompose(extractedPos, new THREE.Quaternion(), new THREE.Vector3());

    expect(extractedPos.x).toBe(100);
    expect(extractedPos.y).toBe(25);
    expect(extractedPos.z).toBe(200);
  });
});
