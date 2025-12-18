/**
 * Buildings Component
 *
 * Loads and renders 3D building geometry from a glTF file.
 * Applies a uniform material to all meshes for consistent visual style.
 *
 * Per CLAUDE.md §8.6: material is applied once on load, not per-frame.
 */
import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// =============================================================================
// Constants
// =============================================================================

/** Building color - light gray for projector visibility */
export const BUILDING_COLOR = '#D0D0D0';

/** Material properties for buildings */
export const BUILDING_MATERIAL_PROPS = {
  color: BUILDING_COLOR,
  roughness: 0.8,
  metalness: 0.1,
  flatShading: true, // Enable flat shading to show edges
} as const;

/** Default path to building model */
const DEFAULT_BUILDING_URL = '/assets/buildings.glb';

// =============================================================================
// Component
// =============================================================================

interface BuildingsProps {
  /** URL to glTF building model */
  url?: string;
}

/**
 * Buildings renders 3D building geometry from a glTF file.
 *
 * Features:
 * - Loads glTF model via useGLTF (drei)
 * - Applies uniform material to all meshes
 * - Material applied once on load (not per-frame)
 *
 * Usage:
 * ```tsx
 * <Scene>
 *   <Buildings />
 *   {/* or with custom model *\/}
 *   <Buildings url="/assets/custom-buildings.glb" />
 * </Scene>
 * ```
 */
export function Buildings({ url = DEFAULT_BUILDING_URL }: BuildingsProps) {
  const { scene } = useGLTF(url);

  // Create a shared material instance (not per-frame)
  const buildingMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: BUILDING_MATERIAL_PROPS.color,
        roughness: BUILDING_MATERIAL_PROPS.roughness,
        metalness: BUILDING_MATERIAL_PROPS.metalness,
        flatShading: BUILDING_MATERIAL_PROPS.flatShading,
        // Render both sides to ensure buildings look solid from any angle
        side: THREE.DoubleSide,
      }),
    []
  );

  // Clone scene and apply materials once on load
  const clonedScene = useMemo(() => {
    const clone = scene.clone();

    // Apply uniform material to all meshes
    // Note: We don't dispose the original materials here as they may be
    // shared from drei's GLTF cache. Let drei/three handle their lifecycle.
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.material = buildingMaterial;

        // Recompute normals for flat shading
        // This ensures each face has its own normal for crisp edges
        if (mesh.geometry) {
          mesh.geometry.computeVertexNormals();
        }
      }
    });

    return clone;
  }, [scene, buildingMaterial]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      buildingMaterial.dispose();
    };
  }, [buildingMaterial]);

  return <primitive object={clonedScene} />;
}

// Preload hint for useGLTF
Buildings.preload = (url: string = DEFAULT_BUILDING_URL) => {
  useGLTF.preload(url);
};
