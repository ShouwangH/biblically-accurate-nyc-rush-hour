/**
 * Root application component.
 *
 * Wrapped with DataProvider to load simulation data.
 * Future PRs will add SimulationTimeProvider and Scene components.
 */
import { DataProvider, useData } from './hooks/useDataLoader';
import { LoadingScreen } from './components/LoadingScreen';

/**
 * Main content component that consumes data context.
 */
function AppContent() {
  const { data, isLoading, error } = useData();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (error) {
    return <LoadingScreen message={`Error: ${error.message}`} />;
  }

  // Data is loaded - show summary for now
  // Future PRs will render Scene with Buildings, Trains, etc.
 * Renders the main 3D scene with environment.
 * Will be wrapped with providers (DataProvider, SimulationTimeProvider) in future PRs.
 */
import { Scene } from './components/Scene';

export function App() {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F5F5F0',
        color: '#333',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: '1rem' }}>NYC Rush Hour</h1>
      <p style={{ color: '#666' }}>
        Loaded {data?.stations.stations.length ?? 0} stations,{' '}
        {data?.subwayLines.lines.length ?? 0} subway lines,{' '}
        {data?.trainSchedules.trains.length ?? 0} train runs,{' '}
        {data?.roadSegments.segments.length ?? 0} road segments
      </p>
        margin: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <Scene>
        {/* Future components will be added here:
         * - Buildings
         * - SubwayLines
         * - Trains
         * - StationBeams
         * - Traffic
         */}
      </Scene>
    </div>
  );
}

/**
 * Root App component with providers.
 */
export function App() {
  return (
    <DataProvider>
      <AppContent />
    </DataProvider>
  );
}
