#!/usr/bin/env python3
"""
Export NYC 3D Model layers to glTF for web visualization.

Reads .3dm files from data/nyc_3d_model/ and exports selected layers
to public/assets/nyc3d/ as Draco-compressed glTF files.

Usage:
    python scripts/export-nyc3d.py [--version v1|v2] [--dry-run]

Requires:
    pip install rhino3dm trimesh numpy

Per CLAUDE.md:
- Isolated from current assets (outputs to nyc3d/ subdirectory)
- Feature flag controls whether new assets are used
- Graceful fallback to legacy assets if loading fails
"""

import argparse
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Dict, List, Set, Tuple, Any
from dataclasses import dataclass, field
import time

# =============================================================================
# Configuration
# =============================================================================

# Layer name mappings (NYC 3D Model uses inconsistent naming across CDs)
# NOTE: Use "Surface" layers for 3D geometry (Brep), non-Surface are just polylines
LAYER_ALIASES = {
    # Buildings - use Surface layers (have Brep geometry)
    'Facade Surface': 'buildings',
    'RoofTop Surface': 'buildings',
    # Roadbed - polylines only, will be converted to flat surfaces
    'Roadbed': 'roadbed',
    # Water - polylines only, will be converted to flat surfaces
    'Water': 'water',
    'Shoreline': 'water',
    # Parks - polylines only, will be converted to flat surfaces
    'Park': 'parks',
    'Parks': 'parks',
    'Open Space': 'parks',
    # Infrastructure
    'Bridges & Tunnels': 'infrastructure',
    'Bridge_Tunnel_Overpass': 'infrastructure',
    # Landmarks - mixed Brep and polylines
    'Statue_of_Liberty': 'landmarks',
    # V2 layers
    'Sidewalk': 'sidewalks',
    'Sidewalks': 'sidewalks',
    'Subway Entrances': 'subway_entrances',
    'Rail Line': 'rail',
}

# Export versions - which categories to include
# NOTE: Sidewalks are NOT exported - they're implied via texture tricks:
#   - Curb band (casing) on roadbeds
#   - Building plinth (ring around footprints)
#   - Intersection pads
EXPORT_VERSIONS = {
    'v1': {'buildings', 'roadbed', 'water', 'parks', 'infrastructure', 'landmarks'},
    'v2': {'buildings', 'roadbed', 'water', 'parks', 'infrastructure', 'landmarks',
           'subway_entrances', 'rail'},  # No sidewalks - implied via texture
}

# Triangle budget per category (for decimation)
# NOTE: Buildings decimation causes open faces - keep original geometry
TRIANGLE_BUDGETS = {
    'buildings': 2_000_000,   # Keep original to avoid open faces from decimation
    'roadbed': 200_000,       # Increased budget for better quality
    'water': 50_000,
    'parks': 200_000,         # Increased budget for better quality
    'infrastructure': 50_000,
    'landmarks': 100_000,     # Increased for complex geometry like Statue of Liberty
    'sidewalks': 50_000,
    'subway_entrances': 10_000,
    'rail': 20_000,
}

# Sample density for Brep surface fallback (when no pre-computed mesh)
# Higher = more triangles for curved surfaces, 2 = minimum (4 corners only)
SAMPLE_DENSITY = {
    'buildings': 2,        # Buildings have pre-computed meshes
    'landmarks': 12,       # High for curved geometry like Statue of Liberty
    'infrastructure': 4,   # Medium for bridges
    'default': 2,          # Minimum for flat surfaces
}

# Coordinate system: convert from NYC State Plane (feet) to local meters
# Origin: Battery Park (40.7033° N, -74.0170° W)
ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.0170

# NYC State Plane Long Island (EPSG:2263) approximate conversion
# These are rough values - actual conversion would need pyproj
STATE_PLANE_ORIGIN_X = 980000  # feet (approximate X at Battery Park)
STATE_PLANE_ORIGIN_Y = 196000  # feet (approximate Y at Battery Park)
FEET_TO_METERS = 0.3048
MM_TO_FEET = 0.00328084  # For files stored in mm (like MN06)

# Coordinate unit detection thresholds
# If X > 100,000,000, assume millimeters (MN06 uses ~300M mm values)
MM_THRESHOLD = 100_000_000


