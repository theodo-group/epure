// Undo-burst coalescing: rapid edits (a burst of keystrokes, a drag) group
// into ONE undo step — the state before the first change of a burst is
// recorded, further snapshots are suppressed until ~350ms of quiet.
//
// The state lives here, outside the store, so the edit paths that must stand
// alone as their own undo step (open, format, a remote apply) can close the
// burst around themselves without pulling in the whole store.

const BURST_QUIET_MS = 350

const burstState: {
  timeout: ReturnType<typeof setTimeout> | undefined
  active: boolean
} = { timeout: undefined, active: false }

/** zundo `handleSet` body: record `record()` only for the first change of a
 *  burst, and (re)start the quiet window. */
export const recordInBurst = (record: () => void): void => {
  if (!burstState.active) {
    burstState.active = true
    record()
  }
  if (burstState.timeout) clearTimeout(burstState.timeout)
  burstState.timeout = setTimeout(() => {
    burstState.active = false
  }, BURST_QUIET_MS)
}

/** Reset the in-flight undo-burst window so the next tracked change opens a
 *  fresh snapshot. Without it, a local edit landing <350ms after a remote
 *  apply would fuse into the *pre-remote* undo step. */
export const flushBurst = (): void => {
  if (burstState.timeout) clearTimeout(burstState.timeout)
  burstState.timeout = undefined
  burstState.active = false
}

/** Run `edit` as its own undo step: close any burst in progress first (so the
 *  edit isn't folded into it) and after (so the next edit starts its own). */
export const asOneUndoStep = (edit: () => void): void => {
  flushBurst()
  edit()
  flushBurst()
}
