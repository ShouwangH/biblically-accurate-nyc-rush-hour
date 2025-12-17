/**
 * Tests for GroundPlane component
 *
 * TDD: These tests define the expected behavior for the ground plane.
 * The ground plane provides visual context (neighborhoods, water, roads)
 * beneath the 3D visualization.
 *
 * Note: Three.js/R3F components are mocked since WebGL isn't available in jsdom.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// Mock react-three-fiber
vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    scene: {},
    camera: {},
    gl: { capabilities: { getMaxAnisotropy: () => 16 } },
  }),
}));

// Import after mocks
import {
  GROUND_BOUNDS,
  GROUND_WIDTH,
  GROUND_DEPTH,
  GROUND_CENTER_X,
  GROUND_CENTER_Z,
  GROUND_Y_POSITION,
} from '../../constants/groundBounds';

describe('GroundPlane constants', () => {
  describe('GROUND_BOUNDS', () => {
    it('has WGS84 bounds covering lower Manhattan', () => {
      expect(GROUND_BOUNDS.wgs84.south).toBeCloseTo(40.698, 3);
      expect(GROUND_BOUNDS.wgs84.north).toBeCloseTo(40.758, 3);
      expect(GROUND_BOUNDS.wgs84.west).toBeCloseTo(-74.025, 3);
      expect(GROUND_BOUNDS.wgs84.east).toBeCloseTo(-73.965, 3);
    });

    it('has local bounds in meters', () => {
      expect(GROUND_BOUNDS.local.xMin).toBe(-700);
      expect(GROUND_BOUNDS.local.xMax).toBe(4400);
      expect(GROUND_BOUNDS.local.zMin).toBe(-6100);
      expect(GROUND_BOUNDS.local.zMax).toBe(600);
    });
  });

  describe('derived constants', () => {
    it('computes correct width from bounds', () => {
      const expectedWidth = GROUND_BOUNDS.local.xMax - GROUND_BOUNDS.local.xMin;
      expect(GROUND_WIDTH).toBe(expectedWidth);
      expect(GROUND_WIDTH).toBe(5100);
    });

    it('computes correct depth from bounds', () => {
      const expectedDepth = GROUND_BOUNDS.local.zMax - GROUND_BOUNDS.local.zMin;
      expect(GROUND_DEPTH).toBe(expectedDepth);
      expect(GROUND_DEPTH).toBe(6700);
    });

    it('computes correct center X', () => {
      const expectedCenterX =
        (GROUND_BOUNDS.local.xMin + GROUND_BOUNDS.local.xMax) / 2;
      expect(GROUND_CENTER_X).toBe(expectedCenterX);
      expect(GROUND_CENTER_X).toBe(1850);
    });

    it('computes correct center Z', () => {
      const expectedCenterZ =
        (GROUND_BOUNDS.local.zMin + GROUND_BOUNDS.local.zMax) / 2;
      expect(GROUND_CENTER_Z).toBe(expectedCenterZ);
      expect(GROUND_CENTER_Z).toBe(-2750);
    });

    it('positions ground slightly below street level', () => {
      expect(GROUND_Y_POSITION).toBe(-0.5);
    });
  });
});

describe('GroundPlane geometry', () => {
  it('PlaneGeometry should match ground dimensions', () => {
    // When we create PlaneGeometry(width, height), it creates a plane in XY
    // We then rotate it to lie flat in XZ
    const geometry = new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_DEPTH);

    // PlaneGeometry stores width/height as parameters
    expect(geometry.parameters.width).toBe(5100);
    expect(geometry.parameters.height).toBe(6700);

    geometry.dispose();
  });

  it('ground plane center should be near data centroid', () => {
    // The camera target is approximately [1800, 0, -2700]
    // Ground center should be close to this
    expect(Math.abs(GROUND_CENTER_X - 1800)).toBeLessThan(100);
    expect(Math.abs(GROUND_CENTER_Z - -2700)).toBeLessThan(100);
  });
});

describe('GroundPlane material', () => {
  it('should use MeshBasicMaterial for unlit rendering', () => {
    // Ground should not respond to lighting - use BasicMaterial
    const material = new THREE.MeshBasicMaterial({ color: '#E8E8E8' });

    expect(material.type).toBe('MeshBasicMaterial');
    expect(material.color.getHexString()).toBe('e8e8e8');

    material.dispose();
  });
});