@dataclass
class ExportStats:
    """Track export statistics."""
    objects_processed: int = 0
    vertices_total: int = 0
    faces_total: int = 0
    layers_found: Dict[str, int] = field(default_factory=dict)
    files_exported: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


# =============================================================================
# Rhino Geometry Extraction
# =============================================================================

def extract_3dm_files(data_dir: Path) -> List[Path]:
    """Find and extract all .3dm files from zip archives."""
    extracted = []

    for zip_path in sorted(data_dir.glob('*.zip')):
        print(f"  Extracting {zip_path.name}...")
        extract_dir = Path('/tmp') / zip_path.stem.upper()
        extract_dir.mkdir(exist_ok=True)

        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(extract_dir)

        for dm_file in extract_dir.glob('*.3dm'):
            extracted.append(dm_file)

    return extracted


def get_layer_category(layer_name: str, target_categories: Set[str]) -> str | None:
    """Map layer name to export category, or None if not in target."""
    category = LAYER_ALIASES.get(layer_name)
    if category and category in target_categories:
        return category
    return None


def extract_mesh_from_brep(brep, transform_func, rhino3dm, sample_density: int = 2) -> Tuple[List, List] | None:
    """Extract mesh vertices and faces from a Brep object.

    First tries to get pre-computed render mesh. If not available (like MN06),
    falls back to sampling the surface to create a mesh grid.

    Args:
        brep: Rhino Brep object
        transform_func: Coordinate transformation function
        rhino3dm: The rhino3dm module
        sample_density: Grid density for surface sampling (default 2 = 4 corners only,
                       use 8-16 for curved geometry like landmarks)
    """
    try:
        # Get faces from Brep
        brep_faces = brep.Faces
        if not brep_faces or len(brep_faces) == 0:
            return None

        all_vertices = []
        all_faces = []
        vertex_offset = 0

        for i in range(len(brep_faces)):
            brep_face = brep_faces[i]

            # Try to get pre-computed mesh first
            mesh = brep_face.GetMesh(rhino3dm.MeshType.Any)

            if mesh is not None:
                # Extract vertices from pre-computed mesh
                for j in range(len(mesh.Vertices)):
                    v = mesh.Vertices[j]
                    x, y, z = transform_func(v.X, v.Y, v.Z)
                    all_vertices.append([x, y, z])

                # Extract faces
                for j in range(len(mesh.Faces)):
                    mf = mesh.Faces[j]
                    if mf[3] == mf[2]:  # Triangle
                        all_faces.append([
                            mf[0] + vertex_offset,
                            mf[1] + vertex_offset,
                            mf[2] + vertex_offset
                        ])
                    else:  # Quad - split into two triangles
                        all_faces.append([
                            mf[0] + vertex_offset,
                            mf[1] + vertex_offset,
                            mf[2] + vertex_offset
                        ])
                        all_faces.append([
                            mf[0] + vertex_offset,
                            mf[2] + vertex_offset,
                            mf[3] + vertex_offset
                        ])

                vertex_offset += len(mesh.Vertices)
            else:
                # No pre-computed mesh - sample the underlying surface with a grid
                surface = brep_face.UnderlyingSurface()
                if surface is None:
                    continue

                try:
                    u_domain = surface.Domain(0)
                    v_domain = surface.Domain(1)

                    # Sample surface in a grid pattern
                    # sample_density determines grid resolution (2=2x2=4 pts, 8=8x8=64 pts)
                    n = sample_density
                    grid_verts = []

                    for vi in range(n):
                        for ui in range(n):
                            # Use slightly inset fractions to avoid edge issues
                            u_frac = 0.01 + 0.98 * ui / (n - 1) if n > 1 else 0.5
                            v_frac = 0.01 + 0.98 * vi / (n - 1) if n > 1 else 0.5

                            u = u_domain.T0 + u_frac * (u_domain.T1 - u_domain.T0)
                            v = v_domain.T0 + v_frac * (v_domain.T1 - v_domain.T0)
                            pt = surface.PointAt(u, v)
                            x, y, z = transform_func(pt.X, pt.Y, pt.Z)
                            grid_verts.append([x, y, z])

                    all_vertices.extend(grid_verts)

                    # Create triangles from grid (quads split into 2 triangles each)
                    for vi in range(n - 1):
                        for ui in range(n - 1):
                            # Indices in the grid
                            idx00 = vertex_offset + vi * n + ui
                            idx10 = vertex_offset + vi * n + (ui + 1)
                            idx01 = vertex_offset + (vi + 1) * n + ui
                            idx11 = vertex_offset + (vi + 1) * n + (ui + 1)

                            # Two triangles per quad
                            all_faces.append([idx00, idx10, idx11])
                            all_faces.append([idx00, idx11, idx01])

                    vertex_offset += len(grid_verts)

                except Exception:
                    continue

        if all_vertices and all_faces:
            return all_vertices, all_faces
        return None
    except Exception as e:
        return None


