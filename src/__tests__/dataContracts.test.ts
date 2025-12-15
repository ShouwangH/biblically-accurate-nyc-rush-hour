/**
 * Data Contract Validation Tests
 *
 * These tests verify that sample data files match the TypeScript interfaces.
 * Following TDD: these tests were written FIRST to define the contracts.
 */
import { describe, it, expect } from 'vitest';
import type {
  StationsFile,
  StationData,
  SubwayLinesFile,
  SubwayLine,
  TrainSchedulesFile,
  TrainRun,
  RoadSegmentsFile,
  RoadSegment,
} from '../data/types';

// Import sample data
import stationsSample from '../assets/stations.sample.json';
import subwayLinesSample from '../assets/subway_lines.sample.json';
import trainSchedulesSample from '../assets/train_schedules.sample.json';
import roadSegmentsSample from '../assets/road_segments.sample.json';

describe('Data Contract: stations.json', () => {
  const data = stationsSample as StationsFile;

  describe('meta', () => {
    it('has timeSlices = 60', () => {
      expect(data.meta.timeSlices).toBe(60);
    });

    it('has timeRange = [0, 1]', () => {
      expect(data.meta.timeRange).toEqual([0, 1]);
    });

    it('has normalization = "global"', () => {
      expect(data.meta.normalization).toBe('global');
    });

    it('has maxEntriesPerSlice as positive number', () => {
      expect(data.meta.maxEntriesPerSlice).toBeGreaterThan(0);
    });

    it('has minIntensityFloor in valid range', () => {
      expect(data.meta.minIntensityFloor).toBeGreaterThanOrEqual(0);
      expect(data.meta.minIntensityFloor).toBeLessThanOrEqual(1);
    });
  });

  describe('stations array', () => {
    it('has at least one station', () => {
      expect(data.stations.length).toBeGreaterThan(0);
    });

    it('each station has required fields', () => {
      data.stations.forEach((station: StationData) => {
        expect(station).toHaveProperty('id');
        expect(station).toHaveProperty('name');
        expect(station).toHaveProperty('lines');
        expect(station).toHaveProperty('position');
        expect(station).toHaveProperty('surfacePosition');
        expect(station).toHaveProperty('intensities');
      });
    });

    it('each station has position as [x, y, z] tuple', () => {
      data.stations.forEach((station: StationData) => {
        expect(station.position).toHaveLength(3);
        expect(typeof station.position[0]).toBe('number');
        expect(typeof station.position[1]).toBe('number');
        expect(typeof station.position[2]).toBe('number');
      });
    });

    it('each station has surfacePosition at y=0', () => {
      data.stations.forEach((station: StationData) => {
        expect(station.surfacePosition).toHaveLength(3);
        expect(station.surfacePosition[1]).toBe(0);
      });
    });

    it('each station has intensities array of length 60', () => {
      data.stations.forEach((station: StationData) => {
        expect(station.intensities).toHaveLength(60);
      });
    });

    it('all intensities are in valid range [0, 1]', () => {
      data.stations.forEach((station: StationData) => {
        station.intensities.forEach((intensity: number) => {
          expect(intensity).toBeGreaterThanOrEqual(0);
          expect(intensity).toBeLessThanOrEqual(1);
        });
      });
    });

    it('all intensities respect minIntensityFloor', () => {
      const floor = data.meta.minIntensityFloor;
      data.stations.forEach((station: StationData) => {
        station.intensities.forEach((intensity: number) => {
          expect(intensity).toBeGreaterThanOrEqual(floor);
        });
      });
    });

    it('each station has at least one subway line', () => {
      data.stations.forEach((station: StationData) => {
        expect(station.lines.length).toBeGreaterThan(0);
      });
    });
  });
});

describe('Data Contract: subway_lines.json', () => {
  const data = subwayLinesSample as SubwayLinesFile;

  it('has lines array', () => {
    expect(data).toHaveProperty('lines');
    expect(Array.isArray(data.lines)).toBe(true);
  });

  it('has at least one line', () => {
    expect(data.lines.length).toBeGreaterThan(0);
  });

  describe('each line', () => {
    it('has required fields', () => {
      data.lines.forEach((line: SubwayLine) => {
        expect(line).toHaveProperty('id');
        expect(line).toHaveProperty('name');
        expect(line).toHaveProperty('color');
        expect(line).toHaveProperty('glowColor');
        expect(line).toHaveProperty('segments');
        expect(line).toHaveProperty('depth');
      });
    });

    it('has valid hex color format', () => {
      const hexRegex = /^#[0-9A-Fa-f]{6}$/;
      data.lines.forEach((line: SubwayLine) => {
        expect(line.color).toMatch(hexRegex);
        expect(line.glowColor).toMatch(hexRegex);
      });
    });

    it('has negative depth (underground)', () => {
      data.lines.forEach((line: SubwayLine) => {
        expect(line.depth).toBeLessThan(0);
      });
    });

    it('has at least one segment', () => {
      data.lines.forEach((line: SubwayLine) => {
        expect(line.segments.length).toBeGreaterThan(0);
      });
    });

    it('each segment has at least 2 points', () => {
      data.lines.forEach((line: SubwayLine) => {
        line.segments.forEach((segment) => {
          expect(segment.points.length).toBeGreaterThanOrEqual(2);
        });
      });
    });

    it('each point is [x, y, z] tuple', () => {
      data.lines.forEach((line: SubwayLine) => {
        line.segments.forEach((segment) => {
          segment.points.forEach((point) => {
            expect(point).toHaveLength(3);
            expect(typeof point[0]).toBe('number');
            expect(typeof point[1]).toBe('number');
            expect(typeof point[2]).toBe('number');
          });
        });
      });
    });
  });
});

