/**
 * Slice Index Utility
 *
 * Converts simulation time [0, 1) to slice index [0, 59].
 * This is the canonical implementation used by all simulation layers.
 *
 * Invariants (enforced by tests):
 * - NUM_SLICES = 60
 * - getSliceIndex always returns integers in [0, 59]
 * - Never returns 60, even for t >= 1
 */

/** Number of time slices in the simulation (1 per minute for 8-9am) */
export const NUM_SLICES = 60;

/**
 * Convert simulation time to slice index.
 *
 * @param simulationTime - Time value, typically in [0, 1)
 * @returns Slice index in [0, 59]
 *
 * @example
 * getSliceIndex(0)     // 0
 * getSliceIndex(0.5)   // 30
 * getSliceIndex(0.999) // 59
 * getSliceIndex(1)     // 59 (clamped)
 */
export function getSliceIndex(simulationTime: number): number {
  // Clamp negative values to 0
  if (simulationTime < 0) {
    return 0;
  }

  // Calculate raw index and clamp to valid range
  const rawIndex = Math.floor(simulationTime * NUM_SLICES);
  return Math.min(rawIndex, NUM_SLICES - 1);
}