def extract_mesh_from_mesh(mesh_obj, transform_func) -> Tuple[List, List] | None:
    """Extract vertices and faces from a Mesh object."""
    try:
        vertices = []
        faces = []

        for i in range(len(mesh_obj.Vertices)):
            v = mesh_obj.Vertices[i]
            x, y, z = transform_func(v.X, v.Y, v.Z)
            vertices.append([x, y, z])

        for i in range(len(mesh_obj.Faces)):
            face = mesh_obj.Faces[i]
            if face[3] == face[2]:  # Triangle
                faces.append([face[0], face[1], face[2]])
            else:  # Quad
                faces.append([face[0], face[1], face[2]])
                faces.append([face[0], face[2], face[3]])

        if vertices and faces:
            return vertices, faces
        return None
    except Exception as e:
        return None


def extract_mesh_from_extrusion(extrusion, transform_func, rhino3dm) -> Tuple[List, List] | None:
    """Extract mesh from an Extrusion object."""
    try:
        mesh = extrusion.GetMesh(rhino3dm.MeshType.Any)
        if mesh is None:
            return None
        return extract_mesh_from_mesh(mesh, transform_func)
    except Exception as e:
        return None


def extract_polygon_from_polyline(polyline_curve, transform_func) -> list | None:
    """Extract 2D polygon coordinates from a polyline (for later union).

    Returns list of [x, z] coordinates (in local meters) or None if invalid.
    """
    try:
        polyline = polyline_curve.TryGetPolyline()
        if polyline is None or len(polyline) < 3:
            return None

        coords = []
        for i in range(len(polyline) - 1):
            pt = polyline[i]
            x, y, z = transform_func(pt.X, pt.Y, pt.Z)
            coords.append([x, z])  # Use x, z for 2D polygon

        if len(coords) < 3:
            return None
        return coords
    except Exception:
        return None


def extract_flat_surface_from_polyline(polyline_curve, transform_func, y_level: float = 0.0) -> Tuple[List, List] | None:
    """Convert a closed polyline to a flat triangulated surface.

    Used for roadbed, water, parks which are stored as 2D polylines in the 3D model.
    Uses earcut triangulation for proper handling of concave polygons.
    """
    try:
        import numpy as np

        # Get polyline points
        polyline = polyline_curve.TryGetPolyline()
        if polyline is None or len(polyline) < 3:
            return None

        # Extract points and transform
        points_2d = []
        points_3d = []
        for i in range(len(polyline) - 1):  # Skip last point if closed (duplicate)
            pt = polyline[i]
            x, y, z = transform_func(pt.X, pt.Y, pt.Z)
            points_2d.append([x, z])  # Use x, z for triangulation (flat on ground)
            points_3d.append([x, y_level, z])  # Set y to ground level

        if len(points_3d) < 3:
            return None

        # Use earcut triangulation for robust handling of concave polygons
        try:
            import mapbox_earcut as earcut
            from shapely.geometry import Polygon as ShapelyPolygon

            # Create shapely polygon to validate and clean
            poly = ShapelyPolygon(points_2d)
            if not poly.is_valid:
                poly = poly.buffer(0)  # Fix self-intersections
            if poly.is_empty or poly.area < 0.1:  # Skip tiny polygons
                return None

            # Get the exterior ring coordinates
            coords = list(poly.exterior.coords)[:-1]  # Remove duplicate last point
            if len(coords) < 3:
                return None

            # Prepare 2D array for earcut (shape: N x 2)
            coords_array = np.array(coords, dtype=np.float64)

            # Triangulate with earcut
            # Note: ring_end_indices must point to end of each ring
            ring_end = np.array([len(coords)], dtype=np.uint32)
            indices = earcut.triangulate_float64(coords_array, ring_end)

            if len(indices) == 0:
                # Fallback to fan triangulation
                n = len(coords)
                faces = [[0, i, i + 1] for i in range(1, n - 1)]
                points_3d = [[x, y_level, z] for x, z in coords]
                return points_3d, faces

            # Convert indices to faces
            faces = []
            for i in range(0, len(indices), 3):
                faces.append([int(indices[i]), int(indices[i+1]), int(indices[i+2])])

            # Convert to 3D vertices at y_level
            points_3d = [[x, y_level, z] for x, z in coords]
            return points_3d, faces

        except Exception as ex:
            # Fallback to simple fan triangulation
            n = len(points_3d)
            faces = [[0, i, i + 1] for i in range(1, n - 1)]
            return points_3d, faces

    except Exception as e:
        return None


