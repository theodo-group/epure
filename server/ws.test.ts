// The DNS-rebinding guard shared by the bridge socket and the /__epure/*
// endpoints: only a request addressed to localhost, from a localhost page (or
// from a non-browser client that sends no Origin), gets through.

import type { IncomingMessage } from 'node:http'

import { describe, expect, it } from 'vitest'

import { isLocalRequest } from './ws'

const req = (headers: { host?: string; origin?: string }) => ({ headers }) as IncomingMessage

describe('isLocalRequest', () => {
  it('accepts localhost hosts, with or without a port, from localhost pages or no page', () => {
    for (const host of ['127.0.0.1:5173', 'localhost:5173', 'localhost', '[::1]:5173']) {
      expect(isLocalRequest(req({ host })), host).toBe(true)
      expect(isLocalRequest(req({ host, origin: 'http://localhost:5173' })), host).toBe(true)
      expect(isLocalRequest(req({ host, origin: 'http://[::1]:5173' })), host).toBe(true)
    }
  })

  it('refuses a rebound hostname, even on the loopback port', () => {
    expect(isLocalRequest(req({ host: 'evil.example:5173' }))).toBe(false)
    expect(isLocalRequest(req({ host: 'localhost.evil.example' }))).toBe(false)
    expect(isLocalRequest(req({}))).toBe(false)
  })

  it('refuses a foreign or unparsable Origin on a localhost host', () => {
    const host = '127.0.0.1:5173'
    expect(isLocalRequest(req({ host, origin: 'https://evil.example' }))).toBe(false)
    expect(isLocalRequest(req({ host, origin: 'http://localhost.evil.example' }))).toBe(false)
    expect(isLocalRequest(req({ host, origin: 'null' }))).toBe(false)
  })
})
