/**
 * Root application component.
 *
 * Renders the main 3D scene with environment and buildings.
 * Will be wrapped with providers (DataProvider, SimulationTimeProvider) in future PRs.
 */
import { Suspense } from 'react';
import { Scene } from './components/Scene';
import { Buildings } from './components/Buildings';

export function App() {
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
      <Scene>
        <Suspense fallback={null}>
          <Buildings />
        </Suspense>
        {/* Future components will be added here:
         * - SubwayLines
         * - Trains
         * - StationBeams
         * - Traffic
         */}
      </Scene>
    </div>
  );
}
