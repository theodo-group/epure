// Tracks whether the user is mid-interaction, so inbound (disk → UI) applies can
// be deferred instead of yanking nodes from under the cursor or clobbering
// in-progress editor text. Two signals, OR-ed:
//   - a pointer is currently down (a drag may be in flight), and
//   - a local edit landed within the last ~1s (recent keystroke / drag move).
//
// A tiny mutable singleton rather than React state: it's read synchronously from
// a store subscription and written from global pointer listeners, both outside
// React's render cycle.

let pointerDown = false
let lastActivityAt = 0
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const fn of listeners) fn()
}

export const interaction = {
  /** Mark a local edit (keystroke, drag move) just happened. */
  noteActivity(): void {
    lastActivityAt = Date.now()
  },

  /** Track pointer state; releasing the pointer notifies subscribers so a
   *  deferred apply can reconcile immediately on pointer-up. */
  setPointerDown(down: boolean): void {
    pointerDown = down
    if (!down) emit()
  },

  /** True while the user is actively interacting. `quietMs` is the post-edit
   *  cool-down before inbound applies are allowed again. */
  isBusy(quietMs = 1000): boolean {
    return pointerDown || Date.now() - lastActivityAt < quietMs
  },

  /** Subscribe to reconcile triggers (currently: pointer-up). */
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  /** Test-only reset. */
  _reset(): void {
    pointerDown = false
    lastActivityAt = 0
    listeners.clear()
  },
}
