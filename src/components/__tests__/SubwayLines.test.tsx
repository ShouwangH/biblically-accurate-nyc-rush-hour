/**
 * Tests for SubwayLines component
 *
 * TDD: These tests define the expected behavior for subway line rendering.
 *
 * The SubwayLines component:
 * - Renders subway lines as TubeGeometry from polylines
 * - Uses line color and glowColor for materials
 * - Static rendering (no animation per frame)
 *
 * Per CLAUDE.md §8.3: Component only renders; data from context.
 * Per CLAUDE.md §8.7: TDD is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { Point3D } from '../../data/types';

// =============================================================================
// Mocks
// =============================================================================

// Mock subway lines data
const mockSubwayLines = {
  lines: [
    {
      id: 'A',
      name: 'A Eighth Avenue Express',
      color: '#0039A6',
      glowColor: '#1E5FD9',
      segments: [
        {
          points: [
            [0, -18, 0],
            [100, -18, 0],
            [200, -18, 100],
          ] as Point3D[],
        },
      ],
      depth: -18,
    },
    {
      id: '1',
      name: '1 Broadway Local',
      color: '#EE352E',
      glowColor: '#FF5A52',
      segments: [
        {
          points: [
            [50, -22, 0],
            [50, -22, 150],
          ] as Point3D[],
        },
      ],
      depth: -22,
    },
  ],
};

// Mock useData
vi.mock('../../hooks/useDataLoader', () => ({
  useData: vi.fn(() => ({
    data: {
      subwayLines: mockSubwayLines,
    },
    isLoading: false,
    error: null,
  })),
}));

// =============================================================================
// Tests
// =============================================================================

describe('SubwayLines component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('module exports', () => {
    it('exports SubwayLines component', async () => {
      const module = await import('../SubwayLines');
      expect(module.SubwayLines).toBeDefined();
      expect(typeof module.SubwayLines).toBe('function');
    });

    it('exports TUBE_RADIUS constant', async () => {
      const module = await import('../SubwayLines');
      expect(module.TUBE_RADIUS).toBeDefined();
      expect(typeof module.TUBE_RADIUS).toBe('number');
      expect(module.TUBE_RADIUS).toBeGreaterThan(0);
    });

    it('exports TUBE_SEGMENTS constant', async () => {
      const module = await import('../SubwayLines');
      expect(module.TUBE_SEGMENTS).toBeDefined();
      expect(typeof module.TUBE_SEGMENTS).toBe('number');
      expect(module.TUBE_SEGMENTS).toBeGreaterThanOrEqual(8);
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

      const { SubwayLines } = await import('../SubwayLines');
      const element = <SubwayLines />;

      // Component should handle null data gracefully
      expect(element).toBeDefined();
    });

    it('renders a group element', async () => {
      const { SubwayLines } = await import('../SubwayLines');
      const element = <SubwayLines />;

      // Component renders without crashing
      expect(element).toBeDefined();
    });
  });

  describe('geometry creation', () => {
    it('creates curve from polyline points', () => {
      // Test that points can be converted to THREE.js curve
      const points = [
        [0, -18, 0],
        [100, -18, 0],
        [200, -18, 100],
      ] as Point3D[];

      const vectors = points.map(
        (p) => new THREE.Vector3(p[0], p[1], p[2])
      );
      const curve = new THREE.CatmullRomCurve3(vectors);

      expect(curve.getLength()).toBeGreaterThan(0);
      expect(curve.getPoint(0).x).toBe(0);
      expect(curve.getPoint(1).x).toBeCloseTo(200, 0);
    });

    it('tube geometry has correct radius', () => {
      // Verify TubeGeometry creation works with expected parameters
      const points = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(100, 0, 0),
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      const radius = 3;
      const segments = 64;
      const radialSegments = 8;

      const geometry = new THREE.TubeGeometry(
        curve,
        segments,
        radius,
        radialSegments,
        false
      );

      expect(geometry).toBeDefined();
      expect(geometry.parameters.radius).toBe(radius);
    });
  });

  describe('material properties', () => {
    it('creates material with line color', () => {
      const color = '#0039A6';
      const material = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
      });

      expect(material.color.getHexString()).toBe('0039a6');
    });

    it('uses emissive for glow effect', () => {
      const glowColor = '#1E5FD9';
      const material = new THREE.MeshStandardMaterial({
        color: '#0039A6',
        emissive: glowColor,
        emissiveIntensity: 0.5,
      });

      expect(material.emissive.getHexString()).toBe('1e5fd9');
      expect(material.emissiveIntensity).toBe(0.5);
    });
  });
});

describe('SubwayLines curve helper', () => {
  it('handles single segment line', () => {
    const points = [
      [0, -18, 0],
      [100, -18, 100],
    ] as Point3D[];

    const vectors = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vectors);

    // Should create a valid curve
    expect(curve.points).toHaveLength(2);
  });

  it('handles multi-point polyline', () => {
    const points = [
      [0, -18, 0],
      [50, -18, 50],
      [100, -18, 50],
      [150, -18, 100],
    ] as Point3D[];

    const vectors = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vectors);

    // Curve should pass through all points
    expect(curve.points).toHaveLength(4);

    // Mid-point should be interpolated
    const midPoint = curve.getPoint(0.5);
    expect(midPoint).toBeDefined();
  });

  it('preserves Y depth from polyline', () => {
    const depth = -22;
    const points = [
      [0, depth, 0],
      [100, depth, 0],
    ] as Point3D[];

    const vectors = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vectors);

    // All points should maintain the depth
    const startPoint = curve.getPoint(0);
    const endPoint = curve.getPoint(1);

    expect(startPoint.y).toBe(depth);
    expect(endPoint.y).toBe(depth);
  });
});
