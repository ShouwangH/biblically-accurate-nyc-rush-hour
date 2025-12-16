/**
 * Controls Component
 *
 * Playback controls for the simulation:
 * - Play/Pause button
 * - Time scrubber
 * - Speed control
 *
 * Positioned at bottom of screen.
 */
import { useSimulationTime } from '../../hooks/useSimulationTime';

// =============================================================================
// Styles
// =============================================================================

const controlsStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '20px',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  borderRadius: '12px',
  padding: '12px 20px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  pointerEvents: 'auto',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  zIndex: 100,
};

const buttonStyle: React.CSSProperties = {
  width: '44px',
  height: '44px',
  borderRadius: '50%',
  border: 'none',
  backgroundColor: '#0039A6',
  color: '#fff',
  fontSize: '1.25rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background-color 0.2s',
};

const scrubberContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const scrubberStyle: React.CSSProperties = {
  width: '200px',
  height: '6px',
  cursor: 'pointer',
  accentColor: '#0039A6',
};

const timeDisplayStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  color: '#333',
  minWidth: '50px',
};

const speedContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const speedLabelStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#666',
};

const speedSelectStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid #ddd',
  backgroundColor: '#fff',
  fontSize: '0.875rem',
  cursor: 'pointer',
};

// =============================================================================
// Component
// =============================================================================

/**
 * Controls provides playback controls for the simulation.
 *
 * Features:
 * - Play/pause toggle button
 * - Time scrubber for seeking
 * - Speed selector (0.5x, 1x, 2x, 5x)
 * - Current time display
 *
 * Usage:
 * ```tsx
 * <div style={{ position: 'relative' }}>
 *   <Canvas>...</Canvas>
 *   <Controls />
 * </div>
 * ```
 */
export function Controls() {
  const { t, displayTime, isPlaying, speed, toggle, setTime, setSpeed } =
    useSimulationTime();

  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setTime(value / 100);
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = parseFloat(e.target.value);
    setSpeed(value);
  };

  return (
    <div data-testid="controls" style={controlsStyle}>
      {/* Play/Pause Button */}
      <button
        data-testid="play-pause-button"
        style={buttonStyle}
        onClick={toggle}
        aria-label={isPlaying ? 'Pause simulation' : 'Play simulation'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Time Scrubber */}
      <div style={scrubberContainerStyle}>
        <input
          data-testid="time-scrubber"
          type="range"
          min="0"
          max="100"
          value={t * 100}
          onChange={handleScrubberChange}
          style={scrubberStyle}
          aria-label="Simulation time scrubber"
        />
        <span style={timeDisplayStyle}>{displayTime}</span>
      </div>

      {/* Speed Control */}
      <div data-testid="speed-control" style={speedContainerStyle}>
        <span style={speedLabelStyle}>Speed:</span>
        <select
          value={speed}
          onChange={handleSpeedChange}
          style={speedSelectStyle}
          aria-label="Playback speed"
        >
          <option value="0.5">0.5x</option>
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="5">5x</option>
        </select>
      </div>
    </div>
  );
}
