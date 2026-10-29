import { describe, it, expect } from 'vitest'
import { sectionMatches } from '../../src/components/panel/filter.js'

describe('sectionMatches', () => {
  it('matches a query at the start of a word', () => {
    expect(sectionMatches('Export', 'pen layers ink', 'pen')).toBe(true)
    expect(sectionMatches('Mode: Hillshade', 'depth bias', 'depth bias')).toBe(true)
    expect(sectionMatches('Mode: Lines', '', 'mode: lines')).toBe(true)
  })
  it('does not match inside a word', () => {
    expect(sectionMatches('Fetch', 'openstreetmap open data', 'pen')).toBe(false)
  })
  it('lets every section through an empty query', () => {
    expect(sectionMatches('Fetch', '', '')).toBe(true)
  })
})

describe('suggestTerms', () => {
  it('offers the word a typo meant', async () => {
    const { suggestTerms } = await import('../../src/components/panel/filter.js')
    const { SECTION_TERMS } = await import('../../src/components/panel/sectionTerms.js')
    expect(suggestTerms('contuor', SECTION_TERMS)[0]).toMatch(/^contours?$/)
    expect(suggestTerms('xyzzy', SECTION_TERMS)).toEqual([])
  })
})

describe('suggestTerms ranking', () => {
  it('puts the dropped-letter word first and offers a plural once', async () => {
    const { suggestTerms } = await import('../../src/components/panel/filter.js')
    const { SECTION_TERMS } = await import('../../src/components/panel/sectionTerms.js')
    const got = suggestTerms('contur', SECTION_TERMS)
    expect(got[0]).toMatch(/^contours?$/)
    expect(got.filter((w) => /^contours?$/.test(w))).toHaveLength(1)
  })
})

describe('several words', () => {
  it('finds a label whose words are both in the index, in any order', () => {
    expect(sectionMatches('Mode: Hillshade', 'sun azimuth altitude intensity', 'sun altitude')).toBe(true)
    expect(sectionMatches('Mode: Hillshade', 'sun azimuth altitude intensity', 'altitude sun')).toBe(true)
    expect(sectionMatches('Mode: Hillshade', 'sun azimuth altitude intensity', 'sun bias')).toBe(false)
  })
})
