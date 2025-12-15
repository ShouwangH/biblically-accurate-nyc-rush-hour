#!/usr/bin/env python3
"""
Blender script to process NYC building OBJ and export as glTF.

This script:
1. Imports the OBJ file with building geometry
2. Joins all objects into a single mesh
3. Applies Decimate modifier to reduce triangle count
4. Exports as Draco-compressed glTF binary (.glb)

Usage:
    blender --background --python scripts/blender_process_buildings.py

Or run interactively in Blender's scripting tab.

Prerequisites:
- Blender 3.0+ (for Draco compression support)
- Input OBJ at /tmp/buildings_export/buildings_lower_manhattan.obj
"""

import bpy
import os
from pathlib import Path

# =============================================================================
# Configuration
# =============================================================================

INPUT_OBJ = Path('/tmp/buildings_export/buildings_lower_manhattan.obj')
OUTPUT_GLB = Path('/Users/shouwang/Documents/Fractal/atlas/public/assets/buildings.glb')

# Target triangle count (300-400k as per spec, 500k max)
# Increased to preserve building quality after tightening bbox
TARGET_TRIANGLES = 500_000
MAX_TRIANGLES = 600_000

# Use planar decimation to better preserve building faces
USE_PLANAR_DECIMATION = False  # Disabled - test raw quality first
PLANAR_ANGLE_LIMIT = 5.0  # degrees - faces within this angle are considered coplanar

# Skip decimation entirely - rely on Draco compression only
SKIP_DECIMATION = True

# =============================================================================
# Helper Functions
# =============================================================================

def clear_scene():
    """Remove all objects from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()


def get_triangle_count() -> int:
    """Get total triangle count of selected objects."""
    count = 0
    for obj in bpy.context.selected_objects:
        if obj.type == 'MESH':
            # Triangulate temporarily to get accurate count
            bm = obj.data
            count += sum(len(p.vertices) - 2 for p in bm.polygons)
    return count


def import_obj(filepath: Path):
    """Import OBJ file."""
    print(f"Importing {filepath}...")
    bpy.ops.wm.obj_import(filepath=str(filepath))
    print(f"Imported {len(bpy.context.selected_objects)} objects")


def join_all_meshes():
    """Join all mesh objects into one."""
    print("Joining all meshes...")

    # Select all mesh objects
    bpy.ops.object.select_all(action='DESELECT')
    mesh_objects = [obj for obj in bpy.data.objects if obj.type == 'MESH']

    if not mesh_objects:
        print("No mesh objects found!")
        return None

    # Set first mesh as active and select all
    bpy.context.view_layer.objects.active = mesh_objects[0]
    for obj in mesh_objects:
        obj.select_set(True)

    # Join
    bpy.ops.object.join()

    result = bpy.context.active_object
    result.name = "Buildings_LowerManhattan"
    print(f"Joined into single mesh: {result.name}")
    return result


def apply_decimate(obj, target_ratio: float):
    """Apply decimate modifier to reduce polygon count."""
    print(f"Applying decimate with ratio {target_ratio:.4f}...")

    # Add decimate modifier
    modifier = obj.modifiers.new(name="Decimate", type='DECIMATE')

    if USE_PLANAR_DECIMATION:
        # Planar decimation preserves building faces better
        # It merges coplanar faces while preserving edges
        modifier.decimate_type = 'DISSOLVE'
        modifier.angle_limit = PLANAR_ANGLE_LIMIT * (3.14159 / 180)  # Convert to radians
        print(f"Using planar decimation with angle limit {PLANAR_ANGLE_LIMIT}°")
    else:
        # Collapse decimation - faster but destroys building faces
        modifier.decimate_type = 'COLLAPSE'
        modifier.ratio = target_ratio

    # Apply modifier
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="Decimate")

    # Get new face count
    face_count = len(obj.data.polygons)
    print(f"After decimation: {face_count:,} faces")

    # If still above target after planar, apply collapse
    if face_count > TARGET_TRIANGLES and USE_PLANAR_DECIMATION:
        print(f"Applying additional collapse decimation...")
        collapse_ratio = TARGET_TRIANGLES / face_count
        modifier2 = obj.modifiers.new(name="Decimate2", type='DECIMATE')
        modifier2.decimate_type = 'COLLAPSE'
        modifier2.ratio = collapse_ratio
        bpy.ops.object.modifier_apply(modifier="Decimate2")
        face_count = len(obj.data.polygons)
        print(f"After collapse: {face_count:,} faces")

    return face_count


def calculate_decimate_ratio(current_faces: int, target_faces: int) -> float:
    """Calculate decimate ratio to achieve target face count."""
    return min(target_faces / current_faces, 1.0)


def export_gltf(obj, filepath: Path):
    """Export as Draco-compressed glTF binary."""
    print(f"Exporting to {filepath}...")

    # Ensure output directory exists
    filepath.parent.mkdir(parents=True, exist_ok=True)

    # Select only our mesh
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)

    # Export with Draco compression
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )

    # Check file size
    size_mb = filepath.stat().st_size / (1024 * 1024)
    print(f"Exported: {filepath}")
    print(f"File size: {size_mb:.2f} MB")


# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("NYC Buildings Blender Processing")
    print("=" * 60)
    print()

    # Check input exists
    if not INPUT_OBJ.exists():
        print(f"Error: Input file not found: {INPUT_OBJ}")
        print("Run process_buildings.py first to generate the OBJ file.")
        return

    # Clear scene
    clear_scene()

    # Import OBJ
    import_obj(INPUT_OBJ)

    # Join all meshes
    building_mesh = join_all_meshes()
    if not building_mesh:
        return

    # Get current face count
    initial_faces = len(building_mesh.data.polygons)
    print(f"Initial face count: {initial_faces:,}")

    # Calculate and apply decimation (or skip)
    if SKIP_DECIMATION:
        print("Skipping decimation - using raw geometry with Draco compression only")
        final_faces = initial_faces
    elif initial_faces > TARGET_TRIANGLES:
        ratio = calculate_decimate_ratio(initial_faces, TARGET_TRIANGLES)
        final_faces = apply_decimate(building_mesh, ratio)

        # Check if we're within limits
        if final_faces > MAX_TRIANGLES:
            print(f"Warning: {final_faces:,} faces exceeds max {MAX_TRIANGLES:,}")
            print("Consider running with a lower target ratio.")
    else:
        print(f"Face count already below target ({TARGET_TRIANGLES:,})")
        final_faces = initial_faces

    print()

    # Export glTF
    export_gltf(building_mesh, OUTPUT_GLB)

    print()
    print("=" * 60)
    print("Processing complete!")
    print("=" * 60)
    print(f"""
Summary:
- Input faces: {initial_faces:,}
- Output faces: {final_faces:,}
- Reduction: {(1 - final_faces/initial_faces) * 100:.1f}%
- Output: {OUTPUT_GLB}

The glTF file can now be loaded in the application with:
  const gltf = useGLTF('/assets/buildings.glb');
""")


if __name__ == '__main__':
    main()
