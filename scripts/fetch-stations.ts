/**
 * Fetch MTA Subway Hourly Ridership Data and Generate stations.json
 *
 * Data Source: https://data.ny.gov/Transportation/MTA-Subway-Hourly-Ridership-Beginning-2025/5wq4-mkjj
 *
 * Usage: npm run fetch:stations
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  // Socrata API endpoint
  apiUrl: 'https://data.ny.gov/resource/5wq4-mkjj.json',

  // Sample a specific weekday (Tuesday March 18, 2025 - a normal weekday)
  sampleDate: '2025-03-18',

  // Geographic bounds (Manhattan south of 34th St)
  maxLatitude: 40.755, // Approximately 34th St

  // Time model
  timeSlices: 60,

  // Normalization
  minIntensityFloor: 0.08,

  // Output path
  outputPath: path.join(__dirname, '..', 'src', 'assets', 'stations.json'),
};

// =============================================================================
// Types
// =============================================================================

interface ApiRecord {
  transit_timestamp: string;
  transit_mode: string;
  station_complex_id: string;
  station_complex: string;
  borough: string;
  payment_method: string;
  fare_class_category: string;
  ridership: string;
  transfers: string;
  latitude: string;
  longitude: string;
}

interface StationAccumulator {
  id: string;
  name: string;
  lines: string[];
  lat: number;
  lng: number;
  ridershipByHour: Map<number, number>;
}

interface StationData {
  id: string;
  name: string;
  lines: string[];
  position: [number, number, number];
  surfacePosition: [number, number, number];
  intensities: number[];
}

interface StationsFile {
  meta: {
    timeSlices: number;
    timeRange: [number, number];
    normalization: 'global';
    maxEntriesPerSlice: number;
    minIntensityFloor: number;
  };
  stations: StationData[];
}

// =============================================================================
// Coordinate Conversion
// =============================================================================

const ORIGIN_LAT = 40.7033; // Battery Park
const ORIGIN_LNG = -74.017;
const METERS_PER_DEGREE_LAT = 111320;
const METERS_PER_DEGREE_LNG = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

function toLocalCoords(lat: number, lng: number, elevation: number = 0): [number, number, number] {
  const x = (lng - ORIGIN_LNG) * METERS_PER_DEGREE_LNG;
  const z = -(lat - ORIGIN_LAT) * METERS_PER_DEGREE_LAT;
  const y = elevation;
  return [Math.round(x), Math.round(y), Math.round(z)];
}

// =============================================================================
// Parse Subway Lines from Station Name
// =============================================================================

/**
 * Extract subway lines from station complex name.
 * Example: "Fulton St (A,C,J,Z,2,3,4,5)" -> ["A", "C", "J", "Z", "2", "3", "4", "5"]
 */
function parseSubwayLines(stationComplex: string): string[] {
  const lines: Set<string> = new Set();

  // Match all parenthetical groups like (A,C,J,Z,2,3,4,5)
  const matches = stationComplex.matchAll(/\(([^)]+)\)/g);

  for (const match of matches) {
    const content = match[1];
    // Split by comma and clean up
    const parts = content.split(',').map((s) => s.trim());
    for (const part of parts) {
      // Only add valid subway line identifiers (single letters/numbers or SIR)
      if (/^[A-Z0-9]$/.test(part) || part === 'SIR' || part === 'S') {
        lines.add(part);
      }
    }
  }

  return Array.from(lines).sort();
}

/**
 * Extract clean station name (without line info).
 * Example: "Fulton St (A,C,J,Z,2,3,4,5)" -> "Fulton St"
 */
