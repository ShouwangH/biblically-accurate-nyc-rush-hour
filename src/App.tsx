/**
 * Root application component.
 *
 * Renders the main 3D visualization with all layers:
 * - Buildings (static glTF)
 * - SubwayLines (tube geometries)
 * - RoadSegments (line geometry)
 * - Trains (instanced, animated)
 * - StationBeams (instanced, animated)
 * - Traffic (instanced, animated)
 * - PostProcessing (bloom, vignette)
 */
import { Suspense } from 'react';
import { Scene } from './components/Scene';
import { GroundPlane } from './components/GroundPlane';
import { Buildings } from './components/Buildings';
import { SubwayLines } from './components/SubwayLines';
import { RoadSegments } from './components/RoadSegments';
import { Trains } from './components/Trains';
import { StationBeams } from './components/StationBeams';
import { Traffic } from './components/Traffic';
import { PostProcessing } from './components/PostProcessing';
import {
  CameraController,
  CameraControllerProvider,
} from './components/CameraController';
import { Overlay, Controls } from './components/UI';
import { DataProvider } from './hooks/useDataLoader';
import { SimulationTimeProvider } from './hooks/useSimulationTime';

/**
 * Loading indicator shown while data is being fetched.
 */
function LoadingScreen() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a2e',
        color: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '1.5rem',
      }}
    >
      Loading NYC Rush Hour...
    </div>
  );
}

export function App() {
  return (
    <DataProvider>
      <SimulationTimeProvider>
        <CameraControllerProvider initialMode="manual">
          <div
            style={{
              width: '100vw',
              height: '100vh',
              margin: 0,
              padding: 0,
              overflow: 'hidden',
            }}
          >
            <Suspense fallback={<LoadingScreen />}>
              <Scene>
                {/* Camera control */}
                <CameraController />

                {/* Ground plane (rendered first, underneath everything) */}
                <GroundPlane />

                {/* Static geometry */}
                <Buildings />
                <SubwayLines />
                <RoadSegments />

                {/* Animated instanced meshes */}
                <Trains />
                <StationBeams />
                <Traffic />

                {/* Post-processing effects */}
                <PostProcessing />
              </Scene>
            </Suspense>

            {/* UI Overlay (outside Canvas) */}
            <Overlay />
            <Controls />
          </div>
        </CameraControllerProvider>
      </SimulationTimeProvider>
    </DataProvider>
  );
}