def transform_coords(x: float, y: float, z: float) -> Tuple[float, float, float]:
    """Transform from NYC State Plane to local coordinate system (meters).

    Handles both feet (MN01-MN05) and millimeters (MN06) input units.
    """
    # Detect unit system: if X > 100M, assume millimeters
    if x > MM_THRESHOLD:
        # Convert from mm to feet first
        x = x * MM_TO_FEET
        y = y * MM_TO_FEET
        z = z * MM_TO_FEET

    # Convert from State Plane feet to local meters
    local_x = (x - STATE_PLANE_ORIGIN_X) * FEET_TO_METERS
    local_z = -(y - STATE_PLANE_ORIGIN_Y) * FEET_TO_METERS  # Flip Y to Z, negate for north
    local_y = z * FEET_TO_METERS  # Z becomes Y (up)

    return local_x, local_y, local_z


# =============================================================================
# Main Export Logic
# =============================================================================

# Categories that should be flat surfaces (polylines -> flat mesh)
FLAT_CATEGORIES = {'roadbed', 'water', 'parks'}

# Categories that should use polygon union (merges overlapping shapes)
# NOTE: Roadbed removed - union destroys street boundaries/curbs
UNION_CATEGORIES = {'parks'}  # Only parks benefit from union

# Y-levels for flat surfaces (meters)
# Buildings sit at Y=0 (sidewalk level), roads are below curb height
FLAT_Y_LEVELS = {
    'roadbed': -0.15,  # Roads are ~15cm below curb/sidewalk level
    'water': -1.0,     # Water well below ground
    'parks': 0.01,     # Parks at sidewalk level (tiny offset to avoid z-fighting)
}


