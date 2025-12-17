/**
 * NYC 3D Model Layers
 *
 * Components for rendering NYC DCP 3D Model assets.
 * Only rendered when ASSET_SOURCE === 'nyc3d'.
 *
 * Per CLAUDE.md: isolated from legacy assets, feature flag controls loading.
 */
import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ASSET_SOURCE, getAssetUrls } from '../hooks/useDataLoader';

// =============================================================================
// Shared Material Factory
// =============================================================================

interface MaterialConfig {
  color: string;
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  /** Polygon offset factor to prevent z-fighting (negative = closer to camera) */
  polygonOffsetFactor?: number;
}

function createMaterial(config: MaterialConfig): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: config.color,
    roughness: config.roughness ?? 0.8,
    metalness: config.metalness ?? 0.1,
    side: config.side ?? THREE.FrontSide,
    transparent: config.transparent ?? false,
    opacity: config.opacity ?? 1.0,
  });

  // Enable polygon offset to prevent z-fighting with ground plane
  if (config.polygonOffsetFactor !== undefined) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = config.polygonOffsetFactor;
    material.polygonOffsetUnits = -1;
  }

  return material;
}

// =============================================================================
// Layer Configurations
// =============================================================================

const LAYER_CONFIGS = {
  roadbed: {
    color: '#4a4a4a', // Medium gray asphalt (lighter than before)
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide, // Prevent black backfaces
    polygonOffsetFactor: -2, // Push towards camera to avoid z-fighting
  },
  roadSurfaces: {
    color: '#3d3d3d', // Slightly darker than roadbed to distinguish
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffsetFactor: -1, // Behind roadbed (fills gaps)
  },
  parks: {
    color: '#5a8a5e', // Lighter green for visibility
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffsetFactor: -3, // Parks slightly in front of roadbed
  },
  water: {
    color: '#3a7a9a', // Lighter blue for visibility
    roughness: 0.3,
    metalness: 0.1,
    side: THREE.DoubleSide,
    polygonOffsetFactor: -1, // Water behind roadbed
  },
  landmarks: {
    color: '#2d8a5f', // Patinated copper green (Statue of Liberty's actual color)
    roughness: 0.5,
    metalness: 0.3,
    side: THREE.DoubleSide,
    // No polygon offset needed - landmarks are above ground
  },
} as const;

// =============================================================================
// Generic GLB Layer Component
// =============================================================================

interface GLBLayerProps {
  url: string | null;
  config: MaterialConfig;
  name: string;
}

function GLBLayer({ url, config, name }: GLBLayerProps) {
  // Don't render if no URL (legacy mode)
  if (!url) return null;

  // Load the model
  const { scene } = useGLTF(url);

  // Create material
  const material = useMemo(() => createMaterial(config), [config]);

  // Clone and apply material
  const clonedScene = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).material = material;
      }
    });
    return clone;
  }, [scene, material]);

  // Cleanup
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return <primitive object={clonedScene} name={name} />;
}

// =============================================================================
// Exported Layer Components
// =============================================================================

/**
 * Road surfaces from NYC 3D Model.
 * Fixes "floating cars" issue by providing actual road geometry.
 */
export function RoadbedLayer() {
  const urls = getAssetUrls();
  return <GLBLayer url={urls.roadbed} config={LAYER_CONFIGS.roadbed} name="roadbed" />;
}

/**
 * Parks and open spaces from NYC 3D Model.
 */
export function ParksLayer() {
  const urls = getAssetUrls();
  return <GLBLayer url={urls.parks} config={LAYER_CONFIGS.parks} name="parks" />;
}

/**
 * Water bodies (Hudson River, East River) from NYC 3D Model.
 */
export function WaterLayer() {
  const urls = getAssetUrls();
  return <GLBLayer url={urls.water} config={LAYER_CONFIGS.water} name="water" />;
}

/**
 * Landmarks (Statue of Liberty) from NYC 3D Model.
 */
export function LandmarksLayer() {
  const urls = getAssetUrls();
  return <GLBLayer url={urls.landmarks} config={LAYER_CONFIGS.landmarks} name="landmarks" />;
}

/**
 * Road surfaces generated from LION road network centerlines.
 * Fills gaps in NYC 3D Model roadbed data, especially at intersections.
 */
export function RoadSurfacesLayer() {
  return (
    <GLBLayer
      url="/assets/nyc3d/road_surfaces.glb"
      config={LAYER_CONFIGS.roadSurfaces}
      name="road-surfaces"
    />
  );
}

// =============================================================================
// Wrapper Component
// =============================================================================

/**
 * NYC3DLayers renders all NYC 3D Model layers when enabled.
 *
 * Only renders when ASSET_SOURCE === 'nyc3d'.
 * Includes: roadbed, parks, water, landmarks + fallback ground.
 * Buildings are handled separately by Buildings component.
 */
export function NYC3DLayers() {
  // Don't render in legacy mode
  if (ASSET_SOURCE !== 'nyc3d') {
    return null;
  }

  return (
    <>
      {/* RoadSurfacesLayer disabled - needs offset fix to align with buildings */}
      {/* <RoadSurfacesLayer /> */}
      <RoadbedLayer />
      <ParksLayer />
      <WaterLayer />
      <LandmarksLayer />
    </>
  );
}
