/**
 * Overlay Component
 *
 * Displays legend for the visualization.
 * Positioned in corner, doesn't block 3D interaction.
 */

// =============================================================================
// Styles
// =============================================================================

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  padding: '20px',
  pointerEvents: 'none',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#333',
  zIndex: 100,
};

const legendContainerStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '80px',
  left: '20px',
  backgroundColor: 'rgba(255, 255, 255, 0.9)',
  borderRadius: '8px',
  padding: '12px 16px',
  pointerEvents: 'auto',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  fontSize: '0.875rem',
};

const legendTitleStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#666',
  marginBottom: '8px',
};

const legendItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '6px',
};

const legendColorStyle = (color: string): React.CSSProperties => ({
  width: '16px',
  height: '16px',
  borderRadius: '3px',
  backgroundColor: color,
});

const legendGradientStyle: React.CSSProperties = {
  width: '60px',
  height: '12px',
  borderRadius: '2px',
  background: 'linear-gradient(to right, #FFD700, #FF4444)',
};

const legendBeamStyle: React.CSSProperties = {
  width: '8px',
  height: '20px',
  borderRadius: '2px',
  background: 'linear-gradient(to top, #4488FF, #AADDFF)',
};

// =============================================================================
// Component
// =============================================================================

/**
 * Overlay displays legend explaining visual encodings.
 *
 * Usage:
 * ```tsx
 * <div style={{ position: 'relative' }}>
 *   <Canvas>...</Canvas>
 *   <Overlay />
 * </div>
 * ```
 */
export function Overlay() {
  return (
    <div data-testid="overlay" style={overlayStyle}>
      {/* Legend */}
      <div data-testid="legend" style={legendContainerStyle}>
        <div style={legendTitleStyle}>Legend</div>

        {/* Subway lines */}
        <div style={legendItemStyle}>
          <div style={legendColorStyle('#0039A6')} />
          <span>Subway lines (by route color)</span>
        </div>

        {/* Station activity */}
        <div style={legendItemStyle}>
          <div style={legendBeamStyle} />
          <span>Station intensity/activity</span>
        </div>

        {/* Traffic congestion */}
        <div style={legendItemStyle}>
          <div style={legendGradientStyle} />
          <span>Traffic congestion (gold → red)</span>
        </div>
      </div>
    </div>
  );
}