def process_3dm_file(
    dm_path: Path,
    target_categories: Set[str],
    category_meshes: Dict[str, List],
    stats: ExportStats,
    rhino3dm_module,
    category_polygons: Dict[str, List] = None
):
    """Process a single .3dm file and extract geometry by category.

    For flat categories (roadbed, parks, water), collects raw 2D polygons
    in category_polygons for later union and triangulation.
    """
    print(f"\n  Processing {dm_path.name}...")
    model = rhino3dm_module.File3dm.Read(str(dm_path))

    # Build layer index -> category mapping
    layer_map = {}
    for i, layer in enumerate(model.Layers):
        category = get_layer_category(layer.Name, target_categories)
        if category:
            layer_map[i] = (category, layer.Name)
            stats.layers_found[layer.Name] = stats.layers_found.get(layer.Name, 0)

    # Process objects
    processed_in_file = 0
    polygons_in_file = 0
    for obj in model.Objects:
        layer_idx = obj.Attributes.LayerIndex
        if layer_idx not in layer_map:
            continue

        category, layer_name = layer_map[layer_idx]
        stats.layers_found[layer_name] = stats.layers_found.get(layer_name, 0) + 1

        geometry = obj.Geometry
        mesh_data = None

        # Get object type
        obj_type = type(geometry).__name__

        if obj_type == 'Brep':
            # Use higher sample density for curved geometry (landmarks, infrastructure)
            density = SAMPLE_DENSITY.get(category, SAMPLE_DENSITY['default'])
            mesh_data = extract_mesh_from_brep(geometry, transform_coords, rhino3dm_module, density)
        elif obj_type == 'Mesh':
            mesh_data = extract_mesh_from_mesh(geometry, transform_coords)
        elif obj_type == 'Extrusion':
            mesh_data = extract_mesh_from_extrusion(geometry, transform_coords, rhino3dm_module)
        elif obj_type == 'PolylineCurve' and category in FLAT_CATEGORIES:
            # For union categories: collect raw polygon for later union
            # For other flat categories: triangulate individually to preserve boundaries
            if category in UNION_CATEGORIES and category_polygons is not None and category in category_polygons:
                poly_coords = extract_polygon_from_polyline(geometry, transform_coords)
                if poly_coords and len(poly_coords) >= 3:
                    category_polygons[category].append(poly_coords)
                    polygons_in_file += 1
                    stats.objects_processed += 1
                continue  # Skip individual triangulation
            else:
                # Fallback: triangulate individually
                y_level = FLAT_Y_LEVELS.get(category, 0.0)
                mesh_data = extract_flat_surface_from_polyline(geometry, transform_coords, y_level)

        if mesh_data:
            vertices, faces = mesh_data
            if len(vertices) > 0 and len(faces) > 0:
                category_meshes[category].append({
                    'vertices': vertices,
                    'faces': faces
                })
                stats.objects_processed += 1
                stats.vertices_total += len(vertices)
                stats.faces_total += len(faces)
                processed_in_file += 1

    if polygons_in_file > 0:
        print(f"    Extracted {processed_in_file} meshes, {polygons_in_file} polygons")
    else:
        print(f"    Extracted {processed_in_file} meshes")


def merge_meshes(mesh_list: List[Dict]) -> Tuple[List, List]:
    """Merge multiple meshes into one."""
    all_vertices = []
    all_faces = []
    vertex_offset = 0

    for mesh in mesh_list:
        all_vertices.extend(mesh['vertices'])
        for face in mesh['faces']:
            all_faces.append([f + vertex_offset for f in face])
        vertex_offset += len(mesh['vertices'])

    return all_vertices, all_faces


def union_and_triangulate_polygons(polygons_2d: List[List], y_level: float) -> Tuple[List, List]:
    """Union multiple 2D polygons and triangulate the result.

    This creates a single cohesive mesh instead of triangle soup from
    individually triangulated polygons.

    Args:
        polygons_2d: List of polygon coordinates [[x,z], [x,z], ...]
        y_level: Y coordinate (height) for the flat surface

    Returns:
        (vertices, faces) tuple for the unified mesh
    """
    import numpy as np
    import mapbox_earcut as earcut
    from shapely.geometry import Polygon as ShapelyPolygon, MultiPolygon
    from shapely.ops import unary_union

    print(f"    Unioning {len(polygons_2d):,} polygons...")

    # Convert to Shapely polygons, filtering invalid ones
    shapely_polys = []
    for coords in polygons_2d:
        try:
            if len(coords) < 3:
                continue
            poly = ShapelyPolygon(coords)
            if not poly.is_valid:
                poly = poly.buffer(0)  # Fix self-intersections
            if poly.is_valid and not poly.is_empty and poly.area > 0.1:
                shapely_polys.append(poly)
        except Exception:
            continue

    if not shapely_polys:
        return [], []

    print(f"    Valid polygons: {len(shapely_polys):,}")

    # Union all polygons into one (or multipolygon)
    try:
        unified = unary_union(shapely_polys)
    except Exception as e:
        print(f"    Union failed: {e}")
        return [], []

    # Handle result (could be Polygon or MultiPolygon)
    if unified.is_empty:
        return [], []

    all_vertices = []
    all_faces = []
    vertex_offset = 0

    # Process each polygon (or the single unified polygon)
    geoms = [unified] if unified.geom_type == 'Polygon' else list(unified.geoms)

    print(f"    Result: {len(geoms)} polygon(s)")

    for geom in geoms:
        if geom.is_empty or geom.area < 1.0:  # Skip tiny fragments
            continue

        try:
            # Get exterior ring
            coords = list(geom.exterior.coords)[:-1]
            if len(coords) < 3:
                continue

            # Triangulate with earcut
            # Note: earcut requires ring_end_indices for each ring
            coords_array = np.array(coords, dtype=np.float64)
            ring_end_indices = np.array([len(coords)], dtype=np.uint32)
            indices = earcut.triangulate_float64(coords_array, ring_end_indices)

            if len(indices) == 0:
                continue

            # Add vertices (convert 2D [x,z] to 3D [x, y_level, z])
            for x, z in coords:
                all_vertices.append([x, y_level, z])

            # Add faces with offset
            for i in range(0, len(indices), 3):
                all_faces.append([
                    int(indices[i]) + vertex_offset,
                    int(indices[i+1]) + vertex_offset,
                    int(indices[i+2]) + vertex_offset
                ])

            vertex_offset += len(coords)

        except Exception as e:
            continue

    print(f"    Unified mesh: {len(all_vertices):,} vertices, {len(all_faces):,} faces")
    return all_vertices, all_faces


