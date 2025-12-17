#!/usr/bin/env python3
"""
Apply Height-Based Vertex Colors to Buildings

Adds subtle greyscale gradient based on vertex height to building meshes.
The gradient uses a parabolic curve: darker at ground level and top,
lighter in the middle, creating subtle depth variation.

Gradient design:
    Height      Lightness    Hex        Effect
    0m          0.745        #BEBEBE    Base slightly darker
    50m         0.820        #D1D1D1    Mid-low lighter
    100m        0.845        #D7D7D7    Mid-height lightest
    150m        0.820        #D1D1D1    Mid-high lighter
    200m+       0.745        #BEBEBE    Tall tops slightly darker

Usage:
    blender --background --python scripts/apply_vertex_colors.py -- \\
        --input public/assets/buildings.glb \\
        --output public/assets/buildings_colored.glb

    Or with default paths:
    blender --background --python scripts/apply_vertex_colors.py

Requirements:
    - Blender 3.0+ (for GLB export with vertex colors)
    - Input GLB file with building meshes

Notes:
    - Blender uses Z-up coordinate system
    - The gradient is applied based on world Z coordinate (height)
    - Max height is capped at 200m for gradient calculation
    - Output includes vertex colors in the GLB export
"""

import bpy
import sys
import os
from pathlib import Path

# =============================================================================
# Configuration
# =============================================================================

# Default paths (relative to script location)
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent

DEFAULT_INPUT = PROJECT_ROOT / "public" / "assets" / "buildings.glb"
DEFAULT_OUTPUT = PROJECT_ROOT / "public" / "assets" / "buildings_colored.glb"

# Gradient parameters
MAX_HEIGHT = 200.0  # Cap height at 200m for gradient calculation
BASE_LIGHTNESS = 0.745  # Lightness at ground (0m) and max height (200m+)
LIGHTNESS_RANGE = 0.10  # Additional lightness at peak (100m)


# =============================================================================
# Height Gradient Algorithm
# =============================================================================

def calculate_lightness(height: float) -> float:
    """
    Calculate lightness value based on height using parabolic curve.

    The curve creates:
    - Darker at ground level (0m): 0.745
    - Lightest at mid-height (100m): 0.845
    - Darker again at top (200m+): 0.745

    Args:
        height: Vertex height in meters (Z coordinate in Blender)

    Returns:
        Lightness value in range [0.745, 0.845]
    """
    # Normalize height to [0, 1] range, capped at MAX_HEIGHT
    t = min(max(height, 0.0) / MAX_HEIGHT, 1.0)

    # Parabolic curve: 1 - (2t - 1)^2
    # At t=0: 1 - (-1)^2 = 0
    # At t=0.5: 1 - 0^2 = 1
    # At t=1: 1 - 1^2 = 0
    parabola = 1.0 - (2.0 * t - 1.0) ** 2

    lightness = BASE_LIGHTNESS + LIGHTNESS_RANGE * parabola
    return lightness


# =============================================================================
# Vertex Color Application
# =============================================================================

def apply_height_gradient(obj: bpy.types.Object) -> int:
    """
    Apply height-based vertex colors to a mesh object.

    Args:
        obj: Blender mesh object

    Returns:
        Number of vertices processed
    """
    if obj.type != 'MESH':
        return 0

    mesh = obj.data

    # Ensure we have vertex colors attribute
    # Blender 3.2+ uses color_attributes, older versions use vertex_colors
    if hasattr(mesh, 'color_attributes'):
        # Blender 3.2+
        if 'Col' not in mesh.color_attributes:
            mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
        color_attr = mesh.color_attributes['Col']
    else:
        # Older Blender versions
        if not mesh.vertex_colors:
            mesh.vertex_colors.new(name='Col')
        color_attr = mesh.vertex_colors['Col']

    # Get world matrix for accurate height calculation
    world_matrix = obj.matrix_world

    vertex_count = 0

    # Apply colors per loop (corner)
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert_idx = mesh.loops[loop_idx].vertex_index
            vert = mesh.vertices[vert_idx]

            # Transform vertex to world coordinates
            world_pos = world_matrix @ vert.co

            # Height is Z in Blender's Z-up coordinate system
            height = world_pos.z

            # Calculate lightness based on height
            lightness = calculate_lightness(height)

            # Set vertex color (greyscale, full alpha)
            color_attr.data[loop_idx].color = (
                lightness, lightness, lightness, 1.0
            )

            vertex_count += 1

    mesh.update()
    return vertex_count


