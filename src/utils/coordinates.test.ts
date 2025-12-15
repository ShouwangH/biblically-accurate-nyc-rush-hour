/**
 * Tests for coordinate conversion utilities
 *
 * TDD: These tests define the expected behavior for WGS84 ↔ local conversion.
 * The local coordinate system:
 * - Origin at Battery Park (40.7033, -74.017)
 * - X-axis: positive = east
 * - Y-axis: positive = up (elevation)
 * - Z-axis: negative = north, positive = south
 */
import { describe, it, expect } from 'vitest';
import {
  toLocalCoords,
  toWGS84,
  ORIGIN_LAT,
  ORIGIN_LNG,
} from './coordinates';

describe('coordinate constants', () => {
  it('origin is at Battery Park', () => {
    expect(ORIGIN_LAT).toBeCloseTo(40.7033, 4);
    expect(ORIGIN_LNG).toBeCloseTo(-74.017, 4);
  });
});

describe('toLocalCoords', () => {
  describe('origin conversion', () => {
    it('origin maps to [0, 0, 0]', () => {
      const [x, y, z] = toLocalCoords(ORIGIN_LAT, ORIGIN_LNG, 0);
      expect(x).toBeCloseTo(0, 1);
      expect(y).toBe(0);
      expect(z).toBeCloseTo(0, 1);
    });

    it('preserves elevation as y-coordinate', () => {
      const [, y1] = toLocalCoords(ORIGIN_LAT, ORIGIN_LNG, 10);
      const [, y2] = toLocalCoords(ORIGIN_LAT, ORIGIN_LNG, -20);

      expect(y1).toBe(10);
      expect(y2).toBe(-20);
    });
  });

  describe('directional behavior', () => {
    it('north of origin has negative z', () => {
      const [, , z] = toLocalCoords(40.71, ORIGIN_LNG, 0);
      expect(z).toBeLessThan(0);
    });

    it('south of origin has positive z', () => {
      const [, , z] = toLocalCoords(40.69, ORIGIN_LNG, 0);
      expect(z).toBeGreaterThan(0);
    });

    it('east of origin has positive x', () => {
      const [x] = toLocalCoords(ORIGIN_LAT, -74.00, 0);
      expect(x).toBeGreaterThan(0);
    });

    it('west of origin has negative x', () => {
      const [x] = toLocalCoords(ORIGIN_LAT, -74.03, 0);
      expect(x).toBeLessThan(0);
    });
  });

  describe('scale approximation', () => {
    // At this latitude, 1 degree lat ≈ 111km, 1 degree lng ≈ 85km
    it('1 degree latitude is approximately 111km', () => {
      const [, , z] = toLocalCoords(ORIGIN_LAT + 1, ORIGIN_LNG, 0);
      // 1 degree north = negative z ≈ -111320 meters
      expect(Math.abs(z)).toBeGreaterThan(100000);
      expect(Math.abs(z)).toBeLessThan(120000);
    });

    it('1 degree longitude is approximately 85km at this latitude', () => {
      const [x] = toLocalCoords(ORIGIN_LAT, ORIGIN_LNG + 1, 0);
      // 1 degree east = positive x ≈ 85000 meters
      expect(x).toBeGreaterThan(80000);
      expect(x).toBeLessThan(90000);
    });
  });

  describe('real-world locations', () => {
    it('Grand Central is north of origin', () => {
      // Grand Central: approximately 40.7527, -73.9772
      const [x, , z] = toLocalCoords(40.7527, -73.9772, 0);
      expect(z).toBeLessThan(0); // north
      expect(x).toBeGreaterThan(0); // east
    });

    it('Fulton St is near origin', () => {
      // Fulton St: approximately 40.7102, -74.0079
      const [x, , z] = toLocalCoords(40.7102, -74.0079, 0);
      // Should be relatively close to origin (within 1km)
      expect(Math.abs(x)).toBeLessThan(1500);
      expect(Math.abs(z)).toBeLessThan(1500);
    });
  });
});

describe('toWGS84', () => {
  describe('origin conversion', () => {
    it('origin maps back to Battery Park', () => {
      const [lat, lng, elev] = toWGS84(0, 0, 0);
      expect(lat).toBeCloseTo(ORIGIN_LAT, 4);
      expect(lng).toBeCloseTo(ORIGIN_LNG, 4);
      expect(elev).toBe(0);
    });

    it('preserves y-coordinate as elevation', () => {
      const [, , elev1] = toWGS84(0, 10, 0);
      const [, , elev2] = toWGS84(0, -20, 0);

      expect(elev1).toBe(10);
      expect(elev2).toBe(-20);
    });
  });

  describe('directional behavior', () => {
    it('negative z returns latitude north of origin', () => {
      const [lat] = toWGS84(0, 0, -1000);
      expect(lat).toBeGreaterThan(ORIGIN_LAT);
    });

    it('positive z returns latitude south of origin', () => {
      const [lat] = toWGS84(0, 0, 1000);
      expect(lat).toBeLessThan(ORIGIN_LAT);
    });

    it('positive x returns longitude east of origin', () => {
      const [, lng] = toWGS84(1000, 0, 0);
      expect(lng).toBeGreaterThan(ORIGIN_LNG);
    });

    it('negative x returns longitude west of origin', () => {
      const [, lng] = toWGS84(-1000, 0, 0);
      expect(lng).toBeLessThan(ORIGIN_LNG);
    });
  });
});

describe('round-trip conversion', () => {
  it('toLocalCoords → toWGS84 returns original coordinates', () => {
    const testCases = [
      [40.72, -74.00, 10],
      [40.75, -73.98, 0],
      [40.70, -74.02, -20],
      [40.7527, -73.9772, 5], // Grand Central area
    ];

    for (const [lat, lng, elev] of testCases) {
      const [x, y, z] = toLocalCoords(lat, lng, elev);
      const [lat2, lng2, elev2] = toWGS84(x, y, z);

      expect(lat2).toBeCloseTo(lat, 4);
      expect(lng2).toBeCloseTo(lng, 4);
      expect(elev2).toBe(elev);
    }
  });

  it('toWGS84 → toLocalCoords returns original coordinates', () => {
    const testCases = [
      [1000, 0, -500],
      [0, 10, 0],
      [-500, -20, 1000],
      [3389, 0, -5397], // Grand Central local coords
    ];

    for (const [x, y, z] of testCases) {
      const [lat, lng, elev] = toWGS84(x, y, z);
      const [x2, y2, z2] = toLocalCoords(lat, lng, elev);

      expect(x2).toBeCloseTo(x, 1);
      expect(y2).toBe(y);
      expect(z2).toBeCloseTo(z, 1);
    }
  });
});
