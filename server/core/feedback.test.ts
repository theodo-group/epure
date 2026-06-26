import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFeedbackHub, type FeedbackBroadcast } from './feedback'
import type {
  FeedbackEvent,
  FeedbackPickedUpMsg,
  FeedbackResolvedMsg,
  FeedbackStatusMsg,
} from './protocol'

const ev = (id: string, text = 'note'): FeedbackEvent => ({
  type: 'feedback',
  id,
  doc: 'sys',
  text,
  target: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00.000Z',
})

describe('feedback hub', () => {
  let msgs: (FeedbackStatusMsg | FeedbackPickedUpMsg | FeedbackResolvedMsg)[]
  const broadcast: FeedbackBroadcast = (m) => msgs.push(m)
  const statuses = (): boolean[] =>
    msgs.filter((m): m is FeedbackStatusMsg => m.type === 'feedbackStatus').map((m) => m.agentPolling)
  const pickedUp = (): string[] =>
    msgs.filter((m): m is FeedbackPickedUpMsg => m.type === 'feedbackPickedUp').map((m) => m.id)

  beforeEach(() => {
    vi.useFakeTimers()
    msgs = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers queued events FIFO, at-most-once', async () => {
    const hub = createFeedbackHub(broadcast)
    hub.submit(ev('a'))
    hub.submit(ev('b'))
    expect(await hub.poll(1000)).toMatchObject({ id: 'a' })
    expect(await hub.poll(1000)).toMatchObject({ id: 'b' })
    const third = hub.poll(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await third).toEqual({ type: 'timeout' })
    hub.stop()
  })

  it('a parked poll is woken by a later submit', async () => {
    const hub = createFeedbackHub(broadcast)
    const parked = hub.poll(5000)
    hub.submit(ev('x'))
    expect(await parked).toMatchObject({ id: 'x' })
    hub.stop()
  })

  it('broadcasts feedbackPickedUp when an event is delivered (both paths)', async () => {
    const hub = createFeedbackHub(broadcast)
    // Parked-waiter path.
    const parked = hub.poll(5000)
    hub.submit(ev('p1'))
    await parked
    // Immediate (already-queued) path.
    hub.submit(ev('p2'))
    await hub.poll(1000)
    expect(pickedUp()).toEqual(['p1', 'p2'])
    hub.stop()
  })

  it('keeps the dot green from receive through reply (the mid-edit window)', async () => {
    const hub = createFeedbackHub(broadcast)
    hub.submit(ev('a'))
    expect(await hub.poll(1000)).toMatchObject({ id: 'a' })
    // Delivered but not yet replied — agent is editing, dot must stay green.
    expect(hub.agentPolling).toBe(true)
    hub.reply({ id: 'a', status: 'done' })
    expect(hub.agentPolling).toBe(false)
    expect(statuses()).toEqual([true, false])
    hub.stop()
  })

  it('toggles the dot true→false when a parked poll times out', async () => {
    const hub = createFeedbackHub(broadcast)
    const parked = hub.poll(1000)
    expect(statuses()).toEqual([true])
    await vi.advanceTimersByTimeAsync(1000)
    await parked
    expect(statuses()).toEqual([true, false])
    hub.stop()
  })

  it('caps the queue, dropping the oldest events', async () => {
    const hub = createFeedbackHub(broadcast)
    for (let i = 0; i < 55; i += 1) hub.submit(ev(`e${i}`))
    expect(await hub.poll(1000)).toMatchObject({ id: 'e5' }) // e0..e4 dropped
    hub.stop()
  })

  it('ends a parked poll with exit after the last browser closes', async () => {
    const hub = createFeedbackHub(broadcast)
    hub.onBrowsersChanged(1)
    const parked = hub.poll(60_000)
    hub.onBrowsersChanged(0)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await parked).toEqual({ type: 'exit' })
    hub.stop()
  })

  it('cancels the exit grace when the editor reconnects', async () => {
    const hub = createFeedbackHub(broadcast)
    hub.onBrowsersChanged(1)
    const parked = hub.poll(60_000)
    hub.onBrowsersChanged(0)
    await vi.advanceTimersByTimeAsync(4_000)
    hub.onBrowsersChanged(1) // back within the grace window
    await vi.advanceTimersByTimeAsync(8_000)
    // The poll survived (no exit yet); stop() settles it.
    hub.stop()
    expect(await parked).toEqual({ type: 'exit' })
  })

  it('re-syncs the dot to a reconnecting editor only when an agent is attached', async () => {
    const hub = createFeedbackHub(broadcast)
    const parked = hub.poll(60_000) // agent attaches → true
    expect(statuses()).toEqual([true])
    hub.onBrowsersChanged(0)
    msgs.length = 0
    hub.onBrowsersChanged(1) // reconnect while still polling → re-broadcast true
    expect(statuses()).toEqual([true])
    hub.stop()
    await parked
  })

  it('treats a reply to an unknown id as a harmless broadcast', () => {
    const hub = createFeedbackHub(broadcast)
    hub.reply({ id: 'ghost', status: 'done' })
    expect(msgs).toContainEqual({ type: 'feedbackResolved', id: 'ghost', status: 'done' })
    hub.stop()
  })

  it('tells a poll arriving after the editor-gone grace to exit (no infinite loop)', async () => {
    const hub = createFeedbackHub(broadcast)
    hub.onBrowsersChanged(1)
    hub.submit(ev('a'))
    expect(await hub.poll(1000)).toMatchObject({ id: 'a' }) // delivered; agent now editing
    hub.onBrowsersChanged(0) // tab closes mid-edit, no waiter parked
    await vi.advanceTimersByTimeAsync(8_000) // grace fires, settles nothing
    hub.reply({ id: 'a', status: 'done' })
    // The agent re-polls — it must be told to stop, not park forever.
    expect(await hub.poll(1000)).toEqual({ type: 'exit' })
    hub.stop()
  })

  it('clears leaked in-flight ids when the editor-gone grace fires', async () => {
    const hub = createFeedbackHub(broadcast)
    hub.onBrowsersChanged(1)
    hub.submit(ev('a'))
    await hub.poll(1000) // delivered; inflight = {a}
    expect(hub.agentPolling).toBe(true)
    hub.onBrowsersChanged(0)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(hub.agentPolling).toBe(false) // inflight wiped on teardown, dot not stuck
    hub.stop()
  })

  it('unget re-queues a delivered event and frees its in-flight id', async () => {
    const hub = createFeedbackHub(broadcast)
    const e = ev('a')
    hub.submit(e)
    expect(await hub.poll(1000)).toMatchObject({ id: 'a' })
    expect(hub.agentPolling).toBe(true) // inflight holds 'a'
    hub.unget(e) // the poll that received it was aborted
    expect(hub.agentPolling).toBe(false) // id freed
    expect(await hub.poll(1000)).toMatchObject({ id: 'a' }) // re-delivered, not lost
    hub.stop()
  })

  it('re-asserts the dot to a second/reconnecting editor while an agent is attached', async () => {
    const hub = createFeedbackHub(broadcast)
    hub.onBrowsersChanged(1)
    const parked = hub.poll(60_000) // agent attaches → true
    expect(statuses()).toEqual([true])
    msgs.length = 0
    hub.onBrowsersChanged(2) // a 2nd tab (or reload racing the close) connects
    expect(statuses()).toEqual([true]) // broadcast to all, so the new tab learns it
    hub.stop()
    await parked
  })
})