function parseStationName(stationComplex: string): string {
  // Take first part before any parenthesis or slash
  const name = stationComplex.split(/[(/]/)[0].trim();
  return name;
}

// =============================================================================
// API Fetching
// =============================================================================

async function fetchSubwayDataForDate(date: string): Promise<ApiRecord[]> {
  const allRecords: ApiRecord[] = [];
  const limit = 10000;
  let offset = 0;
  let hasMore = true;

  console.log(`Fetching MTA subway data for ${date}...`);

  while (hasMore) {
    // Use $where to filter by date range and transit mode
    const whereClause = encodeURIComponent(
      `transit_mode='subway' and transit_timestamp between '${date}T00:00:00' and '${date}T23:59:59'`
    );
    const url = `${CONFIG.apiUrl}?$limit=${limit}&$offset=${offset}&$where=${whereClause}`;

    console.log(`  Fetching offset ${offset}...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ApiRecord[] | { message: string };

    if (!Array.isArray(data)) {
      throw new Error(`API error: ${JSON.stringify(data)}`);
    }

    allRecords.push(...data);
    console.log(`    Got ${data.length} records (total: ${allRecords.length})`);

    if (data.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return allRecords;
}

// =============================================================================
// Data Processing
// =============================================================================

function processRecords(records: ApiRecord[]): Map<string, StationAccumulator> {
  const stations = new Map<string, StationAccumulator>();

  for (const record of records) {
    const lat = parseFloat(record.latitude);
    const lng = parseFloat(record.longitude);

    // Filter to Manhattan south of 34th St
    if (record.borough !== 'Manhattan') {
      continue;
    }
    if (lat >= CONFIG.maxLatitude) {
      continue;
    }

    const id = record.station_complex_id;
    const hour = parseInt(record.transit_timestamp.split('T')[1].substring(0, 2), 10);
    const ridership = parseFloat(record.ridership) || 0;

    if (!stations.has(id)) {
      stations.set(id, {
        id,
        name: parseStationName(record.station_complex),
        lines: parseSubwayLines(record.station_complex),
        lat,
        lng,
        ridershipByHour: new Map(),
      });
    }

    const station = stations.get(id)!;
    const currentHourRidership = station.ridershipByHour.get(hour) || 0;
    station.ridershipByHour.set(hour, currentHourRidership + ridership);
  }

  return stations;
}

/**
 * Generate 60 intensity values for the 8-9am window.
 *
 * Strategy:
 * - Use ridership at 7am, 8am, 9am to create a curve
 * - Interpolate across 60 minutes
 * - The curve ramps up in early minutes, peaks mid-hour, ramps down
 */
function generateIntensities(
  station: StationAccumulator,
  globalMax: number,
  minFloor: number
): number[] {
  const r7 = station.ridershipByHour.get(7) || 0;
  const r8 = station.ridershipByHour.get(8) || 0;
  const r9 = station.ridershipByHour.get(9) || 0;

  const intensities: number[] = [];

  for (let minute = 0; minute < 60; minute++) {
    // Create a smooth curve within the hour
    // First half: interpolate from 7am→8am level
    // Second half: interpolate from 8am→9am level
    let ridership: number;

    if (minute < 30) {
      // First half: transitioning from 7am pattern to 8am peak
      const t = minute / 30; // 0 to 1
      ridership = r7 + (r8 - r7) * (0.5 + 0.5 * t);
    } else {
      // Second half: transitioning from 8am peak to 9am pattern
      const t = (minute - 30) / 30; // 0 to 1
      ridership = r8 + (r9 - r8) * (0.5 * t);
    }

    // Normalize to [0, 1] using global max
    let intensity = ridership / globalMax;

    // Apply floor clamp
    intensity = Math.max(intensity, minFloor);
    intensity = Math.min(intensity, 1.0);

    // Round to 3 decimal places
    intensities.push(Math.round(intensity * 1000) / 1000);
  }

  return intensities;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  try {
    // 1. Fetch data for sample date
    const records = await fetchSubwayDataForDate(CONFIG.sampleDate);
    console.log(`\nTotal records fetched: ${records.length}`);

    // 2. Process into stations (filter to Manhattan south of 34th)
    const stationMap = processRecords(records);
    console.log(`Stations in scope (Manhattan, south of 34th): ${stationMap.size}`);

    if (stationMap.size === 0) {
      console.error('No stations found! Check filters.');
      process.exit(1);
    }

    // 3. Find global max ridership at 8am
    let globalMax = 0;
    for (const station of stationMap.values()) {
      const r8 = station.ridershipByHour.get(8) || 0;
      if (r8 > globalMax) {
        globalMax = r8;
      }
    }
    console.log(`Global max 8am ridership: ${globalMax}`);

    // 4. Generate output
    const stations: StationData[] = [];

    for (const station of stationMap.values()) {
      // Skip stations with no lines parsed (might be special cases)
      if (station.lines.length === 0) {
        console.warn(`  Warning: No lines parsed for ${station.name} (${station.id})`);
        continue;
      }

      const position = toLocalCoords(station.lat, station.lng, -20); // Underground
      const surfacePosition = toLocalCoords(station.lat, station.lng, 0);
      const intensities = generateIntensities(station, globalMax, CONFIG.minIntensityFloor);

      stations.push({
        id: station.id,
        name: station.name,
        lines: station.lines,
        position,
        surfacePosition,
        intensities,
      });
    }

    // Sort by 8am ridership (most important stations first)
    stations.sort((a, b) => {
      const aMax = Math.max(...a.intensities);
      const bMax = Math.max(...b.intensities);
      return bMax - aMax;
    });

    // 5. Build output file
    const output: StationsFile = {
      meta: {
        timeSlices: CONFIG.timeSlices,
        timeRange: [0, 1],
        normalization: 'global',
        maxEntriesPerSlice: Math.round(globalMax / 60), // Per-minute estimate
        minIntensityFloor: CONFIG.minIntensityFloor,
      },
      stations,
    };

    // 6. Write to file
    fs.writeFileSync(CONFIG.outputPath, JSON.stringify(output, null, 2));
    console.log(`\nWrote ${stations.length} stations to ${CONFIG.outputPath}`);

    // 7. Print summary
    console.log('\nTop 10 stations by intensity:');
    for (const station of stations.slice(0, 10)) {
      const maxIntensity = Math.max(...station.intensities);
      console.log(`  ${station.id}: ${station.name} (${station.lines.join(',')}) - ${maxIntensity.toFixed(2)}`);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
