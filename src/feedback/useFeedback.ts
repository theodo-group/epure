// Live-feedback UI state, lifted to one hook so the toolbar (buttons, textbar,
// status) and the Canvas (pick/insert hit-test, anchor highlight) share a single
// source of truth without a global store. Called once in App; its slices flow
// down to both. The wire/transport lives in `useBridge`; this is pure UI glue.
//
// A submission moves through three visible phases so the wait is never opaque:
//   queued   — sent, sitting in the server queue, no agent has taken it yet
//   thinking — Claude drained it off the queue and is now editing
//   (result) — the agent replied done/error
// The transitions are driven by the server's `feedbackPickedUp` / `feedbackResolved`
// pushes, matched to our submission by id.

import { useCallback, useEffect, useRef, useState } from 'react'

import type { BridgeUiState } from '@/bridge/useBridge'
import type { FeedbackTarget } from '@/bridge/protocol'

export type FeedbackMode = 'off' | 'pick' | 'insert'
export type FeedbackPhase = 'queued' | 'thinking'
export interface FeedbackResult {
  status: 'done' | 'error'
  message?: string
}

/** How long a resolved ✓/⚠ lingers before the bar resets. */
const RESULT_CLEAR_MS = 2600

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

export interface FeedbackUi {
  mode: FeedbackMode
  target: FeedbackTarget | null
  text: string
  /** The in-flight submission's phase, or null when nothing is pending. */
  phase: FeedbackPhase | null
  /** The agent's last verdict on our submission (cleared shortly after). */
  result: FeedbackResult | null
  /** An agent is attached to the poll (drives the status dot). */
  agentPolling: boolean
  toggleMode: (m: 'pick' | 'insert') => void
  cancelMode: () => void
  setText: (t: string) => void
  pick: (ref: string) => void
  insertPoint: (x: number, y: number) => void
  clearTarget: () => void
  send: () => void
  canSend: boolean
}

export const useFeedback = (bridge: BridgeUiState): FeedbackUi => {
  const [mode, setMode] = useState<FeedbackMode>('off')
  const [target, setTarget] = useState<FeedbackTarget | null>(null)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<{ id: string; phase: FeedbackPhase } | null>(null)
  const [result, setResult] = useState<FeedbackResult | null>(null)
  const resultTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const { submitFeedback, lastPickedUp, lastResolved, agentPolling, status } = bridge

  // Claude drained our event → flip queued → thinking. The `phase === 'queued'`
  // guard makes this idempotent: once thinking, the updater returns the SAME
  // object so React's Object.is bailout stops the effect (without it, every run
  // allocates a fresh object, re-triggering the [pending] dep → infinite loop).
  useEffect(() => {
    if (!lastPickedUp || !pending || lastPickedUp !== pending.id) return
    setPending((p) =>
      p && p.id === lastPickedUp && p.phase === 'queued' ? { ...p, phase: 'thinking' } : p,
    )
  }, [lastPickedUp, pending])

  // Match an incoming resolution to our pending submission by id.
  useEffect(() => {
    if (!lastResolved || !pending || lastResolved.id !== pending.id) return
    setPending(null)
    setResult({
      status: lastResolved.status,
      ...(lastResolved.message ? { message: lastResolved.message } : {}),
    })
    if (resultTimer.current) clearTimeout(resultTimer.current)
    resultTimer.current = setTimeout(() => setResult(null), RESULT_CLEAR_MS)
  }, [lastResolved, pending])

  // A dropped socket can swallow the resolution for an in-flight submit (it's
  // broadcast once, only to connected tabs, and never replayed on reconnect).
  // Without this, the bar would stay wedged with Send disabled forever. Clear
  // the pending state so the user can act again.
  useEffect(() => {
    if (status !== 'disconnected' || !pending) return
    setPending(null)
    setResult({ status: 'error', message: 'connection dropped — re-send if needed' })
    if (resultTimer.current) clearTimeout(resultTimer.current)
    resultTimer.current = setTimeout(() => setResult(null), RESULT_CLEAR_MS)
  }, [status, pending])

  useEffect(
    () => () => {
      if (resultTimer.current) clearTimeout(resultTimer.current)
    },
    [],
  )

  const toggleMode = useCallback((m: 'pick' | 'insert') => {
    setMode((cur) => (cur === m ? 'off' : m))
  }, [])

  const cancelMode = useCallback(() => setMode('off'), [])

  const pick = useCallback((ref: string) => {
    setTarget({ kind: 'element', ref })
    setMode('off')
  }, [])

  const insertPoint = useCallback((x: number, y: number) => {
    setTarget({ kind: 'point', x, y })
    setMode('off')
  }, [])

  const clearTarget = useCallback(() => setTarget(null), [])

  const canSend = text.trim().length > 0

  const send = useCallback(() => {
    const body = text.trim()
    if (body.length === 0) return
    const id = newId()
    if (!submitFeedback(id, body, target ?? { kind: 'none' })) return
    setPending({ id, phase: 'queued' })
    setResult(null)
    setText('')
    setTarget(null)
    setMode('off')
  }, [text, target, submitFeedback])

  return {
    mode,
    target,
    text,
    phase: pending?.phase ?? null,
    result,
    agentPolling,
    toggleMode,
    cancelMode,
    setText,
    pick,
    insertPoint,
    clearTarget,
    send,
    canSend,
  }
}
