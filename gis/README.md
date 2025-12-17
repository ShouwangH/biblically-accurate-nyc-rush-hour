# Ground Map GIS Export

This folder contains the QGIS project and source data for generating the ground texture.

## Quick Start

1. Install [QGIS](https://qgis.org/) (free, open source)
2. Download data sources (see below)
3. Open `ground_map.qgz` in QGIS
4. Export to `public/assets/ground_map.png`

## Data Sources

### Already included (no download needed)
| Layer | Source | File |
|-------|--------|------|
| Roads | Exported from road_segments.json | `gis/roads.geojson` (4785 segments) |

### Download from NYC Open Data
| Layer | Source | Direct Link |
|-------|--------|-------------|
| Shoreline | NYC Shoreline | [Download](https://data.cityofnewyork.us/api/geospatial/2qj2-cctx?method=export&format=Shapefile) |
| Parks | Parks Properties | [Download](https://data.cityofnewyork.us/api/geospatial/enfh-gkve?method=export&format=GeoJSON) |

Place downloaded files in `gis/data/` (gitignored).

### Regenerate roads.geojson (if needed)
```bash
python scripts/export-roads-geojson.py
```

## Project Setup

### Bounds (WGS84)
```
West:  -74.025
East:  -73.965
South:  40.698
North:  40.758
```

### Layer Order (bottom to top)
1. Land base (rectangle covering full extent)
2. Water (shoreline inverted)
3. Neighborhoods (OPTIONAL - skip initially)
4. Parks
5. Roads (filtered to major only)

## Layer Styling

### Water
- Fill: `#D8DDE0`
- No stroke

### Land Base
- Fill: `#F0EDE8`
- No stroke

### Neighborhoods (OPTIONAL)
**Note:** Neighborhood zones may add too much visual noise with the subway ghost layer.
Start WITHOUT neighborhoods - add only if the ground looks too flat.

If needed, draw 6 polygons in `neighborhoods.geojson`:

| Zone | Area | Color |
|------|------|-------|
| Financial District | South of Fulton St | `#E8E8E4` |
| Battery Park / WTC | Southwest corner | `#E6E8E8` |
| Tribeca | West side, Canal to Chambers | `#E7E6E5` |
| Chinatown / LES | East of Broadway, south of Houston | `#E9E7E4` |
| SoHo / NoHo | Canal to Houston, west of Bowery | `#E5E7E8` |
| East Village / Gramercy | North of Houston, east side | `#E6E7E6` |

Style: Categorized by `name`, no stroke, very low opacity (20-30%).

### Parks
- Fill: `#E4E8E4`
- Opacity: 40%
- No stroke

### Roads
Load `gis/roads.geojson` (already exported from road_segments.json).

Style:
- Line: `#C8C8C8`
- Width: 0.0003 degrees (~2px at 4096 resolution)
- Opacity: 60% (roads shouldn't dominate)

## Export Settings

```
Menu: Project > Import/Export > Export Map to Image

Extent: -74.025, 40.698, -73.965, 40.758
Resolution: 4096 x 4096 pixels
Format: PNG (24-bit RGB)
Output: ../public/assets/ground_map.png
```

## Output Files

After export, you should have:
- `public/assets/ground_map.png` - 4096x4096 texture
- `public/assets/ground_map.json` - Metadata (copy from template below)

## Metadata Template

Copy to `public/assets/ground_map.json`:
```json
{
  "wgs84Bounds": {
    "west": -74.025,
    "east": -73.965,
    "south": 40.698,
    "north": 40.758
  },
  "localBounds": {
    "xMin": -700,
    "xMax": 4400,
    "zMin": -6200,
    "zMax": 600
  },
  "resolution": [4096, 4096],
  "generatedAt": "2025-XX-XX"
}
```

## Validation Checklist

After export, verify:
- [ ] Water visible around Manhattan edges
- [ ] Neighborhood zones subtly differentiated
- [ ] Parks visible as slight green tint
- [ ] Major roads visible but not prominent
- [ ] No hard edges between neighborhoods
- [ ] File size ~2-4MB (PNG compression)
