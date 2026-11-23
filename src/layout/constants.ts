// Tuning shared by the stages that keep edges apart after routing: the grid
// snap, the shared-run separation pass and the synthetic-path overlap fix.

/** Distance (px) under which two coordinates are the same: libavoid returns
 *  values such as 680.0000004. */
export const AXIS_TOLERANCE = 0.5

/** Inset (px) of a shape for hit tests: a route that only grazes a node's
 *  border does not cross it. */
export const CROSS_INSET = 1.5

/** Two parallel legs closer than this (px) read as one line. Half a grid cell. */
export const laneWidth = (gridSize: number): number => gridSize / 2

/** Shortest side-by-side stretch (px) that counts as two legs sharing a run.
 *  The synthetic-path pass also treats two legs closer than this as one. */
export const OVERLAP_MIN = 4

/** Distance (px) a crossing point must keep from both legs' ends to count as a
 *  crossing, and the shortest leg (px) a slide may leave next to a corner. */
export const CROSSING_MARGIN = 1

/** Lane offsets the separation pass tries, in grid cells, on each side. */
export const SLIDE_STEPS_IN_CELLS = [0.5, 1, 1.5, 2, 2.5, 3]

/** Extra distance (grid cells) charged to a move that slides a port along its
 *  node face, so that at equal cost an interior leg moves instead. */
export const PORT_SLIDE_PENALTY_IN_CELLS = 1

/** Rounds of the separation pass. The pass usually converges in one or two;
 *  the cap stops it on dense diagrams and leaves the remaining defects. */
export const MAX_SEPARATION_ROUNDS = 4

/** Separation-pass costs (unitless): a shared run, a crossing, and a crossing
 *  within a grid cell of a corner (its gap reads as a broken stub). */
export const RUN_COST = 4
export const CROSS_COST = 1
export const TIGHT_CROSS_COST = 3
