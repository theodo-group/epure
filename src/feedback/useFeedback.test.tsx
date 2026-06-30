// Regression coverage for the three-phase lifecycle — in particular the
// queued→thinking transition, which previously allocated a fresh `pending`
// object on every effect run and spun React into an infinite render loop.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BridgeUiState } from '@/bridge/useBridge'

import { useFeedback } from './useFeedback'

const makeBridge = (over: Partial<BridgeUiState>): BridgeUiState => ({
  active: true,
  status: 'connected',
  filename: 'sys',
  flash: false,
  diskChanged: false,
  invalidUnsaved: false,
  saveState: 'saved',
  usingLocalCopy: false,
  clash: null,
  resolveClash: () => {},
  remoteError: null,
  agentPolling: true,
  lastPickedUp: null,
  lastResolved: null,
  submitFeedback: () => true,
  ...over,
})

describe('useFeedback phase machine', () => {
  it('goes queued → thinking on pickup and is idempotent (no render loop)', () => {
    let sentId = ''
    const submitFeedback = vi.fn((id: string) => {
      sentId = id
      return true
    })
    const { result, rerender } = renderHook((b: BridgeUiState) => useFeedback(b), {
      initialProps: makeBridge({ submitFeedback }),
    })

    act(() => result.current.setText('make it teal'))
    act(() => result.current.send())
    expect(result.current.phase).toBe('queued')
    expect(submitFeedback).toHaveBeenCalledWith(sentId, 'make it teal', { kind: 'none' })

    // Pickup with the matching id → thinking.
    rerender(makeBridge({ submitFeedback, lastPickedUp: sentId }))
    expect(result.current.phase).toBe('thinking')

    // Re-firing the SAME pickup must settle (the buggy version looped forever).
    rerender(makeBridge({ submitFeedback, lastPickedUp: sentId }))
    expect(result.current.phase).toBe('thinking')
  })

  it('clears the pending phase and shows the result on resolution', () => {
    let sentId = ''
    const submitFeedback = vi.fn((id: string) => {
      sentId = id
      return true
    })
    const { result, rerender } = renderHook((b: BridgeUiState) => useFeedback(b), {
      initialProps: makeBridge({ submitFeedback }),
    })
    act(() => result.current.setText('x'))
    act(() => result.current.send())

    rerender(
      makeBridge({
        submitFeedback,
        lastResolved: { type: 'feedbackResolved', id: sentId, status: 'done', message: 'painted' },
      }),
    )
    expect(result.current.phase).toBeNull()
    expect(result.current.result).toMatchObject({ status: 'done', message: 'painted' })
  })
})