def decimate_mesh(vertices: List, faces: List, target_faces: int) -> Tuple[List, List]:
    """Decimate mesh to target face count using available methods."""
    import numpy as np
    import trimesh

    if len(faces) <= target_faces:
        return vertices, faces

    mesh = trimesh.Trimesh(
        vertices=np.array(vertices),
        faces=np.array(faces),
        process=False  # Don't process - we'll handle manually
    )

    original_faces = len(mesh.faces)
    print(f"    Attempting decimation: {original_faces:,} -> {target_faces:,} faces")

    # Try method 1: simplify_quadric_decimation
    # Note: API expects target_reduction as ratio (0-1), not face count
    try:
        target_reduction = 1.0 - (target_faces / original_faces)
        target_reduction = max(0.01, min(0.99, target_reduction))  # Clamp to valid range
        print(f"    Method 1 (quadric): target_reduction={target_reduction:.2%}")
        decimated = mesh.simplify_quadric_decimation(target_reduction)
        if decimated is not None and len(decimated.faces) > 0:
            print(f"    Method 1 (quadric): success -> {len(decimated.faces):,} faces")
            return decimated.vertices.tolist(), decimated.faces.tolist()
    except Exception as e:
        print(f"    Method 1 (quadric) failed: {str(e)[:60]}")

    # Try method 2: vertex clustering (always works, may be less quality)
    try:
        # Calculate voxel size to achieve target reduction
        bounds = mesh.bounds
        volume = np.prod(bounds[1] - bounds[0])
        # Rough estimate: double voxel size halves face count
        reduction_ratio = original_faces / target_faces
        voxel_size = (volume / original_faces) ** (1/3) * (reduction_ratio ** 0.5)

        # Clamp to reasonable range (0.5m to 10m)
        voxel_size = max(0.5, min(10.0, voxel_size))
        print(f"    Method 2 (voxel clustering): voxel_size={voxel_size:.2f}m")

        # Quantize vertices to grid
        quantized_verts = np.round(mesh.vertices / voxel_size) * voxel_size

        # Find unique vertices
        unique_verts, inverse_indices = np.unique(
            quantized_verts, axis=0, return_inverse=True
        )

        # Remap faces
        new_faces = inverse_indices[mesh.faces]

        # Remove degenerate faces (where vertices collapsed to same point)
        valid_mask = (new_faces[:, 0] != new_faces[:, 1]) & \
                     (new_faces[:, 1] != new_faces[:, 2]) & \
                     (new_faces[:, 0] != new_faces[:, 2])
        new_faces = new_faces[valid_mask]

        # Create new mesh with processing to clean up
        decimated = trimesh.Trimesh(vertices=unique_verts, faces=new_faces, process=True)

        print(f"    Method 2 result: {len(decimated.faces):,} faces")
        return decimated.vertices.tolist(), decimated.faces.tolist()

    except Exception as e:
        print(f"    Method 2 (voxel) failed: {str(e)[:50]}")

    # Fallback: return original
    print(f"    Warning: all decimation methods failed, using original mesh")
    return vertices, faces


