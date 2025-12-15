#!/usr/bin/env python3
"""
Process NYC 3D Building data from ESRI File Geodatabase to OBJ format.

This script:
1. Reads Multipatch building data from GDB files
2. Clips to lower Manhattan extent (south of 34th Street)
3. Transforms coordinates from NAD83/NY State Plane (ftUS) to local meters
4. Exports to OBJ format for Blender processing

Prerequisites:
- GDAL/OGR tools (ogr2ogr, ogrinfo)
- Python packages: pyproj

Usage:
    cd atlas
    source scripts/.venv/bin/activate
    python scripts/process_buildings.py

After running, import the OBJ into Blender for:
- Decimation (target 300-400k triangles)
- Merging into single mesh
- Export as Draco-compressed glTF
"""

import json
import os
import subprocess
from pathlib import Path
from typing import List, Tuple
from dataclasses import dataclass

from pyproj import Transformer


# =============================================================================
# Configuration
# =============================================================================

# Coordinate system constants
# Source: EPSG:2263 - NAD83 / New York Long Island (ftUS)
# Target: Local meters, origin at Battery Park (40.7033°N, 74.0170°W)
ORIGIN_LAT = 40.7033
ORIGIN_LNG = -74.0170
FEET_TO_METERS = 0.3048006096  # US survey feet

# Bounding box for lower Manhattan (in State Plane feet)
# Covers area south of 34th Street with ~200m buffer
# Battery Park: X≈979,536, Y≈195,508
# 34th Street: X≈987,020, Y≈212,000
# Manhattan eastern edge: ~993,000 (East River)
# Brooklyn starts at: ~1,000,000+
BBOX_MIN_X = 976_000  # Western edge with buffer
BBOX_MAX_X = 993_000  # Eastern edge - Manhattan only, excludes Brooklyn
BBOX_MIN_Y = 190_000  # Southern edge with buffer
BBOX_MAX_Y = 218_000  # Northern edge (≈34th St + buffer)

# Districts to process (those covering lower Manhattan)
DISTRICTS = ['DA12', 'DA19', 'DA10']

# Paths
GDB_BASE_PATH = Path('/tmp/buildings_data/DA_WISE_Multipatch')
OUTPUT_DIR = Path('/tmp/buildings_export')


# =============================================================================
# Coordinate Transformation
# =============================================================================

@dataclass
class CoordinateTransformer:
    """Transforms coordinates from State Plane to local meters."""

    # Transform from State Plane to WGS84
    sp_to_wgs84: Transformer = None

    # Origin in State Plane feet
    origin_x: float = 0
    origin_y: float = 0

    def __post_init__(self):
        # State Plane to WGS84
        self.sp_to_wgs84 = Transformer.from_crs('EPSG:2263', 'EPSG:4326', always_xy=True)

        # WGS84 to State Plane (for computing origin)
        wgs84_to_sp = Transformer.from_crs('EPSG:4326', 'EPSG:2263', always_xy=True)
        self.origin_x, self.origin_y = wgs84_to_sp.transform(ORIGIN_LNG, ORIGIN_LAT)

        print(f"Origin (State Plane feet): X={self.origin_x:.1f}, Y={self.origin_y:.1f}")

    def transform(self, x_ft: float, y_ft: float, z_ft: float) -> Tuple[float, float, float]:
        """Transform from State Plane feet to local meters (X=East, Y=Up, Z=South)."""
        # Convert to meters relative to origin
        local_x = (x_ft - self.origin_x) * FEET_TO_METERS
        local_z = -(y_ft - self.origin_y) * FEET_TO_METERS  # Negate for Z=South
        local_y = z_ft * FEET_TO_METERS  # Height in meters

        return (local_x, local_y, local_z)


# =============================================================================
# GeoJSON to OBJ Conversion
# =============================================================================