def process_scene() -> dict:
    """
    Apply height gradient to all mesh objects in the scene.

    Returns:
        Statistics dictionary with processing results
    """
    stats = {
        'meshes_processed': 0,
        'vertices_processed': 0,
        'meshes_skipped': 0,
    }

    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            vert_count = apply_height_gradient(obj)
            if vert_count > 0:
                stats['meshes_processed'] += 1
                stats['vertices_processed'] += vert_count
                print(f"  Processed: {obj.name} ({vert_count} vertices)")
            else:
                stats['meshes_skipped'] += 1
        else:
            stats['meshes_skipped'] += 1

    return stats


# =============================================================================
# Import/Export
# =============================================================================

def import_glb(filepath: Path) -> bool:
    """
    Import a GLB file into Blender.

    Args:
        filepath: Path to input GLB file

    Returns:
        True if successful, False otherwise
    """
    if not filepath.exists():
        print(f"Error: Input file not found: {filepath}")
        return False

    # Clear existing scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import GLB
    bpy.ops.import_scene.gltf(filepath=str(filepath))
    print(f"Imported: {filepath}")

    return True


def export_glb(filepath: Path) -> bool:
    """
    Export the scene to a GLB file with vertex colors.

    Args:
        filepath: Path to output GLB file

    Returns:
        True if successful, False otherwise
    """
    # Ensure output directory exists
    filepath.parent.mkdir(parents=True, exist_ok=True)

    # Export with vertex colors enabled
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format='GLB',
        export_colors=True,
        export_apply=True,  # Apply modifiers
    )

    print(f"Exported: {filepath}")
    return True


# =============================================================================
# CLI Argument Parsing
# =============================================================================

def parse_args() -> tuple:
    """
    Parse command line arguments passed after '--'.

    Returns:
        Tuple of (input_path, output_path)
    """
    # Find '--' separator in sys.argv
    try:
        separator_idx = sys.argv.index('--')
        args = sys.argv[separator_idx + 1:]
    except ValueError:
        # No '--' found, use defaults
        return DEFAULT_INPUT, DEFAULT_OUTPUT

    input_path = DEFAULT_INPUT
    output_path = DEFAULT_OUTPUT

    # Simple argument parsing
    i = 0
    while i < len(args):
        if args[i] == '--input' and i + 1 < len(args):
            input_path = Path(args[i + 1])
            i += 2
        elif args[i] == '--output' and i + 1 < len(args):
            output_path = Path(args[i + 1])
            i += 2
        elif args[i] == '--help':
            print(__doc__)
            sys.exit(0)
        else:
            i += 1

    return input_path, output_path


# =============================================================================
# Main
# =============================================================================

def main() -> int:
    """
    Main entry point.

    Returns:
        Exit code (0 for success, 1 for error)
    """
    print("=" * 60)
    print("BUILDING VERTEX COLOR PROCESSOR")
    print("=" * 60)

    # Parse arguments
    input_path, output_path = parse_args()

    print(f"\nInput:  {input_path}")
    print(f"Output: {output_path}")
    print(f"\nGradient parameters:")
    print(f"  Max height: {MAX_HEIGHT}m")
    print(f"  Base lightness: {BASE_LIGHTNESS}")
    print(f"  Peak lightness: {BASE_LIGHTNESS + LIGHTNESS_RANGE}")

    # Import
    print("\n" + "-" * 60)
    print("Importing GLB...")
    if not import_glb(input_path):
        return 1

    # Process
    print("\n" + "-" * 60)
    print("Applying height gradient...")
    stats = process_scene()

    print(f"\nProcessing complete:")
    print(f"  Meshes processed: {stats['meshes_processed']}")
    print(f"  Vertices processed: {stats['vertices_processed']}")
    print(f"  Objects skipped: {stats['meshes_skipped']}")

    # Export
    print("\n" + "-" * 60)
    print("Exporting GLB...")
    if not export_glb(output_path):
        return 1

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
