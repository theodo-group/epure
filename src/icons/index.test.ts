import { describe, expect, it } from 'vitest'

import { catalog, icon, provider, providers, search, url } from './index'

describe('the icon catalog', () => {
  it('search filters by terms and provider, capped to limit', () => {
    const hits = search('lambda', { provider: 'aws' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((m) => m.provider === 'aws')).toBe(true)
    expect(search('zzz-no-such-icon')).toEqual([])
    expect(search('', { limit: 3 })).toHaveLength(3)
  })

  it('icon and url resolve ids; unknown ids resolve to undefined', () => {
    const first = catalog[0]!
    expect(icon(first.id)).toBe(first)
    expect(url(first.id)).toBe(url(first))
    expect(url(first)).toContain('/icons/')
    expect(icon('nope/nope')).toBeUndefined()
    expect(url('nope/nope')).toBeUndefined()
  })

  it('providers carry labels and counts; unknown keys self-label', () => {
    expect(providers.length).toBeGreaterThan(5)
    expect(provider('aws')).toMatchObject({ key: 'aws', label: 'AWS' })
    expect(provider('aws').count).toBeGreaterThan(0)
    expect(provider('mystery')).toEqual({ key: 'mystery', label: 'mystery', count: 0 })
  })
})
