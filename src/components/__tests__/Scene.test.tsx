/**
 * Tests for Scene component
 *
 * TDD: These tests define the expected behavior for the R3F scene wrapper.
 *
 * Note: R3F Canvas requires WebGL which isn't available in jsdom.
 * We mock the Canvas and hooks to test component structure and props.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Create a mock scene object for Environment to manipulate
const mockScene = {
  fog: null as unknown,
  background: null as unknown,
};

// Mock react-three-fiber since WebGL isn't available in jsdom
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, camera, ...props }: { children: React.ReactNode; camera?: object; [key: string]: unknown }) => (
    <div data-testid="r3f-canvas" data-camera={JSON.stringify(camera)} {...props}>
      {children}
    </div>
  ),
  useThree: () => ({
    scene: mockScene,
    camera: {},
    gl: {},
  }),
}));

// Mock drei components
vi.mock('@react-three/drei', () => ({
  OrbitControls: (props: Record<string, unknown>) => (
    <div data-testid="orbit-controls" data-props={JSON.stringify(props)} />
  ),
}));

// Import after mocks are set up
import { Scene } from '../Scene';

describe('Scene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScene.fog = null;
    mockScene.background = null;
  });

  it('renders without crashing', () => {
    expect(() => render(<Scene />)).not.toThrow();
  });

  it('renders R3F Canvas', () => {
    render(<Scene />);
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
  });

  it('configures perspective camera', () => {
    render(<Scene />);
    const canvas = screen.getByTestId('r3f-canvas');
    const cameraConfig = canvas.getAttribute('data-camera');

    expect(cameraConfig).toBeTruthy();
    const camera = JSON.parse(cameraConfig!) as {
      fov: number;
      near: number;
      far: number;
      position: [number, number, number];
    };

    // Should have reasonable defaults for city visualization
    expect(camera.fov).toBeGreaterThanOrEqual(45);
    expect(camera.fov).toBeLessThanOrEqual(75);
    expect(camera.near).toBeLessThan(10);
    expect(camera.far).toBeGreaterThan(5000);
  });

  it('includes OrbitControls for camera interaction', () => {
    render(<Scene />);
    expect(screen.getByTestId('orbit-controls')).toBeInTheDocument();
  });

  it('renders children inside Canvas', () => {
    render(
      <Scene>
        <div data-testid="child-element">Test Child</div>
      </Scene>
    );
    expect(screen.getByTestId('child-element')).toBeInTheDocument();
  });
});
