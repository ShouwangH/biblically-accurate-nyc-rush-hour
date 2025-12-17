/**
 * PostProcessing Component
 *
 * Adds post-processing effects to the scene:
 * - Bloom for emissive surfaces (subway lines, station beams)
 * - Vignette for cinematic look
 *
 * Uses @react-three/postprocessing for efficient GPU-based effects.
 */
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

// =============================================================================
// Configuration Constants
// =============================================================================

/**
 * Bloom effect configuration.
 * Targets emissive surfaces like subway lines and station beams.
 */
export const BLOOM_CONFIG = {
  /** Bloom intensity multiplier */
  intensity: 0.8,
  /** Luminance threshold - pixels brighter than this bloom */
  luminanceThreshold: 0.3,
  /** Smoothness of the luminance threshold falloff */
  luminanceSmoothing: 0.9,
  /** Bloom radius in pixels */
  radius: 0.8,
};

/**
 * Vignette effect configuration.
 * Subtle darkening at edges for cinematic look.
 */
export const VIGNETTE_CONFIG = {
  /** Distance from center where vignette starts (0-1) */
  offset: 0.3,
  /** Darkness intensity at edges (0-1) */
  darkness: 0.5,
};

// =============================================================================
// Component
// =============================================================================

interface PostProcessingProps {
  /** Enable bloom effect (default: true) */
  enableBloom?: boolean;
  /** Enable vignette effect (default: true) */
  enableVignette?: boolean;
  /** Override bloom intensity */
  bloomIntensity?: number;
}

/**
 * PostProcessing adds GPU-accelerated visual effects to the scene.
 *
 * Features:
 * - Bloom makes emissive surfaces glow
 * - Vignette adds cinematic edge darkening
 * - Both effects can be toggled independently
 *
 * Usage:
 * ```tsx
 * <Canvas>
 *   <Scene />
 *   <PostProcessing />
 * </Canvas>
 * ```
 */
export function PostProcessing({
  enableBloom = true,
  enableVignette = true,
  bloomIntensity,
}: PostProcessingProps) {
  // If both effects disabled, render nothing
  if (!enableBloom && !enableVignette) {
    return null;
  }

  // Build effects array to satisfy EffectComposer's strict children typing
  const effects: React.ReactElement[] = [];

  if (enableBloom) {
    effects.push(
      <Bloom
        key="bloom"
        intensity={bloomIntensity ?? BLOOM_CONFIG.intensity}
        luminanceThreshold={BLOOM_CONFIG.luminanceThreshold}
        luminanceSmoothing={BLOOM_CONFIG.luminanceSmoothing}
        radius={BLOOM_CONFIG.radius}
        blendFunction={BlendFunction.ADD}
      />
    );
  }

  if (enableVignette) {
    effects.push(
      <Vignette
        key="vignette"
        offset={VIGNETTE_CONFIG.offset}
        darkness={VIGNETTE_CONFIG.darkness}
        blendFunction={BlendFunction.NORMAL}
      />
    );
  }

  return <EffectComposer>{effects}</EffectComposer>;
}