describe('Data Contract: train_schedules.json', () => {
  const data = trainSchedulesSample as TrainSchedulesFile;

  describe('meta', () => {
    it('has interpolationMode = "linear"', () => {
      expect(data.meta.interpolationMode).toBe('linear');
    });
  });

  it('has trains array', () => {
    expect(data).toHaveProperty('trains');
    expect(Array.isArray(data.trains)).toBe(true);
  });

  it('has at least one train', () => {
    expect(data.trains.length).toBeGreaterThan(0);
  });

  describe('each train', () => {
    it('has required fields', () => {
      data.trains.forEach((train: TrainRun) => {
        expect(train).toHaveProperty('id');
        expect(train).toHaveProperty('lineId');
        expect(train).toHaveProperty('segmentIndex');
        expect(train).toHaveProperty('direction');
        expect(train).toHaveProperty('tEnter');
        expect(train).toHaveProperty('tExit');
        expect(train).toHaveProperty('crowding');
      });
    });

    it('has direction as 1 or -1', () => {
      data.trains.forEach((train: TrainRun) => {
        expect([1, -1]).toContain(train.direction);
      });
    });

    it('has tEnter and tExit in [0, 1) range', () => {
      data.trains.forEach((train: TrainRun) => {
        expect(train.tEnter).toBeGreaterThanOrEqual(0);
        expect(train.tEnter).toBeLessThan(1);
        expect(train.tExit).toBeGreaterThanOrEqual(0);
        expect(train.tExit).toBeLessThanOrEqual(1);
      });
    });

    it('has tEnter < tExit', () => {
      data.trains.forEach((train: TrainRun) => {
        expect(train.tEnter).toBeLessThan(train.tExit);
      });
    });

    it('has crowding in [0, 1] range', () => {
      data.trains.forEach((train: TrainRun) => {
        expect(train.crowding).toBeGreaterThanOrEqual(0);
        expect(train.crowding).toBeLessThanOrEqual(1);
      });
    });

    it('has non-negative segmentIndex', () => {
      data.trains.forEach((train: TrainRun) => {
        expect(train.segmentIndex).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

describe('Data Contract: road_segments.json', () => {
  const data = roadSegmentsSample as RoadSegmentsFile;

  describe('meta', () => {
    it('has timeSlices = 60', () => {
      expect(data.meta.timeSlices).toBe(60);
    });

    it('has vehicleTypes array', () => {
      expect(data.meta.vehicleTypes).toEqual(['taxi', 'fhv']);
    });
  });

  it('has segments array', () => {
    expect(data).toHaveProperty('segments');
    expect(Array.isArray(data.segments)).toBe(true);
  });

  it('has at least one segment', () => {
    expect(data.segments.length).toBeGreaterThan(0);
  });

  describe('each segment', () => {
    it('has required fields', () => {
      data.segments.forEach((segment: RoadSegment) => {
        expect(segment).toHaveProperty('id');
        expect(segment).toHaveProperty('type');
        expect(segment).toHaveProperty('points');
        expect(segment).toHaveProperty('avgSpeedMph');
        expect(segment).toHaveProperty('freeFlowSpeedMph');
        expect(segment).toHaveProperty('congestionFactor');
        expect(segment).toHaveProperty('spawnRates');
      });
    });

    it('has valid type', () => {
      const validTypes = ['avenue', 'street', 'highway'];
      data.segments.forEach((segment: RoadSegment) => {
        expect(validTypes).toContain(segment.type);
      });
    });

    it('has at least 2 points', () => {
      data.segments.forEach((segment: RoadSegment) => {
        expect(segment.points.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('each point is [x, y, z] with y=0 (street level)', () => {
      data.segments.forEach((segment: RoadSegment) => {
        segment.points.forEach((point) => {
          expect(point).toHaveLength(3);
          expect(point[1]).toBe(0); // street level
        });
      });
    });

    it('has positive speed values', () => {
      data.segments.forEach((segment: RoadSegment) => {
        expect(segment.avgSpeedMph).toBeGreaterThan(0);
        expect(segment.freeFlowSpeedMph).toBeGreaterThan(0);
      });
    });

    it('has congestionFactor in (0, 1] range', () => {
      data.segments.forEach((segment: RoadSegment) => {
        expect(segment.congestionFactor).toBeGreaterThan(0);
        expect(segment.congestionFactor).toBeLessThanOrEqual(1);
      });
    });

    it('has avgSpeed <= freeFlowSpeed (congestion slows traffic)', () => {
      data.segments.forEach((segment: RoadSegment) => {
        expect(segment.avgSpeedMph).toBeLessThanOrEqual(segment.freeFlowSpeedMph);
      });
    });

    it('has spawnRates array of length 60', () => {
      data.segments.forEach((segment: RoadSegment) => {
        expect(segment.spawnRates).toHaveLength(60);
      });
    });

    it('has non-negative spawn rates', () => {
      data.segments.forEach((segment: RoadSegment) => {
        segment.spawnRates.forEach((rate: number) => {
          expect(rate).toBeGreaterThanOrEqual(0);
        });
      });
    });
  });
});
