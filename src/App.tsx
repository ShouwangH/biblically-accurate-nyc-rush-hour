/**
 * Root application component.
 *
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
