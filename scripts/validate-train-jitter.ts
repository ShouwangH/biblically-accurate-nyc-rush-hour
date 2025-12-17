#!/usr/bin/env npx ts-node
/**
 * Validation script to identify train jitter causes.
 *
 * Checks for:
 * (a) Zero or tiny duration runs
 * (b) Zero or tiny segment lengths
 * (c) Segment continuity gaps
 *
 * Run: npx ts-node scripts/validate-train-jitter.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load data
const trainSchedules = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src/assets/train_schedules.json'), 'utf-8')
);
const subwayLines = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src/assets/subway_lines.json'), 'utf-8')
);

type Point3D = [number, number, number];

interface TrainRun {
  id: string;
  lineId: string;
  segmentIndex: number;
  direction: 1 | -1;
  tEnter: number;
  tExit: number;
  crowding: number;
  tripId?: string;
}

interface SubwayLine {
  id: string;
  segments: { points: Point3D[] }[];
}

// Constants
const CYCLE_DURATION_SECONDS = 120;
const FRAME_DURATION_SECONDS = 1 / 60; // 60fps
const MIN_DURATION_THRESHOLD = FRAME_DURATION_SECONDS / CYCLE_DURATION_SECONDS; // ~0.000139
const MIN_SEGMENT_LENGTH = 5; // meters

function distance(p1: Point3D, p2: Point3D): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getPolylineLength(points: Point3D[]): number {
  if (points.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance(points[i - 1], points[i]);
  }
  return length;
}

// Build line map
const linesMap = new Map<string, SubwayLine>();
for (const line of subwayLines.lines) {
  linesMap.set(line.id, line);
}

console.log('='.repeat(80));
console.log('TRAIN JITTER VALIDATION REPORT');
console.log('='.repeat(80));
console.log(`\nFrame duration threshold: ${MIN_DURATION_THRESHOLD.toFixed(6)} (${(MIN_DURATION_THRESHOLD * CYCLE_DURATION_SECONDS * 1000).toFixed(1)}ms)`);
console.log(`Min segment length threshold: ${MIN_SEGMENT_LENGTH}m\n`);

// =============================================================================
// (a) Check for tiny duration runs
// =============================================================================
console.log('\n' + '='.repeat(80));
console.log('(a) TINY DURATION RUNS (< 1 frame)');
console.log('='.repeat(80));

const tinyDurationRuns: TrainRun[] = [];
const zeroDurationRuns: TrainRun[] = [];

for (const train of trainSchedules.trains as TrainRun[]) {
  const dur = train.tExit - train.tEnter;
  if (dur <= 0) {
    zeroDurationRuns.push(train);
  } else if (dur < MIN_DURATION_THRESHOLD * 2) {
    tinyDurationRuns.push(train);
  }
}

console.log(`\nZero/negative duration runs: ${zeroDurationRuns.length}`);
if (zeroDurationRuns.length > 0) {
  console.log('Examples:');
  for (const run of zeroDurationRuns.slice(0, 5)) {
    console.log(`  ${run.id}: dur=${run.tExit - run.tEnter}`);
  }
}

console.log(`\nTiny duration runs (< 2 frames): ${tinyDurationRuns.length}`);
if (tinyDurationRuns.length > 0) {
  console.log('Examples (first 20):');
  for (const run of tinyDurationRuns.slice(0, 20)) {
    const dur = run.tExit - run.tEnter;
    const msPerCycle = dur * CYCLE_DURATION_SECONDS * 1000;
    console.log(`  ${run.id}: dur=${dur.toFixed(6)} (${msPerCycle.toFixed(1)}ms)`);
  }
}

// =============================================================================
// (b) Check for tiny segment lengths
// =============================================================================
console.log('\n' + '='.repeat(80));
console.log('(b) TINY SEGMENT LENGTHS');
console.log('='.repeat(80));

const tinySegments: { lineId: string; segIdx: number; length: number }[] = [];

for (const line of subwayLines.lines as SubwayLine[]) {
  for (let i = 0; i < line.segments.length; i++) {
    const len = getPolylineLength(line.segments[i].points);
    if (len < MIN_SEGMENT_LENGTH) {
      tinySegments.push({ lineId: line.id, segIdx: i, length: len });
    }
  }
}

console.log(`\nSegments shorter than ${MIN_SEGMENT_LENGTH}m: ${tinySegments.length}`);
if (tinySegments.length > 0) {
  console.log('Examples (first 20):');
  for (const seg of tinySegments.slice(0, 20)) {
    console.log(`  Line ${seg.lineId} seg[${seg.segIdx}]: ${seg.length.toFixed(2)}m`);
  }
}

// =============================================================================
// (c) Check segment continuity
// =============================================================================
console.log('\n' + '='.repeat(80));
console.log('(c) SEGMENT CONTINUITY GAPS');
console.log('='.repeat(80));

const CONTINUITY_THRESHOLD = 1; // 1 meter gap is suspicious
const continuityGaps: { lineId: string; segIdx: number; gap: number; type: string }[] = [];

for (const line of subwayLines.lines as SubwayLine[]) {
  for (let i = 0; i < line.segments.length - 1; i++) {
    const seg1 = line.segments[i].points;
    const seg2 = line.segments[i + 1].points;

    const end1 = seg1[seg1.length - 1];
    const start2 = seg2[0];
    const end2 = seg2[seg2.length - 1];

    const endToStartGap = distance(end1, start2);
    const endToEndGap = distance(end1, end2);

    if (endToStartGap > CONTINUITY_THRESHOLD) {
      // Check if segment might be reversed
      if (endToEndGap < endToStartGap) {
        continuityGaps.push({
          lineId: line.id,
          segIdx: i + 1,
          gap: endToStartGap,
          type: 'REVERSED? (end-to-end closer)',
        });
      } else {
        continuityGaps.push({
          lineId: line.id,
          segIdx: i + 1,
          gap: endToStartGap,
          type: 'GAP',
        });
      }
    }
  }
}

console.log(`\nContinuity issues found: ${continuityGaps.length}`);
if (continuityGaps.length > 0) {
  console.log('Issues (first 20):');
  for (const gap of continuityGaps.slice(0, 20)) {
    console.log(`  Line ${gap.lineId} seg[${gap.segIdx}]: ${gap.gap.toFixed(2)}m ${gap.type}`);
  }
}

// =============================================================================
// Summary
// =============================================================================
console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`
Total trains: ${trainSchedules.trains.length}
Zero duration runs: ${zeroDurationRuns.length}
Tiny duration runs: ${tinyDurationRuns.length}
Tiny segments: ${tinySegments.length}
Continuity gaps: ${continuityGaps.length}

LIKELY JITTER CAUSES:
${tinyDurationRuns.length > 0 ? '✗ TINY DURATIONS - trains skip through segments faster than frame rate' : '✓ No tiny duration issues'}
${tinySegments.length > 0 ? '✗ TINY SEGMENTS - short segments cause interpolation issues' : '✓ No tiny segment issues'}
${continuityGaps.length > 0 ? '✗ CONTINUITY GAPS - trains may appear to teleport between segments' : '✓ No continuity issues'}
`);

// Identify specific trains to debug
if (tinyDurationRuns.length > 0) {
  console.log('\nRECOMMENDED DEBUG TRAINS (set DEBUG_TRAIN_ID in TrainEngine.ts):');
  const uniqueTrips = new Set<string>();
  for (const run of tinyDurationRuns.slice(0, 10)) {
    const tripId = (run as any).tripId || run.id.split('-seg')[0];
    if (!uniqueTrips.has(tripId)) {
      uniqueTrips.add(tripId);
      console.log(`  "${run.id}" - Line ${run.lineId}, ${((run.tExit - run.tEnter) * CYCLE_DURATION_SECONDS * 1000).toFixed(1)}ms duration`);
    }
  }
}
