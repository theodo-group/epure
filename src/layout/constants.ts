// Tuning shared by the stages that keep edges apart after routing: the grid
// snap and the synthetic-path overlap fix.

/** Distance (px) under which two coordinates are the same: libavoid returns
 *  values such as 680.0000004. */
export const AXIS_TOLERANCE = 0.5

/** Two parallel legs closer than this (px) read as one line. Half a grid cell. */
export const laneWidth = (gridSize: number): number => gridSize / 2

/** Shortest side-by-side stretch (px) that counts as two legs sharing a run.
 *  The synthetic-path pass also treats two legs closer than this as one. */
export const OVERLAP_MIN = 4
