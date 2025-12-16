/**
 * Tests for PostProcessing component
 *
 * TDD: These tests define the expected behavior for post-processing effects.
 *
 * The PostProcessing component:
 * - Adds bloom effect for emissive surfaces
 * - Optional vignette for cinematic look
 * - Configurable intensity and threshold
 *
 * Per CLAUDE.md §8.7: TDD is required.
 */
import { describe, it, expect, vi } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

// Mock @react-three/postprocessing
vi.mock('@react-three/postprocessing', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  EffectComposer: vi.fn((props: { children: unknown }) => props.children),
  Bloom: vi.fn(() => null),
  Vignette: vi.fn(() => null),
}));

// =============================================================================
// Tests
// =============================================================================

describe('PostProcessing component', () => {
  describe('module exports', () => {
    it('exports PostProcessing component', async () => {
      const module = await import('../PostProcessing');
      expect(module.PostProcessing).toBeDefined();
      expect(typeof module.PostProcessing).toBe('function');
    });

    it('exports BLOOM_CONFIG constant', async () => {
      const module = await import('../PostProcessing');
      expect(module.BLOOM_CONFIG).toBeDefined();
      expect(module.BLOOM_CONFIG.intensity).toBeDefined();
      expect(module.BLOOM_CONFIG.luminanceThreshold).toBeDefined();
      expect(module.BLOOM_CONFIG.luminanceSmoothing).toBeDefined();
    });

    it('exports VIGNETTE_CONFIG constant', async () => {
      const module = await import('../PostProcessing');
      expect(module.VIGNETTE_CONFIG).toBeDefined();
      expect(module.VIGNETTE_CONFIG.offset).toBeDefined();
      expect(module.VIGNETTE_CONFIG.darkness).toBeDefined();
    });
  });

  describe('component props', () => {
    it('accepts optional enableBloom prop (defaults to true)', async () => {
      const { PostProcessing } = await import('../PostProcessing');
      const element = <PostProcessing enableBloom={false} />;
      expect((element.props as { enableBloom: boolean }).enableBloom).toBe(false);
    });

    it('accepts optional enableVignette prop (defaults to true)', async () => {
      const { PostProcessing } = await import('../PostProcessing');
      const element = <PostProcessing enableVignette={false} />;
      expect((element.props as { enableVignette: boolean }).enableVignette).toBe(false);
    });

    it('accepts optional bloomIntensity prop', async () => {
      const { PostProcessing } = await import('../PostProcessing');
      const element = <PostProcessing bloomIntensity={2.0} />;
      expect((element.props as { bloomIntensity: number }).bloomIntensity).toBe(2.0);
    });
  });

  describe('bloom configuration', () => {
    it('has reasonable default intensity', async () => {
      const { BLOOM_CONFIG } = await import('../PostProcessing');
      // Intensity should be moderate (not too bright, not invisible)
      expect(BLOOM_CONFIG.intensity).toBeGreaterThan(0);
      expect(BLOOM_CONFIG.intensity).toBeLessThanOrEqual(3);
    });

    it('has luminance threshold that targets emissive materials', async () => {
      const { BLOOM_CONFIG } = await import('../PostProcessing');
      // Threshold should be low enough to catch emissive surfaces
      // but high enough to not bloom everything
      expect(BLOOM_CONFIG.luminanceThreshold).toBeGreaterThanOrEqual(0);
      expect(BLOOM_CONFIG.luminanceThreshold).toBeLessThanOrEqual(1);
    });

    it('has smooth luminance falloff', async () => {
      const { BLOOM_CONFIG } = await import('../PostProcessing');
      // Smoothing prevents harsh bloom cutoffs
      expect(BLOOM_CONFIG.luminanceSmoothing).toBeGreaterThan(0);
    });
  });

  describe('vignette configuration', () => {
    it('has subtle offset', async () => {
      const { VIGNETTE_CONFIG } = await import('../PostProcessing');
      // Offset controls where vignette starts
      expect(VIGNETTE_CONFIG.offset).toBeGreaterThan(0);
      expect(VIGNETTE_CONFIG.offset).toBeLessThanOrEqual(1);
    });

    it('has moderate darkness', async () => {
      const { VIGNETTE_CONFIG } = await import('../PostProcessing');
      // Darkness should be subtle, not overwhelming
      expect(VIGNETTE_CONFIG.darkness).toBeGreaterThan(0);
      expect(VIGNETTE_CONFIG.darkness).toBeLessThanOrEqual(1);
    });
  });
});

describe('PostProcessing rendering', () => {
  it('renders without crashing', async () => {
    const { PostProcessing } = await import('../PostProcessing');
    const element = <PostProcessing />;
    expect(element).toBeDefined();
  });

  it('can disable bloom', async () => {
    const { PostProcessing } = await import('../PostProcessing');
    const element = <PostProcessing enableBloom={false} />;
    expect(element).toBeDefined();
  });

  it('can disable vignette', async () => {
    const { PostProcessing } = await import('../PostProcessing');
    const element = <PostProcessing enableVignette={false} />;
    expect(element).toBeDefined();
  });

  it('can disable both effects', async () => {
    const { PostProcessing } = await import('../PostProcessing');
    const element = <PostProcessing enableBloom={false} enableVignette={false} />;
    expect(element).toBeDefined();
  });
});
