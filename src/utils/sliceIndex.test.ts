/**
 * Tests for getSliceIndex utility
 *
 * TDD: These tests define the invariants for slice index calculation.
 * The implementation must satisfy all these constraints.
 */
import { describe, it, expect } from 'vitest';
import { getSliceIndex, NUM_SLICES } from './sliceIndex';

describe('getSliceIndex', () => {
  describe('constants', () => {
    it('NUM_SLICES equals 60', () => {
      expect(NUM_SLICES).toBe(60);
    });
  });

  describe('boundary cases', () => {
    it('returns 0 for t=0', () => {
      expect(getSliceIndex(0)).toBe(0);
    });

    it('returns 59 for t approaching 1', () => {
      expect(getSliceIndex(0.999)).toBe(59);
    });

    it('returns 59 for t=0.9999999', () => {
      expect(getSliceIndex(0.9999999)).toBe(59);
    });

    it('never returns 60 even if t=1 (clamps to 59)', () => {
      expect(getSliceIndex(1)).toBe(59);
    });

    it('clamps values greater than 1', () => {
      expect(getSliceIndex(1.5)).toBe(59);
      expect(getSliceIndex(100)).toBe(59);
    });

    it('clamps negative values to 0', () => {
      expect(getSliceIndex(-0.1)).toBe(0);
      expect(getSliceIndex(-100)).toBe(0);
    });
  });

  describe('mid-range values', () => {
    it('returns 30 for t=0.5', () => {
      expect(getSliceIndex(0.5)).toBe(30);
    });

    it('returns 1 for t=1/60 (first slice boundary)', () => {
      expect(getSliceIndex(1 / 60)).toBe(1);
    });

    it('returns 0 for t just below 1/60', () => {
      expect(getSliceIndex(1 / 60 - 0.0001)).toBe(0);
    });

    it('returns 15 for t=0.25', () => {
      expect(getSliceIndex(0.25)).toBe(15);
    });

    it('returns 45 for t=0.75', () => {
      expect(getSliceIndex(0.75)).toBe(45);
    });
  });

  describe('slice coverage', () => {
    it('each slice covers exactly 1/60 of the range', () => {
      for (let slice = 0; slice < 60; slice++) {
        const sliceStart = slice / 60;
        const sliceMid = (slice + 0.5) / 60;

        expect(getSliceIndex(sliceStart)).toBe(slice);
        expect(getSliceIndex(sliceMid)).toBe(slice);
      }
    });

    it('transitions correctly at slice boundaries', () => {
      // At exactly t = slice/60, should be in that slice
      expect(getSliceIndex(0 / 60)).toBe(0);
      expect(getSliceIndex(1 / 60)).toBe(1);
      expect(getSliceIndex(30 / 60)).toBe(30);
      expect(getSliceIndex(59 / 60)).toBe(59);
    });
  });

  describe('type safety', () => {
    it('handles integer inputs', () => {
      expect(getSliceIndex(0)).toBe(0);
      expect(getSliceIndex(1)).toBe(59);
    });

    it('handles very small positive values', () => {
      expect(getSliceIndex(0.0001)).toBe(0);
      expect(getSliceIndex(Number.EPSILON)).toBe(0);
    });
  });
});
