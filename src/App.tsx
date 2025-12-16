/**
 * Root application component.
 *
 * Renders the main 3D visualization with all layers:
 * - Buildings (static glTF)
 * - SubwayLines (tube geometries)
 * - Trains (instanced, animated)
 * - StationBeams (instanced, animated)
 * - Traffic (instanced, animated)
 */
import { Suspense } from 'react';
import { Scene } from './components/Scene';
import { Buildings } from './components/Buildings';
import { SubwayLines } from './components/SubwayLines';
import { Trains } from './components/Trains';
import { StationBeams } from './components/StationBeams';
import { Traffic } from './components/Traffic';
import { LoadingScreen } from './components/LoadingScreen';
import { DataProvider, useData } from './hooks/useDataLoader';
import { SimulationTimeProvider } from './hooks/useSimulationTime';
import { CameraControllerProvider } from './components/CameraController';

/**
 * Error screen shown when data loading fails.
 */
function ErrorScreen({ message }: { message: string }) {
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
      <div
        style={{
          fontSize: '1.5rem',
          fontWeight: 500,
          marginBottom: '1rem',
          color: '#c00',
        }}
      >
        Error Loading Data
      </div>
      <div
        style={{
          fontSize: '1rem',
          color: '#666',
          maxWidth: '400px',
          textAlign: 'center',
        }}
      >
        {message}
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: '2rem',
          padding: '0.75rem 1.5rem',
          fontSize: '1rem',
          backgroundColor: '#0039A6',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Main visualization component that handles data loading states.
 */
function Visualization() {
  const { data, isLoading, error } = useData();

  // Show loading screen while data is being fetched
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Show error screen if data loading failed
  if (error) {
    return <ErrorScreen message={error.message} />;
  }

  // Show error if data is unexpectedly null after loading
  if (!data) {
    return <ErrorScreen message="Data loaded but was empty. Please try again." />;
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <Suspense fallback={<LoadingScreen message="Loading 3D assets..." />}>
        <Scene>
          {/* Static geometry */}
          <Buildings />
          <SubwayLines />

          {/* Animated instanced meshes */}
          <Trains />
          <StationBeams />
          <Traffic />
        </Scene>
      </Suspense>
    </div>
  );
}

export function App() {
  return (
    <DataProvider>
      <SimulationTimeProvider>
        <CameraControllerProvider>
          <Visualization />
        </CameraControllerProvider>
      </SimulationTimeProvider>
    </DataProvider>
  );
}
