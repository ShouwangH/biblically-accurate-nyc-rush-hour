/**
 * Overlay Component Tests
 *
 * Tests for the UI overlay showing legend.
 * Per CLAUDE.md §8.7: TDD - tests define invariants.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Overlay } from '../Overlay';

describe('Overlay', () => {
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
    it('positions overlay absolutely', () => {
      render(<Overlay />);
      const overlay = screen.getByTestId('overlay');
      const style = window.getComputedStyle(overlay);
      expect(style.position).toBe('absolute');
    });

    it('does not block 3D interaction (pointer-events)', () => {
      render(<Overlay />);
      const overlay = screen.getByTestId('overlay');
      const style = window.getComputedStyle(overlay);
      expect(style.pointerEvents).toBe('none');
    });
  });
});
