/**
 * Overlay Component Tests
 *
<<<<<<< feat/real-data
 * Tests for the UI overlay showing legend.
 * Per CLAUDE.md §8.7: TDD - tests define invariants.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Overlay } from '../Overlay';

describe('Overlay', () => {
=======
 * Tests for the UI overlay showing clock and legend.
 * Per CLAUDE.md §8.7: TDD - tests define invariants.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Overlay } from '../Overlay';

// Mock useSimulationTime hook
vi.mock('../../../hooks/useSimulationTime', () => ({
  useSimulationTime: () => ({
    t: 0.5,
    displayTime: '12:00',
    isPlaying: true,
    sliceIndex: 30,
  }),
}));

describe('Overlay', () => {
  describe('clock display', () => {
    it('renders the clock', () => {
      render(<Overlay />);
      expect(screen.getByTestId('clock')).toBeInTheDocument();
    });

    it('displays the simulation time', () => {
      render(<Overlay />);
      expect(screen.getByText('12:00')).toBeInTheDocument();
    });

    it('shows AM/PM indicator or 24h format', () => {
      render(<Overlay />);
      const clock = screen.getByTestId('clock');
      // Should contain time in some format
      expect(clock.textContent).toMatch(/\d{1,2}:\d{2}/);
    });
  });

>>>>>>> main
  describe('legend', () => {
    it('renders the legend section', () => {
      render(<Overlay />);
      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });

    it('explains subway line colors', () => {
      render(<Overlay />);
      const legend = screen.getByTestId('legend');
      expect(legend.textContent).toMatch(/subway|line/i);
    });

    it('explains station beam intensity', () => {
      render(<Overlay />);
      const legend = screen.getByTestId('legend');
      expect(legend.textContent).toMatch(/station|intensity|activity/i);
    });

    it('explains traffic congestion colors', () => {
      render(<Overlay />);
      const legend = screen.getByTestId('legend');
      expect(legend.textContent).toMatch(/traffic|congestion/i);
    });
  });

  describe('styling', () => {
    it('positions overlay in corner', () => {
      render(<Overlay />);
      const overlay = screen.getByTestId('overlay');
      const style = window.getComputedStyle(overlay);
      expect(style.position).toBe('absolute');
    });

<<<<<<< feat/real-data
=======
    it('has readable font size', () => {
      render(<Overlay />);
      const clock = screen.getByTestId('clock');
      const style = window.getComputedStyle(clock);
      // Font size should be set (in rem or px)
      // jsdom doesn't compute rem to px, so just check fontSize is defined
      expect(style.fontSize).toBeTruthy();
      // Should have a numeric value
      expect(parseFloat(style.fontSize)).toBeGreaterThan(0);
    });

>>>>>>> main
    it('does not block 3D interaction (pointer-events)', () => {
      render(<Overlay />);
      const overlay = screen.getByTestId('overlay');
      const style = window.getComputedStyle(overlay);
      expect(style.pointerEvents).toBe('none');
    });
  });
<<<<<<< feat/real-data
=======

  describe('title', () => {
    it('displays visualization title', () => {
      render(<Overlay />);
      expect(screen.getByText(/NYC Rush Hour/i)).toBeInTheDocument();
    });
  });
>>>>>>> main
});
