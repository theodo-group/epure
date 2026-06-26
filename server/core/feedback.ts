// In-memory live-feedback queue: the bridge between the browser toolbar (which
// submits over the WebSocket) and the host Claude Code (which drains over the
// HTTP long-poll). Deliberately tiny — no leases, no journal, no durability.
// This is one localhost server per diagram, one CC session, one human watching
// the canvas; best-effort at-most-once is the right contract. The edited
// `.epr.*` pair is the only durable artifact.
//
// Mirrors impeccable's live-server poll/reply loop, minus its multi-phase
// accept/carbonize lifecycle (the user cut variants), so the lease/recovery
// machinery has nothing to recover and is omitted.

import type {
  FeedbackEvent,
  FeedbackPickedUpMsg,
  FeedbackReply,
  FeedbackResolvedMsg,
  FeedbackStatusMsg,
  PollResponse,
} from './protocol'

/** Drop the oldest when the backlog gets silly — a human can't outrun this. */
const MAX_QUEUE = 50
/** Grace after the last browser tab closes before parked polls get `exit`, so
 *  a reload/navigation blip doesn't tear down the agent's loop. Matches
 *  impeccable's 8s editor-gone window. */
const EXIT_GRACE_MS = 8_000

export type FeedbackBroadcast = (
  msg: FeedbackStatusMsg | FeedbackPickedUpMsg | FeedbackResolvedMsg,
) => void

export interface FeedbackHub {
  /** Browser → queue (one toolbar submission). */
  submit(event: FeedbackEvent): void
  /** Agent leg: resolve with the next event, or `timeout`/`exit`. */
  poll(timeoutMs: number): Promise<PollResponse>
  /** Put a delivered event back at the head of the queue — used when the poll
   *  that received it was aborted before the response reached the agent, so the
   *  event isn't silently lost and its id doesn't leak in `inflight`. */
  unget(event: FeedbackEvent): void
  /** Agent leg: the verdict on an event. Unknown ids are a harmless no-op. */
  reply(reply: FeedbackReply): void
  /** Ready-browser count changed (drives the exit grace timer). */
  onBrowsersChanged(count: number): void
  /** Tear down: settle parked polls with `exit`, clear timers. */
  stop(): void
  /** True iff an agent is attached: parked on the poll OR mid-edit (an event is
   *  delivered but not yet replied). The second half keeps the toolbar dot
   *  green while Claude is editing, not just while it's waiting. */
  readonly agentPolling: boolean
}

interface Waiter {
  resolve: (r: PollResponse) => void
  timer: ReturnType<typeof setTimeout> | null
  settled: boolean
}

export const createFeedbackHub = (broadcast: FeedbackBroadcast): FeedbackHub => {
  const queue: FeedbackEvent[] = []
  const waiters: Waiter[] = []
  /** Delivered-but-unreplied ids. */
  const inflight = new Set<string>()
  let lastPolling = false
  /** Sticky once the exit grace fires: the editor is gone, so any poll that
   *  arrives afterward gets `exit` immediately instead of parking a waiter that
   *  nothing will ever settle. Cleared when an editor (re)connects. */
  let editorGone = false
  let exitTimer: ReturnType<typeof setTimeout> | null = null

  const polling = (): boolean => waiters.length > 0 || inflight.size > 0

  /** Broadcast the dot state only on a real transition. */
  const syncStatus = (): void => {
    const now = polling()
    if (now === lastPolling) return
    lastPolling = now
    broadcast({ type: 'feedbackStatus', agentPolling: now })
  }

  const settle = (w: Waiter, r: PollResponse): void => {
    if (w.settled) return
    w.settled = true
    if (w.timer) clearTimeout(w.timer)
    const i = waiters.indexOf(w)
    if (i >= 0) waiters.splice(i, 1)
    w.resolve(r)
  }

  /** Mark an event as taken by the agent and tell the browser it's now being
   *  worked on (Sent · waiting → Claude is thinking…). */
  const deliver = (event: FeedbackEvent): void => {
    inflight.add(event.id)
    broadcast({ type: 'feedbackPickedUp', id: event.id })
  }

  /** Hand queued events to parked pollers, oldest first. */
  const flush = (): void => {
    while (waiters.length > 0 && queue.length > 0) {
      const event = queue.shift()!
      deliver(event)
      settle(waiters[0]!, event)
    }
    syncStatus()
  }

  return {
    get agentPolling() {
      return polling()
    },

    submit(event) {
      queue.push(event)
      while (queue.length > MAX_QUEUE) queue.shift()
      flush()
    },

    unget(event) {
      inflight.delete(event.id)
      queue.unshift(event)
      flush() // hand it to another parked poller if one is waiting
    },

    poll(timeoutMs) {
      return new Promise<PollResponse>((resolve) => {
        // Deliver a queued event immediately (the common case once an agent is
        // looping: it re-polls and the human has already typed).
        const queued = queue.shift()
        if (queued) {
          deliver(queued)
          syncStatus()
          resolve(queued)
          return
        }
        // The editor is gone for good — tell the loop to stop instead of parking
        // a waiter that only a (never-coming) reconnect could settle.
        if (editorGone) {
          resolve({ type: 'exit' })
          return
        }
        // Otherwise park until an event arrives or the slice elapses.
        const w: Waiter = { resolve, timer: null, settled: false }
        w.timer = setTimeout(() => {
          settle(w, { type: 'timeout' })
          syncStatus()
        }, timeoutMs)
        waiters.push(w)
        syncStatus()
      })
    },

    reply({ id, status, message }) {
      inflight.delete(id)
      broadcast({
        type: 'feedbackResolved',
        id,
        status,
        ...(message ? { message } : {}),
      })
      syncStatus()
    },

    onBrowsersChanged(count) {
      if (count > 0) {
        // Editor (re)appeared — cancel any pending teardown and let polls park.
        editorGone = false
        if (exitTimer) {
          clearTimeout(exitTimer)
          exitTimer = null
        }
        // A (re)connecting editor — including a second tab or a reload that
        // races the old socket's close (count 1→2) — missed any transitions
        // while away; re-sync the dot whenever an agent is attached. `broadcast`
        // is send-to-all and the client setter is idempotent, so re-asserting
        // `true` to already-green tabs is harmless.
        if (polling()) broadcast({ type: 'feedbackStatus', agentPolling: true })
        return
      }
      // Last tab closed: after the grace window, mark the editor gone (so a poll
      // arriving later gets `exit` rather than a doomed park), drop queued work
      // and any leaked in-flight ids, and end parked polls so the loop stops.
      if (exitTimer) return
      exitTimer = setTimeout(() => {
        exitTimer = null
        editorGone = true
        queue.length = 0
        inflight.clear()
        for (const w of [...waiters]) settle(w, { type: 'exit' })
        syncStatus()
      }, EXIT_GRACE_MS)
    },

    stop() {
      if (exitTimer) clearTimeout(exitTimer)
      exitTimer = null
      for (const w of [...waiters]) settle(w, { type: 'exit' })
      queue.length = 0
      inflight.clear()
    },
  }
}
