/**
 * Controls Component Tests
 *
 * Tests for playback controls (play/pause, scrubber, speed).
 * Per CLAUDE.md §8.7: TDD - tests define invariants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Controls } from '../Controls';

// Mock functions for simulation time
const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockToggle = vi.fn();
const mockSetTime = vi.fn();
const mockSetSpeed = vi.fn();

// Mock useSimulationTime hook
vi.mock('../../../hooks/useSimulationTime', () => ({
  useSimulationTime: () => ({
    t: 0.5,
    displayTime: '12:00',
    isPlaying: true,
    speed: 1,
    play: mockPlay,
    pause: mockPause,
    toggle: mockToggle,
    setTime: mockSetTime,
    setSpeed: mockSetSpeed,
  }),
}));

describe('Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('play/pause button', () => {
    it('renders play/pause button', () => {
      render(<Controls />);
      expect(screen.getByTestId('play-pause-button')).toBeInTheDocument();
    });

    it('calls toggle when clicked', () => {
      render(<Controls />);
      const button = screen.getByTestId('play-pause-button');
      fireEvent.click(button);
      expect(mockToggle).toHaveBeenCalledTimes(1);
    });

    it('shows pause icon when playing', () => {
      render(<Controls />);
      const button = screen.getByTestId('play-pause-button');
      // Should show pause icon (two bars) when playing
      expect(button.textContent).toMatch(/pause|⏸|❚❚|\|\|/i);
    });
  });

  describe('time scrubber', () => {
    it('renders time scrubber/slider', () => {
      render(<Controls />);
      expect(screen.getByTestId('time-scrubber')).toBeInTheDocument();
    });

    it('shows current time position', () => {
      render(<Controls />);
      const scrubber = screen.getByTestId('time-scrubber') as HTMLInputElement;
      // At t=0.5, scrubber should be at 50%
      expect(parseFloat(scrubber.value)).toBeCloseTo(50, 0);
    });

    it('calls setTime when scrubbed', () => {
      render(<Controls />);
      const scrubber = screen.getByTestId('time-scrubber');
      fireEvent.change(scrubber, { target: { value: '75' } });
      expect(mockSetTime).toHaveBeenCalledWith(0.75);
    });
  });

  describe('speed control', () => {
    it('renders speed control', () => {
      render(<Controls />);
      expect(screen.getByTestId('speed-control')).toBeInTheDocument();
    });

    it('shows current speed', () => {
      render(<Controls />);
      expect(screen.getByText(/1x|1\.0x/)).toBeInTheDocument();
    });

    it('allows speed adjustment', () => {
      render(<Controls />);
      const speedControl = screen.getByTestId('speed-control');
      // Speed control should be interactive
      expect(speedControl).not.toBeDisabled();
    });
  });

  describe('time display', () => {
    it('shows current simulation time', () => {
      render(<Controls />);
      expect(screen.getByText('12:00')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('positions controls at bottom', () => {
      render(<Controls />);
      const controls = screen.getByTestId('controls');
      const style = window.getComputedStyle(controls);
      expect(style.position).toBe('absolute');
      expect(style.bottom).toBeDefined();
    });

    it('allows pointer events for interaction', () => {
      render(<Controls />);
      const controls = screen.getByTestId('controls');
      const style = window.getComputedStyle(controls);
      expect(style.pointerEvents).toBe('auto');
    });
  });

  describe('accessibility', () => {
    it('play/pause button has aria-label', () => {
      render(<Controls />);
      const button = screen.getByTestId('play-pause-button');
      expect(button).toHaveAttribute('aria-label');
    });

    it('scrubber has aria-label', () => {
      render(<Controls />);
      const scrubber = screen.getByTestId('time-scrubber');
      expect(scrubber).toHaveAttribute('aria-label');
    });
  });
});
