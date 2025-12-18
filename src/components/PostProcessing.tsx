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
 * Subtle bloom for emissive surfaces only (subway lines, beacons).
 */
export const BLOOM_CONFIG = {
  /** Bloom intensity multiplier - subtle for realism */
  intensity: 0.3,
  /** Higher threshold - only very bright things bloom */
  luminanceThreshold: 0.8,
  /** Smoothness of the luminance threshold falloff */
  luminanceSmoothing: 0.4,
  /** Bloom radius in pixels - tighter for realism */
  radius: 0.4,
};

/**
 * Vignette effect configuration.
 * Very subtle edge darkening.
 */
export const VIGNETTE_CONFIG = {
  /** Distance from center where vignette starts (0-1) */
  offset: 0.5,
  /** Darkness intensity at edges - very subtle */
  darkness: 0.25,
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