def export_to_gltf(
    vertices: List,
    faces: List,
    output_path: Path,
    category: str,
    merge_coplanar: bool = False
):
    """Export mesh to glTF format with cleaning for flat surfaces."""
    import numpy as np
    import trimesh

    mesh = trimesh.Trimesh(
        vertices=np.array(vertices),
        faces=np.array(faces),
        process=True  # Let trimesh clean up automatically
    )

    # For flat categories (roadbed, parks, water), clean up the mesh more aggressively
    if category in FLAT_CATEGORIES:
        initial_faces = len(mesh.faces)

        # 1. Merge vertices within a small tolerance (0.5 meters for flat surfaces)
        mesh.merge_vertices(merge_tex=True, merge_norm=True)

        # 2. Remove degenerate faces (zero-area or near-zero-area)
        mask = mesh.nondegenerate_faces()
        if mask is not None and len(mask) > 0:
            mesh.update_faces(mask)

        # 3. Remove faces with very small area (thin slivers)
        areas = mesh.area_faces
        min_area = 0.01  # 0.01 m² minimum
        valid_area_mask = areas >= min_area
        mesh.update_faces(valid_area_mask)

        # 3b. Remove oversized triangles (triangulation bugs from degenerate polygons)
        # Max reasonable road polygon is ~70m x 70m = 5000 m²
        areas = mesh.area_faces
        max_area = 5000  # m²
        oversized_count = np.sum(areas > max_area)
        if oversized_count > 0:
            valid_size_mask = areas <= max_area
            mesh.update_faces(valid_size_mask)
            print(f"    Removed {oversized_count:,} oversized triangles (> {max_area} m²)")

        # 4. Remove duplicate faces (exact duplicates and reversed duplicates)
        # This helps when polygons share edges/overlap
        mesh.merge_vertices()  # Ensure vertices are merged first

        # Get unique faces (considering both orientations)
        faces_sorted = np.sort(mesh.faces, axis=1)
        _, unique_idx = np.unique(faces_sorted, axis=0, return_index=True)
        mesh.update_faces(unique_idx)

        # 5. Remove unreferenced vertices
        mesh.remove_unreferenced_vertices()

        # 6. Fix face normals - ensure they point UP for flat ground surfaces
        # This prevents black faces when viewed from above
        face_normals = mesh.face_normals
        down_facing_mask = face_normals[:, 1] < 0  # Y < 0 means pointing down
        down_count = np.sum(down_facing_mask)
        if down_count > 0:
            # Flip winding order for down-facing faces (reverses normal direction)
            down_faces = np.where(down_facing_mask)[0]
            mesh.faces[down_faces] = mesh.faces[down_faces][:, ::-1]
            # Clear cached normals so they get recomputed
            if hasattr(mesh, '_cache'):
                mesh._cache.clear()
            print(f"    Fixed {down_count:,} down-facing normals")

        removed = initial_faces - len(mesh.faces)
        print(f"    After cleaning: {len(mesh.faces):,} faces (removed {removed:,})")

    # Export as GLB (binary glTF)
    mesh.export(str(output_path), file_type='glb')

    file_size = output_path.stat().st_size / (1024 * 1024)
    print(f"    Exported {category}: {len(mesh.faces):,} faces, {file_size:.1f} MB")


def generate_manifest(
    output_dir: Path,
    stats: ExportStats,
    version: str
) -> Dict:
    """Generate manifest.json with asset metadata."""
    manifest = {
        'version': version,
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'NYC DCP 3D Building Model (2018)',
        'assets': {},
        'stats': {
            'objects_processed': stats.objects_processed,
            'total_vertices': stats.vertices_total,
            'total_faces': stats.faces_total,
            'layers_processed': stats.layers_found
        }
    }

    for file_path in stats.files_exported:
        name = Path(file_path).stem
        size = Path(file_path).stat().st_size
        manifest['assets'][name] = {
            'file': Path(file_path).name,
            'size_bytes': size
        }

    manifest_path = output_dir / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    return manifest


