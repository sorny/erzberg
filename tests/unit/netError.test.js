import { describe, expect, it } from 'vitest'
import { reachError } from '../../src/utils/netError.js'

describe('reachError', () => {
  it('turns each browser\'s network failure into one sentence', () => {
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
      expect(reachError(new TypeError(m), 'OpenStreetMap'))
        .toBe('Could not reach OpenStreetMap. Check the connection, then try again.')
    }
  })
  it('keeps a message that was written for a person', () => {
    expect(reachError(new Error('Overpass is busy (429).'), 'OpenStreetMap')).toBe('Overpass is busy (429).')
  })
  it('names the host when there is no message at all', () => {
    expect(reachError(null, 'the geocoder')).toBe('Could not reach the geocoder.')
  })
})
