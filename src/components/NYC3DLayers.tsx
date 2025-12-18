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
    color: '#4a7c4e', // Muted green for parks
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffsetFactor: -3, // Parks slightly in front of roadbed
  },
  water: {
    color: '#4a6a7c', // Muted blue-gray for water
    roughness: 0.3,
    metalness: 0.1,
    side: THREE.DoubleSide,
    polygonOffsetFactor: -1, // Water behind roadbed
  },
  exteriorWater: {
    color: '#3a5a6c', // Slightly darker blue for deep water
    roughness: 0.2,
    metalness: 0.15,
  },
  land: {
    color: '#8a8a8a', // Light gray for land base
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffsetFactor: 1, // Push back in depth buffer to avoid z-fighting with parks
  },
  landmarks: {
    color: '#2d8a5f', // Patinated copper green (Statue of Liberty's actual color)
    roughness: 0.5,
    metalness: 0.3,
    side: THREE.DoubleSide,
    // No polygon offset needed - landmarks are above ground
  },
  infrastructure: {
    color: '#5a5a5a', // Medium gray for bridges (slightly lighter than roadbed)
    roughness: 0.85,
    metalness: 0.15, // Slight metalness for steel bridges
    side: THREE.DoubleSide,
    // No polygon offset - bridges are elevated above ground
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

  // Clone and apply material, removing vertex colors so material color is used
  const clonedScene = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        // Remove vertex colors so material color takes precedence
        if (mesh.geometry?.attributes.color) {
          mesh.geometry.deleteAttribute('color');
        }
        mesh.material = material;
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

/**
 * Infrastructure (bridges and tunnels) from NYC 3D Model.
 * Includes Brooklyn Bridge, Manhattan Bridge, etc.
 */
export function InfrastructureLayer() {
  return (
    <GLBLayer
      url="/assets/nyc3d/infrastructure.glb"
      config={LAYER_CONFIGS.infrastructure}
      name="infrastructure"
    />
  );
}

/**
 * Land layer from borough boundaries.
 * Covers Manhattan island, sits between water and roads.
 */
export function LandLayer() {
  return (
    <GLBLayer
      url="/assets/nyc3d/land.glb"
      config={LAYER_CONFIGS.land}
      name="land"
    />
  );
}

// =============================================================================
// Exterior Water Plane
// =============================================================================

/**
 * Bounds for the exterior water plane (in local coordinates).
 * Covers Hudson River, East River, and NY Harbor.
 */
const WATER_BOUNDS = {
  minX: -3000,  // West (into Hudson)
  maxX: 6000,   // East (into East River/Brooklyn)
  minZ: -8000,  // South (into harbor)
  maxZ: 2000,   // North
};

/**
 * ExteriorWaterPlane renders a large water surface for rivers and harbor.
 * Positioned below shoreline water (water.glb at Y=-1) to avoid z-fighting.
 */
export function ExteriorWaterPlane() {
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: LAYER_CONFIGS.exteriorWater.color,
      roughness: LAYER_CONFIGS.exteriorWater.roughness,
      metalness: LAYER_CONFIGS.exteriorWater.metalness,
      side: THREE.DoubleSide,
    });
  }, []);

  // Cleanup material on unmount
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // Calculate plane dimensions
  const width = WATER_BOUNDS.maxX - WATER_BOUNDS.minX;
  const depth = WATER_BOUNDS.maxZ - WATER_BOUNDS.minZ;
  const centerX = (WATER_BOUNDS.minX + WATER_BOUNDS.maxX) / 2;
  const centerZ = (WATER_BOUNDS.minZ + WATER_BOUNDS.maxZ) / 2;

  return (
    <mesh
      position={[centerX, -2, centerZ]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      name="exterior-water"
    >
      <planeGeometry args={[width, depth]} />
    </mesh>
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
      {/* Layer order (bottom to top):
          1. Exterior water (Y=-2) - base layer, covers all water areas
          2. Land (Y=-0.5) - Manhattan island on top of water
          3. Roadbed (Y=-0.15) - roads on top of land
          4. Parks, buildings, landmarks at Y≥0
      */}
      <ExteriorWaterPlane />
      <LandLayer />
      {/* Shoreline water disabled - land layer now covers island properly */}
      {/* <WaterLayer /> */}
      <RoadbedLayer />
      {/* RoadSurfacesLayer disabled - needs offset fix to align with buildings */}
      {/* <RoadSurfacesLayer /> */}
      {/* ParksLayer disabled - using Parks component with parks.json for full coverage */}
      {/* <ParksLayer /> */}
      <LandmarksLayer />
      <InfrastructureLayer />
    </>
  );
}
