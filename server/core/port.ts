// Deterministic port for a diagram: one server per diagram, one URL per tab.
// Derived from the pair's realpath so the same diagram always maps to the same
// port across sessions — no lockfile, no discovery file. The port-bind itself
// is the lock (see the CLI's reuse-or-fallback logic).

import { createHash } from 'node:crypto'

// IANA dynamic/ephemeral range: 49152–65535 (16384 ports).
const RANGE_START = 49152
const RANGE_SIZE = 16384

/**
 * Map a pair's canonical (realpath) identifier to a stable port in the IANA
 * ephemeral range. Use the realpath of the `.epr.d2` so the layout sidecar and
 * the d2 resolve to the *same* server.
 */
export const portForPath = (realPath: string): number => {
  const digest = createHash('sha256').update(realPath).digest()
  // First 4 bytes as an unsigned int, modulo the range.
  const n = digest.readUInt32BE(0)
  return RANGE_START + (n % RANGE_SIZE)
}