class OBJWriter:
    """Writes geometry to OBJ format."""

    def __init__(self, filepath: Path):
        self.filepath = filepath
        self.vertices: List[Tuple[float, float, float]] = []
        self.faces: List[List[int]] = []
        self.vertex_offset = 0

    def add_multipolygon(self, coords, transformer: CoordinateTransformer):
        """Add a MultiPolygon (building) to the OBJ."""
        for polygon in coords:
            # Each polygon is a list of rings (outer boundary + holes)
            # For buildings, we typically only have outer boundary per face
            for ring in polygon:
                if len(ring) < 3:
                    continue

                # Add vertices (skip last point as it duplicates first)
                ring_start_idx = len(self.vertices)
                for point in ring[:-1]:
                    x, y, z = point[0], point[1], point[2] if len(point) > 2 else 0
                    local_coords = transformer.transform(x, y, z)
                    self.vertices.append(local_coords)

                # Add face as n-gon (let Blender triangulate)
                # OBJ supports arbitrary polygons, Blender will triangulate properly
                n_verts = len(ring) - 1
                if n_verts >= 3:
                    # Create face with all vertices in order
                    # OBJ uses 1-based indices
                    face = [ring_start_idx + i + 1 for i in range(n_verts)]
                    self.faces.append(face)

    def write(self):
        """Write the OBJ file."""
        with open(self.filepath, 'w') as f:
            f.write(f"# NYC 3D Buildings - Lower Manhattan\n")
            f.write(f"# Vertices: {len(self.vertices)}\n")
            f.write(f"# Faces: {len(self.faces)}\n\n")

            # Write vertices
            for v in self.vertices:
                f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")

            f.write("\n")

            # Write faces
            for face in self.faces:
                f.write(f"f {' '.join(str(i) for i in face)}\n")

        print(f"Wrote {self.filepath}")
        print(f"  Vertices: {len(self.vertices):,}")
        print(f"  Faces: {len(self.faces):,}")


# =============================================================================
# Main Processing
# =============================================================================

def export_gdb_to_geojson(gdb_path: Path, output_path: Path) -> bool:
    """Export GDB to GeoJSON using ogr2ogr with spatial filter."""

    # Build ogr2ogr command with spatial filter
    cmd = [
        'ogr2ogr',
        '-f', 'GeoJSON',
        str(output_path),
        str(gdb_path),
        'Buildings_3D_Multipatch',
        '-spat', str(BBOX_MIN_X), str(BBOX_MIN_Y), str(BBOX_MAX_X), str(BBOX_MAX_Y),
    ]

    print(f"Exporting {gdb_path.name}...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"  Error: {result.stderr}")
        return False

    return True


def process_geojson(geojson_path: Path, obj_writer: OBJWriter, transformer: CoordinateTransformer):
    """Process a GeoJSON file and add buildings to OBJ writer."""

    with open(geojson_path) as f:
        data = json.load(f)

    features = data.get('features', [])
    print(f"  Processing {len(features)} buildings...")

    for feature in features:
        geom = feature.get('geometry', {})
        if geom.get('type') == 'MultiPolygon':
            obj_writer.add_multipolygon(geom['coordinates'], transformer)


def main():
    """Main entry point."""

    print("=" * 60)
    print("NYC 3D Buildings Processing")
    print("=" * 60)
    print()

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Initialize transformer
    transformer = CoordinateTransformer()
    print()

    # Initialize OBJ writer
    obj_path = OUTPUT_DIR / 'buildings_lower_manhattan.obj'
    obj_writer = OBJWriter(obj_path)

    # Process each district
    for district in DISTRICTS:
        gdb_name = f"{district}_3D_Buildings_Multipatch.gdb"
        gdb_path = GDB_BASE_PATH / gdb_name

        if not gdb_path.exists():
            print(f"Warning: {gdb_path} not found, skipping")
            continue

        # Export to GeoJSON
        geojson_path = OUTPUT_DIR / f"{district}.geojson"
        if not export_gdb_to_geojson(gdb_path, geojson_path):
            continue

        # Process GeoJSON
        process_geojson(geojson_path, obj_writer, transformer)

        # Clean up GeoJSON (optional, keep for debugging)
        # geojson_path.unlink()

    print()

    # Write final OBJ
    obj_writer.write()

    print()
    print("=" * 60)
    print("Next Steps:")
    print("=" * 60)
    print("""
1. Open Blender and import the OBJ file:
   File > Import > Wavefront (.obj)
   Path: /tmp/buildings_export/buildings_lower_manhattan.obj

2. Select all building meshes and join (Ctrl+J)

3. Apply Decimate modifier:
   - Ratio: Start at 0.1, adjust to reach ~400k triangles
   - Type: Collapse

4. Export as glTF:
   File > Export > glTF 2.0 (.glb/.gltf)
   - Format: GLB
   - Enable Draco compression
   - Output: public/assets/buildings.glb

Target specs:
- Triangles: 300-400k (500k max)
- File size: 3-6 MB compressed
""")


if __name__ == '__main__':
    main()