def main():
    parser = argparse.ArgumentParser(description='Export NYC 3D Model to glTF')
    parser.add_argument('--version', choices=['v1', 'v2'], default='v1',
                       help='Export version (v1=essential, v2=extended)')
    parser.add_argument('--dry-run', action='store_true',
                       help='Analyze without exporting')
    parser.add_argument('--category', type=str,
                       help='Export only specific category')
    args = parser.parse_args()

    # Paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    data_dir = project_root / 'data' / 'nyc_3d_model'
    output_dir = project_root / 'public' / 'assets' / 'nyc3d'

    # Validate
    if not data_dir.exists():
        print(f"Error: Data directory not found: {data_dir}")
        print("Please ensure NYC 3D Model zips are in data/nyc_3d_model/")
        sys.exit(1)

    # Determine target categories
    target_categories = EXPORT_VERSIONS[args.version]
    if args.category:
        if args.category not in target_categories:
            print(f"Error: Category '{args.category}' not in {args.version}")
            sys.exit(1)
        target_categories = {args.category}

    print(f"NYC 3D Model Export ({args.version})")
    print(f"=" * 50)
    print(f"Target categories: {', '.join(sorted(target_categories))}")
    print(f"Output directory: {output_dir}")

    # Extract .3dm files
    print(f"\n1. Extracting .3dm files...")
    dm_files = extract_3dm_files(data_dir)
    print(f"   Found {len(dm_files)} .3dm files")

    if not dm_files:
        print("Error: No .3dm files found")
        sys.exit(1)

    # Import rhino3dm (after extraction to fail fast if not installed)
    try:
        import rhino3dm
        import trimesh
        import numpy as np
    except ImportError as e:
        print(f"\nError: Missing dependency: {e}")
        print("Install with: pip install rhino3dm trimesh numpy")
        sys.exit(1)

    # Initialize category meshes and raw polygons
    category_meshes: Dict[str, List] = {cat: [] for cat in target_categories}
    category_polygons: Dict[str, List] = {cat: [] for cat in target_categories if cat in UNION_CATEGORIES}
    stats = ExportStats()

    # Process each file
    print(f"\n2. Processing geometry...")
    for dm_path in dm_files:
        process_3dm_file(dm_path, target_categories, category_meshes, stats, rhino3dm, category_polygons)

    # Summary
    print(f"\n3. Summary:")
    print(f"   Objects processed: {stats.objects_processed:,}")
    print(f"   Total vertices: {stats.vertices_total:,}")
    print(f"   Total faces: {stats.faces_total:,}")
    print(f"\n   Layers found:")
    for layer, count in sorted(stats.layers_found.items(), key=lambda x: -x[1]):
        print(f"     {layer}: {count:,}")

    if args.dry_run:
        print("\n[Dry run - no files exported]")
        return

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Merge, decimate, and export each category
    print(f"\n4. Exporting assets...")
    for category in sorted(target_categories):
        print(f"\n  Processing {category}...")

        # For union categories, use polygon union if we have raw polygons
        if category in UNION_CATEGORIES and category in category_polygons and category_polygons[category]:
            polygons = category_polygons[category]
            y_level = FLAT_Y_LEVELS.get(category, 0.0)

            # Union and triangulate
            vertices, faces = union_and_triangulate_polygons(polygons, y_level)

            if not vertices or not faces:
                print(f"    {category}: polygon union failed, falling back to mesh merge")
                # Fall back to old method
                meshes = category_meshes[category]
                if not meshes:
                    print(f"    {category}: no geometry found, skipping")
                    continue
                vertices, faces = merge_meshes(meshes)
        else:
            # Non-flat categories: use traditional mesh merge
            meshes = category_meshes[category]
            if not meshes:
                print(f"    {category}: no geometry found, skipping")
                continue

            print(f"    Merging {len(meshes)} meshes...")
            vertices, faces = merge_meshes(meshes)
            print(f"    Merged: {len(vertices):,} vertices, {len(faces):,} faces")

        # Decimate if needed
        target = TRIANGLE_BUDGETS.get(category, 50_000)
        if len(faces) > target:
            print(f"    Decimating to {target:,} faces...")
            vertices, faces = decimate_mesh(vertices, faces, target)

        # Export
        output_path = output_dir / f'{category}.glb'
        export_to_gltf(vertices, faces, output_path, category)
        stats.files_exported.append(str(output_path))

    # Generate manifest
    print(f"\n5. Generating manifest...")
    manifest = generate_manifest(output_dir, stats, args.version)
    print(f"   Written to {output_dir / 'manifest.json'}")

    print(f"\n✓ Export complete!")
    print(f"  Files: {len(stats.files_exported)}")
    print(f"  Location: {output_dir}")


if __name__ == '__main__':
    main()
